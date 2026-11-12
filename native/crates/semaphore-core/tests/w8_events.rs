//! W8: the server events core used to ignore, one by one: an unban, private channel membership,
//! the community's emoji, sounds, mention groups and webhooks, a declined or ended DM call, and a
//! timeout that ran out by itself; plus the moderation log's target message.

mod common;

use common::*;
use semaphore_core::QueryKey;
use semaphore_core::cache::keys;
use semaphore_core::model::{Conversation, LoadState, SoundCue, ViewKey, VoiceRoom, VoiceStatus};
use semaphore_core::platform::CoreEvent;
use serde_json::{Value, json};
use std::sync::atomic::Ordering;

const COMMUNITY: &str = "comm";
const OTHER: &str = "other";
const LOUNGE: &str = "lounge";
const GROUP: &str = "group-1";
const DM: &str = "dm-1";
const OTHER_DM: &str = "dm-2";

fn channel_json(id: &str, name: &str, kind: &str, position: i64) -> Value {
    json!({
        "id": id, "name": name, "communityId": COMMUNITY, "type": kind, "position": position,
        "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

fn capabilities(post: bool, timed_out_until: Option<&str>) -> Value {
    let capability = |channel_id: &str| {
        json!({
            "channelId": channel_id, "view": true, "post": post, "attach": true, "react": true,
            "threadReply": true, "connect": true, "speak": true, "video": true, "share": true,
            "managePermissions": false, "postingRoleNames": [],
            "pin": true, "deleteAny": true, "seeRemoved": true,
            "timedOutUntil": timed_out_until,
        })
    };
    json!({
        "communityId": COMMUNITY,
        "channels": [capability(CHANNEL), capability(LOUNGE)],
    })
}

fn emoji_json(id: &str, name: &str) -> Value {
    json!({
        "id": id, "name": name, "communityId": COMMUNITY, "fileId": format!("{id}-file"),
        "createdBy": ME, "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

fn sound_json(id: &str, name: &str) -> Value {
    json!({
        "id": id, "communityId": COMMUNITY, "name": name, "emoji": "🔔",
        "fileId": format!("{id}-file"), "createdBy": null,
        "createdAt": "2026-11-01T00:00:00Z",
    })
}

fn group_summary(id: &str, name: &str, member_count: usize) -> Value {
    json!({ "id": id, "name": name, "communityId": COMMUNITY, "memberCount": member_count })
}

fn group_json(id: &str, name: &str, members: &[&str]) -> Value {
    json!({
        "id": id, "name": name, "communityId": COMMUNITY, "memberCount": members.len(),
        "createdAt": "2026-09-22T18:00:00.000Z",
        "members": members.iter().map(|id| json!({
            "id": id, "username": id, "displayName": null, "avatarUrl": null,
        })).collect::<Vec<_>>(),
    })
}

fn webhook_json(id: &str, name: &str, channel: &str) -> Value {
    json!({
        "id": id, "name": name, "channelId": channel, "avatarUrl": null,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

fn presence(id: &str) -> Value {
    json!({
        "id": id, "username": id, "displayName": format!("{id} name"), "avatarUrl": null,
        "joinedAt": "2026-09-22T18:00:00.000Z", "isDeafened": false, "isServerMuted": false,
    })
}

fn started(dm: &str, by: &str) -> semaphore_core::realtime::RealtimeEvent {
    event(
        "dmVoiceCallStarted",
        json!({
            "dmGroupId": dm, "startedBy": by,
            "starter": { "id": by, "username": by, "displayName": format!("{by} name"), "avatarUrl": null },
        }),
    )
}

fn declined(dm: &str, user: &str, is_group: bool) -> semaphore_core::realtime::RealtimeEvent {
    event(
        "dmVoiceCallDeclined",
        json!({ "dmGroupId": dm, "userId": user, "isGroup": is_group }),
    )
}

fn call_ended(dm: &str) -> semaphore_core::realtime::RealtimeEvent {
    event("dmVoiceCallEnded", json!({ "dmGroupId": dm }))
}

fn cues(events: &[CoreEvent]) -> Vec<SoundCue> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::Sound { cue } => Some(*cue),
            _ => None,
        })
        .collect()
}

fn invalidated(events: &[CoreEvent]) -> Vec<QueryKey> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::QueriesInvalidated { keys } => Some(keys.clone()),
            _ => None,
        })
        .flatten()
        .collect()
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

fn removed_channels(events: &[CoreEvent]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::ChannelRemoved {
                community_id,
                channel_id,
            } => Some((community_id.clone(), channel_id.clone())),
            _ => None,
        })
        .collect()
}

fn withdrawn(events: &[CoreEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match event {
            CoreEvent::WithdrawNotifications { tag } => Some(tag.clone()),
            _ => None,
        })
        .collect()
}

fn ring_tag(dm: &str) -> String {
    format!("dm-call-{dm}")
}

/// A community whose cached channel list, effective permissions and mentionable channels have all
/// been read.
async fn with_channels() -> Rig {
    let rig = Rig::new();
    *rig.backend.channels.lock().unwrap() = vec![
        channel_json(CHANNEL, "general", "TEXT", 0),
        channel_json(LOUNGE, "lounge", "TEXT", 1),
    ];
    *rig.backend.capabilities.lock().unwrap() = Some(capabilities(true, None));
    let mut rig = rig.signed_in().await;
    rig.core.channels(COMMUNITY.into());
    rig.core.mention_candidates(COMMUNITY.into(), "#".into());
    rig.settle().await;
    rig
}

// --- `userUnbanned` ---------------------------------------------------------------------------

fn unbanned(community: &str, user: &str) -> semaphore_core::realtime::RealtimeEvent {
    event(
        "userUnbanned",
        json!({ "communityId": community, "userId": user, "moderatorId": ME }),
    )
}

async fn with_moderation_lists() -> Rig {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w5b.answer("bans", json!([]));
    rig.backend
        .w5b
        .answer("logs", json!({ "logs": [], "total": 0 }));
    rig.core.bans(COMMUNITY.into());
    rig.core.moderation_log(COMMUNITY.into());
    rig.settle().await;
    assert_eq!(rig.backend.w5b.count("bans"), 1);
    assert_eq!(rig.backend.w5b.count("logs"), 1);
    rig
}

#[tokio::test]
async fn an_unban_reads_the_ban_list_and_the_log_again() {
    let mut rig = with_moderation_lists().await;
    let member_pages = rig.backend.member_page_requests.load(Ordering::SeqCst);
    rig.core.ingest(unbanned(COMMUNITY, "bob"));
    let events = rig.settle().await;
    assert_eq!(rig.backend.w5b.count("bans"), 2, "the ban list");
    assert_eq!(rig.backend.w5b.count("logs"), 2, "the log");
    assert_eq!(
        rig.backend.w5b.count("timeouts"),
        0,
        "an unban touches no timeout"
    );
    assert_eq!(
        rig.backend.member_page_requests.load(Ordering::SeqCst),
        member_pages,
        "the membership list doesn't change: they have to rejoin"
    );
    let views = views(&events);
    assert!(views.contains(&ViewKey::Bans {
        community_id: COMMUNITY.into()
    }));
    assert!(views.contains(&ViewKey::ModerationLog {
        community_id: COMMUNITY.into()
    }));
    assert_eq!(
        rig.core.bans(COMMUNITY.into()).state,
        LoadState::Ready,
        "the read that came back was kept"
    );
}

#[tokio::test]
async fn an_unban_for_another_community_reads_nothing() {
    let mut rig = with_moderation_lists().await;
    rig.core.ingest(unbanned(OTHER, "bob"));
    let events = rig.settle().await;
    assert_eq!(rig.backend.w5b.count("bans"), 1);
    assert_eq!(rig.backend.w5b.count("logs"), 1);
    assert!(
        invalidated(&events).is_empty(),
        "{:?}",
        invalidated(&events)
    );
}

#[tokio::test]
async fn an_unban_twice_is_harmless() {
    let mut rig = with_moderation_lists().await;
    rig.core.ingest(unbanned(COMMUNITY, "bob"));
    rig.core.ingest(unbanned(COMMUNITY, "bob"));
    rig.settle().await;
    assert_eq!(rig.core.bans(COMMUNITY.into()).state, LoadState::Ready);
    assert!(rig.core.bans(COMMUNITY.into()).bans.is_empty());
    assert!(rig.core.moderation_log(COMMUNITY.into()).rows.is_empty());
}

#[tokio::test]
async fn an_unban_after_sign_out_reads_nothing() {
    let mut rig = with_moderation_lists().await;
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    let (bans, logs) = (rig.backend.w5b.count("bans"), rig.backend.w5b.count("logs"));
    rig.core.ingest(unbanned(COMMUNITY, "bob"));
    rig.settle().await;
    assert_eq!(rig.backend.w5b.count("bans"), bans);
    assert_eq!(rig.backend.w5b.count("logs"), logs);
    assert!(
        rig.core
            .query_state(&QueryKey::new(&[
                "moderationControllerGetBanList",
                COMMUNITY
            ]))
            .is_none(),
        "the session's cache is gone"
    );
}

#[tokio::test]
async fn an_answer_for_the_previous_session_lands_nothing() {
    let mut rig = with_moderation_lists().await;
    let hold = rig.backend.w5b.hold("bans comm");
    rig.core.ingest(unbanned(COMMUNITY, "bob"));
    let core = rig.core.clone();
    // The read starts, the session ends while it waits, then it answers: it belongs to the
    // session that asked.
    tokio::join!(core.run_until_idle(), async {
        while rig.backend.w5b.count("bans") < 2 {
            tokio::task::yield_now().await;
        }
        rig.core.sign_out().await.unwrap();
        hold.send(()).unwrap();
    });
    rig.settle().await;
    assert!(
        rig.core
            .query_state(&QueryKey::new(&[
                "moderationControllerGetBanList",
                COMMUNITY
            ]))
            .is_none()
    );
}

// --- `privateChannelAdded` / `privateChannelRemoved` ------------------------------------------

fn private_changed(
    name: &str,
    community: &str,
    channel: &str,
) -> semaphore_core::realtime::RealtimeEvent {
    event(
        name,
        json!({ "communityId": community, "channelId": channel }),
    )
}

#[tokio::test]
async fn a_private_channel_added_reads_the_lists_and_the_permissions_again() {
    let mut rig = with_channels().await;
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(channel_json("secret", "secret", "TEXT", 2));
    let requests = rig.backend.channel_requests.load(Ordering::SeqCst);
    rig.core
        .ingest(private_changed("privateChannelAdded", COMMUNITY, "secret"));
    let events = rig.settle().await;
    assert_eq!(
        rig.backend.channel_requests.load(Ordering::SeqCst),
        requests + 1,
        "the channel list reads again"
    );
    assert!(
        rig.core
            .channels(COMMUNITY.into())
            .iter()
            .any(|channel| channel.id == "secret"),
        "and the new channel is in it"
    );
    let invalidated = invalidated(&events);
    assert!(
        invalidated.contains(&keys::scoped(keys::MENTIONABLE, COMMUNITY)),
        "{invalidated:?}"
    );
    assert!(
        invalidated.contains(&keys::scoped(keys::CAPABILITIES, COMMUNITY)),
        "{invalidated:?}"
    );
    assert!(views(&events).contains(&ViewKey::Channels {
        community_id: COMMUNITY.into()
    }));
    assert!(removed_channels(&events).is_empty(), "nothing was removed");
}

#[tokio::test]
async fn a_private_channel_removed_added_back_and_removed_again_is_announced_twice() {
    let mut rig = with_channels().await;
    rig.core
        .ingest(private_changed("privateChannelRemoved", COMMUNITY, CHANNEL));
    let first = rig.settle().await;
    assert_eq!(
        removed_channels(&first),
        [(COMMUNITY.to_owned(), CHANNEL.to_owned())]
    );

    rig.core
        .ingest(private_changed("privateChannelAdded", COMMUNITY, CHANNEL));
    rig.settle().await;
    rig.core
        .ingest(private_changed("privateChannelRemoved", COMMUNITY, CHANNEL));
    let second = rig.settle().await;
    assert_eq!(
        removed_channels(&second),
        [(COMMUNITY.to_owned(), CHANNEL.to_owned())],
        "a second removal after being added back is announced too"
    );
}

#[tokio::test]
async fn a_private_channel_removed_goes_at_once_like_a_deleted_one() {
    let mut rig = with_channels().await;
    rig.backend
        .set_messages(vec![message("m1", "bob", "hello")]);
    rig.core.open_conversation(channel()).await.unwrap();
    rig.settle().await;
    assert_eq!(rig.rows.len(), 1, "the channel is open with a message");
    let pages = rig.backend.page_requests.load(Ordering::SeqCst);
    // The server's new list no longer has it.
    rig.backend
        .channels
        .lock()
        .unwrap()
        .retain(|channel| channel["id"] != CHANNEL);
    rig.core
        .ingest(private_changed("privateChannelRemoved", COMMUNITY, CHANNEL));
    // Before anything is read again: out of the list, and its capability entry gone.
    let listed = rig.core.channels(COMMUNITY.into());
    assert!(listed.iter().all(|channel| channel.id != CHANNEL));
    assert!(listed.iter().all(|channel| channel.permissions.is_some()));
    let events = rig.settle().await;
    assert_eq!(
        removed_channels(&events),
        [(COMMUNITY.to_owned(), CHANNEL.to_owned())],
        "announced as a deleted channel is"
    );
    let invalidated = invalidated(&events);
    assert!(
        invalidated.contains(&keys::scoped(keys::CHANNELS, COMMUNITY)),
        "{invalidated:?}"
    );
    assert!(
        invalidated.contains(&keys::scoped(keys::MENTIONABLE, COMMUNITY)),
        "{invalidated:?}"
    );
    assert!(
        invalidated.contains(&keys::scoped(keys::CAPABILITIES, COMMUNITY)),
        "{invalidated:?}"
    );
    // Its messages were dropped with it: opening it again reads its first page again.
    rig.core.open_conversation(channel()).await.unwrap();
    rig.settle().await;
    assert_eq!(
        rig.backend.page_requests.load(Ordering::SeqCst),
        pages + 1,
        "the dropped window is loaded afresh"
    );
}

#[tokio::test]
async fn a_private_channel_removed_leaves_another_open_channel_alone() {
    let mut rig = with_channels().await;
    rig.backend
        .set_messages(vec![message("m1", "bob", "hello")]);
    rig.core
        .open_conversation(Conversation::Channel { id: LOUNGE.into() })
        .await
        .unwrap();
    rig.settle().await;
    let pages = rig.backend.page_requests.load(Ordering::SeqCst);
    rig.backend
        .channels
        .lock()
        .unwrap()
        .retain(|channel| channel["id"] != CHANNEL);
    rig.core
        .ingest(private_changed("privateChannelRemoved", COMMUNITY, CHANNEL));
    let events = rig.settle().await;
    assert_eq!(
        removed_channels(&events),
        [(COMMUNITY.to_owned(), CHANNEL.to_owned())]
    );
    // The open channel kept its rows: opening it again asks for nothing.
    rig.core
        .open_conversation(Conversation::Channel { id: LOUNGE.into() })
        .await
        .unwrap();
    rig.settle().await;
    assert_eq!(rig.backend.page_requests.load(Ordering::SeqCst), pages);
}

#[tokio::test]
async fn private_channel_events_for_another_community_change_nothing() {
    let mut rig = with_channels().await;
    let requests = rig.backend.channel_requests.load(Ordering::SeqCst);
    rig.core
        .ingest(private_changed("privateChannelAdded", OTHER, CHANNEL));
    rig.core
        .ingest(private_changed("privateChannelRemoved", OTHER, CHANNEL));
    let events = rig.settle().await;
    assert_eq!(
        rig.backend.channel_requests.load(Ordering::SeqCst),
        requests
    );
    assert!(
        invalidated(&events).is_empty(),
        "{:?}",
        invalidated(&events)
    );
    assert!(removed_channels(&events).is_empty());
    assert_eq!(rig.core.channels(COMMUNITY.into()).len(), 2);
}

#[tokio::test]
async fn a_private_channel_removal_twice_announces_it_once() {
    let mut rig = with_channels().await;
    rig.core
        .ingest(private_changed("privateChannelRemoved", COMMUNITY, CHANNEL));
    rig.core
        .ingest(private_changed("privateChannelRemoved", COMMUNITY, CHANNEL));
    let events = rig.settle().await;
    assert_eq!(removed_channels(&events).len(), 1);
}

#[tokio::test]
async fn a_private_channel_event_after_sign_out_changes_nothing() {
    let mut rig = with_channels().await;
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    rig.core
        .ingest(private_changed("privateChannelRemoved", COMMUNITY, CHANNEL));
    let events = rig.settle().await;
    assert!(removed_channels(&events).is_empty());
    assert!(invalidated(&events).is_empty());
}

// --- Custom emoji, soundboard, mention groups and webhooks -------------------------------------

#[tokio::test]
async fn a_new_custom_emoji_reads_both_lists_again() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .emojis
        .lock()
        .unwrap()
        .push(emoji_json("e1", "wave"));
    rig.core.custom_emoji(COMMUNITY.into());
    rig.core.custom_emojis(COMMUNITY.into());
    rig.settle().await;
    assert_eq!(rig.backend.emoji_requests.load(Ordering::SeqCst), 2);
    rig.backend
        .emojis
        .lock()
        .unwrap()
        .push(emoji_json("e2", "party"));
    rig.core.ingest(event(
        "customEmojiCreated",
        json!({ "communityId": COMMUNITY, "emojiId": "e2" }),
    ));
    let events = rig.settle().await;
    assert_eq!(
        rig.backend.emoji_requests.load(Ordering::SeqCst),
        4,
        "the settings tab's list and the pickers' both read again"
    );
    assert_eq!(rig.core.custom_emoji(COMMUNITY.into()).emojis.len(), 2);
    assert_eq!(rig.core.custom_emojis(COMMUNITY.into()).len(), 2);
    let views = views(&events);
    assert!(views.contains(&ViewKey::CustomEmoji {
        community_id: COMMUNITY.into()
    }));
    assert!(views.contains(&ViewKey::Mentionables {
        community_id: COMMUNITY.into()
    }));
}

#[tokio::test]
async fn a_deleted_custom_emoji_leaves_both_lists() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .emojis
        .lock()
        .unwrap()
        .push(emoji_json("e1", "wave"));
    rig.backend
        .emojis
        .lock()
        .unwrap()
        .push(emoji_json("e2", "party"));
    rig.core.custom_emoji(COMMUNITY.into());
    rig.core.custom_emojis(COMMUNITY.into());
    rig.settle().await;
    rig.backend
        .emojis
        .lock()
        .unwrap()
        .retain(|emoji| emoji["id"] != "e2");
    rig.core.ingest(event(
        "customEmojiDeleted",
        json!({ "communityId": COMMUNITY, "emojiId": "e2" }),
    ));
    rig.settle().await;
    let tab: Vec<String> = rig
        .core
        .custom_emoji(COMMUNITY.into())
        .emojis
        .iter()
        .map(|emoji| emoji.id.clone())
        .collect();
    assert_eq!(tab, ["e1"]);
    assert_eq!(rig.core.custom_emojis(COMMUNITY.into()).len(), 1);
}

#[tokio::test]
async fn an_emoji_event_for_another_community_reads_nothing() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.custom_emoji(COMMUNITY.into());
    rig.core.custom_emojis(COMMUNITY.into());
    rig.settle().await;
    rig.core.ingest(event(
        "customEmojiCreated",
        json!({ "communityId": OTHER, "emojiId": "e9" }),
    ));
    let events = rig.settle().await;
    assert_eq!(rig.backend.emoji_requests.load(Ordering::SeqCst), 2);
    assert!(invalidated(&events).is_empty());
}

#[tokio::test]
async fn a_new_sound_reads_the_soundboard_again() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("sounds", json!([sound_json("s1", "chime")]));
    rig.core.soundboard(COMMUNITY.into());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("sounds"), 1);
    assert_eq!(rig.core.soundboard(COMMUNITY.into()).sounds.len(), 1);
    rig.backend.w4.answer(
        "sounds",
        json!([sound_json("s1", "chime"), sound_json("s2", "boing")]),
    );
    rig.core.ingest(event(
        "soundboardSoundCreated",
        json!({ "communityId": COMMUNITY, "soundId": "s2" }),
    ));
    let events = rig.settle().await;
    assert_eq!(rig.backend.w4.count("sounds"), 2);
    assert_eq!(rig.core.soundboard(COMMUNITY.into()).sounds.len(), 2);
    assert!(views(&events).contains(&ViewKey::Soundboard {
        community_id: COMMUNITY.into()
    }));
}

#[tokio::test]
async fn a_deleted_sound_leaves_the_soundboard() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer(
        "sounds",
        json!([sound_json("s1", "chime"), sound_json("s2", "boing")]),
    );
    rig.core.soundboard(COMMUNITY.into());
    rig.settle().await;
    rig.backend
        .w4
        .answer("sounds", json!([sound_json("s1", "chime")]));
    rig.core.ingest(event(
        "soundboardSoundDeleted",
        json!({ "communityId": COMMUNITY, "soundId": "s2" }),
    ));
    rig.settle().await;
    let ids: Vec<String> = rig
        .core
        .soundboard(COMMUNITY.into())
        .sounds
        .iter()
        .map(|sound| sound.id.clone())
        .collect();
    assert_eq!(ids, ["s1"]);
}

#[tokio::test]
async fn a_sound_event_for_another_community_reads_nothing() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("sounds", json!([]));
    rig.core.soundboard(COMMUNITY.into());
    rig.settle().await;
    rig.core.ingest(event(
        "soundboardSoundCreated",
        json!({ "communityId": OTHER, "soundId": "s9" }),
    ));
    let events = rig.settle().await;
    assert_eq!(rig.backend.w4.count("sounds"), 1);
    assert!(invalidated(&events).is_empty());
}

async fn with_mention_groups() -> Rig {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("alias_groups", json!([group_summary(GROUP, "devs", 2)]));
    rig.backend
        .w4
        .answer("alias_group", group_json(GROUP, "devs", &[ME, "bob"]));
    rig.core.alias_groups(COMMUNITY.into());
    rig.core.alias_group(GROUP.into());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("alias_groups"), 1);
    assert_eq!(rig.backend.w4.count("alias_group"), 1);
    rig
}

#[tokio::test]
async fn every_mention_group_event_reads_the_lists_again() {
    for name in [
        "aliasGroupCreated",
        "aliasGroupUpdated",
        "aliasGroupDeleted",
        "aliasGroupMembersUpdated",
    ] {
        let mut rig = with_mention_groups().await;
        rig.core.ingest(event(
            name,
            json!({ "communityId": COMMUNITY, "groupId": GROUP }),
        ));
        let events = rig.settle().await;
        assert_eq!(rig.backend.w4.count("alias_groups"), 2, "{name}: the list");
        assert_eq!(rig.backend.w4.count("alias_group"), 2, "{name}: the group");
        let views = views(&events);
        assert!(
            views.contains(&ViewKey::AliasGroups {
                community_id: COMMUNITY.into()
            }),
            "{name}: {views:?}"
        );
        assert!(
            views.contains(&ViewKey::AliasGroup {
                group_id: GROUP.into()
            }),
            "{name}: {views:?}"
        );
    }
}

#[tokio::test]
async fn a_mention_group_event_for_another_community_changes_nothing() {
    let mut rig = with_mention_groups().await;
    rig.core.ingest(event(
        "aliasGroupCreated",
        json!({ "communityId": OTHER, "groupId": "elsewhere" }),
    ));
    let events = rig.settle().await;
    assert_eq!(rig.backend.w4.count("alias_groups"), 1);
    assert_eq!(rig.backend.w4.count("alias_group"), 1);
    assert!(invalidated(&events).is_empty());
}

#[tokio::test]
async fn a_new_webhook_reads_the_channels_list_again() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("webhooks", json!([]));
    rig.core.webhooks(CHANNEL.into());
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("webhooks"), 1);
    rig.backend
        .w4
        .answer("webhooks", json!([webhook_json("w1", "deploys", CHANNEL)]));
    rig.core.ingest(event(
        "webhookCreated",
        json!({ "communityId": COMMUNITY, "channelId": CHANNEL, "webhookId": "w1" }),
    ));
    let events = rig.settle().await;
    assert_eq!(rig.backend.w4.count("webhooks"), 2);
    let names: Vec<String> = rig
        .core
        .webhooks(CHANNEL.into())
        .webhooks
        .iter()
        .map(|webhook| webhook.name.clone())
        .collect();
    assert_eq!(names, ["deploys"]);
    assert!(views(&events).contains(&ViewKey::Webhooks {
        channel_id: CHANNEL.into()
    }));
}

#[tokio::test]
async fn a_deleted_webhook_leaves_the_channels_list() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend
        .w4
        .answer("webhooks", json!([webhook_json("w1", "deploys", CHANNEL)]));
    rig.core.webhooks(CHANNEL.into());
    rig.settle().await;
    rig.backend.w4.answer("webhooks", json!([]));
    rig.core.ingest(event(
        "webhookDeleted",
        json!({ "communityId": COMMUNITY, "channelId": CHANNEL, "webhookId": "w1" }),
    ));
    rig.settle().await;
    assert!(rig.core.webhooks(CHANNEL.into()).webhooks.is_empty());
}

#[tokio::test]
async fn a_webhook_event_for_another_channels_list_reads_nothing() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w4.answer("webhooks", json!([]));
    rig.core.webhooks(CHANNEL.into());
    rig.settle().await;
    rig.core.ingest(event(
        "webhookDeleted",
        json!({ "communityId": COMMUNITY, "channelId": LOUNGE, "webhookId": "w1" }),
    ));
    let events = rig.settle().await;
    assert_eq!(rig.backend.w4.count("webhooks"), 1);
    assert!(invalidated(&events).is_empty());
}

#[tokio::test]
async fn the_asset_events_after_sign_out_change_nothing() {
    let mut rig = with_mention_groups().await;
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    let (emoji, groups, sounds) = (
        rig.backend.emoji_requests.load(Ordering::SeqCst),
        rig.backend.w4.count("alias_groups"),
        rig.backend.w4.count("sounds"),
    );
    for (name, payload) in [
        (
            "customEmojiCreated",
            json!({ "communityId": COMMUNITY, "emojiId": "e9" }),
        ),
        (
            "soundboardSoundCreated",
            json!({ "communityId": COMMUNITY, "soundId": "s9" }),
        ),
        (
            "aliasGroupMembersUpdated",
            json!({ "communityId": COMMUNITY, "groupId": GROUP }),
        ),
        (
            "webhookCreated",
            json!({ "communityId": COMMUNITY, "channelId": CHANNEL, "webhookId": "w9" }),
        ),
    ] {
        rig.core.ingest(event(name, payload));
    }
    let events = rig.settle().await;
    assert_eq!(rig.backend.emoji_requests.load(Ordering::SeqCst), emoji);
    assert_eq!(rig.backend.w4.count("alias_groups"), groups);
    assert_eq!(rig.backend.w4.count("sounds"), sounds);
    assert!(
        invalidated(&events).is_empty(),
        "{:?}",
        invalidated(&events)
    );
}

// --- `timeoutRemoved`, whether lifted or run out ----------------------------------------------

async fn timeout_removed(expired: Option<bool>) -> (bool, usize) {
    let rig = Rig::new();
    *rig.backend.channels.lock().unwrap() = vec![channel_json(CHANNEL, "general", "TEXT", 0)];
    *rig.backend.capabilities.lock().unwrap() =
        Some(capabilities(false, Some("2026-11-11T12:00:00.000Z")));
    rig.backend.w5b.answer("timeouts", json!([]));
    let mut rig = rig.signed_in().await;
    rig.core.channels(COMMUNITY.into());
    rig.core.timeouts(COMMUNITY.into());
    rig.settle().await;
    assert!(
        !rig.core.channels(COMMUNITY.into())[0]
            .permissions
            .as_ref()
            .unwrap()
            .post,
        "the timeout holds the composer"
    );
    assert_eq!(rig.backend.w5b.count("timeouts"), 1);
    // The moderator lifted it, or it ran out: the same state either way.
    *rig.backend.capabilities.lock().unwrap() = Some(capabilities(true, None));
    let mut payload = json!({
        "communityId": COMMUNITY, "userId": ME, "moderatorId": "ada", "reason": null,
    });
    if let Some(expired) = expired {
        payload["expired"] = json!(expired);
    }
    rig.core.ingest(event("timeoutRemoved", payload));
    rig.settle().await;
    let post = rig.core.channels(COMMUNITY.into())[0]
        .permissions
        .as_ref()
        .unwrap()
        .post;
    (post, rig.backend.w5b.count("timeouts"))
}

#[tokio::test]
async fn a_timeout_removed_unlocks_the_composer_whether_lifted_or_expired() {
    for expired in [Some(true), Some(false), None] {
        let (post, timeouts) = timeout_removed(expired).await;
        assert!(post, "the composer unlocks ({expired:?})");
        assert_eq!(timeouts, 2, "the timeout list reads again ({expired:?})");
    }
}

#[tokio::test]
async fn a_timeout_removed_twice_is_harmless() {
    let rig = Rig::new();
    *rig.backend.channels.lock().unwrap() = vec![channel_json(CHANNEL, "general", "TEXT", 0)];
    *rig.backend.capabilities.lock().unwrap() =
        Some(capabilities(false, Some("2026-11-11T12:00:00.000Z")));
    let mut rig = rig.signed_in().await;
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    *rig.backend.capabilities.lock().unwrap() = Some(capabilities(true, None));
    let payload = json!({
        "communityId": COMMUNITY, "userId": ME, "moderatorId": "ada", "expired": false,
    });
    rig.core.ingest(event("timeoutRemoved", payload.clone()));
    rig.core.ingest(event("timeoutRemoved", payload));
    rig.settle().await;
    assert!(
        rig.core.channels(COMMUNITY.into())[0]
            .permissions
            .as_ref()
            .unwrap()
            .post
    );
}

#[tokio::test]
async fn a_timeout_removed_after_sign_out_reads_nothing() {
    let mut rig = with_channels().await;
    rig.backend.w5b.answer("timeouts", json!([]));
    rig.core.timeouts(COMMUNITY.into());
    rig.settle().await;
    let timeouts = rig.backend.w5b.count("timeouts");
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    rig.core.ingest(event(
        "timeoutRemoved",
        json!({
            "communityId": COMMUNITY, "userId": ME, "moderatorId": "ada", "expired": true,
        }),
    ));
    rig.settle().await;
    assert_eq!(rig.backend.w5b.count("timeouts"), timeouts);
    assert!(
        rig.core
            .query_state(&QueryKey::new(&[
                "moderationControllerGetTimeoutList",
                COMMUNITY
            ]))
            .is_none()
    );
}

#[tokio::test]
async fn a_timeout_removed_for_another_community_unlocks_nothing() {
    let rig = Rig::new();
    *rig.backend.channels.lock().unwrap() = vec![channel_json(CHANNEL, "general", "TEXT", 0)];
    *rig.backend.capabilities.lock().unwrap() =
        Some(capabilities(false, Some("2026-11-11T12:00:00.000Z")));
    rig.backend.w5b.answer("timeouts", json!([]));
    let mut rig = rig.signed_in().await;
    rig.core.channels(COMMUNITY.into());
    rig.core.timeouts(COMMUNITY.into());
    rig.settle().await;
    rig.core.ingest(event(
        "timeoutRemoved",
        json!({
            "communityId": OTHER, "userId": ME, "moderatorId": "ada", "expired": true,
        }),
    ));
    rig.settle().await;
    assert!(
        !rig.core.channels(COMMUNITY.into())[0]
            .permissions
            .as_ref()
            .unwrap()
            .post,
        "another community's timeout leaves this composer locked"
    );
    assert_eq!(
        rig.backend.w5b.count("timeouts"),
        1,
        "and this community's list isn't read again"
    );
}

// --- DM calls: declined and ended --------------------------------------------------------------

async fn ringing(dm: &str, by: &str) -> Rig {
    let mut rig = Rig::with_media().signed_in().await;
    rig.backend.w4.answer("dm_users", json!([presence(by)]));
    rig.backend.w2.answer("dms", json!([]));
    rig.core.ingest(started(dm, by));
    rig.settle().await;
    assert_eq!(
        rig.core.incoming_call().map(|call| call.dm_group_id),
        Some(dm.to_owned()),
        "ringing"
    );
    rig
}

async fn in_dm_call(dm: &str) -> Rig {
    let mut rig = Rig::with_media().signed_in().await;
    rig.backend.w4.answer("dm_users", json!([]));
    rig.backend.w2.answer("dms", json!([]));
    rig.core.join_dm_call(dm.into()).await.unwrap();
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
    assert_eq!(
        rig.core.voice().room,
        Some(VoiceRoom::Dm {
            dm_group_id: dm.into()
        })
    );
    rig
}

#[tokio::test]
async fn my_own_decline_elsewhere_stops_a_one_to_one_ring() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(declined(DM, ME, false));
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(cues(&events), [SoundCue::IncomingRingStop]);
    assert_eq!(withdrawn(&events), [ring_tag(DM)]);
    assert!(rig.core.voice().room.is_none(), "no call of ours ends");
}

#[tokio::test]
async fn my_own_decline_elsewhere_stops_a_group_ring() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(declined(DM, ME, true));
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(cues(&events), [SoundCue::IncomingRingStop]);
}

#[tokio::test]
async fn someone_elses_decline_leaves_a_ring_ringing() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(declined(DM, "bob", false));
    rig.core.ingest(declined(DM, "cat", true));
    let events = rig.settle().await;
    assert!(rig.core.incoming_call().is_some(), "still ringing");
    assert!(cues(&events).is_empty(), "{:?}", cues(&events));
}

#[tokio::test]
async fn a_decline_by_the_other_person_ends_the_callers_one_to_one_call() {
    let mut rig = in_dm_call(DM).await;
    rig.core.ingest(declined(DM, "bob", false));
    let events = rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
    assert_eq!(rig.core.voice().room, None);
    assert!(views(&events).contains(&ViewKey::Voice));
    assert!(
        rig.media
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|call| call == "disconnect"),
        "{:?}",
        rig.media.calls.lock().unwrap()
    );
}

#[tokio::test]
async fn a_decline_by_the_other_person_leaves_a_group_call_going() {
    let mut rig = in_dm_call(DM).await;
    rig.core.ingest(declined(DM, "bob", true));
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
    assert_eq!(
        rig.core.voice().room,
        Some(VoiceRoom::Dm {
            dm_group_id: DM.into()
        })
    );
}

#[tokio::test]
async fn my_own_decline_leaves_a_call_i_answered_alone() {
    let mut rig = in_dm_call(DM).await;
    rig.core.ingest(declined(DM, ME, false));
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected, "I'm in it");
}

#[tokio::test]
async fn a_decline_for_another_call_changes_nothing() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(declined(OTHER_DM, ME, false));
    rig.core.ingest(declined(OTHER_DM, "bob", false));
    rig.settle().await;
    assert!(rig.core.incoming_call().is_some());

    let mut rig = in_dm_call(DM).await;
    rig.core.ingest(declined(OTHER_DM, "bob", false));
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
}

#[tokio::test]
async fn a_decline_while_idle_does_nothing() {
    let mut rig = Rig::with_media().signed_in().await;
    rig.core.ingest(declined(DM, "bob", false));
    rig.core.ingest(declined(DM, ME, false));
    rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
}

#[tokio::test]
async fn declining_twice_stops_the_ring_once() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(declined(DM, ME, false));
    rig.core.ingest(declined(DM, ME, false));
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(cues(&events), [SoundCue::IncomingRingStop]);
    assert_eq!(withdrawn(&events).len(), 1);
}

#[tokio::test]
async fn a_call_that_ended_stops_its_ring_on_this_device() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(call_ended(DM));
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(cues(&events), [SoundCue::IncomingRingStop]);
    assert_eq!(withdrawn(&events), [ring_tag(DM)]);
}

#[tokio::test]
async fn a_call_that_ended_leaves_a_call_i_am_in_alone() {
    let mut rig = in_dm_call(DM).await;
    rig.core.ingest(call_ended(DM));
    let events = rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
    assert!(cues(&events).is_empty(), "{:?}", cues(&events));
}

#[tokio::test]
async fn a_call_that_ended_for_another_dm_rings_on() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(call_ended(OTHER_DM));
    rig.settle().await;
    assert!(rig.core.incoming_call().is_some());
}

#[tokio::test]
async fn call_events_after_sign_out_change_nothing() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    rig.core.ingest(declined(DM, ME, false));
    rig.core.ingest(declined(DM, "bob", false));
    rig.core.ingest(call_ended(DM));
    rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
}

#[tokio::test]
async fn declining_stops_the_ring_at_once_and_calls_the_endpoint_once() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.decline_incoming_call();
    assert_eq!(rig.core.incoming_call(), None, "at once, before any call");
    assert_eq!(rig.backend.w4.count("dm_decline"), 0);
    let events = rig.settle().await;
    assert_eq!(rig.backend.w4.count("dm_decline"), 1);
    assert_eq!(rig.backend.w4.calls().last().unwrap(), "dm_decline dm-1");
    assert_eq!(cues(&events), [SoundCue::IncomingRingStop]);
    assert_eq!(withdrawn(&events), [ring_tag(DM)]);
}

#[tokio::test]
async fn a_decline_the_server_refuses_stops_the_ring_anyway() {
    let mut rig = ringing(DM, "bob").await;
    rig.backend
        .w4
        .fail_next("dm_decline", refusal(409, "CONFLICT"));
    rig.core.decline_incoming_call();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("dm_decline"), 1, "tried once");
    assert_eq!(rig.core.incoming_call(), None, "and the ring is down");
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
}

#[tokio::test]
async fn declining_with_nothing_ringing_sends_nothing() {
    let mut rig = Rig::new().signed_in().await;
    rig.core.decline_incoming_call();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("dm_decline"), 0);
}

#[tokio::test]
async fn a_ring_declined_before_sign_out_is_not_sent_for_the_next_session() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.decline_incoming_call();
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("dm_decline"), 0);
}

/// Where the call ends, the same state as a call the server took away.
#[tokio::test]
async fn a_declined_call_ends_exactly_as_a_removed_channel_call_does() {
    let mut rig = in_dm_call(DM).await;
    rig.core.ingest(declined(DM, "bob", false));
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
    assert_eq!(rig.core.voice().room, None);
    assert!(rig.core.voice().error.is_none(), "ended without a reason");
}

// --- The moderation log's target message ------------------------------------------------------

#[tokio::test]
async fn a_log_entry_carries_the_target_message_from_the_contract() {
    let mut rig = Rig::new().signed_in().await;
    rig.backend.w5b.answer(
        "logs",
        json!({ "total": 2, "logs": [
            { "id": "l1", "communityId": COMMUNITY, "moderatorId": ME, "targetUserId": null,
              "targetMessageId": "m1", "action": "DELETE_MESSAGE", "reason": null,
              "metadata": { "messageId": "m1" },
              "createdAt": "2026-09-22T18:00:00Z", "moderator": null, "targetUser": null },
            { "id": "l2", "communityId": COMMUNITY, "moderatorId": ME, "targetUserId": null,
              "action": "PIN_MESSAGE", "reason": null,
              "metadata": { "messageId": "m2" },
              "createdAt": "2026-09-22T17:00:00Z", "moderator": null, "targetUser": null },
        ] }),
    );
    rig.core.moderation_log(COMMUNITY.into());
    rig.settle().await;
    let ids: Vec<Option<String>> = rig
        .core
        .moderation_log(COMMUNITY.into())
        .rows
        .iter()
        .map(|row| row.target_message_id.clone())
        .collect();
    assert_eq!(ids, [Some("m1".into()), Some("m2".into())]);
}
