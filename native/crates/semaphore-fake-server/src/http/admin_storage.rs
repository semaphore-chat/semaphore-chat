//! W6-C's routes: per-user storage, quotas and recalculation. State lives in `crate::w6::storage`.
//!
//! Each handler keeps the backend's order: the RBAC guard (`crate::w6::allows` with
//! MANAGE_USER_STORAGE, before any lock), then the route's rules
//! (`backend/src/storage-quota/storage-quota.controller.ts`,
//! `backend/src/storage-quota/storage-quota.service.ts`): `ParseUUIDPipe` on path ids, the service's
//! filter and order, its messages and status codes.

use super::{bearer_token, dms::bad_id, json_response};
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, patch, post};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/storage/users", get(list_users))
        .route("/api/storage/users/{userId}", get(user_storage))
        .route("/api/storage/users/{userId}/quota", patch(update_quota))
        .route("/api/storage/users/{userId}/recalculate", post(recalculate))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/storage/users") => "StorageQuotaController_getUsersStorageList",
        ("GET", "/api/storage/users/{userId}") => "StorageQuotaController_getUserStorageStats",
        ("PATCH", "/api/storage/users/{userId}/quota") => "StorageQuotaController_updateUserQuota",
        ("POST", "/api/storage/users/{userId}/recalculate") => {
            "StorageQuotaController_recalculateUserStorage"
        }
        _ => return None,
    })
}

// ----- shared ---------------------------------------------------------------------------------

fn me(inner: &Inner, headers: &HeaderMap) -> String {
    inner.user_of(bearer_token(headers))
}

/// `RbacGuard`: MANAGE_USER_STORAGE, or the answer it gives (the owner passes it).
fn allows(inner: &Inner, user: &str) -> Result<(), Response> {
    if crate::w6::allows(inner, user, "MANAGE_USER_STORAGE") {
        Ok(())
    } else {
        Err(inner.error(403, "FORBIDDEN", "Forbidden resource", false))
    }
}

/// `ParseUUIDPipe` on a path id.
fn check_uuid(inner: &Inner, id: &str) -> Result<(), Response> {
    if crate::social::valid_id(id, false) {
        Ok(())
    } else {
        Err(bad_id(inner, "uuid"))
    }
}

fn not_found(inner: &Inner) -> Response {
    inner.error(404, "NOT_FOUND", "User not found", false)
}

/// `DefaultValuePipe` and `ParseIntPipe`: the default when absent, `400 BAD_REQUEST` when it isn't
/// a number.
fn int_param(
    inner: &Inner,
    query: &HashMap<String, String>,
    name: &str,
    default: i64,
) -> Result<i64, Response> {
    match query.get(name) {
        None => Ok(default),
        Some(raw) => raw.parse().map_err(|_| {
            inner.error(
                400,
                "BAD_REQUEST",
                "Validation failed (numeric string is expected)",
                false,
            )
        }),
    }
}

// ----- handlers -------------------------------------------------------------------------------

async fn list_users(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user) {
        return response;
    }
    let skip = match int_param(&inner, &query, "skip", 0) {
        Ok(skip) => skip,
        Err(response) => return response,
    };
    let take = match int_param(&inner, &query, "take", 20) {
        Ok(take) => take,
        Err(response) => return response,
    };
    let min_percent_used = match int_param(&inner, &query, "minPercentUsed", 0) {
        Ok(min_percent_used) => min_percent_used,
        Err(response) => return response,
    };
    let answer = {
        let mut storage = lock(&inner.w6_storage);
        storage.seed(&inner);
        storage.list(&inner, skip, take, min_percent_used)
    };
    json_response(StatusCode::OK, answer)
}

async fn user_storage(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user) {
        return response;
    }
    if let Err(response) = check_uuid(&inner, &user_id) {
        return response;
    }
    let answer = {
        let mut storage = lock(&inner.w6_storage);
        storage.seed(&inner);
        storage.row(&inner, &user_id)
    };
    match answer {
        Some(row) => json_response(StatusCode::OK, row),
        None => not_found(&inner),
    }
}

/// `PATCH /storage/users/{userId}/quota`, validated as `UpdateUserQuotaDto` (`@IsNumber`,
/// `@Min(0)`).
async fn update_quota(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
    body: Bytes,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user) {
        return response;
    }
    if let Err(response) = check_uuid(&inner, &user_id) {
        return response;
    }
    let request: Value = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(_) => {
            return inner.error(
                400,
                "VALIDATION_FAILED",
                "the request body must be an object",
                false,
            );
        }
    };
    let quota = request.get("quotaBytes").and_then(Value::as_i64);
    let Some(quota_bytes) = quota else {
        return inner.error(
            400,
            "VALIDATION_FAILED",
            "quotaBytes must be a number conforming to the specified constraints",
            false,
        );
    };
    if quota_bytes < 0 {
        return inner.error(
            400,
            "VALIDATION_FAILED",
            "quotaBytes must not be less than 0",
            false,
        );
    }
    let answer = {
        let mut storage = lock(&inner.w6_storage);
        storage.seed(&inner);
        if storage.row(&inner, &user_id).is_none() {
            None
        } else {
            storage.set_quota(&user_id, quota_bytes);
            storage.row(&inner, &user_id)
        }
    };
    match answer {
        Some(row) => json_response(StatusCode::OK, row),
        None => not_found(&inner),
    }
}

/// `POST /storage/users/{userId}/recalculate`: the row, recalculated (the fake's usage is already
/// the files' size, so nothing changes).
async fn recalculate(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(user_id): Path<String>,
) -> Response {
    let user = me(&inner, &headers);
    if let Err(response) = allows(&inner, &user) {
        return response;
    }
    if let Err(response) = check_uuid(&inner, &user_id) {
        return response;
    }
    let answer = {
        let mut storage = lock(&inner.w6_storage);
        storage.seed(&inner);
        storage.row(&inner, &user_id)
    };
    match answer {
        Some(row) => json_response(StatusCode::OK, row),
        None => not_found(&inner),
    }
}
