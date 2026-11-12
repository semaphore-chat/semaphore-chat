//! W5-A: running a community, against `FakeBackend` (`common/w5a.rs`). Each command: it lands, a
//! refusal puts back what it showed and shows the server's message, and an answer for an ended
//! session changes nothing. Then the socket events and the views' rereads.

mod common;

use common::w5a::*;
use common::*;
use semaphore_core::model::{
    AdminAction, AdminActionKind, ChannelDraft, ChannelKind, ChannelMove, CommunityPatch,
    DraftFile, ImageChange, InviteDraft, LoadState, RemovalCause, SoundDraft,
};
use semaphore_core::platform::{CoreError, CoreEvent};
use serde_json::{Value, json};

const TEXT_A: &str = "00000000-0000-4000-8000-00000000aa01";
const TEXT_B: &str = "00000000-0000-4000-8000-00000000aa02";
const VOICE_A: &str = "00000000-0000-4000-8000-00000000aa03";
const GROUP: &str = "00000000-0000-4000-8000-0000000000a1";

fn channels() -> Vec<Value> {
    vec![
        channel_json(TEXT_A, "general", "TEXT", 0),
        channel_json(TEXT_B, "random", "TEXT", 1),
        channel_json(VOICE_A, "lounge", "VOICE", 0),
    ]
}

/// Signed in with the community's channels cached.
async fn with_channels() -> Rig {
    let rig = Rig::new();
    *rig.backend.channels.lock().unwrap() = channels();
    let mut rig = rig.signed_in().await;
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    rig
}

fn names(rig: &Rig) -> Vec<String> {
    rig.core
        .channels(COMMUNITY.into())
        .into_iter()
        .map(|channel| channel.name)
        .collect()
}

fn shows_refusal(op: &semaphore_core::model::AdminOp, code: &str) {
    assert!(!op.busy);
    let error = op.error.as_ref().expect("the refusal shows");
    assert_eq!(error.message, format!("refused: {code}"));
}

fn draft(name: &str, private: bool, slowmode: u32) -> ChannelDraft {
    ChannelDraft {
        name: name.into(),
        kind: ChannelKind::Text,
        is_private: private,
        slowmode_seconds: slowmode,
    }
}

fn file(name: &str) -> DraftFile {
    DraftFile {
        name: name.into(),
        mime_type: "image/png".into(),
        bytes: vec![1; 10],
    }
}

/// Signs out and back in while `release` holds a call, then lets it answer.
async fn new_session_then(rig: &Rig, release: tokio::sync::oneshot::Sender<()>) {
    tokio::task::yield_now().await;
    rig.core.sign_out().await.unwrap();
    rig.core
        .sign_in("http://server".into(), "me".into(), "pw".into())
        .await
        .unwrap();
    rig.core.channels(COMMUNITY.into());
    rig.core.run_until_idle().await;
    release.send(()).unwrap();
}

// --- Community settings ---

#[tokio::test]
async fn settings_read_the_community_and_an_edit_lands_with_its_images() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("community", community_json("Old"));
    assert_eq!(
        rig.core.community_settings(COMMUNITY.into()).state,
        LoadState::Loading
    );
    rig.settle().await;
    let view = rig.core.community_settings(COMMUNITY.into());
    assert_eq!(
        (view.name.as_str(), view.description.as_deref()),
        ("Old", Some("About"))
    );

    let mut answer = community_json("New");
    answer["avatar"] = json!("avatar-file");
    answer["description"] = json!("");
    rig.backend.w4.answer("update_community", answer);
    rig.core
        .update_community(
            COMMUNITY.into(),
            CommunityPatch {
                name: Some(" New ".into()),
                description: Some(String::new()),
                avatar: Some(ImageChange::Set {
                    file: file("a.png"),
                }),
                banner: Some(ImageChange::Remove),
            },
        )
        .await
        .unwrap();
    let uploads = rig.backend.uploads.lock().unwrap().clone();
    assert_eq!(
        uploads,
        vec![("a.png".to_owned(), 10, Some(COMMUNITY.to_owned()))]
    );
    let call = rig
        .backend
        .w4
        .calls()
        .into_iter()
        .find(|c| c.starts_with("update_community"))
        .unwrap();
    let sent: Value = serde_json::from_str(call.splitn(3, ' ').nth(2).unwrap()).unwrap();
    assert_eq!(sent["name"], "New");
    assert_eq!(sent["description"], "");
    assert_eq!(sent["banner"], "", "removing an image sends it empty");
    assert!(sent["avatar"].as_str().is_some_and(|id| !id.is_empty()));
    let view = rig.core.community_settings(COMMUNITY.into());
    assert_eq!(view.name, "New");
    assert_eq!(view.description, None, "an empty description reads as none");
    assert_eq!(view.avatar_file_id.as_deref(), Some("avatar-file"));
    assert!(!view.op.busy && view.op.error.is_none() && view.op.upload.is_none());
}

#[tokio::test]
async fn a_refused_community_edit_puts_back_only_what_nothing_else_changed() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("community", community_json("Old"));
    rig.core.community_settings(COMMUNITY.into());
    rig.settle().await;
    let hold = rig.backend.w4.hold("update_community");
    rig.backend
        .w4
        .fail_next("update_community", refusal(403, "FORBIDDEN"));
    let update = rig.core.update_community(
        COMMUNITY.into(),
        CommunityPatch {
            name: Some("Mine".into()),
            description: Some("Mine too".into()),
            ..Default::default()
        },
    );
    let (result, ()) = tokio::join!(update, async {
        tokio::task::yield_now().await;
        let view = rig.core.community_settings(COMMUNITY.into());
        assert_eq!(view.name, "Mine", "shown at once");
        assert!(view.op.busy);
        // Someone else renames it meanwhile; their description is the old one.
        rig.core.ingest(event(
            "communityUpdated",
            json!({ "communityId": COMMUNITY, "name": "Theirs", "description": "Mine too",
                    "avatar": null, "banner": null }),
        ));
        hold.send(()).unwrap();
    });
    assert!(matches!(result, Err(CoreError::Failed { .. })));
    let view = rig.core.community_settings(COMMUNITY.into());
    assert_eq!(view.name, "Theirs", "their change stays");
    assert_eq!(view.description.as_deref(), Some("About"), "mine goes back");
    shows_refusal(&view.op, "FORBIDDEN");
}

#[tokio::test]
async fn a_bad_name_is_refused_before_it_is_sent() {
    let rig = Rig::new().signed_in().await;
    let result = rig
        .core
        .update_community(
            COMMUNITY.into(),
            CommunityPatch {
                name: Some("  ".into()),
                ..Default::default()
            },
        )
        .await;
    assert!(result.is_err());
    assert_eq!(rig.backend.w4.count("update_community"), 0);
    assert!(
        rig.core
            .community_settings(COMMUNITY.into())
            .op
            .error
            .is_some()
    );
}

#[tokio::test]
async fn a_failed_image_upload_sends_no_update_and_puts_the_text_back() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("community", community_json("Old"));
    rig.core.community_settings(COMMUNITY.into());
    rig.settle().await;
    *rig.backend.upload_error.lock().unwrap() = Some(refusal(413, "PAYLOAD_TOO_LARGE"));
    let result = rig
        .core
        .update_community(
            COMMUNITY.into(),
            CommunityPatch {
                name: Some("New".into()),
                banner: Some(ImageChange::Set {
                    file: file("b.png"),
                }),
                ..Default::default()
            },
        )
        .await;
    assert!(result.is_err());
    assert_eq!(rig.backend.w4.count("update_community"), 0);
    let view = rig.core.community_settings(COMMUNITY.into());
    assert_eq!(view.name, "Old");
    shows_refusal(&view.op, "PAYLOAD_TOO_LARGE");
}

#[tokio::test]
async fn a_community_edit_answered_after_a_new_session_changes_nothing() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("community", community_json("Old"));
    rig.core.community_settings(COMMUNITY.into());
    rig.settle().await;
    let hold = rig.backend.w4.hold("update_community");
    rig.backend
        .w4
        .answer("update_community", community_json("Late"));
    let update = rig.core.update_community(
        COMMUNITY.into(),
        CommunityPatch {
            name: Some("Late".into()),
            ..Default::default()
        },
    );
    let (result, ()) = tokio::join!(update, async {
        new_session_then(&rig, hold).await;
    });
    assert!(result.is_err());
    rig.backend.w4.answer("community", community_json("Old"));
    rig.core.community_settings(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.community_settings(COMMUNITY.into());
    assert_eq!(view.name, "Old");
    assert!(!view.op.busy && view.op.error.is_none());
}

#[tokio::test]
async fn deleting_the_community_drops_it_without_announcing_it_and_the_echo_is_quiet() {
    let mut rig = with_channels().await;
    rig.core.communities();
    rig.settle().await;
    rig.backend.w4.answer("delete_community", Value::Null);
    rig.core.delete_community("comm".into()).await.unwrap();
    assert!(rig.core.communities().is_empty());
    rig.core
        .ingest(event("communityDeleted", json!({ "communityId": "comm" })));
    let events = rig.settle().await;
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, CoreEvent::CommunityRemoved { .. }))
    );
}

#[tokio::test]
async fn a_refused_delete_keeps_the_community() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.settle().await;
    rig.backend
        .w4
        .fail_next("delete_community", refusal(403, "FORBIDDEN"));
    assert!(rig.core.delete_community("comm".into()).await.is_err());
    assert_eq!(rig.core.communities().len(), 1);
    let op = rig.core.community_settings("comm".into()).op;
    shows_refusal(&op, "FORBIDDEN");
}

#[tokio::test]
async fn someone_deleting_the_community_announces_it_once_and_leaves_its_call() {
    let rig = Rig::with_media();
    rig.backend.channels.lock().unwrap().push(json!({
        "id": VOICE_A, "name": "lounge", "communityId": "comm", "type": "VOICE",
        "position": 0, "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    }));
    let mut rig = rig.signed_in().await;
    rig.core.communities();
    rig.core.channels("comm".into());
    rig.settle().await;
    rig.core.join_voice(VOICE_A.into()).await.unwrap();
    rig.settle().await;
    for _ in 0..2 {
        rig.core
            .ingest(event("communityDeleted", json!({ "communityId": "comm" })));
    }
    // Gone at once (the fake's list, read again, still has it: the real one wouldn't).
    assert!(rig.core.communities().is_empty());
    let events = rig.settle().await;
    let removed: Vec<_> = events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::CommunityRemoved {
                community_id,
                name,
                cause,
            } => Some((community_id.clone(), name.clone(), cause.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(
        removed,
        vec![(
            "comm".to_owned(),
            "Community".to_owned(),
            RemovalCause::Deleted
        )]
    );
    assert_eq!(rig.core.voice().room, None, "the call is left");
    assert!(
        rig.media
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|call| call == "disconnect")
    );
}

// --- Channels ---

#[tokio::test]
async fn creating_a_channel_adds_it_once_the_server_agrees() {
    let mut rig = with_channels().await;
    let new = "00000000-0000-4000-8000-00000000aa09";
    rig.backend
        .w4
        .answer("create_channel", channel_json(new, "news", "TEXT", 2));
    let id = rig
        .core
        .create_channel(COMMUNITY.into(), draft(" news ", true, 30))
        .await
        .unwrap();
    assert_eq!(id, new);
    let call = &rig.backend.w4.calls()[0];
    let sent: Value = serde_json::from_str(call.split_once(' ').unwrap().1).unwrap();
    assert_eq!(
        sent,
        json!({ "communityId": COMMUNITY, "isPrivate": true, "name": "news",
                "slowmodeSeconds": 30, "type": "TEXT" })
    );
    assert_eq!(names(&rig), ["general", "lounge", "random", "news"]);
    // The event that follows changes nothing more (and the server now lists it).
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(channel_json(new, "news", "TEXT", 2));
    rig.core.ingest(event(
        "channelCreated",
        json!({ "communityId": COMMUNITY, "channel": channel_json(new, "news", "TEXT", 2) }),
    ));
    rig.settle().await;
    assert_eq!(names(&rig).iter().filter(|name| *name == "news").count(), 1);
}

#[tokio::test]
async fn a_refused_channel_shows_why_and_adds_nothing() {
    let rig = with_channels().await;
    rig.backend
        .w4
        .fail_next("create_channel", refusal(409, "CONFLICT"));
    assert!(
        rig.core
            .create_channel(COMMUNITY.into(), draft("general", false, 0))
            .await
            .is_err()
    );
    assert_eq!(names(&rig).len(), 3);
    shows_refusal(
        &rig.core.community_settings(COMMUNITY.into()).op,
        "CONFLICT",
    );
    // A kind the server doesn't make is refused here.
    let mut odd = draft("x", false, 0);
    odd.kind = ChannelKind::Unknown;
    assert!(
        rig.core
            .create_channel(COMMUNITY.into(), odd)
            .await
            .is_err()
    );
    assert_eq!(rig.backend.w4.count("create_channel"), 1);
}

#[tokio::test]
async fn an_update_sends_only_what_changed_and_shows_it_at_once() {
    let rig = with_channels().await;
    let hold = rig.backend.w4.hold("update_channel");
    let mut answer = channel_json(TEXT_A, "chat", "TEXT", 0);
    answer["slowmodeSeconds"] = json!(10);
    rig.backend.w4.answer("update_channel", answer);
    let update = rig
        .core
        .update_channel(TEXT_A.into(), draft("chat", false, 10));
    let (result, ()) = tokio::join!(update, async {
        tokio::task::yield_now().await;
        assert_eq!(names(&rig)[0], "chat");
        hold.send(()).unwrap();
    });
    result.unwrap();
    let call = &rig.backend.w4.calls()[0];
    let sent: Value = serde_json::from_str(call.splitn(3, ' ').nth(2).unwrap()).unwrap();
    assert_eq!(sent, json!({ "name": "chat", "slowmodeSeconds": 10 }));
    let row = &rig.core.channels(COMMUNITY.into())[0];
    assert_eq!((row.name.as_str(), row.slowmode_seconds), ("chat", 10));
}

#[tokio::test]
async fn a_refused_update_puts_back_only_its_own_fields() {
    let rig = with_channels().await;
    let hold = rig.backend.w4.hold("update_channel");
    rig.backend
        .w4
        .fail_next("update_channel", refusal(403, "FORBIDDEN"));
    let update = rig
        .core
        .update_channel(TEXT_A.into(), draft("chat", true, 0));
    let (result, ()) = tokio::join!(update, async {
        tokio::task::yield_now().await;
        // Someone changes its slow mode meanwhile: not a field this edit wrote.
        let mut theirs = channel_json(TEXT_A, "chat", "TEXT", 0);
        theirs["isPrivate"] = json!(true);
        theirs["slowmodeSeconds"] = json!(60);
        rig.core.ingest(event(
            "channelUpdated",
            json!({ "communityId": COMMUNITY, "channel": theirs }),
        ));
        hold.send(()).unwrap();
    });
    assert!(result.is_err());
    let row = &rig.core.channels(COMMUNITY.into())[0];
    assert_eq!(row.name, "general");
    assert!(!row.is_private);
    assert_eq!(row.slowmode_seconds, 60);
    shows_refusal(
        &rig.core.community_settings(COMMUNITY.into()).op,
        "FORBIDDEN",
    );
}

#[tokio::test]
async fn a_channel_update_answered_after_a_new_session_changes_nothing() {
    let rig = with_channels().await;
    let hold = rig.backend.w4.hold("update_channel");
    rig.backend
        .w4
        .answer("update_channel", channel_json(TEXT_A, "late", "TEXT", 0));
    let update = rig
        .core
        .update_channel(TEXT_A.into(), draft("late", false, 0));
    let (result, ()) = tokio::join!(update, new_session_then(&rig, hold));
    assert!(result.is_err());
    assert_eq!(names(&rig)[0], "general");
    assert!(!rig.core.community_settings(COMMUNITY.into()).op.busy);
}

#[tokio::test]
async fn deleting_a_channel_takes_it_out_at_once_and_announces_it_once() {
    let mut rig = with_channels().await;
    rig.core.delete_channel(TEXT_B.into()).await.unwrap();
    assert_eq!(names(&rig), ["general", "lounge"]);
    rig.core.ingest(event(
        "channelDeleted",
        json!({ "communityId": COMMUNITY, "channelId": TEXT_B }),
    ));
    let events = rig.settle().await;
    let all: Vec<_> = rig.events.take().into_iter().chain(events).collect();
    assert_eq!(
        all.iter()
            .filter(|event| matches!(event, CoreEvent::ChannelRemoved { channel_id, .. } if channel_id == TEXT_B))
            .count(),
        1
    );
}

#[tokio::test]
async fn a_refused_delete_puts_the_channel_back_where_it_was() {
    let rig = with_channels().await;
    rig.backend
        .w4
        .fail_next("delete_channel", refusal(403, "FORBIDDEN"));
    assert!(rig.core.delete_channel(TEXT_A.into()).await.is_err());
    assert_eq!(names(&rig), ["general", "lounge", "random"]);
    shows_refusal(
        &rig.core.community_settings(COMMUNITY.into()).op,
        "FORBIDDEN",
    );
}

#[tokio::test]
async fn someone_deleting_a_channel_takes_it_out_and_announces_it() {
    let mut rig = with_channels().await;
    rig.backend.channels.lock().unwrap().remove(0);
    rig.core.ingest(event(
        "channelDeleted",
        json!({ "communityId": COMMUNITY, "channelId": TEXT_A }),
    ));
    let events = rig.settle().await;
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::ChannelRemoved { community_id, channel_id }
            if community_id == COMMUNITY && channel_id == TEXT_A
    )));
    assert!(!names(&rig).contains(&"general".to_owned()));
}

#[tokio::test]
async fn moving_swaps_with_the_neighbour_of_its_kind_then_takes_the_servers_order() {
    let rig = with_channels().await;
    let hold = rig.backend.w4.hold("move_up");
    rig.backend.w4.answer(
        "move_up",
        json!([
            channel_json(TEXT_B, "random", "TEXT", 0),
            channel_json(TEXT_A, "general", "TEXT", 1),
            channel_json(VOICE_A, "lounge", "VOICE", 0),
        ]),
    );
    let moving = rig.core.move_channel(TEXT_B.into(), ChannelMove::Up);
    let (result, ()) = tokio::join!(moving, async {
        tokio::task::yield_now().await;
        assert_eq!(
            names(&rig),
            ["random", "lounge", "general"],
            "shown at once"
        );
        hold.send(()).unwrap();
    });
    result.unwrap();
    let call = &rig.backend.w4.calls()[0];
    assert_eq!(
        call,
        &format!("move_up {TEXT_B} {{\"communityId\":\"{COMMUNITY}\"}}")
    );
    assert_eq!(names(&rig), ["random", "lounge", "general"]);
}

#[tokio::test]
async fn a_refused_move_puts_both_channels_back() {
    let rig = with_channels().await;
    rig.backend
        .w4
        .fail_next("move_down", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .move_channel(TEXT_A.into(), ChannelMove::Down)
            .await
            .is_err()
    );
    assert_eq!(names(&rig), ["general", "lounge", "random"]);
    shows_refusal(
        &rig.core.community_settings(COMMUNITY.into()).op,
        "FORBIDDEN",
    );
}

#[tokio::test]
async fn a_reorder_event_moves_the_channels_it_names() {
    let mut rig = with_channels().await;
    rig.core.ingest(event(
        "channelsReordered",
        json!({ "communityId": COMMUNITY, "channels": [
            channel_json(TEXT_A, "general", "TEXT", 1),
            channel_json(TEXT_B, "random", "TEXT", 0),
        ]}),
    ));
    rig.sync();
    assert_eq!(names(&rig)[0], "random");
}

#[tokio::test]
async fn a_community_update_event_renames_it_in_the_rail() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.settle().await;
    rig.core.ingest(event(
        "communityUpdated",
        json!({ "communityId": "comm", "name": "Renamed", "description": null,
                "avatar": "pic", "banner": null }),
    ));
    let community = &rig.core.communities()[0];
    assert_eq!(community.name, "Renamed");
    assert_eq!(community.avatar_file_id.as_deref(), Some("pic"));
}

// --- Private channel members, members ---

#[tokio::test]
async fn private_members_list_add_and_remove() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "private_members",
        json!([private_member_json("ann", TEXT_A)]),
    );
    assert_eq!(
        rig.core.private_members(TEXT_A.into()).state,
        LoadState::Loading
    );
    rig.settle().await;
    let view = rig.core.private_members(TEXT_A.into());
    assert_eq!(view.members.len(), 1);
    assert_eq!(view.members[0].user.username, "ann");
    assert_eq!(view.members[0].added_by.as_deref(), Some(ME));

    let mut added = private_member_json(BOB, TEXT_A);
    added.as_object_mut().unwrap().remove("user");
    rig.backend.w4.answer("add_private", added);
    rig.backend.w4.answer(
        "private_members",
        json!([
            private_member_json("ann", TEXT_A),
            private_member_json(BOB, TEXT_A)
        ]),
    );
    rig.core
        .add_private_member(TEXT_A.into(), BOB.into())
        .await
        .unwrap();
    assert_eq!(rig.core.private_members(TEXT_A.into()).members.len(), 2);
    rig.settle().await;
    assert_eq!(
        rig.core.private_members(TEXT_A.into()).members[1]
            .user
            .username,
        BOB,
        "read again for the user"
    );

    rig.backend
        .w4
        .fail_next("remove_private", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .remove_private_member(TEXT_A.into(), BOB.into())
            .await
            .is_err()
    );
    let view = rig.core.private_members(TEXT_A.into());
    assert_eq!(view.members.len(), 2, "back after the refusal");
    shows_refusal(&view.op, "FORBIDDEN");
    rig.core
        .remove_private_member(TEXT_A.into(), BOB.into())
        .await
        .unwrap();
    assert_eq!(rig.core.private_members(TEXT_A.into()).members.len(), 1);
}

#[tokio::test]
async fn private_members_read_again_when_shown_after_thirty_seconds() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("private_members", json!([]));
    rig.core.private_members(TEXT_A.into());
    rig.settle().await;
    rig.clock.advance(10_000);
    rig.core.private_members(TEXT_A.into());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("private_members"), 1);
    rig.clock.advance(25_000);
    rig.core.private_members(TEXT_A.into());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("private_members"), 2);
}

#[tokio::test]
async fn views_without_events_read_again_on_a_new_connection() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("webhooks", json!([]));
    rig.backend.w4.answer("invites", json!([]));
    rig.core.webhooks(TEXT_A.into());
    rig.core.community_invites(COMMUNITY.into());
    rig.settle().await;
    rig.core.ingest(dropped());
    rig.core.ingest(connected());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("webhooks"), 2);
    assert_eq!(rig.backend.w4.count("invites"), 2);
}

#[tokio::test]
async fn adding_a_member_searches_users_outside_the_community_and_reads_members_again() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w2
        .answer("search_users", json!([user_json(ME), user_json(BOB)]));
    let found = rig
        .core
        .search_users_to_add(COMMUNITY.into(), " bo ".into())
        .await
        .unwrap();
    assert_eq!(found.len(), 1, "never me");
    assert_eq!(rig.backend.w2.calls().last().unwrap(), "search_users bo");
    rig.core.members(COMMUNITY.into());
    rig.settle().await;
    let before = rig
        .backend
        .member_page_requests
        .load(std::sync::atomic::Ordering::SeqCst);
    rig.backend.w4.answer(
        "add_member",
        json!({ "id": "m", "userId": BOB, "communityId": COMMUNITY,
                "joinedAt": "2026-09-22T18:00:00.000Z" }),
    );
    rig.core
        .add_member(COMMUNITY.into(), BOB.into())
        .await
        .unwrap();
    rig.settle().await;
    assert_eq!(
        rig.backend.w4.calls().last().unwrap(),
        &format!("add_member {{\"communityId\":\"{COMMUNITY}\",\"userId\":\"{BOB}\"}}")
    );
    assert!(
        rig.backend
            .member_page_requests
            .load(std::sync::atomic::Ordering::SeqCst)
            > before
    );
    rig.backend
        .w4
        .fail_next("add_member", refusal(409, "CONFLICT"));
    assert!(
        rig.core
            .add_member(COMMUNITY.into(), BOB.into())
            .await
            .is_err()
    );
    shows_refusal(
        &rig.core.community_settings(COMMUNITY.into()).op,
        "CONFLICT",
    );
    assert!(
        rig.core
            .add_member(COMMUNITY.into(), "not-a-uuid".into())
            .await
            .is_err()
    );
}

// --- Mention groups ---

#[tokio::test]
async fn mention_groups_create_rename_set_members_and_delete() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("alias_groups", json!([summary_json("g0", "alpha", 1)]));
    rig.core.alias_groups(COMMUNITY.into());
    rig.settle().await;

    rig.backend
        .w4
        .answer("create_group", group_json(GROUP, "devs", &[BOB]));
    let id = rig
        .core
        .create_alias_group(COMMUNITY.into(), "devs".into(), vec![BOB.into()])
        .await
        .unwrap();
    assert_eq!(id, GROUP);
    rig.backend.w4.answer(
        "alias_groups",
        json!([
            summary_json("g0", "alpha", 1),
            summary_json(GROUP, "builders", 2)
        ]),
    );
    let groups = rig.core.alias_groups(COMMUNITY.into()).groups;
    assert_eq!(
        groups
            .iter()
            .map(|g| (g.name.as_str(), g.member_count))
            .collect::<Vec<_>>(),
        [("alpha", 1), ("devs", 1)]
    );
    let group = rig.core.alias_group(GROUP.into());
    assert_eq!(group.name, "devs");
    assert_eq!(group.members[0].id, BOB);

    rig.backend
        .w4
        .answer("rename_group", group_json(GROUP, "builders", &[BOB]));
    rig.core
        .rename_alias_group(GROUP.into(), "builders".into())
        .await
        .unwrap();
    assert_eq!(
        rig.core.alias_groups(COMMUNITY.into()).groups[1].name,
        "builders"
    );

    rig.backend
        .w4
        .fail_next("rename_group", refusal(409, "CONFLICT"));
    assert!(
        rig.core
            .rename_alias_group(GROUP.into(), "alpha".into())
            .await
            .is_err()
    );
    let group = rig.core.alias_group(GROUP.into());
    assert_eq!(group.name, "builders", "back after the refusal");
    shows_refusal(&group.op, "CONFLICT");
    assert!(
        rig.core
            .rename_alias_group(GROUP.into(), "has space".into())
            .await
            .is_err()
    );

    rig.backend
        .w4
        .answer("alias_group", group_json(GROUP, "builders", &[BOB, ME]));
    rig.core
        .set_alias_group_members(GROUP.into(), vec![BOB.into()])
        .await
        .unwrap();
    rig.core
        .add_alias_group_member(GROUP.into(), BOB.into())
        .await
        .unwrap();
    rig.core
        .remove_alias_group_member(GROUP.into(), BOB.into())
        .await
        .unwrap();
    rig.settle().await;
    assert!(rig.backend.w4.count("alias_group") >= 1, "read again");
    assert_eq!(rig.core.alias_group(GROUP.into()).members.len(), 2);

    rig.backend
        .w4
        .fail_next("delete_group", refusal(403, "FORBIDDEN"));
    assert!(rig.core.delete_alias_group(GROUP.into()).await.is_err());
    assert!(
        rig.core
            .alias_groups(COMMUNITY.into())
            .groups
            .iter()
            .any(|g| g.id == GROUP)
    );
    rig.core.delete_alias_group(GROUP.into()).await.unwrap();
    assert!(
        !rig.core
            .alias_groups(COMMUNITY.into())
            .groups
            .iter()
            .any(|g| g.id == GROUP)
    );
}

#[tokio::test]
async fn a_group_created_after_a_new_session_lands_nowhere() {
    let rig = Rig::new().signed_in().await;
    let hold = rig.backend.w4.hold("create_group");
    rig.backend
        .w4
        .answer("create_group", group_json(GROUP, "devs", &[]));
    let create = rig
        .core
        .create_alias_group(COMMUNITY.into(), "devs".into(), vec![]);
    let (result, ()) = tokio::join!(create, new_session_then(&rig, hold));
    assert!(result.is_err());
    assert_eq!(rig.core.alias_group(GROUP.into()).state, LoadState::Loading);
}

// --- Emoji and sounds ---

#[tokio::test]
async fn an_emoji_uploads_then_is_added_and_a_refused_delete_comes_back() {
    let mut rig = Rig::new().signed_in().await;
    *rig.backend.emojis.lock().unwrap() = vec![emoji_json("e1", "wave")];
    rig.core.custom_emoji(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.custom_emoji(COMMUNITY.into());
    assert_eq!(view.emojis[0].created_by.as_ref().unwrap().id, BOB);

    rig.backend
        .w4
        .answer("create_emoji", emoji_json("e2", "party"));
    rig.core
        .add_custom_emoji(COMMUNITY.into(), ":party:".into(), file("p.png"))
        .await
        .unwrap();
    assert_eq!(
        rig.backend.uploads.lock().unwrap()[0],
        ("p.png".to_owned(), 10, Some(COMMUNITY.to_owned()))
    );
    assert_eq!(
        rig.backend.w4.calls()[0],
        format!("create_emoji {COMMUNITY} party")
    );
    let names: Vec<_> = rig
        .core
        .custom_emoji(COMMUNITY.into())
        .emojis
        .into_iter()
        .map(|emoji| emoji.name)
        .collect();
    assert_eq!(names, ["party", "wave"]);

    assert!(
        rig.core
            .add_custom_emoji(COMMUNITY.into(), "Bad Name".into(), file("x.png"))
            .await
            .is_err()
    );
    assert_eq!(
        rig.backend.uploads.lock().unwrap().len(),
        1,
        "nothing uploaded"
    );

    rig.backend
        .w4
        .fail_next("delete_emoji", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .delete_custom_emoji(COMMUNITY.into(), "e1".into())
            .await
            .is_err()
    );
    let view = rig.core.custom_emoji(COMMUNITY.into());
    assert_eq!(view.emojis.len(), 2);
    shows_refusal(&view.op, "FORBIDDEN");
    rig.core
        .delete_custom_emoji(COMMUNITY.into(), "e1".into())
        .await
        .unwrap();
    assert_eq!(rig.core.custom_emoji(COMMUNITY.into()).emojis.len(), 1);
}

#[tokio::test]
async fn a_refused_emoji_shows_the_servers_message() {
    let rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .fail_next("create_emoji", refusal(409, "CONFLICT"));
    assert!(
        rig.core
            .add_custom_emoji(COMMUNITY.into(), "wave".into(), file("w.png"))
            .await
            .is_err()
    );
    let op = rig.core.custom_emoji(COMMUNITY.into()).op;
    shows_refusal(&op, "CONFLICT");
    assert!(op.upload.is_none());
}

#[tokio::test]
async fn a_sound_uploads_then_joins_the_soundboard_and_a_delete_takes_it_out() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("sounds", json!([common::w4::sound_json("s1", "s1-file")]));
    rig.core.soundboard(COMMUNITY.into());
    rig.settle().await;
    let mut created = common::w4::sound_json("s2", "s2-file");
    created["name"] = json!("Bell");
    rig.backend.w4.answer("create_sound", created);
    rig.core
        .add_sound(
            COMMUNITY.into(),
            SoundDraft {
                name: "Bell".into(),
                emoji: Some("🔔".into()),
                file: file("bell.mp3"),
            },
        )
        .await
        .unwrap();
    let call = rig
        .backend
        .w4
        .calls()
        .into_iter()
        .find(|c| c.starts_with("create_sound"))
        .unwrap();
    let sent: Value = serde_json::from_str(call.splitn(3, ' ').nth(2).unwrap()).unwrap();
    assert_eq!(
        (sent["name"].clone(), sent["emoji"].clone()),
        (json!("Bell"), json!("🔔"))
    );
    assert_eq!(rig.core.soundboard(COMMUNITY.into()).sounds.len(), 2);

    rig.backend
        .w4
        .fail_next("delete_sound", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .delete_sound(COMMUNITY.into(), "s1".into())
            .await
            .is_err()
    );
    assert_eq!(rig.core.soundboard(COMMUNITY.into()).sounds.len(), 2);
    shows_refusal(
        &rig.core.community_settings(COMMUNITY.into()).op,
        "FORBIDDEN",
    );
    rig.core
        .delete_sound(COMMUNITY.into(), "s1".into())
        .await
        .unwrap();
    assert_eq!(rig.core.soundboard(COMMUNITY.into()).sounds.len(), 1);
    assert!(
        rig.core
            .add_sound(
                COMMUNITY.into(),
                SoundDraft {
                    name: "bad!".into(),
                    emoji: None,
                    file: file("x.mp3"),
                },
            )
            .await
            .is_err()
    );
}

// --- Webhooks and invites ---

#[tokio::test]
async fn a_webhooks_url_is_returned_once_and_never_kept() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("webhooks", json!([]));
    rig.core.webhooks(TEXT_A.into());
    rig.settle().await;
    let mut created = webhook_json("w1", "CI", TEXT_A);
    created["url"] = json!("https://chat.example/api/webhooks/w1/secret");
    rig.backend.w4.answer("create_webhook", created);
    let made = rig
        .core
        .create_webhook(TEXT_A.into(), "CI".into(), None)
        .await
        .unwrap();
    assert_eq!(made.url, "https://chat.example/api/webhooks/w1/secret");
    let view = rig.core.webhooks(TEXT_A.into());
    assert_eq!(view.webhooks.len(), 1);
    assert!(!format!("{view:?}").contains("secret"));

    rig.backend
        .w4
        .fail_next("delete_webhook", refusal(403, "FORBIDDEN"));
    assert!(
        rig.core
            .delete_webhook(TEXT_A.into(), "w1".into())
            .await
            .is_err()
    );
    let view = rig.core.webhooks(TEXT_A.into());
    assert_eq!(view.webhooks.len(), 1);
    shows_refusal(&view.op, "FORBIDDEN");
    rig.core
        .delete_webhook(TEXT_A.into(), "w1".into())
        .await
        .unwrap();
    assert!(rig.core.webhooks(TEXT_A.into()).webhooks.is_empty());
}

#[tokio::test]
async fn invites_list_only_this_communitys_and_create_and_delete() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "invites",
        json!([
            invite_json("mine", COMMUNITY),
            invite_json("other", "elsewhere")
        ]),
    );
    rig.core.community_invites(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.community_invites(COMMUNITY.into());
    assert_eq!(view.invites.len(), 1);
    assert_eq!(
        (view.invites[0].uses, view.invites[0].max_uses),
        (1, Some(5))
    );

    rig.backend
        .w4
        .answer("create_invite", invite_json("fresh", COMMUNITY));
    let code = rig
        .core
        .create_invite(
            COMMUNITY.into(),
            InviteDraft {
                max_uses: Some(5),
                valid_until_ms: Some(1_800_000_000_000),
            },
        )
        .await
        .unwrap();
    assert_eq!(code, "fresh");
    let call = rig
        .backend
        .w4
        .calls()
        .into_iter()
        .find(|c| c.starts_with("create_invite"))
        .unwrap();
    let sent: Value = serde_json::from_str(call.split_once(' ').unwrap().1).unwrap();
    assert_eq!(sent["communityIds"], json!([COMMUNITY]));
    assert_eq!(sent["maxUses"], 5);
    assert!(
        sent["validUntil"]
            .as_str()
            .unwrap()
            .starts_with("2027-01-15")
    );
    assert_eq!(
        rig.core.community_invites(COMMUNITY.into()).invites[0].code,
        "fresh"
    );

    rig.backend
        .w4
        .fail_next("delete_invite", refusal(403, "FORBIDDEN"));
    assert!(rig.core.delete_invite("fresh".into()).await.is_err());
    let view = rig.core.community_invites(COMMUNITY.into());
    assert_eq!(view.invites.len(), 2);
    shows_refusal(&view.op, "FORBIDDEN");
    rig.core.delete_invite("fresh".into()).await.unwrap();
    assert_eq!(
        rig.core.community_invites(COMMUNITY.into()).invites.len(),
        1
    );
}

#[tokio::test]
async fn an_invite_deleted_after_a_new_session_is_not_put_back_or_taken_out_there() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("invites", json!([invite_json("mine", COMMUNITY)]));
    rig.core.community_invites(COMMUNITY.into());
    rig.settle().await;
    let hold = rig.backend.w4.hold("delete_invite");
    rig.backend
        .w4
        .fail_next("delete_invite", refusal(403, "FORBIDDEN"));
    let delete = rig.core.delete_invite("mine".into());
    let (result, ()) = tokio::join!(delete, async {
        new_session_then(&rig, hold).await;
    });
    assert!(result.is_err());
    rig.core.community_invites(COMMUNITY.into());
    rig.settle().await;
    let view = rig.core.community_invites(COMMUNITY.into());
    assert_eq!(view.invites.len(), 1);
    assert!(
        view.op.error.is_none(),
        "the old session's refusal isn't shown"
    );
}

// --- Follow-ups: actions on a shared op, member join dates, webhook avatars and URLs ---

fn action(kind: AdminActionKind, target: Option<&str>) -> AdminAction {
    AdminAction {
        kind,
        target_id: target.map(str::to_owned),
    }
}

#[tokio::test]
async fn overlapping_actions_on_one_view_keep_their_own_state() {
    let rig = with_channels().await;
    let hold = rig.backend.w4.hold("delete_channel");
    rig.backend
        .w4
        .fail_next("move_down", refusal(403, "FORBIDDEN"));
    let delete = rig.core.delete_channel(TEXT_B.into());
    let (deleted, ()) = tokio::join!(delete, async {
        tokio::task::yield_now().await;
        let moved = rig
            .core
            .move_channel(TEXT_A.into(), ChannelMove::Down)
            .await;
        assert!(moved.is_err());
        let op = rig.core.community_settings(COMMUNITY.into()).op;
        assert!(op.busy, "the delete still runs");
        // The fields describe the move, started last; each row reads its own entry.
        assert_eq!(
            op.action,
            Some(action(AdminActionKind::MoveChannel, Some(TEXT_A)))
        );
        assert_eq!(op.actions.len(), 2);
        let delete = &op.actions[0];
        assert_eq!(
            delete.action,
            action(AdminActionKind::DeleteChannel, Some(TEXT_B))
        );
        assert!(
            delete.busy && delete.error.is_none(),
            "not the move's error"
        );
        let moved = &op.actions[1];
        assert!(!moved.busy);
        assert_eq!(moved.error.as_ref().unwrap().message, "refused: FORBIDDEN");
        hold.send(()).unwrap();
    });
    deleted.unwrap();
    let op = rig.core.community_settings(COMMUNITY.into()).op;
    assert!(!op.busy);
    assert_eq!(
        op.actions.len(),
        1,
        "a success leaves the list; the failure stays"
    );
    assert_eq!(op.actions[0].action.kind, AdminActionKind::MoveChannel);
    // Another action doesn't clear it; the same one starting again does.
    rig.backend
        .w4
        .answer("update_channel", channel_json(TEXT_B, "random", "TEXT", 1));
    rig.core
        .update_channel(TEXT_A.into(), draft("general", false, 5))
        .await
        .ok();
    let op = rig.core.community_settings(COMMUNITY.into()).op;
    assert!(op.actions.iter().any(|entry| entry.error.is_some()));
    rig.backend.w4.answer(
        "move_down",
        json!([channel_json(TEXT_A, "general", "TEXT", 0)]),
    );
    rig.core
        .move_channel(TEXT_A.into(), ChannelMove::Down)
        .await
        .unwrap();
    let op = rig.core.community_settings(COMMUNITY.into()).op;
    assert!(op.actions.is_empty(), "{:?}", op.actions);
    assert!(op.error.is_none());
}

#[tokio::test]
async fn the_same_action_twice_is_one_entry_and_a_refusal_names_its_action() {
    let rig = Rig::new().signed_in().await;
    let first = rig.backend.w4.hold("create_channel");
    rig.backend
        .w4
        .answer("create_channel", channel_json(TEXT_A, "a", "TEXT", 0));
    let create = rig
        .core
        .create_channel(COMMUNITY.into(), draft("a", false, 0));
    let (made, ()) = tokio::join!(create, async {
        tokio::task::yield_now().await;
        let refused = rig
            .core
            .create_channel(COMMUNITY.into(), draft(&"x".repeat(101), false, 0))
            .await;
        assert!(refused.is_err());
        let op = rig.core.community_settings(COMMUNITY.into()).op;
        assert_eq!(op.actions.len(), 1);
        let entry = &op.actions[0];
        assert_eq!(entry.action, action(AdminActionKind::CreateChannel, None));
        assert!(entry.busy && entry.error.is_some());
        first.send(()).unwrap();
    });
    made.unwrap();
    let op = rig.core.community_settings(COMMUNITY.into()).op;
    assert_eq!(
        op.actions.len(),
        1,
        "the refusal stays after the other create lands"
    );
    assert!(!op.busy);
}

#[tokio::test]
async fn every_view_names_the_action_of_its_op() {
    let rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .fail_next("delete_invite", refusal(404, "NOT_FOUND"));
    rig.core.delete_invite("gone".into()).await.ok();
    assert_eq!(
        rig.core.community_invites(COMMUNITY.into()).op.action,
        Some(action(AdminActionKind::DeleteInvite, Some("gone")))
    );
    rig.backend
        .w4
        .fail_next("group_remove", refusal(404, "NOT_FOUND"));
    rig.core
        .remove_alias_group_member(GROUP.into(), BOB.into())
        .await
        .ok();
    assert_eq!(
        rig.core.alias_group(GROUP.into()).op.action,
        Some(action(AdminActionKind::RemoveAliasGroupMember, Some(BOB)))
    );
    rig.backend
        .w4
        .fail_next("delete_sound", refusal(404, "NOT_FOUND"));
    rig.core
        .delete_sound(COMMUNITY.into(), "s9".into())
        .await
        .ok();
    assert_eq!(
        rig.core.community_settings(COMMUNITY.into()).op.action,
        Some(action(AdminActionKind::DeleteSound, Some("s9")))
    );
}

#[tokio::test]
async fn members_carry_when_they_joined() {
    let mut rig = Rig::new();
    rig.backend.members.lock().unwrap().push(json!({
        "id": "m1", "userId": BOB, "communityId": COMMUNITY,
        "joinedAt": "2026-09-22T18:00:00.000Z", "user": user_json(BOB),
    }));
    rig = rig.signed_in().await;
    rig.core.members(COMMUNITY.into());
    rig.settle().await;
    let members = rig.core.members(COMMUNITY.into()).unwrap().members;
    assert_eq!(members[0].joined_at_ms, Some(1_790_100_000_000));
}

#[tokio::test]
async fn a_webhook_sends_its_avatar_and_a_bare_path_comes_back_absolute() {
    let rig = Rig::new().signed_in().await;
    let mut created = webhook_json("w1", "CI", TEXT_A);
    created["avatarUrl"] = json!("https://img.example/ci.png");
    created["url"] = json!("/api/webhooks/w1/secret");
    rig.backend.w4.answer("create_webhook", created);
    let made = rig
        .core
        .create_webhook(
            TEXT_A.into(),
            "CI".into(),
            Some(" https://img.example/ci.png ".into()),
        )
        .await
        .unwrap();
    assert_eq!(made.url, "http://server/api/webhooks/w1/secret");
    let call = rig
        .backend
        .w4
        .calls()
        .into_iter()
        .find(|c| c.starts_with("create_webhook"))
        .unwrap();
    let sent: Value = serde_json::from_str(call.splitn(3, ' ').nth(2).unwrap()).unwrap();
    assert_eq!(
        sent,
        json!({ "name": "CI", "avatarUrl": "https://img.example/ci.png" })
    );
    // A blank avatar isn't sent.
    rig.core
        .create_webhook(TEXT_A.into(), "CI".into(), Some("  ".into()))
        .await
        .unwrap();
    let call = rig
        .backend
        .w4
        .calls()
        .into_iter()
        .filter(|c| c.starts_with("create_webhook"))
        .nth(1)
        .unwrap();
    let sent: Value = serde_json::from_str(call.splitn(3, ' ').nth(2).unwrap()).unwrap();
    assert_eq!(sent, json!({ "name": "CI" }));
}

#[tokio::test]
async fn a_removal_is_announced_again_only_after_being_added_back() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.communities();
    rig.settle().await;
    let kicked = || {
        event(
            "userKicked",
            json!({ "communityId": "comm", "userId": ME, "moderatorId": "ada" }),
        )
    };
    let count = |events: &[CoreEvent]| {
        events
            .iter()
            .filter(|event| matches!(event, CoreEvent::CommunityRemoved { .. }))
            .count()
    };
    rig.core.ingest(kicked());
    rig.core.ingest(kicked());
    assert_eq!(
        count(&rig.settle().await),
        1,
        "kick and the room's echo: once"
    );
    rig.core.ingest(event(
        "memberAddedToCommunity",
        json!({ "communityId": "comm", "userId": ME }),
    ));
    rig.core.ingest(kicked());
    assert_eq!(
        count(&rig.settle().await),
        1,
        "added back, then kicked again"
    );
}
