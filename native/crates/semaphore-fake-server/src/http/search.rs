//! Message search (W1 part B): a case-insensitive match on the text, newest first, no paging,
//! and removed messages never found, as the backend's search. Thread replies are found in
//! their parent's channel or conversation. Nothing is broadcast.

use super::{invalid, json_response, limit_query};
use crate::{Inner, lock};
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::get;
use semaphore_wire::MessageDto;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

pub(super) fn routes() -> Router<Arc<Inner>> {
    Router::new()
        .route("/api/messages/search/channel/{channelId}", get(in_channel))
        .route("/api/messages/search/group/{groupId}", get(in_group))
        .route(
            "/api/messages/search/community/{communityId}",
            get(in_community),
        )
}

pub(super) fn operation_id(method: &Method, route: &str) -> Option<&'static str> {
    Some(match (method.as_str(), route) {
        ("GET", "/api/messages/search/channel/{channelId}") => {
            "MessagesController_searchChannelMessages"
        }
        ("GET", "/api/messages/search/group/{groupId}") => {
            "MessagesController_searchDirectMessages"
        }
        ("GET", "/api/messages/search/community/{communityId}") => {
            "MessagesController_searchCommunityMessages"
        }
        _ => return None,
    })
}

/// `q` and `limit`, or the 400 the backend gives.
fn params(query: &HashMap<String, String>) -> Result<(String, usize), Response> {
    let q = query
        .get("q")
        .map(|q| q.trim().to_lowercase())
        .filter(|q| !q.is_empty())
        .ok_or_else(|| invalid("q is required"))?;
    Ok((q, limit_query(query)?))
}

fn text_of(message: &MessageDto) -> String {
    message
        .spans
        .iter()
        .filter_map(|span| span.text.as_deref())
        .collect::<String>()
        .to_lowercase()
}

/// Matches among `messages`, newest first, at most `limit`.
fn matching<'a>(
    messages: impl Iterator<Item = &'a MessageDto>,
    q: &str,
    limit: usize,
) -> Vec<MessageDto> {
    let mut found: Vec<MessageDto> = messages
        .filter(|message| message.deleted_at.is_none() && text_of(message).contains(q))
        .cloned()
        .collect();
    found.sort_by(|a, b| (b.sent_at, b.id.as_str()).cmp(&(a.sent_at, a.id.as_str())));
    found.truncate(limit);
    found
}

/// A context's messages and every reply in it.
fn context_messages<'a>(
    data: &'a crate::Data,
    top: Option<&'a Vec<MessageDto>>,
    belongs: impl Fn(&MessageDto) -> bool + 'a,
) -> impl Iterator<Item = &'a MessageDto> + 'a {
    top.into_iter().flatten().chain(
        data.threads
            .values()
            .flatten()
            .filter(move |reply| belongs(reply)),
    )
}

fn array(found: Vec<Value>) -> Response {
    json_response(StatusCode::OK, Value::Array(found))
}

fn values(found: Vec<MessageDto>) -> Vec<Value> {
    found
        .into_iter()
        .map(|message| serde_json::to_value(message).expect("a message serializes"))
        .collect()
}

async fn in_channel(
    State(inner): State<Arc<Inner>>,
    Path(channel_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (q, limit) = match params(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let messages = context_messages(&data, data.channel_messages.get(&channel_id), |reply| {
        reply.channel_id.as_deref() == Some(channel_id.as_str())
    });
    let found = matching(messages, &q, limit);
    drop(data);
    array(values(found))
}

async fn in_group(
    State(inner): State<Arc<Inner>>,
    Path(group_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (q, limit) = match params(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let data = lock(&inner.data);
    let messages = context_messages(&data, data.dm_messages.get(&group_id), |reply| {
        reply.direct_message_group_id.as_deref() == Some(group_id.as_str())
    });
    let found = matching(messages, &q, limit);
    drop(data);
    array(values(found))
}

/// `CommunitySearchResultDto`: a message with its channel's name.
async fn in_community(
    State(inner): State<Arc<Inner>>,
    Path(community_id): Path<String>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let (q, limit) = match params(&query) {
        Ok(params) => params,
        Err(response) => return response,
    };
    let Some(community) = inner.scenario.community(&community_id) else {
        return inner.error(404, "NOT_FOUND", "Community not found", false);
    };
    let names: HashMap<&str, &str> = community
        .channels
        .iter()
        .map(|channel| (channel.id.as_str(), channel.name.as_str()))
        .collect();
    let data = lock(&inner.data);
    let messages = data
        .channel_messages
        .iter()
        .filter(|(channel_id, _)| names.contains_key(channel_id.as_str()))
        .flat_map(|(_, messages)| messages)
        .chain(data.threads.values().flatten().filter(|reply| {
            reply
                .channel_id
                .as_deref()
                .is_some_and(|id| names.contains_key(id))
        }));
    let found = matching(messages, &q, limit);
    drop(data);
    let found = found
        .into_iter()
        .map(|message| {
            let name = message
                .channel_id
                .as_deref()
                .and_then(|id| names.get(id))
                .copied()
                .unwrap_or_default();
            let mut value = serde_json::to_value(message).expect("a message serializes");
            value["channelName"] = Value::String(name.to_owned());
            value
        })
        .collect();
    array(found)
}
