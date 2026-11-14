//! Message pages, sends, reactions and read receipts.

use super::{
    bearer_token, failure_response, invalid, json_response, limit_query, page_query, parse, typed,
};
use crate::messages::{self, SendBody, SendTarget};
use crate::{Inner, lock};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use semaphore_wire::types::{AnchoredMessagesResponseDto, PaginatedMessagesResponseDto};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/read-receipts/mark-read", post(mark_read))
        .route("/api/messages", post(create_message))
        .route("/api/messages/dm", post(create_direct_message))
        .route(
            "/api/messages/channel/{channelId}",
            get(messages_for_channel),
        )
        .route(
            "/api/messages/channel/{channelId}/around/{messageId}",
            get(messages_around),
        )
        .route("/api/messages/group/{groupId}", get(messages_for_group))
        .route(
            "/api/messages/group/{groupId}/around/{messageId}",
            get(messages_around_for_group),
        )
        .route(
            "/api/messages/reactions",
            post(add_reaction).delete(remove_reaction),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("POST", "/api/read-receipts/mark-read") => "ReadReceiptsController_markAsRead",
        ("GET", "/api/messages/channel/{channelId}") => "MessagesController_findAllForChannel",
        ("GET", "/api/messages/channel/{channelId}/around/{messageId}") => {
            "MessagesController_findAroundForChannel"
        }
        ("GET", "/api/messages/group/{groupId}") => "MessagesController_findAllForGroup",
        ("GET", "/api/messages/group/{groupId}/around/{messageId}") => {
            "MessagesController_findAroundForGroup"
        }
        ("POST", "/api/messages") => "MessagesController_create",
        ("POST", "/api/messages/dm") => "MessagesController_createDirectMessage",
        ("POST", "/api/messages/reactions") => "MessagesController_addReaction",
        ("DELETE", "/api/messages/reactions") => "MessagesController_removeReaction",
        _ => return None,
    })
}

/// `RbacGuard`'s answer for a channel message route: a channel the caller can't see (a private
/// channel they aren't on, or a community they aren't in) is `403` before the handler runs, as the
/// backend's `READ_MESSAGE` check on the channel is.
fn guard_channel(inner: &Inner, headers: &HeaderMap, channel_id: &str) -> Option<Response> {
    let me = inner.user_of(super::bearer_token(headers));
    if crate::admin::can_view(inner, channel_id, &me) {
        return None;
    }
    Some(crate::rbac::respond(inner, crate::rbac::guard_refusal()))
}

async fn messages_for_channel(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(channel_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if let Some(response) = guard_channel(&inner, &headers, &channel_id) {
        return response;
    }
    let (limit, token, direction) = match page_query(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let source = data
        .channel_messages
        .get(&channel_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let (messages, next) = messages::page(source, limit, token.as_deref(), &direction);
    let body = PaginatedMessagesResponseDto {
        continuation_token: next,
        messages,
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(body).expect("a page serializes"),
    )
}

async fn messages_for_group(
    State(inner): State<Arc<Inner>>,
    Path(group_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (limit, token, direction) = match page_query(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let source = data
        .dm_messages
        .get(&group_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let (messages, next) = messages::page(source, limit, token.as_deref(), &direction);
    let body = PaginatedMessagesResponseDto {
        continuation_token: next,
        messages,
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(body).expect("a page serializes"),
    )
}

async fn messages_around(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path((channel_id, message_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if let Some(response) = guard_channel(&inner, &headers, &channel_id) {
        return response;
    }
    let limit = match limit_query(&query) {
        Ok(limit) => limit,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let source = data
        .channel_messages
        .get(&channel_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let Some((messages, older, newer)) = messages::around(source, &message_id, limit) else {
        return inner.error(404, "NOT_FOUND", "Message not found", false);
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(AnchoredMessagesResponseDto {
            messages,
            newer_continuation_token: newer,
            older_continuation_token: older,
        })
        .expect("an anchored page serializes"),
    )
}

async fn messages_around_for_group(
    State(inner): State<Arc<Inner>>,
    Path((group_id, message_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let limit = match limit_query(&query) {
        Ok(limit) => limit,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let source = data
        .dm_messages
        .get(&group_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let Some((messages, older, newer)) = messages::around(source, &message_id, limit) else {
        return inner.error(404, "NOT_FOUND", "Message not found", false);
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(AnchoredMessagesResponseDto {
            messages,
            newer_continuation_token: newer,
            older_continuation_token: older,
        })
        .expect("an anchored page serializes"),
    )
}

async fn create_message(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Ok(send) = typed::<SendBody>(&body) else {
        return invalid("The request body does not match the contract");
    };
    let Some(channel_id) = send.channel_id.clone() else {
        return inner.error(
            400,
            "MESSAGE_TARGET_INVALID",
            "channelId is required for channel messages",
            false,
        );
    };
    if let Some(response) = guard_channel(&inner, &headers, &channel_id) {
        return response;
    }
    let fault = inner.take_send_fault();
    let author = inner.user_of(super::bearer_token(&headers));
    match messages::send(
        &inner,
        &author,
        SendTarget::Channel(channel_id),
        &send,
        fault,
    ) {
        Ok(message) => json_response(
            StatusCode::CREATED,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(failure) => failure_response(&failure),
    }
}

async fn create_direct_message(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let Ok(send) = typed::<SendBody>(&body) else {
        return invalid("The request body does not match the contract");
    };
    let Some(group_id) = send.direct_message_group_id.clone() else {
        return inner.error(
            400,
            "MESSAGE_TARGET_INVALID",
            "directMessageGroupId is required for direct messages",
            false,
        );
    };
    let fault = inner.take_send_fault();
    match messages::send(
        &inner,
        &inner.scenario.me.id,
        SendTarget::DirectMessage(group_id),
        &send,
        fault,
    ) {
        Ok(message) => json_response(
            StatusCode::CREATED,
            serde_json::to_value(message).expect("a message serializes"),
        ),
        Err(failure) => failure_response(&failure),
    }
}

fn reaction_body(body: &Bytes) -> Result<(String, String), Response> {
    let value = parse(body)?;
    let id = value
        .get("messageId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("messageId is required"))?;
    let emoji = value
        .get("emoji")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("emoji is required"))?;
    Ok((id.to_owned(), emoji.to_owned()))
}

async fn add_reaction(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let (id, emoji) = match reaction_body(&body) {
        Ok(parts) => parts,
        Err(response) => return response,
    };
    // `reactions.service` `validateCustomReaction`.
    if emoji.starts_with("custom:") && messages::is_direct_message(&inner, &id) {
        return inner.error(
            400,
            "BAD_REQUEST",
            "Custom emoji reactions are only available in communities",
            false,
        );
    }
    match messages::add_reaction(&inner, &id, &emoji) {
        Some(dto) => json_response(
            StatusCode::CREATED,
            serde_json::to_value(dto).expect("reactions serialize"),
        ),
        None => inner.error(404, "NOT_FOUND", "Message not found", false),
    }
}

async fn remove_reaction(State(inner): State<Arc<Inner>>, body: Bytes) -> Response {
    let (id, emoji) = match reaction_body(&body) {
        Ok(parts) => parts,
        Err(response) => return response,
    };
    match messages::remove_reaction(&inner, &id, &emoji) {
        Some(dto) => json_response(
            StatusCode::OK,
            serde_json::to_value(dto).expect("reactions serialize"),
        ),
        None => inner.error(404, "NOT_FOUND", "Message not found", false),
    }
}

async fn mark_read(State(inner): State<Arc<Inner>>, headers: HeaderMap, body: Bytes) -> Response {
    let Ok(value) = parse(&body) else {
        return invalid("The request body is not valid JSON");
    };
    let Some(last_read) = value.get("lastReadMessageId").and_then(Value::as_str) else {
        return invalid("lastReadMessageId is required");
    };
    let channel = value.get("channelId").and_then(Value::as_str);
    let group = value.get("directMessageGroupId").and_then(Value::as_str);
    // As the backend's `markReadAndAnnounce`: notifications of the context are read and the
    // receipt goes out over the socket. The receipt is the caller's.
    let user = inner.user_of(bearer_token(&headers));
    match crate::socket::announce_read(&inner, &user, channel, group, last_read) {
        Ok(receipt) => json_response(StatusCode::OK, receipt),
        Err(message) => inner.error(400, "BAD_REQUEST", message, false),
    }
}
