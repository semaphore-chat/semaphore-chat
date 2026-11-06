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
use tokio::sync::mpsc;

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
            "pingInterval": 25000,
            "pingTimeout": 20000,
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
            if !valid_token(token) || !current {
                inner.enqueue_text(&tx, "44{\"message\":\"AUTH_FAILED\"}".to_owned());
                break;
            }
            // Register before the connect ack, so a client that has its ack is
            // already receiving broadcasts.
            lock(&inner.sockets).insert(sid, tx.clone());
            connected = true;
            inner.enqueue_text(&tx, format!("40{}", json!({ "sid": sid_text })));
            break;
        }
    }
    inner.end();

    if connected {
        let mut abrupt = false;
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
                                continue;
                            }
                            if let Some((ack, args)) = parse_event(text) {
                                inner.begin();
                                handle_event(&inner, &tx, protocol.clone(), ack, args).await;
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
            }
        }
        lock(&inner.sockets).remove(&sid);
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
            handle_send(inner, tx, protocol, ack, &name, payload).await;
        }
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
        Ok(messages::send(
            inner,
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
