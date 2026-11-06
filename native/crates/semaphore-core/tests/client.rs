//! Core as a UI sees it: commands in, `CoreEvent`s out, with the network faked.

mod common;

use common::*;
use semaphore_core::Core;
use semaphore_core::cache::{QueryKey, keys};
use semaphore_core::lifecycle::{ConnectionState, NetworkState, ResyncPlan};
use semaphore_core::model::{
    ChannelKind, Conversation, ListOp, MessageDraft, SendState, SessionState, ViewKey,
};
use semaphore_core::platform::{CoreError, CoreEvent, EventSink};
use semaphore_core::realtime::{RealtimeError, RealtimeEvent};
use semaphore_core::store::MAX_ROWS;
use serde_json::json;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

fn draft(text: &str) -> MessageDraft {
    MessageDraft {
        text: text.into(),
        ..MessageDraft::default()
    }
}

fn page_requests(rig: &Rig) -> u64 {
    rig.backend.page_requests.load(Ordering::SeqCst)
}

// --- Lifecycle ---

#[tokio::test]
async fn resumed_means_no_gap_and_nothing_is_refetched() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 3))
        .await;
    rig.core.run_until_idle().await;
    let requests = page_requests(&rig);
    let unread = keys::op(keys::UNREAD);
    rig.sync();

    rig.core.suspend();
    let plan = rig.core.resume();
    assert!(plan.reconnect_socket);
    assert_eq!(rig.realtime.calls().last().unwrap(), "resume(false)");

    rig.core.ingest(RealtimeEvent::Resumed);
    let events = rig.settle().await;

    assert_eq!(rig.core.connection(), ConnectionState::Connected);
    assert_eq!(page_requests(&rig), requests);
    assert_eq!(rig.core.query_state(&unread), Some(false));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, CoreEvent::QueriesInvalidated { .. }))
    );
}

#[tokio::test]
async fn a_new_connection_after_resume_is_a_gap_and_resyncs() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 3))
        .await;
    rig.core.run_until_idle().await;
    let requests = page_requests(&rig);
    let unread_requests = rig.backend.unread_requests.load(Ordering::SeqCst);
    rig.sync();

    rig.core.suspend();
    rig.core.resume();
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    let events = rig.settle().await;

    assert!(page_requests(&rig) > requests);
    assert!(rig.backend.unread_requests.load(Ordering::SeqCst) > unread_requests);
    let invalidated: Vec<&QueryKey> = events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::QueriesInvalidated { keys } => Some(keys.iter()),
            _ => None,
        })
        .flatten()
        .collect();
    assert!(invalidated.contains(&&keys::op(keys::UNREAD)));
    assert!(invalidated.contains(&&keys::scoped(keys::CHANNEL_MESSAGES, CHANNEL)));
}

#[tokio::test]
async fn the_first_connection_is_not_a_gap() {
    let rig = Rig::new().signed_in().await;
    let invalidated = rig.events.take();
    assert!(
        !invalidated
            .iter()
            .any(|event| matches!(event, CoreEvent::QueriesInvalidated { .. }))
    );
}

#[tokio::test]
async fn resume_finds_a_token_that_expired_while_suspended() {
    let rig = Rig::new();
    rig.core.set_token_expiry(1_000_000 + 3_600_000);
    rig.core.suspend();
    // Nothing ran for two hours, so no tokenExpiring event was ever seen.
    rig.clock.advance(7_200_000);
    assert!(rig.core.resume().refresh_token);
    assert_eq!(rig.realtime.calls().last().unwrap(), "resume(true)");
}

#[tokio::test]
async fn resume_leaves_a_token_with_time_left_alone() {
    let rig = Rig::new();
    rig.core.set_token_expiry(1_000_000 + 3_600_000);
    rig.core.suspend();
    assert!(!rig.core.resume().refresh_token);
}

#[tokio::test]
async fn resume_without_suspend_does_nothing() {
    let rig = Rig::new();
    rig.core.ingest(connected());
    assert_eq!(rig.core.resume(), ResyncPlan::default());
    assert_eq!(rig.core.connection(), ConnectionState::Connected);
}

#[tokio::test]
async fn a_second_resume_does_not_ask_again() {
    let rig = Rig::new();
    rig.core.suspend();
    assert!(rig.core.resume().reconnect_socket);
    assert_eq!(rig.core.resume(), ResyncPlan::default());
}

#[tokio::test]
async fn network_lost_while_suspended_waits_for_the_network_before_reconnecting() {
    let rig = Rig::new();
    rig.core.suspend();
    assert_eq!(
        rig.core.network_changed(NetworkState::Unavailable),
        ResyncPlan::default()
    );
    assert_eq!(rig.core.connection(), ConnectionState::Suspended);

    assert!(!rig.core.resume().reconnect_socket);
    assert_eq!(rig.core.connection(), ConnectionState::Offline);

    assert!(
        rig.core
            .network_changed(NetworkState::Available)
            .reconnect_socket
    );
    assert_eq!(rig.core.connection(), ConnectionState::Disconnected);
    assert_eq!(rig.realtime.calls().last().unwrap(), "resume(false)");
}

#[tokio::test]
async fn network_back_while_suspended_lets_resume_reconnect() {
    let rig = Rig::new();
    rig.core.network_changed(NetworkState::Unavailable);
    rig.core.suspend();
    rig.core.network_changed(NetworkState::Available);
    assert!(rig.core.resume().reconnect_socket);
}

#[tokio::test]
async fn a_network_change_replaces_a_live_socket() {
    let rig = Rig::new();
    rig.core.ingest(connected());
    rig.core.network_changed(NetworkState::Available);
    assert_eq!(rig.realtime.calls(), vec!["restart_transport"]);
}

#[tokio::test]
async fn a_socket_drop_during_suspend_changes_nothing() {
    let rig = Rig::new();
    rig.core.ingest(connected());
    rig.core.suspend();
    rig.core.ingest(dropped());
    assert_eq!(rig.core.connection(), ConnectionState::Suspended);
}

#[tokio::test]
async fn connection_events_fire_once_per_change() {
    let rig = Rig::new();
    rig.core.suspend();
    rig.core.suspend();
    let changes = rig
        .events
        .take()
        .iter()
        .filter(|event| matches!(event, CoreEvent::ConnectionChanged { .. }))
        .count();
    assert_eq!(changes, 1);
}

// --- Loading ---

#[tokio::test]
async fn open_sends_rows_oldest_first_with_ascending_seqs() {
    let rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 3))
        .await;
    assert_eq!(rig.ids(), ["m-0", "m-1", "m-2"]);
    assert!(rig.rows.windows(2).all(|pair| pair[0].seq < pair[1].seq));
    assert_eq!(rig.rows[0].display, "m 0");
}

#[tokio::test]
async fn load_older_inserts_at_the_top_and_keeps_seqs_then_stops_at_the_start() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 30))
        .await;
    assert_eq!(rig.rows.len(), 25);
    let seq_of_newest = rig.row("m-29").seq;

    rig.core.load_older(channel()).await.unwrap();
    let events = rig.sync();

    assert!(matches!(
        ops_of(&events)[0][0],
        ListOp::Insert { index: 0, .. }
    ));
    assert_eq!(rig.rows.len(), 30);
    assert_eq!(rig.ids()[0], "m-0");
    assert_eq!(rig.row("m-29").seq, seq_of_newest);
    assert!(rig.rows.windows(2).all(|pair| pair[0].seq < pair[1].seq));

    let requests = page_requests(&rig);
    rig.core.load_older(channel()).await.unwrap();
    assert_eq!(page_requests(&rig), requests);
}

#[tokio::test]
async fn a_load_failure_reaches_the_caller() {
    let rig = Rig::new();
    let error = Core::new(rig.clock.clone(), rig.events.clone())
        .open_conversation(channel())
        .await;
    assert!(matches!(error, Err(CoreError::Unavailable { .. })));
}

#[tokio::test]
async fn a_thread_reads_to_its_end_and_has_nothing_older() {
    let rig = Rig::new().signed_in().await;
    let thread = Conversation::Thread {
        parent_message_id: "parent".into(),
    };
    // Replies come oldest first.
    let replies = (0..60)
        .map(|n| message(&format!("r-{n}"), "someone", "reply"))
        .collect();
    rig.backend
        .thread_replies
        .lock()
        .unwrap()
        .insert("parent".into(), replies);
    rig.core.open_conversation(thread.clone()).await.unwrap();
    let events = rig.events.take();
    let CoreEvent::MessagesChanged { ops, .. } = events
        .iter()
        .find(|event| matches!(event, CoreEvent::MessagesChanged { .. }))
        .unwrap()
    else {
        unreachable!()
    };
    let ListOp::Reset { rows } = &ops[0] else {
        panic!("{ops:?}")
    };
    assert_eq!(rows.len(), 60);
    assert_eq!(rows[0].id.as_deref(), Some("r-0"));
    assert_eq!(rows[59].id.as_deref(), Some("r-59"));

    rig.core.ingest(event(
        "newThreadReply",
        json!({ "parentMessageId": "parent", "reply": message_json("r-60", "someone", "late") }),
    ));
    let events = rig.events.take();
    assert!(matches!(
        ops_of(&events)[0][0],
        ListOp::Insert { index: 60, .. }
    ));
    rig.core.load_older(thread).await.unwrap();
    assert!(rig.events.take().is_empty());
}

// --- Reducers ---

#[tokio::test]
async fn a_new_message_appends_with_a_higher_seq_and_a_duplicate_changes_nothing() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 2))
        .await;
    rig.core.ingest(new_message("n", "someone", "hello"));
    rig.sync();
    assert_eq!(rig.ids(), ["m-0", "m-1", "n"]);
    assert!(rig.row("n").seq > rig.row("m-1").seq);

    rig.core.ingest(new_message("n", "someone", "hello"));
    let replaced = ops_of(&rig.sync());
    // The echo path merges, so the row is re-sent, but no second row appears.
    assert!(
        replaced
            .iter()
            .flatten()
            .all(|op| matches!(op, ListOp::Replace { .. }))
    );
    assert_eq!(rig.rows.len(), 3);
}

#[tokio::test]
async fn unknown_events_are_ignored() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 2))
        .await;
    rig.core.run_until_idle().await;
    rig.sync();
    rig.core
        .ingest(event("someFutureEvent", json!({ "anything": true })));
    assert!(rig.settle().await.is_empty());
}

#[tokio::test]
async fn a_malformed_event_invalidates_what_it_would_have_changed() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 2))
        .await;
    rig.core.run_until_idle().await;
    rig.sync();
    let requests = page_requests(&rig);
    let unread = rig.backend.unread_requests.load(Ordering::SeqCst);

    // A real id, but `spans` isn't a list.
    let mut bad = message_json("x", "someone", "x");
    bad["spans"] = json!(7);
    rig.core.ingest(event(
        "newMessage",
        json!({ "channelId": CHANNEL, "message": bad }),
    ));
    let events = rig.settle().await;

    assert!(
        events
            .iter()
            .any(|event| matches!(event, CoreEvent::QueriesInvalidated { .. }))
    );
    assert!(page_requests(&rig) > requests, "the window refetched");
    assert!(
        rig.backend.unread_requests.load(Ordering::SeqCst) > unread,
        "unread counts refetched"
    );
    assert_eq!(rig.rows.len(), 2);
}

#[tokio::test]
async fn delete_removes_and_edit_replaces_and_removed_rows_are_blank() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 3))
        .await;
    rig.core.ingest(event(
        "deleteMessage",
        json!({ "messageId": "m-1", "channelId": CHANNEL, "directMessageGroupId": null }),
    ));
    rig.sync();
    assert_eq!(rig.ids(), ["m-0", "m-2"]);

    let before = rig.row("m-2").revision;
    let mut edited = message_json("m-2", "someone", "edited");
    edited["editedAt"] = json!("2026-09-22T18:01:00.000Z");
    rig.core
        .ingest(event("updateMessage", json!({ "message": edited })));
    rig.sync();
    assert_eq!(rig.row("m-2").display, "edited");
    assert!(rig.row("m-2").edited);
    assert!(rig.row("m-2").revision > before);

    let mut gone = message_json("m-0", "someone", "secret");
    gone["deletedAt"] = json!("2026-09-22T18:01:00.000Z");
    rig.core
        .ingest(event("updateMessage", json!({ "message": gone })));
    rig.sync();
    assert!(rig.row("m-0").removed);
    assert_eq!(rig.row("m-0").display, "");
}

#[tokio::test]
async fn reactions_pins_and_reply_counts_update_the_row() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    let id = "m-0";
    let context = json!({ "messageId": id, "channelId": CHANNEL, "directMessageGroupId": null, "parentMessageId": null });
    let mut added = context.clone();
    added["reaction"] = json!({ "emoji": "x", "userIds": ["me", "ava"] });
    rig.core.ingest(event("reactionAdded", added));
    rig.sync();
    let reaction = &rig.row(id).reactions[0];
    assert_eq!((reaction.count, reaction.me), (2, true));

    let mut removed = context.clone();
    removed["emoji"] = json!("x");
    removed["reactions"] = json!([]);
    rig.core.ingest(event("reactionRemoved", removed));
    rig.sync();
    assert!(rig.row(id).reactions.is_empty());

    rig.core.ingest(event(
        "threadReplyCountUpdated",
        json!({ "parentMessageId": id, "replyCount": 4, "lastReplyAt": null, "channelId": CHANNEL, "directMessageGroupId": null }),
    ));
    rig.sync();
    assert_eq!(rig.row(id).reply_count, 4);
}

#[tokio::test]
async fn a_burst_in_one_batch_is_one_coalesced_change() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 3))
        .await;
    let mut burst = Vec::new();
    for n in 0..100 {
        burst.push(event(
            "reactionAdded",
            json!({
                "messageId": "m-1", "channelId": CHANNEL, "directMessageGroupId": null, "parentMessageId": null,
                "reaction": { "emoji": "x", "userIds": vec!["u"; n + 1] },
            }),
        ));
    }
    burst.push(new_message("n1", "someone", "a"));
    burst.push(new_message("n2", "someone", "b"));
    burst.push(new_message("n3", "someone", "c"));
    // Added and gone in the same batch: the UI never needs to hear of it.
    burst.push(event(
        "deleteMessage",
        json!({ "messageId": "n3", "channelId": CHANNEL, "directMessageGroupId": null }),
    ));
    rig.core.ingest_batch(burst);
    let events = rig.sync();

    let ops = ops_of(&events);
    assert_eq!(ops.len(), 1, "one MessagesChanged");
    assert_eq!(ops[0].len(), 2, "{:?}", ops[0]);
    assert!(matches!(&ops[0][0], ListOp::Replace { index: 1, rows } if rows.len() == 1));
    assert!(matches!(&ops[0][1], ListOp::Insert { index: 3, rows } if rows.len() == 2));
    assert_eq!(rig.ids(), ["m-0", "m-1", "m-2", "n1", "n2"]);
    assert_eq!(rig.row("m-1").reactions[0].count, 100);
}

#[tokio::test]
async fn an_event_during_a_fetch_is_not_lost_or_undone_by_its_older_answer() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.set_messages(history("m", 3));
    let (release, gate) = tokio::sync::oneshot::channel();
    *rig.backend.gate.lock().unwrap() = Some(gate);

    let core = rig.core.clone();
    let open = tokio::spawn(async move { core.open_conversation(channel()).await });
    // Runs the request to the gate: it took its snapshot, and waits.
    while rig.backend.page_requests.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    rig.core.ingest(new_message("during", "someone", "new"));
    rig.core.ingest(event(
        "deleteMessage",
        json!({ "messageId": "m-1", "channelId": CHANNEL, "directMessageGroupId": null }),
    ));
    release.send(()).unwrap();
    open.await.unwrap().unwrap();
    rig.sync();

    assert_eq!(rig.ids(), ["m-0", "m-2", "during"]);
}

// --- The query cache ---

fn voice_channel(id: &str) -> serde_json::Value {
    json!({
        "id": id, "name": id, "communityId": "comm", "type": "VOICE", "position": 1,
        "slowmodeSeconds": 0, "preset": "PUBLIC", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

fn text_channel(id: &str, position: i64) -> serde_json::Value {
    let mut channel = voice_channel(id);
    channel["type"] = json!("TEXT");
    channel["position"] = json!(position);
    channel
}

fn presence_user(id: &str) -> serde_json::Value {
    json!({
        "id": id, "username": id, "joinedAt": "2026-09-22T18:00:00.000Z",
        "isDeafened": false, "isServerMuted": false,
    })
}

#[tokio::test]
async fn reads_fetch_what_they_lack_and_say_when_to_read_again() {
    let rig = Rig::new().signed_in().await;
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(text_channel("b", 2));
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(text_channel("a", 1));
    rig.backend
        .unread
        .lock()
        .unwrap()
        .push(json!({ "channelId": "a", "unreadCount": 3, "mentionCount": 1 }));
    rig.core.invalidate(&keys::op(keys::UNREAD));

    assert!(rig.core.channels("comm2".into()).is_empty());
    rig.core.run_until_idle().await;
    let events = rig.events.take();
    assert!(events.contains(&CoreEvent::ViewChanged {
        view: ViewKey::Channels {
            community_id: "comm2".into()
        }
    }));

    let channels = rig.core.channels("comm2".into());
    assert_eq!(channels[0].id, "a");
    assert_eq!(channels[0].unread_count, 3);
    assert_eq!(channels[0].kind, ChannelKind::Text);
}

#[tokio::test]
async fn a_structural_event_refetches_the_cached_query() {
    let rig = Rig::new().signed_in().await;
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;
    let before = rig.backend.channel_requests.load(Ordering::SeqCst);

    rig.core.ingest(event(
        "channelCreated",
        json!({ "communityId": "comm", "channelId": "new", "channel": text_channel("new", 3) }),
    ));
    let events = rig.events.take();
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::QueriesInvalidated { keys } if keys.contains(&keys::scoped(keys::CHANNELS, "comm"))
    )));
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.channel_requests.load(Ordering::SeqCst),
        before + 1
    );
}

#[tokio::test]
async fn voice_presence_updates_directly_when_warm_and_refetches_when_cold() {
    let rig = Rig::new();
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(voice_channel("v"));
    let rig = rig.signed_in().await;
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;
    let presence = rig.backend.presence_requests.load(Ordering::SeqCst);
    assert_eq!(presence, 1);

    // Warm: this channel's presence is cached.
    rig.core.ingest(event(
        "voiceChannelUserJoined",
        json!({ "channelId": "v", "user": presence_user("ava") }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.presence_requests.load(Ordering::SeqCst),
        presence
    );
    assert_eq!(rig.core.channels("comm".into())[0].voice_users[0].id, "ava");

    rig.core.ingest(event(
        "voiceChannelUserLeft",
        json!({ "channelId": "v", "userId": "ava", "user": presence_user("ava") }),
    ));
    assert!(rig.core.channels("comm".into())[0].voice_users.is_empty());

    // Cold: some other channel's isn't, so everything voice is refetched.
    rig.core.ingest(event(
        "voiceChannelUserJoined",
        json!({ "channelId": "other", "user": presence_user("ava") }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.presence_requests.load(Ordering::SeqCst),
        presence + 1
    );
}

fn unread_of(rig: &Rig, channel_id: &str) -> u32 {
    rig.core
        .channels("comm".into())
        .iter()
        .find(|channel| channel.id == channel_id)
        .map_or(0, |channel| channel.unread_count)
}

#[tokio::test]
async fn unread_counts_follow_the_web_rules() {
    let rig = Rig::new();
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(text_channel(CHANNEL, 1));
    rig.backend
        .unread
        .lock()
        .unwrap()
        .push(json!({ "channelId": CHANNEL, "unreadCount": 0, "mentionCount": 0 }));
    let mut rig = rig.signed_in().await.open_channel(history("m", 1)).await;
    rig.core.channels("comm".into());
    rig.core.run_until_idle().await;

    // Viewing it, focused: no bump, it'd only flash.
    rig.core.ingest(new_message("a", "someone", "x"));
    assert_eq!(unread_of(&rig, CHANNEL), 0);

    // Not focused: it counts.
    rig.core.set_focused(false);
    rig.core.ingest(new_message("b", "someone", "x"));
    assert_eq!(unread_of(&rig, CHANNEL), 1);

    // My own messages never count.
    rig.core.ingest(new_message("c", ME, "x"));
    assert_eq!(unread_of(&rig, CHANNEL), 1);

    // A peer's read mark says nothing about mine.
    let read_at = "2026-09-22T18:01:00.000Z";
    rig.core.ingest(event("readReceiptUpdated", json!({
        "channelId": CHANNEL, "directMessageGroupId": null, "lastReadMessageId": "b", "lastReadAt": read_at, "userId": "ava",
    })));
    assert_eq!(unread_of(&rig, CHANNEL), 1);

    rig.core.ingest(event("readReceiptUpdated", json!({
        "channelId": CHANNEL, "directMessageGroupId": null, "lastReadMessageId": "b", "lastReadAt": read_at,
    })));
    assert_eq!(unread_of(&rig, CHANNEL), 0);
    rig.sync();
}

#[tokio::test]
async fn an_author_arrives_after_their_row_and_the_row_is_sent_again() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    assert_eq!(rig.rows[0].author.id, "someone");
    assert_eq!(rig.rows[0].author.username, "");
    rig.settle().await;
    assert_eq!(rig.rows[0].author.username, "someone");
    assert_eq!(rig.backend.user_requests.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn mentions_offer_specials_members_and_channels() {
    let rig = Rig::new().signed_in().await;
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(text_channel("general", 1));
    assert_eq!(
        rig.core.mention_candidates("comm".into(), "@he".into())[0].insert_text,
        "@here"
    );
    rig.core.run_until_idle().await;
    let found = rig.core.mention_candidates("comm".into(), "@he".into());
    assert!(
        found
            .iter()
            .any(|candidate| candidate.insert_text == "@ava")
    );

    assert!(
        rig.core
            .mention_candidates("comm".into(), "#gen".into())
            .is_empty()
    );
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.core.mention_candidates("comm".into(), "#gen".into())[0].insert_text,
        "#general"
    );
}

// --- Sending ---

async fn send(rig: &mut Rig, text: &str) -> String {
    let nonce = rig.core.send_message(channel(), draft(text)).await.unwrap();
    rig.sync();
    nonce
}

#[tokio::test]
async fn a_send_adds_a_pending_row_at_once() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    let nonce = send(&mut rig, "hi").await;
    let row = rig.rows.last().unwrap();
    assert_eq!(row.send_state, SendState::Pending);
    assert_eq!(row.id, None);
    assert_eq!(row.client_nonce.as_deref(), Some(nonce.as_str()));
    assert_eq!(row.author.id, ME);
    assert_eq!(row.display, "hi");
    assert!(uuid::Uuid::parse_str(&nonce).is_ok());
}

#[tokio::test]
async fn the_ack_settles_first_then_the_echo_only_enriches() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack_ok("real");
    let nonce = send(&mut rig, "hi").await;
    let seq = rig.rows.last().unwrap().seq;

    rig.settle().await;
    let row = rig.row("real");
    assert_eq!(row.send_state, SendState::Sent);
    assert_eq!(row.seq, seq);
    assert_eq!(rig.rows.len(), 2);

    let (event_name, payload) = rig.realtime.sent.lock().unwrap()[0].clone();
    assert_eq!(event_name, "sendMessage");
    assert_eq!(payload["clientNonce"], json!(nonce));
    assert_eq!(payload["channelId"], json!(CHANNEL));

    rig.core.ingest(echo("real", &nonce, "hi"));
    rig.sync();
    assert_eq!(rig.rows.len(), 2);
    assert_eq!(rig.row("real").seq, seq);
}

#[tokio::test]
async fn the_echo_settles_first_then_the_ack_changes_nothing() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    let release = rig.realtime.ack_later();
    let nonce = send(&mut rig, "hi").await;
    let seq = rig.rows.last().unwrap().seq;

    let core = rig.core.clone();
    let driver = tokio::spawn(async move { core.run_until_idle().await });
    while rig.realtime.sent.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }

    rig.core.ingest(echo("real", &nonce, "hi"));
    rig.sync();
    assert_eq!(rig.row("real").send_state, SendState::Sent);
    assert_eq!(rig.row("real").seq, seq);
    assert_eq!(rig.rows.len(), 2);

    // The ack, late. A failure here must not flip a real message back: nothing changes either way.
    release.send(Err(RealtimeError::AckTimedOut)).unwrap();
    driver.await.unwrap();
    rig.sync();
    assert_eq!(rig.row("real").send_state, SendState::Sent);
    assert_eq!(rig.rows.len(), 2);
}

#[tokio::test]
async fn a_timeout_fails_the_row_and_retry_reuses_the_nonce_and_the_row() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Err(RealtimeError::AckTimedOut)));
    let nonce = send(&mut rig, "hi").await;
    let seq = rig.rows.last().unwrap().seq;

    rig.settle().await;
    let SendState::Failed { error } = &rig.rows.last().unwrap().send_state else {
        panic!("{:?}", rig.rows.last().unwrap().send_state);
    };
    assert!(error.retryable);
    assert_eq!(rig.rows.last().unwrap().seq, seq);

    rig.realtime.ack_ok("real");
    rig.core.retry_send(nonce.clone()).await.unwrap();
    rig.sync();
    assert_eq!(rig.rows.last().unwrap().send_state, SendState::Pending);

    rig.settle().await;
    assert_eq!(rig.realtime.sent_nonces(), vec![nonce.clone(), nonce]);
    assert_eq!(rig.row("real").seq, seq);
    assert_eq!(rig.rows.len(), 2);
}

#[tokio::test]
async fn a_late_echo_settles_a_failed_row_and_leaves_nothing_to_retry() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Err(RealtimeError::AckTimedOut)));
    let nonce = send(&mut rig, "hi").await;
    rig.settle().await;

    rig.core.ingest(echo("real", &nonce, "hi"));
    rig.sync();
    assert_eq!(rig.row("real").send_state, SendState::Sent);

    rig.core.retry_send(nonce).await.unwrap();
    rig.settle().await;
    assert_eq!(rig.realtime.sent.lock().unwrap().len(), 1, "no second send");
}

#[tokio::test]
async fn a_retry_while_one_is_in_flight_does_nothing() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    let release = rig.realtime.ack_later();
    let nonce = send(&mut rig, "hi").await;

    let core = rig.core.clone();
    let driver = tokio::spawn(async move { core.run_until_idle().await });
    while rig.realtime.sent.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }
    rig.core.retry_send(nonce).await.unwrap();
    release
        .send(Ok(vec![json!({ "ok": true, "messageId": "real" })]))
        .unwrap();
    driver.await.unwrap();
    rig.settle().await;
    assert_eq!(rig.realtime.sent.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_refusal_shows_the_servers_verdict() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Ok(vec![json!({
        "ok": false,
        "error": { "errorCode": "SLOWMODE_ACTIVE", "message": "Slow down", "retryable": true, "retryAfterMs": 4000 },
    })])));
    send(&mut rig, "hi").await;
    rig.settle().await;
    let SendState::Failed { error } = &rig.rows.last().unwrap().send_state else {
        panic!()
    };
    assert_eq!(error.code, "SLOWMODE_ACTIVE");
    assert_eq!(error.message, "Slow down");
    assert_eq!(error.retry_after_ms, Some(4000));
}

#[tokio::test]
async fn generic_refusals_are_reworded() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Ok(vec![json!({
        "ok": false,
        "error": { "errorCode": "FORBIDDEN", "message": "Missing CREATE_MESSAGE", "retryable": false },
    })])));
    send(&mut rig, "hi").await;
    rig.settle().await;
    let SendState::Failed { error } = &rig.rows.last().unwrap().send_state else {
        panic!()
    };
    assert_eq!(error.message, "You can't send messages here");
    assert!(!error.retryable);
}

#[tokio::test]
async fn deleted_while_sending_drops_the_row() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Ok(vec![json!({
        "ok": false,
        "error": { "errorCode": "MESSAGE_DELETED", "message": "gone", "retryable": false },
    })])));
    send(&mut rig, "hi").await;
    rig.settle().await;
    assert_eq!(rig.ids(), ["m-0"]);
}

#[tokio::test]
async fn an_older_servers_plain_id_ack_settles_too() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Ok(vec![json!("real")])));
    send(&mut rig, "hi").await;
    rig.settle().await;
    assert_eq!(rig.row("real").send_state, SendState::Sent);
}

#[tokio::test]
async fn an_echo_with_no_nonce_stays_separate_until_the_ack_removes_the_placeholder() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    let release = rig.realtime.ack_later();
    send(&mut rig, "same text").await;

    let core = rig.core.clone();
    let driver = tokio::spawn(async move { core.run_until_idle().await });
    while rig.realtime.sent.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }
    rig.core.ingest(new_message("real", ME, "same text"));
    rig.sync();
    assert_eq!(rig.rows.len(), 3, "never matched by content");

    release
        .send(Ok(vec![json!({ "ok": true, "messageId": "real" })]))
        .unwrap();
    driver.await.unwrap();
    rig.sync();
    assert_eq!(rig.ids(), ["m-0", "real"]);
}

#[tokio::test]
async fn two_sends_reach_the_transport_in_order() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack_ok("r1");
    rig.realtime.ack_ok("r2");
    let first = send(&mut rig, "one").await;
    let second = send(&mut rig, "two").await;
    rig.settle().await;
    assert_eq!(rig.realtime.sent_nonces(), vec![first, second]);
    assert_eq!(rig.ids(), ["m-0", "r1", "r2"]);
}

#[tokio::test]
async fn a_send_waits_for_the_socket_then_goes() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.core.ingest(dropped());
    let nonce = send(&mut rig, "hi").await;
    rig.settle().await;
    assert!(rig.realtime.sent.lock().unwrap().is_empty());
    assert_eq!(rig.rows.last().unwrap().send_state, SendState::Pending);

    rig.realtime.ack_ok("real");
    rig.core.ingest(connected());
    rig.settle().await;
    assert_eq!(rig.realtime.sent_nonces(), vec![nonce]);
    assert_eq!(rig.row("real").send_state, SendState::Sent);
}

#[tokio::test]
async fn a_send_stops_waiting_after_the_webs_five_seconds() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.core.ingest(dropped());
    send(&mut rig, "hi").await;
    rig.settle().await;

    rig.core.ingest(RealtimeEvent::ConnectError {
        message: "no".into(),
    });
    rig.sync();
    assert_eq!(
        rig.rows.last().unwrap().send_state,
        SendState::Pending,
        "not yet"
    );

    rig.clock.advance(5_000);
    rig.core.ingest(RealtimeEvent::ConnectError {
        message: "no".into(),
    });
    rig.sync();
    assert!(matches!(
        rig.rows.last().unwrap().send_state,
        SendState::Failed { .. }
    ));
}

#[tokio::test]
async fn a_send_fails_at_once_when_the_network_is_gone() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.core.ingest(dropped());
    send(&mut rig, "parked").await;
    rig.settle().await;
    rig.core.network_changed(NetworkState::Unavailable);
    rig.sync();
    assert!(matches!(
        rig.rows.last().unwrap().send_state,
        SendState::Failed { .. }
    ));

    send(&mut rig, "offline").await;
    rig.settle().await;
    assert!(matches!(
        rig.rows.last().unwrap().send_state,
        SendState::Failed { .. }
    ));
}

#[tokio::test]
async fn sending_needs_services() {
    let rig = Rig::new();
    let core = Core::new(rig.clock.clone(), rig.events.clone());
    let result = core.send_message(channel(), draft("hi")).await;
    assert!(matches!(result, Err(CoreError::Unavailable { .. })));
}

#[tokio::test]
async fn a_pending_ids_read_mark_is_never_sent() {
    let rig = Rig::new().signed_in().await;
    rig.core
        .mark_read(channel(), "pending-x".into())
        .await
        .unwrap();
    assert!(rig.realtime.emitted.lock().unwrap().is_empty());
    rig.core.mark_read(channel(), "m-1".into()).await.unwrap();
    let emitted = rig.realtime.emitted.lock().unwrap().clone();
    assert_eq!(emitted[0].0, "markAsRead");
    assert_eq!(
        emitted[0].1,
        json!({ "lastReadMessageId": "m-1", "channelId": CHANNEL })
    );
}

// --- Windows, holds and eviction ---

/// Loads pages until the window is over the cap, or would be.
async fn load_pages(rig: &mut Rig, pages: usize) {
    for _ in 0..pages {
        rig.core.load_older(channel()).await.unwrap();
    }
    rig.sync();
}

#[tokio::test]
async fn deep_scrollback_evicts_the_newest_and_detaches_from_the_live_edge() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", MAX_ROWS + 100))
        .await;
    load_pages(&mut rig, 40).await;
    assert_eq!(rig.rows.len(), MAX_ROWS);
    assert!(
        rig.ids()
            .iter()
            .all(|id| id != &format!("m-{}", MAX_ROWS + 99)),
        "the newest went"
    );

    // Not inserted, because it isn't next to what's loaded. The unread bump is the only sign.
    rig.core.ingest(new_message("live", "someone", "x"));
    rig.sync();
    assert!(!rig.ids().contains(&"live".to_string()));
}

#[tokio::test]
async fn a_hold_stops_eviction_until_it_is_released() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", MAX_ROWS + 100))
        .await;
    let span = (rig.rows[0].seq, rig.rows[1].seq);
    rig.core.hold_rows(channel(), Some(span));
    load_pages(&mut rig, 40).await;
    assert!(rig.rows.len() > MAX_ROWS);
    let newest = format!("m-{}", MAX_ROWS + 99);
    assert!(rig.ids().contains(&newest), "nothing went");

    rig.core.hold_rows(channel(), None);
    rig.sync();
    assert_eq!(rig.rows.len(), MAX_ROWS);
    assert!(!rig.ids().contains(&newest));
}

#[tokio::test]
async fn live_rows_past_the_cap_evict_the_oldest_and_it_can_be_loaded_again() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", MAX_ROWS))
        .await;
    load_pages(&mut rig, 40).await;
    assert_eq!(rig.rows.len(), MAX_ROWS);
    assert_eq!(rig.ids()[0], "m-0");

    rig.core.ingest(new_message("live", "someone", "x"));
    rig.sync();
    assert_eq!(rig.rows.len(), MAX_ROWS);
    assert_eq!(rig.ids()[0], "m-1");

    rig.core.load_older(channel()).await.unwrap();
    rig.sync();
    assert_eq!(rig.ids().iter().filter(|id| *id == "m-0").count(), 1);
    assert!(rig.ids().contains(&"m-0".to_string()));
}

#[tokio::test]
async fn my_own_echo_while_detached_returns_to_the_live_edge() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", MAX_ROWS + 100))
        .await;
    load_pages(&mut rig, 40).await;
    let mut rows = history("m", MAX_ROWS + 100);
    rows.insert(0, message("mine", ME, "x"));
    rig.backend.set_messages(rows);

    rig.core.ingest(new_message("mine", ME, "x"));
    let events = rig.settle().await;
    assert!(
        ops_of(&events)
            .iter()
            .flatten()
            .any(|op| matches!(op, ListOp::Reset { .. }))
    );
    assert_eq!(rig.ids().last().unwrap(), "mine");
    assert_eq!(rig.rows.len(), 25);
}

// --- Resync ---

#[tokio::test]
async fn a_gap_merges_missed_rows_keeping_every_surviving_seq() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 5))
        .await;
    rig.settle().await;
    let seqs: Vec<(String, i64)> = rig
        .rows
        .iter()
        .map(|row| (row.id.clone().unwrap(), row.seq))
        .collect();
    rig.core.ingest(dropped());

    // During the gap m-2 was deleted, m-3 edited, and two arrived.
    let mut rows = vec![message("n2", "someone", "b"), message("n1", "someone", "a")];
    rows.extend(history("m", 5).into_iter().filter(|row| row.id != "m-2"));
    let edited = rows.iter_mut().find(|row| row.id == "m-3").unwrap();
    *edited = message("m-3", "someone", "edited");
    rig.backend.set_messages(rows);

    rig.core.ingest(connected());
    let events = rig.settle().await;
    assert!(
        ops_of(&events)
            .iter()
            .flatten()
            .all(|op| !matches!(op, ListOp::Reset { .. }))
    );
    assert_eq!(rig.ids(), ["m-0", "m-1", "m-3", "m-4", "n1", "n2"]);
    assert_eq!(rig.row("m-3").display, "edited");
    for (id, seq) in seqs.iter().filter(|(id, _)| id != "m-2") {
        assert_eq!(rig.row(id).seq, *seq, "{id}");
    }
    assert!(rig.rows.windows(2).all(|pair| pair[0].seq < pair[1].seq));
}

#[tokio::test]
async fn missed_rows_go_before_a_row_still_being_sent() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 2))
        .await;
    rig.settle().await;
    rig.core.ingest(dropped());
    send(&mut rig, "mine").await;
    rig.settle().await;

    let mut rows = vec![message("missed", "someone", "x")];
    rows.extend(history("m", 2));
    rig.backend.set_messages(rows);
    rig.realtime.ack_ok("real");
    rig.core.ingest(connected());
    rig.settle().await;

    assert_eq!(rig.ids(), ["m-0", "m-1", "missed", "real"]);
    assert!(rig.rows.windows(2).all(|pair| pair[0].seq < pair[1].seq));
}

#[tokio::test]
async fn a_gap_too_big_to_bridge_resets_the_window() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 3))
        .await;
    rig.settle().await;
    rig.core.ingest(dropped());
    // Nothing the window has is on the server any more, within reach.
    rig.backend.set_messages(history("new", 30));
    rig.core.ingest(connected());
    let events = rig.settle().await;
    assert!(
        ops_of(&events)
            .iter()
            .flatten()
            .any(|op| matches!(op, ListOp::Reset { .. }))
    );
    assert_eq!(rig.ids().last().unwrap(), "new-29");
    assert_eq!(
        rig.ids()[0],
        "new-0",
        "it read to the end looking for where they connect"
    );
}

#[tokio::test]
async fn a_held_window_waits_out_a_reset_until_the_selection_lets_go() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 3))
        .await;
    rig.settle().await;
    let seqs: Vec<i64> = rig.rows.iter().map(|row| row.seq).collect();
    rig.core.hold_rows(channel(), Some((seqs[0], seqs[2])));
    rig.core.ingest(dropped());
    rig.backend.set_messages(history("new", 30));
    rig.core.ingest(connected());
    let events = rig.settle().await;

    assert!(
        ops_of(&events)
            .iter()
            .flatten()
            .all(|op| !matches!(op, ListOp::Reset { .. }))
    );
    assert_eq!(
        rig.rows.iter().map(|row| row.seq).collect::<Vec<_>>(),
        seqs,
        "the selection's rows stayed"
    );

    rig.core.hold_rows(channel(), None);
    let events = rig.settle().await;
    assert!(
        ops_of(&events)
            .iter()
            .flatten()
            .any(|op| matches!(op, ListOp::Reset { .. }))
    );
    assert_eq!(rig.ids().last().unwrap(), "new-29");
}

#[tokio::test]
async fn reconnecting_while_detached_resets_as_the_web_does() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", MAX_ROWS + 100))
        .await;
    load_pages(&mut rig, 40).await;
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    let events = rig.settle().await;
    assert!(
        ops_of(&events)
            .iter()
            .flatten()
            .any(|op| matches!(op, ListOp::Reset { .. }))
    );
    assert_eq!(rig.rows.len(), 25);
    let newest = format!("m-{}", MAX_ROWS + 99);
    assert_eq!(rig.ids().last().unwrap(), &newest);
}

#[tokio::test]
async fn a_conversation_off_screen_resyncs_when_it_is_opened() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 2))
        .await;
    rig.settle().await;
    rig.core
        .open_conversation(Conversation::DirectMessage { id: "dm".into() })
        .await
        .unwrap();
    let requests = page_requests(&rig);

    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.core.run_until_idle().await;
    assert_eq!(
        page_requests(&rig),
        requests,
        "not fetched while off screen"
    );

    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;
    assert!(page_requests(&rig) > requests);
}

// --- Session ---

#[tokio::test]
async fn sign_in_sets_the_session_connects_and_learns_the_token_expiry() {
    let rig = Rig::new();
    // {"exp": 2000} as a JWT payload.
    *rig.backend.access_token.lock().unwrap() = "e30.eyJleHAiOjIwMDB9.sig".into();
    rig.core
        .sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    assert!(matches!(rig.core.session(), SessionState::SignedIn { me } if me.id == ME));
    assert_eq!(rig.realtime.calls(), vec!["connect"]);
    assert_eq!(
        *rig.backend.server_url.lock().unwrap(),
        Some("http://server".to_string())
    );
    let events = rig.events.take();
    assert!(events.contains(&CoreEvent::ViewChanged {
        view: ViewKey::Session
    }));

    // 2,000,000 ms, within the margin of the clock's 1,900,000.
    rig.clock.advance(900_000);
    rig.core.suspend();
    assert!(rig.core.resume().refresh_token);
}

#[tokio::test]
async fn a_refused_sign_in_is_a_state_not_an_error() {
    let rig = Rig::new();
    *rig.backend.login_fails.lock().unwrap() = true;
    rig.core
        .sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    let SessionState::SignInFailed { error } = rig.core.session() else {
        panic!("{:?}", rig.core.session());
    };
    assert_eq!(error.code, "UNAUTHENTICATED");
    assert!(rig.realtime.calls().is_empty());
}

#[tokio::test]
async fn sign_out_forgets_the_session() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.settle().await;
    rig.core.sign_out().await.unwrap();
    assert_eq!(rig.core.session(), SessionState::SignedOut);
    assert_eq!(rig.backend.logged_out.load(Ordering::SeqCst), 1);
    assert!(rig.realtime.calls().contains(&"disconnect".to_string()));
    assert!(rig.core.communities().is_empty());
    assert!(rig.core.query_state(&keys::op(keys::COMMUNITIES)).is_none());
}

#[tokio::test]
async fn token_expiring_refreshes_and_hands_the_socket_the_new_token() {
    let rig = Rig::new().signed_in().await;
    *rig.backend.access_token.lock().unwrap() = "e30.eyJleHAiOjIwMDB9.sig".into();
    rig.realtime.ack(Ack::Now(Ok(vec![
        json!({ "ok": true, "expiresAt": "2030-01-01T00:00:00.000Z" }),
    ])));
    rig.core.ingest(event(
        "tokenExpiring",
        json!({ "expiresAt": "2026-09-22T18:02:00.000Z" }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.refreshes.load(Ordering::SeqCst), 1);
    let sent = rig.realtime.sent.lock().unwrap().clone();
    assert_eq!(sent[0].0, "reauthenticate");
    assert_eq!(sent[0].1["token"], json!("Bearer e30.eyJleHAiOjIwMDB9.sig"));
    rig.core.suspend();
    assert!(
        !rig.core.resume().refresh_token,
        "the ack's new expiry counts"
    );
}

// --- The single writer ---

/// Calls back into core from its event handler.
struct Reentrant {
    core: Mutex<Option<Core>>,
    seen: Mutex<Vec<CoreEvent>>,
}

impl EventSink for Reentrant {
    fn on_event(&self, event: CoreEvent) {
        self.seen.lock().unwrap().push(event.clone());
        if matches!(
            event,
            CoreEvent::ConnectionChanged {
                state: ConnectionState::Connected
            }
        ) && let Some(core) = self.core.lock().unwrap().clone()
        {
            core.suspend();
        }
    }
}

#[test]
fn a_sink_can_call_back_in_and_events_stay_in_order() {
    let sink = Arc::new(Reentrant {
        core: Mutex::new(None),
        seen: Mutex::new(Vec::new()),
    });
    let rig = Rig::new();
    let core = Core::new(rig.clock.clone(), sink.clone());
    *sink.core.lock().unwrap() = Some(core.clone());
    core.ingest(connected());
    let seen = sink.seen.lock().unwrap().clone();
    assert_eq!(
        seen,
        vec![
            CoreEvent::ConnectionChanged {
                state: ConnectionState::Connected
            },
            CoreEvent::ConnectionChanged {
                state: ConnectionState::Suspended
            },
        ]
    );
}

#[tokio::test]
async fn drive_runs_until_shutdown() {
    let rig = Rig::new().signed_in().await;
    let core = rig.core.clone();
    let driver = tokio::spawn(async move { core.drive().await });
    rig.core.invalidate(&keys::op(keys::UNREAD));
    let before = rig.backend.unread_requests.load(Ordering::SeqCst);
    while rig.backend.unread_requests.load(Ordering::SeqCst) == before {
        tokio::task::yield_now().await;
    }
    rig.core.shutdown();
    driver.await.unwrap();
}
