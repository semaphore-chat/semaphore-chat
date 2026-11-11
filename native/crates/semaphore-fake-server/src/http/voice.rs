//! LiveKit connection info and tokens, and voice presence.

use super::{invalid, json_response, typed};
use crate::messages;
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use semaphore_wire::types::{ConnectionInfoResponseDto, CreateTokenDto, TokenResponseDto};
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/livekit/connection-info", get(connection_info))
        .route("/api/livekit/token", post(generate_token))
        .route(
            "/api/channels/{channelId}/voice-presence",
            get(voice_presence),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/join",
            post(voice_join),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/refresh",
            post(voice_refresh),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/leave",
            post(voice_leave),
        )
        .route(
            "/api/channels/{channelId}/voice-presence/deafen",
            post(voice_deafen),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/livekit/connection-info") => "LivekitController_getConnectionInfo",
        ("POST", "/api/livekit/token") => "LivekitController_generateToken",
        ("GET", "/api/channels/{channelId}/voice-presence") => {
            "VoicePresenceController_getChannelPresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/join") => {
            "VoicePresenceController_joinPresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/refresh") => {
            "VoicePresenceController_refreshPresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/leave") => {
            "VoicePresenceController_leavePresence"
        }
        ("POST", "/api/channels/{channelId}/voice-presence/deafen") => {
            "VoicePresenceController_updateDeafenState"
        }
        _ => return None,
    })
}

fn livekit_url(inner: &Inner) -> String {
    lock(&inner.livekit).as_ref().map_or_else(
        || "wss://fake-livekit.invalid".to_owned(),
        |livekit| livekit.url.clone(),
    )
}

async fn connection_info(State(inner): State<Arc<Inner>>) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::to_value(ConnectionInfoResponseDto {
            url: Some(livekit_url(&inner)),
        })
        .expect("connection info serializes"),
    )
}

async fn generate_token(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<CreateTokenDto>(&body) else {
        return invalid("identity and roomId are required");
    };
    let ttl = dto.ttl.map(|ttl| ttl.get()).unwrap_or(3600).min(3600);
    let expires_at = inner.now() + chrono::Duration::seconds(ttl as i64);
    // One lock at a time: the token and the URL each read the LiveKit settings.
    let token = lock(&inner.livekit).as_ref().map_or_else(
        || "fake-livekit-token".to_owned(),
        |livekit| livekit.token(&dto.identity, dto.name.as_deref(), &dto.room_id, ttl),
    );
    let url = livekit_url(&inner);
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(TokenResponseDto {
            expires_at: Some(expires_at),
            token,
            url: Some(url),
            identity: dto.identity,
            room_id: dto.room_id,
        })
        .expect("a token serializes"),
    )
}

async fn voice_presence(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
) -> Response {
    json_response(
        StatusCode::OK,
        messages::voice_presence(&inner, &channel_id),
    )
}

async fn voice_join(State(inner): State<Arc<Inner>>, Path(channel_id): Path<String>) -> Response {
    json_response(
        StatusCode::CREATED,
        messages::voice_join(&inner, &channel_id),
    )
}

async fn voice_refresh(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
) -> Response {
    json_response(
        StatusCode::CREATED,
        messages::voice_refresh(&inner, &channel_id),
    )
}

async fn voice_leave(State(inner): State<Arc<Inner>>, Path(channel_id): Path<String>) -> Response {
    json_response(
        StatusCode::CREATED,
        messages::voice_leave(&inner, &channel_id),
    )
}

async fn voice_deafen(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(dto) = typed::<semaphore_wire::types::UpdateDeafenStateDto>(&body) else {
        return invalid("isDeafened is required");
    };
    json_response(
        StatusCode::CREATED,
        messages::voice_deafen(&inner, &channel_id, dto.is_deafened),
    )
}
