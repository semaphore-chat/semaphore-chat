//! W6-B: the users list and one user: owner role, ban, password, delete and a user's instance roles.
//!
//! This file is W6-B's own: its state, its cached values (`UsersValue`, inside
//! `CacheValue::W6(W6Value::Users(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`). A change is refused
//! before it is sent when `user_actions` says no, in the backend's words. Ban and unban show at
//! once and go back if the server refuses; the other changes land with the server's answer.

use std::collections::HashSet;

use crate::cache::keys as cache_keys;
use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
use crate::commands::community_admin::OpKey;
use crate::commands::instance_admin::W6Value;
use crate::model::{
    AdminActionKind, AdminNotAllowed, AdminUserActions, AdminUserQuery, AdminUserRolesView,
    AdminUserRow, AdminUserView, AdminUsersView, InstanceAdminCaps, InstanceRoleRef, UserView,
    ViewKey,
};
use crate::platform::CoreError;
use semaphore_wire::enums::{BooleanString, InstanceRole};
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

/// How many users the list asks for at a time (the web's first page).
const PAGE_LIMIT: u64 = 50;

/// W6-B's query ids: the web's `operationId`s.
pub mod keys {
    pub const USERS: &str = "userControllerFindAllUsersAdmin";
    pub const USER: &str = "userControllerGetUserByIdAdmin";
    pub const USER_ROLES: &str = "rolesControllerGetUserInstanceRoles";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[USERS, USER, USER_ROLES];
}
use keys as k;

/// W6-B's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct UsersState {
    /// Lists whose next page is on its way.
    loading_more: HashSet<QueryKey>,
}

/// W6-B's cached responses.
#[derive(Debug, Clone)]
pub enum UsersValue {
    /// A page of the list, and the token for the next one.
    Users {
        rows: Vec<wire::AdminUserEntity>,
        next: Option<String>,
    },
    /// One user. Boxed: the entity is much larger than the other variants, and clippy's
    /// `large_enum_variant` would fire on the hub's `W6Value` (which this lane doesn't edit).
    User(Box<wire::AdminUserEntity>),
    UserRoles(wire::UserRolesResponseDto),
}

/// The view a W6-B query feeds.
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    Some(match key.op() {
        k::USERS => ViewKey::AdminUsers {
            query: query_of(key),
        },
        k::USER => ViewKey::AdminUser {
            user_id: key.segments.get(1).cloned().unwrap_or_default(),
        },
        k::USER_ROLES => ViewKey::AdminUserRoles {
            user_id: key.segments.get(1).cloned().unwrap_or_default(),
        },
        _ => return None,
    })
}

/// The query a W6-B view reads.
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    Some(match view {
        ViewKey::AdminUsers { query } => users_key(query),
        ViewKey::AdminUser { user_id } => cache_keys::scoped(k::USER, user_id),
        ViewKey::AdminUserRoles { user_id } => cache_keys::scoped(k::USER_ROLES, user_id),
        _ => return None,
    })
}

/// `None` and `Some(false)` are different filters, so each is its own segment.
fn flag(value: Option<bool>) -> &'static str {
    match value {
        Some(true) => "true",
        Some(false) => "false",
        None => "-",
    }
}

fn flag_of(segment: Option<&String>) -> Option<bool> {
    match segment.map(String::as_str) {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    }
}

fn users_key(query: &AdminUserQuery) -> QueryKey {
    QueryKey::new(&[
        k::USERS,
        &query.search,
        flag(query.banned),
        flag(query.owners),
    ])
}

/// The filters a list key was made from.
fn query_of(key: &QueryKey) -> AdminUserQuery {
    AdminUserQuery {
        search: key.segments.get(1).cloned().unwrap_or_default(),
        banned: flag_of(key.segments.get(2)),
        owners: flag_of(key.segments.get(3)),
    }
}

fn banned_param(banned: Option<bool>) -> Option<BooleanString> {
    match banned {
        Some(true) => Some(BooleanString::True),
        Some(false) => Some(BooleanString::False),
        None => None,
    }
}

/// `Some(true)` is the owners' list; `Some(false)` everyone else.
fn role_param(owners: Option<bool>) -> Option<InstanceRole> {
    match owners {
        Some(true) => Some(InstanceRole::Owner),
        Some(false) => Some(InstanceRole::User),
        None => None,
    }
}

fn search_param(search: &str) -> Option<String> {
    (!search.is_empty()).then(|| search.to_owned())
}

/// What `user_actions` knows about the signed-in user.
#[derive(Debug, Clone, Default)]
pub struct Actor {
    pub id: String,
    pub caps: InstanceAdminCaps,
    /// My instance actions, as wire names.
    pub held: Vec<String>,
}

/// What `user_actions` knows about the user on the row.
#[derive(Debug, Clone, Default)]
pub struct Target {
    pub id: String,
    pub is_owner: bool,
    pub banned: bool,
    /// Their instance actions, once `admin_user_roles` has read them.
    pub actions: Option<Vec<String>>,
}

/// Below full authority, a user can only act on someone holding instance actions they hold
/// themselves. Unknown target actions never block: the server decides.
fn ranked(actor: &Actor, me: bool, target: &Target) -> bool {
    !actor.caps.full_authority
        && !me
        && target
            .actions
            .as_ref()
            .is_some_and(|actions| actions.iter().any(|action| !actor.held.contains(action)))
}

/// Per action, whether it's offered and why not.
pub fn user_actions(actor: &Actor, target: &Target) -> AdminUserActions {
    let me = actor.id == target.id;
    let rank = ranked(actor, me, target);
    let moderation = || {
        if !actor.caps.users_ban {
            Some(AdminNotAllowed::NoPermission)
        } else if me {
            Some(AdminNotAllowed::Myself)
        } else if target.is_owner {
            Some(AdminNotAllowed::Owner)
        } else if rank {
            Some(AdminNotAllowed::Rank)
        } else {
            None
        }
    };
    AdminUserActions {
        ban: moderation(),
        unban: moderation(),
        delete: if !actor.caps.users_delete {
            Some(AdminNotAllowed::NoPermission)
        } else if me {
            Some(AdminNotAllowed::Myself)
        } else if target.is_owner {
            Some(AdminNotAllowed::Owner)
        } else if rank {
            Some(AdminNotAllowed::Rank)
        } else {
            None
        },
        reset_password: if !actor.caps.users_update {
            Some(AdminNotAllowed::NoPermission)
        } else if target.is_owner && !me && !actor.caps.is_owner {
            Some(AdminNotAllowed::Owner)
        } else if rank {
            Some(AdminNotAllowed::Rank)
        } else {
            None
        },
        set_owner: if !actor.caps.users_update {
            Some(AdminNotAllowed::NoPermission)
        } else if !actor.caps.is_owner {
            Some(AdminNotAllowed::OnlyOwner)
        } else {
            None
        },
        edit_roles: (!actor.caps.users_update).then_some(AdminNotAllowed::NoPermission),
        set_quota: (!actor.caps.storage).then_some(AdminNotAllowed::NoPermission),
    }
}

/// Why a change isn't offered, in the backend's words.
fn refusal(reason: AdminNotAllowed) -> CoreError {
    CoreError::Failed {
        message: match reason {
            AdminNotAllowed::Myself => "That's you",
            AdminNotAllowed::Owner => "That's an instance owner",
            AdminNotAllowed::OnlyOwner => {
                "Only an instance owner can grant or remove the owner role"
            }
            AdminNotAllowed::LastOwner => {
                "Cannot demote the last owner. Promote another user first."
            }
            AdminNotAllowed::Rank => "They hold permissions you don't have",
            AdminNotAllowed::NoPermission => "You don't have permission to do that",
        }
        .into(),
    }
}

impl State {
    /// The signed-in user's authority, for `user_actions`.
    fn admin_actor(&self) -> Actor {
        Actor {
            id: self.me_id().to_owned(),
            caps: self.instance_admin_caps(),
            held: self
                .instance_authority()
                .map(|authority| authority.held)
                .unwrap_or_default(),
        }
    }

    /// A user's instance actions, once `admin_user_roles` has read them.
    fn admin_user_actions(&self, user_id: &str) -> Option<Vec<String>> {
        let Some(UsersValue::UserRoles(roles)) =
            self.users_value(&cache_keys::scoped(k::USER_ROLES, user_id))
        else {
            return None;
        };
        Some(
            roles
                .roles
                .iter()
                .flat_map(|role| {
                    role.actions
                        .iter()
                        .map(|action| action.as_str().into_owned())
                })
                .collect(),
        )
    }

    fn users_value(&self, key: &QueryKey) -> Option<&UsersValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W6(W6Value::Users(value))) => Some(value),
            _ => None,
        }
    }

    /// A user as the cache has them: the one-user read first, then any list.
    fn cached_admin_user(&self, user_id: &str) -> Option<wire::AdminUserEntity> {
        if let Some(UsersValue::User(user)) =
            self.users_value(&cache_keys::scoped(k::USER, user_id))
        {
            return Some((**user).clone());
        }
        self.cache
            .keys_with_op(k::USERS)
            .into_iter()
            .find_map(|key| match self.users_value(&key) {
                Some(UsersValue::Users { rows, .. }) => {
                    rows.iter().find(|row| row.id == user_id).cloned()
                }
                _ => None,
            })
    }

    /// What a change may do to this user: what the cache says, or the least it can refuse.
    fn admin_target(&self, user_id: &str) -> Target {
        let user = self.cached_admin_user(user_id);
        Target {
            id: user_id.to_owned(),
            is_owner: user
                .as_ref()
                .is_some_and(|user| user.role == InstanceRole::Owner),
            banned: user.is_some_and(|user| user.banned),
            actions: self.admin_user_actions(user_id),
        }
    }

    /// One row of the list.
    fn admin_row(&self, user: &wire::AdminUserEntity) -> AdminUserRow {
        let target = Target {
            id: user.id.clone(),
            is_owner: user.role == InstanceRole::Owner,
            banned: user.banned,
            actions: self.admin_user_actions(&user.id),
        };
        AdminUserRow {
            user: UserView {
                id: user.id.clone(),
                username: user.username.clone(),
                display_name: user.display_name.clone(),
                avatar_file_id: user.avatar_url.clone(),
            },
            email: user.email.clone(),
            is_owner: target.is_owner,
            banned: user.banned,
            banned_at_ms: user.banned_at.map(|at| at.timestamp_millis()),
            created_at_ms: user.created_at.timestamp_millis(),
            last_seen_ms: user.last_seen.map(|at| at.timestamp_millis()),
            storage_used_bytes: user.storage_used_bytes.max(0) as u64,
            storage_quota_bytes: user.storage_quota_bytes.max(0) as u64,
            actions: user_actions(&self.admin_actor(), &target),
        }
    }

    /// Edits a cached W6-B value, keeping when it was read and whether it's stale.
    fn users_edit<R>(
        &mut self,
        key: &QueryKey,
        change: impl FnOnce(&mut UsersValue) -> R,
    ) -> Option<R> {
        let entry = self.cache.get(key)?.clone();
        let CacheValue::W6(W6Value::Users(mut value)) = entry.value else {
            return None;
        };
        let result = change(&mut value);
        self.cache.set(
            key.clone(),
            CacheValue::W6(W6Value::Users(value)),
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

    /// The server's answer for a user, in the one-user read and in every cached list.
    fn put_admin_user(&mut self, user: &wire::AdminUserEntity) {
        self.users_edit(&cache_keys::scoped(k::USER, &user.id), |value| {
            *value = UsersValue::User(Box::new(user.clone()));
        });
        for key in self.cache.keys_with_op(k::USERS) {
            self.users_edit(&key, |value| {
                if let UsersValue::Users { rows, .. } = value
                    && let Some(row) = rows.iter_mut().find(|row| row.id == user.id)
                {
                    *row = user.clone();
                }
            });
        }
    }

    /// `banned` on every cached row of this user, at once.
    fn set_admin_user_banned(&mut self, user_id: &str, banned: bool) {
        self.users_edit(&cache_keys::scoped(k::USER, user_id), |value| {
            if let UsersValue::User(user) = value {
                user.banned = banned;
            }
        });
        for key in self.cache.keys_with_op(k::USERS) {
            self.users_edit(&key, |value| {
                if let UsersValue::Users { rows, .. } = value
                    && let Some(row) = rows.iter_mut().find(|row| row.id == user_id)
                {
                    row.banned = banned;
                }
            });
        }
    }

    /// Puts `old` back where `written` is still the value: a refusal undoes only its own write.
    fn restore_admin_user_banned(&mut self, user_id: &str, written: bool, old: bool) {
        let restore = |user: &mut wire::AdminUserEntity| {
            if user.banned == written {
                user.banned = old;
            }
        };
        self.users_edit(&cache_keys::scoped(k::USER, user_id), |value| {
            if let UsersValue::User(user) = value {
                restore(user);
            }
        });
        for key in self.cache.keys_with_op(k::USERS) {
            self.users_edit(&key, |value| {
                if let UsersValue::Users { rows, .. } = value
                    && let Some(row) = rows.iter_mut().find(|row| row.id == user_id)
                {
                    restore(row);
                }
            });
        }
    }

    /// The user left every list, and its own read.
    fn drop_admin_user(&mut self, user_id: &str) {
        for key in self.cache.keys_with_op(k::USERS) {
            self.users_edit(&key, |value| {
                if let UsersValue::Users { rows, .. } = value {
                    rows.retain(|row| row.id != user_id);
                }
            });
        }
        self.cache
            .remove_prefix(&cache_keys::scoped(k::USER, user_id));
        self.view_changed(ViewKey::AdminUser {
            user_id: user_id.to_owned(),
        });
    }

    /// A W6-B query's data changed: say which views to read again. False when it isn't
    /// W6-B's.
    pub(crate) fn w6_users_query_changed(&mut self, key: &QueryKey) -> bool {
        let Some(view) = view_for(key) else {
            return false;
        };
        self.view_changed(view);
        true
    }

    /// One socket event, before the shared rules: none of this lane's data has one.
    pub(crate) fn w6_users_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-B query; `None` when it isn't one.
    pub(crate) async fn w6_users_fetch(
        &self,
        key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        match key.op() {
            k::USERS | k::USER | k::USER_ROLES => {}
            _ => return None,
        }
        let backend = match self.services() {
            Some(services) => &services.backend,
            None => return Some(Err(crate::resync::unavailable("the backend"))),
        };
        let failed = |error| self.backend_failed(error);
        let value = async {
            Ok(match key.op() {
                k::USERS => {
                    let query = query_of(key);
                    let page = backend
                        .user_controller_find_all_users_admin(
                            banned_param(query.banned),
                            None,
                            std::num::NonZeroU64::new(PAGE_LIMIT),
                            role_param(query.owners),
                            search_param(&query.search),
                        )
                        .await
                        .map_err(failed)?;
                    UsersValue::Users {
                        rows: page.users,
                        next: page.continuation_token,
                    }
                }
                k::USER => {
                    let id = key.segments.get(1).cloned().unwrap_or_default();
                    UsersValue::User(Box::new(
                        backend
                            .user_controller_get_user_by_id_admin(id)
                            .await
                            .map_err(failed)?,
                    ))
                }
                _ => {
                    let id = key.segments.get(1).cloned().unwrap_or_default();
                    UsersValue::UserRoles(
                        backend
                            .roles_controller_get_user_instance_roles(id)
                            .await
                            .map_err(failed)?,
                    )
                }
            })
        }
        .await;
        Some(value.map(|value| CacheValue::W6(W6Value::Users(value))))
    }

    /// Refuses a change `user_actions` says no to, before anything is sent.
    fn assert_user_action(
        &self,
        view: &OpKey,
        user_id: &str,
        pick: impl Fn(&AdminUserActions) -> Option<AdminNotAllowed>,
    ) -> Result<(), CoreError> {
        let denied = self.read(|state| {
            let actions = user_actions(&state.admin_actor(), &state.admin_target(user_id));
            pick(&actions)
        });
        match denied {
            Some(reason) => self.w5a_refuse(view, refusal(reason)),
            None => Ok(()),
        }
    }

    pub fn admin_users(&self, query: AdminUserQuery) -> AdminUsersView {
        self.write(|state, now| {
            let key = users_key(&query);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::AdminUsers {
                query: query.clone(),
            };
            let (rows, more) = match state.users_value(&key) {
                Some(UsersValue::Users { rows, next }) => (
                    rows.iter().map(|row| state.admin_row(row)).collect(),
                    next.is_some(),
                ),
                _ => (Vec::new(), false),
            };
            AdminUsersView {
                state: state.query_load_state(&key),
                rows,
                more,
                loading_more: state.w6.users.loading_more.contains(&key),
                op: state.w5a_op(&view),
                query,
            }
        })
    }

    /// The next page of `admin_users(query)`, when `more`.
    pub async fn load_more_admin_users(&self, query: AdminUserQuery) -> Result<(), CoreError> {
        let key = users_key(&query);
        let view = ViewKey::AdminUsers {
            query: query.clone(),
        };
        let (services, epoch) = self.begin("the users list")?;
        let start = self.write(|state, _| {
            if state.w6.users.loading_more.contains(&key) {
                return None;
            }
            let Some(UsersValue::Users {
                next: Some(next), ..
            }) = state.users_value(&key)
            else {
                return None;
            };
            let next = next.clone();
            state.w6.users.loading_more.insert(key.clone());
            state.view_changed(view.clone());
            Some(next)
        });
        let Some(next) = start else {
            return Ok(());
        };
        let page = services
            .backend
            .user_controller_find_all_users_admin(
                banned_param(query.banned),
                Some(next),
                std::num::NonZeroU64::new(PAGE_LIMIT),
                role_param(query.owners),
                search_param(&query.search),
            )
            .await;
        let page = match page {
            Ok(page) => page,
            Err(error) => {
                self.write(|state, _| {
                    if state.session_epoch == epoch {
                        state.w6.users.loading_more.remove(&key);
                        state.view_changed(view.clone());
                    }
                });
                return Err(self.backend_failed(error));
            }
        };
        self.write(|state, _| {
            if state.session_epoch != epoch {
                return;
            }
            state.w6.users.loading_more.remove(&key);
            state.users_edit(&key, |value| {
                if let UsersValue::Users { rows, next } = value {
                    for row in &page.users {
                        if !rows.iter().any(|known| known.id == row.id) {
                            rows.push(row.clone());
                        }
                    }
                    *next = page.continuation_token.clone();
                }
            });
            state.view_changed(view.clone());
        });
        Ok(())
    }

    pub fn admin_user(&self, user_id: String) -> AdminUserView {
        self.write(|state, now| {
            let key = cache_keys::scoped(k::USER, &user_id);
            state.w5a_ensure(&key, now, true);
            let entity = match state.users_value(&key) {
                Some(UsersValue::User(user)) => Some((**user).clone()),
                _ => None,
            };
            AdminUserView {
                state: state.query_load_state(&key),
                user: entity.as_ref().map(|user| state.admin_row(user)),
                op: state.w5a_op(&ViewKey::AdminUser {
                    user_id: user_id.clone(),
                }),
            }
        })
    }

    pub fn admin_user_roles(&self, user_id: String) -> AdminUserRolesView {
        self.write(|state, now| {
            let key = cache_keys::scoped(k::USER_ROLES, &user_id);
            state.w5a_ensure(&key, now, true);
            // The roles explain this user's row too.
            state.w5a_ensure(&cache_keys::scoped(k::USER, &user_id), now, true);
            let held = match state.users_value(&key) {
                Some(UsersValue::UserRoles(roles)) => roles
                    .roles
                    .iter()
                    .map(|role| InstanceRoleRef {
                        id: role.id.clone(),
                        name: role.name.clone(),
                    })
                    .collect(),
                _ => Vec::new(),
            };
            AdminUserRolesView {
                state: state.query_load_state(&key),
                held,
                // The roles a user may be given need W6-E's list.
                available: Vec::new(),
                op: state.w5a_op(&ViewKey::AdminUserRoles {
                    user_id: user_id.clone(),
                }),
                user_id,
            }
        })
    }

    /// Grant (`true`) or take the owner role; only an instance owner may.
    pub async fn set_user_owner(&self, user_id: String, owner: bool) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminUser {
                user_id: user_id.clone(),
            },
            AdminActionKind::SetOwner,
            Some(user_id.clone()),
        );
        self.assert_user_action(&view, &user_id, |actions| actions.set_owner)?;
        let body = wire::UpdateUserRoleDto {
            role: if owner {
                InstanceRole::Owner
            } else {
                InstanceRole::User
            },
        };
        let (services, epoch, change) = self.w5a_begin(&view, "changing the owner role")?;
        let result = services
            .backend
            .user_controller_update_user_role(user_id.clone(), body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, user| {
                state.put_admin_user(user);
                if user_id == state.me_id() {
                    state.w5a_reread(&cache_keys::op(cache_keys::INSTANCE_ROLES));
                    state.w5a_reread(&cache_keys::op(cache_keys::PROFILE));
                }
            },
            |_| {},
        )
        .map(|_| ())
    }

    /// `banned` at once on the user's rows, and back if the server refuses.
    async fn set_ban(&self, user_id: String, banned: bool) -> Result<(), CoreError> {
        let (kind, what) = match banned {
            true => (AdminActionKind::BanUser, "banning a user"),
            false => (AdminActionKind::UnbanUser, "unbanning a user"),
        };
        let view = OpKey::new(
            ViewKey::AdminUser {
                user_id: user_id.clone(),
            },
            kind,
            Some(user_id.clone()),
        );
        self.assert_user_action(&view, &user_id, |actions| match banned {
            true => actions.ban,
            false => actions.unban,
        })?;
        let (services, epoch, change) = self.w5a_begin(&view, what)?;
        let written = self.write(|state, _| {
            let old = state.cached_admin_user(&user_id).map(|user| user.banned);
            state.set_admin_user_banned(&user_id, banned);
            old
        });
        let result = services
            .backend
            .user_controller_set_ban_status(user_id.clone(), wire::SetUserBanStatusDto { banned })
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, user| state.put_admin_user(user),
            |state| {
                if let Some(old) = written {
                    state.restore_admin_user_banned(&user_id, banned, old);
                }
            },
        )
        .map(|_| ())
    }

    pub async fn ban_user(&self, user_id: String) -> Result<(), CoreError> {
        self.set_ban(user_id, true).await
    }

    pub async fn unban_user(&self, user_id: String) -> Result<(), CoreError> {
        self.set_ban(user_id, false).await
    }

    /// Ends the user's sessions too (the server does).
    pub async fn reset_user_password(
        &self,
        user_id: String,
        password: String,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminUser {
                user_id: user_id.clone(),
            },
            AdminActionKind::SetUserPassword,
            Some(user_id.clone()),
        );
        self.assert_user_action(&view, &user_id, |actions| actions.reset_password)?;
        let length = password.chars().count();
        let body = match (length < 8, length > 128) {
            (true, _) => {
                return self.w5a_refuse(
                    &view,
                    CoreError::Failed {
                        message: "Password must be at least 8 characters".into(),
                    },
                );
            }
            (_, true) => {
                return self.w5a_refuse(
                    &view,
                    CoreError::Failed {
                        message: "Password must be at most 128 characters".into(),
                    },
                );
            }
            _ => wire::SetUserPasswordDto {
                password: password.parse().expect("the length was checked"),
            },
        };
        let (services, epoch, change) = self.w5a_begin(&view, "resetting a password")?;
        let result = services
            .backend
            .user_controller_set_user_password(user_id.clone(), body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, user| state.put_admin_user(user),
            |_| {},
        )
        .map(|_| ())
    }

    pub async fn delete_user(&self, user_id: String) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminUser {
                user_id: user_id.clone(),
            },
            AdminActionKind::DeleteUser,
            Some(user_id.clone()),
        );
        self.assert_user_action(&view, &user_id, |actions| actions.delete)?;
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a user")?;
        let result = services
            .backend
            .user_controller_delete_user(user_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.drop_admin_user(&user_id),
            |_| {},
        )
        .map(|_| ())
    }

    /// Gives a user an instance role; their roles are read again.
    pub async fn assign_instance_role(
        &self,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminUserRoles {
                user_id: user_id.clone(),
            },
            AdminActionKind::AssignInstanceRole,
            Some(role_id.clone()),
        );
        self.assert_user_action(&view, &user_id, |actions| actions.edit_roles)?;
        let user = match user_id.parse::<uuid::Uuid>() {
            Ok(user) => user,
            Err(_) => {
                return self.w5a_refuse(
                    &view,
                    CoreError::Failed {
                        message: "the user isn't a valid id".into(),
                    },
                );
            }
        };
        let (services, epoch, change) = self.w5a_begin(&view, "assigning an instance role")?;
        let result = services
            .backend
            .roles_controller_assign_instance_role(
                role_id,
                wire::AssignInstanceRoleDto { user_id: user },
            )
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.w5a_reread(&cache_keys::scoped(k::USER_ROLES, &user_id)),
            |_| {},
        )
        .map(|_| ())
    }

    /// Takes an instance role from a user; their roles are read again.
    pub async fn unassign_instance_role(
        &self,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::AdminUserRoles {
                user_id: user_id.clone(),
            },
            AdminActionKind::UnassignInstanceRole,
            Some(role_id.clone()),
        );
        self.assert_user_action(&view, &user_id, |actions| actions.edit_roles)?;
        let (services, epoch, change) = self.w5a_begin(&view, "removing an instance role")?;
        let result = services
            .backend
            .roles_controller_remove_instance_role(role_id, user_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.w5a_reread(&cache_keys::scoped(k::USER_ROLES, &user_id)),
            |_| {},
        )
        .map(|_| ())
    }
}
