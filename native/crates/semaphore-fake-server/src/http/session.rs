//! Sign-in, refresh, sign-out, users and the public instance settings.

use super::{invalid, json_response, typed};
use crate::Inner;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use semaphore_wire::types::{LoginRequestDto, RefreshRequestDto};
use serde_json::json;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/logout", post(logout))
        .route("/api/users/profile", get(profile))
        .route("/api/users/{id}", get(user_by_id))
        .route("/api/instance/settings/public", get(public_settings))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/auth/login") => "AuthController_login",
        ("GET", "/api/instance/settings/public") => "InstanceController_getPublicSettings",
        ("POST", "/api/auth/refresh") => "AuthController_refresh",
        ("POST", "/api/auth/logout") => "AuthController_logout",
        ("GET", "/api/users/profile") => "UserController_getProfile",
        ("GET", "/api/users/{id}") => "UserController_getUserById",
        _ => return None,
    })
}

async fn login(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<LoginRequestDto>(&body) else {
        return invalid("username and password are required");
    };
    if dto.password == "wrong" {
        return inner.error(
            401,
            "UNAUTHENTICATED",
            "Invalid username or password",
            false,
        );
    }
    json_response(
        StatusCode::OK,
        json!({
            "accessToken": inner.current_access_token(),
            "refreshToken": "fake-refresh-token",
        }),
    )
}

async fn refresh(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    if !body.is_empty() && typed::<RefreshRequestDto>(&body).is_err() {
        return invalid("The request body does not match the contract");
    }
    json_response(
        StatusCode::OK,
        json!({
            "accessToken": inner.current_access_token(),
            "refreshToken": "fake-refresh-token",
        }),
    )
}

async fn logout(State(_inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::CREATED, json!({ "message": "Logged out" }))
}

async fn profile(State(inner): State<Arc<Inner>>) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(&inner.scenario.me).expect("a user serializes"),
    )
}

async fn user_by_id(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    match inner.scenario.user(&id) {
        Some(user) => json_response(
            StatusCode::OK,
            serde_json::to_value(user).expect("a user serializes"),
        ),
        None => inner.error(404, "NOT_FOUND", "User not found", false),
    }
}

/// What the sign-in screen asks before anyone signs in. The name says which scenario this is.
async fn public_settings(State(_inner): State<Arc<Inner>>) -> Response {
    json_response(
        StatusCode::OK,
        json!({
            "name": "Semaphore fake server",
            "registrationMode": "INVITE_ONLY",
            "maxFileSizeBytes": 10 * 1024 * 1024,
            "gifSearchEnabled": false,
            "passwordResetEnabled": false,
            "desktopBrowserLogin": false,
        }),
    )
}
