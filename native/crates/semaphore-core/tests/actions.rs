//! W1 part A: edit, delete, pin and react, against the fake backend and socket.

mod common;

use common::*;
use semaphore_core::model::{ChannelModeration, LoadState, MentionKind, MessageDraft, ViewKey};
use semaphore_core::platform::CoreEvent;
use semaphore_core::text::draft_to_spans;
use semaphore_core::{Core, CoreError};
use semaphore_wire::types::MessageDto;
use serde_json::{Value, json};
use std::future::Future;

fn uuid(n: u128) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

fn dto(value: Value) -> MessageDto {
    serde_json::from_value(value).unwrap()
}

/// A message with these spans, by `author`.
fn with_spans(id: &str, author: &str, spans: Value) -> MessageDto {
    let mut value = message_json(id, author, "");
    value["spans"] = spans;
    dto(value)
}

async fn rig_with(rows: Vec<MessageDto>) -> Rig {
    Rig::new().signed_in().await.open_channel(rows).await
}

/// Runs a command until it has reached the backend and is held there, then hands it back.
async fn held<T: Send + 'static>(
    rig: &mut Rig,
    run: impl FnOnce(Core) -> std::pin::Pin<Box<dyn Future<Output = T> + Send>>,
) -> (tokio::sync::oneshot::Sender<()>, tokio::task::JoinHandle<T>) {
    let gate = rig.backend.hold_next_action();
    let calls = rig.backend.action_calls().len();
    let task = tokio::spawn(run(rig.core.clone()));
    for _ in 0..10_000 {
        if rig.backend.action_calls().len() > calls {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert!(
        rig.backend.action_calls().len() > calls,
        "the call never reached the backend"
    );
    rig.sync();
    (gate, task)
}

fn draft(text: &str) -> MessageDraft {
    MessageDraft {
        text: text.into(),
        ..MessageDraft::default()
    }
}

fn views(events: &[CoreEvent]) -> Vec<ViewKey> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::ViewChanged { view } => Some(view.clone()),
            _ => None,
        })
        .collect()
}

// --- Edit ---

#[tokio::test]
async fn an_edit_shows_at_once_and_then_takes_the_servers_answer() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, ME, "before")]).await;
    let (gate, task) = held(&mut rig, |core| {
        let id = uuid(1);
        Box::pin(async move { core.edit_message(id, draft("after"), None).await })
    })
    .await;
    assert_eq!(rig.row(&id).display, "after");
    assert!(rig.row(&id).edit_pending);
    assert!(rig.row(&id).edited);

    gate.send(()).unwrap();
    task.await.unwrap().unwrap();
    rig.sync();
    assert_eq!(rig.row(&id).display, "after");
    assert!(!rig.row(&id).edit_pending);
    assert_eq!(rig.backend.action_calls(), vec![format!("update {id}")]);
}

#[tokio::test]
async fn a_refused_edit_puts_the_row_back() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, ME, "before")]).await;
    rig.backend.fail_next("update", refusal(403, "FORBIDDEN"));
    let error = rig
        .core
        .edit_message(id.clone(), draft("after"), None)
        .await
        .unwrap_err();
    assert!(matches!(error, CoreError::Failed { .. }));
    rig.sync();
    assert_eq!(rig.row(&id).display, "before");
    assert!(!rig.row(&id).edited);
    assert!(!rig.row(&id).edit_pending);
}

#[tokio::test]
async fn an_update_from_the_server_during_an_edit_stands() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, ME, "before")]).await;
    let (gate, task) = held(&mut rig, |core| {
        let id = uuid(1);
        Box::pin(async move { core.edit_message(id, draft("mine"), None).await })
    })
    .await;
    let mut newer = message_json(&id, ME, "from another device");
    newer["editedAt"] = json!("2026-09-22T20:00:00Z");
    rig.core
        .ingest(event("updateMessage", json!({ "message": newer })));
    gate.send(()).unwrap();
    task.await.unwrap().unwrap();
    rig.sync();
    assert_eq!(rig.row(&id).display, "from another device");
    assert!(!rig.row(&id).edit_pending);
}

#[tokio::test]
async fn a_refused_edit_leaves_a_newer_server_update_alone() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, ME, "before")]).await;
    rig.backend.fail_next("update", refusal(500, "INTERNAL"));
    let (gate, task) = held(&mut rig, |core| {
        let id = uuid(1);
        Box::pin(async move { core.edit_message(id, draft("mine"), None).await })
    })
    .await;
    rig.core.ingest(event(
        "updateMessage",
        json!({ "message": message_json(&id, ME, "newer") }),
    ));
    gate.send(()).unwrap();
    assert!(task.await.unwrap().is_err());
    rig.sync();
    assert_eq!(rig.row(&id).display, "newer");
}

#[tokio::test]
async fn an_edit_keeps_formatting_mentions_and_emoji() {
    let id = uuid(1);
    let channel_id = uuid(77);
    let spans = json!([
        { "type": "PLAINTEXT", "text": "bold", "bold": true },
        { "type": "PLAINTEXT", "text": " and " },
        { "type": "PLAINTEXT", "text": "slanted", "italic": true },
        { "type": "PLAINTEXT", "text": " " },
        { "type": "USER_MENTION", "text": "@ava", "userId": "ava" },
        { "type": "PLAINTEXT", "text": " in " },
        { "type": "CHANNEL_MENTION", "channelId": channel_id },
        { "type": "PLAINTEXT", "text": " with " },
        { "type": "ALIAS_MENTION", "text": "@crew", "aliasId": "alias-1" },
        { "type": "PLAINTEXT", "text": " " },
        { "type": "EMOJI", "text": ":party:", "emojiId": "emoji-1" },
    ]);
    let mut rig = rig_with(vec![with_spans(&id, ME, spans)]).await;

    let mut edit = rig.core.edit_draft(id.clone()).expect("a draft");
    assert_eq!(
        edit.text,
        "**bold** and _slanted_ @ava in #private-channel with @crew :party:"
    );
    let kinds: Vec<MentionKind> = edit.mentions.iter().map(|m| m.kind).collect();
    assert_eq!(
        kinds,
        vec![
            MentionKind::User,
            MentionKind::Channel,
            MentionKind::Alias,
            MentionKind::Emoji
        ]
    );
    edit.text.push_str(" more");
    rig.core.edit_message(id.clone(), edit, None).await.unwrap();

    let stored = rig.backend.messages.lock().unwrap()[CHANNEL]
        .iter()
        .find(|message| message.id == id)
        .cloned()
        .unwrap();
    let field = |kind: &str| -> Vec<Value> {
        stored
            .spans
            .iter()
            .map(|span| serde_json::to_value(span).unwrap())
            .filter(|span| span["type"] == kind)
            .collect()
    };
    assert!(
        field("PLAINTEXT")
            .iter()
            .any(|s| s["text"] == "bold" && s["bold"] == true)
    );
    assert!(
        field("PLAINTEXT")
            .iter()
            .any(|s| s["text"] == "slanted" && s["italic"] == true)
    );
    assert_eq!(field("USER_MENTION")[0]["userId"], "ava");
    assert_eq!(field("CHANNEL_MENTION")[0]["channelId"], channel_id);
    assert_eq!(field("ALIAS_MENTION")[0]["aliasId"], "alias-1");
    assert_eq!(field("EMOJI")[0]["emojiId"], "emoji-1");
    rig.sync();
    let row = rig.row(&id);
    assert!(row.display.ends_with(" more"), "{}", row.display);
    assert!(row.display.contains("@ava"), "{}", row.display);
}

#[tokio::test]
async fn a_community_mention_survives_the_draft() {
    let id = uuid(1);
    let spans = json!([
        { "type": "COMMUNITY_MENTION", "text": "@everyone-here", "communityId": "community-1" },
    ]);
    let rig = rig_with(vec![with_spans(&id, ME, spans)]).await;
    let edit = rig.core.edit_draft(id).unwrap();
    assert_eq!(edit.mentions[0].kind, MentionKind::Community);
    let spans = draft_to_spans(&edit);
    assert_eq!(spans[0].kind, "COMMUNITY_MENTION");
    assert_eq!(spans[0].community_id.as_deref(), Some("community-1"));
}

#[tokio::test]
async fn only_the_author_edits_and_an_edit_adds_no_files() {
    let (mine, theirs) = (uuid(1), uuid(2));
    let rig = rig_with(vec![message(&theirs, "ava", "x"), message(&mine, ME, "y")]).await;
    assert!(
        rig.core
            .edit_message(theirs, draft("no"), None)
            .await
            .is_err()
    );
    let with_file = MessageDraft {
        files: vec![semaphore_core::model::DraftFile {
            name: "a.txt".into(),
            mime_type: "text/plain".into(),
            bytes: vec![1],
        }],
        ..draft("files")
    };
    assert!(rig.core.edit_message(mine, with_file, None).await.is_err());
    assert!(rig.backend.action_calls().is_empty());
}

#[tokio::test]
async fn an_edit_can_remove_attachments() {
    let id = uuid(1);
    let mut value = message_json(&id, ME, "files");
    let file = |id: &str| json!({ "id": id, "filename": format!("{id}.png"), "mimeType": "image/png", "fileType": "IMAGE", "size": 10, "hasThumbnail": false });
    value["attachments"] = json!([file("f1"), file("f2")]);
    let mut rig = rig_with(vec![dto(value)]).await;
    rig.core
        .edit_message(id.clone(), draft("files"), Some(vec!["f2".into()]))
        .await
        .unwrap();
    rig.sync();
    let kept: Vec<&str> = rig
        .row(&id)
        .attachments
        .iter()
        .map(|file| file.file_id.as_str())
        .collect();
    assert_eq!(kept, vec!["f2"]);
}

// --- Delete and removal ---

#[tokio::test]
async fn deleting_my_message_is_a_hard_delete() {
    let (mine, other) = (uuid(1), uuid(2));
    let mut rig = rig_with(vec![message(&mine, ME, "x"), message(&other, "ava", "y")]).await;
    rig.core.delete_message(mine.clone(), None).await.unwrap();
    rig.sync();
    assert_eq!(rig.ids(), vec![other.clone()]);
    assert_eq!(rig.backend.action_calls(), vec![format!("remove {mine}")]);
    // The event that follows changes nothing.
    rig.core.ingest(event(
        "deleteMessage",
        json!({ "messageId": mine, "channelId": CHANNEL, "directMessageGroupId": null }),
    ));
    rig.sync();
    assert_eq!(rig.ids(), vec![other]);
}

#[tokio::test]
async fn a_failed_delete_leaves_the_row() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, ME, "x")]).await;
    rig.backend.fail_next("remove", refusal(500, "INTERNAL"));
    assert!(rig.core.delete_message(id.clone(), None).await.is_err());
    rig.sync();
    assert_eq!(rig.ids(), vec![id]);
}

#[tokio::test]
async fn a_moderator_removes_someone_elses_message_and_keeps_seeing_it() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, "ava", "rude")]).await;
    rig.backend.make_moderator();
    rig.core
        .delete_message(id.clone(), Some("spam".into()))
        .await
        .unwrap();
    rig.sync();
    assert_eq!(
        rig.backend.action_calls(),
        vec![
            format!("roles {CHANNEL}"),
            format!("remove_as_mod {id} spam")
        ]
    );
    let row = rig.row(&id);
    assert!(row.removed);
    assert_eq!(row.display, "rude");
    assert_eq!(row.removed_reason.as_deref(), Some("spam"));
    assert_eq!(
        row.removed_by.as_ref().map(|user| user.id.as_str()),
        Some(ME)
    );
}

#[tokio::test]
async fn without_the_permission_someone_elses_message_stays() {
    let (theirs, in_dm) = (uuid(1), uuid(2));
    let mut dm_message = message_json(&in_dm, "ava", "dm");
    dm_message["channelId"] = Value::Null;
    dm_message["directMessageGroupId"] = json!("dm-1");
    let mut rig = rig_with(vec![message(&theirs, "ava", "x")]).await;
    assert!(rig.core.delete_message(theirs.clone(), None).await.is_err());
    assert_eq!(rig.backend.action_calls(), vec![format!("roles {CHANNEL}")]);
    rig.sync();
    assert!(!rig.row(&theirs).removed);
    // Never someone else's in a DM, moderator or not. (Not loaded: refused before any call.)
    rig.backend.make_moderator();
    assert!(rig.core.delete_message(in_dm, None).await.is_err());
}

#[tokio::test]
async fn a_moderator_keeps_a_removed_row_and_loses_a_deleted_one() {
    let (removed, deleted) = (uuid(1), uuid(2));
    let mut rig = rig_with(vec![
        message(&removed, "ava", "kept"),
        message(&deleted, "ava", "gone"),
    ])
    .await;
    rig.backend.make_moderator();
    rig.core.channel_moderation(CHANNEL.into());
    rig.core.run_until_idle().await;
    assert_eq!(
        rig.core.channel_moderation(CHANNEL.into()),
        Some(ChannelModeration {
            pin: true,
            unpin: true,
            remove_any: true
        })
    );
    let mut server_copy = message_json(&removed, "ava", "kept");
    server_copy["deletedAt"] = json!("2026-09-22T19:00:00Z");
    server_copy["deletedBy"] = json!("mod-2");
    server_copy["deletedByReason"] = json!("off topic");
    rig.backend
        .actions
        .found
        .lock()
        .unwrap()
        .insert(removed.clone(), dto(server_copy));

    for id in [&removed, &deleted] {
        rig.core.ingest(event(
            "deleteMessage",
            json!({ "messageId": id, "channelId": CHANNEL, "directMessageGroupId": null }),
        ));
    }
    rig.sync();
    assert!(
        rig.row(&removed).removed,
        "removed at once, until the server says which"
    );
    rig.settle().await;
    assert_eq!(rig.ids(), vec![removed.clone()]);
    let row = rig.row(&removed);
    assert!(row.removed);
    assert_eq!(row.display, "kept");
    assert_eq!(row.removed_reason.as_deref(), Some("off topic"));
    assert!(
        rig.backend
            .action_calls()
            .contains(&format!("find_one {deleted}"))
    );
}

#[tokio::test]
async fn a_reader_without_the_permission_loses_the_row_at_once() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, "ava", "x")]).await;
    rig.core.ingest(event(
        "deleteMessage",
        json!({ "messageId": id, "channelId": CHANNEL, "directMessageGroupId": null }),
    ));
    rig.settle().await;
    assert!(rig.ids().is_empty());
    assert!(
        !rig.backend
            .action_calls()
            .iter()
            .any(|call| call.starts_with("find_one"))
    );
}

#[tokio::test]
async fn a_removed_row_shows_what_the_server_sent() {
    let (blank, whole) = (uuid(1), uuid(2));
    let mut blanked = message_json(&blank, "ava", "");
    blanked["spans"] = json!([]);
    blanked["deletedAt"] = json!("2026-09-22T19:00:00Z");
    let mut kept = message_json(&whole, "ava", "still here");
    kept["deletedAt"] = json!("2026-09-22T19:00:00Z");
    kept["deletedByReason"] = json!("spam");
    let rig = rig_with(vec![dto(blanked), dto(kept)]).await;
    assert!(rig.row(&blank).removed);
    assert_eq!(rig.row(&blank).display, "");
    assert!(rig.row(&whole).removed);
    assert_eq!(rig.row(&whole).display, "still here");
    assert_eq!(rig.row(&whole).removed_reason.as_deref(), Some("spam"));
}

// --- Pins ---

#[tokio::test]
async fn a_pin_shows_at_once_and_refreshes_the_list() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, "ava", "x")]).await;
    assert_eq!(
        rig.core.pinned_messages(CHANNEL.into()).state,
        LoadState::Loading
    );
    rig.settle().await;
    assert_eq!(rig.core.pinned_messages(CHANNEL.into()).rows.len(), 0);

    let (gate, task) = held(&mut rig, |core| {
        let id = uuid(1);
        Box::pin(async move { core.pin_message(id, None).await })
    })
    .await;
    assert!(rig.row(&id).pinned);
    assert_eq!(
        rig.row(&id).pinned_by.as_ref().map(|user| user.id.as_str()),
        Some(ME)
    );
    let pinned = rig.backend.messages.lock().unwrap()[CHANNEL][0].clone();
    rig.backend.set_pins(&[MessageDto {
        pinned: true,
        ..pinned
    }]);
    gate.send(()).unwrap();
    task.await.unwrap().unwrap();
    rig.settle().await;
    let list = rig.core.pinned_messages(CHANNEL.into());
    assert_eq!(list.state, LoadState::Ready);
    assert_eq!(list.rows.len(), 1);
    assert_eq!(list.rows[0].row.display, "x");
    assert_eq!(list.rows[0].row.author.id, "ava");
    let pins_reads = rig
        .backend
        .action_calls()
        .iter()
        .filter(|call| call.starts_with("pins"))
        .count();
    assert_eq!(pins_reads, 2);
}

#[tokio::test]
async fn a_refused_pin_goes_back() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, "ava", "x")]).await;
    rig.backend.fail_next("pin", refusal(403, "FORBIDDEN"));
    assert!(rig.core.pin_message(id.clone(), None).await.is_err());
    rig.sync();
    assert!(!rig.row(&id).pinned);
    assert!(rig.row(&id).pinned_by.is_none());
}

#[tokio::test]
async fn an_unpin_leaves_the_list_at_once_and_comes_back_if_refused() {
    let (first, second) = (uuid(1), uuid(2));
    let mut a = message_json(&first, "ava", "one");
    a["pinned"] = json!(true);
    let mut b = message_json(&second, "ava", "two");
    b["pinned"] = json!(true);
    let rows = vec![dto(b), dto(a)];
    let mut rig = rig_with(rows.clone()).await;
    rig.backend.set_pins(&[rows[1].clone(), rows[0].clone()]);
    rig.core.pinned_messages(CHANNEL.into());
    rig.settle().await;
    assert_eq!(rig.core.pinned_messages(CHANNEL.into()).rows.len(), 2);

    rig.backend.fail_next("unpin", refusal(500, "INTERNAL"));
    let (gate, task) = held(&mut rig, |core| {
        let id = uuid(1);
        Box::pin(async move { core.unpin_message(id, None).await })
    })
    .await;
    let during = rig.core.pinned_messages(CHANNEL.into());
    assert_eq!(during.rows.len(), 1);
    assert!(!rig.row(&first).pinned);
    gate.send(()).unwrap();
    assert!(task.await.unwrap().is_err());
    rig.sync();
    let after: Vec<String> = rig
        .core
        .pinned_messages(CHANNEL.into())
        .rows
        .iter()
        .filter_map(|pin| pin.row.id.clone())
        .collect();
    assert_eq!(after, vec![first.clone(), second]);
    assert!(rig.row(&first).pinned);
}

#[tokio::test]
async fn a_delete_takes_a_message_out_of_the_pins_and_a_failed_list_says_so() {
    let id = uuid(1);
    let mut pinned = message_json(&id, "ava", "x");
    pinned["pinned"] = json!(true);
    let mut rig = rig_with(vec![dto(pinned.clone())]).await;
    rig.backend.set_pins(&[dto(pinned)]);
    rig.core.pinned_messages(CHANNEL.into());
    rig.settle().await;
    rig.core.ingest(event(
        "deleteMessage",
        json!({ "messageId": id, "channelId": CHANNEL, "directMessageGroupId": null }),
    ));
    let events = rig.settle().await;
    assert!(rig.core.pinned_messages(CHANNEL.into()).rows.is_empty());
    assert!(views(&events).contains(&ViewKey::Pins {
        channel_id: CHANNEL.into()
    }));

    rig.backend.fail_next("pins", refusal(500, "INTERNAL"));
    rig.core.pinned_messages("other".into());
    rig.settle().await;
    assert!(matches!(
        rig.core.pinned_messages("other".into()).state,
        LoadState::Failed { .. }
    ));
}

// --- Reactions ---

#[tokio::test]
async fn a_reaction_shows_at_once_and_takes_the_servers_answer() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, "ava", "x")]).await;
    let (gate, task) = held(&mut rig, |core| {
        let id = uuid(1);
        Box::pin(async move { core.add_reaction(id, "custom:emoji-1".into()).await })
    })
    .await;
    let reaction = rig.row(&id).reactions[0].clone();
    assert!(reaction.me);
    assert_eq!(reaction.custom_emoji_id.as_deref(), Some("emoji-1"));
    assert_eq!(reaction.user_ids, vec![ME.to_owned()]);
    gate.send(()).unwrap();
    task.await.unwrap().unwrap();
    rig.sync();
    assert_eq!(rig.row(&id).reactions[0].count, 1);

    // There already: nothing is sent.
    rig.core
        .add_reaction(id.clone(), "custom:emoji-1".into())
        .await
        .unwrap();
    assert_eq!(rig.backend.action_calls().len(), 1);

    rig.core
        .toggle_reaction(id.clone(), "custom:emoji-1".into())
        .await
        .unwrap();
    rig.sync();
    assert!(rig.row(&id).reactions.is_empty());
    assert_eq!(
        rig.backend.action_calls().last().unwrap(),
        &format!("remove_reaction {id} custom:emoji-1")
    );
}

#[tokio::test]
async fn a_refused_reaction_goes_back() {
    let id = uuid(1);
    let mut value = message_json(&id, "ava", "x");
    value["reactions"] = json!([{ "emoji": "👍", "userIds": ["ava"] }]);
    let mut rig = rig_with(vec![dto(value)]).await;
    rig.backend
        .fail_next("add_reaction", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .add_reaction(id.clone(), "👍".into())
            .await
            .is_err()
    );
    rig.sync();
    let reaction = &rig.row(&id).reactions[0];
    assert_eq!((reaction.count, reaction.me), (1, false));

    rig.backend
        .fail_next("remove_reaction", refusal(500, "INTERNAL"));
    rig.core
        .add_reaction(id.clone(), "🎉".into())
        .await
        .unwrap();
    assert!(
        rig.core
            .remove_reaction(id.clone(), "🎉".into())
            .await
            .is_err()
    );
    rig.sync();
    assert!(
        rig.row(&id)
            .reactions
            .iter()
            .any(|r| r.emoji == "🎉" && r.me)
    );
}

#[tokio::test]
async fn reaction_users_are_named_and_capped() {
    let id = uuid(1);
    let users: Vec<String> = (0..20).map(|n| format!("user-{n}")).collect();
    let mut value = message_json(&id, "ava", "x");
    value["reactions"] = json!([{ "emoji": "👍", "userIds": users }]);
    let mut rig = rig_with(vec![dto(value)]).await;
    let first = rig.core.reaction_users(id.clone(), "👍".into());
    assert_eq!(first.users.len(), 15);
    assert_eq!(first.more, 5);
    assert_eq!(first.users[0].username, "");
    let events = rig.settle().await;
    assert!(views(&events).contains(&ViewKey::ReactionUsers {
        message_id: id.clone(),
        emoji: "👍".into()
    }));
    let named = rig.core.reaction_users(id, "👍".into());
    assert_eq!(named.users[0].username, "user-0");
}

#[tokio::test]
async fn an_update_about_a_removed_message_shows_its_text_only_to_moderators() {
    let id = uuid(1);
    let mut rig = rig_with(vec![message(&id, "ava", "x")]).await;
    let mut removed = message_json(&id, "ava", "secret");
    removed["deletedAt"] = json!("2026-09-22T19:00:00Z");
    rig.core.ingest(event(
        "updateMessage",
        json!({ "message": removed.clone() }),
    ));
    rig.sync();
    assert_eq!(rig.row(&id).display, "");

    rig.backend.make_moderator();
    rig.core.channel_moderation(CHANNEL.into());
    rig.settle().await;
    rig.core
        .ingest(event("updateMessage", json!({ "message": removed })));
    rig.sync();
    assert_eq!(rig.row(&id).display, "secret");
}
