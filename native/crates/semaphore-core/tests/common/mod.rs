//! Fakes for what core talks to, and a mirror that applies `ListOp`s the way a UI must.
#![allow(dead_code)]

// W1: each part's fakes in a file of its own, so the two don't edit the same lines.
mod actions;
mod reading;
#[allow(unused_imports)]
pub use actions::refusal;

use async_trait::async_trait;
use semaphore_core::backend::{
    BackendError, BackendResult, CommunitiesBackend, FilesBackend, MessagesBackend, SessionBackend,
    VoiceBackend,
};
use semaphore_core::model::{Conversation, ListOp, MessageRow, VideoDemand, VoiceView};
use semaphore_core::platform::{Clock, CoreError, CoreEvent, EventSink, MediaEngine};
use semaphore_core::realtime::{Realtime, RealtimeError, RealtimeEvent};
use semaphore_core::{Core, Services};
use semaphore_wire::enums::{ErrorCode, MessagePageDirection};
use semaphore_wire::types::{self as wire, MessageDto};
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

pub const CHANNEL: &str = "chan";
pub const ME: &str = "me";

pub fn channel() -> Conversation {
    Conversation::Channel { id: CHANNEL.into() }
}

pub struct FakeClock(pub AtomicU64);

impl FakeClock {
    pub fn advance(&self, ms: u64) {
        self.0.fetch_add(ms, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
pub struct Recorder(pub Mutex<Vec<CoreEvent>>);

impl EventSink for Recorder {
    fn on_event(&self, event: CoreEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Recorder {
    pub fn take(&self) -> Vec<CoreEvent> {
        std::mem::take(&mut self.0.lock().unwrap())
    }
}

/// Applies ops as a UI must, so a test sees what a user would.
pub fn apply(rows: &mut Vec<MessageRow>, ops: &[ListOp]) {
    for op in ops {
        match op {
            ListOp::Reset { rows: new } => *rows = new.clone(),
            ListOp::Insert { index, rows: new } => {
                rows.splice(*index as usize..*index as usize, new.clone());
            }
            ListOp::Remove { index, count } => {
                rows.drain(*index as usize..(*index + *count) as usize);
            }
            ListOp::Replace { index, rows: new } => {
                for (offset, row) in new.iter().enumerate() {
                    rows[*index as usize + offset] = row.clone();
                }
            }
        }
    }
}

pub fn message(id: &str, author: &str, text: &str) -> MessageDto {
    serde_json::from_value(message_json(id, author, text)).unwrap()
}

pub fn message_json(id: &str, author: &str, text: &str) -> Value {
    json!({
        "id": id,
        "channelId": CHANNEL,
        "authorId": author,
        "spans": [{ "type": "PLAINTEXT", "text": text }],
        "attachments": [],
        "reactions": [],
        "pinned": false,
        "replyCount": 0,
        "sentAt": "2026-09-22T18:00:00.000Z",
    })
}

pub fn new_message(id: &str, author: &str, text: &str) -> RealtimeEvent {
    RealtimeEvent::Event {
        name: "newMessage".into(),
        payload: json!({ "message": message_json(id, author, text) }),
    }
}

pub fn echo(id: &str, nonce: &str, text: &str) -> RealtimeEvent {
    let mut message = message_json(id, ME, text);
    message["clientNonce"] = json!(nonce);
    RealtimeEvent::Event {
        name: "newMessage".into(),
        payload: json!({ "message": message }),
    }
}

pub fn event(name: &str, payload: Value) -> RealtimeEvent {
    RealtimeEvent::Event {
        name: name.into(),
        payload,
    }
}

pub fn connected() -> RealtimeEvent {
    RealtimeEvent::Connected { sid: "s".into() }
}

pub fn dropped() -> RealtimeEvent {
    RealtimeEvent::Disconnected {
        reason: "transport close".into(),
    }
}

/// `count` messages `prefix-0` (oldest) to `prefix-{count-1}` (newest), newest first as the server
/// pages them.
pub fn history(prefix: &str, count: usize) -> Vec<MessageDto> {
    (0..count)
        .rev()
        .map(|n| {
            message(
                &format!("{prefix}-{n}"),
                "someone",
                &format!("{prefix} {n}"),
            )
        })
        .collect()
}

fn not_found() -> BackendError {
    BackendError {
        status: 404,
        code: ErrorCode::Unknown("NOT_FOUND".into()),
        message: "not scripted".into(),
        retryable: false,
        retry_after_ms: None,
    }
}

pub fn refused() -> BackendError {
    BackendError {
        status: 401,
        code: ErrorCode::Unknown("UNAUTHENTICATED".into()),
        message: "bad password".into(),
        retryable: false,
        retry_after_ms: None,
    }
}

pub fn user_json(id: &str) -> Value {
    json!({ "id": id, "username": id, "role": "USER", "displayName": null })
}

/// Serves messages the way the backend does: newest first, the token a message id.
#[derive(Default)]
pub struct FakeBackend {
    /// Newest first, by channel.
    pub messages: Mutex<HashMap<String, Vec<MessageDto>>>,
    pub thread_replies: Mutex<HashMap<String, Vec<MessageDto>>>,
    pub page_requests: AtomicU64,
    /// Holds the next page until this fires, to test what happens while one is in flight.
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
    pub unread: Mutex<Vec<Value>>,
    pub unread_requests: AtomicU64,
    pub channels: Mutex<Vec<Value>>,
    pub channel_requests: AtomicU64,
    pub presence_requests: AtomicU64,
    pub user_requests: AtomicU64,
    pub login_fails: Mutex<bool>,
    pub access_token: Mutex<String>,
    pub server_url: Mutex<Option<String>>,
    pub logged_out: AtomicU64,
    pub refreshes: AtomicU64,
    /// Every member, in order. Served a page at a time, with a token while more remain.
    pub members: Mutex<Vec<Value>>,
    pub member_page_requests: AtomicU64,
    pub bulk_presence: Mutex<HashMap<String, bool>>,
    pub notification_count: Mutex<i64>,
    pub notification_requests: AtomicU64,
    pub capabilities: Mutex<Option<Value>>,
    pub voice_users: Mutex<Vec<Value>>,
    pub tokens_minted: AtomicU64,
    /// What each voice presence call was, in order: `join`, `refresh`, `leave`, `deafen`.
    pub voice_calls: Mutex<Vec<String>>,
    pub emojis: Mutex<Vec<Value>>,
    /// What the communities read fails with, while set.
    pub communities_error: Mutex<Option<BackendError>>,
    pub community_requests: AtomicU64,
    /// A session survives from an earlier run.
    pub stored_session: Mutex<bool>,
    /// What a refresh fails with, while set.
    pub refresh_error: Mutex<Option<BackendError>>,
    /// Each upload: name, size, resource id.
    pub uploads: Mutex<Vec<(String, usize, Option<String>)>>,
    /// The next upload fails with this.
    pub upload_error: Mutex<Option<BackendError>>,
    /// Each attach: message id, file id (none releases a slot).
    pub attaches: Mutex<Vec<(String, Option<String>)>>,
    /// W1 part A's calls: `actions.rs`.
    pub actions: actions::ActionsFake,
}

impl FakeBackend {
    pub fn set_messages(&self, rows: Vec<MessageDto>) {
        self.messages.lock().unwrap().insert(CHANNEL.into(), rows);
    }

    fn voice_call(
        &self,
        what: &str,
        channel: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        self.voice_calls.lock().unwrap().push(what.to_owned());
        decoded(json!({ "channelId": channel, "message": "ok", "success": true }))
    }

    /// The backend's `findAround`: half on each side, newest first, a token only if a side is full.
    pub fn around(
        &self,
        channel: &str,
        message_id: &str,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto> {
        let rows = self
            .messages
            .lock()
            .unwrap()
            .get(channel)
            .cloned()
            .unwrap_or_default();
        let index = rows
            .iter()
            .position(|row| row.id == message_id)
            .ok_or_else(not_found)?;
        let half = (limit.unwrap_or(50) / 2) as usize;
        let start = index.saturating_sub(half);
        let end = (index + 1 + half).min(rows.len());
        Ok(wire::AnchoredMessagesResponseDto {
            newer_continuation_token: (index - start == half && start < index)
                .then(|| rows[start].id.clone()),
            older_continuation_token: (end - index - 1 == half && end - 1 > index)
                .then(|| rows[end - 1].id.clone()),
            messages: rows[start..end].to_vec(),
        })
    }

    /// Rows after the token, nearest the token first, then newest first as the backend returns them.
    pub fn newer_page(
        &self,
        channel: &str,
        token: Option<String>,
        limit: Option<i64>,
    ) -> wire::PaginatedMessagesResponseDto {
        let rows = self
            .messages
            .lock()
            .unwrap()
            .get(channel)
            .cloned()
            .unwrap_or_default();
        let end = token
            .and_then(|token| rows.iter().position(|row| row.id == token))
            .unwrap_or(rows.len());
        let limit = limit.unwrap_or(25) as usize;
        let start = end.saturating_sub(limit);
        let page = rows[start..end].to_vec();
        wire::PaginatedMessagesResponseDto {
            continuation_token: (page.len() == limit)
                .then(|| page.first().map(|row| row.id.clone()))
                .flatten(),
            messages: page,
        }
    }

    pub fn page(
        &self,
        channel: &str,
        token: Option<String>,
        limit: Option<i64>,
    ) -> wire::PaginatedMessagesResponseDto {
        let rows = self
            .messages
            .lock()
            .unwrap()
            .get(channel)
            .cloned()
            .unwrap_or_default();
        let start = token
            .and_then(|token| {
                rows.iter()
                    .position(|row| row.id == token)
                    .map(|index| index + 1)
            })
            .unwrap_or(0);
        let limit = limit.unwrap_or(25) as usize;
        let page: Vec<MessageDto> = rows.iter().skip(start).take(limit).cloned().collect();
        let more = start + page.len() < rows.len();
        wire::PaginatedMessagesResponseDto {
            continuation_token: if more {
                page.last().map(|row| row.id.clone())
            } else {
                Some(String::new())
            },
            messages: page,
        }
    }
}

fn decoded<T: serde::de::DeserializeOwned>(value: Value) -> BackendResult<T> {
    Ok(serde_json::from_value(value).expect("fake response matches the wire type"))
}

#[async_trait]
impl SessionBackend for FakeBackend {
    fn set_server_url(&self, server_url: String) {
        *self.server_url.lock().unwrap() = Some(server_url);
    }

    fn has_stored_session(&self) -> bool {
        *self.stored_session.lock().unwrap()
    }

    async fn auth_controller_login(
        &self,
        _: wire::LoginRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        if *self.login_fails.lock().unwrap() {
            return Err(refused());
        }
        decoded(json!({ "accessToken": self.access_token.lock().unwrap().clone() }))
    }

    async fn auth_controller_refresh(
        &self,
        _: wire::RefreshRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        self.refreshes.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.refresh_error.lock().unwrap().clone() {
            return Err(error);
        }
        decoded(json!({ "accessToken": self.access_token.lock().unwrap().clone() }))
    }

    async fn auth_controller_logout(
        &self,
        _: wire::LogoutRequestDto,
    ) -> BackendResult<wire::LogoutResponseDto> {
        self.logged_out.fetch_add(1, Ordering::SeqCst);
        decoded(json!({ "message": "bye" }))
    }

    async fn user_controller_get_profile(&self) -> BackendResult<wire::UserEntity> {
        decoded(user_json(ME))
    }

    async fn user_controller_get_user_by_id(&self, id: String) -> BackendResult<wire::UserEntity> {
        self.user_requests.fetch_add(1, Ordering::SeqCst);
        decoded(user_json(&id))
    }
}

#[async_trait]
impl CommunitiesBackend for FakeBackend {
    async fn community_controller_find_all_mine(
        &self,
    ) -> BackendResult<Vec<wire::CommunityResponseDto>> {
        self.community_requests.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.communities_error.lock().unwrap().clone() {
            return Err(error);
        }
        decoded(json!([{
            "id": "comm", "name": "Community", "description": null, "avatar": null, "banner": null,
            "createdAt": "2026-09-22T18:00:00.000Z",
        }]))
    }

    async fn channels_controller_find_all_for_community(
        &self,
        _: String,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        self.channel_requests.fetch_add(1, Ordering::SeqCst);
        decoded(Value::Array(self.channels.lock().unwrap().clone()))
    }

    async fn channel_permissions_controller_get_my_community_channel_permissions(
        &self,
        _: String,
    ) -> BackendResult<wire::CommunityChannelCapabilitiesDto> {
        match self.capabilities.lock().unwrap().clone() {
            Some(capabilities) => decoded(capabilities),
            None => Err(not_found()),
        }
    }

    async fn read_receipts_controller_get_unread_counts(
        &self,
    ) -> BackendResult<Vec<wire::UnreadCountDto>> {
        self.unread_requests.fetch_add(1, Ordering::SeqCst);
        decoded(Value::Array(self.unread.lock().unwrap().clone()))
    }

    async fn membership_controller_find_all_for_community(
        &self,
        _: String,
        limit: Option<i64>,
        token: Option<String>,
    ) -> BackendResult<wire::PaginatedMembershipsResponseDto> {
        self.member_page_requests.fetch_add(1, Ordering::SeqCst);
        let members = self.members.lock().unwrap().clone();
        let start = token.map_or(0, |token| {
            members
                .iter()
                .position(|member| member["id"] == token.as_str())
                .map_or(members.len(), |index| index + 1)
        });
        let limit = limit.unwrap_or(100) as usize;
        let page: Vec<Value> = members.iter().skip(start).take(limit).cloned().collect();
        let more = start + page.len() < members.len();
        let token = more
            .then(|| page.last().map(|member| member["id"].clone()))
            .flatten();
        decoded(json!({ "members": page, "continuationToken": token }))
    }

    async fn presence_controller_get_bulk_presence(
        &self,
    ) -> BackendResult<wire::BulkPresenceResponseDto> {
        Ok(wire::BulkPresenceResponseDto {
            presence: self.bulk_presence.lock().unwrap().clone(),
        })
    }

    async fn notifications_controller_get_unread_count(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto> {
        self.notification_requests.fetch_add(1, Ordering::SeqCst);
        Ok(wire::UnreadCountResponseDto {
            count: *self.notification_count.lock().unwrap(),
        })
    }

    async fn membership_controller_search_community_members(
        &self,
        _: String,
        _: String,
        _: Option<i64>,
    ) -> BackendResult<Vec<wire::MembershipResponseDto>> {
        decoded(json!([{
            "id": "m1", "userId": "ava", "communityId": "comm", "joinedAt": "2026-09-22T18:00:00.000Z",
            "roles": [], "user": user_json("ava"),
        }]))
    }

    async fn channels_controller_get_mentionable_channels(
        &self,
        _: String,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        decoded(Value::Array(self.channels.lock().unwrap().clone()))
    }

    async fn custom_emoji_controller_list_community_emojis(
        &self,
        _: String,
    ) -> BackendResult<Vec<wire::CustomEmojiDto>> {
        decoded(Value::Array(self.emojis.lock().unwrap().clone()))
    }
}

#[async_trait]
impl MessagesBackend for FakeBackend {
    async fn messages_controller_find_all_for_channel(
        &self,
        channel_id: String,
        token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto> {
        self.page_requests.fetch_add(1, Ordering::SeqCst);
        // The snapshot is taken as the request arrives: the gate only delays the answer.
        let page = if direction == Some(MessagePageDirection::Newer) {
            self.newer_page(&channel_id, token, limit)
        } else {
            self.page(&channel_id, token, limit)
        };
        let gate = self.gate.lock().unwrap().take();
        if let Some(gate) = gate {
            let _ = gate.await;
        }
        Ok(page)
    }

    async fn messages_controller_find_around_for_channel(
        &self,
        channel_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto> {
        self.around(&channel_id, &message_id, limit)
    }

    async fn messages_controller_find_all_for_group(
        &self,
        group_id: String,
        token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto> {
        Ok(if direction == Some(MessagePageDirection::Newer) {
            self.newer_page(&group_id, token, limit)
        } else {
            self.page(&group_id, token, limit)
        })
    }

    async fn threads_controller_get_replies(
        &self,
        parent: String,
        token: Option<String>,
        limit: Option<i64>,
    ) -> BackendResult<wire::ThreadRepliesResponseDto> {
        let rows = self
            .thread_replies
            .lock()
            .unwrap()
            .get(&parent)
            .cloned()
            .unwrap_or_default();
        let start = token
            .and_then(|token| {
                rows.iter()
                    .position(|row| row.id == token)
                    .map(|index| index + 1)
            })
            .unwrap_or(0);
        let limit = limit.unwrap_or(50) as usize;
        let page: Vec<MessageDto> = rows.iter().skip(start).take(limit).cloned().collect();
        let more = start + page.len() < rows.len();
        Ok(wire::ThreadRepliesResponseDto {
            continuation_token: if more {
                page.last().map(|row| row.id.clone())
            } else {
                None
            },
            file_metadata: HashMap::new(),
            replies: page,
        })
    }

    async fn messages_controller_find_around_for_group(
        &self,
        group_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto> {
        self.around(&group_id, &message_id, limit)
    }

    async fn messages_controller_create(
        &self,
        _: wire::CreateMessageDto,
    ) -> BackendResult<MessageDto> {
        Err(not_found())
    }

    async fn messages_controller_create_direct_message(
        &self,
        _: wire::CreateMessageDto,
    ) -> BackendResult<MessageDto> {
        Err(not_found())
    }

    async fn messages_controller_add_reaction(
        &self,
        body: wire::AddReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto> {
        self.fake_react(
            "add_reaction",
            body.message_id.to_string(),
            body.emoji,
            true,
        )
        .await
    }

    async fn messages_controller_remove_reaction(
        &self,
        body: wire::RemoveReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto> {
        self.fake_react(
            "remove_reaction",
            body.message_id.to_string(),
            body.emoji,
            false,
        )
        .await
    }

    // W1 part A: in `actions.rs`.
    async fn messages_controller_update(
        &self,
        id: String,
        body: wire::UpdateMessageDto,
    ) -> BackendResult<MessageDto> {
        self.fake_update(id, body).await
    }

    async fn messages_controller_remove(&self, id: String) -> BackendResult<()> {
        self.fake_remove(id).await
    }

    async fn messages_controller_find_one(&self, id: String) -> BackendResult<MessageDto> {
        self.fake_find_one(id).await
    }

    async fn read_receipts_controller_mark_as_read(
        &self,
        _: wire::MarkAsReadDto,
    ) -> BackendResult<wire::ReadReceiptDto> {
        Err(not_found())
    }
}

#[async_trait]
impl VoiceBackend for FakeBackend {
    async fn livekit_controller_get_connection_info(
        &self,
    ) -> BackendResult<wire::ConnectionInfoResponseDto> {
        decoded(json!({ "url": "ws://livekit" }))
    }

    async fn livekit_controller_generate_token(
        &self,
        body: wire::CreateTokenDto,
    ) -> BackendResult<wire::TokenResponseDto> {
        let minted = self.tokens_minted.fetch_add(1, Ordering::SeqCst) + 1;
        decoded(json!({
            "token": format!("token-{minted}"), "identity": body.identity, "roomId": body.room_id,
        }))
    }

    async fn voice_presence_controller_get_channel_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::ChannelVoicePresenceResponseDto> {
        self.presence_requests.fetch_add(1, Ordering::SeqCst);
        let users = self.voice_users.lock().unwrap().clone();
        decoded(json!({ "channelId": channel_id, "count": users.len(), "users": users }))
    }

    async fn voice_presence_controller_join_presence(
        &self,
        channel: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        self.voice_call("join", channel)
    }

    async fn voice_presence_controller_refresh_presence(
        &self,
        channel: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        self.voice_call("refresh", channel)
    }

    async fn voice_presence_controller_leave_presence(
        &self,
        channel: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        self.voice_call("leave", channel)
    }

    async fn voice_presence_controller_update_deafen_state(
        &self,
        channel: String,
        _: wire::UpdateDeafenStateDto,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        self.voice_call("deafen", channel)
    }
}

#[async_trait]
impl FilesBackend for FakeBackend {
    async fn file_upload_controller_upload_file(
        &self,
        file: semaphore_core::backend::FileUpload,
        progress: semaphore_core::backend::UploadProgress,
    ) -> BackendResult<wire::FileUploadResponseDto> {
        let size = file.bytes.len();
        self.uploads
            .lock()
            .unwrap()
            .push((file.filename.clone(), size, file.resource_id.clone()));
        if let Some(error) = self.upload_error.lock().unwrap().take() {
            return Err(error);
        }
        progress(size as u64 / 2);
        progress(size as u64);
        let id = uuid::Uuid::new_v4().to_string();
        decoded(json!({
            "id": id, "checksum": "c", "deletedAt": null, "fileCommunityId": null,
            "fileMessageId": file.resource_id, "fileType": "DOCUMENT", "fileUserId": null,
            "filename": file.filename, "mimeType": file.mime_type, "resourceType": "MESSAGE_ATTACHMENT",
            "size": size, "storagePath": "s", "storageType": "LOCAL", "thumbnailPath": null,
            "uploadedAt": "2026-09-22T18:00:00.000Z", "uploadedById": null,
        }))
    }

    async fn messages_controller_add_attachment(
        &self,
        id: String,
        body: wire::AddAttachmentDto,
    ) -> BackendResult<wire::MessageDto> {
        self.attaches
            .lock()
            .unwrap()
            .push((id.clone(), body.file_id.map(|id| id.to_string())));
        Ok(message(&id, ME, "with files"))
    }

    async fn file_controller_get_file(&self, _: String) -> BackendResult<Vec<u8>> {
        Err(not_found())
    }

    async fn file_controller_get_file_thumbnail(&self, _: String) -> BackendResult<Vec<u8>> {
        Err(not_found())
    }
}

pub enum Ack {
    Now(Result<Vec<Value>, RealtimeError>),
    Later(oneshot::Receiver<Result<Vec<Value>, RealtimeError>>),
}

#[derive(Default)]
pub struct FakeRealtime {
    pub acks: Mutex<VecDeque<Ack>>,
    pub sent: Mutex<Vec<(String, Value)>>,
    pub emitted: Mutex<Vec<(String, Value)>>,
    pub calls: Mutex<Vec<String>>,
}

impl FakeRealtime {
    pub fn ack(&self, ack: Ack) {
        self.acks.lock().unwrap().push_back(ack);
    }

    pub fn ack_ok(&self, message_id: &str) {
        self.ack(Ack::Now(Ok(vec![
            json!({ "ok": true, "messageId": message_id }),
        ])));
    }

    pub fn ack_later(&self) -> oneshot::Sender<Result<Vec<Value>, RealtimeError>> {
        let (send, receive) = oneshot::channel();
        self.ack(Ack::Later(receive));
        send
    }

    pub fn sent_nonces(&self) -> Vec<String> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, payload)| payload["clientNonce"].as_str().map(str::to_owned))
            .collect()
    }

    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn call(&self, what: impl Into<String>) {
        self.calls.lock().unwrap().push(what.into());
    }
}

#[async_trait]
impl Realtime for FakeRealtime {
    fn connect(&self) {
        self.call("connect");
    }
    fn disconnect(&self) {
        self.call("disconnect");
    }
    fn restart_transport(&self) {
        self.call("restart_transport");
    }
    fn suspend(&self) {
        self.call("suspend");
    }
    fn resume(&self, refresh: bool) {
        self.call(format!("resume({refresh})"));
    }
    async fn emit(&self, event: String, payload: Value) -> Result<(), RealtimeError> {
        self.emitted.lock().unwrap().push((event, payload));
        Ok(())
    }
    async fn emit_with_ack(
        &self,
        event: String,
        payload: Value,
        _wait_ms: u64,
    ) -> Result<Vec<Value>, RealtimeError> {
        self.sent.lock().unwrap().push((event, payload));
        let ack = self.acks.lock().unwrap().pop_front();
        match ack {
            None => Err(RealtimeError::AckTimedOut),
            Some(Ack::Now(result)) => result,
            Some(Ack::Later(receive)) => receive.await.unwrap_or(Err(RealtimeError::Closed)),
        }
    }
}

/// A media engine that records what it's asked. A test plays its reports with `Core::ingest_media`.
#[derive(Default)]
pub struct FakeMedia {
    /// Everything asked of it, in order, for example `connect token-1`, `muted true`.
    pub calls: Mutex<Vec<String>>,
    pub demands: Mutex<Vec<VideoDemand>>,
    pub connect_fails: Mutex<bool>,
    /// The number `connect` was last given.
    pub last_call: Mutex<u64>,
    /// Reported to `core` while `connect` runs, as an engine whose call drops at once would.
    pub report_during_connect: Mutex<Option<VoiceView>>,
    /// `connect` leaves the call through `core` before it returns, as a user who hangs up while
    /// the room is still connecting would.
    pub leave_during_connect: Mutex<bool>,
    pub core: Mutex<Option<Core>>,
}

#[async_trait]
impl MediaEngine for FakeMedia {
    async fn connect(&self, url: String, token: String, call: u64) -> Result<(), CoreError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("connect {url} {token}"));
        *self.last_call.lock().unwrap() = call;
        if let Some(report) = self.report_during_connect.lock().unwrap().take()
            && let Some(core) = self.core.lock().unwrap().clone()
        {
            core.ingest_media(call, report);
        }
        let leave = *self.leave_during_connect.lock().unwrap();
        let core = self.core.lock().unwrap().clone();
        if leave && let Some(core) = core {
            let _ = core.leave_voice().await;
        }
        if *self.connect_fails.lock().unwrap() {
            return Err(CoreError::Failed {
                message: "no room".into(),
            });
        }
        Ok(())
    }
    async fn disconnect(&self) {
        self.calls.lock().unwrap().push("disconnect".into());
    }
    fn set_muted(&self, muted: bool) {
        self.calls.lock().unwrap().push(format!("muted {muted}"));
    }
    fn set_deafened(&self, deafened: bool) {
        self.calls
            .lock()
            .unwrap()
            .push(format!("deafened {deafened}"));
    }
    fn set_video_demands(&self, demands: Vec<VideoDemand>) {
        *self.demands.lock().unwrap() = demands;
    }
}

pub struct Rig {
    pub core: Core,
    pub clock: Arc<FakeClock>,
    pub events: Arc<Recorder>,
    pub backend: Arc<FakeBackend>,
    pub realtime: Arc<FakeRealtime>,
    pub media: Arc<FakeMedia>,
    pub rows: Vec<MessageRow>,
}

impl Rig {
    pub fn new() -> Self {
        Self::build(false)
    }

    pub fn with_media() -> Self {
        Self::build(true)
    }

    fn build(with_media: bool) -> Self {
        let media = Arc::new(FakeMedia::default());
        let clock = Arc::new(FakeClock(AtomicU64::new(1_000_000)));
        let events = Arc::new(Recorder::default());
        let backend = Arc::new(FakeBackend::default());
        let realtime = Arc::new(FakeRealtime::default());
        let core = Core::with_services(
            clock.clone(),
            events.clone(),
            Services {
                backend: backend.clone(),
                realtime: realtime.clone(),
                media: with_media.then(|| media.clone() as Arc<dyn MediaEngine>),
            },
        );
        *media.core.lock().unwrap() = Some(core.clone());
        Self {
            core,
            clock,
            events,
            backend,
            realtime,
            media,
            rows: Vec::new(),
        }
    }

    pub async fn signed_in(self) -> Self {
        self.core
            .sign_in("http://server".into(), "me".into(), "pw".into())
            .await
            .unwrap();
        self.core.run_until_idle().await;
        self.core.ingest(connected());
        self.events.take();
        self
    }

    pub async fn open_channel(mut self, rows: Vec<MessageDto>) -> Self {
        self.backend.set_messages(rows);
        self.core.open_conversation(channel()).await.unwrap();
        self.sync();
        self
    }

    /// Applies every list change so far to `rows`, and returns all the events.
    pub fn sync(&mut self) -> Vec<CoreEvent> {
        let events = self.events.take();
        for event in &events {
            if let CoreEvent::MessagesChanged { conversation, ops } = event
                && *conversation == channel()
            {
                apply(&mut self.rows, ops);
            }
        }
        events
    }

    pub async fn settle(&mut self) -> Vec<CoreEvent> {
        self.core.run_until_idle().await;
        self.sync()
    }

    pub fn ids(&self) -> Vec<String> {
        self.rows
            .iter()
            .map(|row| row.id.clone().unwrap_or_else(|| "<pending>".into()))
            .collect()
    }

    pub fn row(&self, id: &str) -> &MessageRow {
        self.rows
            .iter()
            .find(|row| row.id.as_deref() == Some(id))
            .expect(id)
    }
}

pub fn ops_of(events: &[CoreEvent]) -> Vec<Vec<ListOp>> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::MessagesChanged { ops, .. } => Some(ops.clone()),
            _ => None,
        })
        .collect()
}
