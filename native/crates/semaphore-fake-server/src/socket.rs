//! Engine.IO v4 / Socket.IO v5 over one WebSocket, and the send events.

use crate::messages::{self, SendBody, SendFailure, SendTarget};
use crate::{Inner, Outbound, error_body, lock};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use semaphore_wire::types::{ReauthenticateResultDto, SendAckDto, SendAckErrorDto};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;

/// Engine.IO's server-side keep-alive, as the real backend's gateways set it
/// (`backend/src/*/*.gateway.ts`: `pingInterval: 25000, pingTimeout: 60000`).
///
/// The client ends a connection that goes `pingInterval + pingTimeout` without a ping from the
/// server (socket.io-client's rule, `semaphore-net::socket`), so a server that advertises these
/// numbers has to send the pings: this one did not, and every client connection died of
/// `ping timeout` 45 s after it connected, then reconnected. A run slower than that (a busy
/// machine) had its socket drop mid-script, and a shot could catch the "Reconnecting…" pill.
const PING_INTERVAL: Duration = Duration::from_secs(25);
const PING_TIMEOUT: Duration = Duration::from_secs(60);

/// When the server pings next, and when an unanswered ping ends the connection.
#[derive(Debug)]
struct PingTimer {
    interval: Duration,
    timeout: Duration,
    next_ping: Instant,
    /// The moment the first ping still unanswered runs out; `None` once a pong came back.
    pong_by: Option<Instant>,
}

/// What [`PingTimer`] says to do at its deadline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ping {
    /// Send `2`; its `3` has to come back before the timeout.
    Send,
    /// No pong in time: the connection is dead.
    Ended,
}

impl PingTimer {
    fn new(interval: Duration, timeout: Duration) -> Self {
        Self {
            interval,
            timeout,
            next_ping: Instant::now() + interval,
            pong_by: None,
        }
    }

    /// The moment it next acts: sends a ping, or ends the connection.
    fn deadline(&self) -> Instant {
        self.pong_by
            .map_or(self.next_ping, |by| by.min(self.next_ping))
    }

    /// A `3` came back.
    fn pong(&mut self) {
        self.pong_by = None;
    }

    /// At [`Self::deadline`]: ping, or end the connection.
    fn tick(&mut self, now: Instant) -> Ping {
        if self.pong_by.is_some_and(|by| by <= now) {
            return Ping::Ended;
        }
        // The first ping of an unanswered run starts the clock; pings after it don't push it out.
        self.pong_by.get_or_insert(now + self.timeout);
        self.next_ping = now + self.interval;
        Ping::Send
    }
}

/// The one server-event frame shape: `42["name", payload]`.
pub(crate) fn event_frame(event: &str, payload: Value) -> String {
    format!(
        "42{}",
        serde_json::to_string(&json!([event, payload])).expect("an event always serialises")
    )
}

pub(crate) async fn socket_io(
    State(inner): State<Arc<Inner>>,
    Query(params): Query<HashMap<String, String>>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if params.get("EIO").map(String::as_str) != Some("4")
        || params.get("transport").map(String::as_str) != Some("websocket")
    {
        return inner.error(
            400,
            "BAD_REQUEST",
            "Socket.IO is served only as EIO=4&transport=websocket",
            false,
        );
    }
    if inner.connections_refused() {
        inner.record_socket("connect_refused", None, None);
        return inner.error(503, "UNAVAILABLE", "Connection refused", true);
    }
    upgrade.on_upgrade(move |socket| connection(inner, socket))
}

fn valid_token(token: Option<&str>) -> bool {
    token
        .and_then(|token| token.strip_prefix("Bearer "))
        .map(|rest| !rest.trim().is_empty())
        .unwrap_or(false)
}

fn open_frame(sid: &str) -> String {
    format!(
        "0{}",
        json!({
            "sid": sid,
            "pingInterval": PING_INTERVAL.as_millis() as u64,
            "pingTimeout": PING_TIMEOUT.as_millis() as u64,
            "upgrades": [],
        })
    )
}

/// One Socket.IO event frame: optional ack id, then the JSON args array.
fn parse_event(text: &str) -> Option<(Option<u64>, Vec<Value>)> {
    let rest = text.strip_prefix("42")?;
    let rest = if rest.starts_with('/') {
        rest.split_once(',')?.1
    } else {
        rest
    };
    let digits = rest
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(rest.len());
    let ack = if digits == 0 {
        None
    } else {
        Some(rest[..digits].parse().ok()?)
    };
    let value: Value = serde_json::from_str(&rest[digits..]).ok()?;
    Some((ack, value.as_array()?.clone()))
}

async fn connection(inner: Arc<Inner>, socket: WebSocket) {
    let sid = inner.next_sid();
    let sid_text = format!("sid-{sid:06}");
    let (sink, mut stream) = socket.split();
    let (tx, rx) = mpsc::unbounded_channel();
    let writer = tokio::spawn(writer_task(inner.clone(), sink, rx));
    let mut close = inner.close.subscribe();

    inner.enqueue_text(&tx, open_frame(&sid_text));

    let mut protocol: Option<Value> = None;
    let mut connected = false;
    let mut user = inner.scenario.me.id.clone();
    inner.begin();
    while let Some(frame) = stream.next().await {
        let Ok(message) = frame else {
            break;
        };
        if let Message::Text(text) = message {
            let Some(rest) = text.as_str().strip_prefix("40") else {
                continue;
            };
            let data: Value = if rest.is_empty() {
                Value::Null
            } else {
                serde_json::from_str(rest).unwrap_or(Value::Null)
            };
            protocol = data.get("protocol").cloned().or_else(|| {
                data.get("auth")
                    .and_then(|auth| auth.get("protocol"))
                    .cloned()
            });
            let token = data.get("token").and_then(Value::as_str).or_else(|| {
                data.get("auth")
                    .and_then(|auth| auth.get("token"))
                    .and_then(Value::as_str)
            });
            inner.record_socket("handshake", Some(data.clone()), protocol.clone());
            let required = inner.required_access_token();
            let current = required.as_deref().is_none_or(|required| {
                token.and_then(|token| token.strip_prefix("Bearer ")) == Some(required)
            });
            let bearer = token.and_then(|token| token.strip_prefix("Bearer "));
            let revoked = bearer.is_some_and(|bearer| inner.token_revoked(bearer));
            if !valid_token(token) || !current || revoked {
                inner.enqueue_text(&tx, "44{\"message\":\"AUTH_FAILED\"}".to_owned());
                break;
            }
            // A token that belongs to a session is that session's user (a registered account's).
            if let Some(bearer) = bearer {
                user = inner.user_of(Some(bearer));
            }
            // Register before the connect ack, so a client that has its ack is
            // already receiving broadcasts.
            // A fake-only extension: `userId` in the handshake makes this socket that user's, so a
            // test can watch what another member of a DM receives. Real clients never send it.
            if let Some(who) = data
                .get("userId")
                .or_else(|| data.get("auth").and_then(|auth| auth.get("userId")))
                .and_then(Value::as_str)
            {
                user = who.to_owned();
            }
            lock(&inner.socket_users).insert(sid, user.clone());
            if let Some(bearer) = bearer {
                lock(&inner.socket_tokens).insert(sid, bearer.to_owned());
            }
            lock(&inner.sockets).insert(sid, tx.clone());
            connected = true;
            inner.enqueue_text(&tx, format!("40{}", json!({ "sid": sid_text })));
            break;
        }
    }
    inner.end();

    if connected {
        let mut abrupt = false;
        let mut pings = PingTimer::new(PING_INTERVAL, PING_TIMEOUT);
        loop {
            tokio::select! {
                changed = close.changed() => {
                    if changed.is_err() {
                        break;
                    }
                    abrupt = true;
                    break;
                }
                frame = stream.next() => {
                    let Some(Ok(message)) = frame else {
                        break;
                    };
                    match message {
                        Message::Text(text) => {
                            let text = text.as_str();
                            if text == "41" {
                                break;
                            }
                            if text == "2" {
                                inner.enqueue_text(&tx, "3".to_owned());
                                continue;
                            }
                            if text == "3" {
                                pings.pong();
                                continue;
                            }
                            if let Some((ack, args)) = parse_event(text) {
                                inner.begin();
                                handle_event(&inner, &tx, &user, protocol.clone(), ack, args).await;
                                inner.end();
                            } else if let Some(rest) = text.strip_prefix("43") {
                                inner.record_socket(
                                    "ack",
                                    Some(Value::String(rest.to_owned())),
                                    protocol.clone(),
                                );
                            }
                        }
                        Message::Close(_) => break,
                        _ => {}
                    }
                }
                // Engine.IO's ping, as the real server sends it: the client times the connection
                // out if none arrives.
                _ = tokio::time::sleep_until(pings.deadline()) => {
                    if pings.tick(Instant::now()) == Ping::Ended {
                        break;
                    }
                    inner.enqueue_text(&tx, "2".to_owned());
                }
            }
        }
        lock(&inner.sockets).remove(&sid);
        lock(&inner.socket_users).remove(&sid);
        lock(&inner.socket_tokens).remove(&sid);
        inner.record_socket("disconnect", None, protocol.clone());
        if !abrupt {
            inner.enqueue(&tx, Outbound::Close);
        }
    }

    drop(tx);
    let _ = writer.await;
}

async fn writer_task(
    inner: Arc<Inner>,
    mut sink: SplitSink<WebSocket, Message>,
    mut rx: mpsc::UnboundedReceiver<Outbound>,
) {
    while let Some(frame) = rx.recv().await {
        match frame {
            Outbound::Text(text) => {
                if sink.send(Message::Text(text.into())).await.is_err() {
                    inner.frame_done();
                    break;
                }
                inner.frame_done();
            }
            Outbound::Close => {
                let _ = sink.close().await;
                inner.frame_done();
                break;
            }
        }
    }
    rx.close();
    while rx.try_recv().is_ok() {
        inner.frame_done();
    }
}

async fn handle_event(
    inner: &Arc<Inner>,
    tx: &mpsc::UnboundedSender<Outbound>,
    user: &str,
    protocol: Option<Value>,
    ack: Option<u64>,
    args: Vec<Value>,
) {
    let Some(name) = args.first().and_then(Value::as_str).map(str::to_owned) else {
        return;
    };
    let payload = args.get(1).cloned();
    inner.record_socket(&name, payload.clone(), protocol.clone());

    match name.as_str() {
        "sendMessage" | "sendDirectMessage" | "sendThreadReply" => {
            handle_send(inner, tx, user, protocol, ack, &name, payload).await;
        }
        "markAsRead" => mark_as_read(inner, tx, user, ack, payload),
        // The backend records the connection (and its idle flag) and answers 'ACK'. The event
        // is in `requests()` with its payload; nothing else of the fake depends on it.
        "presenceOnline" => ack_value(inner, tx, ack, Value::from("ACK")),
        "reauthenticate" => {
            let result = ReauthenticateResultDto {
                error: None,
                expires_at: Some(inner.now() + chrono::Duration::hours(1)),
                ok: true,
            };
            ack_value(
                inner,
                tx,
                ack,
                serde_json::to_value(result).expect("the result serialises"),
            );
        }
        _ => ack_value(inner, tx, ack, Value::from("ACK")),
    }
}

async fn handle_send(
    inner: &Arc<Inner>,
    tx: &mpsc::UnboundedSender<Outbound>,
    user: &str,
    protocol: Option<Value>,
    ack: Option<u64>,
    name: &str,
    payload: Option<Value>,
) {
    let v2 = protocol
        .as_ref()
        .and_then(Value::as_u64)
        .map(|protocol| protocol >= 2)
        .unwrap_or(false);

    let parsed = payload
        .clone()
        .ok_or_else(|| SendFailure::new(400, "VALIDATION_FAILED", "A payload is required"))
        .and_then(|payload| {
            serde_json::from_value::<SendBody>(payload).map_err(|_| {
                SendFailure::new(
                    400,
                    "VALIDATION_FAILED",
                    "The payload does not match the DTO",
                )
            })
        });

    let target = match (name, &parsed) {
        ("sendThreadReply", Ok(body)) => body
            .parent_message_id
            .clone()
            .map(SendTarget::Thread)
            .ok_or_else(|| {
                SendFailure::new(
                    400,
                    "MESSAGE_TARGET_INVALID",
                    "parentMessageId is required for thread replies",
                )
            }),
        ("sendMessage", Ok(body)) => {
            body.channel_id
                .clone()
                .map(SendTarget::Channel)
                .ok_or_else(|| {
                    SendFailure::new(
                        400,
                        "MESSAGE_TARGET_INVALID",
                        "channelId is required for channel messages",
                    )
                })
        }
        ("sendDirectMessage", Ok(body)) => body
            .direct_message_group_id
            .clone()
            .map(SendTarget::DirectMessage)
            .ok_or_else(|| {
                SendFailure::new(
                    400,
                    "MESSAGE_TARGET_INVALID",
                    "directMessageGroupId is required for direct messages",
                )
            }),
        (_, Err(failure)) => Err(failure.clone()),
        _ => Err(SendFailure::new(
            400,
            "VALIDATION_FAILED",
            "Unknown send event",
        )),
    };

    let result = parsed.and_then(|body| {
        let target = target?;
        // The gateway's `RbacGuard` on `sendMessage`/`sendThreadReply`: a channel the sender can't
        // see is refused before the message exists.
        if let Some(channel_id) = channel_target(inner, &target)
            && !crate::admin::can_view(inner, &channel_id, user)
        {
            return Err(SendFailure::new(403, "FORBIDDEN", "Forbidden resource"));
        }
        Ok(messages::send(
            inner,
            user,
            target,
            &body,
            inner.take_send_fault(),
        ))
    });

    match result {
        Ok(Ok(message)) => {
            let value = if v2 {
                serde_json::to_value(SendAckDto {
                    error: None,
                    message_id: Some(message.id),
                    ok: true,
                })
                .expect("an ack serialises")
            } else {
                Value::from(message.id)
            };
            ack_value(inner, tx, ack, value);
        }
        Ok(Err(failure)) => fail_send(inner, tx, v2, ack, &failure),
        Err(failure) => fail_send(inner, tx, v2, ack, &failure),
    }
}

/// The channel a send targets, for the gateway's channel RBAC: a thread reply belongs to its
/// parent's channel; a DM has none.
fn channel_target(inner: &Inner, target: &SendTarget) -> Option<String> {
    match target {
        SendTarget::Channel(channel_id) => Some(channel_id.clone()),
        SendTarget::Thread(parent_id) => messages::find_message(&lock(&inner.data), parent_id)
            .and_then(|parent| parent.channel_id),
        SendTarget::DirectMessage(_) => None,
    }
}

fn fail_send(
    inner: &Arc<Inner>,
    tx: &mpsc::UnboundedSender<Outbound>,
    v2: bool,
    ack: Option<u64>,
    failure: &SendFailure,
) {
    if v2 {
        let error = SendAckErrorDto {
            error_code: semaphore_wire::enums::ErrorCode::Unknown(failure.code.clone()),
            message: failure.message.clone(),
            retry_after_ms: failure.retry_after_ms.map(|value| value as f64),
            retryable: failure.retryable,
        };
        let value = serde_json::to_value(SendAckDto {
            error: Some(error),
            message_id: None,
            ok: false,
        })
        .expect("an ack serialises");
        ack_value(inner, tx, ack, value);
        return;
    }
    // A client that did not ask for typed acks gets the failure as an event.
    let body = error_body(
        failure.status,
        &failure.code,
        failure.message.clone(),
        failure.retryable,
        failure.retry_after_ms,
    );
    inner.enqueue_text(tx, event_frame("exception", body));
}

fn ack_value(
    inner: &Arc<Inner>,
    tx: &mpsc::UnboundedSender<Outbound>,
    ack: Option<u64>,
    value: Value,
) {
    let Some(ack) = ack else {
        return;
    };
    if inner.acks_dropped() {
        return;
    }
    let frame = format!(
        "43{ack}{}",
        serde_json::to_string(&[value]).expect("an ack body always serialises")
    );
    match inner.acks_delayed() {
        Some(delay) => {
            let inner = inner.clone();
            let tx = tx.clone();
            inner.reserve_frame();
            tokio::spawn(async move {
                tokio::time::sleep(delay).await;
                if tx.send(Outbound::Text(frame)).is_err() {
                    inner.frame_done();
                }
            });
        }
        None => inner.enqueue_text(tx, frame),
    }
}

/// `markAsRead {channelId | directMessageGroupId, lastReadMessageId}` (`markReadAndAnnounce`):
/// the read state moves, the user's unread notifications of that context are marked read without
/// a `notificationRead`, and `readReceiptUpdated` goes to the user's sockets; for a DM, also to
/// the group, with the reader's details, as the backend's DM room broadcast does.
fn mark_as_read(
    inner: &Arc<Inner>,
    tx: &mpsc::UnboundedSender<Outbound>,
    user: &str,
    ack: Option<u64>,
    payload: Option<Value>,
) {
    let field = |name: &str| {
        payload
            .as_ref()
            .and_then(|payload| payload.get(name))
            .and_then(Value::as_str)
    };
    let (channel, group, last) = (
        field("channelId"),
        field("directMessageGroupId"),
        field("lastReadMessageId"),
    );
    let Some(last) = last else {
        return refuse(inner, tx, "lastReadMessageId is required");
    };
    if announce_read(inner, user, channel, group, last).is_err_and(|message| {
        refuse(inner, tx, message);
        true
    }) {
        return;
    }
    ack_value(inner, tx, ack, Value::from("ACK"));
}

fn refuse(inner: &Arc<Inner>, tx: &mpsc::UnboundedSender<Outbound>, message: &str) {
    inner.enqueue_text(
        tx,
        event_frame(
            "exception",
            error_body(400, "BAD_REQUEST", message.to_owned(), false, None),
        ),
    );
}

/// What `markReadAndAnnounce` does, for the socket event and the REST route alike: the read state
/// moves, the user's unread notifications of that context are marked read (no
/// `notificationRead`), and `readReceiptUpdated` goes to the user's sockets and, for a DM, to
/// the group with the reader's details. `Err` is the backend's 400 message.
pub(crate) fn announce_read(
    inner: &Arc<Inner>,
    user: &str,
    channel: Option<&str>,
    group: Option<&str>,
    last: &str,
) -> Result<Value, &'static str> {
    if channel.is_some() == group.is_some() {
        return Err("Must provide exactly one of channelId or directMessageGroupId");
    }
    let belongs = {
        let data = lock(&inner.data);
        messages::find_message(&data, last).is_some_and(|message| {
            message.channel_id.as_deref() == channel.filter(|_| group.is_none())
                && message.direct_message_group_id.as_deref() == group
        })
    };
    if !belongs {
        return Err("Message not found in the specified channel or DM group");
    }

    let receipt = messages::mark_read(inner, user, channel, group, last);
    let (channel_id, group_id) = (channel.map(str::to_owned), group.map(str::to_owned));
    let reader = {
        let mut data = lock(&inner.data);
        crate::social::mark_context_read(&mut data, user, channel, group);
        crate::social::dm_member_ids(&data, group.unwrap_or_default())
    };
    let payload = json!({
        "channelId": channel_id,
        "directMessageGroupId": group_id,
        "lastReadMessageId": last,
        "lastReadAt": receipt["lastReadAt"],
    });
    inner.emit_to_user(user, "readReceiptUpdated", payload.clone());
    if let (Some(members), Some(reader)) = (reader, inner.scenario.user(user)) {
        let mut room = payload;
        room["userId"] = Value::from(reader.id.clone());
        room["username"] = Value::from(reader.username.clone());
        room["displayName"] = json!(reader.display_name);
        room["avatarUrl"] = json!(reader.avatar_url);
        inner.emit_to_users(&members, "readReceiptUpdated", room);
    }
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ping clock starts at `PingTimer::new`'s now, and the first ping is one interval out.
    fn started() -> (PingTimer, Instant) {
        let pings = PingTimer::new(PING_INTERVAL, PING_TIMEOUT);
        let start = pings.next_ping - PING_INTERVAL;
        (pings, start)
    }

    #[test]
    fn a_pong_every_interval_keeps_the_connection() {
        let (mut pings, start) = started();
        for n in 1..=4u32 {
            let at = start + PING_INTERVAL * n;
            assert_eq!(
                pings.deadline(),
                at,
                "ping {n} is due one interval after the last"
            );
            assert_eq!(pings.tick(at), Ping::Send);
            pings.pong();
        }
    }

    #[test]
    fn an_unanswered_ping_ends_the_connection_a_timeout_later() {
        let (mut pings, start) = started();
        assert_eq!(pings.tick(start + PING_INTERVAL), Ping::Send);
        assert_eq!(pings.tick(start + PING_INTERVAL * 2), Ping::Send);
        assert_eq!(pings.tick(start + PING_INTERVAL * 3), Ping::Send);
        // The deadline is the first unanswered ping's, 25 s + 60 s, not the last one's plus 60 s.
        let timeout = start + PING_INTERVAL + PING_TIMEOUT;
        assert_eq!(pings.deadline(), timeout);
        assert_eq!(pings.tick(timeout), Ping::Ended);
    }

    #[test]
    fn the_open_packet_advertises_the_backends_ping_settings() {
        let open = open_frame("sid-000001");
        let body: Value = serde_json::from_str(&open[1..]).expect("the open frame is JSON");
        assert_eq!(body["pingInterval"], 25_000);
        assert_eq!(body["pingTimeout"], 60_000);
        assert_eq!(body["sid"], "sid-000001");
    }
}
