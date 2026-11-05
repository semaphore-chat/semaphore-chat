//! Test 5: each fault, over real sockets and HTTP.

mod common;

use common::*;
use serde_json::{Value, json};
use std::time::Duration;

fn message(text: &str) -> Value {
    json!({
        "channelId": "channel-13",
        "spans": [{ "type": "PLAINTEXT", "text": text }],
        "attachments": [],
        "clientNonce": uuid::Uuid::from_u128(7).to_string(),
    })
}

#[tokio::test]
async fn drop_connections_ends_them_abruptly() {
    let server = start("big-community").await;
    let base = server.base_url();
    let mut first = Socket::connect(&base, json!({ "token": TOKEN })).await;
    let mut second = Socket::connect(&base, json!({ "token": TOKEN })).await;
    server.idle().await;

    server.drop_connections().await;
    assert!(
        !matches!(first.next(Duration::from_secs(2)).await, Incoming::Timeout),
        "the first socket must not keep running"
    );
    assert!(
        !matches!(second.next(Duration::from_secs(2)).await, Incoming::Timeout),
        "the second socket must not keep running"
    );
    server.idle().await;

    // A new connection still works.
    let mut fresh = Socket::connect(&base, json!({ "token": TOKEN })).await;
    fresh.send("2").await;
    assert_eq!(fresh.next_text().await, "3");
}

#[tokio::test]
async fn refuse_connections_refuses_the_upgrade() {
    let server = start("big-community").await;
    let base = server.base_url();
    server.refuse_connections(true);

    let url = format!(
        "{}/socket.io/?EIO=4&transport=websocket",
        base.replace("http://", "ws://")
    );
    let refused = tokio_tungstenite::connect_async(&url).await;
    assert!(refused.is_err(), "the upgrade should fail");

    server.refuse_connections(false);
    let mut socket = Socket::connect(&base, json!({ "token": TOKEN })).await;
    socket.send("2").await;
    assert_eq!(socket.next_text().await, "3");
}

#[tokio::test]
async fn delayed_acks_still_broadcast_first() {
    let server = start("big-community").await;
    let base = server.base_url();
    let mut socket = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
    server.delay_acks(Duration::from_millis(200)).await;
    let started = std::time::Instant::now();

    socket
        .send(&format!(
            "421{}",
            json!(["sendMessage", message("delayed")])
        ))
        .await;
    let broadcast = socket.next_text().await;
    assert!(broadcast.starts_with("42"), "{broadcast}");
    let ack = socket.next_text().await;
    assert!(ack.starts_with("431["), "{ack}");
    assert!(
        started.elapsed() >= Duration::from_millis(150),
        "the ack was not delayed ({:?})",
        started.elapsed()
    );

    server.idle().await;
}

#[tokio::test]
async fn dropped_acks_never_arrive() {
    let server = start("big-community").await;
    let base = server.base_url();
    let mut socket = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
    server.drop_acks(true);

    socket
        .send(&format!("421{}", json!(["sendMessage", message("no ack")])))
        .await;
    let broadcast = socket.next_text().await;
    assert!(broadcast.starts_with("42"), "{broadcast}");
    assert!(
        matches!(
            socket.next(Duration::from_millis(300)).await,
            Incoming::Timeout
        ),
        "there must be no ack"
    );

    // The socket is still alive.
    socket.send("2").await;
    assert_eq!(socket.next_text().await, "3");
}

#[tokio::test]
async fn a_failed_send_creates_nothing_and_acks_the_error() {
    let server = start("big-community").await;
    let base = server.base_url();
    let mut socket = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
    server.fail_next_send("RATE_LIMITED", true, Some(250));

    socket
        .send(&format!("421{}", json!(["sendMessage", message("fails")])))
        .await;
    let ack = socket.next_text().await;
    let (_, value) = parse_ack(&ack).expect("an ack");
    assert_eq!(value["ok"], false, "{ack}");
    assert_eq!(value["error"]["errorCode"], "RATE_LIMITED", "{ack}");
    assert_eq!(value["error"]["retryable"], true, "{ack}");
    assert_eq!(
        value["error"]["retryAfterMs"].as_f64(),
        Some(250.0),
        "{ack}"
    );

    // No broadcast and no second message.
    assert!(
        matches!(
            socket.next(Duration::from_millis(300)).await,
            Incoming::Timeout
        ),
        "a failed send must not broadcast"
    );
    let client = http();
    let (_, page) = get(&client, &base, "/api/messages/channel/channel-13?limit=100").await;
    assert!(
        !page["messages"]
            .as_array()
            .expect("a page")
            .iter()
            .any(|message| message["clientNonce"] == "00000000-0000-0000-0000-000000000007"),
        "{page}"
    );
}

#[tokio::test]
async fn fail_route_fails_one_request() {
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();
    server.fail_route("MessagesController_findAllForChannel", 503, "UNAVAILABLE");

    let (status, body) = get(&client, &base, "/api/messages/channel/channel-13").await;
    assert_eq!(status, 503, "{body}");
    assert_eq!(body["errorCode"], "UNAVAILABLE");
    assert_eq!(body["retryable"], false);

    let (status, _) = get(&client, &base, "/api/messages/channel/channel-13").await;
    assert_eq!(status, 200, "the fault is one-shot");
}

#[tokio::test]
async fn fail_next_send_also_answers_rest() {
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();
    server.fail_next_send("SLOWMODE", true, Some(1500));

    let (status, body) = post(&client, &base, "/api/messages", message("rest fails")).await;
    assert_eq!(status, 429, "{body}");
    assert_eq!(body["errorCode"], "SLOWMODE");
    assert_eq!(body["retryAfterMs"], 1500);

    let (status, _) = post(&client, &base, "/api/messages", message("rest works")).await;
    assert_eq!(status, 201, "the fault is one-shot");
}
