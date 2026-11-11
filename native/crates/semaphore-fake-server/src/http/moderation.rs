//! Edit, delete and read one message; pins, a moderator's removal and channel roles (W1 part A).

use super::{json_response, typed};
use crate::Inner;
use crate::actions::{self, EditBody, ReasonBody, Refusal};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post};
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route(
            "/api/messages/{id}",
            get(find_one).patch(edit).delete(delete_message),
        )
        .route("/api/moderation/pin/{messageId}", post(pin).delete(unpin))
        .route("/api/moderation/pins/{channelId}", get(pins))
        .route("/api/moderation/message/{messageId}", delete(remove_as_mod))
        .route("/api/roles/my/channel/{channelId}", get(my_channel_roles))
        .route("/api/roles/my/instance", get(my_instance_roles))
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/messages/{id}") => "MessagesController_findOne",
        ("PATCH", "/api/messages/{id}") => "MessagesController_update",
        ("DELETE", "/api/messages/{id}") => "MessagesController_remove",
        ("POST", "/api/moderation/pin/{messageId}") => "ModerationController_pinMessage",
        ("DELETE", "/api/moderation/pin/{messageId}") => "ModerationController_unpinMessage",
        ("GET", "/api/moderation/pins/{channelId}") => "ModerationController_getPinnedMessages",
        ("DELETE", "/api/moderation/message/{messageId}") => {
            "ModerationController_deleteMessageAsMod"
        }
        ("GET", "/api/roles/my/channel/{channelId}") => "RolesController_getMyRolesForChannel",
        ("GET", "/api/roles/my/instance") => "RolesController_getMyInstanceRoles",
        _ => return None,
    })
}

fn refused(inner: &Inner, (status, code, message): Refusal) -> Response {
    inner.error(status, code, message, false)
}

/// A body that may be absent: the moderation routes' `{ reason }` is optional.
fn reason(body: &Bytes) -> Result<ReasonBody, Response> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok(ReasonBody::default());
    }
    typed(body)
}

fn success(message: &str) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::json!({ "success": true, "message": message }),
    )
}

async fn find_one(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    match actions::find_one(&inner, &id) {
        Ok(message) => json_response(
            StatusCode::OK,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn edit(State(inner): State<Arc<Inner>>, Path(id): Path<String>, body: Bytes) -> Response {
    let body: EditBody = match typed(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    match actions::edit(&inner, &id, body) {
        Ok(message) => json_response(
            StatusCode::OK,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn delete_message(State(inner): State<Arc<Inner>>, Path(id): Path<String>) -> Response {
    match actions::delete(&inner, &id) {
        Ok(()) => axum::response::IntoResponse::into_response(StatusCode::NO_CONTENT),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn pin(State(inner): State<Arc<Inner>>, Path(id): Path<String>, body: Bytes) -> Response {
    if let Err(response) = reason(&body) {
        return response;
    }
    match actions::set_pinned(&inner, &id, true) {
        Ok(()) => success("Message pinned successfully"),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn unpin(State(inner): State<Arc<Inner>>, Path(id): Path<String>, body: Bytes) -> Response {
    if let Err(response) = reason(&body) {
        return response;
    }
    match actions::set_pinned(&inner, &id, false) {
        Ok(()) => success("Message unpinned successfully"),
        Err(refusal) => refused(&inner, refusal),
    }
}

async fn pins(State(inner): State<Arc<Inner>>, Path(channel_id): Path<String>) -> Response {
    json_response(StatusCode::OK, actions::pins(&inner, &channel_id))
}

async fn remove_as_mod(
    State(inner): State<Arc<Inner>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let body = match reason(&body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    match actions::remove_as_mod(&inner, &id, body.reason) {
        Ok(()) => success("Message deleted successfully"),
        Err(refusal) => refused(&inner, refusal),
    }
}

/// W3: what decides "Create community". The fake's user holds the instance's default role, which
/// may create communities.
async fn my_instance_roles(State(inner): State<Arc<Inner>>) -> Response {
    json_response(StatusCode::OK, actions::my_instance_roles(&inner))
}

async fn my_channel_roles(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
) -> Response {
    json_response(
        StatusCode::OK,
        actions::my_channel_roles(&inner, &channel_id),
    )
}
