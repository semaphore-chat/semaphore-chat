//! W6-A's routes: instance settings, stats, instance storage and LiveKit health. State lives in
//! `crate::w6::instance`.
//!
//! Each handler keeps the backend's order: the RBAC guard (`crate::w6::allows` with the
//! controller's action, before any lock), then the service's rules
//! (`backend/src/instance/instance.controller.ts`, `backend/src/instance/instance.service.ts`,
//! `backend/src/storage/storage-quota.controller.ts`, `backend/src/livekit/livekit.controller.ts`).

use super::{bearer_token, json_response, parse};
use crate::w6::instance;
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::get;
use serde_json::Value;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route(
            "/api/instance/settings",
            get(get_settings).patch(update_settings),
        )
        .route("/api/instance/stats", get(stats))
        .route("/api/storage/instance", get(instance_storage))
        .route("/api/livekit/health", get(livekit_health))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/instance/settings") => "InstanceController_getSettings",
        ("PATCH", "/api/instance/settings") => "InstanceController_updateSettings",
        ("GET", "/api/instance/stats") => "InstanceController_getStats",
        ("GET", "/api/storage/instance") => "StorageQuotaController_getInstanceStorageStats",
        ("GET", "/api/livekit/health") => "LivekitController_validateConfiguration",
        _ => return None,
    })
}

// ----- shared ---------------------------------------------------------------------------------

fn me(inner: &Inner, headers: &HeaderMap) -> String {
    inner.user_of(bearer_token(headers))
}

/// `RbacGuard`: the instance action, or the answer it gives.
fn allows(inner: &Inner, user: &str, action: &str) -> Result<(), Response> {
    if crate::w6::allows(inner, user, action) {
        Ok(())
    } else {
        Err(inner.error(403, "FORBIDDEN", "Forbidden resource", false))
    }
}

/// `PATCH /instance/settings`, validated as `UpdateInstanceSettingsDto`: the fields present, as
/// they'll be applied, or the class-validator message.
fn validated(body: &Value) -> Result<Value, String> {
    let Some(fields) = body.as_object() else {
        return Err("the request body must be an object".into());
    };
    let mut changes = serde_json::Map::new();
    if let Some(value) = fields.get("name") {
        let Some(name) = value.as_str() else {
            return Err("name must be a string".into());
        };
        if name.chars().count() > 100 {
            return Err("name must be shorter than or equal to 100 characters".into());
        }
        changes.insert("name".into(), Value::from(name));
    }
    if let Some(value) = fields.get("description") {
        let Some(description) = value.as_str() else {
            return Err("description must be a string".into());
        };
        if description.chars().count() > 500 {
            return Err("description must be shorter than or equal to 500 characters".into());
        }
        changes.insert("description".into(), Value::from(description));
    }
    if let Some(value) = fields.get("registrationMode") {
        let Some(mode) = value.as_str() else {
            return Err(registration_modes());
        };
        if !matches!(mode, "OPEN" | "INVITE_ONLY" | "CLOSED") {
            return Err(registration_modes());
        }
        changes.insert("registrationMode".into(), Value::from(mode));
    }
    if let Some(value) = fields.get("defaultStorageQuotaBytes") {
        let Some(quota) = value.as_i64() else {
            return Err(not_a_number("defaultStorageQuotaBytes"));
        };
        if quota < 1_073_741_824 {
            return Err("defaultStorageQuotaBytes must not be less than 1073741824".into());
        }
        changes.insert("defaultStorageQuotaBytes".into(), Value::from(quota));
    }
    if let Some(value) = fields.get("maxFileSizeBytes") {
        let Some(max) = value.as_i64() else {
            return Err(not_a_number("maxFileSizeBytes"));
        };
        if max < 1_048_576 {
            return Err("maxFileSizeBytes must not be less than 1048576".into());
        }
        if max > 1_073_741_824 {
            return Err("maxFileSizeBytes must not be greater than 1073741824".into());
        }
        changes.insert("maxFileSizeBytes".into(), Value::from(max));
    }
    Ok(Value::Object(changes))
}

fn registration_modes() -> String {
    "registrationMode must be one of the following values: OPEN, INVITE_ONLY, CLOSED".into()
}

fn not_a_number(field: &str) -> String {
    format!("{field} must be a number conforming to the specified constraints")
}

// ----- handlers -------------------------------------------------------------------------------

async fn get_settings(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user, "READ_INSTANCE_SETTINGS") {
        return response;
    }
    let answer = {
        let mut instance = lock(&inner.w6_instance);
        instance.seed(&inner);
        instance.settings_json()
    };
    json_response(StatusCode::OK, answer)
}

async fn update_settings(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user, "UPDATE_INSTANCE_SETTINGS") {
        return response;
    }
    let request = match parse(&body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let changes = match validated(&request) {
        Ok(changes) => changes,
        Err(message) => return inner.error(400, "VALIDATION_FAILED", message, false),
    };
    let now = inner.now();
    let answer = {
        let mut instance = lock(&inner.w6_instance);
        instance.seed(&inner);
        instance.update(&changes, now);
        instance.settings_json()
    };
    json_response(StatusCode::OK, answer)
}

async fn stats(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user, "READ_INSTANCE_STATS") {
        return response;
    }
    json_response(StatusCode::OK, instance::stats_json(&inner))
}

async fn instance_storage(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user, "READ_INSTANCE_STATS") {
        return response;
    }
    let answer = {
        let mut instance = lock(&inner.w6_instance);
        instance.seed(&inner);
        instance.storage.clone()
    };
    json_response(StatusCode::OK, answer)
}

async fn livekit_health(State(inner): State<Arc<Inner>>, _headers: HeaderMap) -> Response {
    let answer = {
        let mut instance = lock(&inner.w6_instance);
        instance.seed(&inner);
        instance.livekit_json()
    };
    json_response(StatusCode::OK, answer)
}
