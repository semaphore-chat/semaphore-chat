//! Sending: nonce, pending row, the ack or echo that settles it (whichever comes first), retry
//! with the same nonce. From `useOptimisticSendMessage.ts`, `optimisticSend.ts` and `sendAck.ts`.
//!
//! The payload is built as JSON instead of through `CreateMessageDto`: the contract types ids as
//! UUIDs and the generated DTO would reject anything else, but ids are opaque to a client, and the
//! exported scenarios the fake server runs on use readable ones.

use crate::client::{Core, Effect, State};
use crate::model::{Conversation, ErrorView, MessageDraft};
use crate::platform::CoreError;
use crate::realtime::RealtimeError;
use crate::resync::unavailable;
use crate::store::{SendStatus, StoredMessage};
use crate::text::{SpanInput, draft_to_spans};
use semaphore_wire::enums::ErrorCode;
use semaphore_wire::events::{SEND_DIRECT_MESSAGE, SEND_MESSAGE, SEND_THREAD_REPLY};
use semaphore_wire::types::{MessageDto, SendAckDto};
use serde_json::{Value, json};

/// How long the server gets to answer: the web's `SEND_ACK_TIMEOUT_MS`.
pub const SEND_ACK_TIMEOUT_MS: u64 = 10_000;
/// How long a send waits for the socket to come back: the web's `waitForReconnection`.
pub const SEND_RECONNECT_WAIT_MS: u64 = 5_000;
/// The prefix of an optimistic row's id, which the server has never seen.
pub const OPTIMISTIC_ID_PREFIX: &str = "pending-";

/// A send that hasn't settled.
#[derive(Debug, Clone)]
pub struct PendingSend {
    pub conversation: Conversation,
    pub client_id: String,
    pub event: &'static str,
    pub payload: Value,
    pub in_flight: bool,
    /// The socket was down when this was due. It goes when the socket returns, or fails after
    /// [`SEND_RECONNECT_WAIT_MS`].
    pub parked_since: Option<u64>,
}

/// True for an id the server has never seen, which must never go over the wire.
pub fn is_optimistic_id(id: &str) -> bool {
    id.starts_with(OPTIMISTIC_ID_PREFIX)
}

fn span_json(span: &SpanInput) -> Value {
    let mut value = json!({ "type": span.kind, "text": span.text });
    let object = value.as_object_mut().expect("just built as an object");
    let mut set = |key: &str, field: &Option<String>| {
        if let Some(field) = field {
            object.insert(key.to_owned(), json!(field));
        }
    };
    set("userId", &span.user_id);
    set("specialKind", &span.special_kind);
    set("communityId", &span.community_id);
    set("aliasId", &span.alias_id);
    set("channelId", &span.channel_id);
    set("emojiId", &span.emoji_id);
    for (key, on) in [
        ("bold", span.style.bold),
        ("italic", span.style.italic),
        ("strikethrough", span.style.strikethrough),
        ("code", span.style.code),
    ] {
        if on {
            object.insert(key.to_owned(), json!(true));
        }
    }
    value
}

/// The event and payload for a send. `nonce` makes a retry safe.
fn wire_send(
    conversation: &Conversation,
    draft: &MessageDraft,
    spans: &[Value],
    nonce: &str,
) -> (&'static str, Value) {
    let mut payload = json!({
        "spans": spans,
        "attachments": [],
        "clientNonce": nonce,
    });
    if !draft.files.is_empty() {
        payload["pendingAttachments"] = json!(draft.files.len());
    }
    let object = payload.as_object_mut().expect("just built as an object");
    let event = match conversation {
        Conversation::Channel { id } => {
            object.insert("channelId".into(), json!(id));
            SEND_MESSAGE
        }
        Conversation::DirectMessage { id } => {
            object.insert("directMessageGroupId".into(), json!(id));
            SEND_DIRECT_MESSAGE
        }
        Conversation::Thread { parent_message_id } => {
            object.insert("parentMessageId".into(), json!(parent_message_id));
            SEND_THREAD_REPLY
        }
    };
    if !matches!(conversation, Conversation::Thread { .. })
        && let Some(reply_to) = &draft.reply_to_message_id
    {
        object.insert("replyToId".into(), json!(reply_to));
    }
    (event, payload)
}

/// What a row shows until the server answers. Decoding through JSON keeps the fields in one place:
/// the wire type, whose required nullable fields read a missing value as null.
fn optimistic_dto(
    conversation: &Conversation,
    client_id: &str,
    nonce: &str,
    author_id: &str,
    draft: &MessageDraft,
    spans: &[Value],
    now_ms: u64,
) -> Result<MessageDto, CoreError> {
    let sent_at = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now_ms as i64)
        .unwrap_or_default()
        .to_rfc3339();
    let (channel_id, group_id, parent_id) = match conversation {
        Conversation::Channel { id } => (Some(id), None, None),
        Conversation::DirectMessage { id } => (None, Some(id), None),
        Conversation::Thread { parent_message_id } => (None, None, Some(parent_message_id)),
    };
    serde_json::from_value(json!({
        "id": client_id,
        "clientNonce": nonce,
        "authorId": author_id,
        "channelId": channel_id,
        "directMessageGroupId": group_id,
        "parentMessageId": parent_id,
        "replyToId": draft.reply_to_message_id,
        "spans": spans,
        "attachments": [],
        "pendingAttachments": draft.files.len(),
        "reactions": [],
        "pinned": false,
        "replyCount": 0,
        "sentAt": sent_at,
    }))
    .map_err(|error| CoreError::Failed {
        message: format!("building the pending row: {error}"),
    })
}

/// What a send's outcome means, in the words of `readSendAck`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    Delivered {
        message_id: String,
    },
    /// The message was deleted before the sender heard it was sent: nothing to retry.
    DeletedWhileSending,
    Failed(ErrorView),
    /// The socket is down: wait for it, briefly.
    NoSocket,
}

/// What to tell the sender. Generic refusals read badly as the server words them.
fn describe_refusal(code: &ErrorCode, message: &str) -> String {
    match code.as_str().as_ref() {
        "FORBIDDEN" => "You can't send messages here".to_owned(),
        "VALIDATION_FAILED" | "INTERNAL" | "UNKNOWN" => "Failed to send".to_owned(),
        _ if message.is_empty() => "Failed to send".to_owned(),
        _ => message.to_owned(),
    }
}

fn failure(code: &str, message: &str, retryable: bool) -> ErrorView {
    ErrorView {
        code: code.to_owned(),
        message: message.to_owned(),
        retryable,
        retry_after_ms: None,
    }
}

/// An ack: a v2 `SendAck`, or a plain message id from a server older than the protocol.
pub fn read_ack(args: &[Value]) -> SendOutcome {
    let unreadable = || SendOutcome::Failed(failure("UNKNOWN", "Failed to send", true));
    let Some(first) = args.first() else {
        return unreadable();
    };
    if let Some(message_id) = first.as_str() {
        return SendOutcome::Delivered {
            message_id: message_id.to_owned(),
        };
    }
    let Ok(ack) = serde_json::from_value::<SendAckDto>(first.clone()) else {
        return unreadable();
    };
    if let (true, Some(message_id)) = (ack.ok, ack.message_id) {
        return SendOutcome::Delivered { message_id };
    }
    let Some(error) = ack.error else {
        return unreadable();
    };
    if error.error_code.as_str() == "MESSAGE_DELETED" {
        return SendOutcome::DeletedWhileSending;
    }
    SendOutcome::Failed(ErrorView {
        code: error.error_code.as_str().into_owned(),
        message: describe_refusal(&error.error_code, &error.message),
        retryable: error.retryable,
        retry_after_ms: error
            .retry_after_ms
            .filter(|ms| ms.is_finite() && *ms >= 0.0)
            .map(|ms| ms as u64),
    })
}

fn timed_out() -> ErrorView {
    failure(
        "ACK_TIMEOUT",
        "Message send timed out. Please try again.",
        true,
    )
}

fn no_connection() -> ErrorView {
    failure("NOT_CONNECTED", "Not connected. Please try again.", true)
}

impl State {
    /// `reconcileAfterSend`. Ack and echo can come in either order, and whichever is second finds
    /// the work done: a row that settled is no longer a placeholder.
    pub fn settle_send(&mut self, nonce: &str, outcome: SendOutcome, now: u64) {
        // Before the check below: an echo may have settled the send already, and its files still
        // wait for the message's id.
        if let SendOutcome::Delivered { message_id } = &outcome {
            self.uploads_may_start(nonce, message_id);
        }
        let Some(send) = self.sends.get_mut(nonce) else {
            return;
        };
        send.in_flight = false;
        let conversation = send.conversation.clone();
        let client_id = send.client_id.clone();
        match outcome {
            SendOutcome::NoSocket => {
                send.parked_since.get_or_insert(now);
                if self.connection == crate::lifecycle::ConnectionState::Offline {
                    self.fail_send(nonce, no_connection());
                }
            }
            SendOutcome::Failed(error) => self.fail_send(nonce, error),
            SendOutcome::DeletedWhileSending => {
                self.sends.remove(nonce);
                if let Some(window) = self.windows.get_mut(&conversation) {
                    window.remove_optimistic(&client_id);
                }
            }
            SendOutcome::Delivered { message_id } => {
                self.sends.remove(nonce);
                let Some(window) = self.windows.get_mut(&conversation) else {
                    return;
                };
                if window.find(&message_id).is_some() {
                    // The echo got there first as a row of its own, from a server that doesn't
                    // echo the nonce. This one is redundant.
                    window.remove_optimistic(&client_id);
                } else if let Some(row) = window.find(&client_id).cloned() {
                    let promoted = StoredMessage {
                        dto: MessageDto {
                            id: message_id,
                            ..row.dto
                        },
                        client_id: row.client_id,
                        send: SendStatus::Settled,
                    };
                    window.replace_optimistic(&client_id, promoted);
                }
            }
        }
    }

    fn fail_send(&mut self, nonce: &str, error: ErrorView) {
        let Some(send) = self.sends.get_mut(nonce) else {
            return;
        };
        send.parked_since = None;
        let conversation = send.conversation.clone();
        let client_id = send.client_id.clone();
        if let Some(window) = self.windows.get_mut(&conversation) {
            window.mark_failed(&client_id, error);
        }
    }

    /// The socket is back: send what was waiting for it.
    pub fn release_parked_sends(&mut self) {
        let nonces: Vec<String> = self
            .sends
            .iter_mut()
            .filter(|(_, send)| send.parked_since.is_some())
            .map(|(nonce, send)| {
                send.parked_since = None;
                nonce.clone()
            })
            .collect();
        for nonce in nonces {
            self.push_effect(Effect::Send(nonce));
        }
    }

    /// Core has no timers, but a failed reconnect attempt is a tick: sends that have waited long
    /// enough fail on it.
    pub fn expire_parked_sends(&mut self, now: u64) {
        let due: Vec<String> = self
            .sends
            .iter()
            .filter(|(_, send)| {
                send.parked_since
                    .is_some_and(|since| now.saturating_sub(since) >= SEND_RECONNECT_WAIT_MS)
            })
            .map(|(nonce, _)| nonce.clone())
            .collect();
        for nonce in due {
            self.fail_send(&nonce, no_connection());
        }
    }

    /// The network is gone, so there's nothing to wait for.
    pub fn fail_parked_sends(&mut self, _now: u64) {
        let parked: Vec<String> = self
            .sends
            .iter()
            .filter(|(_, send)| send.parked_since.is_some())
            .map(|(nonce, _)| nonce.clone())
            .collect();
        for nonce in parked {
            self.fail_send(&nonce, no_connection());
        }
    }
}

impl Core {
    /// Adds the pending row and queues the send. While detached from the live edge there's no row
    /// to add it to: the web sends without one, and its echo resets the window.
    pub(crate) fn begin_send(
        &self,
        conversation: Conversation,
        mut draft: MessageDraft,
    ) -> Result<String, CoreError> {
        self.services().ok_or_else(|| unavailable("sending"))?;
        // The bytes go to the upload job; the send itself only needs how many.
        let files = std::mem::take(&mut draft.files);
        let file_count = files.len();
        let nonce = uuid::Uuid::new_v4().to_string();
        let client_id = format!("{OPTIMISTIC_ID_PREFIX}{nonce}");
        let spans: Vec<Value> = draft_to_spans(&draft).iter().map(span_json).collect();
        let (event, mut payload) = wire_send(&conversation, &draft, &spans, &nonce);
        if file_count > 0 {
            payload["pendingAttachments"] = json!(file_count);
        }
        self.write(|state, now| {
            let me = state.me_id().to_owned();
            let mut dto =
                optimistic_dto(&conversation, &client_id, &nonce, &me, &draft, &spans, now)?;
            dto.pending_attachments = Some(file_count as i64);
            if file_count > 0 {
                let job = crate::uploads::UploadJob::new(
                    conversation.clone(),
                    client_id.clone(),
                    files,
                    &mut state.next_upload_id,
                );
                state.uploads.insert(nonce.clone(), job);
            }
            if let Some(window) = state.windows.get_mut(&conversation) {
                window.prepend(StoredMessage {
                    dto,
                    client_id: Some(client_id.clone()),
                    send: SendStatus::Pending,
                });
                window.evict_oldest();
            }
            state.sends.insert(
                nonce.clone(),
                PendingSend {
                    conversation: conversation.clone(),
                    client_id: client_id.clone(),
                    event,
                    payload,
                    in_flight: false,
                    parked_since: None,
                },
            );
            state.push_effect(Effect::Send(nonce.clone()));
            Ok(nonce.clone())
        })
    }

    /// Sends again with the same nonce, so the server can't make a second message. A retry while
    /// one is in flight, or of a send that has since settled, does nothing.
    pub(crate) fn begin_retry(&self, nonce: &str) {
        self.write(|state, now| {
            let Some(send) = state.sends.get_mut(nonce) else {
                return;
            };
            if send.in_flight {
                return;
            }
            send.parked_since = None;
            let conversation = send.conversation.clone();
            let client_id = send.client_id.clone();
            if let Some(window) = state.windows.get_mut(&conversation) {
                window.mark_pending(&client_id);
                if let Some(sent_at) =
                    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(now as i64)
                {
                    window.edit(&client_id, |dto| dto.sent_at = sent_at);
                }
            }
            state.push_effect(Effect::Send(nonce.to_owned()));
        });
    }

    pub(crate) async fn run_send(&self, nonce: String) {
        let Some(services) = self.services() else {
            return;
        };
        let job = self.write(|state, now| {
            let connected = state.connection == crate::lifecycle::ConnectionState::Connected;
            let offline = state.connection == crate::lifecycle::ConnectionState::Offline;
            let send = state.sends.get_mut(&nonce)?;
            if send.in_flight {
                return None;
            }
            if !connected {
                send.parked_since.get_or_insert(now);
                if offline {
                    state.fail_send(&nonce, no_connection());
                }
                return None;
            }
            send.in_flight = true;
            Some((send.event, send.payload.clone()))
        });
        let Some((event, payload)) = job else {
            return;
        };
        let outcome = match services
            .realtime
            .emit_with_ack(event.to_owned(), payload, SEND_ACK_TIMEOUT_MS)
            .await
        {
            Ok(args) => read_ack(&args),
            Err(RealtimeError::NotConnected) => SendOutcome::NoSocket,
            Err(RealtimeError::AckTimedOut) => SendOutcome::Failed(timed_out()),
            Err(RealtimeError::Closed) => SendOutcome::Failed(no_connection()),
        };
        self.write(|state, now| state.settle_send(&nonce, outcome, now));
    }
}
