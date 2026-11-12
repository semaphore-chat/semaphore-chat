//! Moderation: ban, kick, timeout, their lists, the moderation log, and what happens when this user
//! is the one moderated. Unit W5-B. Roles are in `roles.rs`, the permission set in
//! `permissions.rs`.
//!
//! This file is W5-B's hub: its state, its cached values, which views its queries feed, how they
//! are fetched, and what it does on a socket event. The shared files only call these.
//!
//! When this user is kicked or banned (`userKicked`/`userBanned` naming them, which can arrive
//! twice, #673) or the community is deleted, core leaves its call, drops its caches, and sends
//! `CoreEvent::CommunityRemoved` once. A timeout locks the composer through the channel
//! capabilities; the server sends nothing when it runs out, so the host calls
//! `Core::timeout_elapsed` at `ChannelPermissions::timed_out_until_ms`. Kicking is W4's
//! `Core::kick_member` (the moderation endpoint, with a reason).

use std::collections::{HashMap, HashSet};

use super::community_admin::OpKey;
use crate::cache::{CacheValue, QueryKey, keys as shared};
use crate::client::{Core, State};
use crate::model::{
    AdminActionKind, BanDuration, BanListView, BanRequest, BanRow, ModerationActionKind,
    ModerationLogRow, ModerationLogView, RemovalCause, TimeoutListView, TimeoutRequest, TimeoutRow,
    UserView, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

/// W5-B's query `_id`s. A key is `[op, community]`, or `[op, community, user/role]`, or
/// `[op, channel]` for the overrides.
pub(crate) mod keys {
    pub const MY_ROLES: &str = "rolesControllerGetMyRolesForCommunity";
    pub const ROLES: &str = "rolesControllerGetCommunityRoles";
    pub const USER_ROLES: &str = "rolesControllerGetUserRolesForCommunity";
    pub const ROLE_USERS: &str = "rolesControllerGetUsersForRole";
    pub const OVERWRITES: &str = "channelPermissionsControllerGetOverwrites";
    pub const BANS: &str = "moderationControllerGetBanList";
    pub const TIMEOUTS: &str = "moderationControllerGetTimeoutList";
    pub const TIMEOUT_STATUS: &str = "moderationControllerGetTimeoutStatus";
    pub const LOGS: &str = "moderationControllerGetModerationLogs";

    pub(crate) const ALL: [&str; 9] = [
        MY_ROLES,
        ROLES,
        USER_ROLES,
        ROLE_USERS,
        OVERWRITES,
        BANS,
        TIMEOUTS,
        TIMEOUT_STATUS,
        LOGS,
    ];
}

/// How many moderation log entries a page asks for.
pub(crate) const LOG_PAGE: i64 = 50;

/// W5-B's state: changes on their way, the removals already announced, the log's paging. Gone at
/// sign-out.
#[derive(Default)]
pub struct W5bState {
    /// The views a UI has read, by community, so a change there says which to read again.
    pub(crate) watched: HashMap<String, HashSet<ViewKey>>,
    /// The moderation log's filter, by community.
    pub(crate) log_filter: HashMap<String, ModerationActionKind>,
    /// A log page on its way, by community.
    pub(crate) log_loading: HashSet<String>,
}

/// The moderation log's pages read so far.
#[derive(Debug, Clone)]
pub struct LogPages {
    pub rows: Vec<wire::ModerationLogDto>,
    pub total: i64,
}

/// W5-B's cached responses, inside `CacheValue::W5b`.
#[derive(Debug, Clone)]
pub enum W5bValue {
    /// `roles/my/community`, or another member's roles (`roles/user/../community/..`).
    UserRoles(wire::UserRolesResponseDto),
    Roles(wire::CommunityRolesResponseDto),
    RoleUsers(Vec<wire::RoleUserDto>),
    Overwrites(wire::ChannelOverwritesDto),
    Bans(Vec<wire::CommunityBanDto>),
    Timeouts(Vec<wire::CommunityTimeoutDto>),
    TimeoutStatus(wire::TimeoutStatusResponseDto),
    Logs(LogPages),
}

pub(crate) fn key2(op: &str, a: &str, b: &str) -> QueryKey {
    QueryKey::new(&[op, a, b])
}

fn segment(key: &QueryKey, index: usize) -> String {
    key.segments.get(index).cloned().unwrap_or_default()
}

/// The view a W5-B query feeds (the one shown loading or failed).
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    let community_id = || segment(key, 1);
    Some(match key.op() {
        keys::MY_ROLES => ViewKey::CommunityPermissions {
            community_id: community_id(),
        },
        keys::ROLES => ViewKey::Roles {
            community_id: community_id(),
        },
        keys::USER_ROLES => ViewKey::ModerationTarget {
            community_id: community_id(),
            user_id: segment(key, 2),
        },
        keys::ROLE_USERS => ViewKey::RoleMembers {
            community_id: community_id(),
            role_id: segment(key, 2),
        },
        keys::OVERWRITES => ViewKey::ChannelOverwrites {
            channel_id: community_id(),
        },
        keys::BANS => ViewKey::Bans {
            community_id: community_id(),
        },
        keys::TIMEOUTS => ViewKey::Timeouts {
            community_id: community_id(),
        },
        keys::LOGS => ViewKey::ModerationLog {
            community_id: community_id(),
        },
        _ => return None,
    })
}

/// The query behind a W5-B view, the reverse of [`view_for`].
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    Some(match view {
        ViewKey::CommunityPermissions { community_id } => {
            shared::scoped(keys::MY_ROLES, community_id)
        }
        ViewKey::Roles { community_id } => shared::scoped(keys::ROLES, community_id),
        ViewKey::ModerationTarget {
            community_id,
            user_id,
        }
        | ViewKey::MemberRoles {
            community_id,
            user_id,
        } => key2(keys::USER_ROLES, community_id, user_id),
        ViewKey::RoleMembers {
            community_id,
            role_id,
        } => key2(keys::ROLE_USERS, community_id, role_id),
        ViewKey::ChannelOverwrites { channel_id } => shared::scoped(keys::OVERWRITES, channel_id),
        ViewKey::Bans { community_id } => shared::scoped(keys::BANS, community_id),
        ViewKey::Timeouts { community_id } => shared::scoped(keys::TIMEOUTS, community_id),
        ViewKey::ModerationLog { community_id } => shared::scoped(keys::LOGS, community_id),
        _ => return None,
    })
}

fn ms(at: &chrono::DateTime<chrono::Utc>) -> i64 {
    at.timestamp_millis()
}

pub(crate) fn moderation_user(user: &Option<wire::ModerationUserDto>, id: &str) -> UserView {
    match user {
        Some(user) => UserView {
            id: user.id.clone(),
            username: user.username.clone(),
            display_name: user.display_name.clone(),
            avatar_file_id: user.avatar_url.clone(),
        },
        None => UserView {
            id: id.to_owned(),
            ..UserView::default()
        },
    }
}

pub(crate) fn action_kind(action: &str) -> ModerationActionKind {
    match action {
        "BAN_USER" => ModerationActionKind::Ban,
        "UNBAN_USER" => ModerationActionKind::Unban,
        "KICK_USER" => ModerationActionKind::Kick,
        "TIMEOUT_USER" => ModerationActionKind::Timeout,
        "REMOVE_TIMEOUT" => ModerationActionKind::RemoveTimeout,
        "DELETE_MESSAGE" => ModerationActionKind::DeleteMessage,
        "PIN_MESSAGE" => ModerationActionKind::PinMessage,
        "UNPIN_MESSAGE" => ModerationActionKind::UnpinMessage,
        _ => ModerationActionKind::Unknown,
    }
}

fn action_name(kind: ModerationActionKind) -> Option<&'static str> {
    Some(match kind {
        ModerationActionKind::Ban => "BAN_USER",
        ModerationActionKind::Unban => "UNBAN_USER",
        ModerationActionKind::Kick => "KICK_USER",
        ModerationActionKind::Timeout => "TIMEOUT_USER",
        ModerationActionKind::RemoveTimeout => "REMOVE_TIMEOUT",
        ModerationActionKind::DeleteMessage => "DELETE_MESSAGE",
        ModerationActionKind::PinMessage => "PIN_MESSAGE",
        ModerationActionKind::UnpinMessage => "UNPIN_MESSAGE",
        ModerationActionKind::Unknown => return None,
    })
}

impl State {
    pub(crate) fn w5b_value(&self, key: &QueryKey) -> Option<&W5bValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W5b(value)) => Some(value),
            _ => None,
        }
    }

    /// Records that a UI shows this view of the community, so changes there reach it.
    pub(crate) fn w5b_watch(&mut self, community_id: &str, view: ViewKey) {
        self.w5b
            .watched
            .entry(community_id.to_owned())
            .or_default()
            .insert(view);
    }

    /// Every watched view of the community should be read again: they all hang on its roles.
    pub(crate) fn w5b_community_changed(&mut self, community_id: &str) {
        let views: Vec<ViewKey> = self
            .w5b
            .watched
            .get(community_id)
            .map(|views| views.iter().cloned().collect())
            .unwrap_or_default();
        for view in views {
            self.view_changed(view);
        }
        self.view_changed(ViewKey::CommunityPermissions {
            community_id: community_id.to_owned(),
        });
    }

    /// A W5-B query's data changed: say which views to read again. False when it isn't W5-B's.
    pub(crate) fn w5b_query_changed(&mut self, key: &QueryKey) -> bool {
        if !keys::ALL.contains(&key.op()) {
            return false;
        }
        let first = segment(key, 1);
        let community_id = if key.op() == keys::OVERWRITES {
            self.view_changed(ViewKey::ChannelOverwrites {
                channel_id: first.clone(),
            });
            self.community_of_channel(&first)
        } else {
            Some(first)
        };
        if let Some(view) = view_for(key) {
            self.view_changed(view);
        }
        if let Some(community_id) = community_id {
            self.w5b_community_changed(&community_id);
        }
        true
    }

    /// Everything of this community core holds, gone: this user lost it.
    fn w5b_drop_community(&mut self, community_id: &str) {
        for op in [
            shared::CHANNELS,
            shared::CAPABILITIES,
            shared::MEMBERS,
            shared::MEMBER_SEARCH,
            shared::MENTIONABLE,
            shared::EMOJIS,
            shared::SOUNDBOARD,
        ]
        .into_iter()
        .chain(keys::ALL)
        {
            self.cache.remove_prefix(&shared::scoped(op, community_id));
        }
        let communities = shared::op(shared::COMMUNITIES);
        if let Some(list) = self.cache.communities_mut(&communities) {
            list.retain(|community| community.id != community_id);
        }
        self.note_direct_update(&communities);
        self.invalidate(&communities);
        self.w5b.watched.remove(community_id);
        self.view_changed(ViewKey::Communities);
        self.view_changed(ViewKey::Rail);
    }

    /// This user lost the community (kicked or banned): W5-A's `w5a_drop_community` leaves a call
    /// there, drops the shared caches and announces it once, however many times the server says
    /// so (#673); W5-B's own caches go after it.
    fn w5b_removed(&mut self, community_id: &str, cause: RemovalCause) {
        self.w5a_drop_community(community_id, Some(cause));
        self.w5b_drop_community(community_id);
    }

    /// Another member was moderated: the lists and the log may have changed.
    fn w5b_moderated(&mut self, community_id: &str, user_id: &str) {
        for op in [keys::BANS, keys::TIMEOUTS, keys::LOGS] {
            self.invalidate(&shared::scoped(op, community_id));
        }
        self.invalidate(&key2(keys::USER_ROLES, community_id, user_id));
        self.invalidate(&key2(keys::TIMEOUT_STATUS, community_id, user_id));
    }

    /// W5-B's handling of a socket event, before the shared rules (role and moderation events,
    /// `communityDeleted`).
    pub(crate) fn w5b_event(&mut self, event: &ServerEvent, _now: u64) {
        let me = self.me_id().to_owned();
        match event {
            ServerEvent::UserKicked(event) if event.user_id == me => {
                self.w5b_removed(
                    &event.community_id,
                    RemovalCause::Kicked {
                        reason: event.reason.clone().filter(|r| !r.is_empty()),
                    },
                );
            }
            ServerEvent::UserBanned(event) if event.user_id == me => {
                let until_ms = event.expires_at.map(|at| at.timestamp_millis());
                self.w5b_removed(
                    &event.community_id,
                    RemovalCause::Banned {
                        reason: event.reason.clone().filter(|r| !r.is_empty()),
                        until_ms,
                    },
                );
            }
            // W5-A's hub announces it (and not for a deletion this core made); W5-B drops its own.
            ServerEvent::CommunityDeleted(event) => {
                self.w5b_drop_community(&event.community_id);
            }
            ServerEvent::UserKicked(event) => {
                self.w5b_moderated(&event.community_id, &event.user_id);
            }
            ServerEvent::UserBanned(event) => {
                self.w5b_moderated(&event.community_id, &event.user_id);
            }
            ServerEvent::UserTimedOut(event) => {
                self.w5b_moderated(&event.community_id, &event.user_id);
            }
            ServerEvent::TimeoutRemoved(event) => {
                self.w5b_moderated(&event.community_id, &event.user_id);
            }
            ServerEvent::RoleAssigned(event) => {
                self.invalidate(&key2(keys::USER_ROLES, &event.community_id, &event.user_id));
                self.invalidate(&shared::scoped(keys::ROLE_USERS, &event.community_id));
            }
            ServerEvent::RoleUnassigned(event) => {
                self.invalidate(&key2(keys::USER_ROLES, &event.community_id, &event.user_id));
                self.invalidate(&shared::scoped(keys::ROLE_USERS, &event.community_id));
            }
            ServerEvent::RoleCreated(event) => {
                self.invalidate(&shared::scoped(keys::ROLES, &event.community_id));
            }
            ServerEvent::RoleUpdated(event) => {
                // A role's actions or position: everyone's rank and actions may have moved.
                self.invalidate(&shared::scoped(keys::USER_ROLES, &event.community_id));
                self.invalidate(&shared::scoped(keys::ROLE_USERS, &event.community_id));
            }
            ServerEvent::RoleDeleted(event) => {
                self.invalidate(&shared::scoped(keys::USER_ROLES, &event.community_id));
                self.invalidate(&shared::scoped(keys::ROLE_USERS, &event.community_id));
            }
            _ => {}
        }
    }
}

impl Core {
    /// Fetches a W5-B query, or `None` when the key isn't W5-B's.
    pub(crate) async fn w5b_fetch(&self, key: &QueryKey) -> Option<Result<CacheValue, CoreError>> {
        if !keys::ALL.contains(&key.op()) {
            return None;
        }
        let Some(services) = self.services().cloned() else {
            return Some(Err(unavailable("the backend")));
        };
        let backend = &services.backend;
        let (a, b) = (segment(key, 1), segment(key, 2));
        let value = match key.op() {
            keys::MY_ROLES => backend
                .roles_controller_get_my_roles_for_community(a)
                .await
                .map(W5bValue::UserRoles),
            keys::ROLES => backend
                .roles_controller_get_community_roles(a)
                .await
                .map(W5bValue::Roles),
            keys::USER_ROLES => backend
                .roles_controller_get_user_roles_for_community(b, a)
                .await
                .map(W5bValue::UserRoles),
            keys::ROLE_USERS => backend
                .roles_controller_get_users_for_role(a, b)
                .await
                .map(W5bValue::RoleUsers),
            keys::OVERWRITES => backend
                .channel_permissions_controller_get_overwrites(a)
                .await
                .map(W5bValue::Overwrites),
            keys::BANS => backend
                .moderation_controller_get_ban_list(a)
                .await
                .map(W5bValue::Bans),
            keys::TIMEOUTS => backend
                .moderation_controller_get_timeout_list(a)
                .await
                .map(W5bValue::Timeouts),
            keys::TIMEOUT_STATUS => backend
                .moderation_controller_get_timeout_status(a, b)
                .await
                .map(W5bValue::TimeoutStatus),
            keys::LOGS => {
                let filter = self.read(|state| {
                    state
                        .w5b
                        .log_filter
                        .get(&a)
                        .and_then(|kind| action_name(*kind))
                        .map(str::to_owned)
                });
                backend
                    .moderation_controller_get_moderation_logs(a, filter, Some(LOG_PAGE), Some(0))
                    .await
                    .map(|page| {
                        W5bValue::Logs(LogPages {
                            rows: page.logs,
                            total: page.total,
                        })
                    })
            }
            _ => return None,
        };
        Some(
            value
                .map(CacheValue::W5b)
                .map_err(|error| self.backend_failed(error)),
        )
    }

    fn moderation_refresh(community_id: &str, user_id: &str) -> Vec<QueryKey> {
        vec![
            shared::scoped(keys::BANS, community_id),
            shared::scoped(keys::TIMEOUTS, community_id),
            shared::scoped(keys::LOGS, community_id),
            key2(keys::USER_ROLES, community_id, user_id),
            key2(keys::TIMEOUT_STATUS, community_id, user_id),
            shared::scoped(shared::MEMBERS, community_id),
        ]
    }

    /// The member's moderation menu's op for this action.
    pub(crate) fn target_op(community_id: &str, user_id: &str, kind: AdminActionKind) -> OpKey {
        OpKey::new(
            ViewKey::ModerationTarget {
                community_id: community_id.to_owned(),
                user_id: user_id.to_owned(),
            },
            kind,
            Some(user_id.to_owned()),
        )
    }

    fn list_op(view: ViewKey, user_id: &str, kind: AdminActionKind) -> OpKey {
        OpKey::new(view, kind, Some(user_id.to_owned()))
    }

    /// Shown on the member's menu (`AdminActionKind::Ban`).
    pub async fn ban_member(
        &self,
        community_id: String,
        user_id: String,
        request: BanRequest,
    ) -> Result<(), CoreError> {
        let now_ms = self.write(|_, now| now);
        let expires_at = match request.duration {
            BanDuration::Permanent => None,
            BanDuration::Seconds { seconds } => {
                chrono::DateTime::from_timestamp_millis(now_ms as i64 + i64::from(seconds) * 1000)
                    .map(|at| at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            }
        };
        let body = wire::ModerationBanUserDto {
            expires_at,
            reason: request.reason.filter(|r| !r.trim().is_empty()),
        };
        let (id, user) = (community_id.clone(), user_id.clone());
        self.w5b_change(
            &[Self::target_op(
                &community_id,
                &user_id,
                AdminActionKind::Ban,
            )],
            "banning a member",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .moderation_controller_ban_user(id, user, body)
                    .await
            },
            &Self::moderation_refresh(&community_id, &user_id),
        )
        .await
        .map(|_| ())
    }

    /// Shown on the ban list's row (`AdminActionKind::Unban`).
    pub async fn unban_member(
        &self,
        community_id: String,
        user_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        let body = wire::UnbanUserDto {
            reason: reason.filter(|r| !r.trim().is_empty()),
        };
        let view = ViewKey::Bans {
            community_id: community_id.clone(),
        };
        let (id, user) = (community_id.clone(), user_id.clone());
        self.w5b_change(
            &[Self::list_op(view, &user_id, AdminActionKind::Unban)],
            "lifting a ban",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .moderation_controller_unban_user(id, user, body)
                    .await
            },
            &Self::moderation_refresh(&community_id, &user_id),
        )
        .await
        .map(|_| ())
    }

    /// Shown on the member's menu (`AdminActionKind::Timeout`).
    pub async fn timeout_member(
        &self,
        community_id: String,
        user_id: String,
        request: TimeoutRequest,
    ) -> Result<(), CoreError> {
        let body = wire::TimeoutUserDto {
            duration_seconds: i64::from(request.seconds),
            reason: request.reason.filter(|r| !r.trim().is_empty()),
        };
        let (id, user) = (community_id.clone(), user_id.clone());
        self.w5b_change(
            &[Self::target_op(
                &community_id,
                &user_id,
                AdminActionKind::Timeout,
            )],
            "timing out a member",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .moderation_controller_timeout_user(id, user, body)
                    .await
            },
            &Self::moderation_refresh(&community_id, &user_id),
        )
        .await
        .map(|_| ())
    }

    /// Shown on both the timeout list's row and the member's menu
    /// (`AdminActionKind::RemoveTimeout`).
    pub async fn remove_timeout(
        &self,
        community_id: String,
        user_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        let body = wire::RemoveTimeoutDto {
            reason: reason.filter(|r| !r.trim().is_empty()),
        };
        let list = ViewKey::Timeouts {
            community_id: community_id.clone(),
        };
        let (id, user) = (community_id.clone(), user_id.clone());
        self.w5b_change(
            &[
                Self::list_op(list, &user_id, AdminActionKind::RemoveTimeout),
                Self::target_op(&community_id, &user_id, AdminActionKind::RemoveTimeout),
            ],
            "lifting a timeout",
            Ok(()),
            async move |services| {
                services
                    .backend
                    .moderation_controller_remove_timeout(id, user, body)
                    .await
            },
            &Self::moderation_refresh(&community_id, &user_id),
        )
        .await
        .map(|_| ())
    }

    /// Active bans (`ViewKey::Bans`), newest first. Each row says whether this user may lift it.
    pub fn bans(&self, community_id: String) -> BanListView {
        self.write(|state, _| {
            let key = shared::scoped(keys::BANS, &community_id);
            state.w5b_watch(
                &community_id,
                ViewKey::Bans {
                    community_id: community_id.clone(),
                },
            );
            state.ensure_query(key.clone());
            let rows: Vec<wire::CommunityBanDto> = match state.w5b_value(&key) {
                Some(W5bValue::Bans(rows)) => rows.clone(),
                _ => Vec::new(),
            };
            let bans = rows
                .iter()
                .map(|ban| BanRow {
                    user: moderation_user(&ban.user, &ban.user_id),
                    can_lift: state.w5b_may_lift(
                        &community_id,
                        &ban.user_id,
                        ban.moderator_id.as_deref(),
                        "UNBAN_USER",
                    ),
                    moderator: moderation_user(
                        &ban.moderator,
                        ban.moderator_id.as_deref().unwrap_or_default(),
                    ),
                    reason: ban.reason.clone().filter(|r| !r.is_empty()),
                    created_at_ms: ms(&ban.created_at),
                    expires_at_ms: ban.expires_at.as_ref().map(ms),
                })
                .collect();
            BanListView {
                state: state.load_of(&key),
                op: state.w5a_op(&ViewKey::Bans {
                    community_id: community_id.clone(),
                }),
                community_id,
                bans,
            }
        })
    }

    /// Active timeouts (`ViewKey::Timeouts`), newest first.
    pub fn timeouts(&self, community_id: String) -> TimeoutListView {
        self.write(|state, _| {
            let key = shared::scoped(keys::TIMEOUTS, &community_id);
            state.w5b_watch(
                &community_id,
                ViewKey::Timeouts {
                    community_id: community_id.clone(),
                },
            );
            state.ensure_query(key.clone());
            let rows: Vec<wire::CommunityTimeoutDto> = match state.w5b_value(&key) {
                Some(W5bValue::Timeouts(rows)) => rows.clone(),
                _ => Vec::new(),
            };
            let timeouts = rows
                .iter()
                .map(|timeout| TimeoutRow {
                    user: moderation_user(&timeout.user, &timeout.user_id),
                    can_lift: state.w5b_may_lift(
                        &community_id,
                        &timeout.user_id,
                        timeout.moderator_id.as_deref(),
                        "TIMEOUT_USER",
                    ),
                    moderator: moderation_user(
                        &timeout.moderator,
                        timeout.moderator_id.as_deref().unwrap_or_default(),
                    ),
                    reason: timeout.reason.clone().filter(|r| !r.is_empty()),
                    created_at_ms: ms(&timeout.created_at),
                    expires_at_ms: ms(&timeout.expires_at),
                })
                .collect();
            TimeoutListView {
                state: state.load_of(&key),
                op: state.w5a_op(&ViewKey::Timeouts {
                    community_id: community_id.clone(),
                }),
                community_id,
                timeouts,
            }
        })
    }

    /// The moderation log's pages read so far (`ViewKey::ModerationLog`), newest first.
    pub fn moderation_log(&self, community_id: String) -> ModerationLogView {
        self.write(|state, _| {
            let key = shared::scoped(keys::LOGS, &community_id);
            state.w5b_watch(
                &community_id,
                ViewKey::ModerationLog {
                    community_id: community_id.clone(),
                },
            );
            state.ensure_query(key.clone());
            let (rows, total) = match state.w5b_value(&key) {
                Some(W5bValue::Logs(pages)) => (pages.rows.clone(), pages.total),
                _ => (Vec::new(), 0),
            };
            let rows = rows
                .iter()
                .map(|entry| ModerationLogRow {
                    id: entry.id.clone(),
                    action: action_kind(&entry.action.as_str()),
                    moderator: entry
                        .moderator_id
                        .as_deref()
                        .map(|id| moderation_user(&entry.moderator, id)),
                    target: entry
                        .target_user_id
                        .as_deref()
                        .map(|id| moderation_user(&entry.target_user, id)),
                    reason: entry.reason.clone().filter(|r| !r.is_empty()),
                    created_at_ms: ms(&entry.created_at),
                    duration_seconds: entry
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("durationSeconds"))
                        .and_then(serde_json::Value::as_u64)
                        .map(|seconds| seconds as u32),
                    // Not in the contract yet (`ModerationLogDto` lacks `targetMessageId`).
                    target_message_id: entry
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("messageId"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned),
                })
                .collect();
            ModerationLogView {
                state: state.load_of(&key),
                filter: state.w5b.log_filter.get(&community_id).copied(),
                loading_more: state.w5b.log_loading.contains(&community_id),
                community_id,
                rows,
                total: total.max(0) as u32,
            }
        })
    }

    /// Shows only one kind of entry, or all; reads from the first page again.
    pub fn set_moderation_log_filter(
        &self,
        community_id: String,
        filter: Option<ModerationActionKind>,
    ) {
        self.write(|state, _| {
            match filter.filter(|kind| *kind != ModerationActionKind::Unknown) {
                Some(kind) => state.w5b.log_filter.insert(community_id.clone(), kind),
                None => state.w5b.log_filter.remove(&community_id),
            };
            let key = shared::scoped(keys::LOGS, &community_id);
            state.cache.remove_prefix(&key);
            state.failed_queries.remove(&key);
            state.ensure_query(key);
            state.view_changed(ViewKey::ModerationLog { community_id });
        });
    }

    /// Reads the log's next page. Nothing to do when all are read, or while a page is on its way.
    pub async fn more_moderation_log(&self, community_id: String) -> Result<(), CoreError> {
        let (services, epoch) = self.begin("the moderation log")?;
        let key = shared::scoped(keys::LOGS, &community_id);
        let start = self.write(|state, _| {
            if state.w5b.log_loading.contains(&community_id) {
                return None;
            }
            let Some(W5bValue::Logs(pages)) = state.w5b_value(&key) else {
                return None;
            };
            if pages.rows.len() as i64 >= pages.total {
                return None;
            }
            let offset = pages.rows.len() as i64;
            let filter = state
                .w5b
                .log_filter
                .get(&community_id)
                .and_then(|kind| action_name(*kind))
                .map(str::to_owned);
            state.w5b.log_loading.insert(community_id.clone());
            state.view_changed(ViewKey::ModerationLog {
                community_id: community_id.clone(),
            });
            Some((offset, filter))
        });
        let Some((offset, filter)) = start else {
            return Ok(());
        };
        let page = services
            .backend
            .moderation_controller_get_moderation_logs(
                community_id.clone(),
                filter,
                Some(LOG_PAGE),
                Some(offset),
            )
            .await;
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            state.w5b.log_loading.remove(&community_id);
            state.view_changed(ViewKey::ModerationLog {
                community_id: community_id.clone(),
            });
            if let (Ok(page), Some(CacheValue::W5b(W5bValue::Logs(pages)))) = (
                &page,
                state.cache.get_mut(&key).map(|entry| &mut entry.value),
            ) {
                // A page that overlaps what is shown (an entry arrived meanwhile) adds what's new.
                for row in &page.logs {
                    if !pages.rows.iter().any(|known| known.id == row.id) {
                        pages.rows.push(row.clone());
                    }
                }
                pages.total = page.total;
            }
        });
        page.map(|_| ()).map_err(|error| self.backend_failed(error))
    }

    /// The host's call at `ChannelPermissions::timed_out_until_ms`: the server says nothing when a
    /// timeout runs out, so core reads the community's capabilities again.
    pub fn timeout_elapsed(&self, community_id: String) {
        self.write(|state, _| {
            state.invalidate(&shared::scoped(shared::CAPABILITIES, &community_id));
            state.invalidate(&shared::scoped(keys::TIMEOUT_STATUS, &community_id));
            state.invalidate(&shared::scoped(keys::TIMEOUTS, &community_id));
        });
    }
}
