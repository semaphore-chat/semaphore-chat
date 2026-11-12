//! Auto-marking a conversation's notifications read as it opens, the web's
//! `useAutoMarkNotificationsRead`, and what it leaves alone.

mod common;

use common::*;
use semaphore_core::model::Conversation;
use semaphore_core::realtime::RealtimeEvent;
use serde_json::{Value, json};

const OTHER_CHANNEL: &str = "chan-other";

fn notification(id: &str, channel: Option<&str>, dm: Option<&str>, read: bool) -> Value {
    json!({
        "id": id, "userId": ME, "type": "USER_MENTION", "messageId": format!("msg-{id}"),
        "channelId": channel, "directMessageGroupId": dm,
        "communityId": channel.map(|_| "comm"),
        "authorId": "u-ava", "parentMessageId": null, "read": read, "dismissed": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
        "author": { "id": "u-ava", "username": "ava", "displayName": "Ava", "avatarUrl": null },
        "message": {
            "id": format!("msg-{id}"),
            "spans": [{ "type": "PLAINTEXT", "text": format!("text {id}") }],
            "channelId": channel, "directMessageGroupId": dm,
        },
    })
}

fn settings_json() -> Value {
    json!({
        "id": "s", "userId": ME, "desktopEnabled": true, "playSound": true, "soundType": "default",
        "doNotDisturb": false, "dndStartTime": null, "dndEndTime": null, "dndTimezone": null,
        "defaultChannelLevel": "mentions", "dmNotifications": true,
        "createdAt": "2026-09-20T10:00:00.000Z", "updatedAt": "2026-09-20T10:00:00.000Z",
    })
}

/// Signed in with these rows in the centre, and a channel of one message.
async fn rig_with(rows: Vec<Value>) -> Rig {
    let rig = Rig::new();
    rig.backend.w2.answer("settings", settings_json());
    rig.backend
        .w2
        .answer("notifications", json!({ "notifications": rows }));
    rig.backend
        .w2
        .answer("mark_read", notification("any", Some(CHANNEL), None, true));
    let rig = rig
        .open_channel(vec![message("m1", "u-ava", "hello")])
        .await
        .signed_in()
        .await;
    rig.core.open_conversation(channel()).await.unwrap();
    rig
}

fn read_ids(rig: &Rig) -> Vec<String> {
    rig.backend
        .w2
        .calls()
        .into_iter()
        .filter_map(|call| call.strip_prefix("mark_read ").map(str::to_owned))
        .collect()
}

#[tokio::test]
async fn opening_a_conversation_reads_its_unread_notifications_and_no_others() {
    let rig = rig_with(vec![
        notification("n-1", Some(CHANNEL), None, false),
        notification("n-2", Some(OTHER_CHANNEL), None, false),
        notification("n-3", Some(CHANNEL), None, true),
        // A DM's notification in the same centre is not this channel's.
        notification("n-4", None, Some("dm-1"), false),
    ])
    .await;
    rig.core.run_until_idle().await;
    assert_eq!(read_ids(&rig), vec!["n-1".to_owned()]);
    let rows = rig.core.notifications().rows;
    let row = |id: &str| rows.iter().find(|row| row.id == id).unwrap().read;
    assert!(row("n-1"));
    assert!(!row("n-2"), "another channel's stays unread");
    assert!(!row("n-4"), "another conversation's stays unread");
}

#[tokio::test]
async fn a_notification_arriving_while_the_conversation_is_open_is_read_at_once() {
    let rig = rig_with(vec![]).await;
    rig.core.run_until_idle().await;
    assert!(read_ids(&rig).is_empty());

    rig.core.ingest(RealtimeEvent::Event {
        name: "newNotification".into(),
        payload: json!({
            "notificationId": "n-9", "type": "USER_MENTION", "messageId": "msg-9",
            "channelId": CHANNEL, "communityId": "comm", "channelName": "general",
            "authorId": "u-ava",
            "author": { "id": "u-ava", "username": "ava", "displayName": "Ava", "avatarUrl": null },
            "createdAt": "2026-09-22T18:00:00.000Z", "read": false,
            "message": { "id": "msg-9", "channelId": CHANNEL,
                "spans": [{ "type": "PLAINTEXT", "text": "look" }] },
        }),
    });
    rig.core.run_until_idle().await;
    assert_eq!(read_ids(&rig), vec!["n-9".to_owned()]);
    assert!(rig.core.notifications().rows[0].read);
}

#[tokio::test]
async fn a_notification_arriving_elsewhere_stays_unread() {
    let rig = rig_with(vec![]).await;
    rig.core.run_until_idle().await;
    rig.core.ingest(RealtimeEvent::Event {
        name: "newNotification".into(),
        payload: json!({
            "notificationId": "n-8", "type": "USER_MENTION", "messageId": "msg-8",
            "channelId": OTHER_CHANNEL, "communityId": "comm", "channelName": "other",
            "authorId": "u-ava",
            "author": { "id": "u-ava", "username": "ava", "displayName": "Ava", "avatarUrl": null },
            "createdAt": "2026-09-22T18:00:00.000Z", "read": false,
        }),
    });
    rig.core.run_until_idle().await;
    assert!(read_ids(&rig).is_empty());
    assert!(!rig.core.notifications().rows[0].read);
}

#[tokio::test]
async fn a_failed_auto_mark_is_tried_again_on_the_next_open() {
    let rig = rig_with(vec![]).await;
    rig.core.run_until_idle().await;
    rig.backend.w2.fail_next(
        "mark_read",
        semaphore_core::backend::BackendError {
            status: 500,
            code: semaphore_wire::enums::ErrorCode::Unknown("INTERNAL".into()),
            message: "boom".into(),
            retryable: true,
            retry_after_ms: None,
        },
    );
    // One arrives in the open conversation: the auto-mark tries it, and the server refuses.
    rig.core.ingest(RealtimeEvent::Event {
        name: "newNotification".into(),
        payload: json!({
            "notificationId": "n-5", "type": "USER_MENTION", "messageId": "msg-5",
            "channelId": CHANNEL, "communityId": "comm", "channelName": "general",
            "authorId": "u-ava",
            "author": { "id": "u-ava", "username": "ava", "displayName": "Ava", "avatarUrl": null },
            "createdAt": "2026-09-22T18:00:00.000Z", "read": false,
        }),
    });
    rig.core.run_until_idle().await;
    assert!(
        !rig.core.notifications().rows[0].read,
        "the failed one went back"
    );
    assert_eq!(read_ids(&rig).iter().filter(|id| *id == "n-5").count(), 1);

    // Opening the conversation again tries it once more, and this time it lands.
    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;
    assert!(rig.core.notifications().rows[0].read);
    assert_eq!(read_ids(&rig).iter().filter(|id| *id == "n-5").count(), 2);
}

#[tokio::test]
async fn the_list_is_read_once_a_session_and_then_its_rows_are_marked() {
    let rig = rig_with(vec![notification("n-1", Some(CHANNEL), None, false)]).await;
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.backend.w2.count("notifications"),
        1,
        "the open read the centre, since nothing was loaded yet"
    );
    assert_eq!(read_ids(&rig), vec!["n-1".to_owned()]);

    // Another open of the same conversation reads nothing again.
    rig.core.open_conversation(channel()).await.unwrap();
    rig.core.run_until_idle().await;
    assert_eq!(rig.backend.w2.count("notifications"), 1);
}

#[tokio::test]
async fn a_dm_reads_its_own_notifications() {
    let rig = rig_with(vec![
        notification("n-1", Some(CHANNEL), None, false),
        notification("n-2", None, Some("dm-1"), false),
    ])
    .await;
    rig.core.run_until_idle().await;
    assert_eq!(read_ids(&rig), vec!["n-1".to_owned()]);
    rig.core
        .open_conversation(Conversation::DirectMessage { id: "dm-1".into() })
        .await
        .unwrap();
    rig.core.run_until_idle().await;
    assert_eq!(read_ids(&rig), vec!["n-1".to_owned(), "n-2".to_owned()]);
}

#[tokio::test]
async fn a_thread_reads_no_notifications() {
    let rig = rig_with(vec![notification("n-1", Some(CHANNEL), None, false)]).await;
    rig.core.run_until_idle().await;
    let before = read_ids(&rig);
    rig.core
        .open_conversation(Conversation::Thread {
            parent_message_id: "p1".into(),
        })
        .await
        .unwrap();
    rig.core.run_until_idle().await;
    assert_eq!(read_ids(&rig), before);
}
