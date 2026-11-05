//! Test 7: the same calls twice give identical responses, on one server and on two.

mod common;

use common::*;
use serde_json::{Value, json};

fn nonce() -> String {
    uuid::Uuid::from_u128(99).to_string()
}

async fn script(base: &str) -> Value {
    let client = http();
    let login = login(&client, base).await;

    let (_, profile) = get(&client, base, "/api/users/profile").await;
    let (_, communities) = get(&client, base, "/api/community/mine").await;
    let (_, channels) = get(&client, base, "/api/channels/community/community-1").await;
    let (_, messages) = get(&client, base, "/api/messages/channel/channel-13?limit=20").await;
    let (_, sent) = post(
        &client,
        base,
        "/api/messages",
        json!({
            "channelId": "channel-13",
            "spans": [{ "type": "PLAINTEXT", "text": "deterministic" }],
            "attachments": [],
            "clientNonce": nonce(),
        }),
    )
    .await;
    let (_, retried) = post(
        &client,
        base,
        "/api/messages",
        json!({
            "channelId": "channel-13",
            "spans": [{ "type": "PLAINTEXT", "text": "deterministic" }],
            "attachments": [],
            "clientNonce": nonce(),
        }),
    )
    .await;
    let (_, presence) = get(&client, base, "/api/channels/channel-103/voice-presence").await;

    json!({
        "login": login,
        "profile": profile,
        "communities": communities,
        "channels": channels,
        "messages": messages,
        "sent": sent,
        "retried": retried,
        "presence": presence,
    })
}

#[tokio::test]
async fn two_servers_answer_identically() {
    let first = start("big-community").await;
    let second = start("big-community").await;
    let first_script = script(&first.base_url()).await;
    let second_script = script(&second.base_url()).await;
    assert_eq!(first_script, second_script);
    assert_eq!(
        first_script["sent"]["id"], first_script["retried"]["id"],
        "a retry keeps the id"
    );
}

#[tokio::test]
async fn the_clock_is_settable_and_stamps_messages() {
    let server = start("big-community").await;
    let base = server.base_url();
    let client = http();

    let first_nonce = uuid::Uuid::from_u128(1).to_string();
    let (_, before) = post(
        &client,
        &base,
        "/api/messages",
        json!({
            "channelId": "channel-13",
            "spans": [{ "type": "PLAINTEXT", "text": "before" }],
            "attachments": [],
            "clientNonce": first_nonce,
        }),
    )
    .await;

    server.advance_clock(std::time::Duration::from_secs(3600));
    let (_, after) = post(
        &client,
        &base,
        "/api/messages",
        json!({
            "channelId": "channel-13",
            "spans": [{ "type": "PLAINTEXT", "text": "after" }],
            "attachments": [],
            "clientNonce": uuid::Uuid::from_u128(2).to_string(),
        }),
    )
    .await;

    let before_sent = before["sentAt"].as_str().expect("sentAt");
    let after_sent = after["sentAt"].as_str().expect("sentAt");
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(after_sent)
            .expect("a timestamp")
            .timestamp()
            - chrono::DateTime::parse_from_rfc3339(before_sent)
                .expect("a timestamp")
                .timestamp(),
        3600
    );
}

#[tokio::test]
async fn two_runs_emit_the_same_broadcast() {
    let mut frames = Vec::new();
    for _ in 0..2 {
        let server = start("big-community").await;
        let base = server.base_url();
        let mut socket = Socket::connect(&base, json!({ "token": TOKEN, "protocol": 2 })).await;
        socket
            .send(&format!(
                "421{}",
                json!([
                    "sendMessage",
                    {
                        "channelId": "channel-13",
                        "spans": [{ "type": "PLAINTEXT", "text": "same" }],
                        "attachments": [],
                        "clientNonce": nonce(),
                    }
                ])
            ))
            .await;
        let broadcast = socket.next_text().await;
        let ack = socket.next_text().await;
        frames.push((broadcast, ack));
    }
    assert_eq!(frames[0], frames[1]);
}
