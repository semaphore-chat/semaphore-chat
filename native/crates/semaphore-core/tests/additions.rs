//! What UI units asked core for: the live-edge paging, the row fields, and the new reads.

mod common;

use common::*;
use semaphore_core::model::{Conversation, SendState, ViewKey};
use semaphore_core::platform::CoreEvent;
use semaphore_core::realtime::RealtimeError;
use semaphore_core::store::MAX_ROWS;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;

fn pages(rig: &Rig) -> u64 {
    rig.backend.page_requests.load(Ordering::SeqCst)
}

/// `count` messages, opened far enough from the newest that the window is detached.
async fn detached(count: usize, anchor: usize) -> Rig {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.set_messages(history("m", count));
    rig.core
        .open_conversation_at(channel(), format!("m-{anchor}"))
        .await
        .unwrap();
    rig.sync();
    rig
}

fn view_changed(events: &[CoreEvent], view: ViewKey) -> bool {
    events
        .iter()
        .any(|event| matches!(event, CoreEvent::ViewChanged { view: seen } if *seen == view))
}

// --- Paging toward the live edge ---

#[tokio::test]
async fn opening_at_a_message_detaches_a_window_that_stops_short_of_the_edge() {
    let rig = detached(100, 10).await;
    // 25 each side, clipped to what's older.
    assert_eq!(rig.rows.first().unwrap().id.as_deref(), Some("m-0"));
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("m-35"));
    assert!(!rig.core.at_live_edge(channel()));
}

#[tokio::test]
async fn opening_at_a_message_near_the_edge_stays_attached() {
    let rig = detached(30, 28).await;
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("m-29"));
    assert!(rig.core.at_live_edge(channel()));
}

#[tokio::test]
async fn opening_at_a_loaded_message_fetches_nothing() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 5))
        .await;
    let before = pages(&rig);
    let ids = rig.ids();
    rig.core
        .open_conversation_at(channel(), "m-2".into())
        .await
        .unwrap();
    rig.sync();
    assert_eq!(pages(&rig), before);
    assert_eq!(rig.ids(), ids);
    assert!(rig.core.at_live_edge(channel()));
}

#[tokio::test]
async fn opening_at_a_missing_message_fails_and_keeps_the_rows() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 5))
        .await;
    let ids = rig.ids();
    assert!(
        rig.core
            .open_conversation_at(channel(), "gone".into())
            .await
            .is_err()
    );
    rig.sync();
    assert_eq!(rig.ids(), ids);
}

#[tokio::test]
async fn opening_at_a_message_refuses_to_replace_held_rows() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 5))
        .await;
    let seq = rig.rows[0].seq;
    rig.core.hold_rows(channel(), Some((seq, seq)));
    let ids = rig.ids();
    assert!(
        rig.core
            .open_conversation_at(channel(), "elsewhere".into())
            .await
            .is_err()
    );
    rig.sync();
    assert_eq!(rig.ids(), ids);
}

#[tokio::test]
async fn opening_at_a_message_works_in_a_dm() {
    let rig = Rig::new().signed_in().await;
    rig.backend
        .messages
        .lock()
        .unwrap()
        .insert("dm".into(), history("d", 100));
    let dm = Conversation::DirectMessage { id: "dm".into() };
    rig.core
        .open_conversation_at(dm.clone(), "d-50".into())
        .await
        .unwrap();
    assert!(!rig.core.at_live_edge(dm.clone()));
    while !rig.core.at_live_edge(dm.clone()) {
        rig.core.load_newer(dm.clone()).await.unwrap();
    }
}

#[tokio::test]
async fn load_newer_appends_until_the_edge_then_new_messages_land() {
    let mut rig = detached(100, 10).await;
    rig.core.ingest(new_message("skipped", "someone", "x"));
    rig.sync();
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("m-35"));

    let mut loads = 0;
    while !rig.core.at_live_edge(channel()) {
        rig.core.load_newer(channel()).await.unwrap();
        rig.sync();
        loads += 1;
        assert!(loads < 10, "never reached the edge");
    }
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("m-99"));
    let expected: Vec<String> = (0..100).map(|n| format!("m-{n}")).collect();
    assert_eq!(rig.ids(), expected);
    assert!(rig.rows.windows(2).all(|pair| pair[0].seq < pair[1].seq));

    rig.core.ingest(new_message("after", "someone", "x"));
    rig.sync();
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("after"));
}

#[tokio::test]
async fn load_newer_at_the_edge_asks_for_nothing() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 5))
        .await;
    let before = pages(&rig);
    rig.core.load_newer(channel()).await.unwrap();
    rig.sync();
    assert_eq!(pages(&rig), before);
}

#[tokio::test]
async fn a_full_last_page_needs_one_more_empty_read_to_reach_the_edge() {
    // 25 newer rows exactly: the server can't tell that page was the last.
    let mut rig = detached(61, 10).await;
    rig.core.load_newer(channel()).await.unwrap();
    assert!(!rig.core.at_live_edge(channel()));
    rig.core.load_newer(channel()).await.unwrap();
    rig.sync();
    assert!(rig.core.at_live_edge(channel()));
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("m-60"));
}

#[tokio::test]
async fn a_message_during_the_last_page_is_not_lost_when_the_window_attaches() {
    let mut rig = detached(40, 10).await;
    assert!(!rig.core.at_live_edge(channel()));
    let before = pages(&rig);
    let (release, gate) = tokio::sync::oneshot::channel();
    *rig.backend.gate.lock().unwrap() = Some(gate);
    let core = rig.core.clone();
    let load = tokio::spawn(async move { core.load_newer(channel()).await });
    while pages(&rig) == before {
        tokio::task::yield_now().await;
    }
    // The page's snapshot predates this, and the window is still detached.
    rig.core.ingest(new_message("during", "someone", "x"));
    release.send(()).unwrap();
    load.await.unwrap().unwrap();
    rig.sync();

    assert!(rig.core.at_live_edge(channel()));
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("during"));
    let during = rig.ids().iter().filter(|id| *id == "during").count();
    assert_eq!(during, 1);
}

#[tokio::test]
async fn an_edit_to_a_message_outside_the_rows_during_a_page_adds_no_row() {
    let mut rig = detached(40, 10).await;
    // Older than nothing loaded, newer than the page: not a row of this window at all.
    let before = pages(&rig);
    let (release, gate) = tokio::sync::oneshot::channel();
    *rig.backend.gate.lock().unwrap() = Some(gate);
    let core = rig.core.clone();
    let load = tokio::spawn(async move { core.load_newer(channel()).await });
    while pages(&rig) == before {
        tokio::task::yield_now().await;
    }
    rig.core.ingest(event(
        "updateMessage",
        json!({ "message": message_json("elsewhere", "someone", "edited") }),
    ));
    release.send(()).unwrap();
    load.await.unwrap().unwrap();
    rig.sync();
    assert!(!rig.ids().iter().any(|id| id == "elsewhere"));
}

#[tokio::test]
async fn a_second_load_newer_while_one_runs_asks_for_nothing() {
    let mut rig = detached(100, 10).await;
    let before = pages(&rig);
    let (release, gate) = tokio::sync::oneshot::channel();
    *rig.backend.gate.lock().unwrap() = Some(gate);
    let core = rig.core.clone();
    let load = tokio::spawn(async move { core.load_newer(channel()).await });
    while pages(&rig) == before {
        tokio::task::yield_now().await;
    }
    rig.core.load_newer(channel()).await.unwrap();
    assert_eq!(pages(&rig), before + 1);
    release.send(()).unwrap();
    load.await.unwrap().unwrap();
    rig.sync();
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("m-60"));
}

#[tokio::test]
async fn a_page_answering_rows_since_replaced_is_dropped() {
    let mut rig = detached(100, 10).await;
    let before = pages(&rig);
    let (release, gate) = tokio::sync::oneshot::channel();
    *rig.backend.gate.lock().unwrap() = Some(gate);
    let core = rig.core.clone();
    let load = tokio::spawn(async move { core.load_newer(channel()).await });
    while pages(&rig) == before {
        tokio::task::yield_now().await;
    }
    rig.core.jump_to_present(channel()).await.unwrap();
    rig.sync();
    let live = rig.ids();
    release.send(()).unwrap();
    load.await.unwrap().unwrap();
    rig.sync();
    assert_eq!(rig.ids(), live);
    assert!(rig.core.at_live_edge(channel()));
}

#[tokio::test]
async fn jump_to_present_returns_to_the_edge_and_is_a_no_op_there() {
    let mut rig = detached(100, 10).await;
    rig.core.jump_to_present(channel()).await.unwrap();
    rig.sync();
    assert!(rig.core.at_live_edge(channel()));
    assert_eq!(rig.rows.last().unwrap().id.as_deref(), Some("m-99"));
    let before = pages(&rig);
    rig.core.jump_to_present(channel()).await.unwrap();
    assert_eq!(pages(&rig), before);
}

#[tokio::test]
async fn load_newer_keeps_to_the_cap_except_while_rows_are_held() {
    let mut rig = detached(MAX_ROWS + 200, 10).await;
    let seq = rig.rows[0].seq;
    rig.core.hold_rows(channel(), Some((seq, seq)));
    while !rig.core.at_live_edge(channel()) {
        rig.core.load_newer(channel()).await.unwrap();
    }
    rig.sync();
    assert_eq!(rig.rows.len(), MAX_ROWS + 200);

    rig.core.hold_rows(channel(), None);
    rig.sync();
    assert_eq!(rig.rows.len(), MAX_ROWS);
    let newest = format!("m-{}", MAX_ROWS + 199);
    assert_eq!(
        rig.rows.last().unwrap().id.as_deref(),
        Some(newest.as_str())
    );
    assert!(rig.core.at_live_edge(channel()));

    // The oldest went, so an older page can bring them back: from m-200, the 25 before it.
    rig.core.load_older(channel()).await.unwrap();
    rig.sync();
    assert_eq!(rig.rows.first().unwrap().id.as_deref(), Some("m-175"));
}

// --- Discarding a failed send ---

async fn send_text(rig: &mut Rig, text: &str) -> String {
    let nonce = rig
        .core
        .send_message(
            channel(),
            semaphore_core::model::MessageDraft {
                text: text.into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    rig.sync();
    nonce
}

#[tokio::test]
async fn discarding_a_failed_send_removes_its_row_and_it_cannot_be_retried() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Err(RealtimeError::AckTimedOut)));
    let nonce = send_text(&mut rig, "hi").await;
    rig.settle().await;
    assert!(matches!(
        rig.rows.last().unwrap().send_state,
        SendState::Failed { .. }
    ));
    let sent = rig.realtime.sent.lock().unwrap().len();

    rig.core.discard_failed_send(nonce.clone()).await.unwrap();
    rig.settle().await;
    assert_eq!(rig.ids(), ["m-0"]);

    rig.core.retry_send(nonce).await.unwrap();
    rig.settle().await;
    assert_eq!(rig.ids(), ["m-0"]);
    assert_eq!(rig.realtime.sent.lock().unwrap().len(), sent);
}

#[tokio::test]
async fn a_discarded_send_that_really_landed_still_arrives() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    rig.realtime.ack(Ack::Now(Err(RealtimeError::AckTimedOut)));
    let nonce = send_text(&mut rig, "hi").await;
    rig.settle().await;
    rig.core.discard_failed_send(nonce.clone()).await.unwrap();
    rig.sync();
    rig.core.ingest(echo("real", &nonce, "hi"));
    rig.sync();
    assert_eq!(rig.ids(), ["m-0", "real"]);
}

#[tokio::test]
async fn discarding_a_pending_or_settled_send_changes_nothing() {
    let mut rig = Rig::new()
        .signed_in()
        .await
        .open_channel(history("m", 1))
        .await;
    let (release, ack) = tokio::sync::oneshot::channel();
    rig.realtime.ack(Ack::Later(ack));
    let nonce = send_text(&mut rig, "hi").await;

    // Not started, then in flight.
    rig.core.discard_failed_send(nonce.clone()).await.unwrap();
    rig.sync();
    assert_eq!(rig.rows.len(), 2);
    let core = rig.core.clone();
    let driver = tokio::spawn(async move { core.run_until_idle().await });
    while rig.realtime.sent.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }
    rig.core.discard_failed_send(nonce.clone()).await.unwrap();
    rig.sync();
    assert_eq!(rig.rows.len(), 2);

    release
        .send(Ok(vec![json!({ "ok": true, "messageId": "real" })]))
        .unwrap();
    driver.await.unwrap();
    rig.sync();

    // Settled.
    rig.core.discard_failed_send(nonce).await.unwrap();
    rig.sync();
    assert_eq!(rig.ids(), ["m-0", "real"]);
}

// --- Row fields ---

fn rich_message(id: &str) -> Value {
    let mut message = message_json(id, "someone", "text");
    message["replyTo"] = json!({
        "id": "parent", "authorId": "ava", "sentAt": "2026-09-22T17:00:00.000Z", "deletedAt": null,
        "spans": [
            { "type": "PLAINTEXT", "text": "hello " },
            { "type": "EMOJI", "text": ":wave:", "emojiId": "e1" },
        ],
    });
    message["pinned"] = json!(true);
    message["webhook"] = json!({ "id": "w1", "name": "CI", "avatarUrl": "file-1" });
    message["lastReplyAt"] = json!("2026-09-22T19:00:00.000Z");
    message["linkPreviews"] = json!([{
        "url": "https://example.com", "title": "Example", "imageUrl": "https://example.com/i.png",
    }]);
    message
}

#[tokio::test]
async fn a_row_carries_its_reply_pin_webhook_last_reply_and_previews() {
    let rich: semaphore_wire::types::MessageDto =
        serde_json::from_value(rich_message("rich")).unwrap();
    let mut rig = Rig::new().signed_in().await.open_channel(vec![rich]).await;
    rig.settle().await;

    let row = rig.row("rich");
    let reply = row.reply_to.as_ref().unwrap();
    assert_eq!(reply.message_id, "parent");
    assert_eq!(reply.author.id, "ava");
    // The user fetched for the reply's author reached the row.
    assert_eq!(reply.author.username, "ava");
    assert_eq!(reply.text, "hello :wave:");
    assert!(!reply.deleted);
    assert!(row.pinned);
    assert_eq!(row.webhook.as_ref().unwrap().name, "CI");
    assert_eq!(
        row.last_reply_at_ms,
        Some(
            chrono::DateTime::parse_from_rfc3339("2026-09-22T19:00:00.000Z")
                .unwrap()
                .timestamp_millis()
        )
    );
    assert_eq!(row.link_previews.len(), 1);
    assert_eq!(
        row.link_previews[0].image_url.as_deref(),
        Some("https://example.com/i.png")
    );
}

/// The server blanks a removed message for readers who may not see it, and sends it whole to
/// moderators: a row shows what was sent either way.
#[tokio::test]
async fn a_removed_row_shows_what_the_server_sent_and_a_removed_parent_has_no_text() {
    let mut blanked = rich_message("removed");
    blanked["deletedAt"] = json!("2026-09-22T19:30:00.000Z");
    blanked["replyTo"] = Value::Null;
    blanked["linkPreviews"] = Value::Null;
    blanked["spans"] = json!([]);
    let mut whole = rich_message("whole");
    whole["deletedAt"] = json!("2026-09-22T19:30:00.000Z");
    let mut replying = rich_message("replying");
    replying["replyTo"]["deletedAt"] = json!("2026-09-22T19:30:00.000Z");
    let rows = [blanked, whole, replying]
        .into_iter()
        .map(|row| serde_json::from_value(row).unwrap())
        .collect();
    let mut rig = Rig::new().signed_in().await.open_channel(rows).await;
    rig.settle().await;

    let row = rig.row("removed");
    assert!(row.removed);
    assert!(row.reply_to.is_none());
    assert!(row.link_previews.is_empty());
    assert_eq!(row.display, "");
    let row = rig.row("whole");
    assert!(row.removed);
    assert!(row.reply_to.is_some());
    assert_eq!(row.link_previews.len(), 1);
    assert!(!row.display.is_empty());
    let reply = rig.row("replying").reply_to.clone().unwrap();
    assert!(reply.deleted);
    assert_eq!(reply.text, "");
}

// --- Members ---

fn member(n: usize, roles: Value) -> Value {
    let id = format!("user-{n}");
    json!({
        "id": format!("membership-{n}"), "userId": id, "communityId": "comm",
        "joinedAt": "2026-09-22T18:00:00.000Z", "roles": roles,
        "user": { "id": id, "username": id, "role": "USER", "displayName": null,
                  "avatarUrl": null, "bannerUrl": null, "lastSeen": null, "bio": null,
                  "status": if n == 0 { Value::from("busy") } else { Value::Null } },
    })
}

fn role(name: &str, position: i64, is_default: bool) -> Value {
    json!({
        "id": name, "name": name, "position": position, "isDefault": is_default,
        "actions": [], "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

fn set_members(rig: &Rig, count: usize) {
    *rig.backend.members.lock().unwrap() = (0..count).map(|n| member(n, json!([]))).collect();
}

async fn read_members(rig: &mut Rig) -> semaphore_core::model::MemberList {
    assert_eq!(rig.core.members("comm".into()), None);
    rig.settle().await;
    rig.core.members("comm".into()).unwrap()
}

#[tokio::test]
async fn members_load_a_page_at_a_time() {
    let mut rig = Rig::new().signed_in().await;
    set_members(&rig, 250);
    let list = read_members(&mut rig).await;
    assert_eq!(list.members.len(), 250);
    assert!(!list.truncated);
    assert_eq!(rig.backend.member_page_requests.load(Ordering::SeqCst), 3);
    assert_eq!(list.members[0].status.as_deref(), Some("busy"));
}

#[tokio::test]
async fn members_stop_at_the_cap_and_say_so() {
    let mut rig = Rig::new().signed_in().await;
    set_members(&rig, 1200);
    let list = read_members(&mut rig).await;
    assert_eq!(list.members.len(), 1000);
    assert!(list.truncated);
    assert_eq!(rig.backend.member_page_requests.load(Ordering::SeqCst), 10);
}

#[tokio::test]
async fn exactly_the_cap_is_not_truncated() {
    let mut rig = Rig::new().signed_in().await;
    set_members(&rig, 1000);
    let list = read_members(&mut rig).await;
    assert_eq!(list.members.len(), 1000);
    assert!(!list.truncated);
}

#[tokio::test]
async fn a_members_display_role_is_their_highest_that_isnt_the_default() {
    let mut rig = Rig::new().signed_in().await;
    *rig.backend.members.lock().unwrap() = vec![
        member(
            0,
            json!([
                role("Everyone", 0, true),
                role("Admin", 2, false),
                role("Mod", 5, false)
            ]),
        ),
        member(1, json!([role("Everyone", 0, true)])),
    ];
    let list = read_members(&mut rig).await;
    let display = list.members[0].display_role.as_ref().unwrap();
    assert_eq!((display.name.as_str(), display.position), ("Admin", 2));
    assert_eq!(list.members[1].display_role, None);
}

#[tokio::test]
async fn online_comes_from_presence_and_follows_events() {
    let mut rig = Rig::new().signed_in().await;
    set_members(&rig, 2);
    rig.backend
        .bulk_presence
        .lock()
        .unwrap()
        .insert("user-0".into(), true);
    let list = read_members(&mut rig).await;
    assert!(list.members[0].online);
    assert!(!list.members[1].online);

    rig.core
        .ingest(event("userOnline", json!({ "userId": "user-1" })));
    let events = rig.sync();
    assert!(view_changed(
        &events,
        ViewKey::Members {
            community_id: "comm".into()
        }
    ));
    assert!(rig.core.members("comm".into()).unwrap().members[1].online);

    rig.core
        .ingest(event("userOffline", json!({ "userId": "user-0" })));
    assert!(!rig.core.members("comm".into()).unwrap().members[0].online);

    // Someone not listed here wakes nothing.
    rig.sync();
    rig.core
        .ingest(event("userOnline", json!({ "userId": "stranger" })));
    assert!(!view_changed(
        &rig.sync(),
        ViewKey::Members {
            community_id: "comm".into()
        }
    ));
}

#[tokio::test]
async fn a_profile_event_refetches_that_user_only_and_the_list_reads_it() {
    let mut rig = Rig::new().signed_in().await;
    set_members(&rig, 2);
    read_members(&mut rig).await;
    let member_pages = rig.backend.member_page_requests.load(Ordering::SeqCst);
    let users = rig.backend.user_requests.load(Ordering::SeqCst);

    rig.core.ingest(event(
        "userProfileUpdated",
        json!({ "userId": "user-0", "displayName": null, "avatarUrl": null,
                "bannerUrl": null, "bio": null }),
    ));
    let events = rig.settle().await;
    assert_eq!(rig.backend.user_requests.load(Ordering::SeqCst), users + 1);
    assert_eq!(
        rig.backend.member_page_requests.load(Ordering::SeqCst),
        member_pages
    );
    assert!(view_changed(
        &events,
        ViewKey::Members {
            community_id: "comm".into()
        }
    ));
    // `user_json` carries no status, as this user just cleared theirs.
    assert_eq!(
        rig.core.members("comm".into()).unwrap().members[0].status,
        None
    );
}

#[tokio::test]
async fn who_is_listed_refetches_on_membership_and_role_events() {
    for (name, payload) in [
        (
            "memberAddedToCommunity",
            json!({ "communityId": "comm", "userId": "x" }),
        ),
        (
            "userKicked",
            json!({ "communityId": "comm", "userId": "x", "moderatorId": "y" }),
        ),
        (
            "roleAssigned",
            json!({ "communityId": "comm", "userId": "x", "roleId": "r" }),
        ),
    ] {
        let mut rig = Rig::new().signed_in().await;
        set_members(&rig, 1);
        read_members(&mut rig).await;
        let before = rig.backend.member_page_requests.load(Ordering::SeqCst);
        rig.core.ingest(event(name, payload));
        rig.settle().await;
        assert_eq!(
            rig.backend.member_page_requests.load(Ordering::SeqCst),
            before + 1,
            "{name}"
        );
    }
}

#[tokio::test]
async fn a_new_connection_after_a_gap_rereads_members_and_presence() {
    let mut rig = Rig::new().signed_in().await;
    set_members(&rig, 1);
    read_members(&mut rig).await;
    rig.backend
        .bulk_presence
        .lock()
        .unwrap()
        .insert("user-0".into(), true);
    let before = rig.backend.member_page_requests.load(Ordering::SeqCst);
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.settle().await;
    assert_eq!(
        rig.backend.member_page_requests.load(Ordering::SeqCst),
        before + 1
    );
    assert!(rig.core.members("comm".into()).unwrap().members[0].online);
}

// --- The rail ---

#[tokio::test]
async fn rail_counts_add_up_dms_and_follow_notifications() {
    let mut rig = Rig::new().signed_in().await;
    *rig.backend.unread.lock().unwrap() = vec![
        json!({ "directMessageGroupId": "a", "unreadCount": 2, "mentionCount": 0 }),
        json!({ "directMessageGroupId": "b", "unreadCount": 3, "mentionCount": 0 }),
        json!({ "channelId": "c", "unreadCount": 50, "mentionCount": 0 }),
    ];
    *rig.backend.notification_count.lock().unwrap() = 4;
    rig.core.ingest(event("readReceiptUpdated", json!({})));
    rig.core.rail_counts();
    rig.settle().await;
    // Sign-in read unread before this test scripted it, so ask again through a resync.
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    let events = rig.settle().await;
    assert!(view_changed(&events, ViewKey::Rail));
    let counts = rig.core.rail_counts();
    assert_eq!(counts.dm_unread, 5);
    assert_eq!(counts.notifications_unread, 4);

    rig.core.ingest(event(
        "newNotification",
        json!({
            "notificationId": "n1", "type": "THREAD_REPLY", "read": false, "authorId": "a",
            "createdAt": "2026-09-22T18:00:00.000Z", "author": null, "message": null,
            "messageId": null, "channelId": null, "communityId": null, "channelName": null,
            "directMessageGroupId": null,
        }),
    ));
    let events = rig.sync();
    assert!(view_changed(&events, ViewKey::Rail));
    assert_eq!(rig.core.rail_counts().notifications_unread, 5);

    // Read elsewhere: the server's number wins, however many devices said so.
    *rig.backend.notification_count.lock().unwrap() = 1;
    rig.core
        .ingest(event("notificationRead", json!({ "notificationId": "n1" })));
    rig.settle().await;
    assert_eq!(rig.core.rail_counts().notifications_unread, 1);
}

// --- Channels ---

fn capability(channel_id: &str, post: bool) -> Value {
    json!({
        "channelId": channel_id, "view": true, "post": post, "attach": false, "react": true,
        "threadReply": true, "connect": true, "speak": false, "video": false, "share": false,
        "managePermissions": false, "postingRoleNames": ["Admin"],
        "timedOutUntil": "2026-09-22T19:00:00.000Z",
    })
}

fn slow_channel() -> Value {
    json!({
        "id": "a", "name": "a", "communityId": "comm", "type": "TEXT", "position": 1,
        "isPrivate": false, "slowmodeSeconds": 30, "preset": "PUBLIC",
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

#[tokio::test]
async fn a_channel_row_has_slowmode_and_permissions_once_they_load() {
    let rig = Rig::new();
    rig.backend.channels.lock().unwrap().push(slow_channel());
    let mut rig = rig.signed_in().await;
    rig.core.channels("comm".into());
    rig.settle().await;

    // No answer: fail open, by saying nothing.
    let row = rig.core.channels("comm".into()).remove(0);
    assert_eq!(row.slowmode_seconds, 30);
    assert_eq!(row.permissions, None);

    *rig.backend.capabilities.lock().unwrap() = Some(json!({
        "communityId": "comm", "channels": [capability("a", false)],
    }));
    rig.core.channels("comm".into());
    let events = rig.settle().await;
    assert!(view_changed(
        &events,
        ViewKey::Channels {
            community_id: "comm".into()
        }
    ));
    let row = rig.core.channels("comm".into()).remove(0);
    let permissions = row.permissions.unwrap();
    assert!(!permissions.post && permissions.react && permissions.connect);
    assert_eq!(permissions.posting_role_names, ["Admin"]);
    assert!(permissions.timed_out_until_ms.is_some());

    // A role change re-reads them.
    *rig.backend.capabilities.lock().unwrap() = Some(json!({
        "communityId": "comm", "channels": [capability("a", true)],
    }));
    rig.core.ingest(event(
        "roleAssigned",
        json!({ "communityId": "comm", "userId": "me", "roleId": "r" }),
    ));
    rig.settle().await;
    let row = rig.core.channels("comm".into()).remove(0);
    assert!(row.permissions.unwrap().post);
}

// --- Emoji ---

#[tokio::test]
async fn custom_emojis_read_with_their_file_ids() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.emojis.lock().unwrap().push(json!({
        "id": "e1", "communityId": "comm", "name": "wave", "fileId": "f1",
        "createdBy": null, "createdAt": "2026-09-22T18:00:00.000Z",
    }));
    assert!(rig.core.custom_emojis("comm".into()).is_empty());
    let events = rig.settle().await;
    assert!(view_changed(
        &events,
        ViewKey::Mentionables {
            community_id: "comm".into()
        }
    ));
    let emojis = rig.core.custom_emojis("comm".into());
    assert_eq!(emojis[0].file_id, "f1");
    assert_eq!(emojis[0].name, "wave");
}
