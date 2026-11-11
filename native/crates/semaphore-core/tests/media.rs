//! Voice as a UI sees it: core between presence and the media engine.

mod common;

use common::*;
use semaphore_core::model::{
    ConnectionQuality, LocalMediaView, LocalShare, ParticipantView, UserView, VideoDemand,
    VideoTrackView, VoiceStatus, VoiceView,
};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;

const ROOM: &str = "room";
/// The first `join_voice` in a test is call 1.
const CALL: u64 = 1;

fn presence(id: &str) -> Value {
    json!({
        "id": id, "username": id, "displayName": format!("{id} name"), "avatarUrl": format!("{id}-file"),
        "joinedAt": "2026-09-22T18:00:00.000Z", "isDeafened": false, "isServerMuted": false,
    })
}

fn track(sid: &str) -> VideoTrackView {
    VideoTrackView {
        track_sid: sid.into(),
        width: 1280,
        height: 720,
    }
}

fn seen(id: &str) -> ParticipantView {
    ParticipantView {
        identity: id.into(),
        user: UserView {
            id: id.into(),
            username: id.into(),
            ..UserView::default()
        },
        ..ParticipantView::default()
    }
}

fn report(status: VoiceStatus, participants: Vec<ParticipantView>) -> VoiceView {
    VoiceView {
        status,
        channel_id: Some(ROOM.into()),
        participants,
        ..VoiceView::default()
    }
}

async fn in_call(users: &[&str]) -> Rig {
    let mut rig = Rig::with_media().signed_in().await;
    *rig.backend.voice_users.lock().unwrap() = users.iter().map(|id| presence(id)).collect();
    rig.core.join_voice(ROOM.into()).await.unwrap();
    rig.settle().await;
    rig
}

fn voice_calls(rig: &Rig) -> Vec<String> {
    rig.backend.voice_calls.lock().unwrap().clone()
}

fn media_calls(rig: &Rig) -> Vec<String> {
    rig.media.calls.lock().unwrap().clone()
}

#[tokio::test]
async fn joining_connects_with_a_token_and_announces_presence() {
    let rig = in_call(&["me"]).await;
    assert!(media_calls(&rig).contains(&"connect ws://livekit token-1".to_owned()));
    assert_eq!(voice_calls(&rig), ["join"]);
    let voice = rig.core.voice();
    assert_eq!(voice.status, VoiceStatus::Connected);
    assert_eq!(voice.channel_id.as_deref(), Some(ROOM));
}

#[tokio::test]
async fn a_failed_join_leaves_nothing_behind() {
    let rig = Rig::with_media().signed_in().await;
    *rig.media.connect_fails.lock().unwrap() = true;
    assert!(rig.core.join_voice(ROOM.into()).await.is_err());
    assert_eq!(rig.core.voice(), VoiceView::default());
    assert!(voice_calls(&rig).is_empty());
}

#[tokio::test]
async fn mute_and_deafen_reach_the_engine_and_show_at_once() {
    let rig = in_call(&["me"]).await;
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me")]));
    rig.media.calls.lock().unwrap().clear();

    rig.core.set_muted(true).await.unwrap();
    assert_eq!(media_calls(&rig), ["muted true"]);
    assert!(rig.core.voice().muted);

    rig.core.set_deafened(true).await.unwrap();
    assert_eq!(media_calls(&rig), ["muted true", "deafened true"]);
    assert!(rig.core.voice().deafened);
    assert_eq!(voice_calls(&rig), ["join", "deafen"]);
}

#[tokio::test]
async fn a_call_starts_with_what_was_asked_before_it() {
    let mut rig = Rig::with_media().signed_in().await;
    rig.core.set_muted(true).await.unwrap();
    rig.media.calls.lock().unwrap().clear();
    rig.core.join_voice(ROOM.into()).await.unwrap();
    rig.settle().await;
    assert_eq!(
        media_calls(&rig),
        [
            "deafened false",
            "muted true",
            "connect ws://livekit token-1"
        ]
    );
    assert!(rig.core.voice().muted);
}

#[tokio::test]
async fn demands_go_to_the_engine_unchanged() {
    let rig = in_call(&["me"]).await;
    let demand = VideoDemand {
        track_sid: "t1".into(),
        width_px: 320,
        height_px: 180,
        focused: false,
    };
    rig.core.set_video_demands(vec![demand.clone()]);
    assert_eq!(*rig.media.demands.lock().unwrap(), [demand]);
}

#[tokio::test]
async fn names_come_from_presence_and_tracks_from_the_engine() {
    let rig = in_call(&["me", "ava"]).await;
    let mut ava = seen("ava");
    ava.speaking = true;
    ava.camera = Some(track("cam"));
    ava.screen_share = Some(track("screen"));
    ava.quality = ConnectionQuality::Poor;
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me"), ava]));

    let voice = rig.core.voice();
    let row = voice
        .participants
        .iter()
        .find(|p| p.identity == "ava")
        .unwrap();
    assert_eq!(row.user.display_name.as_deref(), Some("ava name"));
    assert_eq!(row.user.avatar_file_id.as_deref(), Some("ava-file"));
    assert!(row.speaking);
    assert_eq!(row.camera, Some(track("cam")));
    assert_eq!(row.screen_share, Some(track("screen")));
    assert_eq!(row.quality, ConnectionQuality::Poor);
    let me = voice
        .participants
        .iter()
        .find(|p| p.identity == "me")
        .unwrap();
    assert!(me.is_self);
}

#[tokio::test]
async fn either_side_can_say_someone_is_muted_or_deafened() {
    let rig = Rig::with_media().signed_in().await;
    let mut server_muted = presence("a");
    server_muted["isServerMuted"] = json!(true);
    let mut deafened = presence("b");
    deafened["isDeafened"] = json!(true);
    *rig.backend.voice_users.lock().unwrap() = vec![server_muted, deafened, presence("c")];
    rig.core.join_voice(ROOM.into()).await.unwrap();
    rig.core.run_until_idle().await;
    let mut c = seen("c");
    c.muted = true;
    c.deafened = true;
    rig.core.ingest_media(
        CALL,
        report(VoiceStatus::Connected, vec![seen("a"), seen("b"), c]),
    );

    let voice = rig.core.voice();
    let flags: Vec<(bool, bool)> = voice
        .participants
        .iter()
        .map(|p| (p.muted, p.deafened))
        .collect();
    assert_eq!(flags, [(true, false), (false, true), (true, true)]);
}

#[tokio::test]
async fn someone_only_the_engine_sees_is_still_listed_and_someone_only_presence_sees_has_no_tracks()
{
    let rig = in_call(&["me", "ava"]).await;
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("bea")]));
    let voice = rig.core.voice();
    let ids: Vec<&str> = voice
        .participants
        .iter()
        .map(|p| p.identity.as_str())
        .collect();
    assert_eq!(ids, ["me", "ava", "bea"]);
    assert_eq!(voice.participants[1].camera, None);
    assert!(!voice.participants[1].speaking);
}

#[tokio::test]
async fn a_rejoin_shows_its_attempt_and_comes_back() {
    let rig = in_call(&["me"]).await;
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me")]));
    rig.core.ingest_media(
        CALL,
        VoiceView {
            reconnect_attempt: Some(3),
            error: Some("no route".into()),
            ..report(VoiceStatus::Reconnecting, Vec::new())
        },
    );
    let voice = rig.core.voice();
    assert_eq!(voice.status, VoiceStatus::Reconnecting);
    assert_eq!(voice.reconnect_attempt, Some(3));
    assert_eq!(voice.error.as_deref(), Some("no route"));

    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me")]));
    let voice = rig.core.voice();
    assert_eq!(voice.status, VoiceStatus::Connected);
    assert_eq!(voice.reconnect_attempt, None);
    assert_eq!(voice.error, None);
}

#[tokio::test]
async fn the_engine_ending_a_call_ends_it_here_and_on_the_server() {
    let mut rig = in_call(&["me"]).await;
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me")]));
    rig.core.ingest_media(
        CALL,
        VoiceView {
            status: VoiceStatus::Disconnected,
            error: Some("removed from the room".into()),
            ..VoiceView::default()
        },
    );
    rig.settle().await;
    let voice = rig.core.voice();
    assert_eq!(voice.status, VoiceStatus::Disconnected);
    assert_eq!(voice.channel_id, None);
    assert_eq!(voice.error.as_deref(), Some("removed from the room"));
    assert_eq!(voice_calls(&rig), ["join", "leave"]);
}

#[tokio::test]
async fn a_report_from_another_call_does_not_end_this_one() {
    let rig = in_call(&["me"]).await;
    // Call 0: the engine's state before any join, or an earlier call's last word.
    rig.core.ingest_media(0, VoiceView::default());
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
    assert_eq!(voice_calls(&rig), ["join"]);
}

#[tokio::test]
async fn a_report_after_leaving_changes_nothing() {
    let rig = in_call(&["me"]).await;
    rig.core.leave_voice().await.unwrap();
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me")]));
    assert_eq!(rig.core.voice(), VoiceView::default());
    assert_eq!(voice_calls(&rig), ["join", "leave"]);
    assert!(media_calls(&rig).contains(&"disconnect".to_owned()));
}

#[tokio::test]
async fn signing_out_ends_the_call() {
    let rig = in_call(&["me"]).await;
    rig.core.sign_out().await.unwrap();
    assert!(media_calls(&rig).contains(&"disconnect".to_owned()));
    assert_eq!(voice_calls(&rig), ["join", "leave"]);
}

#[tokio::test]
async fn the_heartbeat_only_runs_while_connected() {
    let rig = Rig::with_media().signed_in().await;
    rig.core.refresh_voice_presence().await;
    assert!(voice_calls(&rig).is_empty());

    *rig.backend.voice_users.lock().unwrap() = vec![presence("me")];
    rig.core.join_voice(ROOM.into()).await.unwrap();
    rig.core.refresh_voice_presence().await;
    assert_eq!(voice_calls(&rig), ["join", "refresh"]);

    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me")]));
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Reconnecting, Vec::new()));
    rig.core.refresh_voice_presence().await;
    assert_eq!(voice_calls(&rig), ["join", "refresh"]);

    rig.core
        .ingest_media(CALL, report(VoiceStatus::Connected, vec![seen("me")]));
    rig.core.refresh_voice_presence().await;
    assert_eq!(voice_calls(&rig), ["join", "refresh", "refresh"]);

    rig.core.leave_voice().await.unwrap();
    rig.core.refresh_voice_presence().await;
    assert_eq!(voice_calls(&rig), ["join", "refresh", "refresh", "leave"]);
}

#[tokio::test]
async fn a_voice_token_is_new_each_time_and_only_in_a_call() {
    let rig = Rig::with_media().signed_in().await;
    assert!(rig.core.voice_token().await.is_err());
    rig.core.join_voice(ROOM.into()).await.unwrap();
    assert_eq!(rig.backend.tokens_minted.load(Ordering::SeqCst), 1);
    assert_eq!(rig.core.voice_token().await.unwrap(), "token-2");
    assert_eq!(rig.core.voice_token().await.unwrap(), "token-3");
}

#[tokio::test]
async fn a_call_that_drops_between_two_reports_still_ends() {
    // The engine's reports coalesce: Connected then Disconnected can arrive as Disconnected alone.
    let mut rig = in_call(&["me"]).await;
    assert_eq!(*rig.media.last_call.lock().unwrap(), CALL);
    rig.core.ingest_media(
        CALL,
        VoiceView {
            status: VoiceStatus::Disconnected,
            error: Some("gone".into()),
            ..VoiceView::default()
        },
    );
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
    assert_eq!(rig.core.voice().error.as_deref(), Some("gone"));
    assert_eq!(voice_calls(&rig), ["join", "leave"]);
}

#[tokio::test]
async fn a_call_that_ends_while_joining_fails_the_join_and_leaves() {
    let mut rig = Rig::with_media().signed_in().await;
    *rig.backend.voice_users.lock().unwrap() = vec![presence("me")];
    *rig.media.report_during_connect.lock().unwrap() = Some(VoiceView {
        status: VoiceStatus::Disconnected,
        error: Some("kicked".into()),
        ..VoiceView::default()
    });
    let joined = rig.core.join_voice(ROOM.into()).await;
    assert!(joined.is_err(), "{joined:?}");
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
    assert_eq!(rig.core.voice().channel_id, None);
    assert_eq!(voice_calls(&rig), ["join", "leave"]);
}

#[tokio::test]
async fn each_join_is_a_new_call_and_the_last_ones_reports_are_ignored() {
    let rig = in_call(&["me"]).await;
    rig.core.leave_voice().await.unwrap();
    rig.core.join_voice(ROOM.into()).await.unwrap();
    assert_eq!(*rig.media.last_call.lock().unwrap(), CALL + 1);
    // The first call's engine says goodbye after the second began.
    rig.core.ingest_media(CALL, VoiceView::default());
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
    rig.core
        .ingest_media(CALL + 1, report(VoiceStatus::Connected, vec![seen("me")]));
    assert_eq!(rig.core.voice().status, VoiceStatus::Connected);
}

#[tokio::test]
async fn a_lost_session_ends_the_call_in_the_engine() {
    let mut rig = in_call(&["me"]).await;
    rig.core
        .ingest(semaphore_core::realtime::RealtimeEvent::AuthLost { reason: None });
    rig.settle().await;
    assert!(media_calls(&rig).contains(&"disconnect".to_owned()));
    assert_eq!(rig.core.voice(), VoiceView::default());
}

#[tokio::test]
async fn leaving_while_the_room_is_still_connecting_ends_what_the_join_started() {
    let mut rig = Rig::with_media().signed_in().await;
    *rig.backend.voice_users.lock().unwrap() = vec![presence("me")];
    *rig.media.leave_during_connect.lock().unwrap() = true;
    let joined = rig.core.join_voice(ROOM.into()).await;
    assert!(joined.is_err(), "{joined:?}");
    rig.settle().await;
    assert_eq!(rig.core.voice().status, VoiceStatus::Disconnected);
    assert_eq!(rig.core.voice().channel_id, None);
    // The join finished after the leave: the engine and the server both hear it's over.
    assert_eq!(
        media_calls(&rig).last().map(String::as_str),
        Some("disconnect")
    );
    assert_eq!(voice_calls(&rig), ["leave", "join", "leave"]);
}

// Camera and screen share.

fn share(audio: bool) -> semaphore_core::model::ScreenShareRequest {
    semaphore_core::model::ScreenShareRequest {
        audio,
        ..Default::default()
    }
}

fn local(rig: &Rig) -> LocalMediaView {
    rig.core.voice().local
}

fn failed(message: &str) -> LocalShare {
    LocalShare::Failed {
        message: message.into(),
    }
}

/// An engine report saying what it sends and what the room allows.
fn sending(camera: bool, screen: bool) -> VoiceView {
    let on = |yes: bool| if yes { LocalShare::On } else { LocalShare::Off };
    VoiceView {
        local: LocalMediaView {
            camera: on(camera),
            screen: on(screen),
            may_camera: true,
            may_share: true,
            ..LocalMediaView::default()
        },
        ..report(VoiceStatus::Connected, vec![seen("me")])
    }
}

#[tokio::test]
async fn the_camera_starts_and_stops_through_the_engine() {
    let rig = in_call(&["me"]).await;
    rig.media.calls.lock().unwrap().clear();
    rig.core.set_camera(true).await.unwrap();
    assert_eq!(local(&rig).camera, LocalShare::On);
    rig.core.set_camera(false).await.unwrap();
    assert_eq!(local(&rig).camera, LocalShare::Off);
    assert_eq!(media_calls(&rig), ["camera true", "camera false"]);
}

#[tokio::test]
async fn a_screen_share_starts_with_its_audio_and_stops_with_it() {
    let rig = in_call(&["me"]).await;
    rig.media.calls.lock().unwrap().clear();
    rig.core.start_screen_share(share(true)).await.unwrap();
    let shown = local(&rig);
    assert_eq!(
        (shown.screen, shown.screen_audio),
        (LocalShare::On, LocalShare::On)
    );
    rig.core.stop_screen_share().await.unwrap();
    let shown = local(&rig);
    assert_eq!(
        (shown.screen, shown.screen_audio),
        (LocalShare::Off, LocalShare::Off)
    );
    assert_eq!(
        media_calls(&rig),
        ["screen picker P1080 60 audio true", "screen stop"]
    );
}

#[tokio::test]
async fn a_share_without_audio_leaves_the_audio_off() {
    let rig = in_call(&["me"]).await;
    rig.core.start_screen_share(share(false)).await.unwrap();
    assert_eq!(local(&rig).screen_audio, LocalShare::Off);
}

#[tokio::test]
async fn audio_that_fails_leaves_the_screen_shared() {
    let rig = in_call(&["me"]).await;
    *rig.media.screen_audio_fails.lock().unwrap() = Some("PipeWire isn't running".into());
    rig.core.start_screen_share(share(true)).await.unwrap();
    let shown = local(&rig);
    assert_eq!(shown.screen, LocalShare::On);
    assert_eq!(shown.screen_audio, failed("PipeWire isn't running"));
}

#[tokio::test]
async fn a_failed_camera_shows_why_and_can_be_retried() {
    let rig = in_call(&["me"]).await;
    *rig.media.camera_fails.lock().unwrap() = Some("the camera is busy".into());
    assert!(rig.core.set_camera(true).await.is_err());
    assert_eq!(local(&rig).camera, failed("the camera is busy"));
    rig.core.set_camera(true).await.unwrap();
    assert_eq!(local(&rig).camera, LocalShare::On);
}

#[tokio::test]
async fn a_cancelled_picker_shows_why_and_can_be_retried() {
    let rig = in_call(&["me"]).await;
    *rig.media.screen_fails.lock().unwrap() = Some("the picker was cancelled".into());
    assert!(rig.core.start_screen_share(share(true)).await.is_err());
    let shown = local(&rig);
    assert_eq!(shown.screen, failed("the picker was cancelled"));
    assert_eq!(shown.screen_audio, LocalShare::Off);
    rig.core.start_screen_share(share(true)).await.unwrap();
    assert_eq!(local(&rig).screen, LocalShare::On);
}

#[tokio::test]
async fn neither_starts_outside_a_call() {
    let rig = Rig::with_media().signed_in().await;
    assert!(rig.core.set_camera(true).await.is_err());
    assert!(rig.core.start_screen_share(share(true)).await.is_err());
    assert_eq!(local(&rig), LocalMediaView::default());
    assert!(
        !media_calls(&rig)
            .iter()
            .any(|call| call.starts_with("camera") || call.starts_with("screen"))
    );
}

#[tokio::test]
async fn leaving_ends_both() {
    let mut rig = in_call(&["me"]).await;
    rig.core.set_camera(true).await.unwrap();
    rig.core.start_screen_share(share(true)).await.unwrap();
    rig.core.leave_voice().await.unwrap();
    rig.settle().await;
    assert_eq!(local(&rig), LocalMediaView::default());
    // The engine stops both when it leaves the room.
    assert_eq!(
        media_calls(&rig).last().map(String::as_str),
        Some("disconnect")
    );
}

#[tokio::test]
async fn signing_out_ends_both() {
    let mut rig = in_call(&["me"]).await;
    rig.core.set_camera(true).await.unwrap();
    rig.core.start_screen_share(share(true)).await.unwrap();
    rig.core.sign_out().await.unwrap();
    rig.settle().await;
    assert_eq!(local(&rig), LocalMediaView::default());
    assert!(media_calls(&rig).contains(&"disconnect".to_owned()));
}

#[tokio::test]
async fn the_next_call_starts_with_nothing_shared() {
    let mut rig = in_call(&["me"]).await;
    rig.core.set_camera(true).await.unwrap();
    // The engine drops the call on its own.
    rig.core.ingest_media(CALL, sending(true, false));
    rig.core
        .ingest_media(CALL, report(VoiceStatus::Disconnected, Vec::new()));
    rig.settle().await;
    assert_eq!(local(&rig), LocalMediaView::default());
    rig.core.join_voice(ROOM.into()).await.unwrap();
    rig.settle().await;
    assert_eq!(local(&rig).camera, LocalShare::Off);
}

#[tokio::test]
async fn a_share_that_ends_on_its_own_turns_off() {
    let rig = in_call(&["me"]).await;
    rig.core.start_screen_share(share(true)).await.unwrap();
    rig.core.ingest_media(CALL, sending(false, true));
    assert_eq!(local(&rig).screen, LocalShare::On);
    // The shared window closed.
    rig.core.ingest_media(CALL, sending(false, false));
    let shown = local(&rig);
    assert_eq!(
        (shown.screen, shown.screen_audio),
        (LocalShare::Off, LocalShare::Off)
    );
}

#[tokio::test]
async fn a_report_from_before_a_start_finished_does_not_undo_it() {
    let rig = in_call(&["me"]).await;
    rig.core.ingest_media(CALL, sending(false, false));
    rig.core.set_camera(true).await.unwrap();
    // Sent before the camera was published; it only ever said Off.
    rig.core.ingest_media(
        CALL,
        VoiceView {
            muted: true,
            ..sending(false, false)
        },
    );
    assert_eq!(local(&rig).camera, LocalShare::On);
}

#[tokio::test]
async fn what_the_room_allows_comes_from_the_engine() {
    let rig = in_call(&["me"]).await;
    assert!(!local(&rig).may_camera && !local(&rig).may_share);
    rig.core.ingest_media(CALL, sending(false, false));
    assert!(local(&rig).may_camera && local(&rig).may_share);
}

#[tokio::test]
async fn a_share_that_finishes_starting_after_leaving_changes_nothing() {
    let rig = in_call(&["me"]).await;
    let (release, hold) = tokio::sync::oneshot::channel();
    *rig.media.hold_screen.lock().unwrap() = Some(hold);
    let core = rig.core.clone();
    let start = tokio::spawn(async move { core.start_screen_share(share(true)).await });
    // The picker is open.
    while local(&rig).screen != LocalShare::Starting {
        tokio::task::yield_now().await;
    }
    rig.core.leave_voice().await.unwrap();
    release.send(()).unwrap();
    assert!(start.await.unwrap().is_err());
    assert_eq!(local(&rig), LocalMediaView::default());
}
