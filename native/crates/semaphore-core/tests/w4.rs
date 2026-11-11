//! W4: DM calls and the incoming call, moderator voice actions, the soundboard, the replay buffer
//! and clips, voice diagnostics, keep-awake and sound cues, against `FakeBackend`, `FakeMedia` and
//! `FakeClock`.

mod common;

use common::w4::{clip_json, sound_json};
use common::*;
use semaphore_core::model::{
    CaptureRequest, ClipDestination, JoinFailureClass, LoadState, LocalMediaView, LocalShare,
    RING_MS, ReplayMinutes, ReplayState, ReplayTrim, ScreenShareRequest, ShareTracks, SoundCue,
    VoiceModerationCaps, VoiceRoom, VoiceStatus, VoiceView,
};
use semaphore_core::platform::{CoreError, CoreEvent};
use serde_json::{Value, json};
use std::sync::Arc;

const DM: &str = "dm-1";
const OTHER_DM: &str = "dm-2";
/// Replay start takes the channel as a UUID.
const VOICE: &str = "00000000-0000-4000-8000-000000000001";
const COMMUNITY: &str = "comm";

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

fn dm_joined(dm: &str, user: &str) -> semaphore_core::realtime::RealtimeEvent {
    event(
        "dmVoiceUserJoined",
        json!({ "dmGroupId": dm, "user": presence(user) }),
    )
}

fn dm_left(dm: &str, user: &str) -> semaphore_core::realtime::RealtimeEvent {
    event(
        "dmVoiceUserLeft",
        json!({ "dmGroupId": dm, "userId": user, "user": presence(user) }),
    )
}

fn voice_channel(id: &str) -> Value {
    json!({
        "id": id, "name": id, "communityId": COMMUNITY, "type": "VOICE", "position": 1,
        "slowmodeSeconds": 0, "preset": "PUBLIC", "isPrivate": false,
        "createdAt": "2026-09-22T18:00:00.000Z",
    })
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

fn media_calls(rig: &Rig) -> Vec<String> {
    rig.media.calls.lock().unwrap().clone()
}

fn voice_calls(rig: &Rig) -> Vec<String> {
    rig.backend.voice_calls.lock().unwrap().clone()
}

async fn signed_in() -> Rig {
    Rig::with_media().signed_in().await
}

/// In a channel call, the channel in its community's cached list.
async fn in_channel_call(users: &[&str]) -> Rig {
    let rig = Rig::with_media();
    rig.backend
        .channels
        .lock()
        .unwrap()
        .push(voice_channel(VOICE));
    *rig.backend.voice_users.lock().unwrap() = users.iter().map(|id| presence(id)).collect();
    let mut rig = rig.signed_in().await;
    rig.core.channels(COMMUNITY.into());
    rig.settle().await;
    assert_eq!(
        rig.core.channels(COMMUNITY.into()).len(),
        1,
        "the channel is cached"
    );
    rig.core.join_voice(VOICE.into()).await.unwrap();
    rig.settle().await;
    rig
}

async fn in_dm_call(users: &[&str]) -> Rig {
    let mut rig = signed_in().await;
    rig.backend.w4.answer(
        "dm_users",
        Value::Array(users.iter().map(|id| presence(id)).collect()),
    );
    rig.core.join_dm_call(DM.into()).await.unwrap();
    rig.settle().await;
    rig
}

async fn ringing(dm: &str, by: &str) -> Rig {
    let mut rig = signed_in().await;
    rig.backend.w4.answer("dm_users", json!([presence(by)]));
    rig.core.ingest(started(dm, by));
    rig.settle().await;
    rig
}

// --- The incoming call ---

#[tokio::test]
async fn someone_elses_call_rings_for_thirty_seconds_with_a_notification() {
    let mut rig = signed_in().await;
    rig.backend.w4.answer("dm_users", json!([presence("bob")]));
    rig.core.ingest(started(DM, "bob"));
    let events = rig.settle().await;
    let call = rig.core.incoming_call().expect("ringing");
    assert_eq!(call.dm_group_id, DM);
    assert_eq!(call.caller.id, "bob");
    assert_eq!(call.group_name, "bob name");
    assert_eq!(call.expires_at_ms, call.started_at_ms + RING_MS);
    assert_eq!(cues(&events), vec![SoundCue::IncomingRingStart]);
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::Notify { notification } if notification.tag == format!("dm-call-{DM}")
            && notification.title == "bob name is calling"
    )));
}

#[tokio::test]
async fn a_ring_whose_call_reads_empty_has_already_ended() {
    let mut rig = signed_in().await;
    rig.core.ingest(started(DM, "bob"));
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(
        cues(&events),
        vec![SoundCue::IncomingRingStart, SoundCue::IncomingRingStop]
    );
}

#[tokio::test]
async fn our_own_call_does_not_ring() {
    let mut rig = signed_in().await;
    rig.core.ingest(started(DM, ME));
    rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
}

#[tokio::test]
async fn a_call_we_are_in_does_not_ring() {
    let mut rig = in_dm_call(&[ME]).await;
    // Both called at once: the webhook can announce the other's start too (#662).
    rig.core.ingest(started(DM, "bob"));
    rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
}

#[tokio::test]
async fn a_call_we_are_still_joining_does_not_ring() {
    let mut rig = signed_in().await;
    let hold = rig.backend.w4.hold("dm_token");
    let core = rig.core.clone();
    let join = tokio::spawn(async move { core.join_dm_call(DM.into()).await });
    tokio::task::yield_now().await;
    rig.core.ingest(started(DM, "bob"));
    assert_eq!(rig.core.incoming_call(), None);
    hold.send(()).unwrap();
    join.await.unwrap().unwrap();
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
}

#[tokio::test]
async fn the_newest_ring_wins_and_keeps_ringing() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(started(OTHER_DM, "cat"));
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call().unwrap().dm_group_id, OTHER_DM);
    assert!(cues(&events).is_empty(), "no second ring start or a stop");
}

#[tokio::test]
async fn a_ring_gives_up_after_thirty_seconds() {
    let mut rig = ringing(DM, "bob").await;
    rig.clock.advance(RING_MS - 1);
    rig.core.expire_incoming_call();
    assert!(rig.core.incoming_call().is_some(), "too early");
    rig.clock.advance(1);
    rig.core.expire_incoming_call();
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(cues(&events), vec![SoundCue::IncomingRingStop]);
    assert!(events.iter().any(|event| matches!(
        event,
        CoreEvent::WithdrawNotifications { tag } if tag == &format!("dm-call-{DM}")
    )));
}

#[tokio::test]
async fn declining_stops_the_ring_and_tells_nobody() {
    let mut rig = ringing(DM, "bob").await;
    let before = rig.backend.w4.calls();
    rig.core.decline_incoming_call();
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(cues(&events), vec![SoundCue::IncomingRingStop]);
    assert_eq!(rig.backend.w4.calls(), before);
    assert!(rig.core.voice().room.is_none());
}

#[tokio::test]
async fn accepting_leaves_the_channel_call_and_joins_the_dm_call() {
    let mut rig = in_channel_call(&[ME]).await;
    rig.backend.w4.answer("dm_users", json!([presence("bob")]));
    rig.core.ingest(started(DM, "bob"));
    rig.settle().await;
    rig.core.accept_incoming_call().await.unwrap();
    rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    let voice = rig.core.voice();
    assert_eq!(
        voice.room,
        Some(VoiceRoom::Dm {
            dm_group_id: DM.into()
        })
    );
    assert_eq!(voice.channel_id, None);
    assert_eq!(voice.status, VoiceStatus::Connected);
    assert_eq!(voice_calls(&rig), vec!["join", "leave"]);
    let w4 = rig.backend.w4.calls();
    let token = w4.iter().position(|call| call == &format!("dm_token {DM}"));
    let refresh = w4
        .iter()
        .position(|call| call == &format!("dm_refresh {DM}"));
    assert!(token.unwrap() < refresh.unwrap(), "{w4:?}");
    assert!(
        media_calls(&rig)
            .iter()
            .any(|call| call.starts_with("connect ws://livekit dm-token-"))
    );
}

#[tokio::test]
async fn an_answer_on_another_device_stops_the_ring() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.ingest(dm_joined(DM, ME));
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert_eq!(cues(&events), vec![SoundCue::IncomingRingStop]);
}

#[tokio::test]
async fn the_caller_giving_up_stops_the_ring() {
    let mut rig = ringing(DM, "bob").await;
    assert_eq!(rig.backend.w4.count("dm_presence"), 1, "read to know");
    rig.core.ingest(dm_left(DM, "bob"));
    rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
}

#[tokio::test]
async fn a_group_call_keeps_ringing_while_others_are_in_it() {
    let mut rig = signed_in().await;
    rig.backend
        .w4
        .answer("dm_users", json!([presence("bob"), presence("cat")]));
    rig.core.ingest(started(DM, "bob"));
    rig.settle().await;
    rig.core.ingest(dm_left(DM, "bob"));
    rig.settle().await;
    assert!(rig.core.incoming_call().is_some());
}

#[tokio::test]
async fn signing_out_stops_the_ring() {
    let mut rig = ringing(DM, "bob").await;
    rig.core.sign_out().await.unwrap();
    let events = rig.settle().await;
    assert_eq!(rig.core.incoming_call(), None);
    assert!(cues(&events).contains(&SoundCue::IncomingRingStop));
}

#[tokio::test]
async fn a_group_is_named_as_the_dm_list_names_it() {
    let mut rig = signed_in().await;
    rig.backend.w2.answer(
        "dms",
        json!([{
            "id": DM, "name": "Team", "isGroup": true, "createdAt": "2026-09-20T10:00:00.000Z",
            "members": [], "lastMessage": null,
        }]),
    );
    rig.core.dm_list();
    rig.settle().await;
    rig.backend.w4.answer("dm_users", json!([presence("bob")]));
    rig.core.ingest(started(DM, "bob"));
    rig.settle().await;
    assert_eq!(rig.core.incoming_call().unwrap().group_name, "Team");
}

// --- DM calls ---

#[tokio::test]
async fn a_dm_call_uses_dm_presence_and_never_channel_presence() {
    let mut rig = in_dm_call(&["bob"]).await;
    let voice = rig.core.voice();
    assert_eq!(voice.status, VoiceStatus::Connected);
    assert_eq!(
        voice
            .participants
            .iter()
            .map(|p| p.identity.as_str())
            .collect::<Vec<_>>(),
        vec!["bob"]
    );
    rig.core.refresh_voice_presence().await;
    assert_eq!(rig.backend.w4.count("dm_refresh"), 2);
    let token = rig.core.voice_token().await.unwrap();
    assert!(token.starts_with("dm-token-"));
    rig.core.leave_voice().await.unwrap();
    rig.settle().await;
    assert!(voice_calls(&rig).is_empty(), "{:?}", voice_calls(&rig));
    assert_eq!(rig.core.voice().room, None);
}

#[tokio::test]
async fn a_blocked_dm_fails_the_join_with_the_servers_message() {
    let mut rig = signed_in().await;
    rig.backend
        .w4
        .fail_next("dm_token", refusal(403, "FORBIDDEN"));
    let error = rig.core.join_dm_call(DM.into()).await.unwrap_err();
    assert!(matches!(error, CoreError::Failed { .. }));
    rig.settle().await;
    assert_eq!(rig.core.voice(), VoiceView::default());
    let failure = rig.core.voice_diagnostics().last_failure.unwrap();
    assert_eq!(failure.class, JoinFailureClass::Permission);
}

#[tokio::test]
async fn a_media_failure_is_classed_as_media_unreachable() {
    let mut rig = signed_in().await;
    *rig.media.connect_fails.lock().unwrap() = true;
    rig.core.join_voice(VOICE.into()).await.unwrap_err();
    rig.settle().await;
    let failure = rig.core.voice_diagnostics().last_failure.unwrap();
    assert_eq!(failure.class, JoinFailureClass::MediaUnreachable);
}

// --- Server mute and moderator actions ---

#[tokio::test]
async fn a_server_mute_on_me_shows_and_holds_the_mic() {
    let mut rig = in_channel_call(&[ME]).await;
    let mut me = presence(ME);
    me["isServerMuted"] = json!(true);
    rig.core.ingest(event(
        "voiceChannelUserUpdated",
        json!({ "channelId": VOICE, "userId": ME, "user": me }),
    ));
    rig.settle().await;
    assert!(rig.core.voice().server_muted);
    assert!(rig.core.voice().participants[0].server_muted);
    assert!(rig.core.set_muted(false).await.is_err());
    rig.core.set_muted(true).await.unwrap();
}

#[tokio::test]
async fn a_moderator_mutes_someone_in_the_call() {
    let rig = in_channel_call(&[ME, "bob"]).await;
    rig.core.server_mute("bob".into(), true).await.unwrap();
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&format!("mute {VOICE} bob true"))
    );
    rig.backend.w4.fail_next("mute", refusal(403, "FORBIDDEN"));
    let error = rig.core.server_mute("bob".into(), false).await.unwrap_err();
    assert!(matches!(error, CoreError::Failed { .. }));
}

#[tokio::test]
async fn server_mute_needs_a_channel_call() {
    let rig = in_dm_call(&[ME]).await;
    assert!(rig.core.server_mute("bob".into(), true).await.is_err());
}

#[tokio::test]
async fn what_a_moderator_may_do_comes_from_their_roles() {
    let mut rig = signed_in().await;
    assert_eq!(
        rig.core.voice_moderation_caps(VOICE.into()),
        VoiceModerationCaps::default()
    );
    *rig.backend.actions.role_actions.lock().unwrap() = vec!["MUTE_PARTICIPANT"];
    rig.core.voice_moderation_caps(VOICE.into());
    rig.settle().await;
    assert_eq!(
        rig.core.voice_moderation_caps(VOICE.into()),
        VoiceModerationCaps {
            can_server_mute: true,
            can_kick: false,
        }
    );
}

#[tokio::test]
async fn kicking_sends_the_reason() {
    let rig = signed_in().await;
    rig.core
        .kick_member(COMMUNITY.into(), "bob".into(), Some("spam".into()))
        .await
        .unwrap();
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&format!("kick {COMMUNITY} bob spam"))
    );
}

#[tokio::test]
async fn participant_volume_goes_to_the_engine_capped() {
    let rig = signed_in().await;
    rig.core.set_participant_volume("bob".into(), 350);
    assert!(media_calls(&rig).contains(&"volume bob 200".to_owned()));
}

// --- Soundboard ---

#[tokio::test]
async fn the_soundboard_lists_and_plays_into_the_call_fetching_each_file_once() {
    let mut rig = in_channel_call(&[ME]).await;
    rig.backend
        .w4
        .answer("sounds", json!([sound_json("s1", "f1")]));
    rig.backend
        .files
        .lock()
        .unwrap()
        .insert("f1".into(), vec![1, 2, 3]);
    assert_eq!(
        rig.core.soundboard(COMMUNITY.into()).state,
        LoadState::Loading
    );
    rig.settle().await;
    let board = rig.core.soundboard(COMMUNITY.into());
    assert_eq!(board.state, LoadState::Ready);
    assert_eq!(board.sounds[0].name, "s1 name");
    rig.core.play_sound("s1".into()).await.unwrap();
    rig.core.play_sound("s1".into()).await.unwrap();
    assert_eq!(rig.backend.w4.count("file"), 1);
    let plays: Vec<_> = media_calls(&rig)
        .into_iter()
        .filter(|call| call.starts_with("soundboard s1"))
        .collect();
    assert_eq!(plays, vec!["soundboard s1 3", "soundboard s1 3"]);
    rig.core.stop_sound();
    assert!(media_calls(&rig).contains(&"soundboard stop".to_owned()));
}

#[tokio::test]
async fn the_soundboard_is_for_channel_calls() {
    let rig = signed_in().await;
    assert!(matches!(
        rig.core.play_sound("s1".into()).await,
        Err(CoreError::Unavailable { .. })
    ));
    let rig = in_dm_call(&[ME]).await;
    assert!(rig.core.play_sound("s1".into()).await.is_err());
}

#[tokio::test]
async fn an_engine_refusal_shows_on_the_soundboard() {
    let mut rig = in_channel_call(&[ME]).await;
    rig.backend
        .w4
        .answer("sounds", json!([sound_json("s1", "f1")]));
    rig.backend
        .files
        .lock()
        .unwrap()
        .insert("f1".into(), vec![1]);
    rig.core.soundboard(COMMUNITY.into());
    rig.settle().await;
    *rig.media.soundboard_fails.lock().unwrap() = Some("track refused".into());
    assert!(rig.core.play_sound("s1".into()).await.is_err());
    let board = rig.core.soundboard(COMMUNITY.into());
    assert_eq!(board.playing, None);
    assert!(board.error.unwrap().message.contains("track refused"));
}

// --- Replay ---

fn sharing(tracks: Option<ShareTracks>, audio: bool) -> VoiceView {
    VoiceView {
        status: VoiceStatus::Connected,
        local: LocalMediaView {
            screen: LocalShare::On,
            screen_audio: if audio {
                LocalShare::On
            } else {
                LocalShare::Off
            },
            screen_tracks: tracks,
            may_share: true,
            ..LocalMediaView::default()
        },
        ..VoiceView::default()
    }
}

fn tracks(video: &str, audio: Option<&str>) -> Option<ShareTracks> {
    Some(ShareTracks {
        video_sid: video.into(),
        audio_sid: audio.map(Into::into),
    })
}

/// The share running with its audio, its tracks not yet reported.
async fn sharing_in(rig: &mut Rig) {
    rig.core
        .start_screen_share(ScreenShareRequest::default())
        .await
        .unwrap();
    rig.core.ingest_media(1, sharing(None, true));
    rig.settle().await;
}

#[tokio::test]
async fn the_replay_buffer_starts_with_a_published_share_and_stops_with_it() {
    let mut rig = in_channel_call(&[ME]).await;
    rig.backend.w4.answer(
        "replay_start",
        json!({ "sessionId": "sess", "egressId": "eg", "status": "active" }),
    );
    rig.backend.w4.answer(
        "replay_stop",
        json!({ "sessionId": "sess", "egressId": "eg", "status": "stopped" }),
    );
    sharing_in(&mut rig).await;
    assert_eq!(rig.backend.w4.count("replay_start"), 0, "no tracks yet");
    // The video first: the audio track is still being published.
    rig.core
        .ingest_media(1, sharing(tracks("TR_v", None), true));
    rig.settle().await;
    assert_eq!(
        rig.backend.w4.count("replay_start"),
        0,
        "waits for its audio"
    );
    rig.core
        .ingest_media(1, sharing(tracks("TR_v", Some("TR_a")), true));
    rig.settle().await;
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&format!("replay_start {VOICE} TR_v TR_a {ME}"))
    );
    assert_eq!(
        rig.core.voice().replay,
        ReplayState::Recording {
            session_id: "sess".into()
        }
    );
    rig.core.stop_screen_share().await.unwrap();
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("replay_stop"), 1);
    assert_eq!(rig.core.voice().replay, ReplayState::Off);
}

#[tokio::test]
async fn a_share_without_audio_starts_the_buffer_with_the_video_alone() {
    let mut rig = in_channel_call(&[ME]).await;
    rig.backend.w4.answer(
        "replay_start",
        json!({ "sessionId": "sess", "egressId": "eg", "status": "active" }),
    );
    rig.core
        .start_screen_share(ScreenShareRequest {
            audio: false,
            ..ScreenShareRequest::default()
        })
        .await
        .unwrap();
    rig.core
        .ingest_media(1, sharing(tracks("TR_v", None), false));
    rig.settle().await;
    assert!(
        rig.backend
            .w4
            .calls()
            .contains(&format!("replay_start {VOICE} TR_v  {ME}"))
    );
}

#[tokio::test]
async fn a_failed_buffer_says_why_and_is_not_restarted_for_the_same_share() {
    let mut rig = in_channel_call(&[ME]).await;
    rig.backend.w4.answer(
        "replay_start",
        json!({ "sessionId": "sess", "egressId": "eg", "status": "active" }),
    );
    sharing_in(&mut rig).await;
    rig.core
        .ingest_media(1, sharing(tracks("TR_v", Some("TR_a")), true));
    rig.settle().await;
    rig.core.ingest(event(
        "replayBufferFailed",
        json!({ "sessionId": "sess", "egressId": "eg", "channelId": VOICE, "error": "egress died" }),
    ));
    rig.settle().await;
    assert_eq!(
        rig.core.voice().replay,
        ReplayState::Failed {
            message: "egress died".into()
        }
    );
    rig.core
        .ingest_media(1, sharing(tracks("TR_v", Some("TR_a2")), true));
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("replay_start"), 1);
}

#[tokio::test]
async fn a_dm_call_has_no_replay_buffer() {
    let mut rig = in_dm_call(&[ME]).await;
    sharing_in(&mut rig).await;
    rig.core
        .ingest_media(1, sharing(tracks("TR_v", Some("TR_a")), true));
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("replay_start"), 0);
    assert_eq!(rig.core.voice().replay, ReplayState::Off);
}

#[tokio::test]
async fn segments_ready_reads_the_session_again() {
    let mut rig = signed_in().await;
    rig.backend.w4.answer(
        "session_info",
        json!({ "hasActiveSession": true, "sessionId": "sess", "totalSegments": 3, "totalDurationSeconds": 30 }),
    );
    rig.core.replay_session();
    rig.settle().await;
    let session = rig.core.replay_session();
    assert!(session.active);
    assert_eq!(session.total_seconds, 30);
    rig.core.ingest(event(
        "egressSegmentsReady",
        json!({ "sessionId": "sess", "channelId": VOICE }),
    ));
    rig.settle().await;
    assert_eq!(rig.backend.w4.count("session_info"), 2);
}

#[tokio::test]
async fn the_preview_lists_its_segments_on_this_server() {
    let rig = signed_in().await;
    rig.backend.w4.answer(
        "playlist",
        json!("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.000,\nsegment/seg_0001.ts\n#EXTINF:4.5,\n/api/livekit/replay/preview/segment/seg_0002.ts\n#EXT-X-ENDLIST\n"),
    );
    let segments = rig.core.replay_preview().await.unwrap();
    assert_eq!(segments.len(), 2);
    assert_eq!(
        segments[0].url,
        "http://server/api/livekit/replay/preview/segment/seg_0001.ts"
    );
    assert_eq!(segments[0].duration_ms, 10_000);
    assert_eq!(segments[1].duration_ms, 4_500);
}

#[tokio::test]
async fn a_capture_is_checked_then_posted() {
    let rig = signed_in().await;
    let bad = CaptureRequest {
        minutes: ReplayMinutes::Five,
        trim: Some(ReplayTrim {
            start_seconds: 20,
            end_seconds: 20,
        }),
        destination: ClipDestination::Library,
    };
    assert!(rig.core.capture_replay(bad).await.is_err());
    assert_eq!(rig.backend.w4.count("capture"), 0);
    rig.backend.w4.answer(
        "capture",
        json!({
            "clipId": "c1", "fileId": "f", "durationSeconds": 40, "requestedDurationSeconds": 300,
            "sizeBytes": 10, "downloadUrl": "/api/file/f", "messageId": "m1",
        }),
    );
    let clip = rig
        .core
        .capture_replay(CaptureRequest {
            minutes: ReplayMinutes::Five,
            trim: Some(ReplayTrim {
                start_seconds: 10,
                end_seconds: 50,
            }),
            destination: ClipDestination::Channel {
                channel_id: VOICE.into(),
            },
        })
        .await
        .unwrap();
    assert_eq!(clip.message_id.as_deref(), Some("m1"));
    let call = rig
        .backend
        .w4
        .calls()
        .into_iter()
        .find(|c| c.starts_with("capture"))
        .unwrap();
    let body: Value = serde_json::from_str(call.trim_start_matches("capture ")).unwrap();
    assert_eq!(body["durationMinutes"], json!(5));
    assert_eq!(body["destination"], json!("channel"));
    assert_eq!(body["targetChannelId"], json!(VOICE));
    assert_eq!(body["startSeconds"], json!(10));
    assert_eq!(body["endSeconds"], json!(50));
}

#[tokio::test]
async fn the_clip_library_updates_deletes_and_shares() {
    let mut rig = signed_in().await;
    rig.backend.w4.answer(
        "clips",
        json!([clip_json("c1", false), clip_json("c2", false)]),
    );
    assert_eq!(rig.core.clips().state, LoadState::Loading);
    rig.settle().await;
    assert_eq!(rig.core.clips().clips.len(), 2);
    rig.backend.w4.answer("update_clip", clip_json("c1", true));
    rig.core.set_clip_public("c1".into(), true).await.unwrap();
    assert!(rig.core.clips().clips[0].is_public);
    rig.backend
        .w4
        .answer("delete_clip", json!({ "success": true }));
    rig.core.delete_clip("c2".into()).await.unwrap();
    assert_eq!(rig.core.clips().clips.len(), 1);
    assert!(
        rig.core
            .share_clip("c1".into(), ClipDestination::Library)
            .await
            .is_err()
    );
    rig.backend.w4.answer(
        "share_clip",
        json!({ "messageId": "m", "clipId": "c1", "destination": "dm" }),
    );
    rig.core
        .share_clip(
            "c1".into(),
            ClipDestination::Dm {
                dm_group_id: VOICE.into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(rig.backend.w4.count("share_clip"), 1);
}

#[tokio::test]
async fn a_failed_clip_change_says_why() {
    let mut rig = signed_in().await;
    rig.backend
        .w4
        .answer("clips", json!([clip_json("c1", false)]));
    rig.core.clips();
    rig.settle().await;
    rig.backend
        .w4
        .fail_next("delete_clip", refusal(500, "INTERNAL"));
    assert!(rig.core.delete_clip("c1".into()).await.is_err());
    let clips = rig.core.clips();
    assert_eq!(clips.clips.len(), 1);
    assert!(clips.error.is_some());
    assert!(clips.busy.is_empty());
}

#[tokio::test]
async fn someone_elses_public_clips() {
    let mut rig = signed_in().await;
    rig.backend
        .w4
        .answer("user_clips", json!([clip_json("c9", true)]));
    rig.core.user_clips("bob".into());
    rig.settle().await;
    assert_eq!(rig.core.user_clips("bob".into()).clips[0].id, "c9");
    assert_eq!(rig.backend.w4.calls(), vec!["user_clips bob"]);
}

// --- Diagnostics, keep-awake, sound cues ---

#[tokio::test]
async fn diagnostics_read_the_engine() {
    let mut rig = in_channel_call(&[ME]).await;
    *rig.media.diagnostics.lock().unwrap() = Some(semaphore_core::model::MediaDiagnostics {
        candidate_types: vec!["relay".into()],
        rtt_ms: Some(40),
        ..Default::default()
    });
    rig.core.refresh_voice_diagnostics().await;
    rig.settle().await;
    let view = rig.core.voice_diagnostics();
    assert_eq!(view.status, VoiceStatus::Connected);
    assert_eq!(view.server_host.as_deref(), Some("livekit"));
    assert_eq!(view.media.unwrap().rtt_ms, Some(40));
    assert!(!view.events.is_empty());
}

#[tokio::test]
async fn the_system_stays_awake_for_the_call_only() {
    let mut rig = signed_in().await;
    let awake = Arc::new(FakeKeepAwake::default());
    rig.core.set_keep_awake(awake.clone());
    rig.core.join_voice(VOICE.into()).await.unwrap();
    rig.settle().await;
    rig.core.set_muted(true).await.unwrap();
    rig.settle().await;
    rig.core.leave_voice().await.unwrap();
    rig.settle().await;
    rig.core.join_dm_call(DM.into()).await.unwrap();
    rig.settle().await;
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    assert_eq!(*awake.0.lock().unwrap(), vec![true, false, true, false]);
}

#[tokio::test]
async fn sounds_for_joining_leaving_and_others_coming_and_going() {
    let mut rig = signed_in().await;
    *rig.backend.voice_users.lock().unwrap() = vec![presence(ME), presence("bob")];
    rig.core.join_voice(VOICE.into()).await.unwrap();
    let events = rig.settle().await;
    assert_eq!(
        cues(&events),
        vec![SoundCue::Connected],
        "bob was there first"
    );
    rig.core.ingest(event(
        "voiceChannelUserJoined",
        json!({ "channelId": VOICE, "user": presence("cat") }),
    ));
    assert_eq!(cues(&rig.settle().await), vec![SoundCue::UserJoined]);
    rig.core.ingest(event(
        "voiceChannelUserLeft",
        json!({ "channelId": VOICE, "userId": "bob", "user": presence("bob") }),
    ));
    assert_eq!(cues(&rig.settle().await), vec![SoundCue::UserLeft]);
    rig.core.leave_voice().await.unwrap();
    assert_eq!(cues(&rig.settle().await), vec![SoundCue::Disconnected]);
}

#[tokio::test]
async fn the_last_other_leaving_a_dm_call_ends_it_with_a_sound() {
    let mut rig = in_dm_call(&[ME, "bob"]).await;
    rig.core.ingest(dm_left(DM, "bob"));
    let events = rig.settle().await;
    assert_eq!(cues(&events), vec![SoundCue::CallEnded]);
    // Not left for them (no auto-leave when alone).
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
}
