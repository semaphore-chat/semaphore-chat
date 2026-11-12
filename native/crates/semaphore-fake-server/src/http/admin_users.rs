//! W6-B's routes: the admin users list, one user, owner role, ban, password and delete. State
//! lives in `crate::w6::users` (and role changes in `inner.accounts`, so the rest of the fake sees
//! them).
//!
//! Each handler keeps the backend's order: `ParseUUIDPipe` on path ids (a scenario's own ids pass),
//! the RBAC guard (`crate::w6::allows` with the controller's action), then the service's checks and
//! messages, status codes and socket events (`backend/src/user/user.service.ts`,
//! `backend/src/roles/instance-roles.service.ts:assertMayManageUser`). Instance role assignment and
//! its routes are W6-E's.

use super::{bearer_token, json_response, parse, typed};
use crate::w6::users::Users;
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, patch};
use semaphore_wire::enums::InstanceRole;
use semaphore_wire::types::{
    AdminUserEntity, AdminUserListResponseDto, SetUserBanStatusDto, SuccessResponseDto,
    UpdateUserRoleDto, UserEntity,
};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;

/// The default Instance Admin role's actions: a user holding every one has full authority.
const ADMIN_ACTIONS: [&str; 12] = [
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

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/users/admin/list", get(list_users))
        .route("/api/users/admin/{id}", get(get_user).delete(delete_user))
        .route("/api/users/admin/{id}/role", patch(update_role))
        .route("/api/users/admin/{id}/ban", patch(set_ban_status))
        .route("/api/users/admin/{id}/password", patch(set_user_password))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/users/admin/list") => "UserController_findAllUsersAdmin",
        ("GET", "/api/users/admin/{id}") => "UserController_getUserByIdAdmin",
        ("DELETE", "/api/users/admin/{id}") => "UserController_deleteUser",
        ("PATCH", "/api/users/admin/{id}/role") => "UserController_updateUserRole",
        ("PATCH", "/api/users/admin/{id}/ban") => "UserController_setBanStatus",
        ("PATCH", "/api/users/admin/{id}/password") => "UserController_setUserPassword",
        _ => return None,
    })
}

// ----- shared ---------------------------------------------------------------------------------

fn me(inner: &Inner, headers: &HeaderMap) -> String {
    inner.user_of(bearer_token(headers))
}

fn denial(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(403, "FORBIDDEN", message, false)
}

fn not_found(inner: &Inner) -> Response {
    inner.error(404, "NOT_FOUND", "User not found", false)
}

fn invalid(inner: &Inner, message: &str) -> Response {
    inner.error(400, "VALIDATION_FAILED", message, false)
}

fn guard(inner: &Inner, actor: &str, action: &str) -> Result<(), Response> {
    if crate::w6::allows(inner, actor, action) {
        Ok(())
    } else {
        Err(inner.error(403, "FORBIDDEN", "Forbidden resource", false))
    }
}

/// `ParseUUIDPipe`: a scenario's own ids pass as well.
fn check_uuid(inner: &Inner, id: &str, known: bool) -> Result<(), Response> {
    if crate::social::valid_id(id, known) {
        Ok(())
    } else {
        Err(super::dms::bad_id(inner, "uuid"))
    }
}

macro_rules! tri {
    ($result:expr) => {
        match $result {
            Ok(value) => value,
            Err(response) => return response,
        }
    };
}

fn ok(value: impl serde::Serialize) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(value).expect("a response serializes"),
    )
}

/// Every user the instance has: the scenario's, plus the ones registered here. `user_entity`
/// reads them, so a profile edit or a role change is seen.
fn every_user(inner: &Inner) -> Vec<UserEntity> {
    let ids: Vec<String> = {
        let mut ids = vec![inner.scenario.me.id.clone()];
        ids.extend(inner.scenario.users.iter().map(|user| user.id.clone()));
        ids.extend(lock(&inner.accounts).users.keys().cloned());
        ids.sort();
        ids.dedup();
        ids
    };
    ids.iter().filter_map(|id| inner.user_entity(id)).collect()
}

/// Whether the user may be managed by `actor`: below full authority, they must hold every
/// instance action the target holds (`InstanceRolesService.assertMayManageUser`).
fn may_manage(inner: &Inner, actor: &str, target: &str) -> Result<(), Response> {
    if actor == target || has_full_authority(inner, actor) {
        return Ok(());
    }
    let mine = crate::w6::roles::held(inner, actor);
    let theirs = crate::w6::roles::held(inner, target);
    if theirs.iter().any(|action| !mine.contains(action)) {
        return Err(denial(
            inner,
            "Cannot manage a user who holds permissions you do not have",
        ));
    }
    Ok(())
}

fn has_full_authority(inner: &Inner, user_id: &str) -> bool {
    if crate::rbac::is_owner(inner, user_id) {
        return true;
    }
    let held = crate::w6::roles::held(inner, user_id);
    ADMIN_ACTIONS.iter().all(|action| held.contains(*action))
}

/// The user as the admin API shows them: the state's ban, the scenario's own values.
fn admin_user(inner: &Inner, user: &UserEntity, users: &Users) -> AdminUserEntity {
    let ban = users.ban(&user.id);
    AdminUserEntity {
        avatar_url: user.avatar_url.clone(),
        banner_url: user.banner_url.clone(),
        bio: user.bio.clone(),
        banned: ban.is_some(),
        banned_at: ban.map(|ban| ban.at),
        banned_by_id: ban.map(|ban| ban.by.clone()),
        created_at: inner.scenario.epoch,
        display_name: user.display_name.clone(),
        email: Some(format!("{}@example.invalid", user.username)),
        id: user.id.clone(),
        last_seen: user.last_seen,
        role: user.role.clone(),
        status: user.status.clone(),
        status_updated_at: None,
        storage_quota_bytes: 53_687_091_200,
        storage_used_bytes: 0,
        username: user.username.clone(),
        verified: true,
    }
}

/// The user, when it exists and wasn't deleted: the state's view, else 404.
fn find_user(inner: &Inner, id: &str) -> Option<(UserEntity, bool)> {
    let user = inner.user_entity(id)?;
    let deleted = lock(&inner.w6_users).is_deleted(id);
    Some((user, deleted))
}

/// Ends every live session of the user, and returns the tokens whose sockets must hear the end.
fn revoke_sessions(inner: &Inner, user_id: &str) -> Vec<String> {
    let now = inner.now();
    let mut accounts = lock(&inner.accounts);
    let mut tokens = Vec::new();
    for index in accounts.live_sessions_of(user_id, now) {
        accounts.revoke(index);
        tokens.extend(accounts.sessions[index].tokens.clone());
    }
    tokens
}

// ----- the routes -----------------------------------------------------------------------------

async fn list_users(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let actor = me(&inner, &headers);
    let limit = match query.get("limit") {
        None => 50usize,
        Some(raw) => match raw.parse::<usize>() {
            Ok(limit) if (1..=100).contains(&limit) => limit,
            _ => return invalid(&inner, "limit must be between 1 and 100"),
        },
    };
    let banned = match query.get("banned").map(String::as_str) {
        None => None,
        Some("true") => Some(true),
        Some("false") => Some(false),
        Some(_) => return invalid(&inner, "banned must be 'true' or 'false'"),
    };
    let role = match query.get("role").map(String::as_str) {
        None => None,
        Some("OWNER") => Some(InstanceRole::Owner),
        Some("USER") => Some(InstanceRole::User),
        Some(_) => return invalid(&inner, "role must be OWNER or USER"),
    };
    tri!(guard(&inner, &actor, "READ_USER"));
    let token = query.get("continuationToken").cloned();

    let all = every_user(&inner);
    let search = query.get("search").map(|search| search.to_lowercase());
    let mut users: Vec<(UserEntity, AdminUserEntity)> = {
        let state = lock(&inner.w6_users);
        all.into_iter()
            .filter(|user| !state.is_deleted(&user.id))
            .map(|user| {
                let row = admin_user(&inner, &user, &state);
                (user, row)
            })
            .filter(|(_, row)| banned.is_none_or(|banned| row.banned == banned))
            .filter(|(_, row)| role.as_ref().is_none_or(|role| row.role == *role))
            .filter(|(user, row)| {
                search.as_ref().is_none_or(|search| {
                    user.username.to_lowercase().contains(search)
                        || user
                            .display_name
                            .as_ref()
                            .is_some_and(|name| name.to_lowercase().contains(search))
                        || row
                            .email
                            .as_ref()
                            .is_some_and(|email| email.to_lowercase().contains(search))
                })
            })
            .collect()
    };
    // Newest first, then by id: the scenario's users share one `createdAt`.
    users.sort_by(|(a, row_a), (b, row_b)| {
        row_b
            .created_at
            .cmp(&row_a.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    let start = match &token {
        None => 0,
        Some(token) => match users.iter().position(|(user, _)| &user.id == token) {
            Some(index) => index + 1,
            None => {
                return ok(AdminUserListResponseDto {
                    users: Vec::new(),
                    continuation_token: None,
                });
            }
        },
    };
    let page: Vec<AdminUserEntity> = users
        .iter()
        .skip(start)
        .take(limit)
        .map(|(_, row)| row.clone())
        .collect();
    let more = users.len() > start + page.len();
    let continuation_token = more
        .then(|| page.last().map(|row| row.id.clone()))
        .flatten();
    ok(AdminUserListResponseDto {
        users: page,
        continuation_token,
    })
}

async fn get_user(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let actor = me(&inner, &headers);
    let known = inner.user_entity(&id).is_some();
    tri!(check_uuid(&inner, &id, known));
    tri!(guard(&inner, &actor, "READ_USER"));
    let Some((user, deleted)) = find_user(&inner, &id) else {
        return not_found(&inner);
    };
    if deleted {
        return not_found(&inner);
    }
    ok(admin_user(&inner, &user, &lock(&inner.w6_users)))
}

async fn update_role(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let actor = me(&inner, &headers);
    let known = inner.user_entity(&id).is_some();
    tri!(check_uuid(&inner, &id, known));
    tri!(guard(&inner, &actor, "UPDATE_USER"));
    let change: UpdateUserRoleDto = tri!(typed(&body));
    let Some((user, deleted)) = find_user(&inner, &id) else {
        return not_found(&inner);
    };
    if deleted {
        return not_found(&inner);
    }
    let changes_owner = (user.role == InstanceRole::Owner) != (change.role == InstanceRole::Owner);
    if !changes_owner {
        return ok(admin_user(&inner, &user, &lock(&inner.w6_users)));
    }
    if !crate::rbac::is_owner(&inner, &actor) {
        return denial(
            &inner,
            "Only an instance owner can grant or remove the owner role",
        );
    }
    if change.role != InstanceRole::Owner {
        let another_owner = every_user(&inner)
            .iter()
            .any(|other| other.id != id && other.role == InstanceRole::Owner);
        if !another_owner {
            return denial(
                &inner,
                "Cannot demote the last owner. Promote another user first.",
            );
        }
    }
    // Written where the rest of the fake reads users, so the owner bypass follows.
    let mut updated = user;
    updated.role = change.role;
    lock(&inner.accounts)
        .users
        .insert(id.clone(), updated.clone());
    ok(admin_user(&inner, &updated, &lock(&inner.w6_users)))
}

async fn set_ban_status(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let actor = me(&inner, &headers);
    let known = inner.user_entity(&id).is_some();
    tri!(check_uuid(&inner, &id, known));
    tri!(guard(&inner, &actor, "BAN_USER"));
    let change: SetUserBanStatusDto = tri!(typed(&body));
    let Some((user, deleted)) = find_user(&inner, &id) else {
        return not_found(&inner);
    };
    if deleted {
        return not_found(&inner);
    }
    if id == actor {
        return denial(&inner, "Cannot ban yourself");
    }
    if user.role == InstanceRole::Owner {
        return denial(&inner, "Cannot ban an instance owner");
    }
    tri!(may_manage(&inner, &actor, &id));

    if change.banned {
        let now = inner.now();
        let tokens = revoke_sessions(&inner, &id);
        lock(&inner.w6_users).set_ban(&id, &actor, now);
        inner.emit_to_tokens(
            &tokens,
            "sessionTerminated",
            json!({ "reason": "ACCOUNT_BANNED" }),
        );
    } else {
        lock(&inner.w6_users).clear_ban(&id);
    }
    ok(admin_user(&inner, &user, &lock(&inner.w6_users)))
}

async fn set_user_password(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let actor = me(&inner, &headers);
    let known = inner.user_entity(&id).is_some();
    tri!(check_uuid(&inner, &id, known));
    tri!(guard(&inner, &actor, "UPDATE_USER"));
    // Not `typed`: the DTO's password type refuses a short one in the contract's words, and the
    // backend answers with its own.
    let body = tri!(parse(&body));
    let Some(password) = body.get("password").and_then(|value| value.as_str()) else {
        return invalid(&inner, "The request body does not match the contract");
    };
    let length = password.chars().count();
    if length < 8 {
        return invalid(&inner, "Password must be at least 8 characters");
    }
    if length > 128 {
        return invalid(&inner, "Password must be at most 128 characters");
    }
    let Some((user, deleted)) = find_user(&inner, &id) else {
        return not_found(&inner);
    };
    if deleted {
        return not_found(&inner);
    }
    if user.role == InstanceRole::Owner && id != actor && !crate::rbac::is_owner(&inner, &actor) {
        return denial(
            &inner,
            "Only an instance owner can reset another owner's password",
        );
    }
    tri!(may_manage(&inner, &actor, &id));

    let tokens = revoke_sessions(&inner, &id);
    inner.emit_to_tokens(
        &tokens,
        "sessionTerminated",
        json!({ "reason": "PASSWORD_CHANGED" }),
    );
    ok(admin_user(&inner, &user, &lock(&inner.w6_users)))
}

async fn delete_user(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let actor = me(&inner, &headers);
    let known = inner.user_entity(&id).is_some();
    tri!(check_uuid(&inner, &id, known));
    tri!(guard(&inner, &actor, "DELETE_USER"));
    let Some((user, deleted)) = find_user(&inner, &id) else {
        return not_found(&inner);
    };
    if deleted {
        return not_found(&inner);
    }
    if id == actor {
        return denial(&inner, "Cannot delete your own account through admin panel");
    }
    if user.role == InstanceRole::Owner {
        return denial(&inner, "Cannot delete an instance owner");
    }
    tri!(may_manage(&inner, &actor, &id));

    let tokens = revoke_sessions(&inner, &id);
    lock(&inner.w6_users).delete(&id);
    inner.emit_to_tokens(
        &tokens,
        "sessionTerminated",
        json!({ "reason": "ACCOUNT_DELETED" }),
    );
    ok(SuccessResponseDto { success: true })
}
