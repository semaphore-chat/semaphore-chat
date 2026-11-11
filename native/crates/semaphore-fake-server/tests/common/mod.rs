//! Shared helpers: a started fake, HTTP requests and a raw Socket.IO client.
#![allow(dead_code)]

use futures_util::{SinkExt, StreamExt};
use semaphore_fake_server::{FakeServer, ScenarioSource};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub const TOKEN: &str = "Bearer test-token";
pub const WAIT: Duration = Duration::from_secs(5);

pub async fn start(name: &'static str) -> FakeServer {
    FakeServer::start(ScenarioSource::Named(name))
        .await
        .expect("the scenario loads")
}

pub fn http() -> reqwest::Client {
    // Only this workspace's other crates make it needed; harmless when it isn't.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::new()
}

pub async fn request(
    client: &reqwest::Client,
    method: reqwest::Method,
    base: &str,
    path: &str,
    body: Option<Value>,
    auth: bool,
) -> (u16, Value) {
    let mut builder = client.request(method, format!("{base}{path}"));
    if auth {
        builder = builder.header("Authorization", TOKEN);
    }
    if let Some(body) = body {
        builder = builder.json(&body);
    }
    let response = builder.send().await.expect("the fake answers");
    let status = response.status().as_u16();
    let text = response.text().await.expect("a body");
    let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (status, value)
}

pub async fn get(client: &reqwest::Client, base: &str, path: &str) -> (u16, Value) {
    request(client, reqwest::Method::GET, base, path, None, true).await
}

pub async fn post(client: &reqwest::Client, base: &str, path: &str, body: Value) -> (u16, Value) {
    request(client, reqwest::Method::POST, base, path, Some(body), true).await
}

pub async fn delete(client: &reqwest::Client, base: &str, path: &str, body: Value) -> (u16, Value) {
    request(
        client,
        reqwest::Method::DELETE,
        base,
        path,
        Some(body),
        true,
    )
    .await
}

pub async fn login(client: &reqwest::Client, base: &str) -> Value {
    let (status, body) = request(
        client,
        reqwest::Method::POST,
        base,
        "/api/auth/login",
        Some(json!({ "username": "mike", "password": "Password123!" })),
        false,
    )
    .await;
    assert_eq!(status, 200, "login: {body}");
    body
}

/// The engine open frame, then `40` with `auth`, then the connect ack.
pub struct Socket {
    stream: WebSocketStream<MaybeTlsStream<TcpStream>>,
}

pub enum Incoming {
    Text(String),
    Closed,
    Timeout,
}

impl Socket {
    /// Connect and complete the Engine.IO and Socket.IO handshake.
    pub async fn connect(base: &str, auth: Value) -> Self {
        let mut socket = Self::open(base).await;
        socket.send(&format!("40{auth}")).await;
        let frame = socket.next(WAIT).await;
        match frame {
            Incoming::Text(text) => assert!(
                text.starts_with("40"),
                "expected a connect ack, got {text:?}"
            ),
            Incoming::Closed => panic!("the socket closed during the handshake"),
            Incoming::Timeout => panic!("no connect ack"),
        }
        socket
    }

    /// Open the WebSocket and read the Engine.IO open packet.
    pub async fn open(base: &str) -> Self {
        let url = format!(
            "{}/socket.io/?EIO=4&transport=websocket",
            base.replace("http://", "ws://")
        );
        let (stream, _) = tokio_tungstenite::connect_async(url)
            .await
            .expect("the upgrade succeeds");
        let mut socket = Self { stream };
        match socket.next(WAIT).await {
            Incoming::Text(text) => assert!(text.starts_with('0'), "expected open, got {text:?}"),
            Incoming::Closed => panic!("the socket closed before the open packet"),
            Incoming::Timeout => panic!("no engine open packet"),
        }
        socket
    }

    pub async fn send(&mut self, frame: &str) {
        self.stream
            .send(Message::Text(frame.to_owned().into()))
            .await
            .expect("the socket is writable");
    }

    pub async fn next(&mut self, timeout: Duration) -> Incoming {
        match tokio::time::timeout(timeout, self.stream.next()).await {
            Err(_) => Incoming::Timeout,
            Ok(None) => Incoming::Closed,
            Ok(Some(Err(_))) => Incoming::Closed,
            Ok(Some(Ok(Message::Text(text)))) => Incoming::Text(text.to_string()),
            Ok(Some(Ok(Message::Close(_)))) => Incoming::Closed,
            Ok(Some(Ok(_))) => Incoming::Closed,
        }
    }

    /// The next text frame, with the standard wait. Panics on close or timeout.
    pub async fn next_text(&mut self) -> String {
        match self.next(WAIT).await {
            Incoming::Text(text) => text,
            Incoming::Closed => panic!("the socket closed while waiting for a frame"),
            Incoming::Timeout => panic!("no frame within {WAIT:?}"),
        }
    }
}

/// `42[...]`, with an optional namespace and ack id.
pub fn parse_event(frame: &str) -> Option<(Option<u64>, Vec<Value>)> {
    let rest = frame.strip_prefix("42")?;
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

/// `43<id>[...]`: the first ack value.
pub fn parse_ack(frame: &str) -> Option<(u64, Value)> {
    let rest = frame.strip_prefix("43")?;
    let digits = rest
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(rest.len());
    if digits == 0 {
        return None;
    }
    let id = rest[..digits].parse().ok()?;
    let value: Value = serde_json::from_str(&rest[digits..]).ok()?;
    Some((id, value.as_array()?.first()?.clone()))
}

/// A `newMessage` broadcast's message, from the frame.
pub fn broadcasted_message(frame: &str) -> Value {
    let (_, args) = parse_event(frame).expect("an event frame");
    assert_eq!(args.first().and_then(Value::as_str), Some("newMessage"));
    args[1]["message"].clone()
}

/// An event name and payload from a frame.
pub fn event(frame: &str) -> (String, Value) {
    let (_, args) = parse_event(frame).expect("an event frame");
    (
        args.first()
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        args.get(1).cloned().unwrap_or(Value::Null),
    )
}

pub async fn put(client: &reqwest::Client, base: &str, path: &str, body: Value) -> (u16, Value) {
    request(client, reqwest::Method::PUT, base, path, Some(body), true).await
}

/// A v2 socket that is `user_id`'s (the fake's handshake extension), so a test can watch what
/// another member receives.
pub async fn connect_as(base: &str, user_id: &str) -> Socket {
    Socket::connect(
        base,
        json!({ "token": TOKEN, "protocol": 2, "userId": user_id }),
    )
    .await
}

/// Send one event with an ack id and read frames until its ack: the events the server sent first
/// (broadcasts and the notifications the send caused go out before the ack), and the ack value.
pub async fn emit_event(
    socket: &mut Socket,
    ack_id: u64,
    name: &str,
    payload: Value,
) -> (Vec<(String, Value)>, Value) {
    socket
        .send(&format!("42{ack_id}{}", json!([name, payload])))
        .await;
    let mut events = Vec::new();
    loop {
        let frame = socket.next_text().await;
        if let Some((id, value)) = parse_ack(&frame) {
            assert_eq!(id, ack_id, "{frame}");
            return (events, value);
        }
        events.push(event(&frame));
    }
}

/// Everything each socket was sent until now, in order: a `marker` event goes to all connected
/// sockets, and each given one is read up to it (earlier calls' markers are skipped). A frame that was queued before the marker is read before it, so an event
/// that was not sent is proved absent without waiting for it.
pub async fn settle(server: &FakeServer, sockets: &mut [&mut Socket]) -> Vec<Vec<(String, Value)>> {
    static MARKERS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let this = MARKERS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    server.emit("marker", json!({ "n": this })).await;
    let mut all = Vec::new();
    for socket in sockets.iter_mut() {
        let mut events = Vec::new();
        loop {
            let (name, payload) = event(&socket.next_text().await);
            if name == "marker" {
                // An earlier call that left this socket out: its marker is still queued.
                if payload["n"] == this {
                    break;
                }
                continue;
            }
            events.push((name, payload));
        }
        all.push(events);
    }
    all
}

pub fn names(events: &[(String, Value)]) -> Vec<&str> {
    events.iter().map(|(name, _)| name.as_str()).collect()
}
