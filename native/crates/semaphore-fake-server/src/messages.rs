//! Sending, pagination and reactions, over the in-memory message store.

use crate::scenario::sorted;
use crate::{Inner, lock};
use semaphore_wire::enums::{FileType, SpanType};
use semaphore_wire::types::{
    AttachmentDto, MessageDto, MessageReactionsDto, NewMessagePayloadDto, NewThreadReplyPayloadDto,
    ReactionDto, ReplyToPreviewDto, SpanDto,
};
use serde::Deserialize;
use serde_json::{Value, json};

/// Where a send puts its message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SendTarget {
    Channel(String),
    DirectMessage(String),
    Thread(String),
}

impl SendTarget {
    fn matches(&self, other: &SendTarget) -> bool {
        self == other
    }
}

/// The parts of a create request the fake uses. Ids stay strings: the scenarios use
/// readable ids like `channel-13`, while the contract declares `format: uuid`.
#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct SendBody {
    #[serde(rename = "channelId", default)]
    pub channel_id: Option<String>,
    #[serde(rename = "directMessageGroupId", default)]
    pub direct_message_group_id: Option<String>,
    #[serde(default)]
    pub spans: Vec<SendSpan>,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(rename = "pendingAttachments", default)]
    pub pending_attachments: Option<i64>,
    #[serde(rename = "clientNonce", default)]
    pub client_nonce: Option<String>,
    #[serde(rename = "replyToId", default)]
    pub reply_to_id: Option<String>,
    #[serde(rename = "parentMessageId", default)]
    pub parent_message_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub(crate) struct SendSpan {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(rename = "userId", default)]
    pub user_id: Option<String>,
    #[serde(rename = "specialKind", default)]
    pub special_kind: Option<String>,
    #[serde(rename = "communityId", default)]
    pub community_id: Option<String>,
    #[serde(rename = "channelId", default)]
    pub channel_id: Option<String>,
    #[serde(rename = "aliasId", default)]
    pub alias_id: Option<String>,
    #[serde(rename = "emojiId", default)]
    pub emoji_id: Option<String>,
    #[serde(default)]
    pub bold: Option<bool>,
    #[serde(default)]
    pub italic: Option<bool>,
    #[serde(default)]
    pub strikethrough: Option<bool>,
    #[serde(default)]
    pub code: Option<bool>,
}

/// A failed send, with the numbers an ack or a REST error needs.
#[derive(Clone, Debug)]
pub(crate) struct SendFailure {
    pub status: u16,
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

impl SendFailure {
    pub fn new(status: u16, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.to_owned(),
            message: message.into(),
            retryable: false,
            retry_after_ms: None,
        }
    }
}

/// Parse the query parameters shared by the message list endpoints.
pub(crate) fn page_params(
    query: &std::collections::HashMap<String, String>,
) -> Result<(usize, Option<String>, String), SendFailure> {
    let limit = match query.get("limit") {
        Some(raw) => raw
            .parse::<usize>()
            .map_err(|_| SendFailure::new(400, "VALIDATION_FAILED", "limit must be an integer"))?,
        None => 50,
    };
    let limit = limit.min(100);
    let direction = match query.get("direction").map(String::as_str) {
        Some("newer" | "older") => query["direction"].clone(),
        Some(_) => {
            return Err(SendFailure::new(
                400,
                "VALIDATION_FAILED",
                "direction must be older or newer",
            ));
        }
        None => "older".to_owned(),
    };
    Ok((limit, query.get("continuationToken").cloned(), direction))
}

/// One page of top-level messages, newest first, as the real backend serves it.
pub(crate) fn page(
    messages: &[MessageDto],
    limit: usize,
    continuation_token: Option<&str>,
    direction: &str,
) -> (Vec<MessageDto>, Option<String>) {
    let ordered: Vec<&MessageDto> = messages
        .iter()
        .filter(|message| message.parent_message_id.is_none())
        .collect();
    if limit == 0 {
        return (Vec::new(), None);
    }
    if direction == "newer" {
        let start = match continuation_token {
            Some(token) => match ordered.iter().position(|message| message.id == token) {
                Some(index) => index + 1,
                None => return (Vec::new(), None),
            },
            None => 0,
        };
        let mut out: Vec<MessageDto> = ordered
            .iter()
            .skip(start)
            .take(limit)
            .map(|message| (*message).clone())
            .collect();
        let next = if out.len() == limit {
            out.last().map(|message| message.id.clone())
        } else {
            None
        };
        out.reverse();
        return (out, next);
    }

    let end = match continuation_token {
        Some(token) => match ordered.iter().position(|message| message.id == token) {
            Some(index) => index.checked_sub(1),
            None => None,
        },
        None => ordered.len().checked_sub(1),
    };
    let mut out = Vec::new();
    if let Some(mut index) = end {
        loop {
            out.push(ordered[index].clone());
            if out.len() == limit || index == 0 {
                break;
            }
            index -= 1;
        }
    }
    let next = if out.len() == limit {
        out.last().map(|message| message.id.clone())
    } else {
        None
    };
    (out, next)
}

/// Messages around one anchor, newest first: newer, the anchor, then older.
pub(crate) fn around(
    messages: &[MessageDto],
    message_id: &str,
    limit: usize,
) -> Option<(Vec<MessageDto>, Option<String>, Option<String>)> {
    let ordered: Vec<&MessageDto> = messages
        .iter()
        .filter(|message| message.parent_message_id.is_none())
        .collect();
    let index = ordered
        .iter()
        .position(|message| message.id == message_id)?;
    let half = limit.saturating_sub(1) / 2;
    let older: Vec<MessageDto> = ordered[..index]
        .iter()
        .rev()
        .take(half)
        .map(|message| (*message).clone())
        .collect();
    let newer: Vec<MessageDto> = ordered[index + 1..]
        .iter()
        .take(half)
        .map(|message| (*message).clone())
        .collect();
    let older_token = if older.len() == half {
        older.last().map(|message| message.id.clone())
    } else {
        None
    };
    let newer_token = if newer.len() == half {
        newer.last().map(|message| message.id.clone())
    } else {
        None
    };
    let mut out: Vec<MessageDto> = newer.into_iter().rev().collect();
    out.push(ordered[index].clone());
    out.extend(older);
    Some((out, older_token, newer_token))
}

fn span_type(kind: &str) -> SpanType {
    SpanType::Unknown(kind.to_owned())
}

pub(crate) fn span_from(send: &SendSpan) -> SpanDto {
    SpanDto {
        alias_id: send.alias_id.clone(),
        bold: send.bold,
        channel_id: send.channel_id.clone(),
        code: send.code,
        community_id: send.community_id.clone(),
        emoji_id: send.emoji_id.clone(),
        italic: send.italic,
        special_kind: send.special_kind.clone(),
        strikethrough: send.strikethrough,
        text: send.text.clone(),
        type_: span_type(&send.kind),
        user_id: send.user_id.clone(),
    }
}

fn attachment_from(id: &str) -> AttachmentDto {
    AttachmentDto {
        file_type: FileType::Document,
        filename: id.to_owned(),
        has_thumbnail: false,
        id: id.to_owned(),
        mime_type: "application/octet-stream".to_owned(),
        size: 0,
    }
}

fn reply_preview(message: &MessageDto) -> ReplyToPreviewDto {
    ReplyToPreviewDto {
        author_id: message.author_id.clone(),
        deleted_at: message.deleted_at,
        id: message.id.clone(),
        sent_at: message.sent_at,
        spans: message.spans.clone(),
    }
}

fn context_of(target: &SendTarget) -> (Option<&str>, Option<&str>, Option<&str>) {
    match target {
        SendTarget::Channel(id) => (Some(id), None, None),
        SendTarget::DirectMessage(id) => (None, Some(id), None),
        SendTarget::Thread(id) => (None, None, Some(id)),
    }
}

/// Create (or find, for a retried nonce) one message, then broadcast it.
///
/// Returns the message. The caller decides how to ack it.
pub(crate) fn send(
    inner: &Inner,
    target: SendTarget,
    body: &SendBody,
    fault: Option<crate::SendFault>,
) -> Result<MessageDto, SendFailure> {
    if let Some(fault) = fault {
        let status = if fault.retryable { 429 } else { 400 };
        let mut failure = SendFailure::new(status, &fault.code, "Injected send failure");
        failure.retryable = fault.retryable;
        failure.retry_after_ms = fault.retry_after_ms;
        return Err(failure);
    }

    if body.spans.is_empty() && body.attachments.is_empty() {
        return Err(SendFailure::new(
            400,
            "VALIDATION_FAILED",
            "spans must not be empty",
        ));
    }
    let nonce = match body.client_nonce.as_deref() {
        Some(nonce) => {
            if uuid::Uuid::parse_str(nonce).is_err() {
                return Err(SendFailure::new(
                    400,
                    "VALIDATION_FAILED",
                    "clientNonce must be a UUID",
                ));
            }
            Some(nonce)
        }
        None => None,
    };

    let author = inner.scenario.me.id.clone();
    let now = inner.now();
    let mut data = lock(&inner.data);

    if let Some(nonce) = nonce
        && let Some(entry) = data.nonces.get(&(author.clone(), nonce.to_owned()))
    {
        if entry.target.matches(&target) {
            let existing = find_message(&data, &entry.message_id)
                .expect("a nonce always points at a stored message");
            return Ok(existing);
        }
        return Err(SendFailure::new(
            409,
            "NONCE_CONFLICT",
            "This clientNonce was used for a different message",
        ));
    }

    let message_id = inner.next_message_id();
    let (channel_id, dm_id, parent_id) = context_of(&target);

    let reply_to = match body.reply_to_id.as_deref() {
        Some(reply_id) => match find_message(&data, reply_id) {
            Some(parent) => Some(reply_preview(&parent)),
            None => {
                return Err(SendFailure::new(
                    404,
                    "QUOTE_NOT_FOUND",
                    "The message being replied to does not exist",
                ));
            }
        },
        None => None,
    };

    let thread_parent = match &target {
        SendTarget::Thread(parent_id) => match find_message(&data, parent_id) {
            Some(parent) => Some(parent),
            None => {
                return Err(SendFailure::new(
                    404,
                    "NOT_FOUND",
                    "The parent message does not exist",
                ));
            }
        },
        _ => None,
    };
    // A reply lives in its parent's context, like the real `toMessageDto`.
    let (channel_id, dm_id) = match &thread_parent {
        Some(parent) => (
            parent.channel_id.clone(),
            parent.direct_message_group_id.clone(),
        ),
        None => (channel_id.map(str::to_owned), dm_id.map(str::to_owned)),
    };

    let message = MessageDto {
        attachments: body
            .attachments
            .iter()
            .map(|id| attachment_from(id))
            .collect(),
        author_id: Some(author.clone()),
        channel_id,
        client_nonce: nonce.map(str::to_owned),
        deleted_at: None,
        deleted_by: None,
        deleted_by_reason: None,
        direct_message_group_id: dm_id,
        edited_at: None,
        id: message_id.clone(),
        last_reply_at: None,
        link_previews: None,
        parent_message_id: parent_id.map(str::to_owned),
        pending_attachments: Some(body.pending_attachments.unwrap_or(0)),
        pinned: false,
        pinned_at: None,
        pinned_by: None,
        reactions: Vec::new(),
        reply_count: 0,
        reply_to,
        reply_to_id: body.reply_to_id.clone(),
        sent_at: now,
        spans: body.spans.iter().map(span_from).collect(),
        webhook: None,
    };

    match &target {
        SendTarget::Channel(id) => {
            let messages = data.channel_messages.entry(id.clone()).or_default();
            messages.push(message.clone());
            sorted(messages);
        }
        SendTarget::DirectMessage(id) => {
            let messages = data.dm_messages.entry(id.clone()).or_default();
            messages.push(message.clone());
            sorted(messages);
        }
        SendTarget::Thread(parent_id) => {
            let replies = data.threads.entry(parent_id.clone()).or_default();
            replies.push(message.clone());
            sorted(replies);
            if let Some(parent) = find_message_mut(&mut data, parent_id) {
                parent.reply_count += 1;
                parent.last_reply_at = Some(now);
            }
        }
    }

    if let Some(nonce) = nonce {
        data.nonces.insert(
            (author, nonce.to_owned()),
            crate::NonceEntry {
                message_id: message_id.clone(),
                target: target.clone(),
            },
        );
    }

    let payload = match &target {
        SendTarget::Channel(_) | SendTarget::DirectMessage(_) => {
            let payload = NewMessagePayloadDto {
                message: message.clone(),
            };
            let event = match &target {
                SendTarget::Channel(_) => "newMessage",
                SendTarget::DirectMessage(_) => "newDirectMessage",
                SendTarget::Thread(_) => unreachable!(),
            };
            (
                event,
                serde_json::to_value(&payload).expect("a payload serializes"),
            )
        }
        SendTarget::Thread(parent_id) => {
            let payload = NewThreadReplyPayloadDto {
                parent_message_id: parent_id.clone(),
                reply: message.clone(),
            };
            (
                "newThreadReply",
                serde_json::to_value(&payload).expect("a payload serializes"),
            )
        }
    };
    drop(data);
    inner.broadcast(payload.0, payload.1);
    Ok(message)
}

/// A channel message from someone other than the signed-in user, as if another client sent it. With
/// `broadcast` false nobody hears of it, which is what a client misses while disconnected: only a
/// resync finds it.
/// What a `post_as` message carries besides its text.
#[derive(Default)]
pub(crate) struct PostExtras {
    /// A custom emoji after the text: its id and name.
    pub emoji: Option<(String, String)>,
    /// A link preview, as the server's unfurler would have made it.
    pub link_preview: Option<serde_json::Value>,
}

pub(crate) fn post_as(
    inner: &Inner,
    channel_id: &str,
    author_id: &str,
    text: &str,
    broadcast: bool,
    extras: PostExtras,
) -> MessageDto {
    let mut spans = vec![span_from(&SendSpan {
        kind: "PLAIN".into(),
        text: Some(text.to_owned()),
        ..SendSpan::default()
    })];
    if let Some((id, name)) = &extras.emoji {
        spans.push(span_from(&SendSpan {
            kind: "EMOJI".into(),
            text: Some(format!(":{name}:")),
            emoji_id: Some(id.clone()),
            ..SendSpan::default()
        }));
    }
    let link_previews = extras
        .link_preview
        .and_then(|preview| serde_json::from_value(preview).ok())
        .map(|preview| vec![preview]);
    let message = MessageDto {
        attachments: Vec::new(),
        author_id: Some(author_id.to_owned()),
        channel_id: Some(channel_id.to_owned()),
        client_nonce: None,
        deleted_at: None,
        deleted_by: None,
        deleted_by_reason: None,
        direct_message_group_id: None,
        edited_at: None,
        id: inner.next_message_id(),
        last_reply_at: None,
        link_previews,
        parent_message_id: None,
        pending_attachments: Some(0),
        pinned: false,
        pinned_at: None,
        pinned_by: None,
        reactions: Vec::new(),
        reply_count: 0,
        reply_to: None,
        reply_to_id: None,
        sent_at: inner.now(),
        spans,
        webhook: None,
    };
    {
        let mut data = lock(&inner.data);
        let messages = data
            .channel_messages
            .entry(channel_id.to_owned())
            .or_default();
        messages.push(message.clone());
        sorted(messages);
    }
    if broadcast {
        let payload = NewMessagePayloadDto {
            message: message.clone(),
        };
        inner.broadcast(
            "newMessage",
            serde_json::to_value(&payload).expect("a payload serializes"),
        );
    }
    message
}

/// Adds an uploaded file to a message, or with none just releases a pending slot, and broadcasts
/// the message as `updateMessage`. `None` if the message or the file isn't there.
pub(crate) fn add_attachment(
    inner: &Inner,
    message_id: &str,
    file_id: Option<&str>,
) -> Option<MessageDto> {
    let mut data = lock(&inner.data);
    let attachment = match file_id {
        Some(file_id) => {
            let file = data.files.get(file_id)?.clone();
            Some(AttachmentDto {
                file_type: if file.mime_type.starts_with("image/") {
                    FileType::Image
                } else {
                    FileType::Document
                },
                filename: file.filename,
                has_thumbnail: false,
                id: file_id.to_owned(),
                mime_type: file.mime_type,
                size: file.bytes.len() as i64,
            })
        }
        None => None,
    };
    let message = find_message_mut(&mut data, message_id)?;
    if let Some(attachment) = attachment {
        message.attachments.push(attachment);
    }
    message.pending_attachments = Some(message.pending_attachments.unwrap_or(0).saturating_sub(1));
    let message = message.clone();
    drop(data);
    inner.broadcast("updateMessage", serde_json::json!({ "message": message }));
    Some(message)
}

/// Custom emoji used by any message in a community's channels, as `CustomEmojiDto`s.
pub(crate) fn emojis_in_use(inner: &Inner, community_id: &str) -> Vec<serde_json::Value> {
    let channels: Vec<String> = inner
        .scenario
        .communities
        .iter()
        .filter(|community| community.id == community_id)
        .flat_map(|community| community.channels.iter().map(|channel| channel.id.clone()))
        .collect();
    let data = lock(&inner.data);
    let mut seen = std::collections::BTreeMap::new();
    // One every community has, so a test can post it without a scenario that uses it.
    seen.insert("emoji-party".to_owned(), "party".to_owned());
    for channel in &channels {
        for message in data.channel_messages.get(channel).into_iter().flatten() {
            for span in &message.spans {
                if let (Some(id), Some(text)) = (&span.emoji_id, &span.text) {
                    let name = text.trim_matches(':').to_owned();
                    seen.entry(id.clone()).or_insert(name);
                }
            }
        }
    }
    seen.into_iter()
        .map(|(id, name)| {
            serde_json::json!({
                "id": id, "name": name, "fileId": id, "communityId": community_id,
                "createdAt": inner.scenario.epoch, "createdBy": null,
            })
        })
        .collect()
}

pub(crate) fn find_message(data: &crate::Data, id: &str) -> Option<MessageDto> {
    data.channel_messages
        .values()
        .chain(data.dm_messages.values())
        .chain(data.threads.values())
        .flatten()
        .find(|message| message.id == id)
        .cloned()
}

pub(crate) fn find_message_mut<'a>(
    data: &'a mut crate::Data,
    id: &str,
) -> Option<&'a mut MessageDto> {
    data.channel_messages
        .values_mut()
        .chain(data.dm_messages.values_mut())
        .chain(data.threads.values_mut())
        .flatten()
        .find(|message| message.id == id)
}

/// Find the message store a reaction endpoint applies to.
pub(crate) fn message_map<'a>(
    data: &'a mut crate::Data,
    id: &str,
) -> Option<&'a mut Vec<MessageDto>> {
    for map in [
        &mut data.channel_messages,
        &mut data.dm_messages,
        &mut data.threads,
    ] {
        for messages in map.values_mut() {
            if messages.iter().any(|message| message.id == id) {
                return Some(messages);
            }
        }
    }
    None
}

/// Add `me` to a message's reaction, returning the DTO the REST route sends.
pub(crate) fn add_reaction(inner: &Inner, id: &str, emoji: &str) -> Option<MessageReactionsDto> {
    let author = inner.scenario.me.id.clone();
    let mut data = lock(&inner.data);
    let messages = message_map(&mut data, id)?;
    let message = messages.iter_mut().find(|message| message.id == id)?;
    match message
        .reactions
        .iter_mut()
        .find(|reaction| reaction.emoji == emoji)
    {
        Some(reaction) => {
            if !reaction.user_ids.contains(&author) {
                reaction.user_ids.push(author);
            }
        }
        None => message.reactions.push(ReactionDto {
            emoji: emoji.to_owned(),
            user_ids: vec![author],
        }),
    }
    Some(reactions_dto(message))
}

pub(crate) fn remove_reaction(inner: &Inner, id: &str, emoji: &str) -> Option<MessageReactionsDto> {
    let author = inner.scenario.me.id.clone();
    let mut data = lock(&inner.data);
    let messages = message_map(&mut data, id)?;
    let message = messages.iter_mut().find(|message| message.id == id)?;
    if let Some(reaction) = message
        .reactions
        .iter_mut()
        .find(|reaction| reaction.emoji == emoji)
    {
        reaction.user_ids.retain(|user| user != &author);
    }
    message
        .reactions
        .retain(|reaction| !reaction.user_ids.is_empty());
    Some(reactions_dto(message))
}

fn reactions_dto(message: &MessageDto) -> MessageReactionsDto {
    MessageReactionsDto {
        channel_id: message.channel_id.clone(),
        deleted_at: message.deleted_at,
        direct_message_group_id: message.direct_message_group_id.clone(),
        id: message.id.clone(),
        parent_message_id: message.parent_message_id.clone(),
        reactions: message.reactions.clone(),
    }
}

/// The scenario's unread counts, plus anything `markAsRead` cleared.
pub(crate) fn unread_counts(inner: &Inner) -> Value {
    let data = lock(&inner.data);
    let counts: Vec<Value> = data
        .unread
        .iter()
        .map(|(context, (unread, mentions))| {
            let mut body = json!({
                "unreadCount": unread,
                "mentionCount": mentions,
            });
            if inner.scenario.dm_ids.contains(context) {
                body["directMessageGroupId"] = Value::from(context.clone());
            } else {
                body["channelId"] = Value::from(context.clone());
            }
            body
        })
        .collect();
    Value::Array(counts)
}

pub(crate) fn mark_read(
    inner: &Inner,
    channel_id: Option<&str>,
    dm_id: Option<&str>,
    last_read_message_id: &str,
) -> Value {
    let now = inner.now();
    let user = inner.scenario.me.id.clone();
    let context = channel_id.or(dm_id);
    {
        let mut data = lock(&inner.data);
        if let Some(context) = context
            && let Some(counts) = data.unread.get_mut(context)
        {
            *counts = (0, 0);
        }
    }
    let mut body = json!({
        "id": inner.next_receipt_id(),
        "userId": user,
        "channelId": channel_id,
        "directMessageGroupId": dm_id,
        "lastReadMessageId": last_read_message_id,
        "lastReadAt": now,
    });
    if channel_id.is_none() && dm_id.is_none() {
        body["channelId"] = Value::Null;
        body["directMessageGroupId"] = Value::Null;
    }
    body
}

/// Voice presence for one channel, with `me`'s changes applied.
pub(crate) fn voice_presence(inner: &Inner, channel_id: &str) -> Value {
    let data = lock(&inner.data);
    let users = data.voice.get(channel_id).cloned().unwrap_or_default();
    json!({
        "channelId": channel_id,
        "users": users,
        "count": users.len(),
    })
}

pub(crate) fn voice_join(inner: &Inner, channel_id: &str) -> Value {
    let now = inner.now();
    let me = &inner.scenario.me;
    {
        let mut data = lock(&inner.data);
        let users = data.voice.entry(channel_id.to_owned()).or_default();
        match users.iter_mut().find(|user| user.id == me.id) {
            Some(user) => user.joined_at = now,
            None => users.push(semaphore_wire::VoicePresenceUserDto {
                avatar_url: me.avatar_url.clone(),
                display_name: me.display_name.clone(),
                id: me.id.clone(),
                is_deafened: false,
                is_server_muted: false,
                joined_at: now,
                username: me.username.clone(),
            }),
        }
    }
    presence_result(channel_id, "Joined voice channel")
}

pub(crate) fn voice_leave(inner: &Inner, channel_id: &str) -> Value {
    {
        let mut data = lock(&inner.data);
        if let Some(users) = data.voice.get_mut(channel_id) {
            users.retain(|user| user.id != inner.scenario.me.id);
        }
    }
    presence_result(channel_id, "Left voice channel")
}

pub(crate) fn voice_refresh(_inner: &Inner, channel_id: &str) -> Value {
    presence_result(channel_id, "Presence refreshed")
}

pub(crate) fn voice_deafen(inner: &Inner, channel_id: &str, deafened: bool) -> Value {
    {
        let mut data = lock(&inner.data);
        if let Some(user) = data
            .voice
            .entry(channel_id.to_owned())
            .or_default()
            .iter_mut()
            .find(|user| user.id == inner.scenario.me.id)
        {
            user.is_deafened = deafened;
        }
    }
    presence_result(channel_id, "Deafen state updated")
}

fn presence_result(channel_id: &str, message: &str) -> Value {
    json!({
        "success": true,
        "message": message,
        "channelId": channel_id,
    })
}
