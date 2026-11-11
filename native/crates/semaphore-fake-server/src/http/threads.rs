//! Thread replies, metadata and subscriptions (W1 part B).
//!
//! A removed parent behaves as the next backend release does for a non-moderator: its replies
//! read as none, and its metadata and subscriptions answer 404. Subscribing broadcasts nothing,
//! as on the real backend: another device learns of it when it next reads the metadata.

use super::{json_response, limit_query};
use crate::{Inner, lock};
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use semaphore_wire::MessageDto;
use semaphore_wire::types::{ThreadMetadataDto, ThreadRepliesResponseDto};
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/threads/{parentMessageId}/replies", get(replies))
        .route("/api/threads/{parentMessageId}/metadata", get(metadata))
        .route(
            "/api/threads/{parentMessageId}/subscribe",
            post(subscribe).delete(unsubscribe),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/threads/{parentMessageId}/replies") => "ThreadsController_getReplies",
        ("GET", "/api/threads/{parentMessageId}/metadata") => "ThreadsController_getMetadata",
        ("POST", "/api/threads/{parentMessageId}/subscribe") => "ThreadsController_subscribe",
        ("DELETE", "/api/threads/{parentMessageId}/subscribe") => "ThreadsController_unsubscribe",
        _ => return None,
    })
}

/// The parent, wherever it lives.
fn parent(data: &crate::Data, id: &str) -> Option<MessageDto> {
    data.channel_messages
        .values()
        .chain(data.dm_messages.values())
        .flatten()
        .find(|message| message.id == id)
        .cloned()
}

fn not_found(inner: &Inner) -> Response {
    inner.error(404, "NOT_FOUND", "Thread not found", false)
}

/// Oldest first, as the backend pages them; the token is the last reply sent.
async fn replies(
    State(inner): State<Arc<Inner>>,
    Path(parent_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let limit = match limit_query(&query) {
        Ok(limit) => limit,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let Some(parent) = parent(&data, &parent_id) else {
        drop(data);
        return not_found(&inner);
    };
    let all: Vec<MessageDto> = if parent.deleted_at.is_some() {
        Vec::new()
    } else {
        data.threads.get(&parent_id).cloned().unwrap_or_default()
    };
    drop(data);
    let start = query
        .get("continuationToken")
        .filter(|token| !token.is_empty())
        .and_then(|token| all.iter().position(|reply| &reply.id == token))
        .map_or(0, |index| index + 1);
    let page: Vec<MessageDto> = all.iter().skip(start).take(limit).cloned().collect();
    let more = start + page.len() < all.len();
    let body = ThreadRepliesResponseDto {
        continuation_token: if more {
            page.last().map(|reply| reply.id.clone())
        } else {
            None
        },
        file_metadata: HashMap::new(),
        replies: page,
    };
    json_response(
        StatusCode::OK,
        serde_json::to_value(body).expect("replies serialize"),
    )
}

async fn metadata(State(inner): State<Arc<Inner>>, Path(parent_id): Path<String>) -> Response {
    let me = inner.scenario.me.id.clone();
    let data = lock(&inner.data);
    let Some(parent) = parent(&data, &parent_id).filter(|parent| parent.deleted_at.is_none())
    else {
        drop(data);
        return not_found(&inner);
    };
    let replies = data
        .threads
        .get(&parent_id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mine = |message: &&MessageDto| message.author_id.as_deref() == Some(me.as_str());
    let last_reply = replies.iter().filter(mine).map(|reply| reply.sent_at).max();
    let wrote = mine(&&parent) || last_reply.is_some();
    // Replying subscribes the replier again, whatever they chose before.
    let is_subscribed = match data.thread_subscriptions.get(&parent_id) {
        Some((chosen, at)) if last_reply.is_none_or(|reply| reply < *at) => *chosen,
        _ => wrote,
    };
    let body = ThreadMetadataDto {
        is_subscribed,
        last_reply_at: parent.last_reply_at,
        parent_message_id: parent_id,
        reply_count: parent.reply_count,
    };
    drop(data);
    json_response(
        StatusCode::OK,
        serde_json::to_value(body).expect("metadata serializes"),
    )
}

fn set_subscribed(inner: &Inner, parent_id: String, subscribed: bool) -> Response {
    let mut data = lock(&inner.data);
    if parent(&data, &parent_id).is_none_or(|parent| parent.deleted_at.is_some()) {
        drop(data);
        return not_found(inner);
    }
    let now = inner.now();
    data.thread_subscriptions
        .insert(parent_id, (subscribed, now));
    StatusCode::NO_CONTENT.into_response()
}

async fn subscribe(State(inner): State<Arc<Inner>>, Path(parent_id): Path<String>) -> Response {
    set_subscribed(&inner, parent_id, true)
}

async fn unsubscribe(State(inner): State<Arc<Inner>>, Path(parent_id): Path<String>) -> Response {
    set_subscribed(&inner, parent_id, false)
}
