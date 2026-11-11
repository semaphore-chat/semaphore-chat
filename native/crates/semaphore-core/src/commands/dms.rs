//! Direct messages and groups: the list, creating one, adding members and leaving, and finding
//! users. The conversation itself is `Conversation::DirectMessage` with the message commands.
//! Unit W2-core.
//!
//! The server announces none of these changes: a group someone else made reaches its members with
//! its first message. So a message for a group the list doesn't have reads the list again, and one
//! for a group it has moves that group to the top with the message as its preview. The commands
//! here change the cached list from the server's answer.

use crate::cache::{CacheValue, keys};
use crate::client::{Core, State};
use crate::model::{DmList, DmPreview, DmRow, UserView};
use crate::platform::CoreError;
use crate::resync::unavailable;
use crate::store::span_input;
use crate::text::spans_to_text;
use semaphore_wire::types::{self as wire, MessageDto};

/// The most users a search asks for unless told otherwise.
const SEARCH_LIMIT: u32 = 20;

fn parse_ids(user_ids: &[String]) -> Result<Vec<uuid::Uuid>, CoreError> {
    user_ids
        .iter()
        .map(|id| {
            id.parse().map_err(|_| CoreError::Failed {
                message: format!("not a user id: {id:?}"),
            })
        })
        .collect()
}

fn member_view(member: &wire::DmGroupMemberDto) -> UserView {
    UserView {
        id: member.user_id.clone(),
        username: member.user.username.clone(),
        display_name: member.user.display_name.clone(),
        avatar_file_id: member.user.avatar_url.clone(),
    }
}

impl State {
    fn is_online(&self, user_id: &str) -> bool {
        self.cache
            .presence(&keys::op(keys::PRESENCE))
            .and_then(|presence| presence.get(user_id))
            .copied()
            .unwrap_or(false)
    }

    fn dm_row(&self, group: &wire::DmGroupResponseDto) -> DmRow {
        let me = self.me_id();
        let members: Vec<UserView> = group
            .members
            .iter()
            .filter(|member| member.user_id != me)
            .map(member_view)
            .collect();
        let (unread, mentions) = self.unread_for(&group.id);
        let online = !group.is_group
            && members.len() == 1
            && members.iter().all(|member| self.is_online(&member.id));
        DmRow {
            id: group.id.clone(),
            name: group.name.clone().filter(|name| !name.is_empty()),
            is_group: group.is_group,
            members,
            last_message: group.last_message.as_ref().map(|message| {
                let spans: Vec<_> = message.spans.iter().map(span_input).collect();
                DmPreview {
                    author_id: message.author_id.clone().unwrap_or_default(),
                    text: spans_to_text(&spans, None),
                    sent_at_ms: message.sent_at.timestamp_millis(),
                }
            }),
            unread,
            mentions,
            online,
        }
    }

    /// Reads the list and what its rows show.
    fn ensure_dms(&mut self) {
        self.ensure_query(keys::op(keys::DMS));
        self.ensure_query(keys::op(keys::UNREAD));
        self.ensure_query(keys::op(keys::PRESENCE));
    }

    /// Puts a group the server returned at the top of the list, replacing any copy.
    fn put_dm_group(&mut self, group: wire::DmGroupResponseDto) {
        let key = keys::op(keys::DMS);
        self.note_direct_update(&key);
        match self.cache.dm_groups_mut(&key) {
            Some(groups) => {
                groups.retain(|known| known.id != group.id);
                groups.insert(0, group);
            }
            None => self.ensure_query(key),
        }
        self.view_changed(crate::model::ViewKey::DirectMessages);
    }

    /// A message in a DM: its group moves to the top with it as the preview. A group the list
    /// doesn't have is new to this user, so the list is read again.
    pub(crate) fn w2_dm_message(&mut self, dto: &MessageDto) {
        let Some(group_id) = dto.direct_message_group_id.as_deref() else {
            return;
        };
        let key = keys::op(keys::DMS);
        let Some(groups) = self.cache.dm_groups_mut(&key) else {
            return;
        };
        let Some(index) = groups.iter().position(|group| group.id == group_id) else {
            self.invalidate(&key);
            return;
        };
        let mut group = groups.remove(index);
        let newer = group
            .last_message
            .as_ref()
            .is_none_or(|last| last.sent_at <= dto.sent_at);
        if newer {
            group.last_message = Some(wire::DmGroupLastMessageDto {
                author_id: dto.author_id.clone(),
                id: dto.id.clone(),
                sent_at: dto.sent_at,
                spans: dto.spans.clone(),
            });
        }
        groups.insert(if newer { 0 } else { index }, group);
        self.note_direct_update(&key);
        self.view_changed(crate::model::ViewKey::DirectMessages);
    }

    /// Unread counts or presence changed: the rows show both.
    pub(crate) fn w2_dms_touched(&mut self) {
        if self.cache.dm_groups(&keys::op(keys::DMS)).is_some() {
            self.view_changed(crate::model::ViewKey::DirectMessages);
        }
    }
}

impl Core {
    pub(crate) async fn fetch_dms(&self) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        Ok(CacheValue::DmGroups(
            backend
                .direct_messages_controller_find_user_dm_groups()
                .await
                .map_err(|error| self.backend_failed(error))?,
        ))
    }

    /// This user's DMs and groups, the most recently active first. `ViewKey::DirectMessages` says
    /// when to read again.
    pub fn dm_list(&self) -> DmList {
        self.write(|state, _| {
            state.ensure_dms();
            let key = keys::op(keys::DMS);
            DmList {
                state: state.query_load_state(&key),
                rows: state
                    .cache
                    .dm_groups(&key)
                    .map(|groups| groups.iter().map(|group| state.dm_row(group)).collect())
                    .unwrap_or_default(),
            }
        })
    }

    /// One DM or group, for its header. `None` until the list has it.
    pub fn dm(&self, dm_id: String) -> Option<DmRow> {
        self.write(|state, _| {
            state.ensure_dms();
            let group = state
                .cache
                .dm_groups(&keys::op(keys::DMS))?
                .iter()
                .find(|group| group.id == dm_id)?;
            Some(state.dm_row(group))
        })
    }

    /// Users whose name matches, to start a DM with or to befriend. Never this user.
    pub async fn search_users(
        &self,
        query: String,
        limit: Option<u32>,
    ) -> Result<Vec<UserView>, CoreError> {
        let (services, epoch) = self.begin("user search")?;
        let users = services
            .backend
            .user_controller_search_users(
                None,
                Some(i64::from(limit.unwrap_or(SEARCH_LIMIT))),
                query,
            )
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.same_session(epoch)?;
        let me = self.read(|state| state.me_id().to_owned());
        Ok(users
            .iter()
            .filter(|user| user.id != me)
            .map(crate::client::user_view)
            .collect())
    }

    /// Fails if the session `epoch` names has ended: what the call found belongs to it.
    pub(crate) fn same_session(&self, epoch: u64) -> Result<(), CoreError> {
        if self.read(|state| state.session_epoch) == epoch {
            Ok(())
        } else {
            Err(CoreError::Failed {
                message: "signed out".into(),
            })
        }
    }

    /// Starts a DM with one user, or a group with several, and returns its id. A DM with one user
    /// that already exists comes back as itself. `name` applies to a group only.
    pub async fn create_dm(
        &self,
        user_ids: Vec<String>,
        name: Option<String>,
    ) -> Result<String, CoreError> {
        let ids = parse_ids(&user_ids)?;
        if ids.is_empty() {
            return Err(CoreError::Failed {
                message: "a DM needs someone to talk to".into(),
            });
        }
        let (services, epoch) = self.begin("creating direct messages")?;
        let name = name
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty() && ids.len() > 1);
        let group = services
            .backend
            .direct_messages_controller_create_dm_group(wire::CreateDmGroupDto {
                is_group: None,
                name,
                user_ids: ids,
            })
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.same_session(epoch)?;
        let id = group.id.clone();
        self.write(|state, _| state.put_dm_group(group));
        Ok(id)
    }

    /// Adds people to a group. A one-to-one DM can't grow: the server refuses.
    pub async fn add_dm_members(
        &self,
        dm_id: String,
        user_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        let ids = parse_ids(&user_ids)?;
        let (services, epoch) = self.begin("adding group members")?;
        let group = services
            .backend
            .direct_messages_controller_add_members(dm_id, wire::AddMembersDto { user_ids: ids })
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.same_session(epoch)?;
        self.write(|state, _| state.put_dm_group(group));
        Ok(())
    }

    /// Leaves a group. It goes from the list once the server agrees.
    pub async fn leave_dm(&self, dm_id: String) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("leaving groups")?;
        services
            .backend
            .direct_messages_controller_leave_dm_group(dm_id.clone())
            .await
            .map_err(|error| self.backend_failed(error))?;
        self.same_session(epoch)?;
        self.write(|state, _| {
            let key = keys::op(keys::DMS);
            state.note_direct_update(&key);
            if let Some(groups) = state.cache.dm_groups_mut(&key) {
                groups.retain(|group| group.id != dm_id);
            }
            state.view_changed(crate::model::ViewKey::DirectMessages);
        });
        Ok(())
    }
}
