//! The replay buffer and the clip library (W4), as `LivekitController`'s replay and clip routes
//! answer. The state and the rules are in `calls.rs`.

use super::{invalid, json_response, parse};
use crate::Inner;
use crate::calls::{self, Refusal};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use serde_json::{Value, json};
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/livekit/replay/start", post(start))
        .route("/api/livekit/replay/stop", post(stop))
        .route("/api/livekit/replay/session-info", get(session_info))
        .route("/api/livekit/replay/preview/playlist.m3u8", get(playlist))
        .route(
            "/api/livekit/replay/preview/segment/{segmentFile}",
            get(segment),
        )
        .route("/api/livekit/replay/capture", post(capture))
        .route("/api/livekit/replay/stream", get(stream))
        .route("/api/livekit/clips", get(my_clips))
        .route("/api/livekit/clips/user/{userId}", get(user_clips))
        .route(
            "/api/livekit/clips/{clipId}",
            put(update_clip).delete(delete_clip),
        )
        .route("/api/livekit/clips/{clipId}/share", post(share_clip))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/livekit/replay/start") => "LivekitController_startReplayBuffer",
        ("POST", "/api/livekit/replay/stop") => "LivekitController_stopReplayBuffer",
        ("GET", "/api/livekit/replay/session-info") => "LivekitController_getSessionInfo",
        ("GET", "/api/livekit/replay/preview/playlist.m3u8") => {
            "LivekitController_getPreviewPlaylist"
        }
        ("GET", "/api/livekit/replay/preview/segment/{segmentFile}") => {
            "LivekitController_getPreviewSegment"
        }
        ("POST", "/api/livekit/replay/capture") => "LivekitController_captureReplay",
        ("GET", "/api/livekit/replay/stream") => "LivekitController_streamReplay",
        ("GET", "/api/livekit/clips") => "LivekitController_getMyClips",
        ("GET", "/api/livekit/clips/user/{userId}") => "LivekitController_getUserPublicClips",
        ("PUT", "/api/livekit/clips/{clipId}") => "LivekitController_updateClip",
        ("DELETE", "/api/livekit/clips/{clipId}") => "LivekitController_deleteClip",
        ("POST", "/api/livekit/clips/{clipId}/share") => "LivekitController_shareClip",
        _ => return None,
    })
}

fn refused(inner: &Inner, (status, code, message): Refusal) -> Response {
    inner.error(status, code, message, false)
}

fn answer(inner: &Inner, status: StatusCode, result: Result<Value, Refusal>) -> Response {
    match result {
        Ok(body) => json_response(status, body),
        Err(refusal) => refused(inner, refusal),
    }
}

/// `StartReplayBufferDto`: `channelId` a UUID (a scenario's own readable ids pass), and
/// `videoTrackId` a string.
async fn start(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(channel_id) = body.get("channelId").and_then(Value::as_str) else {
        return invalid("channelId must be a UUID");
    };
    let known = inner.scenario.channel(channel_id).is_some();
    if !crate::social::valid_id(channel_id, known) {
        return invalid("channelId must be a UUID");
    }
    if !body.get("videoTrackId").is_some_and(Value::is_string) {
        return invalid("videoTrackId must be a string");
    }
    let result = calls::start_replay(&inner, channel_id);
    answer(&inner, StatusCode::CREATED, result)
}

async fn stop(State(inner): State<Arc<Inner>>) -> Response {
    let result = calls::stop_replay(&inner);
    answer(&inner, StatusCode::CREATED, result)
}

async fn session_info(State(inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::OK, calls::session_info(&inner))
}

async fn playlist(State(inner): State<Arc<Inner>>) -> Response {
    match calls::playlist(&inner) {
        Ok(text) => (
            [
                (
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("application/vnd.apple.mpegurl"),
                ),
                (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
            ],
            text,
        )
            .into_response(),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn segment(State(inner): State<Arc<Inner>>, Path(file): Path<String>) -> Response {
    match calls::segment(&inner, &file) {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, HeaderValue::from_static("video/mp2t")),
                (
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("max-age=86400"),
                ),
            ],
            bytes,
        )
            .into_response(),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn capture(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let capture = match calls::parse_capture(&body) {
        Ok(capture) => capture,
        Err(message) => return invalid(&message),
    };
    let result = calls::capture(&inner, capture);
    answer(&inner, StatusCode::CREATED, result)
}

/// `GET replay/stream` ("Download only"): `StreamReplayDto` requires `durationMinutes`, one of
/// 1, 2, 5 or 10 (a query string, converted to a number); then the last minutes as an MP4
/// attachment, kept nowhere.
async fn stream(
    State(inner): State<Arc<Inner>>,
    axum::extract::RawQuery(query): axum::extract::RawQuery,
) -> Response {
    let minutes = query
        .as_deref()
        .unwrap_or("")
        .split('&')
        .find_map(|pair| pair.strip_prefix("durationMinutes="))
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|minutes| [1, 2, 5, 10].contains(minutes));
    if minutes.is_none() {
        return invalid("Duration must be 1, 2, 5, or 10 minutes");
    }
    match calls::stream_replay(&inner) {
        Ok(bytes) => {
            let disposition = format!(
                "attachment; filename=\"replay-{}.mp4\"",
                inner.now().timestamp_millis()
            );
            (
                [
                    (header::CONTENT_TYPE, HeaderValue::from_static("video/mp4")),
                    (
                        header::CONTENT_DISPOSITION,
                        HeaderValue::from_str(&disposition)
                            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
                    ),
                ],
                bytes,
            )
                .into_response()
        }
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn my_clips(State(inner): State<Arc<Inner>>) -> Response {
    let me = inner.scenario.me.id.clone();
    json_response(StatusCode::OK, calls::clips_of(&inner, &me, false))
}

async fn user_clips(State(inner): State<Arc<Inner>>, Path(user_id): Path<String>) -> Response {
    json_response(StatusCode::OK, calls::clips_of(&inner, &user_id, true))
}

/// `UpdateClipDto`: `isPublic`, optional, a boolean.
async fn update_clip(
    State(inner): State<Arc<Inner>>,
    Path(clip_id): Path<String>,
    body: Bytes,
) -> Response {
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let is_public = match body.get("isPublic") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(flag)) => Some(*flag),
        Some(_) => return invalid("isPublic must be a boolean value"),
    };
    let result = calls::update_clip(&inner, &clip_id, is_public);
    answer(&inner, StatusCode::OK, result)
}

async fn delete_clip(State(inner): State<Arc<Inner>>, Path(clip_id): Path<String>) -> Response {
    let result = calls::delete_clip(&inner, &clip_id).map(|()| json!({ "success": true }));
    answer(&inner, StatusCode::OK, result)
}

/// `ShareClipDto`: `destination` `channel` or `dm`, and that destination's target a UUID.
async fn share_clip(
    State(inner): State<Arc<Inner>>,
    Path(clip_id): Path<String>,
    body: Bytes,
) -> Response {
    let body = match parse(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(destination) = body
        .get("destination")
        .and_then(Value::as_str)
        .filter(|destination| ["channel", "dm"].contains(destination))
    else {
        return invalid("Destination must be channel or dm");
    };
    let field = if destination == "channel" {
        "targetChannelId"
    } else {
        "targetDirectMessageGroupId"
    };
    let target = body.get(field).and_then(Value::as_str);
    if !target.is_some_and(|id| id.len() == 36 && uuid::Uuid::parse_str(id).is_ok()) {
        return invalid(&format!("{field} must be a UUID"));
    }
    let (channel, dm) = if destination == "channel" {
        (target, None)
    } else {
        (None, target)
    };
    let result = calls::share_clip(&inner, &clip_id, destination, channel, dm);
    answer(&inner, StatusCode::CREATED, result)
}
