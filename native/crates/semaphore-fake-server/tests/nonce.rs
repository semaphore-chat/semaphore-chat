//! Test 4: one nonce, one message, one broadcast.

mod common;

use common::*;
use serde_json::{Value, json};
use std::time::Duration;

fn nonce() -> String {
    uuid::Uuid::from_u128(42).to_string()
}

#[tokio::test]
async fn the_same_nonce_twice_is_one_message_and_one_broadcast() {
    let server = start("big-community").await;
    let base = server.base_url();
    let mut sender = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
    let mut reader = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
    // Let both sockets settle before the send, so the first broadcast goes to both.
    server.idle().await;

    let payload = json!({
        "channelId": "channel-13",
        "spans": [{ "type": "PLAINTEXT", "text": "once" }],
        "attachments": [],
        "clientNonce": nonce(),
    });
    sender
        .send(&format!("421{}", json!(["sendMessage", payload])))
        .await;

    let first = reader.next_text().await;
    let (event, broadcast) = common::event(&first);
    assert_eq!(event, "newMessage");
    assert_eq!(broadcast["message"]["clientNonce"], nonce());
    let first_id = broadcast["message"]["id"].clone();

    let _ = sender.next_text().await; // sender's broadcast
    let (_, ack) = parse_ack(&sender.next_text().await).expect("an ack");
    assert_eq!(ack["messageId"], first_id);

    // The retry gets the same id...
    sender
        .send(&format!(
            "422{}",
            json!([
                "sendMessage",
                {
                    "channelId": "channel-13",
                    "spans": [{ "type": "PLAINTEXT", "text": "once" }],
                    "attachments": [],
                    "clientNonce": nonce(),
                }
            ])
        ))
        .await;
    let (id, ack) = parse_ack(&sender.next_text().await).expect("an ack");
    assert_eq!(id, 2);
    assert_eq!(ack["messageId"], first_id);

    // ...and there is no second broadcast to anyone.
    server.idle().await;
    assert!(
        matches!(
            reader.next(Duration::from_millis(300)).await,
            Incoming::Timeout
        ),
        "the retry must not broadcast"
    );
    assert!(
        matches!(
            sender.next(Duration::from_millis(300)).await,
            Incoming::Timeout
        ),
        "the retry must not broadcast to the sender either"
    );

    // REST and the socket share the nonce.
    let client = http();
    let (status, body) = post(
        &client,
        &base,
        "/api/messages",
        json!({
            "channelId": "channel-13",
            "spans": [{ "type": "PLAINTEXT", "text": "once" }],
            "attachments": [],
            "clientNonce": nonce(),
        }),
    )
    .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["id"], first_id);

    // A nonce belongs to its target.
    let (status, body) = post(
        &client,
        &base,
        "/api/messages",
        json!({
            "channelId": "channel-54",
            "spans": [{ "type": "PLAINTEXT", "text": "elsewhere" }],
            "attachments": [],
            "clientNonce": nonce(),
        }),
    )
    .await;
    assert_eq!(status, 409, "{body}");
    assert_eq!(body["errorCode"], "NONCE_CONFLICT");

    // The channel only has the one message with this nonce.
    let (_, page) = get(&client, &base, "/api/messages/channel/channel-13?limit=100").await;
    let matches: Vec<&Value> = page["messages"]
        .as_array()
        .expect("a page")
        .iter()
        .filter(|message| message["clientNonce"] == nonce())
        .collect();
    assert_eq!(matches.len(), 1, "{page}");
}

#[tokio::test]
async fn a_nonce_must_be_a_uuid() {
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();

    let (status, body) = post(
        &client,
        &base,
        "/api/messages",
        json!({
            "channelId": "channel-13",
            "spans": [{ "type": "PLAINTEXT", "text": "bad nonce" }],
            "attachments": [],
            "clientNonce": "not-a-uuid",
        }),
    )
    .await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["errorCode"], "VALIDATION_FAILED");
}
