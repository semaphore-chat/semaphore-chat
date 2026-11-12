//! W6-E: instance roles: the list, the editor and a role's users.
//!
//! This file is W6-E's own: its state, its cached values (`RolesValue`, inside
//! `CacheValue::W6(W6Value::Roles(..))`), which views its queries feed, how they are fetched, and
//! what it does on a socket event. The hub (`instance_admin/mod.rs`) and the shared files only
//! call the functions below, so no other lane edits this file.
//!
//! Changes show on their view's `AdminOp` through W5-A's machinery (`OpKey`, `w5a_begin`,
//! `w5a_settle`, `w5a_op`, `w5a_refuse` in `commands/community_admin.rs`). A draft is checked
//! before it is sent, in the backend's order, and refused with the backend's words
//! (`backend/src/roles/dto/create-role.dto.ts`, `roles/instance-roles.service.ts`).

use crate::cache::{CacheValue, QueryKey, keys as cache_keys};
use crate::client::{Core, State};
use crate::commands::community_admin::OpKey;
use crate::model::{
    AdminActionKind, INSTANCE_ADMIN_ACTIONS, InstanceRoleDraft, InstanceRoleRow,
    InstanceRoleUsersView, InstanceRolesView, UserView, ViewKey,
};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::enums::RbacAction;
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

use super::W6Value;

/// The default instance admin role's name: the one role no one may delete or rename.
const INSTANCE_ADMIN_ROLE: &str = "Instance Admin";

/// W6-E's query ids: the web's `operationId`s.
pub mod keys {
    pub const ROLES: &str = "rolesControllerGetInstanceRoles";
    pub const ROLE_USERS: &str = "rolesControllerGetInstanceRoleUsers";

    /// What a new connection reads again: none of these has socket events.
    pub const RECONNECT: &[&str] = &[ROLES, ROLE_USERS];
}
use keys as k;

/// W6-E's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct RolesState {}

/// W6-E's cached responses.
#[derive(Debug, Clone)]
pub enum RolesValue {
    Roles(Vec<wire::RoleDto>),
    RoleUsers(Vec<wire::RoleUserDto>),
}

/// The view a W6-E query feeds.
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    Some(match key.op() {
        k::ROLES => ViewKey::InstanceRoles,
        k::ROLE_USERS => ViewKey::InstanceRoleUsers {
            role_id: key.segments.get(1).cloned().unwrap_or_default(),
        },
        _ => return None,
    })
}

/// The query a W6-E view reads.
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    Some(match view {
        ViewKey::InstanceRoles => cache_keys::op(k::ROLES),
        ViewKey::InstanceRoleUsers { role_id } => cache_keys::scoped(k::ROLE_USERS, role_id),
        _ => return None,
    })
}

/// Whether a role with `role_actions` may be changed by someone with `full_authority` holding
/// `held` (the server's `assertMayHandle`).
pub fn role_editable(full_authority: bool, held: &[String], role_actions: &[String]) -> bool {
    full_authority
        || role_actions
            .iter()
            .all(|action| held.iter().any(|mine| mine == action))
}

/// A role's actions as wire names, in its order.
fn action_names(role: &wire::RoleDto) -> Vec<String> {
    role.actions
        .iter()
        .map(|action| action.as_str().into_owned())
        .collect()
}

/// A wire name back as an action (one this build doesn't know stays unknown).
fn action(name: &str) -> RbacAction {
    serde_json::from_value(serde_json::Value::String(name.to_owned()))
        .unwrap_or_else(|_| RbacAction::Unknown(name.to_owned()))
}

/// A draft refused before it was sent, in the backend's words.
fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::Failed {
        message: message.into(),
    }
}

/// What the caller may put in a role, and change: `full` authority, else the actions held.
/// `known` is false while my instance roles haven't been read: nothing is editable then.
#[derive(Debug, Default, Clone)]
struct Authority {
    known: bool,
    full: bool,
    held: Vec<String>,
}

impl State {
    fn roles_value(&self, key: &QueryKey) -> Option<&RolesValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W6(W6Value::Roles(value))) => Some(value),
            _ => None,
        }
    }

    /// The instance roles under `key`, when there are some.
    fn roles_cached(&self, key: &QueryKey) -> Option<&Vec<wire::RoleDto>> {
        match self.roles_value(key) {
            Some(RolesValue::Roles(roles)) => Some(roles),
            _ => None,
        }
    }

    /// A role's users under `key`, when there are some.
    fn role_users_cached(&self, key: &QueryKey) -> Option<&Vec<wire::RoleUserDto>> {
        match self.roles_value(key) {
            Some(RolesValue::RoleUsers(users)) => Some(users),
            _ => None,
        }
    }

    /// Edits a cached W6-E value, keeping when it was read and whether it's stale.
    fn roles_edit<R>(
        &mut self,
        key: &QueryKey,
        change: impl FnOnce(&mut RolesValue) -> R,
    ) -> Option<R> {
        let entry = self.cache.get(key)?.clone();
        let CacheValue::W6(W6Value::Roles(mut value)) = entry.value else {
            return None;
        };
        let result = change(&mut value);
        self.cache.set(
            key.clone(),
            CacheValue::W6(W6Value::Roles(value)),
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

    /// My authority over instance roles; nothing known means nothing may be granted.
    fn roles_authority(&self) -> Authority {
        match self.instance_authority() {
            Some(authority) => Authority {
                known: true,
                full: authority.full,
                held: authority.held,
            },
            None => Authority::default(),
        }
    }

    /// Checks a draft in the backend's order and answers its trimmed name and wire actions.
    /// `current` is the role an edit changes: a default may keep its name, and its actions must
    /// all be mine.
    fn checked_draft(
        &self,
        draft: &InstanceRoleDraft,
        current: Option<&wire::RoleDto>,
    ) -> Result<(String, Vec<RbacAction>), CoreError> {
        let name = draft.name.trim();
        if name.is_empty() {
            return Err(invalid("Role name must not be empty"));
        }
        if name.chars().count() > 50 {
            return Err(invalid("Role name must not exceed 50 characters"));
        }
        if draft.actions.is_empty() {
            return Err(invalid("Role must have at least one permission"));
        }
        let invalid_actions: Vec<&str> = draft
            .actions
            .iter()
            .map(String::as_str)
            .filter(|action| !INSTANCE_ADMIN_ACTIONS.contains(action))
            .collect();
        if !invalid_actions.is_empty() {
            return Err(invalid(format!(
                "Actions not valid for instance roles: {}",
                invalid_actions.join(", ")
            )));
        }
        let authority = self.roles_authority();
        if !authority.full {
            let missing: Vec<&str> = draft
                .actions
                .iter()
                .map(String::as_str)
                .filter(|action| !authority.held.iter().any(|held| held == action))
                .collect();
            if !missing.is_empty() {
                return Err(invalid(format!(
                    "Cannot grant permissions you do not have: {}",
                    missing.join(", ")
                )));
            }
        }
        if let Some(role) = current {
            if role.is_default && role.name != name {
                return Err(invalid("Cannot rename a default role"));
            }
            let actions = action_names(role);
            if !role_editable(authority.full, &authority.held, &actions) {
                let missing: Vec<String> = actions
                    .into_iter()
                    .filter(|action| !authority.held.iter().any(|held| held == action))
                    .collect();
                return Err(invalid(format!(
                    "Cannot grant permissions you do not have: {}",
                    missing.join(", ")
                )));
            }
        }
        Ok((
            name.to_owned(),
            draft
                .actions
                .iter()
                .map(|action| self::action(action))
                .collect(),
        ))
    }

    /// A W6-E query's data changed: say which views to read again. False when it isn't
    /// W6-E's.
    pub(crate) fn w6_roles_query_changed(&mut self, key: &QueryKey) -> bool {
        let Some(view) = view_for(key) else {
            return false;
        };
        self.view_changed(view);
        true
    }

    /// One socket event, before the shared rules. No socket event covers W6-E's data.
    pub(crate) fn w6_roles_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    /// Fetches a W6-E query; `None` when it isn't one.
    pub(crate) async fn w6_roles_fetch(
        &self,
        key: &QueryKey,
    ) -> Option<Result<CacheValue, CoreError>> {
        view_for(key)?;
        let result = async {
            let backend = &self
                .services()
                .ok_or_else(|| unavailable("the backend"))?
                .backend;
            let failed = |error| self.backend_failed(error);
            let value = match key.op() {
                k::ROLES => RolesValue::Roles(
                    backend
                        .roles_controller_get_instance_roles()
                        .await
                        .map_err(failed)?,
                ),
                k::ROLE_USERS => {
                    let role_id = key.segments.get(1).cloned().unwrap_or_default();
                    RolesValue::RoleUsers(
                        backend
                            .roles_controller_get_instance_role_users(role_id)
                            .await
                            .map_err(failed)?,
                    )
                }
                op => {
                    return Err(CoreError::Failed {
                        message: format!("no fetch for {op}"),
                    });
                }
            };
            Ok(CacheValue::W6(W6Value::Roles(value)))
        }
        .await;
        Some(result)
    }

    /// Every instance role, lowest position first, with what I may do with each.
    /// `ViewKey::InstanceRoles` says when to read again.
    pub fn instance_roles(&self) -> InstanceRolesView {
        self.write(|state, now| {
            let key = cache_keys::op(k::ROLES);
            state.w5a_ensure(&key, now, true);
            let authority = match state.instance_authority() {
                Some(authority) => Authority {
                    known: true,
                    full: authority.full,
                    held: authority.held,
                },
                // My instance roles aren't read yet: nothing is editable, nothing grantable.
                None => Authority::default(),
            };
            let grantable: Vec<String> = INSTANCE_ADMIN_ACTIONS
                .iter()
                .filter(|action| {
                    authority.full || authority.held.iter().any(|held| held == *action)
                })
                .map(|action| (*action).to_owned())
                .collect();
            let mut roles: Vec<InstanceRoleRow> = state
                .roles_cached(&key)
                .map(|roles| {
                    roles
                        .iter()
                        .map(|role| {
                            let actions = action_names(role);
                            let editable = authority.known
                                && role_editable(authority.full, &authority.held, &actions);
                            InstanceRoleRow {
                                id: role.id.clone(),
                                name: role.name.clone(),
                                is_default: role.is_default,
                                position: role.position,
                                deletable: editable && role.name != INSTANCE_ADMIN_ROLE,
                                actions,
                                editable,
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            roles.sort_by(|a, b| {
                a.position
                    .cmp(&b.position)
                    .then_with(|| a.name.cmp(&b.name))
            });
            InstanceRolesView {
                state: state.query_load_state(&key),
                roles,
                grantable,
                op: state.w5a_op(&ViewKey::InstanceRoles),
            }
        })
    }

    /// Makes an instance role; returns the new role's id. Op `CreateInstanceRole` on
    /// `ViewKey::InstanceRoles`.
    pub async fn create_instance_role(
        &self,
        draft: InstanceRoleDraft,
    ) -> Result<String, CoreError> {
        let view = OpKey::new(
            ViewKey::InstanceRoles,
            AdminActionKind::CreateInstanceRole,
            None,
        );
        let (name, actions) = match self.read(|state| state.checked_draft(&draft, None)) {
            Ok(checked) => checked,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let name = match wire::CreateRoleDtoName::try_from(name) {
            Ok(name) => name,
            Err(_) => {
                return self.w5a_refuse(&view, invalid("Role name must not exceed 50 characters"));
            }
        };
        let body = wire::CreateRoleDto {
            actions,
            name,
            position: None,
        };
        let (services, epoch, change) = self.w5a_begin(&view, "creating an instance role")?;
        let result = services
            .backend
            .roles_controller_create_instance_role(body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, role| {
                state.roles_edit(&cache_keys::op(k::ROLES), |value| {
                    if let RolesValue::Roles(roles) = value
                        && !roles.iter().any(|known| known.id == role.id)
                    {
                        roles.push(role.clone());
                    }
                });
            },
            |_| {},
        )
        .map(|role| role.id)
    }

    /// Changes a role's name and actions. Op `UpdateInstanceRole` on `ViewKey::InstanceRoles`,
    /// targeting the role.
    pub async fn update_instance_role(
        &self,
        role_id: String,
        draft: InstanceRoleDraft,
    ) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::InstanceRoles,
            AdminActionKind::UpdateInstanceRole,
            Some(role_id.clone()),
        );
        let roles_key = cache_keys::op(k::ROLES);
        let current = self.read(|state| {
            state
                .roles_cached(&roles_key)
                .and_then(|roles| roles.iter().find(|role| role.id == role_id).cloned())
        });
        let (name, actions) = match self.read(|state| state.checked_draft(&draft, current.as_ref()))
        {
            Ok(checked) => checked,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let name = match wire::UpdateRoleDtoName::try_from(name) {
            Ok(name) => name,
            Err(_) => {
                return self.w5a_refuse(&view, invalid("Role name must not exceed 50 characters"));
            }
        };
        let body = wire::UpdateRoleDto {
            actions,
            name: Some(name),
            position: None,
        };
        let (services, epoch, change) = self.w5a_begin(&view, "changing an instance role")?;
        let result = services
            .backend
            .roles_controller_update_instance_role(role_id.clone(), body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, role| {
                state.roles_edit(&roles_key, |value| {
                    if let RolesValue::Roles(roles) = value
                        && let Some(known) = roles.iter_mut().find(|known| known.id == role.id)
                    {
                        *known = role.clone();
                    }
                });
            },
            |_| {},
        )
        .map(|_| ())
    }

    /// Deletes a role: gone at once, back if the server refuses. Op `DeleteInstanceRole` on
    /// `ViewKey::InstanceRoles`, targeting the role.
    pub async fn delete_instance_role(&self, role_id: String) -> Result<(), CoreError> {
        let view = OpKey::new(
            ViewKey::InstanceRoles,
            AdminActionKind::DeleteInstanceRole,
            Some(role_id.clone()),
        );
        let roles_key = cache_keys::op(k::ROLES);
        let refusal = self.read(|state| {
            let role = state
                .roles_cached(&roles_key)?
                .iter()
                .find(|role| role.id == role_id)?
                .clone();
            if role.name == INSTANCE_ADMIN_ROLE {
                return Some(invalid("Cannot delete the default Instance Admin role"));
            }
            let authority = state.roles_authority();
            let actions = action_names(&role);
            if authority.known && role_editable(authority.full, &authority.held, &actions) {
                return None;
            }
            let missing: Vec<String> = actions
                .into_iter()
                .filter(|action| !authority.held.iter().any(|held| held == action))
                .collect();
            Some(invalid(format!(
                "Cannot grant permissions you do not have: {}",
                missing.join(", ")
            )))
        });
        if let Some(error) = refusal {
            return self.w5a_refuse(&view, error);
        }
        let (services, epoch, change) = self.w5a_begin(&view, "deleting an instance role")?;
        let removed = self.write(|state, _| {
            state
                .roles_edit(&roles_key, |value| {
                    let RolesValue::Roles(roles) = value else {
                        return None;
                    };
                    let index = roles.iter().position(|role| role.id == role_id)?;
                    Some((index, roles.remove(index)))
                })
                .flatten()
        });
        let result = services
            .backend
            .roles_controller_delete_instance_role(role_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |_, _, _| {},
            |state| {
                let Some((index, role)) = removed else {
                    return;
                };
                state.roles_edit(&roles_key, |value| {
                    if let RolesValue::Roles(roles) = value
                        && !roles.iter().any(|known| known.id == role.id)
                    {
                        roles.insert(index.min(roles.len()), role);
                    }
                });
            },
        )
    }

    /// The users holding one instance role. `ViewKey::InstanceRoleUsers { role_id }`.
    pub fn instance_role_users(&self, role_id: String) -> InstanceRoleUsersView {
        self.write(|state, now| {
            let key = cache_keys::scoped(k::ROLE_USERS, &role_id);
            state.w5a_ensure(&key, now, true);
            let users: Vec<UserView> = state
                .role_users_cached(&key)
                .map(|users| {
                    users
                        .iter()
                        .map(|user| UserView {
                            id: user.user_id.clone(),
                            username: user.username.clone(),
                            display_name: user.display_name.clone(),
                            avatar_file_id: None,
                        })
                        .collect()
                })
                .unwrap_or_default();
            InstanceRoleUsersView {
                state: state.query_load_state(&key),
                role_id: role_id.clone(),
                users,
                op: state.w5a_op(&ViewKey::InstanceRoleUsers { role_id }),
            }
        })
    }
}
