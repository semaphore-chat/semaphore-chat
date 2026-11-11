//! Edit, delete, pins, a moderator's removal and channel roles, over the in-memory message store
//! (W1 part A). The signed-in user moderates every channel: the roles route says so, and removed
//! messages are served whole, as the backend serves them to moderators.

use crate::messages::{SendSpan, find_message, find_message_mut, span_from};
use crate::{Inner, lock};
use semaphore_wire::types::MessageDto;
use serde::Deserialize;
use serde_json::{Value, json};

/// A refusal: status, error code, message.
pub(crate) type Refusal = (u16, &'static str, &'static str);

const NOT_FOUND: Refusal = (404, "NOT_FOUND", "Message not found");

#[derive(Deserialize)]
pub(crate) struct EditBody {
    #[serde(default)]
    spans: Option<Vec<SendSpan>>,
    #[serde(default)]
    attachments: Option<Vec<String>>,
}

#[derive(Deserialize, Default)]
pub(crate) struct ReasonBody {
    #[serde(default)]
    pub reason: Option<String>,
}

fn room_payload(message: &MessageDto) -> Value {
    json!({
        "messageId": message.id,
        "channelId": message.channel_id,
        "directMessageGroupId": message.direct_message_group_id,
    })
}

/// `PATCH /messages/{id}`: the author only, and not once removed. Spans and attachments only;
/// an attachment list keeps those named and drops the rest.
pub(crate) fn edit(inner: &Inner, id: &str, body: EditBody) -> Result<MessageDto, Refusal> {
    let me = inner.scenario.me.id.clone();
    let now = inner.now();
    let mut data = lock(&inner.data);
    let message = find_message_mut(&mut data, id).ok_or(NOT_FOUND)?;
    if message.author_id.as_deref() != Some(me.as_str()) {
        return Err((403, "FORBIDDEN", "Only the author can modify this message"));
    }
    if message.deleted_at.is_some() {
        return Err((403, "FORBIDDEN", "This message was removed"));
    }
    if let Some(spans) = &body.spans {
        if spans.is_empty() {
            return Err((400, "VALIDATION_FAILED", "At least one span is required"));
        }
        message.spans = spans.iter().map(span_from).collect();
        message.edited_at = Some(now);
    }
    if let Some(keep) = &body.attachments {
        message.attachments.retain(|file| keep.contains(&file.id));
    }
    let updated = message.clone();
    drop(data);
    inner.broadcast("updateMessage", json!({ "message": updated }));
    Ok(updated)
}

/// `DELETE /messages/{id}`: gone, with its thread's replies.
pub(crate) fn delete(inner: &Inner, id: &str) -> Result<(), Refusal> {
    let mut data = lock(&inner.data);
    let message = find_message(&data, id).ok_or(NOT_FOUND)?;
    let data = &mut *data;
    for map in [
        &mut data.channel_messages,
        &mut data.dm_messages,
        &mut data.threads,
    ] {
        for messages in map.values_mut() {
            messages.retain(|candidate| candidate.id != id);
        }
    }
    data.threads.remove(id);
    inner.broadcast("deleteMessage", room_payload(&message));
    Ok(())
}

/// `GET /messages/{id}`.
pub(crate) fn find_one(inner: &Inner, id: &str) -> Result<MessageDto, Refusal> {
    find_message(&lock(&inner.data), id).ok_or(NOT_FOUND)
}

/// `DELETE /moderation/message/{id}`: a soft removal of a channel message.
pub(crate) fn remove_as_mod(
    inner: &Inner,
    id: &str,
    reason: Option<String>,
) -> Result<(), Refusal> {
    let me = inner.scenario.me.id.clone();
    let now = inner.now();
    let mut data = lock(&inner.data);
    let message = find_message_mut(&mut data, id).ok_or(NOT_FOUND)?;
    if message.channel_id.is_none() {
        return Err((
            403,
            "FORBIDDEN",
            "Cannot delete direct messages as moderator",
        ));
    }
    if message.deleted_at.is_some() {
        return Err((409, "CONFLICT", "Message is already deleted"));
    }
    message.deleted_at = Some(now);
    message.deleted_by = Some(me);
    message.deleted_by_reason = reason;
    let removed = message.clone();
    drop(data);
    inner.broadcast("deleteMessage", room_payload(&removed));
    Ok(())
}

/// `POST` and `DELETE /moderation/pin/{id}`: channel messages only.
pub(crate) fn set_pinned(inner: &Inner, id: &str, pinned: bool) -> Result<(), Refusal> {
    let me = inner.scenario.me.id.clone();
    let now = inner.now();
    let mut data = lock(&inner.data);
    let message = find_message_mut(&mut data, id).ok_or(NOT_FOUND)?;
    let Some(channel_id) = message.channel_id.clone() else {
        return Err((403, "FORBIDDEN", "Cannot pin direct messages"));
    };
    if message.pinned == pinned {
        return Err(if pinned {
            (409, "CONFLICT", "Message is already pinned")
        } else {
            (409, "CONFLICT", "Message is not pinned")
        });
    }
    message.pinned = pinned;
    message.pinned_by = pinned.then(|| me.clone());
    message.pinned_at = pinned.then_some(now);
    drop(data);
    if pinned {
        inner.broadcast(
            "messagePinned",
            json!({ "messageId": id, "channelId": channel_id, "pinnedBy": me, "pinnedAt": now }),
        );
    } else {
        inner.broadcast(
            "messageUnpinned",
            json!({ "messageId": id, "channelId": channel_id, "unpinnedBy": me }),
        );
    }
    Ok(())
}

/// `GET /moderation/pins/{channelId}`: pinned and not removed, oldest pin first, each with its
/// author.
pub(crate) fn pins(inner: &Inner, channel_id: &str) -> Value {
    let data = lock(&inner.data);
    let mut pinned: Vec<MessageDto> = data
        .channel_messages
        .get(channel_id)
        .into_iter()
        .flatten()
        .chain(data.threads.values().flatten())
        .filter(|message| {
            message.pinned
                && message.deleted_at.is_none()
                && message.channel_id.as_deref() == Some(channel_id)
        })
        .cloned()
        .collect();
    drop(data);
    pinned.sort_by_key(|message| message.pinned_at);
    let author = |id: &Option<String>| -> Value {
        let users = std::iter::once(&inner.scenario.me).chain(&inner.scenario.users);
        id.as_deref()
            .and_then(|id| users.into_iter().find(|user| user.id == id))
            .map_or(Value::Null, |user| {
                json!({
                    "id": user.id,
                    "username": user.username,
                    "displayName": user.display_name,
                    "avatarUrl": user.avatar_url,
                })
            })
    };
    Value::Array(
        pinned
            .iter()
            .map(|message| {
                let mut value = serde_json::to_value(message).expect("a message serializes");
                value["author"] = author(&message.author_id);
                value
            })
            .collect(),
    )
}

/// `GET /roles/my/instance`: the signed-in user's instance roles; the default one may create
/// communities.
pub(crate) fn my_instance_roles(inner: &Inner) -> Value {
    json!({
        "userId": inner.scenario.me.id,
        "resourceId": null,
        "resourceType": "INSTANCE",
        "roles": [{
            "id": "role-instance-member",
            "name": "Member",
            "position": 0,
            "isDefault": true,
            "createdAt": inner.scenario.epoch,
            "actions": ["CREATE_COMMUNITY"],
        }],
    })
}

pub(crate) fn my_channel_roles(inner: &Inner, channel_id: &str) -> Value {
    json!({
        "userId": inner.scenario.me.id,
        "resourceId": channel_id,
        "resourceType": "CHANNEL",
        "roles": [{
            "id": "role-moderator",
            "name": "Moderator",
            "position": 1,
            "isDefault": false,
            "createdAt": inner.scenario.epoch,
            "actions": ["READ_MESSAGE", "CREATE_MESSAGE", "PIN_MESSAGE", "UNPIN_MESSAGE", "DELETE_ANY_MESSAGE"],
        }],
    })
}
