//! W1 part B: thread info and subscriptions, search, the unread divider and message links.

mod common;

use common::*;
use semaphore_core::links::parse_message_link;
use semaphore_core::model::{Conversation, LoadState, MessageLink, SearchScope, ViewKey};
use semaphore_core::platform::{CoreError, CoreEvent};
use serde_json::json;
use tokio::sync::oneshot;

const PARENT: &str = "p-1";

fn thread() -> Conversation {
    Conversation::Thread {
        parent_message_id: PARENT.into(),
    }
}

fn thread_viewed(events: &[CoreEvent]) -> bool {
    events.iter().any(|event| {
        matches!(event, CoreEvent::ViewChanged { view: ViewKey::Thread { parent_message_id } }
            if parent_message_id == PARENT)
    })
}

async fn with_meta(subscribed: bool) -> Rig {
    let rig = Rig::new().signed_in().await;
    rig.backend.reading.set_meta(PARENT, subscribed, 2);
    rig.core.thread_info(PARENT.into());
    rig.core.run_until_idle().await;
    rig
}

// --- Threads ---

#[tokio::test]
async fn thread_info_loads_then_reads_from_the_cache() {
    let rig = Rig::new().signed_in().await;
    rig.backend.reading.set_meta(PARENT, true, 4);
    assert_eq!(
        rig.core.thread_info(PARENT.into()).state,
        LoadState::Loading
    );
    rig.core.run_until_idle().await;
    let info = rig.core.thread_info(PARENT.into());
    assert_eq!(info.state, LoadState::Ready);
    assert!(info.subscribed);
    assert_eq!(info.reply_count, 4);
    assert!(info.last_reply_at_ms.is_some());
    assert!(thread_viewed(&rig.events.take()));
    rig.core.thread_info(PARENT.into());
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.reading.meta_requests(), 1, "cached");
}

#[tokio::test]
async fn opening_a_thread_reads_its_metadata_again() {
    let rig = with_meta(false).await;
    // Another device subscribed: no event says so.
    rig.backend.reading.set_meta(PARENT, true, 2);
    rig.core.open_conversation(thread()).await.unwrap();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.reading.meta_requests(), 2);
    assert!(rig.core.thread_info(PARENT.into()).subscribed);
}

#[tokio::test]
async fn subscribing_shows_at_once_and_refetches_after() {
    let rig = with_meta(false).await;
    let (release, gate) = oneshot::channel();
    *rig.backend.reading.subscribe_gate.lock().unwrap() = Some(gate);
    rig.events.take();
    let (result, ()) = tokio::join!(rig.core.set_thread_subscribed(PARENT.into(), true), async {
        tokio::task::yield_now().await;
        assert!(rig.core.thread_info(PARENT.into()).subscribed, "optimistic");
        assert!(thread_viewed(&rig.events.take()));
        release.send(()).unwrap();
    });
    result.unwrap();
    rig.core.run_until_idle().await;
    assert!(rig.core.thread_info(PARENT.into()).subscribed);
    assert_eq!(
        *rig.backend.reading.subscribe_calls.lock().unwrap(),
        vec![(PARENT.to_owned(), true)]
    );
    assert_eq!(rig.backend.reading.meta_requests(), 2, "refetched after");

    rig.core
        .set_thread_subscribed(PARENT.into(), false)
        .await
        .unwrap();
    rig.core.run_until_idle().await;
    assert!(!rig.core.thread_info(PARENT.into()).subscribed);
    assert_eq!(
        rig.backend.reading.subscribe_calls.lock().unwrap().last(),
        Some(&(PARENT.to_owned(), false))
    );
}

#[tokio::test]
async fn a_failed_subscribe_rolls_back_and_refetches() {
    let rig = with_meta(false).await;
    let (release, gate) = oneshot::channel();
    *rig.backend.reading.subscribe_gate.lock().unwrap() = Some(gate);
    *rig.backend.reading.subscribe_error.lock().unwrap() = Some(refused_500());
    let (result, ()) = tokio::join!(rig.core.set_thread_subscribed(PARENT.into(), true), async {
        tokio::task::yield_now().await;
        assert!(rig.core.thread_info(PARENT.into()).subscribed, "optimistic");
        release.send(()).unwrap();
    });
    assert!(result.is_err());
    assert!(
        !rig.core.thread_info(PARENT.into()).subscribed,
        "rolled back"
    );
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.reading.meta_requests(), 2, "refetched after");
    assert!(!rig.core.thread_info(PARENT.into()).subscribed);
    assert_eq!(rig.core.thread_info(PARENT.into()).state, LoadState::Ready);
}

fn refused_500() -> semaphore_core::backend::BackendError {
    semaphore_core::backend::BackendError {
        status: 500,
        code: semaphore_wire::enums::ErrorCode::Unknown("INTERNAL".into()),
        message: "boom".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

fn thread_reply(id: &str, author: &str) -> semaphore_core::realtime::RealtimeEvent {
    let mut reply = message_json(id, author, "a reply");
    reply["parentMessageId"] = json!(PARENT);
    event(
        "newThreadReply",
        json!({ "parentMessageId": PARENT, "reply": reply }),
    )
}

#[tokio::test]
async fn my_own_reply_subscribes_me() {
    let rig = with_meta(false).await;
    rig.core.ingest(thread_reply("r-9", "someone"));
    assert!(
        !rig.core.thread_info(PARENT.into()).subscribed,
        "not theirs"
    );
    rig.events.take();
    rig.core.ingest(thread_reply("r-10", ME));
    assert!(thread_viewed(&rig.events.take()));
    assert!(rig.core.thread_info(PARENT.into()).subscribed);
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.reading.meta_requests(), 1, "no request needed");
}

#[tokio::test]
async fn reply_count_updates_follow_into_the_header() {
    let rig = with_meta(false).await;
    rig.core.ingest(event(
        "threadReplyCountUpdated",
        json!({
            "parentMessageId": PARENT,
            "channelId": CHANNEL,
            "replyCount": 7,
            "lastReplyAt": "2026-09-22T19:00:00.000Z",
        }),
    ));
    let info = rig.core.thread_info(PARENT.into());
    assert_eq!(info.reply_count, 7);
    assert_eq!(info.last_reply_at_ms, Some(1_790_103_600_000));
}

#[tokio::test]
async fn a_removed_parent_reads_as_not_found_without_looping() {
    let rig = Rig::new().signed_in().await;
    // No metadata scripted: the server answers 404.
    rig.core.thread_info(PARENT.into());
    rig.core.run_until_idle().await;
    let LoadState::Failed { error } = rig.core.thread_info(PARENT.into()).state else {
        panic!("not failed");
    };
    assert_eq!(error.code, "NOT_FOUND");
    assert!(!error.retryable);
    for _ in 0..5 {
        rig.core.thread_info(PARENT.into());
        rig.core.run_until_idle().await;
    }
    assert_eq!(
        rig.backend.reading.meta_requests(),
        1,
        "fails once, not per read"
    );

    // Subscribing to it fails, and leaves it not found.
    let error = rig
        .core
        .set_thread_subscribed(PARENT.into(), true)
        .await
        .unwrap_err();
    assert!(error.to_string().starts_with("NOT_FOUND"), "{error}");
    rig.core.run_until_idle().await;
    let info = rig.core.thread_info(PARENT.into());
    assert!(!info.subscribed);
    assert!(matches!(info.state, LoadState::Failed { error } if error.code == "NOT_FOUND"));
    assert_eq!(rig.backend.reading.meta_requests(), 2);
}

// --- Search ---

fn reply_json(id: &str, parent: &str) -> serde_json::Value {
    let mut reply = message_json(id, "someone", "found in a thread");
    reply["parentMessageId"] = json!(parent);
    reply
}

#[tokio::test]
async fn a_channel_search_asks_the_channel_endpoint() {
    let rig = Rig::new().signed_in().await;
    *rig.backend.reading.search_results.lock().unwrap() = vec![
        message_json("m-2", ME, "needle two"),
        reply_json("r-1", PARENT),
    ];
    let hits = rig
        .core
        .search_messages(
            SearchScope::Channel { id: CHANNEL.into() },
            "  needle ".into(),
            Some(20),
        )
        .await
        .unwrap();
    assert_eq!(
        *rig.backend.reading.search_calls.lock().unwrap(),
        vec![(
            "channel".to_owned(),
            CHANNEL.to_owned(),
            "needle".to_owned(),
            Some(20)
        )]
    );
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].row.id.as_deref(), Some("m-2"));
    assert_eq!(hits[0].row.display, "needle two");
    assert!(hits[0].row.mine);
    assert_eq!(hits[0].conversation, channel());
    assert_eq!(hits[0].parent_message_id, None);
    assert_eq!(hits[0].channel_name, None);
    assert_eq!(hits[1].parent_message_id.as_deref(), Some(PARENT));
    assert_eq!(
        hits[1].conversation,
        channel(),
        "a reply's own conversation"
    );
}

#[tokio::test]
async fn a_dm_search_asks_the_group_endpoint() {
    let rig = Rig::new().signed_in().await;
    let mut dm = message_json("d-1", "someone", "in a dm");
    dm["channelId"] = json!(null);
    dm["directMessageGroupId"] = json!("g-1");
    *rig.backend.reading.search_results.lock().unwrap() = vec![dm];
    let hits = rig
        .core
        .search_messages(
            SearchScope::DirectMessage { id: "g-1".into() },
            "dm".into(),
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        *rig.backend.reading.search_calls.lock().unwrap(),
        vec![("group".to_owned(), "g-1".to_owned(), "dm".to_owned(), None)]
    );
    assert_eq!(
        hits[0].conversation,
        Conversation::DirectMessage { id: "g-1".into() }
    );
}

#[tokio::test]
async fn a_community_search_carries_channel_names() {
    let rig = Rig::new().signed_in().await;
    let mut result = message_json("m-5", "someone", "community hit");
    result["channelId"] = json!("chan-2");
    result["channelName"] = json!("general");
    *rig.backend.reading.community_results.lock().unwrap() = vec![result];
    let hits = rig
        .core
        .search_messages(
            SearchScope::Community { id: "c-1".into() },
            "hit".into(),
            Some(5),
        )
        .await
        .unwrap();
    assert_eq!(
        rig.backend.reading.search_calls.lock().unwrap()[0],
        (
            "community".to_owned(),
            "c-1".to_owned(),
            "hit".to_owned(),
            Some(5)
        )
    );
    assert_eq!(hits[0].channel_name.as_deref(), Some("general"));
    assert_eq!(
        hits[0].conversation,
        Conversation::Channel {
            id: "chan-2".into()
        }
    );
    assert_eq!(hits[0].row.display, "community hit");
}

#[tokio::test]
async fn a_blank_search_asks_nothing() {
    let rig = Rig::new().signed_in().await;
    for query in ["", "   ", "\n\t"] {
        let hits = rig
            .core
            .search_messages(
                SearchScope::Channel { id: CHANNEL.into() },
                query.into(),
                None,
            )
            .await
            .unwrap();
        assert!(hits.is_empty());
    }
    assert!(rig.backend.reading.search_calls.lock().unwrap().is_empty());
}

// --- Unread divider ---

fn counts(last_read: &str, unread: i64, mentions: i64) -> Vec<serde_json::Value> {
    vec![json!({
        "channelId": CHANNEL,
        "unreadCount": unread,
        "mentionCount": mentions,
        "lastReadMessageId": last_read,
    })]
}

#[tokio::test]
async fn the_divider_is_where_reading_stopped_when_the_channel_opened() {
    let rig = Rig::new();
    *rig.backend.unread.lock().unwrap() = counts("m-2", 2, 1);
    let rig = rig.signed_in().await.open_channel(history("m", 5)).await;
    let marker = rig.core.unread_marker(channel()).expect("a divider");
    assert_eq!(marker.after_message_id, "m-2");
    assert_eq!(marker.unread_count, 2);
    assert_eq!(marker.mention_count, 1);
    let seq = marker.after_seq.expect("the row is loaded");
    let row = rig
        .rows
        .iter()
        .find(|row| row.id.as_deref() == Some("m-2"))
        .unwrap();
    assert_eq!(row.seq, seq);

    // Reading on doesn't move it while the channel stays open.
    rig.core.mark_read(channel(), "m-4".into()).await.unwrap();
    rig.core.ingest(event(
        "readReceiptUpdated",
        json!({
            "channelId": CHANNEL,
            "lastReadMessageId": "m-4",
            "lastReadAt": "2026-09-22T18:10:00.000Z",
        }),
    ));
    rig.core.open_conversation(channel()).await.unwrap();
    assert_eq!(rig.core.unread_marker(channel()), Some(marker));
    assert_eq!(rig.core.unread_marker(thread()), None, "threads have none");
}

#[tokio::test]
async fn counts_that_arrive_late_still_place_the_divider() {
    let rig = Rig::new();
    *rig.backend.unread.lock().unwrap() = counts("m-1", 3, 0);
    rig.backend.set_messages(history("m", 5));
    rig.core
        .sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    // Opened before the counts' fetch has run.
    rig.core.open_conversation(channel()).await.unwrap();
    assert_eq!(rig.core.unread_marker(channel()), None);
    rig.events.take();
    rig.core.run_until_idle().await;
    let marker = rig
        .core
        .unread_marker(channel())
        .expect("placed on arrival");
    assert_eq!(marker.after_message_id, "m-1");
    assert!(rig.events.take().iter().any(|event| matches!(event,
        CoreEvent::ViewChanged { view: ViewKey::UnreadMarker { conversation } }
            if *conversation == channel())));
}

#[tokio::test]
async fn a_divider_older_than_the_loaded_rows_has_no_seq() {
    let rig = Rig::new();
    *rig.backend.unread.lock().unwrap() = counts("m-1", 40, 0);
    let rig = rig.signed_in().await.open_channel(history("m", 60)).await;
    let marker = rig.core.unread_marker(channel()).expect("a divider");
    assert_eq!(marker.after_message_id, "m-1");
    assert_eq!(marker.after_seq, None, "older than the first page");
}

#[tokio::test]
async fn nothing_unread_means_no_divider() {
    let rig = Rig::new();
    *rig.backend.unread.lock().unwrap() = counts("m-4", 0, 0);
    let rig = rig.signed_in().await.open_channel(history("m", 5)).await;
    assert_eq!(rig.core.unread_marker(channel()), None);
}

#[tokio::test]
async fn clearing_the_divider_lasts_until_the_next_open() {
    let rig = Rig::new();
    *rig.backend.unread.lock().unwrap() = counts("m-2", 2, 0);
    let rig = rig.signed_in().await.open_channel(history("m", 5)).await;
    assert!(rig.core.unread_marker(channel()).is_some());
    rig.core.clear_unread_marker(channel());
    assert_eq!(rig.core.unread_marker(channel()), None);
    rig.core.open_conversation(channel()).await.unwrap();
    assert_eq!(rig.core.unread_marker(channel()), None, "same visit");

    // Away and back: the counts as they are now. Still unread, since nothing marked it.
    let other = Conversation::Channel { id: "other".into() };
    rig.core.open_conversation(other).await.unwrap();
    rig.core.open_conversation(channel()).await.unwrap();
    assert_eq!(
        rig.core
            .unread_marker(channel())
            .map(|marker| marker.after_message_id),
        Some("m-2".into())
    );
}

// --- Links ---

const SERVER: &str = "https://chat.example";

fn link(conversation: Conversation, community: Option<&str>, message: Option<&str>) -> MessageLink {
    MessageLink {
        community_id: community.map(str::to_owned),
        conversation,
        message_id: message.map(str::to_owned),
    }
}

#[test]
fn every_web_link_shape_parses() {
    let chan = Conversation::Channel { id: "X".into() };
    let dm = Conversation::DirectMessage { id: "G".into() };
    let cases = [
        (
            "https://chat.example/community/C/channel/X?highlight=M",
            link(chan.clone(), Some("C"), Some("M")),
        ),
        (
            "https://chat.example/community/C/channel/X",
            link(chan.clone(), Some("C"), None),
        ),
        (
            "https://chat.example/direct-messages/G?highlight=M",
            link(dm.clone(), None, Some("M")),
        ),
        (
            "https://chat.example/direct-messages?group=G&highlight=M",
            link(dm.clone(), None, Some("M")),
        ),
        (
            "https://chat.example/direct-messages?highlight=M&group=G#top",
            link(dm.clone(), None, Some("M")),
        ),
        // Case, an explicit default port and a trailing slash are the same server.
        (
            "HTTPS://Chat.Example:443/community/C/channel/X/?highlight=M",
            link(chan.clone(), Some("C"), Some("M")),
        ),
    ];
    for (url, expected) in cases {
        assert_eq!(parse_message_link(SERVER, url), Some(expected), "{url}");
    }
    assert_eq!(
        parse_message_link(
            "https://chat.example/",
            "https://chat.example/direct-messages/G"
        ),
        Some(link(dm.clone(), None, None))
    );
    assert_eq!(
        parse_message_link(
            "http://10.0.0.2:3000",
            "http://10.0.0.2:3000/direct-messages/G"
        ),
        Some(link(dm.clone(), None, None))
    );
    assert_eq!(
        parse_message_link(
            "https://example.org/chat",
            "https://example.org/chat/community/C/channel/X?highlight=M"
        ),
        Some(link(chan, Some("C"), Some("M"))),
        "a server under a path"
    );
}

#[test]
fn links_elsewhere_or_malformed_are_refused() {
    let refused = [
        // Another server.
        "https://other.example/community/C/channel/X?highlight=M",
        // Lookalikes.
        "https://chat.example.evil.com/community/C/channel/X",
        "https://evilchat.example/community/C/channel/X",
        "https://chat.example@evil.com/community/C/channel/X",
        "https://evil.com@chat.example/community/C/channel/X",
        // Another port or scheme.
        "https://chat.example:8443/community/C/channel/X",
        "http://chat.example/community/C/channel/X",
        "ftp://chat.example/community/C/channel/X",
        // Not a message page, or ids that aren't ids.
        "https://chat.example/settings",
        "https://chat.example/community/C",
        "https://chat.example/community/C/channel/X/extra",
        "https://chat.example/community/C/channel/..%2Fadmin",
        "https://chat.example/community/C/channel/X?highlight=a%2Fb",
        "https://chat.example/direct-messages",
        "https://chat.example/direct-messages?group=",
        "https://chat.example",
        // Garbage.
        "",
        "not a link",
        "https://",
        "https://:443/community/C/channel/X",
        "https://chat.example:port/community/C/channel/X",
        "/community/C/channel/X",
    ];
    for url in refused {
        assert_eq!(parse_message_link(SERVER, url), None, "{url}");
    }
    assert_eq!(
        parse_message_link(
            "https://example.org/chat",
            "https://example.org/chatter/community/C/channel/X"
        ),
        None
    );
    assert_eq!(
        parse_message_link("garbage", "https://chat.example/direct-messages/G"),
        None
    );
}

#[tokio::test]
async fn a_link_opens_its_conversation_at_the_message() {
    let rig = Rig::new().signed_in().await;
    rig.backend.set_messages(history("m", 5));
    let opened = rig
        .core
        .open_message_link(
            format!("http://server/community/c-1/channel/{CHANNEL}?highlight=m-2"),
            None,
        )
        .await
        .unwrap();
    assert_eq!(opened, channel());
    let mut rows = Vec::new();
    for event in rig.events.take() {
        if let CoreEvent::MessagesChanged { conversation, ops } = event
            && conversation == channel()
        {
            apply(&mut rows, &ops);
        }
    }
    assert!(rows.iter().any(|row| row.id.as_deref() == Some("m-2")));
}

#[tokio::test]
async fn a_thread_reply_link_jumps_to_the_parent_then_opens_the_thread() {
    let rig = Rig::new().signed_in().await;
    let mut rows = history("m", 3);
    rows.insert(1, message(PARENT, "someone", "the parent"));
    rig.backend.set_messages(rows);
    let mut reply = message("r-1", "someone", "the reply");
    reply.parent_message_id = Some(PARENT.into());
    rig.backend
        .thread_replies
        .lock()
        .unwrap()
        .insert(PARENT.into(), vec![reply]);
    rig.backend.reading.set_meta(PARENT, false, 1);
    let opened = rig
        .core
        .open_message_link(
            format!("http://server/community/c-1/channel/{CHANNEL}?highlight=r-1"),
            Some(PARENT.into()),
        )
        .await
        .unwrap();
    assert_eq!(opened, channel());
    let events = rig.events.take();
    let changed: Vec<&Conversation> = events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::MessagesChanged { conversation, .. } => Some(conversation),
            _ => None,
        })
        .collect();
    assert!(changed.contains(&&channel()), "{changed:?}");
    assert!(changed.contains(&&thread()), "{changed:?}");
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.thread_info(PARENT.into()).state, LoadState::Ready);
}

#[tokio::test]
async fn a_link_to_a_message_that_is_gone_fails_not_found() {
    let rig = Rig::new().signed_in().await;
    rig.backend.set_messages(history("m", 3));
    let error = rig
        .core
        .open_message_link(
            format!("http://server/community/c-1/channel/{CHANNEL}?highlight=gone"),
            None,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&error, CoreError::Failed { message } if message.starts_with("NOT_FOUND")),
        "{error:?}"
    );
}

#[tokio::test]
async fn a_link_to_another_server_fails_without_a_request() {
    let rig = Rig::new().signed_in().await;
    let error = rig
        .core
        .open_message_link(
            format!("http://server.evil/community/c-1/channel/{CHANNEL}?highlight=m-1"),
            None,
        )
        .await
        .unwrap_err();
    assert!(matches!(error, CoreError::Failed { .. }));
    assert_eq!(rig.core.unread_marker(channel()), None);
    assert!(
        rig.events
            .take()
            .iter()
            .all(|event| !matches!(event, CoreEvent::MessagesChanged { .. }))
    );
}

#[tokio::test]
async fn message_links_need_a_session() {
    let rig = Rig::new();
    let error = rig
        .core
        .open_message_link("http://server/direct-messages/g".into(), None)
        .await
        .unwrap_err();
    assert!(matches!(error, CoreError::Unavailable { .. }));
}

#[test]
fn the_web_apps_hash_router_links_parse() {
    // The shapes the web app shows and copies: its `HashRouter` routes after `#`, as built by
    // `utils/voiceChannelLink.ts` and `utils/swPush.ts`, with the `?highlight=` its jumps add
    // (`MessageSearch`, `NotificationCenter`, `QuotePreview`).
    let chan = Conversation::Channel { id: "X".into() };
    let dm = Conversation::DirectMessage { id: "G".into() };
    let cases = [
        (
            "https://chat.example/#/community/C/channel/X?highlight=M",
            link(chan.clone(), Some("C"), Some("M")),
        ),
        (
            "https://chat.example/#/community/C/channel/X",
            link(chan.clone(), Some("C"), None),
        ),
        (
            "https://chat.example#/community/C/channel/X",
            link(chan.clone(), Some("C"), None),
        ),
        (
            "https://chat.example/#/direct-messages/G?highlight=M",
            link(dm.clone(), None, Some("M")),
        ),
        (
            "https://chat.example/#/direct-messages/G",
            link(dm.clone(), None, None),
        ),
        (
            "https://chat.example/#/direct-messages?group=G&highlight=M",
            link(dm.clone(), None, Some("M")),
        ),
    ];
    for (url, expected) in cases {
        assert_eq!(parse_message_link(SERVER, url), Some(expected), "{url}");
    }
    assert_eq!(
        parse_message_link(
            "https://example.org/chat",
            "https://example.org/chat/#/community/C/channel/X?highlight=M"
        ),
        Some(link(chan, Some("C"), Some("M"))),
        "a server under a path"
    );
    for refused in [
        "https://other.example/#/community/C/channel/X",
        "https://chat.example/#/settings",
        "https://chat.example/#/community/C/channel/..%2Fadmin",
        // A route after the hash only counts on the server's own page.
        "https://chat.example/elsewhere#/community/C/channel/X",
        "https://chat.example/#/community/C/channel/X?highlight=a%2Fb",
    ] {
        assert_eq!(parse_message_link(SERVER, refused), None, "{refused}");
    }
}

#[tokio::test]
async fn a_thread_link_does_not_open_its_thread_after_the_user_went_elsewhere() {
    let rig = Rig::new().signed_in().await;
    let mut rows = history("m", 3);
    rows.insert(1, message(PARENT, "someone", "the parent"));
    rig.backend.set_messages(rows);
    rig.backend.reading.set_meta(PARENT, false, 1);
    let (release, gate) = oneshot::channel();
    *rig.backend.around_gate.lock().unwrap() = Some(gate);
    let core = rig.core.clone();
    let following = tokio::spawn(async move {
        core.open_message_link(
            format!("http://server/community/c-1/channel/{CHANNEL}?highlight=r-1"),
            Some(PARENT.into()),
        )
        .await
    });
    for _ in 0..10_000 {
        if rig.backend.around_gate.lock().unwrap().is_none() {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        rig.backend.around_gate.lock().unwrap().is_none(),
        "the page was never asked for"
    );
    // Meanwhile the user opens a DM.
    rig.core
        .open_conversation(Conversation::DirectMessage { id: "dm-1".into() })
        .await
        .unwrap();
    release.send(()).unwrap();
    following.await.unwrap().unwrap();
    let opened_thread = rig.events.take().iter().any(|event| {
        matches!(event, CoreEvent::MessagesChanged { conversation, .. } if *conversation == thread())
    });
    assert!(!opened_thread, "the thread opened over the DM");
}
