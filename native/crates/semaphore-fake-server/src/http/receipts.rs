//! Read receipts beyond the counts: a DM's peer watermarks (for "seen by") and one message's
//! readers. The backend's rules are in `backend/src/read-receipts`.

use super::{bearer_token, json_response};
use crate::messages::find_message;
use crate::{Inner, lock};
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Response;
use axum::routing::get;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route(
            "/api/read-receipts/dm-peer-reads/{directMessageGroupId}",
            get(dm_peer_reads),
        )
        .route(
            "/api/read-receipts/message/{messageId}/readers",
            get(message_readers),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/read-receipts/dm-peer-reads/{directMessageGroupId}") => {
            "ReadReceiptsController_getDmPeerReads"
        }
        ("GET", "/api/read-receipts/message/{messageId}/readers") => {
            "ReadReceiptsController_getMessageReaders"
        }
        _ => return None,
    })
}

/// `getDmPeerReads`: the other members' watermarks in one DM. A caller outside the group is
/// refused, as the backend's membership check does.
async fn dm_peer_reads(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(dm_group_id): Path<String>,
) -> Response {
    let user = inner.user_of(bearer_token(&headers));
    let data = lock(&inner.data);
    let Some(members) = crate::social::dm_member_ids(&data, &dm_group_id) else {
        drop(data);
        return inner.error(
            403,
            "FORBIDDEN",
            "You are not a member of this DM group",
            false,
        );
    };
    if !members.contains(&user) {
        drop(data);
        return inner.error(
            403,
            "FORBIDDEN",
            "You are not a member of this DM group",
            false,
        );
    }
    let mut reads: Vec<Value> = data
        .receipts
        .iter()
        .filter(|((context, reader), _)| context == &dm_group_id && reader != &user)
        .map(|((_, reader), at)| json!({ "userId": reader, "lastReadAt": at }))
        .collect();
    drop(data);
    // The server's order is its own; a stable one keeps answers identical across runs.
    reads.sort_by(|a, b| a["userId"].as_str().cmp(&b["userId"].as_str()));
    json_response(StatusCode::OK, Value::Array(reads))
}

/// `getMessageReaders`: everyone but the caller whose watermark is at or after the message's sent
/// time. Exactly one context, a message that exists and belongs to it, and access to it are
/// checked first, in the backend's order and words.
async fn message_readers(
    State(inner): State<Arc<Inner>>,
    headers: HeaderMap,
    Path(message_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let user = inner.user_of(bearer_token(&headers));
    let channel = query.get("channelId");
    let dm = query.get("directMessageGroupId");
    if channel.is_some() == dm.is_some() {
        return inner.error(
            400,
            "BAD_REQUEST",
            "Must provide exactly one of channelId or directMessageGroupId",
            false,
        );
    }
    let (message, sent_at) = {
        let data = lock(&inner.data);
        match find_message(&data, &message_id) {
            Some(message) => {
                let matches = match (channel, dm) {
                    (Some(channel), _) => message.channel_id.as_deref() == Some(channel.as_str()),
                    (_, Some(dm)) => {
                        message.direct_message_group_id.as_deref() == Some(dm.as_str())
                    }
                    _ => false,
                };
                if !matches {
                    drop(data);
                    return inner.error(
                        400,
                        "BAD_REQUEST",
                        "Message does not belong to the specified channel or DM group",
                        false,
                    );
                }
                let sent_at = message.sent_at;
                (message, sent_at)
            }
            None => {
                drop(data);
                return inner.error(400, "BAD_REQUEST", "Message not found", false);
            }
        }
    };
    let _ = message;
    if let Some(channel) = channel
        && !crate::admin::can_view(&inner, channel, &user)
    {
        return inner.error(404, "NOT_FOUND", "Channel not found", false);
    }
    if let Some(dm) = dm {
        let member = crate::social::dm_member_ids(&lock(&inner.data), dm)
            .is_some_and(|members| members.contains(&user));
        if !member {
            return inner.error(
                403,
                "FORBIDDEN",
                "You are not a member of this DM group",
                false,
            );
        }
    }
    let context = channel.or(dm).map(String::as_str).unwrap_or_default();
    let readers: Vec<(String, chrono::DateTime<chrono::Utc>)> = lock(&inner.data)
        .receipts
        .iter()
        .filter(|((read_context, reader), at)| {
            read_context == context && reader != &user && **at >= sent_at
        })
        .map(|((_, reader), at)| (reader.clone(), *at))
        .collect();
    let mut rows: Vec<Value> = Vec::new();
    for (reader_id, read_at) in readers {
        let Some(reader) = inner.user_entity(&reader_id) else {
            continue;
        };
        rows.push(json!({
            "userId": reader.id,
            "username": reader.username,
            "displayName": reader.display_name,
            "avatarUrl": reader.avatar_url,
            "readAt": read_at,
        }));
    }
    rows.sort_by(|a, b| a["userId"].as_str().cmp(&b["userId"].as_str()));
    json_response(StatusCode::OK, Value::Array(rows))
}
