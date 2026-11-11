//! The showcase's message ids are served as UUIDs, as the real backend issues them; the other
//! scenarios keep the readable ids their tests name.

mod common;

use common::*;
use semaphore_fake_server::message_uuid;
use serde_json::Value;

fn is_uuid(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok()
}

#[test]
fn a_readable_id_maps_to_the_same_uuid_every_time() {
    let id = message_uuid("sc-cc-pit-caption");
    assert!(is_uuid(&id), "{id}");
    assert_eq!(id, message_uuid("sc-cc-pit-caption"));
    assert_ne!(id, message_uuid("sc-cc-pit"));
    // Pinned: rig scripts name messages through it, and a change would move them all.
    assert_eq!(id, "1c472455-7da4-5aef-ac03-8342c7b3bf2e");
}

#[tokio::test]
async fn the_showcase_serves_uuids_and_its_references_follow() {
    let server = start("showcase").await;
    let caption = server
        .message(&message_uuid("sc-cc-pit-caption"))
        .expect("served under its UUID");
    assert_eq!(caption.channel_id.as_deref(), Some("cc-general"));
    assert!(server.message("sc-cc-pit-caption").is_none());

    let client = http();
    let base = server.base_url();
    let parent = message_uuid("sc-cc-friday");
    let (status, body) = get(&client, &base, &format!("/api/threads/{parent}/replies")).await;
    assert_eq!(status, 200, "{body}");
    let replies = body["replies"].as_array().expect("replies");
    assert!(!replies.is_empty());
    for reply in replies {
        assert!(is_uuid(reply["id"].as_str().unwrap()), "{reply}");
        assert_eq!(reply["parentMessageId"].as_str(), Some(parent.as_str()));
    }

    let (status, body) = get(&client, &base, "/api/messages/channel/cc-general?limit=100").await;
    assert_eq!(status, 200, "{body}");
    let messages = body["messages"].as_array().expect("messages");
    for message in messages {
        assert!(is_uuid(message["id"].as_str().unwrap()), "{message}");
        if let Some(reply_to) = message["replyToId"].as_str() {
            assert!(is_uuid(reply_to), "{message}");
            assert_eq!(message["replyTo"]["id"], Value::from(reply_to));
        }
    }
}

#[tokio::test]
async fn other_scenarios_keep_their_readable_ids() {
    let server = start("big-community").await;
    assert!(server.message("msg-48").is_some());
}
