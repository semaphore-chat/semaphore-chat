//! Sign-in, refresh, sign-out, users and the public instance settings.

use super::{bearer_token, invalid, json_response, typed};
use crate::accounts::pkce_matches;
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use semaphore_wire::types::{DesktopLoginTokenRequestDto, LoginRequestDto, RefreshRequestDto};
use serde_json::json;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/refresh", post(refresh))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/desktop/token", post(redeem_desktop_login))
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
        ("POST", "/api/auth/desktop/token") => "AuthController_redeemDesktopLogin",
        ("GET", "/api/users/profile") => "UserController_getProfile",
        ("GET", "/api/users/{id}") => "UserController_getUserById",
        _ => return None,
    })
}

/// The device a sign-in came from, as it introduced itself.
fn device_name(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-device-name")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn tokens_body(access: &str, refresh: &str) -> serde_json::Value {
    json!({ "accessToken": access, "refreshToken": refresh })
}

/// A registered account signs in with its own password; anyone else is the scenario's `me`, who is
/// refused only by the password "wrong". Each sign-in starts a session of its own.
async fn login(State(inner): State<Arc<Inner>>, headers: HeaderMap, body: Bytes) -> Response {
    let Ok(dto) = typed::<LoginRequestDto>(&body) else {
        return invalid("username and password are required");
    };
    let denied = || {
        inner.error(
            401,
            "UNAUTHENTICATED",
            "Invalid username or password",
            false,
        )
    };
    let now = inner.now();
    let required = inner.required_access_token();
    let mut accounts = lock(&inner.accounts);
    let user_id = match accounts.credentials.get(&dto.username.to_lowercase()) {
        Some(credential) if credential.password == dto.password => credential.user_id.clone(),
        Some(_) => return denied(),
        None if dto.password == "wrong" => return denied(),
        None => inner.scenario.me.id.clone(),
    };
    let index = accounts.start_session(
        &user_id,
        device_name(&headers).as_deref(),
        Some("127.0.0.1"),
        now,
        required,
        true,
    );
    let session = &accounts.sessions[index];
    json_response(
        StatusCode::OK,
        tokens_body(&session.access, &session.refresh),
    )
}

/// A refresh token of a session gets that session's tokens (a revoked one gets 401); anything else
/// gets the placeholder tokens, as it always has.
async fn refresh(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let presented = if body.is_empty() {
        None
    } else {
        match typed::<RefreshRequestDto>(&body) {
            Ok(dto) => dto.refresh_token,
            Err(_) => return invalid("The request body does not match the contract"),
        }
    };
    let required = inner.required_access_token();
    let now = inner.now();
    let mut accounts = lock(&inner.accounts);
    if let Some(token) = presented.as_deref()
        && let Some(index) = accounts
            .sessions
            .iter()
            .position(|session| session.refresh == token)
    {
        let session = &mut accounts.sessions[index];
        if session.revoked {
            drop(accounts);
            return inner.error(401, "UNAUTHENTICATED", "Invalid refresh token", false);
        }
        // After `expire_access_token`, the one token the server still accepts.
        if let Some(required) = required
            && session.access != required
        {
            session.access = required.clone();
            session.tokens.push(required);
        }
        session.last_used_at = now;
        return json_response(
            StatusCode::OK,
            tokens_body(&session.access, &session.refresh),
        );
    }
    drop(accounts);
    json_response(
        StatusCode::OK,
        tokens_body(&inner.current_access_token(), "fake-refresh-token"),
    )
}

/// `POST /auth/desktop/token`: the app redeems the code it got from the browser's approval.
/// Single use (the grant is gone after any attempt), good for 60 s of the server's clock, and only
/// for the PKCE verifier its challenge came from. Every failure is the same 401. A code or verifier
/// that is not even the right shape never reaches the check: 400, as the validation pipe answers,
/// and the grant stays.
async fn redeem_desktop_login(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Ok(dto) = typed::<DesktopLoginTokenRequestDto>(&body) else {
        return invalid("The request body does not match the contract");
    };
    let now = inner.now();
    let required = inner.required_access_token();
    let mut accounts = lock(&inner.accounts);
    let approved = accounts
        .grants
        .remove(dto.code.as_str())
        .filter(|grant| {
            now <= grant.approved_at + crate::accounts::GRANT_TTL
                && !grant.approver_revoked
                && pkce_matches(dto.code_verifier.as_str(), &grant.challenge)
        })
        .map(|grant| grant.user_id);
    let Some(user_id) = approved else {
        drop(accounts);
        return inner.error(
            401,
            "UNAUTHENTICATED",
            "Invalid or expired sign-in code",
            false,
        );
    };
    let index = accounts.start_session(
        &user_id,
        device_name(&headers).as_deref(),
        Some("127.0.0.1"),
        now,
        required,
        true,
    );
    let session = &accounts.sessions[index];
    let response = tokens_body(&session.access, &session.refresh);
    let own_tokens = session.tokens.clone();
    drop(accounts);
    // The user's other sessions hear about the new device.
    inner.emit_to_user_except(
        &user_id,
        &own_tokens,
        "desktopSignIn",
        json!({ "ipAddress": "127.0.0.1", "signedInAt": now }),
    );
    json_response(StatusCode::OK, response)
}

async fn logout(State(_inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::CREATED, json!({ "message": "Logged out" }))
}

async fn profile(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user_id = inner.user_of(bearer_token(&headers));
    match inner.user_entity(&user_id) {
        Some(user) => json_response(
            StatusCode::OK,
            serde_json::to_value(user).expect("a user serializes"),
        ),
        None => inner.error(404, "NOT_FOUND", "User not found", false),
    }
}

async fn user_by_id(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    match inner.user_entity(&id) {
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
            "desktopBrowserLogin": true,
        }),
    )
}
