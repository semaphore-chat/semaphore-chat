//! LiveKit connection info and tokens, and voice presence. W4: DM call tokens and presence,
//! server mute and join-failure reports.

use super::{invalid, json_response, typed};
use crate::calls;
use crate::messages;
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::IntoResponse;
use axum::response::Response;
use axum::routing::{get, post};
use semaphore_wire::types::{
    ConnectionInfoResponseDto, CreateTokenDto, MuteParticipantDto, RefreshDmPresenceResponseDto,
    TokenResponseDto,
};
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
        .route("/api/livekit/dm-token", post(generate_dm_token))
        .route(
            "/api/livekit/channels/{channelId}/mute-participant",
            post(mute_participant),
        )
        .route(
            "/api/dm-groups/{dmGroupId}/voice-presence",
            get(dm_presence),
        )
        .route(
            "/api/dm-groups/{dmGroupId}/voice-presence/refresh",
            post(dm_refresh),
        )
        .route(
            "/api/voice/diagnostics/join-failure",
            post(report_join_failure),
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
        ("POST", "/api/livekit/dm-token") => "LivekitController_generateDmToken",
        ("POST", "/api/livekit/channels/{channelId}/mute-participant") => {
            "LivekitController_muteParticipant"
        }
        ("GET", "/api/dm-groups/{dmGroupId}/voice-presence") => {
            "DmVoicePresenceController_getDmPresence"
        }
        ("POST", "/api/dm-groups/{dmGroupId}/voice-presence/refresh") => {
            "DmVoicePresenceController_refreshDmPresence"
        }
        ("POST", "/api/voice/diagnostics/join-failure") => {
            "VoiceDiagnosticsController_reportJoinFailure"
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

fn refused(inner: &Inner, (status, code, message): crate::calls::Refusal) -> Response {
    inner.error(status, code, message, false)
}

/// `POST /livekit/dm-token`: for the DM group's members only (`assertDmMember`, owners
/// included), a token for the group's room. As `generateToken`, the identity and name are the
/// caller's account's, whatever the body says.
async fn generate_dm_token(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(dto) = typed::<CreateTokenDto>(&body) else {
        return invalid("identity and roomId are required");
    };
    let me = inner.scenario.me.clone();
    if let Err(refusal) = calls::dm_members_for(&inner, &dto.room_id, &me.id) {
        return refused(&inner, refusal);
    }
    let name = me
        .display_name
        .clone()
        .unwrap_or_else(|| me.username.clone());
    let ttl = dto.ttl.map(|ttl| ttl.get()).unwrap_or(3600).min(3600);
    let expires_at = inner.now() + chrono::Duration::seconds(ttl as i64);
    let token = lock(&inner.livekit).as_ref().map_or_else(
        || "fake-livekit-token".to_owned(),
        |livekit| livekit.token(&me.id, Some(&name), &dto.room_id, ttl),
    );
    let url = livekit_url(&inner);
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(TokenResponseDto {
            expires_at: Some(expires_at),
            token,
            url: Some(url),
            identity: me.id.clone(),
            room_id: dto.room_id,
        })
        .expect("a token serializes"),
    )
}

/// `POST /livekit/channels/{channelId}/mute-participant`: `201 { success: true }` (a `@Post`
/// without `@HttpCode`; the spec says 200).
async fn mute_participant(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(dto) = typed::<MuteParticipantDto>(&body) else {
        return invalid("participantIdentity and mute are required");
    };
    if dto.participant_identity.is_empty() {
        return invalid("participantIdentity should not be empty");
    }
    if let Err(refusal) = calls::may_server_mute(&inner, &channel_id, &dto.participant_identity) {
        return refused(&inner, refusal);
    }
    calls::set_server_muted(&inner, &channel_id, &dto.participant_identity, dto.mute);
    json_response(StatusCode::CREATED, serde_json::json!({ "success": true }))
}

async fn dm_presence(State(inner): State<Arc<Inner>>, Path(group_id): Path<String>) -> Response {
    let me = inner.scenario.me.id.clone();
    if let Err(refusal) = calls::dm_members_for(&inner, &group_id, &me) {
        return refused(&inner, refusal);
    }
    json_response(StatusCode::OK, calls::dm_presence(&inner, &group_id))
}

/// `POST /dm-groups/{id}/voice-presence/refresh`: extends the caller's presence, or registers
/// them when they aren't listed (with `dmVoiceCallStarted` or `dmVoiceUserJoined`). Always the
/// same answer: the service swallows its errors.
async fn dm_refresh(State(inner): State<Arc<Inner>>, Path(group_id): Path<String>) -> Response {
    let me = inner.scenario.me.id.clone();
    let members = match calls::dm_members_for(&inner, &group_id, &me) {
        Ok(members) => members,
        Err(refusal) => return refused(&inner, refusal),
    };
    calls::dm_join(&inner, &group_id, &me, &members);
    json_response(
        StatusCode::CREATED,
        serde_json::to_value(RefreshDmPresenceResponseDto {
            dm_group_id: group_id,
            message: "DM presence refreshed successfully".to_owned(),
            success: true,
        })
        .expect("a refresh serializes"),
    )
}

/// `POST /voice/diagnostics/join-failure`: `204`, kept for `FakeServer::join_failures`; a
/// fourth report in a minute is `429` (`JoinFailureThrottleGuard`, before validation).
async fn report_join_failure(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let me = inner.scenario.me.id.clone();
    if !calls::throttle_join_failure(&inner, &me) {
        return inner.error(
            429,
            "RATE_LIMITED",
            "ThrottlerException: Too Many Requests",
            true,
        );
    }
    // No body is `{}` to Nest's parser, which validation then refuses.
    let body = if body.iter().all(u8::is_ascii_whitespace) {
        serde_json::json!({})
    } else {
        match super::parse(&body) {
            Ok(body) => body,
            Err(response) => return response,
        }
    };
    match calls::parse_join_failure(&body) {
        Ok(report) => {
            calls::keep_join_failure(&inner, report);
            StatusCode::NO_CONTENT.into_response()
        }
        Err(message) => invalid(&message),
    }
}
