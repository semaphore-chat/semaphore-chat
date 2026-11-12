//! W6-E's state: the instance roles and who holds them, seeded from the backend's default roles
//! (`backend/src/roles/default-roles.config.ts`) and, when the scenario has it, its
//! `instanceRoleAssignments` key (`Scenario::extra`: role name -> user ids). Its own lock
//! (`Inner::w6_roles`): never held with `data`, `admin` or `rbac`.

use crate::{Inner, lock};
use axum::response::Response;
use chrono::{DateTime, Utc};
use semaphore_wire::enums::RbacAction;
use semaphore_wire::types::RoleDto;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// The default Instance Admin role's name: no one may delete or rename it.
pub(crate) const INSTANCE_ADMIN_ROLE: &str = "Instance Admin";

/// The 12 actions an instance role may hold: the default Instance Admin role's.
pub(crate) const INSTANCE_ADMIN_ACTIONS: [&str; 12] = [
    "READ_INSTANCE_SETTINGS",
    "UPDATE_INSTANCE_SETTINGS",
    "READ_INSTANCE_STATS",
    "MANAGE_USER_STORAGE",
    "READ_USER",
    "UPDATE_USER",
    "BAN_USER",
    "DELETE_USER",
    "READ_INSTANCE_INVITE",
    "CREATE_INSTANCE_INVITE",
    "DELETE_INSTANCE_INVITE",
    "UPDATE_INSTANCE_INVITE",
];

/// The default Community Creator role's actions, in the backend's order.
const COMMUNITY_CREATOR_ACTIONS: [&str; 50] = [
    "CREATE_COMMUNITY",
    "READ_COMMUNITY",
    "CREATE_CHANNEL",
    "UPDATE_CHANNEL",
    "MANAGE_CHANNEL_PERMISSIONS",
    "MANAGE_WEBHOOKS",
    "DELETE_CHANNEL",
    "READ_CHANNEL",
    "JOIN_CHANNEL",
    "SPEAK",
    "VIDEO",
    "SCREEN_SHARE",
    "CREATE_MEMBER",
    "UPDATE_MEMBER",
    "DELETE_MEMBER",
    "READ_MEMBER",
    "CREATE_MESSAGE",
    "ATTACH_FILES",
    "DELETE_MESSAGE",
    "READ_MESSAGE",
    "CREATE_ROLE",
    "UPDATE_ROLE",
    "DELETE_ROLE",
    "READ_ROLE",
    "CREATE_INVITE",
    "DELETE_INVITE",
    "CREATE_ALIAS_GROUP",
    "UPDATE_ALIAS_GROUP",
    "DELETE_ALIAS_GROUP",
    "READ_ALIAS_GROUP",
    "CREATE_ALIAS_GROUP_MEMBER",
    "DELETE_ALIAS_GROUP_MEMBER",
    "READ_ALIAS_GROUP_MEMBER",
    "UPDATE_ALIAS_GROUP_MEMBER",
    "MANAGE_EMOJIS",
    "CREATE_REACTION",
    "DELETE_REACTION",
    "CAPTURE_REPLAY",
    "KICK_USER",
    "TIMEOUT_USER",
    "UNBAN_USER",
    "PIN_MESSAGE",
    "UNPIN_MESSAGE",
    "DELETE_ANY_MESSAGE",
    "VIEW_BAN_LIST",
    "VIEW_MODERATION_LOGS",
    "MUTE_PARTICIPANT",
    "CREATE_SOUNDBOARD_SOUND",
    "DELETE_SOUNDBOARD_SOUND",
    "READ_SOUNDBOARD_SOUND",
];

#[derive(Debug, Default)]
pub(crate) struct Roles {
    seeded: bool,
    /// The instance roles: the two defaults, then the ones made over the API.
    pub(crate) roles: Vec<RoleDto>,
    /// Role id -> the users it's assigned to.
    pub(crate) assignments: BTreeMap<String, BTreeSet<String>>,
    /// The number the next role made over the API is named by.
    next: u64,
}

impl Roles {
    /// The scenario's seed, once: the default roles, and the assignments its extra key names.
    fn seed(&mut self, inner: &Inner) {
        if std::mem::replace(&mut self.seeded, true) {
            return;
        }
        let at = inner.scenario.epoch;
        let defaults = [
            (
                "instance-admin",
                INSTANCE_ADMIN_ROLE,
                10,
                INSTANCE_ADMIN_ACTIONS.as_slice(),
            ),
            (
                "community-creator",
                "Community Creator",
                20,
                COMMUNITY_CREATOR_ACTIONS.as_slice(),
            ),
        ];
        for (readable, name, position, actions) in defaults {
            self.roles.push(RoleDto {
                id: crate::rbac::role_uuid(readable),
                name: name.to_owned(),
                position,
                is_default: true,
                created_at: at,
                actions: actions
                    .iter()
                    .map(|action| crate::rbac::action(action))
                    .collect(),
            });
        }
        if let Some(assignments) = inner
            .scenario
            .extra
            .get("instanceRoleAssignments")
            .and_then(Value::as_object)
        {
            for (name, users) in assignments {
                let Some(role) = self.roles.iter().find(|role| &role.name == name) else {
                    continue;
                };
                let users = users
                    .as_array()
                    .map(|users| {
                        users
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
                self.assignments.insert(role.id.clone(), users);
            }
        }
        self.roles.sort_by_key(|role| role.position);
    }
}

/// Runs `f` on the roles, seeding them from the scenario first.
fn with_roles<T>(inner: &Inner, f: impl FnOnce(&mut Roles) -> T) -> T {
    let mut roles = lock(&inner.w6_roles);
    roles.seed(inner);
    f(&mut roles)
}

/// A W6-E control (`POST /__control/{name}`), or `None` when the name isn't W6-E's.
pub(crate) fn control(_inner: &Inner, _name: &str, _request: &Value) -> Option<Response> {
    None
}

/// Whether `user_id` holds the instance action `action` (a wire name): the owner always (the
/// guard lets them past), else the union of their instance roles' actions. Every W6 handler guards
/// with this (`crate::w6::allows`).
pub(crate) fn holds(inner: &Inner, user_id: &str, action: &str) -> bool {
    crate::rbac::is_owner(inner, user_id) || held(inner, user_id).contains(action)
}

/// `user_id`'s instance actions from their instance roles (the owner's bypass not included).
/// Everyone has the fake's default "Member" role, which may create communities.
pub(crate) fn held(inner: &Inner, user_id: &str) -> BTreeSet<String> {
    let mut held = with_roles(inner, |state| {
        state
            .roles
            .iter()
            .filter(|role| {
                state
                    .assignments
                    .get(&role.id)
                    .is_some_and(|users| users.contains(user_id))
            })
            .flat_map(|role| {
                role.actions
                    .iter()
                    .map(|action| action.as_str().into_owned())
            })
            .collect::<BTreeSet<String>>()
    });
    held.insert("CREATE_COMMUNITY".to_owned());
    held
}

/// The owner, or someone holding every one of the 12 instance admin actions
/// (`InstanceRolesService.hasFullInstanceAuthority`).
pub(crate) fn full_authority(inner: &Inner, user_id: &str) -> bool {
    crate::rbac::is_owner(inner, user_id) || {
        let held = held(inner, user_id);
        INSTANCE_ADMIN_ACTIONS
            .iter()
            .all(|action| held.contains(*action))
    }
}

/// Every instance role, by position (`GET /roles/instance/all`).
pub(crate) fn all_json(inner: &Inner) -> Value {
    let roles = with_roles(inner, |state| {
        let mut roles = state.roles.clone();
        roles.sort_by_key(|role| role.position);
        roles
    });
    Value::Array(roles.iter().map(role_json).collect())
}

fn role_json(role: &RoleDto) -> Value {
    serde_json::to_value(role).expect("a role serializes")
}

/// The role with this id, as it is now.
pub(crate) fn role(inner: &Inner, role_id: &str) -> Option<RoleDto> {
    with_roles(inner, |state| {
        state.roles.iter().find(|role| role.id == role_id).cloned()
    })
}

/// Whether another instance role already has this name (`id` is the one being changed).
pub(crate) fn name_taken(inner: &Inner, name: &str, except: Option<&str>) -> bool {
    with_roles(inner, |state| {
        state
            .roles
            .iter()
            .any(|role| role.name == name && Some(role.id.as_str()) != except)
    })
}

/// Adds a role at the lowest priority: the highest position plus ten.
pub(crate) fn create(
    inner: &Inner,
    name: String,
    actions: Vec<RbacAction>,
    at: DateTime<Utc>,
) -> RoleDto {
    with_roles(inner, |state| {
        state.next += 1;
        let position = state
            .roles
            .iter()
            .map(|role| role.position)
            .max()
            .unwrap_or(0)
            + 10;
        let role = RoleDto {
            id: crate::rbac::role_uuid(&format!("instance-role-{}", state.next)),
            name,
            position,
            is_default: false,
            created_at: at,
            actions,
        };
        state.roles.push(role.clone());
        role
    })
}

/// Changes a role's name and actions, as the update does.
pub(crate) fn replace(
    inner: &Inner,
    role_id: &str,
    name: Option<String>,
    actions: Option<Vec<RbacAction>>,
) -> Option<RoleDto> {
    with_roles(inner, |state| {
        let role = state.roles.iter_mut().find(|role| role.id == role_id)?;
        if let Some(name) = name {
            role.name = name;
        }
        if let Some(actions) = actions {
            role.actions = actions;
        }
        Some(role.clone())
    })
}

/// Drops a role and its assignments. False when there was no such role.
pub(crate) fn remove(inner: &Inner, role_id: &str) -> bool {
    with_roles(inner, |state| {
        let before = state.roles.len();
        state.roles.retain(|role| role.id != role_id);
        state.assignments.remove(role_id);
        state.roles.len() != before
    })
}

/// The users a role is assigned to.
pub(crate) fn assigned(inner: &Inner, role_id: &str) -> BTreeSet<String> {
    with_roles(inner, |state| {
        state.assignments.get(role_id).cloned().unwrap_or_default()
    })
}

/// Assigns a role to a user: false when they already hold it.
pub(crate) fn assign(inner: &Inner, role_id: &str, user_id: &str) -> bool {
    with_roles(inner, |state| {
        state
            .assignments
            .entry(role_id.to_owned())
            .or_default()
            .insert(user_id.to_owned())
    })
}

/// Takes a role from a user: false when they didn't hold it.
pub(crate) fn unassign(inner: &Inner, role_id: &str, user_id: &str) -> bool {
    with_roles(inner, |state| {
        state
            .assignments
            .get_mut(role_id)
            .is_some_and(|users| users.remove(user_id))
    })
}

/// `GET /roles/instance/{roleId}/users`: who holds the role, as `RoleUserDto`s.
pub(crate) fn role_users_json(inner: &Inner, role_id: &str) -> Value {
    let users: Vec<Value> = assigned(inner, role_id)
        .into_iter()
        // The accounts lock: never taken holding `w6_roles`.
        .filter_map(|user_id| inner.user_entity(&user_id))
        .map(|user| {
            json!({
                "userId": user.id,
                "username": user.username,
                "displayName": user.display_name,
            })
        })
        .collect();
    Value::Array(users)
}

/// `UserRolesResponseDto` for `user_id`'s instance roles (`GET /roles/my/instance`, and
/// `GET /roles/user/{userId}/instance`): the default role every user has, then the assigned ones.
pub(crate) fn instance_roles_json(inner: &Inner, user_id: &str) -> Value {
    let assigned = with_roles(inner, |state| {
        let mut roles: Vec<RoleDto> = state
            .roles
            .iter()
            .filter(|role| {
                state
                    .assignments
                    .get(&role.id)
                    .is_some_and(|users| users.contains(user_id))
            })
            .cloned()
            .collect();
        roles.sort_by_key(|role| role.position);
        roles
    });
    let mut roles = vec![json!({
        "id": "role-instance-member",
        "name": "Member",
        "position": 0,
        "isDefault": true,
        "createdAt": inner.scenario.epoch,
        "actions": ["CREATE_COMMUNITY"],
    })];
    roles.extend(assigned.iter().map(role_json));
    json!({
        "userId": user_id,
        "resourceId": null,
        "resourceType": "INSTANCE",
        "roles": roles,
    })
}
