//! The signed-in user's own account: profile edits, sessions and appearance settings.

use super::{bearer_token, invalid, json_response, typed};
use crate::accounts::ProfileOrder;
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get};
use semaphore_wire::types::{SessionInfoDto, UpdateAppearanceSettingsDto, UpdateProfileDto};
use serde_json::json;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/users/profile", axum::routing::patch(update_profile))
        .route("/api/auth/sessions", get(sessions).delete(revoke_others))
        .route("/api/auth/sessions/{sessionId}", delete(revoke_session))
        .route(
            "/api/appearance-settings",
            get(appearance).patch(update_appearance),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("PATCH", "/api/users/profile") => "UserController_updateProfile",
        ("GET", "/api/auth/sessions") => "AuthController_getSessions",
        ("DELETE", "/api/auth/sessions") => "AuthController_revokeAllOtherSessions",
        ("DELETE", "/api/auth/sessions/{sessionId}") => "AuthController_revokeSession",
        ("GET", "/api/appearance-settings") => "AppearanceSettingsController_getSettings",
        ("PATCH", "/api/appearance-settings") => "AppearanceSettingsController_updateSettings",
        _ => return None,
    })
}

/// `UserService.updateProfile`. A new avatar or banner must be a file this user uploaded as
/// `USER_AVATAR` / `USER_BANNER`; resending the current one is accepted unchecked.
async fn update_profile(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Ok(dto) = typed::<UpdateProfileDto>(&body) else {
        return invalid("The request body does not match the contract");
    };
    let user_id = inner.user_of(bearer_token(&headers));
    let Some(current) = inner.user_entity(&user_id) else {
        return inner.error(404, "NOT_FOUND", "User not found", false);
    };

    for (wanted, existing, resource_type) in [
        (&dto.avatar, &current.avatar_url, "USER_AVATAR"),
        (&dto.banner, &current.banner_url, "USER_BANNER"),
    ] {
        let Some(file_id) = wanted.as_ref().filter(|id| !id.is_empty()) else {
            continue;
        };
        if existing.as_ref() == Some(file_id) {
            continue;
        }
        let own = lock(&inner.data)
            .files
            .get(file_id)
            .is_some_and(|file| file.uploaded_by == user_id && file.resource_type == resource_type);
        if !own {
            return inner.error(
                403,
                "FILE_NOT_OWNED",
                "You can only use images you uploaded",
                false,
            );
        }
    }

    let mut user = current;
    if let Some(name) = &dto.display_name {
        user.display_name = Some(name.trim().to_owned());
    }
    if let Some(avatar) = dto.avatar {
        user.avatar_url = Some(avatar).filter(|id| !id.is_empty());
    }
    if let Some(banner) = dto.banner {
        user.banner_url = Some(banner).filter(|id| !id.is_empty());
    }
    if let Some(bio) = &dto.bio {
        user.bio = Some(bio.trim().to_owned()).filter(|text| !text.is_empty());
    }
    if let Some(status) = &dto.status {
        user.status = Some(status.trim().to_owned()).filter(|text| !text.is_empty());
    }
    let order = {
        let mut accounts = lock(&inner.accounts);
        accounts.users.insert(user_id.clone(), user.clone());
        accounts.profile_order
    };

    // The user's own sessions and everyone they share a community with hear of it.
    let peers = inner.community_peers(&user_id);
    let payload = Inner::profile_payload(&user);
    match order {
        ProfileOrder::Race => inner.emit_to_users(&peers, "userProfileUpdated", payload),
        ProfileOrder::EventThenReply => {
            inner.emit_to_users(&peers, "userProfileUpdated", payload);
            inner.frames_flushed().await;
        }
        ProfileOrder::ReplyThenEvent => {
            lock(&inner.accounts).held.push(crate::accounts::HeldEvent {
                users: peers,
                event: "userProfileUpdated",
                payload,
            });
        }
    }
    json_response(
        StatusCode::OK,
        serde_json::to_value(user).expect("a user serializes"),
    )
}

/// `getUserSessions`: the live sessions of the user, the asking one marked.
async fn sessions(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let Some(token) = bearer_token(&headers) else {
        return inner.error(401, "UNAUTHENTICATED", "Missing bearer token", false);
    };
    let now = inner.now();
    let me = inner.scenario.me.id.clone();
    let mut accounts = lock(&inner.accounts);
    let current = accounts.resolve_or_adopt(token, &me, now);
    let user_id = accounts.sessions[current].user_id.clone();
    let list: Vec<SessionInfoDto> = accounts
        .live_sessions_of(&user_id, now)
        .into_iter()
        .map(|index| {
            let session = &accounts.sessions[index];
            SessionInfoDto {
                created_at: session.created_at,
                device_name: session.device_name.clone(),
                expires_at: session.expires_at,
                id: session.id.clone(),
                ip_address: session.ip.clone(),
                is_current: index == current,
                last_used_at: session.last_used_at,
            }
        })
        .collect();
    drop(accounts);
    json_response(
        StatusCode::OK,
        serde_json::to_value(list).expect("sessions serialize"),
    )
}

fn terminate(inner: &Inner, tokens: &[String]) {
    inner.emit_to_tokens(
        tokens,
        "sessionTerminated",
        json!({ "reason": "SESSION_REVOKED" }),
    );
}

/// `DELETE /auth/sessions/{sessionId}`: the id is a UUID (else 400, as `ParseUUIDPipe`), of one of
/// the caller's own sessions (else 404). Its sockets hear `sessionTerminated`; its tokens fail.
async fn revoke_session(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(session_id): Path<String>,
) -> Response {
    if uuid::Uuid::parse_str(&session_id).is_err() || session_id.len() != 36 {
        return invalid("sessionId must be a UUID");
    }
    let Some(token) = bearer_token(&headers) else {
        return inner.error(401, "UNAUTHENTICATED", "Missing bearer token", false);
    };
    let now = inner.now();
    let me = inner.scenario.me.id.clone();
    let tokens = {
        let mut accounts = lock(&inner.accounts);
        let caller = accounts.resolve_or_adopt(token, &me, now);
        let user_id = accounts.sessions[caller].user_id.clone();
        let target = accounts
            .live_sessions_of(&user_id, now)
            .into_iter()
            .find(|&index| accounts.sessions[index].id == session_id);
        let Some(target) = target else {
            drop(accounts);
            return inner.error(404, "NOT_FOUND", "Session not found", false);
        };
        accounts.revoke(target);
        accounts.sessions[target].tokens.clone()
    };
    terminate(&inner, &tokens);
    json_response(
        StatusCode::OK,
        json!({ "message": "Session revoked successfully" }),
    )
}

/// `DELETE /auth/sessions`: every session of the caller's user but the caller's own.
async fn revoke_others(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let Some(token) = bearer_token(&headers) else {
        return inner.error(401, "UNAUTHENTICATED", "Missing bearer token", false);
    };
    let now = inner.now();
    let me = inner.scenario.me.id.clone();
    let revoked: Vec<Vec<String>> = {
        let mut accounts = lock(&inner.accounts);
        let caller = accounts.resolve_or_adopt(token, &me, now);
        let user_id = accounts.sessions[caller].user_id.clone();
        let others: Vec<usize> = accounts
            .live_sessions_of(&user_id, now)
            .into_iter()
            .filter(|&index| index != caller)
            .collect();
        others
            .into_iter()
            .map(|index| {
                accounts.revoke(index);
                accounts.sessions[index].tokens.clone()
            })
            .collect()
    };
    for tokens in &revoked {
        terminate(&inner, tokens);
    }
    let count = revoked.len();
    json_response(
        StatusCode::OK,
        json!({
            "revokedCount": count,
            "message": format!("Revoked {count} session{}", if count == 1 { "" } else { "s" }),
        }),
    )
}

async fn appearance(State(inner): State<Arc<Inner>>, headers: HeaderMap) -> Response {
    let user_id = inner.user_of(bearer_token(&headers));
    let now = inner.now();
    let row = lock(&inner.accounts).appearance_for(&user_id, now).clone();
    json_response(
        StatusCode::OK,
        serde_json::to_value(row).expect("settings serialize"),
    )
}

/// Partial: only the fields sent change. The values are checked against the lists the backend's
/// `IsIn` allows (the generated enums accept any string, so they would pass a typo).
async fn update_appearance(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    use semaphore_wire::enums::{AccentColor, ThemeIntensity, ThemeMode};
    let Ok(dto) = typed::<UpdateAppearanceSettingsDto>(&body) else {
        return invalid("The request body does not match the contract");
    };
    if matches!(dto.theme_mode, Some(ThemeMode::Unknown(_)))
        || matches!(dto.accent_color, Some(AccentColor::Unknown(_)))
        || matches!(dto.intensity, Some(ThemeIntensity::Unknown(_)))
    {
        return invalid("An appearance setting is not one of the allowed values");
    }
    let user_id = inner.user_of(bearer_token(&headers));
    let now = inner.now();
    let mut accounts = lock(&inner.accounts);
    let row = accounts.appearance_for(&user_id, now);
    if let Some(mode) = dto.theme_mode {
        row.theme_mode = mode.as_str().into_owned();
    }
    if let Some(color) = dto.accent_color {
        row.accent_color = color.as_str().into_owned();
    }
    if let Some(intensity) = dto.intensity {
        row.intensity = intensity.as_str().into_owned();
    }
    row.updated_at = now;
    let row = row.clone();
    drop(accounts);
    json_response(
        StatusCode::OK,
        serde_json::to_value(row).expect("settings serialize"),
    )
}
