//! W6-D: every community (with force delete) and the instance invites.
//!
//! This file is W6-D's own: its state, its cached values (`ContentValue`, inside
//! `CacheValue::W6(W6Value::Content(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`).
//!
//! The instance invites list is deliberately not W5-A's (`inviteControllerGetInvites`, a
//! community's invites): it calls the same operation, but the cache entry is W6-D's, so neither
//! lane changes the other's.

use std::collections::HashSet;
use std::num::NonZeroU64;

use crate::cache::{CacheValue, QueryKey, keys as cache_keys};
use crate::client::{Core, State};
use crate::commands::community_admin::OpKey;
use crate::model::{
    AdminActionKind, AdminCommunitiesView, AdminCommunityRow, AdminCommunityView, AdminInvitesView,
    InstanceInviteDraft, InstanceInviteRow, InviteCommunity, UserView, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

use super::W6Value;

/// W6-D's query ids: the web's `operationId`s.
pub mod keys {
    pub const COMMUNITIES: &str = "communityControllerFindAllWithStats";
    pub const COMMUNITY: &str = "communityControllerFindOneWithStats";
    /// Kept apart from W5-A's `inviteControllerGetInvites` (a community's invites): the same
    /// operation, an entry of W6-D's own.
    pub const INVITES: &str = "inviteControllerGetInvites.admin";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[COMMUNITIES, COMMUNITY, INVITES];
}

/// The communities list's page size, as the admin page asks for it.
const COMMUNITIES_PAGE: i64 = 50;

/// W6-D's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct ContentState {
    /// The searches whose next page is on its way.
    loading_more: HashSet<String>,
}

/// W6-D's cached responses.
#[derive(Debug, Clone)]
pub enum ContentValue {
    Communities {
        rows: Vec<wire::CommunityStatsDto>,
        /// The server has more; this is the cursor of what was read.
        next: Option<String>,
    },
    Community(wire::CommunityStatsDetailDto),
    Invites(Vec<wire::InviteResponseDto>),
}

/// The view a W6-D query feeds.
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    let id = key.segments.get(1).cloned().unwrap_or_default();
    Some(match key.op() {
        keys::COMMUNITIES => ViewKey::AdminCommunities { search: id },
        keys::COMMUNITY => ViewKey::AdminCommunity { community_id: id },
        keys::INVITES => ViewKey::AdminInvites,
        _ => return None,
    })
}

/// The query a W6-D view reads.
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    Some(match view {
        ViewKey::AdminCommunities { search } => {
            cache_keys::scoped(keys::COMMUNITIES, search.trim())
        }
        ViewKey::AdminCommunity { community_id } => {
            cache_keys::scoped(keys::COMMUNITY, community_id)
        }
        ViewKey::AdminInvites => cache_keys::op(keys::INVITES),
        _ => return None,
    })
}

/// A wire count as a `u64`: a negative one (nothing the server should send) reads as 0.
fn count(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

/// A wire count as a `u32`, clamped.
fn clamped(value: i64) -> u32 {
    value.clamp(0, i64::from(u32::MAX)) as u32
}

/// One row of the communities list or its detail.
fn admin_row(
    id: String,
    name: String,
    description: Option<String>,
    avatar: Option<String>,
    member_count: i64,
    channel_count: i64,
    created_at: chrono::DateTime<chrono::Utc>,
) -> AdminCommunityRow {
    AdminCommunityRow {
        id,
        name,
        description,
        avatar_file_id: avatar,
        member_count: count(member_count),
        channel_count: count(channel_count),
        created_at_ms: created_at.timestamp_millis(),
    }
}

fn row_of_stats(stats: &wire::CommunityStatsDto) -> AdminCommunityRow {
    admin_row(
        stats.id.clone(),
        stats.name.clone(),
        stats.description.clone(),
        stats.avatar.clone(),
        stats.member_count,
        stats.channel_count,
        stats.created_at,
    )
}

fn row_of_detail(detail: &wire::CommunityStatsDetailDto) -> AdminCommunityRow {
    admin_row(
        detail.id.clone(),
        detail.name.clone(),
        detail.description.clone(),
        detail.avatar.clone(),
        detail.member_count,
        detail.channel_count,
        detail.created_at,
    )
}

/// An instance invite as the admin page shows it: its communities named from the rail's list, an
/// id the rail doesn't have shown as it is.
fn invite_row(invite: &wire::InviteResponseDto, names: &[(String, String)]) -> InstanceInviteRow {
    InstanceInviteRow {
        code: invite.code.clone(),
        created_by: invite.created_by.as_ref().map(|creator| UserView {
            id: creator.id.clone(),
            username: creator.username.clone(),
            display_name: creator.display_name.clone(),
            avatar_file_id: None,
        }),
        uses: clamped(invite.uses),
        max_uses: invite.max_uses.map(clamped),
        valid_until_ms: invite.valid_until.map(|at| at.timestamp_millis()),
        created_at_ms: invite.created_at.timestamp_millis(),
        disabled: invite.disabled,
        communities: invite
            .default_communities
            .iter()
            .map(|community| InviteCommunity {
                name: names
                    .iter()
                    .find(|(id, _)| *id == community.community_id)
                    .map(|(_, name)| name.clone())
                    .unwrap_or_else(|| community.community_id.clone()),
                id: community.community_id.clone(),
            })
            .collect(),
    }
}

/// A draft refused before it was sent, in the admin page's words.
fn refused(message: &str) -> CoreError {
    CoreError::Failed {
        message: message.into(),
    }
}

/// The body a draft sends, or the reason it's refused: each community a UUID, uses of at least one,
/// and an expiry after now. No community at all is an invite to the instance alone, which the
/// backend takes (Home's Quick invite with nothing to invite to); the admin page's form asks for
/// one itself.
fn invite_body(
    draft: &InstanceInviteDraft,
    now_ms: u64,
) -> Result<wire::CreateInviteDto, CoreError> {
    let mut communities = Vec::with_capacity(draft.community_ids.len());
    for id in &draft.community_ids {
        let community = id
            .parse()
            .map_err(|_| refused("the community isn't valid"))?;
        communities.push(community);
    }
    if draft.max_uses == Some(0) {
        return Err(refused("Uses must be at least 1"));
    }
    let now_ms = i64::try_from(now_ms).unwrap_or(i64::MAX);
    let valid_until = match draft.valid_until_ms {
        None => None,
        Some(ms) => match chrono::DateTime::from_timestamp_millis(ms) {
            Some(at) if at.timestamp_millis() > now_ms => Some(at),
            _ => return Err(refused("The expiry must be in the future")),
        },
    };
    Ok(wire::CreateInviteDto {
        community_ids: communities,
        max_uses: draft
            .max_uses
            .and_then(|max| NonZeroU64::new(u64::from(max))),
        valid_until,
    })
}

impl State {
    fn content_value(&self, key: &QueryKey) -> Option<&ContentValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W6(W6Value::Content(value))) => Some(value),
            _ => None,
        }
    }

    /// Changes the cached value in place, as a direct update: `None` when it isn't cached.
    fn content_edit<R>(
        &mut self,
        key: &QueryKey,
        change: impl FnOnce(&mut ContentValue) -> R,
    ) -> Option<R> {
        let entry = self.cache.get(key)?.clone();
        let CacheValue::W6(W6Value::Content(mut value)) = entry.value else {
            return None;
        };
        let result = change(&mut value);
        self.cache.set(
            key.clone(),
            CacheValue::W6(W6Value::Content(value)),
            entry.fetched_at_ms,
        );
        if entry.stale {
            self.cache.invalidate_prefix(key);
        }
        self.note_direct_update(key);
        if let Some(view) = view_for(key) {
            self.view_changed(view);
        }
        Some(result)
    }

    /// A community is gone: out of every cached communities list, and its own detail dropped.
    /// (W5-A's `w5a_drop_community` has already taken it out of the rail and the shared caches.)
    fn content_drop_community(&mut self, community_id: &str) {
        for key in self.cache.keys_with_op(keys::COMMUNITIES) {
            self.content_edit(&key, |value| {
                if let ContentValue::Communities { rows, .. } = value {
                    rows.retain(|row| row.id != community_id);
                }
            });
        }
        self.cache
            .remove_prefix(&cache_keys::scoped(keys::COMMUNITY, community_id));
        self.view_changed(ViewKey::AdminCommunity {
            community_id: community_id.to_owned(),
        });
    }

    /// A W6-D query's data changed: say which views to read again. False when it isn't
    /// W6-D's.
    pub(crate) fn w6_content_query_changed(&mut self, key: &QueryKey) -> bool {
        let Some(view) = view_for(key) else {
            return false;
        };
        self.view_changed(view);
        true
    }

    /// One socket event, before the shared rules. No socket event covers W6-D's data: a force
    /// delete is quiet here (W5-A's `communityDeleted` finds the community in `w5a.deleting`, so
    /// it announces nothing to the admin who made it).
    pub(crate) fn w6_content_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-D query; `None` when it isn't one.
    pub(crate) async fn w6_content_fetch(
        &self,
        key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        view_for(key)?;
        Some(self.w6_content_fetch_value(key).await)
    }

    async fn w6_content_fetch_value(&self, key: &QueryKey) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        let id = key.segments.get(1).cloned().unwrap_or_default();
        let failed = |error| self.backend_failed(error);
        let value = match key.op() {
            keys::COMMUNITIES => {
                let search = (!id.is_empty()).then_some(id);
                let page = backend
                    .community_controller_find_all_with_stats(None, Some(COMMUNITIES_PAGE), search)
                    .await
                    .map_err(failed)?;
                ContentValue::Communities {
                    rows: page.communities,
                    next: page.continuation_token,
                }
            }
            keys::COMMUNITY => ContentValue::Community(
                backend
                    .community_controller_find_one_with_stats(id)
                    .await
                    .map_err(failed)?,
            ),
            keys::INVITES => ContentValue::Invites(
                backend
                    .invite_controller_get_invites()
                    .await
                    .map_err(failed)?,
            ),
            op => {
                return Err(CoreError::Failed {
                    message: format!("no fetch for {op}"),
                });
            }
        };
        Ok(CacheValue::W6(W6Value::Content(value)))
    }

    /// Every community on the instance, with its counts (`ViewKey::AdminCommunities { search }`).
    pub fn admin_communities(&self, search: String) -> AdminCommunitiesView {
        let search = search.trim().to_owned();
        self.write(|state, now| {
            let key = cache_keys::scoped(keys::COMMUNITIES, &search);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::AdminCommunities {
                search: search.clone(),
            };
            let (rows, more) = match state.content_value(&key) {
                Some(ContentValue::Communities { rows, next }) => {
                    (rows.iter().map(row_of_stats).collect(), next.is_some())
                }
                _ => (Vec::new(), false),
            };
            AdminCommunitiesView {
                state: state.query_load_state(&key),
                loading_more: state.w6.content.loading_more.contains(&search),
                search,
                rows,
                more,
                op: state.w5a_op(&view),
            }
        })
    }

    /// Reads the next page of the communities list. Nothing to do when the list isn't cached, has
    /// no next page, or a page is already on its way.
    pub async fn load_more_admin_communities(&self, search: String) -> Result<(), CoreError> {
        let search = search.trim().to_owned();
        let key = cache_keys::scoped(keys::COMMUNITIES, &search);
        let view = ViewKey::AdminCommunities {
            search: search.clone(),
        };
        let (services, epoch) = self.begin("the communities list")?;
        let next = self.write(|state, _| {
            if state.w6.content.loading_more.contains(&search) {
                return None;
            }
            let Some(ContentValue::Communities { next, .. }) = state.content_value(&key) else {
                return None;
            };
            let next = next.clone()?;
            state.w6.content.loading_more.insert(search.clone());
            state.view_changed(view.clone());
            Some(next)
        });
        let Some(next) = next else {
            return Ok(());
        };
        let result = services
            .backend
            .community_controller_find_all_with_stats(
                Some(next),
                Some(COMMUNITIES_PAGE),
                (!search.is_empty()).then(|| search.clone()),
            )
            .await;
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            state.w6.content.loading_more.remove(&search);
            state.view_changed(view.clone());
            if let Ok(page) = &result {
                state.content_edit(&key, |value| {
                    if let ContentValue::Communities { rows, next } = value {
                        // A page that overlaps what's shown (a community arrived meanwhile) adds
                        // what's new.
                        for row in &page.communities {
                            if !rows.iter().any(|known| known.id == row.id) {
                                rows.push(row.clone());
                            }
                        }
                        *next = page.continuation_token.clone();
                    }
                });
            }
        });
        result
            .map(|_| ())
            .map_err(|error| self.backend_failed(error))
    }

    /// One community with its counts, messages included (`ViewKey::AdminCommunity { id }`).
    pub fn admin_community(&self, community_id: String) -> AdminCommunityView {
        self.write(|state, now| {
            let key = cache_keys::scoped(keys::COMMUNITY, &community_id);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::AdminCommunity {
                community_id: community_id.clone(),
            };
            let mut out = AdminCommunityView {
                state: state.query_load_state(&key),
                op: state.w5a_op(&view),
                ..Default::default()
            };
            if let Some(ContentValue::Community(detail)) = state.content_value(&key) {
                out.message_count = count(detail.message_count);
                out.community = Some(row_of_detail(detail));
            }
            out
        })
    }

    /// Deletes a community whoever owns it. The server tells its members; this admin isn't told,
    /// so no `CoreEvent::CommunityRemoved` comes from their own delete.
    pub async fn force_delete_community(&self, community_id: String) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminCommunity {
                community_id: community_id.clone(),
            },
            AdminActionKind::ForceDeleteCommunity,
            Some(community_id.clone()),
        );
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a community")?;
        self.write(|state, _| {
            state.w5a.deleting.insert(community_id.clone());
        });
        let result = services
            .backend
            .community_controller_force_remove(community_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| {
                state.w5a_drop_community(&community_id, None);
                state.content_drop_community(&community_id);
            },
            |state| {
                state.w5a.deleting.remove(&community_id);
            },
        )
    }

    /// Every instance invite the server lists (`ViewKey::AdminInvites`), newest first.
    pub fn admin_invites(&self) -> AdminInvitesView {
        self.write(|state, now| {
            let key = cache_keys::op(keys::INVITES);
            state.w5a_ensure(&key, now, true);
            let names: Vec<(String, String)> = state
                .cache
                .communities(&cache_keys::op(cache_keys::COMMUNITIES))
                .map(|communities| {
                    communities
                        .iter()
                        .map(|community| (community.id.clone(), community.name.clone()))
                        .collect()
                })
                .unwrap_or_default();
            let rows = match state.content_value(&key) {
                Some(ContentValue::Invites(invites)) => invites
                    .iter()
                    .map(|invite| invite_row(invite, &names))
                    .collect(),
                _ => Vec::new(),
            };
            AdminInvitesView {
                state: state.query_load_state(&key),
                rows,
                op: state.w5a_op(&ViewKey::AdminInvites),
            }
        })
    }

    /// Makes an instance invite; returns its code. `ViewKey::AdminInvites`, op
    /// `CreateInstanceInvite`.
    pub async fn create_instance_invite(
        &self,
        draft: InstanceInviteDraft,
    ) -> Result<String, CoreError> {
        let view = OpKey::new(
            ViewKey::AdminInvites,
            AdminActionKind::CreateInstanceInvite,
            None,
        );
        let body = match invite_body(&draft, self.now_ms()) {
            Ok(body) => body,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "creating an instance invite")?;
        let result = services.backend.invite_controller_create_invite(body).await;
        let key = cache_keys::op(keys::INVITES);
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, invite: &wire::InviteResponseDto| {
                state.content_edit(&key, |value| {
                    if let ContentValue::Invites(invites) = value
                        && !invites.iter().any(|known| known.code == invite.code)
                    {
                        invites.insert(0, invite.clone());
                    }
                });
            },
            |_| {},
        )
        .map(|invite| invite.code)
    }

    /// Deletes an instance invite: gone at once, and back at its place if the server refuses.
    pub async fn delete_instance_invite(&self, code: String) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminInvites,
            AdminActionKind::DeleteInstanceInvite,
            Some(code.clone()),
        );
        let (services, epoch, change) = self.w5a_begin(&view, "deleting an instance invite")?;
        let key = cache_keys::op(keys::INVITES);
        let removed = self.write(|state, _| {
            state
                .content_edit(&key, |value| {
                    let ContentValue::Invites(invites) = value else {
                        return None;
                    };
                    let index = invites.iter().position(|invite| invite.code == code)?;
                    Some((index, invites.remove(index)))
                })
                .flatten()
        });
        let result = services
            .backend
            .invite_controller_delete_invite(code.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |_, _, _| {},
            |state| {
                let Some((index, invite)) = removed else {
                    return;
                };
                state.content_edit(&key, |value| {
                    if let ContentValue::Invites(invites) = value
                        && !invites.iter().any(|known| known.code == invite.code)
                    {
                        invites.insert(index.min(invites.len()), invite);
                    }
                });
            },
        )
    }
}
