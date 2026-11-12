//! W6-E's routes: instance roles and their users. State lives in `crate::w6::roles`.
//!
//! Each handler keeps the backend's order (`backend/src/roles/roles.controller.ts`,
//! `backend/src/roles/instance-roles.service.ts` at 3b1e2684): `ParseUUIDPipe` on path ids, the
//! RBAC guard (`crate::w6::allows` with the controller's action), then the service's checks,
//! messages and status codes. Below full authority (`InstanceRolesService.assertMayHandle`) an
//! actor may only grant, edit or delete roles whose actions they hold.

use super::{bearer_token, json_response, parse};
use crate::Inner;
use crate::w6::roles;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use semaphore_wire::enums::RbacAction;
use serde_json::Value;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/roles/instance/all", get(list))
        .route("/api/roles/instance", post(create))
        .route(
            "/api/roles/instance/{roleId}",
            axum::routing::put(update).delete(delete),
        )
        .route("/api/roles/instance/{roleId}/users", get(role_users))
        .route("/api/roles/instance/{roleId}/assign", post(assign))
        .route(
            "/api/roles/instance/{roleId}/users/{userId}",
            axum::routing::delete(unassign),
        )
        .route(
            "/api/roles/user/{userId}/instance",
            get(user_instance_roles),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/roles/instance/all") => "RolesController_getInstanceRoles",
        ("POST", "/api/roles/instance") => "RolesController_createInstanceRole",
        ("PUT", "/api/roles/instance/{roleId}") => "RolesController_updateInstanceRole",
        ("DELETE", "/api/roles/instance/{roleId}") => "RolesController_deleteInstanceRole",
        ("GET", "/api/roles/instance/{roleId}/users") => "RolesController_getInstanceRoleUsers",
        ("POST", "/api/roles/instance/{roleId}/assign") => "RolesController_assignInstanceRole",
        ("DELETE", "/api/roles/instance/{roleId}/users/{userId}") => {
            "RolesController_removeInstanceRole"
        }
        ("GET", "/api/roles/user/{userId}/instance") => "RolesController_getUserInstanceRoles",
        _ => return None,
    })
}

// ----- shared ---------------------------------------------------------------------------------

fn me(inner: &Inner, headers: &HeaderMap) -> String {
    inner.user_of(bearer_token(headers))
}

/// Nest's answer when the RBAC guard says no.
fn denied(inner: &Inner) -> Response {
    inner.error(403, "FORBIDDEN", "Forbidden resource", false)
}

/// `RbacGuard`: the instance action, or the answer it gives.
fn allows(inner: &Inner, user: &str, action: &str) -> Result<(), Response> {
    if crate::w6::allows(inner, user, action) {
        Ok(())
    } else {
        Err(denied(inner))
    }
}

/// `ParseUUIDPipe` on a path id: a malformed one is `dms::bad_id`, the fake's usual answer; a
/// scenario's own id (`known`) passes as it does elsewhere.
fn check_uuid(inner: &Inner, id: &str, known: bool) -> Result<(), Response> {
    if crate::social::valid_id(id, known) {
        Ok(())
    } else {
        Err(super::dms::bad_id(inner, "uuid"))
    }
}

fn check_role_id(inner: &Inner, role_id: &str) -> Result<(), Response> {
    check_uuid(inner, role_id, roles::role(inner, role_id).is_some())
}

fn conflict(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(409, "CONFLICT", message, false)
}

fn bad_request(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(400, "BAD_REQUEST", message, false)
}

fn forbidden(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(403, "FORBIDDEN", message, false)
}

fn not_found(inner: &Inner, message: impl Into<String>) -> Response {
    inner.error(404, "NOT_FOUND", message, false)
}

fn no_content() -> Response {
    StatusCode::NO_CONTENT.into_response()
}

fn ok(value: impl serde::Serialize) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(value).expect("a response serializes"),
    )
}

/// `assertMayHandle`: below full authority, every one of `actions` must be held.
fn may_handle(inner: &Inner, user: &str, actions: &[RbacAction]) -> Result<(), Response> {
    if roles::full_authority(inner, user) {
        return Ok(());
    }
    let held = roles::held(inner, user);
    let missing: Vec<String> = actions
        .iter()
        .map(|action| action.as_str().into_owned())
        .filter(|name| !held.contains(name))
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(forbidden(
            inner,
            format!(
                "Cannot grant permissions you do not have: {}",
                missing.join(", ")
            ),
        ))
    }
}

/// The actions of `actions` that no instance role may hold, as wire names, in their order.
fn invalid_instance_actions(actions: &[RbacAction]) -> Vec<String> {
    actions
        .iter()
        .map(|action| action.as_str().into_owned())
        .filter(|name| !roles::INSTANCE_ADMIN_ACTIONS.contains(&name.as_str()))
        .collect()
}

/// A `name` as `CreateRoleDto`'s validators take it: trimmed, 1 to 50 characters.
fn checked_name(value: Option<&Value>) -> Result<String, String> {
    let Some(Value::String(name)) = value else {
        return Err("name must be a string".into());
    };
    let name = name.trim().to_owned();
    if name.is_empty() {
        return Err("Role name must not be empty".into());
    }
    if name.chars().count() > 50 {
        return Err("Role name must not exceed 50 characters".into());
    }
    Ok(name)
}

/// `actions` as `CreateRoleDto`'s validators take them: a non-empty array of names.
fn checked_actions(value: Option<&Value>) -> Result<Vec<RbacAction>, String> {
    let Some(Value::Array(actions)) = value else {
        return Err("actions must be an array".into());
    };
    if actions.is_empty() {
        return Err("Role must have at least one permission".into());
    }
    let mut checked = Vec::with_capacity(actions.len());
    for action in actions {
        let Some(name) = action.as_str() else {
            return Err("each value in actions must be a string".into());
        };
        checked.push(crate::rbac::action(name));
    }
    Ok(checked)
}

// ----- handlers -------------------------------------------------------------------------------

async fn list(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user, "READ_INSTANCE_SETTINGS") {
        return response;
    }
    json_response(StatusCode::OK, roles::all_json(&inner))
}

async fn create(State(inner): State<Arc<Inner>>, headers: HeaderMap, body: Bytes) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user, "UPDATE_INSTANCE_SETTINGS") {
        return response;
    }
    let request = match parse(&body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let (name, actions) = match checked_name(request.get("name"))
        .and_then(|name| checked_actions(request.get("actions")).map(|actions| (name, actions)))
    {
        Ok(checked) => checked,
        Err(message) => {
            return inner.error(400, "VALIDATION_FAILED", message, false);
        }
    };
    let invalid = invalid_instance_actions(&actions);
    if !invalid.is_empty() {
        return bad_request(
            &inner,
            format!(
                "Actions not valid for instance roles: {}",
                invalid.join(", ")
            ),
        );
    }
    if let Err(response) = may_handle(&inner, &user, &actions) {
        return response;
    }
    if roles::name_taken(&inner, &name, None) {
        return conflict(&inner, format!("Role with name \"{name}\" already exists"));
    }
    let at = inner.now();
    let role = roles::create(&inner, name, actions, at);
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(role).expect("a role serializes"),
    )
}

async fn update(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(role_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = check_role_id(&inner, &role_id) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "UPDATE_INSTANCE_SETTINGS") {
        return response;
    }
    let request = match parse(&body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let name = match request.get("name") {
        Some(value) => match checked_name(Some(value)) {
            Ok(name) => Some(name),
            Err(message) => return inner.error(400, "VALIDATION_FAILED", message, false),
        },
        None => None,
    };
    let actions = match request.get("actions") {
        Some(value) => match checked_actions(Some(value)) {
            Ok(actions) => Some(actions),
            Err(message) => return inner.error(400, "VALIDATION_FAILED", message, false),
        },
        None => None,
    };
    let Some(role) = roles::role(&inner, &role_id) else {
        return not_found(&inner, format!("Role with ID {role_id} not found"));
    };
    if role.is_default && name.as_deref().is_some_and(|name| name != role.name) {
        return bad_request(&inner, "Cannot rename a default role");
    }
    if let Some(actions) = &actions {
        let invalid = invalid_instance_actions(actions);
        if !invalid.is_empty() {
            return bad_request(
                &inner,
                format!(
                    "Actions not valid for instance roles: {}",
                    invalid.join(", ")
                ),
            );
        }
    }
    let mut wanted = role.actions.clone();
    if let Some(actions) = &actions {
        wanted.extend(actions.iter().cloned());
    }
    if let Err(response) = may_handle(&inner, &user, &wanted) {
        return response;
    }
    if let Some(name) = &name
        && *name != role.name
        && roles::name_taken(&inner, name, Some(&role_id))
    {
        return conflict(&inner, format!("Role with name \"{name}\" already exists"));
    }
    match roles::replace(&inner, &role_id, name, actions) {
        Some(role) => ok(role),
        None => not_found(&inner, format!("Role with ID {role_id} not found")),
    }
}

async fn delete(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(role_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = check_role_id(&inner, &role_id) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "UPDATE_INSTANCE_SETTINGS") {
        return response;
    }
    let Some(role) = roles::role(&inner, &role_id) else {
        return not_found(&inner, format!("Role with ID {role_id} not found"));
    };
    if role.name == roles::INSTANCE_ADMIN_ROLE {
        return bad_request(&inner, "Cannot delete the default Instance Admin role");
    }
    let assigned = roles::assigned(&inner, &role_id).len();
    if assigned > 0 {
        return bad_request(
            &inner,
            format!(
                "Cannot delete role with {assigned} assigned user(s). Remove all role assignments first."
            ),
        );
    }
    if let Err(response) = may_handle(&inner, &user, &role.actions) {
        return response;
    }
    roles::remove(&inner, &role_id);
    no_content()
}

async fn role_users(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(role_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = check_role_id(&inner, &role_id) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "READ_USER") {
        return response;
    }
    if roles::role(&inner, &role_id).is_none() {
        return not_found(&inner, format!("Role with ID {role_id} not found"));
    }
    json_response(StatusCode::OK, roles::role_users_json(&inner, &role_id))
}

async fn assign(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(role_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = check_role_id(&inner, &role_id) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "UPDATE_USER") {
        return response;
    }
    let request = match parse(&body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let Some(user_id) = request.get("userId").and_then(Value::as_str) else {
        return inner.error(400, "VALIDATION_FAILED", "Invalid user ID format", false);
    };
    if !crate::social::valid_id(user_id, inner.scenario.user(user_id).is_some()) {
        return inner.error(400, "VALIDATION_FAILED", "Invalid user ID format", false);
    }
    let Some(role) = roles::role(&inner, &role_id) else {
        return not_found(&inner, "Role not found");
    };
    if let Err(response) = may_handle(&inner, &user, &role.actions) {
        return response;
    }
    if !roles::assign(&inner, &role_id, user_id) {
        return conflict(&inner, "User already has this instance role");
    }
    no_content()
}

async fn unassign(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((role_id, user_id)): Path<(String, String)>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = check_role_id(&inner, &role_id) {
        return response;
    }
    if let Err(response) = check_uuid(&inner, &user_id, inner.scenario.user(&user_id).is_some()) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "UPDATE_USER") {
        return response;
    }
    if let Some(role) = roles::role(&inner, &role_id)
        && let Err(response) = may_handle(&inner, &user, &role.actions)
    {
        return response;
    }
    if !roles::unassign(&inner, &role_id, &user_id) {
        return not_found(&inner, "User role assignment not found");
    }
    no_content()
}

async fn user_instance_roles(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = check_uuid(&inner, &user_id, inner.scenario.user(&user_id).is_some()) {
        return response;
    }
    if let Err(response) = allows(&inner, &user, "READ_USER") {
        return response;
    }
    json_response(StatusCode::OK, roles::instance_roles_json(&inner, &user_id))
}
