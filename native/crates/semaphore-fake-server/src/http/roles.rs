//! W5-B's routes: community roles, assigning them, a member's roles, and channel overrides, with
//! the backend's rules (`roles/roles.controller.ts`, `roles/community-roles.service.ts`,
//! `channel-permissions/channel-permissions.service.ts`). The W5 moderation routes are in
//! `moderation.rs` beside W1's and W4's.

use super::{bearer_token, json_response, parse};
use crate::Inner;
use crate::rbac::{self, CommunityRbac, Overwrites, Refusal, refuse};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post, put};
use semaphore_wire::enums::{ChannelPreset, OverwriteTarget, RbacAction};
use semaphore_wire::types::{ChannelOverwriteDto, RoleDto};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/roles/my/community/{communityId}", get(my_roles))
        .route("/api/roles/community/{communityId}", get(list).post(create))
        .route("/api/roles/community/{communityId}/reorder", patch(reorder))
        .route(
            "/api/roles/community/{communityId}/reset-defaults",
            post(reset_defaults),
        )
        .route("/api/roles/community/{communityId}/assign", post(assign))
        .route(
            "/api/roles/community/{communityId}/users/{userId}/roles/{roleId}",
            axum::routing::delete(unassign),
        )
        .route(
            "/api/roles/community/{communityId}/{roleId}",
            put(update).delete(remove),
        )
        .route(
            "/api/roles/community/{communityId}/{roleId}/users",
            get(holders),
        )
        .route(
            "/api/roles/user/{userId}/community/{communityId}",
            get(user_roles),
        )
        .route(
            "/api/channels/{channelId}/overwrites",
            get(overwrites).put(replace_overwrites),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/roles/my/community/{communityId}") => {
            "RolesController_getMyRolesForCommunity"
        }
        ("GET", "/api/roles/community/{communityId}") => "RolesController_getCommunityRoles",
        ("POST", "/api/roles/community/{communityId}") => "RolesController_createCommunityRole",
        ("PATCH", "/api/roles/community/{communityId}/reorder") => "RolesController_reorderRoles",
        ("POST", "/api/roles/community/{communityId}/reset-defaults") => {
            "RolesController_resetDefaultCommunityRoles"
        }
        ("POST", "/api/roles/community/{communityId}/assign") => "RolesController_assignRoleToUser",
        ("DELETE", "/api/roles/community/{communityId}/users/{userId}/roles/{roleId}") => {
            "RolesController_removeRoleFromUser"
        }
        ("PUT", "/api/roles/community/{communityId}/{roleId}") => "RolesController_updateRole",
        ("DELETE", "/api/roles/community/{communityId}/{roleId}") => "RolesController_deleteRole",
        ("GET", "/api/roles/community/{communityId}/{roleId}/users") => {
            "RolesController_getUsersForRole"
        }
        ("GET", "/api/roles/user/{userId}/community/{communityId}") => {
            "RolesController_getUserRolesForCommunity"
        }
        ("GET", "/api/channels/{channelId}/overwrites") => {
            "ChannelPermissionsController_getOverwrites"
        }
        ("PUT", "/api/channels/{channelId}/overwrites") => {
            "ChannelPermissionsController_replaceOverwrites"
        }
        _ => return None,
    })
}

fn actor(inner: &Inner, headers: &HeaderMap) -> String {
    inner.user_of(bearer_token(headers))
}

fn reply(inner: &Inner, result: Result<Response, Refusal>) -> Response {
    result.unwrap_or_else(|refusal| rbac::respond(inner, refusal))
}

fn role_json(role: &RoleDto) -> Value {
    serde_json::to_value(role).unwrap_or(Value::Null)
}

fn action_names(role: &RoleDto) -> BTreeSet<String> {
    role.actions
        .iter()
        .map(|action| action.as_str().into_owned())
        .collect()
}

fn names(value: Option<&Value>) -> Option<Vec<String>> {
    value.and_then(Value::as_array).map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    })
}

/// `CommunityRolesService.standing`: what an actor may do to roles here.
struct Standing {
    owner: bool,
    top: bool,
    best: i64,
    held: BTreeSet<String>,
    held_roles: BTreeSet<String>,
}

/// `owner` is asked before the rbac lock is taken (`is_owner` reads accounts).
fn standing(owner: bool, state: &CommunityRbac, user_id: &str) -> Standing {
    if owner {
        return Standing {
            owner: true,
            top: true,
            best: 0,
            held: BTreeSet::new(),
            held_roles: BTreeSet::new(),
        };
    }
    Standing {
        owner: false,
        top: state.is_top(user_id),
        best: state.best(user_id),
        held: state.actions_of(user_id),
        held_roles: state.holders.get(user_id).cloned().unwrap_or_default(),
    }
}

impl Standing {
    fn below(&self, position: i64) -> Result<(), Refusal> {
        if self.top || position > self.best {
            Ok(())
        } else {
            Err(refuse(
                403,
                "FORBIDDEN",
                "You can only manage roles below your highest role",
            ))
        }
    }

    fn placeable(&self, position: i64) -> Result<(), Refusal> {
        let allowed = self.owner
            || if self.top {
                position >= self.best
            } else {
                position > self.best
            };
        if allowed {
            Ok(())
        } else {
            Err(refuse(
                403,
                "FORBIDDEN",
                "You can only place roles below your highest role",
            ))
        }
    }

    fn holds(&self, actions: &[String]) -> Result<(), Refusal> {
        if self.owner {
            return Ok(());
        }
        let missing: Vec<&str> = actions
            .iter()
            .filter(|action| !self.held.contains(*action))
            .map(String::as_str)
            .collect();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(refuse(
                403,
                "FORBIDDEN",
                format!(
                    "Cannot grant permissions you do not have: {}",
                    missing.join(", ")
                ),
            ))
        }
    }
}

/// Every action the backend knows: anything else is `Invalid actions`.
fn invalid_actions(actions: &[String]) -> Result<(), Refusal> {
    let invalid: Vec<&str> = actions
        .iter()
        .filter(|name| matches!(rbac::action(name), RbacAction::Unknown(_)))
        .map(String::as_str)
        .collect();
    if invalid.is_empty() {
        Ok(())
    } else {
        Err(refuse(
            400,
            "BAD_REQUEST",
            format!("Invalid actions: {}", invalid.join(", ")),
        ))
    }
}

fn community_or_404<T>(
    inner: &Inner,
    community_id: &str,
    f: impl FnOnce(&mut CommunityRbac, &mut rbac::Rbac) -> Result<T, Refusal>,
) -> Result<T, Refusal> {
    rbac::community(inner, community_id, f)
        .unwrap_or_else(|| Err(refuse(404, "NOT_FOUND", "Community not found")))
}

/// To the community's room: its members.
fn emit(inner: &Inner, community_id: &str, event: &str, payload: Value) {
    let users = rbac::members(inner, community_id);
    inner.emit_to_users(&users, event, payload);
}

// ----- Reads -------------------------------------------------------------------------------------

async fn my_roles(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let me = actor(&inner, &headers);
    let roles = rbac::roles_of(&inner, &community_id, &me);
    json_response(
        StatusCode::OK,
        json!({
            "userId": me,
            "resourceId": community_id,
            "resourceType": "COMMUNITY",
            "roles": roles.iter().map(role_json).collect::<Vec<_>>(),
        }),
    )
}

async fn list(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let me = actor(&inner, &headers);
    let result = rbac::guard(&inner, &me, &community_id, &["READ_ROLE"]).and_then(|()| {
        community_or_404(&inner, &community_id, |state, _| {
            let mut roles = state.roles.clone();
            roles.sort_by_key(|role| role.position);
            Ok(json_response(
                StatusCode::OK,
                json!({
                    "communityId": community_id,
                    "roles": roles.iter().map(role_json).collect::<Vec<_>>(),
                }),
            ))
        })
    });
    reply(&inner, result)
}

async fn holders(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, role_id)): Path<(String, String)>,
) -> Response {
    let me = actor(&inner, &headers);
    let result = rbac::guard(&inner, &me, &community_id, &["READ_ROLE"]).and_then(|()| {
        let users: Vec<String> = community_or_404(&inner, &community_id, |state, _| {
            if !state.roles.iter().any(|role| role.id == role_id) {
                return Err(refuse(404, "NOT_FOUND", "Role not found in this community"));
            }
            Ok(state
                .holders
                .iter()
                .filter(|(_, roles)| roles.contains(&role_id))
                .map(|(user, _)| user.clone())
                .collect())
        })?;
        let rows: Vec<Value> = users
            .iter()
            .filter_map(|id| inner.user_entity(id))
            .map(|user| {
                json!({
                    "userId": user.id,
                    "username": user.username,
                    "displayName": user.display_name,
                })
            })
            .collect();
        Ok(json_response(StatusCode::OK, Value::Array(rows)))
    });
    reply(&inner, result)
}

async fn user_roles(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((user_id, community_id)): Path<(String, String)>,
) -> Response {
    let me = actor(&inner, &headers);
    let result = rbac::guard(&inner, &me, &community_id, &["READ_MEMBER"]).map(|()| {
        let roles = rbac::roles_of(&inner, &community_id, &user_id);
        json_response(
            StatusCode::OK,
            json!({
                "userId": user_id,
                "resourceId": community_id,
                "resourceType": "COMMUNITY",
                "roles": roles.iter().map(role_json).collect::<Vec<_>>(),
            }),
        )
    });
    reply(&inner, result)
}

// ----- Roles -------------------------------------------------------------------------------------

async fn create(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    body: Bytes,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = rbac::guard(&inner, &me, &community_id, &["CREATE_ROLE"]).and_then(|()| {
        let name = body["name"].as_str().unwrap_or_default().trim().to_owned();
        let actions = names(body.get("actions")).unwrap_or_default();
        if name.is_empty() {
            return Err(refuse(400, "BAD_REQUEST", "name should not be empty"));
        }
        let now = inner.now();
        let role = community_or_404(&inner, &community_id, |state, rbac| {
            if state.roles.iter().any(|role| role.name == name) {
                return Err(refuse(
                    409,
                    "CONFLICT",
                    format!("Role with name \"{name}\" already exists in this community"),
                ));
            }
            invalid_actions(&actions)?;
            let st = standing(owner, state, &me);
            st.holds(&actions)?;
            let position = match body["position"].as_i64() {
                Some(position) => {
                    st.placeable(position)?;
                    position
                }
                None => {
                    let max = state
                        .roles
                        .iter()
                        .filter(|role| state.member_role().is_none_or(|m| m.id != role.id))
                        .map(|role| role.position)
                        .max()
                        .unwrap_or(0);
                    let mut position = (max + 1).min(99);
                    if !st.top && position <= st.best {
                        position = st.best + 1;
                    }
                    position
                }
            };
            let id = rbac.new_id("role");
            let id = if inner.scenario.uuid_message_ids {
                rbac::role_uuid(&id)
            } else {
                id
            };
            let role = RoleDto {
                actions: actions.iter().map(|name| rbac::action(name)).collect(),
                created_at: now,
                id,
                is_default: false,
                name: name.clone(),
                position,
            };
            state.roles.push(role.clone());
            state.roles.sort_by_key(|role| role.position);
            Ok(role)
        })?;
        emit(
            &inner,
            &community_id,
            "roleCreated",
            json!({ "communityId": community_id, "roleId": role.id, "roleName": role.name }),
        );
        Ok(json_response(StatusCode::CREATED, role_json(&role)))
    });
    reply(&inner, result)
}

async fn update(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, role_id)): Path<(String, String)>,
    body: Bytes,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = rbac::guard(&inner, &me, &community_id, &["UPDATE_ROLE"]).and_then(|()| {
        let role = community_or_404(&inner, &community_id, |state, _| {
            let Some(index) = state.roles.iter().position(|role| role.id == role_id) else {
                return Err(refuse(
                    404,
                    "NOT_FOUND",
                    format!("Role with ID {role_id} not found"),
                ));
            };
            let existing = state.roles[index].clone();
            let st = standing(owner, state, &me);
            st.below(existing.position)?;
            if let Some(position) = body["position"].as_i64() {
                st.placeable(position)?;
            }
            let name = body["name"].as_str().map(str::trim).map(str::to_owned);
            if existing.is_default
                && let Some(name) = &name
                && name != existing.name.trim()
            {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "Cannot change the name of default roles. Only permissions can be modified.",
                ));
            }
            let actions = names(body.get("actions"));
            if let Some(actions) = &actions {
                invalid_actions(actions)?;
                st.holds(actions)?;
            }
            if let Some(name) = &name
                && state
                    .roles
                    .iter()
                    .any(|role| role.name == *name && role.id != role_id)
            {
                return Err(refuse(
                    409,
                    "CONFLICT",
                    format!("Role with name \"{name}\" already exists in this community"),
                ));
            }
            let role = &mut state.roles[index];
            if let Some(name) = name {
                role.name = name;
            }
            if let Some(actions) = actions {
                role.actions = actions.iter().map(|name| rbac::action(name)).collect();
            }
            if let Some(position) = body["position"].as_i64() {
                role.position = position;
            }
            let role = role.clone();
            state.roles.sort_by_key(|role| role.position);
            Ok(role)
        })?;
        emit(
            &inner,
            &community_id,
            "roleUpdated",
            json!({ "communityId": community_id, "roleId": role.id, "roleName": role.name }),
        );
        Ok(json_response(StatusCode::OK, role_json(&role)))
    });
    reply(&inner, result)
}

async fn remove(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, role_id)): Path<(String, String)>,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let result = rbac::guard(&inner, &me, &community_id, &["DELETE_ROLE"]).and_then(|()| {
        community_or_404(&inner, &community_id, |state, _| {
            let Some(index) = state.roles.iter().position(|role| role.id == role_id) else {
                return Err(refuse(
                    404,
                    "NOT_FOUND",
                    format!("Role with ID {role_id} not found"),
                ));
            };
            standing(owner, state, &me).below(state.roles[index].position)?;
            if state.roles[index].is_default {
                return Err(refuse(400, "BAD_REQUEST", "Cannot delete default roles."));
            }
            state.roles.remove(index);
            for held in state.holders.values_mut() {
                held.remove(&role_id);
            }
            Ok(())
        })?;
        emit(
            &inner,
            &community_id,
            "roleDeleted",
            json!({ "communityId": community_id, "roleId": role_id }),
        );
        Ok(StatusCode::NO_CONTENT.into_response())
    });
    reply(&inner, result)
}

/// `reorderRolesAsActor`, then `reorderRoles`: positions 10, 20, ... in the order sent, the Member
/// role at 100.
async fn reorder(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    body: Bytes,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let result = rbac::guard(&inner, &me, &community_id, &["UPDATE_ROLE"]).and_then(|()| {
        let role_ids = names(body.get("roleIds")).unwrap_or_default();
        let updated = community_or_404(&inner, &community_id, |state, _| {
            let member = state.member_role().map(|role| role.id.clone());
            let st = standing(owner, state, &me);
            if !st.owner {
                let mut ordered = state.roles.clone();
                ordered.sort_by_key(|role| role.position);
                let reorderable: Vec<&RoleDto> = ordered
                    .iter()
                    .filter(|role| member.as_ref() != Some(&role.id))
                    .collect();
                let incoming: Vec<&String> = role_ids
                    .iter()
                    .filter(|id| reorderable.iter().any(|role| role.id == **id))
                    .collect();
                let above: Vec<&String> = reorderable
                    .iter()
                    .filter(|role| role.position <= st.best)
                    .map(|role| &role.id)
                    .collect();
                let allowed = if st.top {
                    incoming
                        .first()
                        .is_none_or(|id| st.held_roles.contains(*id))
                } else {
                    above
                        .iter()
                        .enumerate()
                        .all(|(i, id)| incoming.get(i) == Some(id))
                        && !reorderable.iter().any(|role| {
                            role.position == st.best && !st.held_roles.contains(&role.id)
                        })
                };
                if !allowed {
                    return Err(refuse(
                        403,
                        "FORBIDDEN",
                        "You can only reorder roles below your highest role",
                    ));
                }
            }
            let unique: BTreeSet<&String> = role_ids.iter().collect();
            if unique.len() != role_ids.len() {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "Duplicate role IDs in reorder list",
                ));
            }
            if let Some(stranger) = role_ids
                .iter()
                .find(|id| !state.roles.iter().any(|role| role.id == **id))
            {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    format!("Role {stranger} does not belong to community {community_id}"),
                ));
            }
            let ids: Vec<&String> = role_ids
                .iter()
                .filter(|id| member.as_ref() != Some(*id))
                .collect();
            if ids.len() != state.roles.len() - usize::from(member.is_some()) {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "All non-Member roles must be included in the reorder list",
                ));
            }
            for (i, id) in ids.iter().enumerate() {
                if let Some(role) = state.roles.iter_mut().find(|role| role.id == **id) {
                    role.position = (i as i64 + 1) * 10;
                }
            }
            if let Some(member) = &member
                && let Some(role) = state.roles.iter_mut().find(|role| role.id == *member)
            {
                role.position = 100;
            }
            state.roles.sort_by_key(|role| role.position);
            Ok(state.roles.clone())
        })?;
        for role in updated
            .iter()
            .filter(|role| role_ids.contains(&role.id) && role.position != 100)
        {
            emit(
                &inner,
                &community_id,
                "roleUpdated",
                json!({ "communityId": community_id, "roleId": role.id, "roleName": role.name }),
            );
        }
        Ok(json_response(
            StatusCode::OK,
            Value::Array(updated.iter().map(role_json).collect()),
        ))
    });
    reply(&inner, result)
}

/// `resetDefaultsAsActor`: every default role goes back to how it was seeded, if the actor
/// outranks it and holds what it would grant.
async fn reset_defaults(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let result = rbac::guard(&inner, &me, &community_id, &["UPDATE_ROLE"]).and_then(|()| {
        let (roles, changed) = community_or_404(&inner, &community_id, |state, _| {
            let st = standing(owner, state, &me);
            let mut changed = Vec::new();
            for target in state.defaults.clone() {
                let existing = state
                    .roles
                    .iter()
                    .find(|role| role.id == target.id)
                    .cloned();
                let granted: Vec<String> = action_names(&target)
                    .into_iter()
                    .filter(|action| {
                        existing
                            .as_ref()
                            .is_none_or(|role| !action_names(role).contains(action))
                    })
                    .collect();
                let changes = existing.as_ref().is_none_or(|role| {
                    action_names(role) != action_names(&target) || role.position != target.position
                });
                if !changes {
                    continue;
                }
                if !st.owner {
                    if let Some(existing) = &existing {
                        st.below(existing.position)?;
                    }
                    st.below(target.position)?;
                    st.holds(&granted)?;
                }
                changed.push(target);
            }
            for target in &changed {
                match state.roles.iter_mut().find(|role| role.id == target.id) {
                    Some(role) => {
                        role.actions = target.actions.clone();
                        role.position = target.position;
                    }
                    None => state.roles.push(target.clone()),
                }
            }
            state.roles.sort_by_key(|role| role.position);
            Ok((state.roles.clone(), changed))
        })?;
        for role in changed {
            emit(
                &inner,
                &community_id,
                "roleUpdated",
                json!({ "communityId": community_id, "roleId": role.id, "roleName": role.name }),
            );
        }
        Ok(json_response(
            StatusCode::OK,
            json!({
                "communityId": community_id,
                "roles": roles.iter().map(role_json).collect::<Vec<_>>(),
            }),
        ))
    });
    reply(&inner, result)
}

// ----- Assignment --------------------------------------------------------------------------------

/// `assertCanChangeRolesOf`: yourself, someone you outrank, or anyone for a top-role holder.
fn may_change_roles_of(
    state: &CommunityRbac,
    st: &Standing,
    actor: &str,
    user_id: &str,
) -> Result<(), Refusal> {
    if st.top || actor == user_id || state.outranks(actor, user_id) {
        Ok(())
    } else {
        Err(refuse(
            403,
            "FORBIDDEN",
            "You can only change the roles of members ranked below you",
        ))
    }
}

async fn assign(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(community_id): Path<String>,
    body: Bytes,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let now = inner.now();
    let result = rbac::guard(&inner, &me, &community_id, &["UPDATE_MEMBER"]).and_then(|()| {
        let (Some(user_id), Some(role_id)) = (body["userId"].as_str(), body["roleId"].as_str())
        else {
            return Err(refuse(400, "BAD_REQUEST", "userId and roleId are required"));
        };
        let name = community_or_404(&inner, &community_id, |state, _| {
            let Some(role) = state.roles.iter().find(|role| role.id == role_id).cloned() else {
                return Err(refuse(404, "NOT_FOUND", "Role not found in this community"));
            };
            if !state.is_member(user_id) {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "User is not a member of this community",
                ));
            }
            if state.active_ban(user_id, now).is_some() {
                return Err(refuse(
                    400,
                    "BAD_REQUEST",
                    "User is banned from this community",
                ));
            }
            let st = standing(owner, state, &me);
            st.below(role.position)?;
            st.holds(&action_names(&role).into_iter().collect::<Vec<_>>())?;
            may_change_roles_of(state, &st, &me, user_id)?;
            state
                .holders
                .entry(user_id.to_owned())
                .or_default()
                .insert(role_id.to_owned());
            Ok(role.name)
        })?;
        emit(
            &inner,
            &community_id,
            "roleAssigned",
            json!({
                "communityId": community_id,
                "userId": user_id,
                "roleId": role_id,
                "roleName": name,
            }),
        );
        Ok(StatusCode::NO_CONTENT.into_response())
    });
    reply(&inner, result)
}

async fn unassign(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((community_id, user_id, role_id)): Path<(String, String, String)>,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let result = rbac::guard(&inner, &me, &community_id, &["UPDATE_MEMBER"]).and_then(|()| {
        community_or_404(&inner, &community_id, |state, _| {
            if let Some(role) = state.roles.iter().find(|role| role.id == role_id).cloned() {
                let st = standing(owner, state, &me);
                st.below(role.position)?;
                may_change_roles_of(state, &st, &me, &user_id)?;
            }
            if let Some(held) = state.holders.get_mut(&user_id) {
                held.remove(&role_id);
            }
            Ok(())
        })?;
        emit(
            &inner,
            &community_id,
            "roleUnassigned",
            json!({ "communityId": community_id, "userId": user_id, "roleId": role_id }),
        );
        Ok(StatusCode::NO_CONTENT.into_response())
    });
    reply(&inner, result)
}

// ----- Channel overrides -------------------------------------------------------------------------

/// The actions an override can carry (`OVERWRITABLE_ACTIONS`).
const OVERWRITABLE: &[&str] = &[
    "CREATE_MESSAGE",
    "ATTACH_FILES",
    "CREATE_REACTION",
    "PIN_MESSAGE",
    "UNPIN_MESSAGE",
    "DELETE_ANY_MESSAGE",
    "JOIN_CHANNEL",
    "SPEAK",
    "VIDEO",
    "SCREEN_SHARE",
    "MUTE_PARTICIPANT",
    "CAPTURE_REPLAY",
    "READ_SOUNDBOARD_SOUND",
];

fn overwrites_json(channel_id: &str, overwrites: Option<&Overwrites>) -> Value {
    let (preset, rows) = overwrites.map_or((ChannelPreset::Normal, Vec::new()), |o| {
        (o.preset.clone(), o.rows.clone())
    });
    json!({
        "channelId": channel_id,
        "preset": preset,
        "overwrites": rows,
    })
}

async fn overwrites(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
) -> Response {
    let me = actor(&inner, &headers);
    let Some(community_id) = rbac::community_of_channel(&inner, &channel_id) else {
        return inner.error(404, "NOT_FOUND", "Channel not found", false);
    };
    let result =
        rbac::guard(&inner, &me, &community_id, &["MANAGE_CHANNEL_PERMISSIONS"]).map(|()| {
            let rbac = crate::lock(&inner.rbac);
            json_response(
                StatusCode::OK,
                overwrites_json(&channel_id, rbac.overwrites.get(&channel_id)),
            )
        });
    reply(&inner, result)
}

/// `replaceOverwrites`: the rows' shape, then what the actor may change (owners anything).
async fn replace_overwrites(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    body: Bytes,
) -> Response {
    let me = actor(&inner, &headers);
    let owner = rbac::is_owner(&inner, &me);
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(community_id) = rbac::community_of_channel(&inner, &channel_id) else {
        return inner.error(404, "NOT_FOUND", "Channel not found", false);
    };
    let result = rbac::guard(&inner, &me, &community_id, &["MANAGE_CHANNEL_PERMISSIONS"])
        .and_then(|()| {
            let preset: ChannelPreset =
                serde_json::from_value(body["preset"].clone()).unwrap_or(ChannelPreset::Custom);
            let mut rows = Vec::new();
            let mut everyone = 0;
            let mut role_ids = BTreeSet::new();
            for row in body["overwrites"].as_array().into_iter().flatten() {
                let target = row["targetType"].as_str().unwrap_or_default();
                let role_id = row["roleId"].as_str().map(str::to_owned);
                let allow = names(row.get("allow")).unwrap_or_default();
                let deny = names(row.get("deny")).unwrap_or_default();
                let target_type = match target {
                    "EVERYONE" => {
                        if role_id.is_some() {
                            return Err(refuse(
                                400,
                                "BAD_REQUEST",
                                "An EVERYONE overwrite has no roleId",
                            ));
                        }
                        everyone += 1;
                        if everyone > 1 {
                            return Err(refuse(
                                400,
                                "BAD_REQUEST",
                                "Only one EVERYONE overwrite allowed",
                            ));
                        }
                        OverwriteTarget::Everyone
                    }
                    "ROLE" => {
                        let Some(role_id) = &role_id else {
                            return Err(refuse(
                                400,
                                "BAD_REQUEST",
                                "A ROLE overwrite needs a roleId",
                            ));
                        };
                        if !role_ids.insert(role_id.clone()) {
                            return Err(refuse(
                                400,
                                "BAD_REQUEST",
                                format!("Duplicate overwrite for role {role_id}"),
                            ));
                        }
                        OverwriteTarget::Role
                    }
                    _ => {
                        return Err(refuse(
                            400,
                            "BAD_REQUEST",
                            "Member overwrites are not supported yet",
                        ));
                    }
                };
                if let Some(action) = allow
                    .iter()
                    .chain(&deny)
                    .find(|action| !OVERWRITABLE.contains(&action.as_str()))
                {
                    return Err(refuse(
                        400,
                        "BAD_REQUEST",
                        format!("{action} can't be overwritten per channel"),
                    ));
                }
                let both: Vec<&str> = allow
                    .iter()
                    .filter(|action| deny.contains(action))
                    .map(String::as_str)
                    .collect();
                if !both.is_empty() {
                    return Err(refuse(
                        400,
                        "BAD_REQUEST",
                        format!("Actions both allowed and denied: {}", both.join(", ")),
                    ));
                }
                rows.push(ChannelOverwriteDto {
                    allow: allow.iter().map(|name| rbac::action(name)).collect(),
                    deny: deny.iter().map(|name| rbac::action(name)).collect(),
                    role_id,
                    target_type,
                });
            }
            community_or_404(&inner, &community_id, |state, rbac| {
                if role_ids
                    .iter()
                    .any(|id| !state.roles.iter().any(|role| role.id == *id))
                {
                    return Err(refuse(
                        400,
                        "BAD_REQUEST",
                        "Every role must belong to the channel’s community",
                    ));
                }
                if !owner {
                    // Only actions the actor holds, on roles below them.
                    let held = state.actions_of(&me);
                    let st = standing(owner, state, &me);
                    let missing: BTreeSet<String> = rows
                        .iter()
                        .flat_map(|row| row.allow.iter().chain(&row.deny))
                        .map(|action| action.as_str().into_owned())
                        .filter(|action| !held.contains(action))
                        .collect();
                    if !missing.is_empty() {
                        return Err(refuse(
                            403,
                            "FORBIDDEN",
                            format!(
                                "You can't change permissions you don't have: {}",
                                missing.into_iter().collect::<Vec<_>>().join(", ")
                            ),
                        ));
                    }
                    let outranked: Vec<String> = rows
                        .iter()
                        .filter_map(|row| row.role_id.as_ref())
                        .filter_map(|id| state.roles.iter().find(|role| role.id == *id))
                        .filter(|role| !st.top && role.position <= st.best)
                        .map(|role| role.name.clone())
                        .collect();
                    if !outranked.is_empty() {
                        return Err(refuse(
                            403,
                            "FORBIDDEN",
                            format!(
                                "You can only change overwrites for roles below your highest role: {}",
                                outranked.join(", ")
                            ),
                        ));
                    }
                }
                rbac.overwrites.insert(
                    channel_id.clone(),
                    Overwrites {
                        preset: preset.clone(),
                        rows: rows.clone(),
                    },
                );
                Ok(())
            })?;
            emit(
                &inner,
                &community_id,
                "channelPermissionsUpdated",
                json!({ "communityId": community_id, "channelId": channel_id }),
            );
            let rbac = crate::lock(&inner.rbac);
            Ok(json_response(
                StatusCode::OK,
                overwrites_json(&channel_id, rbac.overwrites.get(&channel_id)),
            ))
        });
    reply(&inner, result)
}
