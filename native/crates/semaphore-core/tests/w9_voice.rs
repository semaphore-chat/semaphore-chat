//! The screen before joining voice: who's here, which join controls the channel allows, and how a
//! join starts (muted, deafened).

mod common;

use common::*;
use semaphore_core::model::{LoadState, VoiceJoinMode, VoiceJoinOptions, VoiceStatus};
use serde_json::{Value, json};

const COMMUNITY: &str = "comm";
const VOICE: &str = "voice-1";
const OTHER: &str = "voice-2";

fn voice_channel(id: &str, name: &str, position: i32) -> Value {
    json!({
        "id": id, "name": name, "communityId": COMMUNITY, "type": "VOICE", "position": position,
        "slowmodeSeconds": 0, "preset": "NORMAL", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
}

fn capability(channel_id: &str, connect: bool, speak: bool, timed_out: Option<&str>) -> Value {
    json!({
        "channelId": channel_id, "view": true, "post": true, "attach": true, "react": true,
        "threadReply": true, "connect": connect, "speak": speak, "video": true, "share": true,
        "managePermissions": false, "postingRoleNames": [], "pin": true, "deleteAny": true,
        "seeRemoved": true, "timedOutUntil": timed_out,
    })
}

fn capabilities(connect: bool, speak: bool, timed_out: Option<&str>) -> Value {
    json!({
        "communityId": COMMUNITY,
        "channels": [
            capability(VOICE, connect, speak, timed_out),
            capability(OTHER, true, true, None),
        ],
    })
}

fn presence(id: &str) -> Value {
    json!({
        "id": id, "username": id, "displayName": format!("{id} name"),
        "avatarUrl": format!("{id}-file"), "joinedAt": "2026-09-22T18:00:00.000Z",
        "isDeafened": false, "isServerMuted": false,
    })
}

/// A rig with two voice channels, the given permissions for the first, and one person in a call.
async fn prejoin_rig(connect: bool, speak: bool, timed_out: Option<&str>) -> Rig {
    let rig = Rig::with_media();
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(voice_channel(VOICE, "Standup", 0));
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(voice_channel(OTHER, "Lounge", 1));
    *rig.backend.capabilities.lock().unwrap() = Some(capabilities(connect, speak, timed_out));
    *rig.backend.voice_users.lock().unwrap() = vec![presence("ava")];
    let mut rig = rig.signed_in().await;
    // Reading the pre-join asks for the channel list, its permissions and the presence.
    rig.core.voice_prejoin(COMMUNITY.into(), VOICE.into());
    rig.settle().await;
    rig
}

fn media_calls(rig: &Rig) -> Vec<String> {
    rig.media.calls.lock().unwrap().clone()
}

#[tokio::test]
async fn a_prejoin_says_who_is_here_and_offers_both_joins() {
    let rig = prejoin_rig(true, true, None).await;
    let view = rig.core.voice_prejoin(COMMUNITY.into(), VOICE.into());
    assert_eq!(view.state, LoadState::Ready);
    assert_eq!(view.channel_id, VOICE);
    assert_eq!(view.community_id, COMMUNITY);
    assert_eq!(view.channel_name, "Standup");
    assert_eq!(view.users.len(), 1);
    assert_eq!(view.users[0].id, "ava");
    assert_eq!(view.users[0].display_name.as_deref(), Some("ava name"));
    assert_eq!(view.mode, VoiceJoinMode::Full);
    assert_eq!(view.timed_out_until_ms, None);
    assert_eq!(view.connected_elsewhere, None);
    assert!(!view.muted && !view.deafened);

    // Another channel's presence is its own read: Loading until it lands, then Ready.
    let mut rig = rig;
    let empty = rig.core.voice_prejoin(COMMUNITY.into(), OTHER.into());
    assert_eq!(empty.state, LoadState::Loading);
    rig.settle().await;
    let other = rig.core.voice_prejoin(COMMUNITY.into(), OTHER.into());
    assert_eq!(other.state, LoadState::Ready);
    assert_eq!(other.channel_name, "Lounge");
}

#[tokio::test]
async fn without_connect_there_is_no_join_button() {
    let rig = prejoin_rig(false, true, None).await;
    let view = rig.core.voice_prejoin(COMMUNITY.into(), VOICE.into());
    assert_eq!(view.mode, VoiceJoinMode::None);
    assert!(view.users.len() == 1, "the room is still described");
}

#[tokio::test]
async fn without_speak_it_is_listen_only_and_a_timeout_says_until_when() {
    let rig = prejoin_rig(true, false, Some("2026-09-23T00:00:00Z")).await;
    let view = rig.core.voice_prejoin(COMMUNITY.into(), VOICE.into());
    assert_eq!(view.mode, VoiceJoinMode::ListenOnly);
    assert_eq!(view.timed_out_until_ms, Some(1_790_121_600_000));
}

#[tokio::test]
async fn a_timeout_with_speak_left_is_only_reported() {
    // A timeout masks the send but not the listen: core shows the mode the server grants.
    let rig = prejoin_rig(true, true, Some("2026-09-23T00:00:00Z")).await;
    let view = rig.core.voice_prejoin(COMMUNITY.into(), VOICE.into());
    assert_eq!(view.mode, VoiceJoinMode::Full);
    assert_eq!(view.timed_out_until_ms, Some(1_790_121_600_000));
}

#[tokio::test]
async fn joining_from_another_call_names_the_channel_it_moves_you_from() {
    let rig = prejoin_rig(true, true, None).await;
    rig.core.join_voice(VOICE.into()).await.unwrap();
    rig.core.run_until_idle().await;
    let view = rig.core.voice_prejoin(COMMUNITY.into(), OTHER.into());
    assert_eq!(view.connected_elsewhere.as_deref(), Some("Standup"));
    // The channel being joined isn't "elsewhere".
    let here = rig.core.voice_prejoin(COMMUNITY.into(), VOICE.into());
    assert_eq!(here.connected_elsewhere, None);
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
}

#[tokio::test]
async fn join_muted_starts_the_call_muted_and_tells_the_engine_before_connecting() {
    let rig = prejoin_rig(true, true, None).await;
    rig.core
        .join_voice_with(
            VOICE.into(),
            VoiceJoinOptions {
                muted: true,
                deafened: false,
            },
        )
        .await
        .unwrap();
    rig.core.run_until_idle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
    assert!(rig.core.voice().muted);
    assert!(!rig.core.voice().deafened);
    let calls = media_calls(&rig);
    let muted = calls.iter().position(|call| call == "muted true");
    let connected = calls.iter().position(|call| call.starts_with("connect "));
    assert!(muted.is_some(), "{calls:?}");
    assert!(
        muted < connected,
        "the engine is told before it connects: {calls:?}"
    );
}

#[tokio::test]
async fn join_deafened_starts_deafened_and_the_view_says_so() {
    let rig = prejoin_rig(true, true, None).await;
    rig.core
        .join_voice_with(
            VOICE.into(),
            VoiceJoinOptions {
                muted: false,
                deafened: true,
            },
        )
        .await
        .unwrap();
    rig.core.run_until_idle().await;
    assert!(rig.core.voice().deafened);
    let calls = media_calls(&rig);
    let deafened = calls.iter().position(|call| call == "deafened true");
    let connected = calls.iter().position(|call| call.starts_with("connect "));
    assert!(deafened.is_some() && deafened < connected, "{calls:?}");
    let view = rig.core.voice_prejoin(COMMUNITY.into(), VOICE.into());
    assert!(
        view.deafened,
        "the pre-join shows what the next join would do"
    );
}

#[tokio::test]
async fn the_plain_join_is_unmuted_and_undeafened() {
    let rig = prejoin_rig(true, true, None).await;
    rig.core.join_voice(VOICE.into()).await.unwrap();
    rig.core.run_until_idle().await;
    assert!(!rig.core.voice().muted);
    assert!(!rig.core.voice().deafened);
    let calls = media_calls(&rig);
    assert!(calls.iter().any(|call| call == "muted false"), "{calls:?}");
    assert!(
        calls.iter().any(|call| call == "deafened false"),
        "{calls:?}"
    );
}
