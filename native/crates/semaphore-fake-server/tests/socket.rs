//! Test 2 and 3: the socket session, and the typed ack for protocol 2.

mod common;

use common::*;
use serde_json::{Value, json};

#[tokio::test]
async fn handshake_event_ping_and_ack() {
    let server = start("big-community").await;
    let base = server.base_url();

    let mut socket = Socket::open(&base).await;
    socket
        .send(&format!("40{}", json!({ "token": TOKEN, "protocol": 2 })))
        .await;
    let connected = socket.next_text().await;
    assert!(connected.starts_with("40{"), "connect ack: {connected}");

    // Engine.IO ping and pong.
    socket.send("2").await;
    assert_eq!(socket.next_text().await, "3");

    // An event without an ack is accepted, and answered with the real 'ACK'.
    socket.send("42[\"presenceOnline\",{}]").await;
    socket.send("421[\"presenceOnline\",{}]").await;
    let ack = socket.next_text().await;
    assert_eq!(ack, "431[\"ACK\"]");

    let records = server.requests();
    let handshake = records
        .iter()
        .find(|record| matches!(record, semaphore_fake_server::Record::Socket { event, .. } if event == "handshake"))
        .expect("the handshake is recorded");
    let semaphore_fake_server::Record::Socket {
        protocol, payload, ..
    } = handshake
    else {
        unreachable!()
    };
    assert_eq!(protocol.as_ref(), Some(&Value::from(2)));
    assert_eq!(
        payload.as_ref().and_then(|p| p.get("protocol")),
        Some(&Value::from(2))
    );

    assert!(
        records.iter().any(|record| matches!(record, semaphore_fake_server::Record::Socket { event, .. } if event == "presenceOnline")),
        "the event is recorded"
    );
}

#[tokio::test]
async fn a_bad_handshake_is_refused() {
    let server = start("big-community").await;
    let base = server.base_url();

    // No token at all.
    let mut socket = Socket::open(&base).await;
    socket.send("40{}").await;
    assert_eq!(socket.next_text().await, "44{\"message\":\"AUTH_FAILED\"}");

    // Not a bearer token.
    let mut socket = Socket::open(&base).await;
    socket.send("40{\"token\":\"garbage\"}").await;
    assert_eq!(socket.next_text().await, "44{\"message\":\"AUTH_FAILED\"}");
}

#[tokio::test]
async fn protocol_two_gets_a_typed_ack_and_others_get_the_plain_id() {
    let server = start("big-community").await;
    let base = server.base_url();
    let message = json!({
        "channelId": "channel-13",
        "spans": [{ "type": "PLAINTEXT", "text": "ack" }],
        "attachments": [],
    });

    let mut typed = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
    typed
        .send(&format!("421{}", json!(["sendMessage", message])))
        .await;
    let _ = typed.next_text().await; // the broadcast
    let ack = typed.next_text().await;
    let (_, value) = parse_ack(&ack).expect("an ack");
    assert_eq!(value["ok"], true, "{ack}");
    assert!(
        value["messageId"].as_str().is_some_and(|id| !id.is_empty()),
        "{ack}"
    );
    assert!(value.get("error").is_none(), "{ack}");

    let mut plain = Socket::connect(&base, json!({ "token": TOKEN })).await;
    plain
        .send(&format!(
            "421{}",
            json!([
                "sendMessage",
                {
                    "channelId": "channel-13",
                    "spans": [{ "type": "PLAINTEXT", "text": "plain ack" }],
                    "attachments": [],
                }
            ])
        ))
        .await;
    let _ = plain.next_text().await;
    let ack = plain.next_text().await;
    let (_, value) = parse_ack(&ack).expect("an ack");
    assert_eq!(value.as_str(), Some("fake-msg-000002"), "{ack}");
}

#[tokio::test]
async fn a_string_protocol_is_not_protocol_two() {
    let server = start("big-community").await;
    let base = server.base_url();

    // The real server only reads a numeric protocol (send-ack.spec.ts).
    let mut socket = Socket::connect(&base, json!({ "token": TOKEN, "protocol": "2" })).await;
    socket
        .send(&format!(
            "421{}",
            json!([
                "sendMessage",
                {
                    "channelId": "channel-13",
                    "spans": [{ "type": "PLAINTEXT", "text": "string protocol" }],
                    "attachments": [],
                }
            ])
        ))
        .await;
    let _ = socket.next_text().await;
    let ack = socket.next_text().await;
    let (_, value) = parse_ack(&ack).expect("an ack");
    assert_eq!(value.as_str(), Some("fake-msg-000001"), "{ack}");
}
