//! A deterministic in-process backend that speaks the real protocols over real loopback
//! sockets. Owned by unit U4; see `native/docs/slice-units/U4-fake-server.md`.
//!
//! It is a dev tool: the app never links it. [`FakeServer`] serves the scenarios in
//! `native/fixtures/scenarios/` over HTTP and Socket.IO framing, from an in-memory state
//! with a settable clock, and exposes faults for tests.

mod accounts;
mod actions;
mod admin;
mod calls;
mod http;
pub mod livekit;
mod messages;
mod png;
mod rbac;
pub mod scenario;
mod social;
mod socket;

use axum::Json;
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::sync::{Notify, mpsc, watch};
use tokio::task::JoinHandle;

pub use accounts::{InviteSeed, ProfileOrder, SeededSession};
pub use scenario::{ScenarioError, ScenarioSource, entity_uuid, load_named, message_uuid};

/// One thing the server saw, in the order it finished handling it.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Record {
    Http {
        method: String,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation: Option<&'static str>,
        status: u16,
    },
    Socket {
        event: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        protocol: Option<Value>,
    },
}

/// A frame for one connection's writer task.
pub(crate) enum Outbound {
    Text(String),
    Close,
}

/// One in-flight send failure, from [`FakeServer::fail_next_send`].
#[derive(Clone, Debug)]
pub(crate) struct SendFault {
    pub code: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

/// One route failure, from [`FakeServer::fail_route`].
#[derive(Clone, Debug)]
pub(crate) struct RouteFault {
    pub status: u16,
    pub code: String,
}

#[derive(Default)]
pub(crate) struct Faults {
    pub refuse_connections: bool,
    pub delay_acks: Option<Duration>,
    pub drop_acks: bool,
    pub fail_next_send: Option<SendFault>,
    pub fail_routes: HashMap<String, RouteFault>,
    /// Set by `expire_access_token`: the only access token the server still accepts.
    pub required_token: Option<String>,
    pub token_generation: u64,
}

/// A nonce a message was created with, so a retry can find it again.
#[derive(Clone, Debug)]
pub(crate) struct NonceEntry {
    pub message_id: String,
    pub target: messages::SendTarget,
}

/// The mutable part of the scenario: new messages, reactions, unread counts and voice
/// presence. Kept under one lock so a send is atomic.
pub(crate) struct Data {
    pub channel_messages: std::collections::BTreeMap<String, Vec<semaphore_wire::MessageDto>>,
    pub dm_messages: std::collections::BTreeMap<String, Vec<semaphore_wire::MessageDto>>,
    pub threads: std::collections::BTreeMap<String, Vec<semaphore_wire::MessageDto>>,
    /// Thread subscriptions the signed-in user set or cleared, and when, by parent. Otherwise, or
    /// once they reply after that, the backend's default: subscribed if they wrote the parent or
    /// a reply.
    pub thread_subscriptions: std::collections::BTreeMap<String, (bool, DateTime<Utc>)>,
    pub voice: std::collections::BTreeMap<String, Vec<semaphore_wire::VoicePresenceUserDto>>,
    pub unread: std::collections::BTreeMap<String, (i64, i64)>,
    pub nonces: HashMap<(String, String), NonceEntry>,
    /// What clients uploaded, by file id: served back from the file routes.
    pub files: HashMap<String, StoredFile>,
    /// DMs, friendships and notifications.
    pub social: social::Social,
}

/// An uploaded file, kept in memory for the server's life.
#[derive(Clone, Debug)]
pub(crate) struct StoredFile {
    /// Who uploaded it and as what (`resourceType`): a profile or community image must be one's own.
    pub uploaded_by: String,
    pub resource_type: String,
    /// The community the upload named as its `resourceId`, for the community resource types
    /// (`COMMUNITY_AVATAR`, `COMMUNITY_BANNER`, `CUSTOM_EMOJI`, `SOUNDBOARD_SOUND`): the backend's
    /// `File.fileCommunityId`.
    pub community_id: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

pub(crate) struct Inner {
    pub base_url: String,
    /// A real LiveKit to mint tokens for, instead of the placeholder.
    pub livekit: Mutex<Option<livekit::LiveKit>>,
    pub scenario: scenario::Scenario,
    pub data: Mutex<Data>,
    pub clock: Mutex<DateTime<Utc>>,
    pub records: Mutex<Vec<Record>>,
    pub sockets: Mutex<HashMap<u64, mpsc::UnboundedSender<Outbound>>>,
    /// Whose socket each is: the handshake's `userId` (a fake-only extension, so a test can
    /// connect as someone else), otherwise the signed-in user.
    pub socket_users: Mutex<HashMap<u64, String>>,
    /// The access token each socket connected with, to tell a session's sockets apart.
    pub socket_tokens: Mutex<HashMap<u64, String>>,
    /// Accounts, sessions, invites, grants, appearance and created communities (W3).
    pub accounts: Mutex<accounts::Accounts>,
    /// DM calls, server mutes, kicks, the replay buffer, clips and join failures (W4). Never held
    /// with `data`.
    pub calls: Mutex<calls::Calls>,
    /// W5-A: channels made, moved and changed, private members, mention groups, emoji, sounds,
    /// webhooks and invites. Never held with `data` or `rbac`.
    #[allow(dead_code)]
    pub admin: Mutex<admin::Admin>,
    /// W5-B: roles, assignments, overrides, bans, timeouts and the moderation log. Never held with
    /// `data` or `admin`.
    pub rbac: Mutex<rbac::Rbac>,
    pub faults: Mutex<Faults>,
    next_sid: std::sync::atomic::AtomicU64,
    next_message: std::sync::atomic::AtomicU64,
    next_receipt: std::sync::atomic::AtomicU64,
    inflight: AtomicUsize,
    queued: AtomicUsize,
    notify: Notify,
    close: watch::Sender<u64>,
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Inner {
    pub fn begin(&self) {
        self.inflight.fetch_add(1, Ordering::SeqCst);
    }

    pub fn end(&self) {
        self.inflight.fetch_sub(1, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn frame_done(&self) {
        self.queued.fetch_sub(1, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    /// Count a frame that is logically queued but not yet handed to a writer.
    pub fn reserve_frame(&self) {
        self.queued.fetch_add(1, Ordering::SeqCst);
    }

    /// Queue a frame, unless the connection is already gone.
    pub fn enqueue(&self, tx: &mpsc::UnboundedSender<Outbound>, frame: Outbound) {
        self.queued.fetch_add(1, Ordering::SeqCst);
        if tx.send(frame).is_err() {
            self.frame_done();
        }
    }

    pub fn enqueue_text(&self, tx: &mpsc::UnboundedSender<Outbound>, text: String) {
        self.enqueue(tx, Outbound::Text(text));
    }

    pub fn broadcast(&self, event: &str, payload: Value) {
        let frame = socket::event_frame(event, payload);
        let sockets: Vec<_> = lock(&self.sockets).values().cloned().collect();
        for socket in sockets {
            self.enqueue_text(&socket, frame.clone());
        }
    }

    /// Send an event to the sockets of one user.
    pub fn emit_to_user(&self, user_id: &str, event: &str, payload: Value) {
        self.emit_to_users(&[user_id.to_owned()], event, payload);
    }

    /// Send an event to the sockets of these users, once per socket.
    pub fn emit_to_users(&self, user_ids: &[String], event: &str, payload: Value) {
        let frame = socket::event_frame(event, payload);
        let targets: Vec<_> = {
            let users = lock(&self.socket_users);
            lock(&self.sockets)
                .iter()
                .filter(|(sid, _)| {
                    users
                        .get(sid)
                        .is_some_and(|user| user_ids.iter().any(|id| id == user))
                })
                .map(|(_, tx)| tx.clone())
                .collect()
        };
        for socket in targets {
            self.enqueue_text(&socket, frame.clone());
        }
    }

    /// Send an event to every socket but `user_id`'s.
    pub fn emit_to_others(&self, user_id: &str, event: &str, payload: Value) {
        let frame = socket::event_frame(event, payload);
        let targets: Vec<_> = {
            let users = lock(&self.socket_users);
            lock(&self.sockets)
                .iter()
                .filter(|(sid, _)| users.get(sid).is_none_or(|user| user != user_id))
                .map(|(_, tx)| tx.clone())
                .collect()
        };
        for socket in targets {
            self.enqueue_text(&socket, frame.clone());
        }
    }

    pub fn record(&self, record: Record) {
        lock(&self.records).push(record);
    }

    pub fn record_http(
        &self,
        method: &str,
        path: &str,
        operation: Option<&'static str>,
        status: u16,
    ) {
        self.record(Record::Http {
            method: method.to_owned(),
            path: path.to_owned(),
            operation,
            status,
        });
    }

    pub fn record_socket(&self, event: &str, payload: Option<Value>, protocol: Option<Value>) {
        self.record(Record::Socket {
            event: event.to_owned(),
            payload,
            protocol,
        });
    }

    pub fn now(&self) -> DateTime<Utc> {
        *lock(&self.clock)
    }

    pub fn next_sid(&self) -> u64 {
        self.next_sid.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn next_message_id(&self) -> String {
        let id = format!(
            "fake-msg-{:06}",
            self.next_message.fetch_add(1, Ordering::SeqCst) + 1
        );
        if self.scenario.uuid_message_ids {
            scenario::message_uuid(&id)
        } else {
            id
        }
    }

    pub fn next_receipt_id(&self) -> String {
        format!(
            "fake-receipt-{:06}",
            self.next_receipt.fetch_add(1, Ordering::SeqCst) + 1
        )
    }

    pub fn error(
        &self,
        status: u16,
        code: &str,
        message: impl Into<String>,
        retryable: bool,
    ) -> Response {
        (
            axum::http::StatusCode::from_u16(status)
                .unwrap_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR),
            Json(error_body(status, code, message.into(), retryable, None)),
        )
            .into_response()
    }

    pub fn take_send_fault(&self) -> Option<SendFault> {
        lock(&self.faults).fail_next_send.take()
    }

    pub fn take_route_fault(&self, operation: Option<&str>) -> Option<RouteFault> {
        let operation = operation?;
        lock(&self.faults).fail_routes.remove(operation)
    }

    pub fn acks_delayed(&self) -> Option<Duration> {
        lock(&self.faults).delay_acks
    }

    pub fn acks_dropped(&self) -> bool {
        lock(&self.faults).drop_acks
    }

    pub fn refuse_connections(&self, refuse: bool) {
        lock(&self.faults).refuse_connections = refuse;
    }

    pub fn connections_refused(&self) -> bool {
        lock(&self.faults).refuse_connections
    }

    pub fn set_delay_acks(&self, delay: Option<Duration>) {
        lock(&self.faults).delay_acks = delay;
    }

    pub fn set_drop_acks(&self, drop: bool) {
        lock(&self.faults).drop_acks = drop;
    }

    pub fn set_fail_next_send(&self, fault: SendFault) {
        lock(&self.faults).fail_next_send = Some(fault);
    }

    pub fn fail_route(&self, operation: &str, status: u16, code: &str) {
        lock(&self.faults).fail_routes.insert(
            operation.to_owned(),
            RouteFault {
                status,
                code: code.to_owned(),
            },
        );
    }

    pub fn current_access_token(&self) -> String {
        lock(&self.faults)
            .required_token
            .clone()
            .unwrap_or_else(|| "fake-access-token".to_owned())
    }

    /// The bearer the server insists on after `expire_access_token`, if it was called.
    pub fn required_access_token(&self) -> Option<String> {
        lock(&self.faults).required_token.clone()
    }

    pub fn expire_access_token(&self) {
        let mut faults = lock(&self.faults);
        faults.token_generation += 1;
        faults.required_token = Some(format!("fake-access-token-{}", faults.token_generation));
    }

    pub fn advance_clock(&self, by: Duration) {
        let by = chrono::Duration::from_std(by).unwrap_or(chrono::Duration::MAX);
        *lock(&self.clock) += by;
    }

    pub fn requests(&self) -> Vec<Record> {
        lock(&self.records).clone()
    }

    pub fn close_connections(&self) {
        self.close
            .send_modify(|generation| *generation = generation.wrapping_add(1));
    }

    /// Resolve when no request is in flight and no frame is queued.
    pub async fn idle(&self) {
        loop {
            let notified = self.notify.notified();
            if self.inflight.load(Ordering::SeqCst) == 0 && self.queued.load(Ordering::SeqCst) == 0
            {
                tokio::task::yield_now().await;
                if self.inflight.load(Ordering::SeqCst) == 0
                    && self.queued.load(Ordering::SeqCst) == 0
                {
                    return;
                }
            }
            notified.await;
        }
    }
}

/// Resolve once no queued frame is left unwritten.
pub(crate) async fn wait_flushed(inner: &Inner) {
    loop {
        let notified = inner.notify.notified();
        if inner.queued.load(Ordering::SeqCst) == 0 {
            return;
        }
        notified.await;
    }
}

/// The HTTP body of an error, in `ErrorResponseDto` shape.
pub(crate) fn error_body(
    status: u16,
    code: &str,
    message: String,
    retryable: bool,
    retry_after_ms: Option<u64>,
) -> Value {
    let mut body = serde_json::json!({
        "statusCode": status,
        "message": message,
        "errorCode": code,
        "retryable": retryable,
    });
    if let Some(retry_after_ms) = retry_after_ms {
        body["retryAfterMs"] = Value::from(retry_after_ms);
    }
    body
}

/// A started fake backend.
pub struct FakeServer {
    inner: Arc<Inner>,
    task: JoinHandle<()>,
}

impl FakeServer {
    /// Start on an ephemeral loopback port.
    pub async fn start(source: ScenarioSource) -> Result<Self, ScenarioError> {
        Self::start_on(source, 0).await
    }

    /// Start on a chosen loopback port (`0` for ephemeral).
    pub async fn start_on(source: ScenarioSource, port: u16) -> Result<Self, ScenarioError> {
        Self::start_at(source, std::net::Ipv4Addr::LOCALHOST, port).await
    }

    /// Start on `ip`, for a server in a container that a client outside it uses: `0.0.0.0` there.
    /// `base_url` still says loopback; a client outside uses the container's own address.
    pub async fn start_at(
        source: ScenarioSource,
        ip: std::net::Ipv4Addr,
        port: u16,
    ) -> Result<Self, ScenarioError> {
        let scenario = scenario::Scenario::load(&source)?;
        let epoch = scenario.epoch;
        let mut files = HashMap::new();
        http::seed_sound_files(&scenario, &mut files);
        let data = Data {
            channel_messages: scenario.channel_messages.clone(),
            dm_messages: scenario.dm_messages.clone(),
            threads: scenario.threads.clone(),
            thread_subscriptions: Default::default(),
            voice: scenario.voice.clone(),
            unread: scenario.unread.clone(),
            nonces: HashMap::new(),
            files,
            social: social::Social::seed(&scenario),
        };
        let listener = tokio::net::TcpListener::bind((ip, port))
            .await
            .map_err(|error| ScenarioError(format!("cannot bind {ip}:{port}: {error}")))?;
        let address = listener
            .local_addr()
            .map_err(|error| ScenarioError(format!("cannot read the bound address: {error}")))?;
        let (close, _) = watch::channel(0u64);
        let inner = Arc::new(Inner {
            base_url: format!("http://127.0.0.1:{}", address.port()),
            livekit: Mutex::new(None),
            scenario,
            data: Mutex::new(data),
            clock: Mutex::new(epoch),
            records: Mutex::new(Vec::new()),
            sockets: Mutex::new(HashMap::new()),
            socket_users: Mutex::new(HashMap::new()),
            socket_tokens: Mutex::new(HashMap::new()),
            accounts: Mutex::new(accounts::Accounts::new()),
            calls: Mutex::new(calls::Calls::default()),
            admin: Mutex::new(admin::Admin::default()),
            rbac: Mutex::new(rbac::Rbac::default()),
            faults: Mutex::new(Faults::default()),
            next_sid: std::sync::atomic::AtomicU64::new(0),
            next_message: std::sync::atomic::AtomicU64::new(0),
            next_receipt: std::sync::atomic::AtomicU64::new(0),
            inflight: AtomicUsize::new(0),
            queued: AtomicUsize::new(0),
            notify: Notify::new(),
            close,
        });
        let router = http::router(inner.clone());
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Ok(Self { inner, task })
    }

    /// Mint real tokens for this LiveKit from now on, instead of the placeholder.
    pub fn set_livekit(&self, livekit: livekit::LiveKit) {
        *lock(&self.inner.livekit) = Some(livekit);
    }

    /// `http://127.0.0.1:<port>`.
    pub fn base_url(&self) -> String {
        self.inner.base_url.clone()
    }

    /// Gives a stored message a new id, in place. Most scenarios' ids are readable (the showcase's
    /// are UUIDs: `message_uuid`), and a few routes type the id as a UUID, so a test that calls
    /// them renames its messages first.
    pub fn rename_message(&self, id: &str, new_id: &str) -> bool {
        let mut data = lock(&self.inner.data);
        match messages::find_message_mut(&mut data, id) {
            Some(message) => {
                message.id = new_id.to_owned();
                true
            }
            None => false,
        }
    }

    /// Gives a stored message these attachments (file ids), replacing any it has. For tests of
    /// what an edit keeps.
    pub fn set_attachments(&self, id: &str, file_ids: &[&str]) -> bool {
        let mut data = lock(&self.inner.data);
        let Some(message) = messages::find_message_mut(&mut data, id) else {
            return false;
        };
        message.attachments = file_ids
            .iter()
            .map(|file_id| semaphore_wire::types::AttachmentDto {
                file_type: semaphore_wire::enums::FileType::Document,
                filename: format!("{file_id}.txt"),
                has_thumbnail: false,
                id: (*file_id).to_owned(),
                mime_type: "text/plain".into(),
                size: 1,
            })
            .collect();
        true
    }

    /// A stored message as the server holds it.
    pub fn message(&self, id: &str) -> Option<semaphore_wire::types::MessageDto> {
        messages::find_message(&lock(&self.inner.data), id)
    }

    /// Send a server event to every connected socket.
    pub async fn emit(&self, event: &str, payload: Value) {
        self.inner.broadcast(event, payload);
    }

    /// Send a server event to the sockets of one user.
    pub async fn emit_to_user(&self, user_id: &str, event: &str, payload: Value) {
        self.inner.emit_to_user(user_id, event, payload);
    }

    /// Drop every socket without a close frame, as a network failure would.
    pub async fn drop_connections(&self) {
        self.inner.close_connections();
    }

    /// Refuse new socket upgrades.
    pub fn refuse_connections(&self, refuse: bool) {
        self.inner.refuse_connections(refuse);
    }

    /// Hold every send ack for `delay`, while broadcasts still go out.
    pub async fn delay_acks(&self, delay: Duration) {
        self.inner.set_delay_acks(Some(delay));
    }

    /// Never ack a send; the broadcast still goes out.
    pub fn drop_acks(&self, drop: bool) {
        self.inner.set_drop_acks(drop);
    }

    /// Make the next send fail, without creating or broadcasting a message.
    pub fn fail_next_send(&self, code: &str, retryable: bool, retry_after_ms: Option<u64>) {
        self.inner.set_fail_next_send(SendFault {
            code: code.to_owned(),
            retryable,
            retry_after_ms,
        });
    }

    /// Make the next request with this operation id fail with `status` and `code`.
    pub fn fail_route(&self, operation: &str, status: u16, code: &str) {
        self.inner.fail_route(operation, status, code);
    }

    /// Expire every access token handed out so far: calls and socket handshakes carrying one get
    /// `401 UNAUTHENTICATED` (or `AUTH_FAILED`) until a refresh returns the new one, which login
    /// returns too. Until this is called, any non-empty bearer is accepted.
    pub fn expire_access_token(&self) {
        self.inner.expire_access_token();
    }

    /// Plays the browser's `POST /auth/desktop/authorize` for the signed-in fake user: mints the
    /// 43-character code bound to `code_challenge`, valid for 60 s of the server's clock (see
    /// `advance_clock`) and for one redeem.
    pub fn approve_desktop(&self, code_challenge: &str) -> String {
        self.approve(code_challenge, false)
    }

    /// As `approve_desktop`, but the approving session has since ended, so redeeming fails.
    pub fn approve_desktop_with_revoked_approver(&self, code_challenge: &str) -> String {
        self.approve(code_challenge, true)
    }

    fn approve(&self, code_challenge: &str, approver_revoked: bool) -> String {
        let now = self.inner.now();
        let me = self.inner.scenario.me.id.clone();
        lock(&self.inner.accounts).approve(code_challenge, &me, now, approver_revoked)
    }

    /// Tell every socket of the signed-in fake user that a desktop app signed in, with this
    /// address (`desktopSignIn`).
    pub fn emit_desktop_sign_in(&self, ip: Option<&str>) {
        let me = self.inner.scenario.me.id.clone();
        self.inner.emit_to_user(
            &me,
            "desktopSignIn",
            serde_json::json!({ "ipAddress": ip, "signedInAt": self.inner.now() }),
        );
    }

    /// Plant an invite, for the public invite lookup and for registration.
    pub fn seed_invite(&self, invite: InviteSeed) {
        lock(&self.inner.accounts).invites.push(accounts::Invite {
            code: invite.code,
            uses: invite.uses,
            max_uses: invite.max_uses,
            valid_until: invite.valid_until,
            disabled: invite.disabled,
            created_by: invite.created_by,
        });
    }

    /// W5: the user (`None`: the scenario's `me`) holds exactly these roles in the community from
    /// now on (the `act_as` control). Panics on an unknown community or role, as a test's typo.
    pub fn act_as(&self, community_id: &str, user_id: Option<&str>, role_ids: &[&str]) {
        let user_id = user_id.unwrap_or(&self.inner.scenario.me.id).to_owned();
        let role_ids: Vec<String> = role_ids.iter().map(|id| (*id).to_owned()).collect();
        rbac::set_roles(&self.inner, community_id, &user_id, &role_ids).expect("act_as");
    }

    /// W5: a login as `username` (any password) becomes the scenario user `user_id` (the
    /// `sign_in_as` control), so a test's second session can be another member.
    pub fn sign_in_as(&self, username: &str, user_id: &str) {
        rbac::allow_sign_in_as(&self.inner, username, user_id);
    }

    /// Add a session of the signed-in fake user, as another device's sign-in would. Its tokens
    /// work as bearers and refresh tokens, and `DELETE /auth/sessions/{id}` ends them.
    pub fn add_session(&self, device_name: &str, ip: Option<&str>) -> SeededSession {
        let now = self.inner.now();
        let me = self.inner.scenario.me.id.clone();
        let mut accounts = lock(&self.inner.accounts);
        let index = accounts.start_session(&me, Some(device_name), ip, now, None, false);
        let session = &accounts.sessions[index];
        SeededSession {
            id: session.id.clone(),
            access_token: session.access.clone(),
            refresh_token: session.refresh.clone(),
        }
    }

    /// When `PATCH /api/users/profile` sends `userProfileUpdated` relative to its reply.
    pub fn set_profile_order(&self, order: ProfileOrder) {
        lock(&self.inner.accounts).profile_order = order;
    }

    /// Send the events `ProfileOrder::ReplyThenEvent` held back. How many were sent.
    pub fn release_held_events(&self) -> usize {
        let held = std::mem::take(&mut lock(&self.inner.accounts).held);
        let count = held.len();
        for event in held {
            self.inner
                .emit_to_users(&event.users, event.event, event.payload);
        }
        count
    }

    // ----- W4 ----------------------------------------------------------------------------------

    /// Another member joins the DM group's call, as LiveKit's `participant_joined` webhook
    /// registers them: the first in the call sends `dmVoiceCallStarted` to the group's members,
    /// later ones `dmVoiceUserJoined`. Already in the call: nothing. `false` if `user_id` isn't a
    /// member of the group.
    pub fn dm_call_join(&self, dm_group_id: &str, user_id: &str) -> bool {
        match calls::dm_members_for(&self.inner, dm_group_id, user_id) {
            Ok(members) => {
                calls::dm_join(&self.inner, dm_group_id, user_id, &members);
                true
            }
            Err(_) => false,
        }
    }

    /// A member leaves the DM group's call (LiveKit's `participant_left`): `dmVoiceUserLeft` to
    /// the group's members. `false` if they weren't in it.
    pub fn dm_call_leave(&self, dm_group_id: &str, user_id: &str) -> bool {
        match calls::dm_members_for(&self.inner, dm_group_id, user_id) {
            Ok(members) => calls::dm_leave(&self.inner, dm_group_id, user_id, &members),
            Err(_) => false,
        }
    }

    /// A moderator server-mutes (or unmutes) `user_id` in the channel, as `mute-participant`
    /// does without its rank check: `voiceChannelUserUpdated` when they're in the call.
    pub fn server_mute(&self, channel_id: &str, user_id: &str, mute: bool) {
        calls::set_server_muted(&self.inner, channel_id, user_id, mute);
    }

    /// The running replay buffer now has `segments` complete 10 s segments, and its owner hears
    /// `egressSegmentsReady`. `false` if no buffer is running.
    pub fn emit_segments_ready(&self, segments: usize) -> bool {
        calls::segments_ready(&self.inner, segments)
    }

    /// LiveKit fails the running replay buffer's egress: `replayBufferFailed` with `error`.
    /// `false` if no buffer is running.
    pub fn emit_replay_failed(&self, error: &str) -> bool {
        calls::end_replay(&self.inner, Some(error.to_owned()))
    }

    /// LiveKit ends the running replay buffer's egress (the share ended): `replayBufferStopped`.
    /// `false` if no buffer is running.
    pub fn emit_replay_stopped(&self) -> bool {
        calls::end_replay(&self.inner, None)
    }

    /// Put a clip in `user_id`'s library (its file serves the fixture MP4). Its id and file id.
    pub fn seed_clip(
        &self,
        user_id: &str,
        is_public: bool,
        duration_seconds: i64,
    ) -> (String, String) {
        let clip = calls::store_clip(
            &self.inner,
            user_id,
            None,
            duration_seconds,
            is_public,
            None,
        );
        (clip.id, clip.file_id)
    }

    /// The valid join-failure reports received, in order, as the backend logs them.
    pub fn join_failures(&self) -> Vec<Value> {
        lock(&self.inner.calls).join_failures.clone()
    }

    /// The ids of a community's fixture soundboard sound (`Airhorn`, `Rimshot` or `Silence`):
    /// the sound's and its file's.
    pub fn sound_ids(community_id: &str, name: &str) -> (String, String) {
        http::sound_ids(community_id, name)
    }

    /// Every HTTP request and socket event seen so far, in order.
    pub fn requests(&self) -> Vec<Record> {
        self.inner.requests()
    }

    /// Move the clock the server stamps new messages with.
    pub fn advance_clock(&self, by: Duration) {
        self.inner.advance_clock(by);
    }

    /// Resolve when no request is in flight and no frame is queued.
    pub async fn idle(&self) {
        self.inner.idle().await;
    }
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}
