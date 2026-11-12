//! W2: sessions and change numbers, direct messages, friends, notifications and the notify decision.

mod common;

use common::*;
use semaphore_core::model::{
    Conversation, FriendshipState, LoadState, NotificationKind, NotificationSettingsPatch,
    NotifyLevel, NotifySound, ViewKey,
};
use semaphore_core::platform::{CoreError, CoreEvent};
use serde_json::{Value, json};
use tokio::sync::oneshot;

const PARENT: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c0001";

// --- Sessions and change numbers ---

/// A change numbered in one session must not be mistaken for one numbered in the next: before W2,
/// sign-out reset the counter, so the old session's answer settled the new session's change.
#[tokio::test]
async fn an_answer_from_before_sign_out_does_not_settle_a_change_after_sign_in() {
    let rig = Rig::new().signed_in().await;
    rig.backend.reading.set_meta(PARENT, false, 2);
    rig.core.thread_info(PARENT.into());
    rig.core.run_until_idle().await;

    let (release_old, gate) = oneshot::channel();
    *rig.backend.reading.subscribe_gate.lock().unwrap() = Some(gate);
    let old = rig.core.set_thread_subscribed(PARENT.into(), true);
    let (_old_result, ()) = tokio::join!(old, async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        rig.core
            .sign_in("http://server".into(), "me".into(), "pw".into())
            .await
            .unwrap();
        rig.core.run_until_idle().await;
        rig.core.thread_info(PARENT.into());
        rig.core.run_until_idle().await;

        let (release_new, gate) = oneshot::channel();
        *rig.backend.reading.subscribe_gate.lock().unwrap() = Some(gate);
        let new = rig.core.set_thread_subscribed(PARENT.into(), false);
        let (new_result, ()) = tokio::join!(new, async {
            tokio::task::yield_now().await;
            release_old.send(()).unwrap();
            for _ in 0..5 {
                tokio::task::yield_now().await;
            }
            assert!(
                !rig.core.thread_info(PARENT.into()).subscribed,
                "the old session's answer settled this session's change"
            );
            release_new.send(()).unwrap();
        });
        new_result.unwrap();
    });
}

// --- Fixtures ---

const ALICE: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c00a1";
const BOB: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c00b2";
const CAROL: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c00c3";
const DM_ALICE: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c0d01";
const GROUP: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c0d02";
const NEW_GROUP: &str = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c0d03";

fn member(user: &str) -> Value {
    json!({
        "id": format!("m-{user}"), "userId": user, "joinedAt": "2026-09-22T18:00:00.000Z",
        "user": { "id": user, "username": format!("user-{}", &user[user.len() - 2..]), "displayName": null, "avatarUrl": null },
    })
}

fn group(
    id: &str,
    is_group: bool,
    name: Option<&str>,
    users: &[&str],
    last: Option<(&str, &str)>,
) -> Value {
    let mut members = vec![member(ME)];
    members.extend(users.iter().map(|user| member(user)));
    json!({
        "id": id, "name": name, "isGroup": is_group, "createdAt": "2026-09-20T10:00:00.000Z",
        "members": members,
        "lastMessage": last.map(|(text, at)| json!({
            "id": format!("last-{id}"), "authorId": users[0], "sentAt": at,
            "spans": [{ "type": "PLAINTEXT", "text": text }],
        })),
    })
}

fn dm_message(id: &str, group: &str, author: &str, text: &str, at: &str) -> Value {
    let mut message = message_json(id, author, text);
    message["channelId"] = Value::Null;
    message["directMessageGroupId"] = json!(group);
    message["sentAt"] = json!(at);
    message
}

fn settings_json(overrides: Value) -> Value {
    let mut settings = json!({
        "id": "s", "userId": ME, "desktopEnabled": true, "playSound": true, "soundType": "default",
        "doNotDisturb": false, "dndStartTime": null, "dndEndTime": null, "dndTimezone": null,
        "defaultChannelLevel": "mentions", "dmNotifications": true,
        "createdAt": "2026-09-20T10:00:00.000Z", "updatedAt": "2026-09-20T10:00:00.000Z",
    });
    for (key, value) in overrides.as_object().cloned().unwrap_or_default() {
        settings[key] = value;
    }
    settings
}

fn notification(
    id: &str,
    kind: &str,
    channel: Option<&str>,
    dm: Option<&str>,
    read: bool,
) -> Value {
    json!({
        "id": id, "userId": ME, "type": kind, "messageId": format!("msg-{id}"),
        "channelId": channel, "directMessageGroupId": dm, "communityId": channel.map(|_| "comm"),
        "authorId": ALICE, "parentMessageId": null, "read": read, "dismissed": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
        "author": { "id": ALICE, "username": "alice", "displayName": "Alice", "avatarUrl": null },
        "message": { "id": format!("msg-{id}"), "spans": [{ "type": "PLAINTEXT", "text": format!("text {id}") }], "channelId": channel, "directMessageGroupId": dm },
    })
}

fn new_notification(
    id: &str,
    kind: &str,
    channel: Option<&str>,
    dm: Option<&str>,
    author: &str,
) -> semaphore_core::realtime::RealtimeEvent {
    event(
        "newNotification",
        json!({
            "notificationId": id, "type": kind, "messageId": format!("msg-{id}"),
            "channelId": channel, "communityId": channel.map(|_| "comm"), "channelName": channel.map(|_| "general"),
            "directMessageGroupId": dm, "authorId": author,
            "author": { "id": author, "username": "alice", "displayName": "Alice", "avatarUrl": null },
            "message": { "id": format!("msg-{id}"), "spans": [{ "type": "PLAINTEXT", "text": "hello there" }], "channelId": channel, "directMessageGroupId": dm },
            "createdAt": "2026-09-22T18:00:00.000Z", "read": false,
        }),
    )
}

fn user_entity(id: &str, name: &str) -> Value {
    json!({ "id": id, "username": name, "role": "USER", "displayName": null })
}

fn request(id: &str, from: &str, to: &str) -> Value {
    json!({
        "id": id, "userAId": from, "userBId": to, "status": "PENDING", "createdAt": "2026-09-22T18:00:00.000Z",
        "userA": user_entity(from, if from == ME { "me" } else { "them" }),
        "userB": user_entity(to, if to == ME { "me" } else { "them" }),
    })
}

fn friend(friendship: &str, user: &str, name: &str) -> Value {
    json!({ "friendshipId": friendship, "id": user, "username": name, "role": "USER", "displayName": null })
}

fn viewed(events: &[CoreEvent], wanted: &ViewKey) -> bool {
    events
        .iter()
        .any(|event| matches!(event, CoreEvent::ViewChanged { view } if view == wanted))
}

fn notifies(events: &[CoreEvent]) -> Vec<semaphore_core::model::OsNotification> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::Notify { notification } => Some(notification.clone()),
            _ => None,
        })
        .collect()
}

fn server_error() -> semaphore_core::backend::BackendError {
    semaphore_core::backend::BackendError {
        status: 500,
        code: semaphore_wire::enums::ErrorCode::Unknown("INTERNAL".into()),
        message: "boom".into(),
        retryable: true,
        retry_after_ms: None,
    }
}

async fn w2_rig() -> Rig {
    w2_unsigned().signed_in().await
}

/// Scripted, not yet signed in: what sign-in reads can still be changed.
fn w2_unsigned() -> Rig {
    let rig = Rig::new();
    rig.backend.w2.answer("settings", settings_json(json!({})));
    rig.backend.w2.answer(
        "dms",
        json!([
            group(
                DM_ALICE,
                false,
                None,
                &[ALICE],
                Some(("hi", "2026-09-22T17:00:00.000Z"))
            ),
            group(
                GROUP,
                true,
                Some("Trip"),
                &[ALICE, BOB],
                Some(("plans", "2026-09-22T16:00:00.000Z"))
            ),
        ]),
    );
    rig.backend
        .w2
        .answer("notifications", json!({ "notifications": [] }));
    rig
}

// --- Direct messages ---

#[tokio::test]
async fn the_dm_list_shows_members_unread_and_presence() {
    let rig = w2_unsigned();
    rig.backend
        .bulk_presence
        .lock()
        .unwrap()
        .insert(ALICE.into(), true);
    rig.backend.unread.lock().unwrap().push(json!({
        "directMessageGroupId": GROUP, "unreadCount": 3, "mentionCount": 1,
    }));
    let rig = rig.signed_in().await;
    assert_eq!(rig.core.dm_list().state, LoadState::Loading);
    rig.core.run_until_idle().await;
    let list = rig.core.dm_list();
    assert_eq!(list.state, LoadState::Ready);
    let ids: Vec<&str> = list.rows.iter().map(|row| row.id.as_str()).collect();
    assert_eq!(ids, [DM_ALICE, GROUP]);
    let (dm, trip) = (&list.rows[0], &list.rows[1]);
    assert_eq!(dm.members.len(), 1, "me left out");
    assert_eq!(dm.members[0].id, ALICE);
    assert!(dm.online && !dm.is_group, "{dm:?}");
    assert_eq!(dm.last_message.as_ref().unwrap().text, "hi");
    assert_eq!((trip.unread, trip.mentions), (3, 1));
    assert_eq!(trip.name.as_deref(), Some("Trip"));
    assert!(!trip.online, "a group is never online");

    rig.events.take();
    rig.core
        .ingest(event("userOffline", json!({ "userId": ALICE })));
    assert!(viewed(&rig.events.take(), &ViewKey::DirectMessages));
    assert!(!rig.core.dm(DM_ALICE.into()).unwrap().online);
    rig.core
        .ingest(event("userOnline", json!({ "userId": ALICE })));
    assert!(rig.core.dm(DM_ALICE.into()).unwrap().online);
}

#[tokio::test]
async fn a_dm_message_moves_its_group_up_and_an_unknown_group_reads_the_list() {
    let rig = w2_rig().await;
    rig.core.dm_list();
    rig.core.run_until_idle().await;
    rig.core.ingest(event(
        "newDirectMessage",
        json!({
            "message": dm_message("m-9", GROUP, BOB, "on my way", "2026-09-22T18:30:00.000Z"),
        }),
    ));
    let list = rig.core.dm_list();
    assert_eq!(list.rows[0].id, GROUP);
    assert_eq!(
        list.rows[0].last_message.as_ref().unwrap().text,
        "on my way"
    );
    assert_eq!(rig.backend.w2.count("dms"), 1, "known group: no refetch");

    rig.core.ingest(event(
        "newDirectMessage",
        json!({
            "message": dm_message("m-10", NEW_GROUP, CAROL, "hello", "2026-09-22T18:31:00.000Z"),
        }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w2.count("dms"), 2, "a new group: read again");
}

fn preview(rig: &Rig, dm_id: &str) -> String {
    rig.core
        .dm(dm_id.into())
        .unwrap()
        .last_message
        .unwrap()
        .text
}

#[tokio::test]
async fn the_preview_follows_an_edit_and_a_delete_over_the_socket() {
    let rig = w2_rig().await;
    rig.core.dm_list();
    rig.core.run_until_idle().await;
    let last = format!("last-{GROUP}");

    // Another message in the group changes nothing.
    rig.core.ingest(event(
        "updateMessage",
        json!({ "message": dm_message("m-old", GROUP, BOB, "older", "2026-09-22T15:00:00.000Z") }),
    ));
    assert_eq!(preview(&rig, GROUP), "plans");

    rig.events.take();
    rig.core.ingest(event(
        "updateMessage",
        json!({ "message": dm_message(&last, GROUP, ALICE, "new plans", "2026-09-22T16:00:00.000Z") }),
    ));
    assert!(viewed(&rig.events.take(), &ViewKey::DirectMessages));
    assert_eq!(preview(&rig, GROUP), "new plans");
    assert_eq!(
        rig.core.dm_list().rows[1].id,
        GROUP,
        "an edit doesn't move the row"
    );

    rig.core.ingest(event(
        "deleteMessage",
        json!({ "messageId": "m-old", "channelId": null, "directMessageGroupId": GROUP }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w2.count("dms"),
        1,
        "not the preview: no refetch"
    );
    rig.core.ingest(event(
        "deleteMessage",
        json!({ "messageId": last, "channelId": null, "directMessageGroupId": GROUP }),
    ));
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w2.count("dms"),
        2,
        "the preview went: the list says what came before it"
    );
}

#[tokio::test]
async fn the_preview_follows_my_own_edit_and_delete() {
    let rig = w2_unsigned();
    let mine = "6f0c3a52-1c1e-4b0e-9d43-2b8a5e0c0e01";
    let mut dms = rig.backend.w2.answers.lock().unwrap()["dms"].clone();
    dms[0]["lastMessage"]["id"] = json!(mine);
    dms[0]["lastMessage"]["authorId"] = json!(ME);
    rig.backend.w2.answer("dms", dms);
    let dto = serde_json::from_value(dm_message(
        mine,
        DM_ALICE,
        ME,
        "hi",
        "2026-09-22T17:00:00.000Z",
    ))
    .unwrap();
    rig.backend
        .messages
        .lock()
        .unwrap()
        .insert(DM_ALICE.into(), vec![dto]);
    let rig = rig.signed_in().await;
    rig.core.dm_list();
    rig.core
        .open_conversation(Conversation::DirectMessage {
            id: DM_ALICE.into(),
        })
        .await
        .unwrap();
    rig.core.run_until_idle().await;

    let draft = semaphore_core::model::MessageDraft {
        text: "hi there".into(),
        ..Default::default()
    };
    rig.core
        .edit_message(mine.into(), draft, None)
        .await
        .unwrap();
    assert_eq!(preview(&rig, DM_ALICE), "hi there");

    rig.core.delete_message(mine.into(), None).await.unwrap();
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w2.count("dms"),
        2,
        "read again for what came before"
    );
}

#[tokio::test]
async fn creating_a_dm_puts_it_first_and_an_existing_one_is_not_repeated() {
    let rig = w2_rig().await;
    rig.core.dm_list();
    rig.core.run_until_idle().await;
    rig.backend
        .w2
        .answer("create_dm", group(DM_ALICE, false, None, &[ALICE], None));
    let id = rig.core.create_dm(vec![ALICE.into()], None).await.unwrap();
    assert_eq!(id, DM_ALICE);
    let list = rig.core.dm_list();
    assert_eq!(list.rows.len(), 2, "the existing DM, not a copy");

    rig.backend.w2.answer(
        "create_dm",
        group(NEW_GROUP, true, Some("Crew"), &[BOB, CAROL], None),
    );
    let id = rig
        .core
        .create_dm(vec![BOB.into(), CAROL.into()], Some("  Crew ".into()))
        .await
        .unwrap();
    assert_eq!(id, NEW_GROUP);
    assert_eq!(rig.core.dm_list().rows[0].id, NEW_GROUP);
    assert!(
        rig.backend
            .w2
            .calls()
            .contains(&format!("create_dm {BOB},{CAROL} Crew"))
    );

    let error = rig
        .core
        .create_dm(vec!["bob".into()], None)
        .await
        .unwrap_err();
    assert!(matches!(error, CoreError::Failed { .. }));
    assert_eq!(
        rig.backend.w2.count("create_dm"),
        2,
        "a bad id never reaches the server"
    );
}

#[tokio::test]
async fn leaving_a_group_takes_it_off_the_list_and_adding_members_updates_it() {
    let rig = w2_rig().await;
    rig.core.dm_list();
    rig.core.run_until_idle().await;
    rig.backend.w2.answer(
        "add_members",
        group(GROUP, true, Some("Trip"), &[ALICE, BOB, CAROL], None),
    );
    rig.core
        .add_dm_members(GROUP.into(), vec![CAROL.into()])
        .await
        .unwrap();
    assert_eq!(rig.core.dm(GROUP.into()).unwrap().members.len(), 3);
    rig.backend.w2.answer("leave_dm", Value::Null);
    rig.core.leave_dm(GROUP.into()).await.unwrap();
    assert!(rig.core.dm(GROUP.into()).is_none());
    assert_eq!(rig.core.dm_list().rows.len(), 1);
}

#[tokio::test]
async fn a_failed_dm_list_reads_as_failed_until_retried() {
    let rig = w2_rig().await;
    rig.backend.w2.fail_next("dms", server_error());
    rig.core.dm_list();
    rig.core.run_until_idle().await;
    assert!(matches!(rig.core.dm_list().state, LoadState::Failed { .. }));
    assert!(matches!(
        rig.core.load_state(ViewKey::DirectMessages),
        LoadState::Failed { .. }
    ));
    rig.core.retry_failed();
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.dm_list().state, LoadState::Ready);
}

/// A list fetched for one session, answering after the next has begun, isn't the next one's.
#[tokio::test]
async fn a_fetch_from_before_sign_out_is_not_cached_for_the_next_session() {
    let rig = w2_rig().await;
    let release = rig.backend.w2.hold("dms");
    rig.core.dm_list();
    let (_, ()) = tokio::join!(rig.core.run_until_idle(), async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        rig.backend.w2.answer("dms", json!([]));
        rig.core
            .sign_in("http://server".into(), "me".into(), "pw".into())
            .await
            .unwrap();
        // The old session's fetch, answering now with the old session's list.
        rig.backend.w2.answer(
            "dms",
            json!([group(GROUP, true, Some("Old"), &[ALICE, BOB], None)]),
        );
        release.send(()).unwrap();
    });
    rig.backend.w2.answer("dms", json!([]));
    rig.core.dm_list();
    rig.core.run_until_idle().await;
    assert!(
        rig.core.dm_list().rows.is_empty(),
        "the old session's answer was cached"
    );
}

#[tokio::test]
async fn user_search_leaves_me_out() {
    let rig = w2_rig().await;
    rig.backend.w2.answer(
        "search_users",
        json!([user_entity(ME, "me"), user_entity(ALICE, "alice")]),
    );
    let users = rig.core.search_users("al".into(), None).await.unwrap();
    assert_eq!(users.len(), 1);
    assert_eq!(users[0].id, ALICE);
}

// --- Friends ---

fn script_friends(rig: &Rig) {
    rig.backend
        .w2
        .answer("friends", json!([friend("f-1", ALICE, "alice")]));
    rig.backend.w2.answer(
        "requests",
        json!({
            "sent": [request("r-out", ME, CAROL)],
            "received": [request("r-in", BOB, ME)],
        }),
    );
}

#[tokio::test]
async fn friends_and_requests_both_ways() {
    let rig = w2_rig().await;
    script_friends(&rig);
    rig.backend
        .bulk_presence
        .lock()
        .unwrap()
        .insert(ALICE.into(), true);
    rig.core.friends();
    rig.core.run_until_idle().await;
    let view = rig.core.friends();
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(view.friends[0].user.id, ALICE);
    assert!(view.friends[0].online);
    assert_eq!(
        view.incoming[0].user.id, BOB,
        "an incoming request shows its sender"
    );
    assert_eq!(
        view.outgoing[0].user.id, CAROL,
        "an outgoing one who it went to"
    );
}

#[tokio::test]
async fn accepting_shows_busy_then_settles_from_the_server() {
    let rig = w2_rig().await;
    script_friends(&rig);
    rig.core.friends();
    rig.core.run_until_idle().await;
    rig.backend.w2.answer("accept", json!({
        "id": "r-in", "userAId": BOB, "userBId": ME, "status": "ACCEPTED", "createdAt": "2026-09-22T18:00:00.000Z",
    }));
    let release = rig.backend.w2.hold("accept");
    let (result, ()) = tokio::join!(rig.core.accept_friend_request("r-in".into()), async {
        tokio::task::yield_now().await;
        assert!(rig.core.friends().incoming[0].busy);
        rig.backend.w2.answer(
            "requests",
            json!({ "sent": [request("r-out", ME, CAROL)], "received": [] }),
        );
        rig.backend.w2.answer(
            "friends",
            json!([friend("f-1", ALICE, "alice"), friend("r-in", BOB, "bob")]),
        );
        release.send(()).unwrap();
    });
    result.unwrap();
    assert!(rig.core.friends().incoming.is_empty(), "gone at once");
    rig.core.run_until_idle().await;
    let view = rig.core.friends();
    assert_eq!(view.friends.len(), 2, "read again");
    assert!(view.friends.iter().all(|row| !row.busy));
}

#[tokio::test]
async fn a_refused_decline_keeps_the_request() {
    let rig = w2_rig().await;
    script_friends(&rig);
    rig.core.friends();
    rig.core.run_until_idle().await;
    rig.backend.w2.fail_next("decline", server_error());
    assert!(
        rig.core
            .decline_friend_request("r-in".into())
            .await
            .is_err()
    );
    let view = rig.core.friends();
    assert_eq!(view.incoming.len(), 1);
    assert!(!view.incoming[0].busy);
}

#[tokio::test]
async fn friends_older_than_thirty_seconds_are_read_again() {
    let rig = w2_rig().await;
    script_friends(&rig);
    rig.core.friends();
    rig.core.run_until_idle().await;
    rig.core.friends();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w2.count("friends"), 1);
    rig.clock.advance(31_000);
    rig.core.friends();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w2.count("friends"), 2);
}

#[tokio::test]
async fn friendship_status_reads_both_directions() {
    let rig = w2_rig().await;
    rig.backend.w2.answer(
        "friendship_status",
        json!({ "status": "PENDING", "direction": "received", "friendshipId": "r-in" }),
    );
    assert_eq!(
        rig.core.friendship_status(BOB.into()).await.unwrap(),
        FriendshipState::RequestReceived {
            friendship_id: "r-in".into()
        }
    );
    rig.backend.w2.answer(
        "friendship_status",
        json!({ "status": null, "direction": null, "friendshipId": null }),
    );
    assert_eq!(
        rig.core.friendship_status(BOB.into()).await.unwrap(),
        FriendshipState::None
    );
}

// --- Notifications ---

fn script_notifications(rig: &Rig, rows: Vec<Value>) {
    rig.backend
        .w2
        .answer("notifications", json!({ "notifications": rows }));
}

#[tokio::test]
async fn the_centre_asks_for_undismissed_rows_and_pages() {
    let rig = w2_rig().await;
    let mut rows: Vec<Value> = (0..60)
        .map(|n| {
            notification(
                &format!("n-{n}"),
                "USER_MENTION",
                Some(CHANNEL),
                None,
                n % 2 == 0,
            )
        })
        .collect();
    // The server leaves a dismissed row out of its pages (`includeDismissed=false`), so neither
    // page holds one, and the second begins where the first ended.
    rows[1]["dismissed"] = json!(true);
    script_notifications(&rig, rows);
    rig.core.notifications();
    rig.core.run_until_idle().await;
    let list = rig.core.notifications();
    assert_eq!(list.state, LoadState::Ready);
    assert_eq!(
        list.rows.len(),
        50,
        "a page of 50, the dismissed one left out"
    );
    assert!(list.has_more);
    assert_eq!(list.rows[0].kind, NotificationKind::Mention);
    assert_eq!(list.rows[0].author.display_name.as_deref(), Some("Alice"));
    assert_eq!(list.rows[0].preview, "text n-0");
    rig.core.load_more_notifications().await.unwrap();
    let list = rig.core.notifications();
    assert_eq!(list.rows.len(), 59, "the other 59");
    assert!(!list.has_more);
}

#[tokio::test]
async fn a_row_carries_the_servers_channel_name_and_thread_parent() {
    let rig = w2_rig().await;
    let mut row = notification("n-1", "THREAD_REPLY", Some(CHANNEL), None, false);
    row["channelName"] = json!("general");
    row["parentMessageId"] = json!("parent-1");
    script_notifications(&rig, vec![row]);
    rig.core.notifications();
    rig.core.run_until_idle().await;
    let list = rig.core.notifications();
    assert_eq!(
        list.rows[0].channel_name.as_deref(),
        Some("general"),
        "from the row: the channel list isn't loaded here"
    );
    assert_eq!(list.rows[0].parent_message_id.as_deref(), Some("parent-1"));
}

#[tokio::test]
async fn a_new_notifications_thread_parent_reaches_the_row_and_the_raise() {
    let rig = w2_rig().await;
    rig.core.notifications();
    rig.core.run_until_idle().await;
    rig.events.take();
    rig.core.ingest(event(
        "newNotification",
        json!({
            "notificationId": "n-1", "type": "THREAD_REPLY", "messageId": "msg-n-1",
            "channelId": CHANNEL, "communityId": "comm", "channelName": "general",
            "directMessageGroupId": null, "authorId": ALICE, "parentMessageId": "parent-1",
            "author": { "id": ALICE, "username": "alice", "displayName": "Alice", "avatarUrl": null },
            "message": { "id": "msg-n-1", "spans": [{ "type": "PLAINTEXT", "text": "a reply" }], "channelId": CHANNEL, "directMessageGroupId": null },
            "createdAt": "2026-09-22T18:00:00.000Z", "read": false,
        }),
    ));
    let raised = notifies(&rig.events.take());
    assert_eq!(raised.len(), 1);
    assert_eq!(raised[0].parent_message_id.as_deref(), Some("parent-1"));
    let list = rig.core.notifications();
    assert_eq!(list.rows[0].parent_message_id.as_deref(), Some("parent-1"));
    assert_eq!(list.rows[0].channel_name.as_deref(), Some("general"));
}

#[tokio::test]
async fn a_dismissed_notification_leaves_the_centre() {
    let rig = w2_rig().await;
    script_notifications(
        &rig,
        vec![
            notification("n-1", "USER_MENTION", Some(CHANNEL), None, false),
            notification("n-2", "USER_MENTION", Some(CHANNEL), None, false),
        ],
    );
    rig.core.notifications();
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.notifications().rows.len(), 2);
    rig.backend.w2.answer(
        "dismiss",
        notification("n-1", "USER_MENTION", Some(CHANNEL), None, false),
    );
    rig.core.dismiss_notification("n-1".into()).await.unwrap();
    let ids: Vec<String> = rig
        .core
        .notifications()
        .rows
        .into_iter()
        .map(|row| row.id)
        .collect();
    assert_eq!(ids, vec!["n-2"]);
}

#[tokio::test]
async fn a_new_notification_joins_the_centre_and_raises_once() {
    let rig = w2_rig().await;
    rig.core.notifications();
    rig.core.run_until_idle().await;
    rig.events.take();
    rig.core.ingest(new_notification(
        "n-1",
        "DIRECT_MESSAGE",
        None,
        Some(GROUP),
        ALICE,
    ));
    rig.core.ingest(new_notification(
        "n-1",
        "DIRECT_MESSAGE",
        None,
        Some(GROUP),
        ALICE,
    ));
    let raised = notifies(&rig.events.take());
    assert_eq!(raised.len(), 1, "once per id");
    let shown = &raised[0];
    assert_eq!(shown.tag, format!("dm:{GROUP}"));
    assert_eq!(shown.body, "hello there");
    assert_eq!(shown.sound, Some(NotifySound::Dm));
    assert_eq!(
        shown.link.conversation,
        Conversation::DirectMessage { id: GROUP.into() }
    );
    assert_eq!(rig.core.notifications().rows.len(), 1);

    rig.core.ingest(new_notification(
        "n-2",
        "USER_MENTION",
        Some(CHANNEL),
        None,
        ALICE,
    ));
    let raised = notifies(&rig.events.take());
    assert_eq!(raised[0].title, "Alice mentioned you in #general");
    assert_eq!(raised[0].tag, format!("channel:{CHANNEL}"));
}

#[tokio::test]
async fn nothing_is_raised_for_the_conversation_on_screen_or_my_own_message() {
    let rig = w2_rig().await.open_channel(vec![]).await;
    rig.events.take();
    rig.core.ingest(new_notification(
        "n-1",
        "USER_MENTION",
        Some(CHANNEL),
        None,
        ALICE,
    ));
    assert!(notifies(&rig.events.take()).is_empty(), "focused on it");
    rig.core.set_focused(false);
    rig.core.ingest(new_notification(
        "n-2",
        "USER_MENTION",
        Some(CHANNEL),
        None,
        ALICE,
    ));
    assert_eq!(notifies(&rig.events.take()).len(), 1, "not focused");
    rig.core.ingest(new_notification(
        "n-3",
        "DIRECT_MESSAGE",
        None,
        Some(GROUP),
        ME,
    ));
    assert!(notifies(&rig.events.take()).is_empty(), "my own");
}

#[tokio::test]
async fn do_not_disturb_and_a_muted_channel_raise_nothing() {
    let rig = w2_rig().await;
    rig.backend
        .w2
        .answer("settings", settings_json(json!({ "doNotDisturb": true })));
    rig.core.invalidate(&semaphore_core::QueryKey::new(&[
        "notificationsControllerGetSettings",
    ]));
    rig.core.run_until_idle().await;
    rig.events.take();
    rig.core.ingest(new_notification(
        "n-1",
        "DIRECT_MESSAGE",
        None,
        Some(GROUP),
        ALICE,
    ));
    assert!(notifies(&rig.events.take()).is_empty(), "DND");

    rig.backend.w2.answer("settings", settings_json(json!({})));
    rig.core.invalidate(&semaphore_core::QueryKey::new(&[
        "notificationsControllerGetSettings",
    ]));
    rig.backend.w2.answer(
        "channel_level",
        json!({
            "id": "o", "userId": ME, "channelId": CHANNEL, "level": "none",
            "createdAt": "2026-09-20T10:00:00.000Z", "updatedAt": "2026-09-20T10:00:00.000Z",
        }),
    );
    rig.core.channel_notify_level(CHANNEL.into());
    rig.core.run_until_idle().await;
    rig.events.take();
    rig.core.ingest(new_notification(
        "n-2",
        "USER_MENTION",
        Some(CHANNEL),
        None,
        ALICE,
    ));
    assert!(notifies(&rig.events.take()).is_empty(), "muted");
}

#[tokio::test]
async fn marking_read_shows_at_once_and_a_refusal_puts_it_back() {
    let rig = w2_rig().await;
    script_notifications(
        &rig,
        vec![notification(
            "n-1",
            "USER_MENTION",
            Some(CHANNEL),
            None,
            false,
        )],
    );
    rig.core.notifications();
    rig.core.run_until_idle().await;
    rig.backend.w2.fail_next("mark_read", server_error());
    let release = rig.backend.w2.hold("mark_read");
    let (result, ()) = tokio::join!(rig.core.mark_notification_read("n-1".into()), async {
        tokio::task::yield_now().await;
        assert!(rig.core.notifications().rows[0].read, "optimistic");
        release.send(()).unwrap();
    });
    assert!(result.is_err());
    assert!(!rig.core.notifications().rows[0].read, "rolled back");
}

/// The event for a change can beat the change's own answer: then the server has spoken, and a
/// failed answer (a timeout after it applied the change) must not undo it.
#[tokio::test]
async fn a_read_event_before_a_failed_answer_keeps_it_read() {
    let rig = w2_rig().await;
    script_notifications(
        &rig,
        vec![notification(
            "n-1",
            "USER_MENTION",
            Some(CHANNEL),
            None,
            false,
        )],
    );
    rig.core.notifications();
    rig.core.run_until_idle().await;
    rig.backend.w2.fail_next("mark_read", server_error());
    let release = rig.backend.w2.hold("mark_read");
    let (result, ()) = tokio::join!(rig.core.mark_notification_read("n-1".into()), async {
        tokio::task::yield_now().await;
        rig.core.ingest(event(
            "notificationRead",
            json!({ "notificationId": "n-1" }),
        ));
        release.send(()).unwrap();
    });
    assert!(result.is_err());
    assert!(rig.core.notifications().rows[0].read);
}

#[tokio::test]
async fn an_answer_then_its_event_is_still_one_read() {
    let rig = w2_rig().await;
    script_notifications(
        &rig,
        vec![notification(
            "n-1",
            "USER_MENTION",
            Some(CHANNEL),
            None,
            false,
        )],
    );
    rig.core.notifications();
    rig.core.run_until_idle().await;
    rig.backend.w2.answer(
        "mark_read",
        notification("n-1", "USER_MENTION", Some(CHANNEL), None, true),
    );
    rig.core.mark_notification_read("n-1".into()).await.unwrap();
    rig.core.ingest(event(
        "notificationRead",
        json!({ "notificationId": "n-1" }),
    ));
    assert!(rig.core.notifications().rows[0].read);
}

#[tokio::test]
async fn mark_all_shows_zero_meanwhile_and_withdraws_what_was_raised() {
    let rig = w2_unsigned();
    *rig.backend.notification_count.lock().unwrap() = 4;
    let rig = rig.signed_in().await;
    rig.core.badge_count();
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.badge_count(), 4);
    rig.core.ingest(new_notification(
        "n-1",
        "DIRECT_MESSAGE",
        None,
        Some(GROUP),
        ALICE,
    ));
    rig.events.take();
    rig.backend
        .w2
        .answer("mark_all_read", json!({ "count": 0 }));
    let release = rig.backend.w2.hold("mark_all_read");
    let (result, ()) = tokio::join!(rig.core.mark_all_notifications_read(), async {
        tokio::task::yield_now().await;
        assert_eq!(rig.core.badge_count(), 0);
        *rig.backend.notification_count.lock().unwrap() = 0;
        release.send(()).unwrap();
    });
    result.unwrap();
    let events = rig.events.take();
    assert!(events.iter().any(|event| matches!(event, CoreEvent::WithdrawNotifications { tag } if *tag == format!("dm:{GROUP}"))));
    assert!(viewed(&events, &ViewKey::Badge));
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.badge_count(), 0);
}

#[tokio::test]
async fn reading_a_conversation_reads_its_notifications_and_withdraws_them() {
    let rig = w2_rig().await;
    script_notifications(
        &rig,
        vec![
            notification("n-1", "DIRECT_MESSAGE", None, Some(GROUP), false),
            notification("n-2", "USER_MENTION", Some(CHANNEL), None, false),
        ],
    );
    rig.core.notifications();
    rig.core.run_until_idle().await;
    rig.core.ingest(new_notification(
        "n-3",
        "DIRECT_MESSAGE",
        None,
        Some(GROUP),
        ALICE,
    ));
    rig.events.take();
    let counts_before = rig
        .backend
        .notification_requests
        .load(std::sync::atomic::Ordering::SeqCst);
    rig.core.ingest(event(
        "readReceiptUpdated",
        json!({
            "channelId": null, "directMessageGroupId": GROUP, "lastReadMessageId": "msg-n-3",
            "lastReadAt": "2026-09-22T18:40:00.000Z",
        }),
    ));
    let events = rig.events.take();
    assert!(events.iter().any(|event| matches!(event, CoreEvent::WithdrawNotifications { tag } if *tag == format!("dm:{GROUP}"))));
    let rows = rig.core.notifications().rows;
    assert!(
        rows.iter()
            .filter(|row| row.id != "n-2")
            .all(|row| row.read)
    );
    assert!(
        !rows.iter().find(|row| row.id == "n-2").unwrap().read,
        "another conversation"
    );
    rig.core.run_until_idle().await;
    assert!(
        rig.backend
            .notification_requests
            .load(std::sync::atomic::Ordering::SeqCst)
            > counts_before,
        "the count is read again"
    );

    // A peer's read of the same DM changes nothing of mine.
    rig.core.ingest(new_notification(
        "n-4",
        "DIRECT_MESSAGE",
        None,
        Some(GROUP),
        ALICE,
    ));
    rig.core.ingest(event(
        "readReceiptUpdated",
        json!({
            "channelId": null, "directMessageGroupId": GROUP, "lastReadMessageId": "msg-n-4",
            "lastReadAt": "2026-09-22T18:41:00.000Z", "userId": ALICE,
        }),
    ));
    assert!(
        !rig.core
            .notifications()
            .rows
            .iter()
            .find(|row| row.id == "n-4")
            .unwrap()
            .read
    );
}

#[tokio::test]
async fn a_refused_settings_change_puts_back_only_its_own_fields() {
    let rig = w2_rig().await;
    rig.core.notification_settings();
    rig.core.run_until_idle().await;
    rig.backend.w2.fail_next("update_settings", server_error());
    let release_first = rig.backend.w2.hold("update_settings");
    let first = rig
        .core
        .update_notification_settings(NotificationSettingsPatch {
            dnd: Some(true),
            ..Default::default()
        });
    let (first_result, ()) = tokio::join!(first, async {
        tokio::task::yield_now().await;
        let second_answer = settings_json(json!({ "playSound": false }));
        rig.backend.w2.answer("update_settings", second_answer);
        let release_second = rig.backend.w2.hold("update_settings");
        let second = rig
            .core
            .update_notification_settings(NotificationSettingsPatch {
                play_sound: Some(false),
                ..Default::default()
            });
        let (second_result, ()) = tokio::join!(second, async {
            tokio::task::yield_now().await;
            let shown = rig.core.notification_settings().settings;
            assert!(shown.dnd && !shown.play_sound, "both shown");
            release_first.send(()).unwrap();
            for _ in 0..5 {
                tokio::task::yield_now().await;
            }
            let shown = rig.core.notification_settings().settings;
            assert!(!shown.dnd, "the refused change went back");
            assert!(!shown.play_sound, "the other is still shown");
            release_second.send(()).unwrap();
        });
        second_result.unwrap();
    });
    assert!(first_result.is_err());
    let shown = rig.core.notification_settings().settings;
    assert!(!shown.dnd && !shown.play_sound);
    let body = rig
        .backend
        .w2
        .calls()
        .into_iter()
        .find(|call| call.contains("playSound"))
        .unwrap();
    assert!(
        !body.contains("doNotDisturb"),
        "only the fields the change sets: {body}"
    );
}

#[tokio::test]
async fn clearing_a_dnd_time_sends_null_and_a_bad_time_is_refused_here() {
    let rig = w2_rig().await;
    rig.backend
        .w2
        .answer("update_settings", settings_json(json!({})));
    rig.core
        .update_notification_settings(NotificationSettingsPatch {
            dnd_start: Some(String::new()),
            dnd_end: Some(String::new()),
            dnd_timezone: Some(String::new()),
            ..Default::default()
        })
        .await
        .unwrap();
    let body = rig
        .backend
        .w2
        .calls()
        .into_iter()
        .find(|call| call.starts_with("update_settings"))
        .expect("the change reached the server");
    for field in [
        r#""dndStartTime":null"#,
        r#""dndEndTime":null"#,
        r#""dndTimezone":null"#,
    ] {
        assert!(body.contains(field), "{field} in {body}");
    }
    let error = rig
        .core
        .update_notification_settings(NotificationSettingsPatch {
            dnd_end: Some("8am".into()),
            ..Default::default()
        })
        .await;
    assert!(error.is_err());
    assert_eq!(rig.backend.w2.count("update_settings"), 1);
}

#[tokio::test]
async fn a_channel_level_shows_at_once_and_clearing_it_follows_the_default() {
    let rig = w2_rig().await;
    rig.backend.w2.answer("channel_level", Value::Null);
    rig.core.channel_notify_level(CHANNEL.into());
    rig.core.run_until_idle().await;
    let view = rig.core.channel_notify_level(CHANNEL.into());
    assert_eq!(
        (view.state.clone(), view.level, view.effective),
        (LoadState::Ready, None, NotifyLevel::Mentions)
    );
    rig.backend.w2.answer(
        "set_channel_level",
        json!({
            "id": "o", "userId": ME, "channelId": CHANNEL, "level": "all",
            "createdAt": "2026-09-20T10:00:00.000Z", "updatedAt": "2026-09-20T10:00:00.000Z",
        }),
    );
    rig.core
        .set_channel_notify_level(CHANNEL.into(), Some(NotifyLevel::All))
        .await
        .unwrap();
    assert_eq!(
        rig.core.channel_notify_level(CHANNEL.into()).effective,
        NotifyLevel::All
    );
    assert!(
        rig.backend
            .w2
            .calls()
            .contains(&format!("set_channel_level {CHANNEL} all"))
    );
    rig.backend.w2.answer("clear_channel_level", Value::Null);
    rig.core
        .set_channel_notify_level(CHANNEL.into(), None)
        .await
        .unwrap();
    let view = rig.core.channel_notify_level(CHANNEL.into());
    assert_eq!((view.level, view.effective), (None, NotifyLevel::Mentions));

    rig.backend
        .w2
        .fail_next("set_channel_level", server_error());
    assert!(
        rig.core
            .set_channel_notify_level(CHANNEL.into(), Some(NotifyLevel::Muted))
            .await
            .is_err()
    );
    assert_eq!(
        rig.core.channel_notify_level(CHANNEL.into()).level,
        None,
        "rolled back"
    );
}

#[tokio::test]
async fn an_answer_after_sign_out_changes_nothing() {
    let rig = w2_rig().await;
    script_notifications(
        &rig,
        vec![notification(
            "n-1",
            "USER_MENTION",
            Some(CHANNEL),
            None,
            false,
        )],
    );
    rig.core.notifications();
    rig.core.run_until_idle().await;
    rig.backend.w2.answer(
        "mark_read",
        notification("n-1", "USER_MENTION", Some(CHANNEL), None, true),
    );
    let release = rig.backend.w2.hold("mark_read");
    let (result, ()) = tokio::join!(rig.core.mark_notification_read("n-1".into()), async {
        tokio::task::yield_now().await;
        rig.core.sign_out().await.unwrap();
        release.send(()).unwrap();
    });
    result.unwrap();
    assert_eq!(rig.core.badge_count(), 0);
    assert!(rig.core.notifications().rows.is_empty());
}

#[tokio::test]
async fn the_badge_follows_the_count_and_is_zero_signed_out() {
    let rig = w2_unsigned();
    *rig.backend.notification_count.lock().unwrap() = 2;
    let rig = rig.signed_in().await;
    rig.core.badge_count();
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.badge_count(), 2);
    rig.events.take();
    rig.core.ingest(new_notification(
        "n-1",
        "USER_MENTION",
        Some(CHANNEL),
        None,
        ALICE,
    ));
    assert!(viewed(&rig.events.take(), &ViewKey::Badge));
    assert_eq!(rig.core.badge_count(), 3);
    rig.core.sign_out().await.unwrap();
    assert!(viewed(&rig.events.take(), &ViewKey::Badge));
    assert_eq!(rig.core.badge_count(), 0);
}

// --- Presence ---

#[tokio::test]
async fn going_idle_tells_the_transport_and_the_server_once() {
    let rig = w2_rig().await;
    rig.core.set_idle(true);
    rig.core.set_idle(true);
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.realtime
            .calls()
            .iter()
            .filter(|call| *call == "set_idle(true)")
            .count(),
        2
    );
    let sent: Vec<(String, Value)> = rig.realtime.emitted.lock().unwrap().clone();
    let idle: Vec<&Value> = sent
        .iter()
        .filter(|(name, _)| name == "presenceOnline")
        .map(|(_, payload)| payload)
        .collect();
    assert_eq!(idle, [&json!({ "idle": true })]);
    rig.core.set_idle(false);
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.realtime.emitted.lock().unwrap().last().unwrap().1,
        json!({ "idle": false })
    );
}
