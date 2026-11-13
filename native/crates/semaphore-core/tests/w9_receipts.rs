//! Read receipts: a DM's peer watermarks and who has seen one message, against `FakeBackend`
//! (`tests/common/mod.rs` scripts them through its `w4` runner as `w9_peer_reads`, `w9_readers`).

mod common;

use common::*;
use semaphore_core::backend::BackendError;
use semaphore_core::model::{
    Conversation, DmPeerReadsView, LoadState, SeenByView, SessionState, ViewKey,
};
use semaphore_core::realtime::RealtimeEvent;
use semaphore_wire::enums::ErrorCode;
use serde_json::{Value, json};

const GROUP: &str = "dm-1";
const PRI: &str = "u-priya";
const ANN: &str = "u-ann";

fn error(status: u16, code: &str) -> BackendError {
    BackendError {
        status,
        code: ErrorCode::Unknown(code.into()),
        message: format!("{code} from the server"),
        retryable: false,
        retry_after_ms: None,
    }
}

fn dm(id: &str, author: &str, text: &str, at: &str) -> Value {
    let mut message = message_json(id, author, text);
    message["channelId"] = Value::Null;
    message["directMessageGroupId"] = json!(GROUP);
    message["sentAt"] = json!(at);
    message
}

/// Peer watermarks as the server sends them.
fn peer_reads(reads: &[(&str, &str)]) -> Value {
    Value::Array(
        reads
            .iter()
            .map(|(user, at)| json!({ "userId": user, "lastReadAt": at }))
            .collect(),
    )
}

/// One `MessageReaderDto`.
fn reader(user: &str, name: &str, at: &str) -> Value {
    json!({
        "userId": user, "username": name, "displayName": null, "avatarUrl": null, "readAt": at,
    })
}

/// Two of my DM messages, an hour apart, open in their conversation.
async fn dm_rig() -> Rig {
    let rig = Rig::new();
    let messages: Vec<_> = ["2026-09-22T17:00:00.000Z", "2026-09-22T18:00:00.000Z"]
        .iter()
        .enumerate()
        .map(|(index, at)| dm(&format!("m{index}"), ME, "hi", at))
        .map(|value| serde_json::from_value(value).expect("a message of the contract"))
        .collect();
    rig.backend
        .messages
        .lock()
        .unwrap()
        .insert(GROUP.into(), messages);
    let rig = rig.signed_in().await;
    rig.core
        .open_conversation(Conversation::DirectMessage { id: GROUP.into() })
        .await
        .unwrap();
    rig.core.run_until_idle().await;
    rig
}

// --- Peer watermarks --------------------------------------------------------------------------

#[tokio::test]
async fn a_dms_peer_reads_name_each_peer_and_when_they_read() {
    let rig = dm_rig().await;
    rig.backend.w4.answer(
        "w9_peer_reads",
        peer_reads(&[(PRI, "2026-09-22T17:30:00Z")]),
    );
    assert_eq!(
        rig.core.dm_peer_reads(GROUP.into()).state,
        LoadState::Loading
    );
    rig.core.run_until_idle().await;
    let view: DmPeerReadsView = rig.core.dm_peer_reads(GROUP.into());
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(view.dm_group_id, GROUP);
    assert_eq!(view.peers.len(), 1);
    assert_eq!(view.peers[0].user.id, PRI);
    assert_eq!(view.peers[0].last_read_at_ms, 1_790_098_200_000);
    // Their profile is asked for, so a name arrives after the rows do.
    assert!(
        rig.backend
            .user_requests
            .load(std::sync::atomic::Ordering::SeqCst)
            > 0
    );

    // A room the server refuses is a failed read, and the failure is final until a retry.
    rig.backend.w4.answer(
        "w9_peer_reads",
        peer_reads(&[(ANN, "2026-09-22T17:30:00Z")]),
    );
    rig.backend
        .w4
        .fail_next("w9_peer_reads", error(403, "FORBIDDEN"));
    let other = rig.core.dm_peer_reads("dm-other".into());
    assert_eq!(other.state, LoadState::Loading);
    rig.core.run_until_idle().await;
    assert!(matches!(
        rig.core.dm_peer_reads("dm-other".into()).state,
        LoadState::Failed { .. }
    ));
    let before = rig.backend.w4.count("w9_peer_reads");
    rig.core.dm_peer_reads("dm-other".into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w4.count("w9_peer_reads"),
        before,
        "a failed read isn't asked again by itself"
    );
    rig.core.retry_failed();
    rig.core.dm_peer_reads("dm-other".into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.core.dm_peer_reads("dm-other".into()).state,
        LoadState::Ready
    );
}

#[tokio::test]
async fn seen_by_in_a_dm_compares_the_watermark_with_the_sent_time() {
    let rig = dm_rig().await;
    let (first, second) = ("m0".to_owned(), "m1".to_owned());

    rig.backend.w4.answer(
        "w9_peer_reads",
        peer_reads(&[(PRI, "2026-09-22T17:30:00Z")]),
    );
    rig.core.dm_peer_reads(GROUP.into());
    rig.core.run_until_idle().await;

    let seen = rig
        .core
        .seen_by(Conversation::DirectMessage { id: GROUP.into() }, first);
    assert_eq!(seen.state, LoadState::Ready);
    assert_eq!(seen.count, 1);
    assert_eq!(seen.more, 0);
    assert_eq!(seen.readers[0].id, PRI);

    // Sent after that read: nobody has seen it yet.
    let unseen = rig
        .core
        .seen_by(Conversation::DirectMessage { id: GROUP.into() }, second);
    assert_eq!((unseen.count, unseen.readers.len()), (0, 0));
    assert_eq!(unseen.state, LoadState::Ready);

    // A message this build never loaded has no sent time to compare.
    let unknown = rig.core.seen_by(
        Conversation::DirectMessage { id: GROUP.into() },
        "gone".into(),
    );
    assert_eq!((unknown.count, unknown.readers.len()), (0, 0));
    assert_eq!(unknown.state, LoadState::Ready);
}

#[tokio::test]
async fn a_peers_read_updates_seen_by_without_reading_again() {
    let rig = dm_rig().await;
    let second = "m1".to_owned();
    rig.backend.w4.answer("w9_peer_reads", peer_reads(&[]));
    rig.core.dm_peer_reads(GROUP.into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.core
            .seen_by(
                Conversation::DirectMessage { id: GROUP.into() },
                second.clone()
            )
            .count,
        0
    );
    let reads = rig.backend.w4.count("w9_peer_reads");
    rig.events.take();

    // `readReceiptUpdated` naming the peer, to the DM's room.
    rig.core.ingest(RealtimeEvent::Event {
        name: "readReceiptUpdated".into(),
        payload: json!({
            "channelId": null,
            "directMessageGroupId": GROUP,
            "userId": PRI,
            "lastReadMessageId": second,
            "lastReadAt": "2026-09-22T19:00:00Z",
        }),
    });
    rig.core.run_until_idle().await;

    let seen = rig
        .core
        .seen_by(Conversation::DirectMessage { id: GROUP.into() }, second);
    assert_eq!(seen.count, 1);
    assert_eq!(seen.readers[0].id, PRI);
    assert_eq!(
        rig.backend.w4.count("w9_peer_reads"),
        reads,
        "the event carried the watermark; nothing is read again"
    );
    // Both the watermark list and the message's "seen by" say to read again.
    let views: Vec<ViewKey> = rig
        .events
        .take()
        .into_iter()
        .filter_map(|event| match event {
            semaphore_core::platform::CoreEvent::ViewChanged { view } => Some(view),
            _ => None,
        })
        .collect();
    assert!(views.contains(&ViewKey::DmPeerReads {
        dm_group_id: GROUP.into()
    }));
    assert!(
        views.iter().any(|view| matches!(
            view,
            ViewKey::SeenBy { message_id, .. } if message_id == "m1"
        )),
        "{views:?}"
    );
}

#[tokio::test]
async fn a_peer_read_for_a_room_nobody_read_asks_nothing_and_changes_nothing() {
    let rig = dm_rig().await;
    rig.events.take();
    rig.core.ingest(RealtimeEvent::Event {
        name: "readReceiptUpdated".into(),
        payload: json!({
            "channelId": null,
            "directMessageGroupId": "dm-elsewhere",
            "userId": PRI,
            "lastReadMessageId": "m0",
            "lastReadAt": "2026-09-22T19:00:00Z",
        }),
    });
    rig.core.run_until_idle().await;
    assert!(matches!(
        rig.core.dm_peer_reads("dm-elsewhere".into()).state,
        LoadState::Loading
    ));
    assert_eq!(rig.backend.w4.count("w9_peer_reads"), 0);
}

#[tokio::test]
async fn my_own_read_mark_does_not_change_the_peer_list() {
    let rig = dm_rig().await;
    rig.backend.w4.answer(
        "w9_peer_reads",
        peer_reads(&[(PRI, "2026-09-22T17:30:00Z")]),
    );
    rig.core.dm_peer_reads(GROUP.into());
    rig.core.run_until_idle().await;
    rig.core
        .mark_read(
            Conversation::DirectMessage { id: GROUP.into() },
            "m1".into(),
        )
        .await
        .unwrap();
    rig.events.take();
    // My other device's mark: no user named.
    rig.core.ingest(RealtimeEvent::Event {
        name: "readReceiptUpdated".into(),
        payload: json!({
            "channelId": null,
            "directMessageGroupId": GROUP,
            "lastReadMessageId": "m1",
            "lastReadAt": "2026-09-22T20:00:00Z",
        }),
    });
    rig.core.run_until_idle().await;
    let view = rig.core.dm_peer_reads(GROUP.into());
    assert_eq!(view.peers.len(), 1);
    assert_eq!(view.peers[0].user.id, PRI);
}

#[tokio::test]
async fn an_answer_after_sign_out_leaves_nothing_behind() {
    let rig = dm_rig().await;
    let held = rig.backend.w4.hold("w9_peer_reads");
    rig.backend.w4.answer(
        "w9_peer_reads",
        peer_reads(&[(PRI, "2026-09-22T17:30:00Z")]),
    );
    rig.core.dm_peer_reads(GROUP.into());
    tokio::task::yield_now().await;
    rig.core.sign_out().await.unwrap();
    held.send(()).unwrap();
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    let view = rig.core.dm_peer_reads(GROUP.into());
    assert!(view.peers.is_empty());
}

// --- A message's readers ----------------------------------------------------------------------

#[tokio::test]
async fn a_channels_message_readers_come_from_the_server() {
    let mut rig = Rig::new();
    rig = rig
        .open_channel(vec![message("m1", ME, "hello")])
        .await
        .signed_in()
        .await;
    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;

    rig.backend.w4.answer(
        "w9_readers",
        Value::Array(vec![reader(ANN, "ann", "2026-09-22T18:05:00Z")]),
    );
    let seen = rig.core.seen_by(channel(), "m1".into());
    assert_eq!(seen.state, LoadState::Loading);
    rig.core.run_until_idle().await;
    let seen: SeenByView = rig.core.seen_by(channel(), "m1".into());
    assert_eq!(seen.message_id, "m1", "the answer names its message");
    assert_eq!(seen.state, LoadState::Ready);
    assert_eq!(seen.count, 1);
    assert_eq!(seen.readers[0].username, "ann");
    // The call names the channel, and no DM.
    assert_eq!(
        rig.backend.w4.calls().last().unwrap(),
        "w9_readers m1 chan "
    );
}

#[tokio::test]
async fn more_counts_the_readers_past_the_names() {
    let rig = Rig::new();
    let rig = rig
        .open_channel(vec![message("m1", ME, "hello")])
        .await
        .signed_in()
        .await;
    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;
    let rows: Vec<Value> = (0..20)
        .map(|index| {
            reader(
                &format!("u{index}"),
                &format!("user{index}"),
                "2026-09-22T18:05:00Z",
            )
        })
        .collect();
    rig.backend.w4.answer("w9_readers", Value::Array(rows));
    rig.core.seen_by(channel(), "m1".into());
    rig.core.run_until_idle().await;
    let seen = rig.core.seen_by(channel(), "m1".into());
    assert_eq!(seen.count, 20);
    assert_eq!(seen.readers.len(), 15, "the web's tooltip names 15");
    assert_eq!(seen.more, 5);
}

#[tokio::test]
async fn a_failed_readers_read_is_failed_until_retried() {
    let rig = Rig::new();
    let rig = rig
        .open_channel(vec![message("m1", ME, "hello")])
        .await
        .signed_in()
        .await;
    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;
    rig.backend
        .w4
        .fail_next("w9_readers", error(500, "INTERNAL"));
    rig.core.seen_by(channel(), "m1".into());
    rig.core.run_until_idle().await;
    assert!(matches!(
        rig.core.seen_by(channel(), "m1".into()).state,
        LoadState::Failed { .. }
    ));
    rig.backend.w4.answer(
        "w9_readers",
        Value::Array(vec![reader(ANN, "ann", "2026-09-22T18:05:00Z")]),
    );
    rig.core.retry_failed();
    rig.core.seen_by(channel(), "m1".into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.core.seen_by(channel(), "m1".into()).state,
        LoadState::Ready
    );
}

#[tokio::test]
async fn a_thread_has_no_readers_and_asks_nothing() {
    let rig = Rig::new();
    let seen = rig.core.seen_by(
        Conversation::Thread {
            parent_message_id: "p1".into(),
        },
        "r1".into(),
    );
    assert_eq!(seen.state, LoadState::Ready);
    assert!(seen.readers.is_empty());
    assert_eq!(rig.backend.w4.count("w9_readers"), 0);
    assert_eq!(rig.backend.w4.count("w9_peer_reads"), 0);
}
