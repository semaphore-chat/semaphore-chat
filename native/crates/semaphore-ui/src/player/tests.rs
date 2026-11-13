//! The pure half (state mapping, scrubber maths, time, keys, sizes), the session (opening,
//! commands, stale events), then both views in a window driven by the fake.

use super::fake::{Call, FakeOpener, Script};
use super::model::*;
use super::session::Playback;
use super::{AudioPlayer, PlayerViewEvent, VideoPlayer};
use crate::dms::rig::{Rig, rig};
use crate::voice::VideoFrames;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::player::{AttachmentSource, PlaybackState, PlayerError, PlayerEvent};
use std::time::Duration;

fn secs(s: u64) -> Duration {
    Duration::from_secs(s)
}

fn source(kind: &str) -> AttachmentSource {
    AttachmentSource {
        file_id: format!("f-{kind}"),
        filename: format!("clip.{kind}"),
        mime_type: format!("{kind}/x"),
        size: 2048,
        has_thumbnail: false,
    }
}

// ---- Time, maths, keys, sizes. ----

#[test]
fn times_read_m_ss_under_an_hour_and_h_mm_ss_from_one() {
    assert_eq!(format_time(Duration::ZERO), "0:00");
    assert_eq!(format_time(Duration::from_millis(5_999)), "0:05");
    assert_eq!(format_time(secs(65)), "1:05");
    assert_eq!(format_time(secs(59 * 60 + 59)), "59:59");
    assert_eq!(format_time(secs(3600)), "1:00:00");
    assert_eq!(format_time(secs(3723)), "1:02:03");
    assert_eq!(format_time(secs(36_000 + 61)), "10:01:01");
}

#[test]
fn the_time_label_pairs_position_and_duration_in_one_form() {
    assert_eq!(time_label(secs(42), Some(secs(125))), "0:42 / 2:05");
    assert_eq!(
        time_label(secs(605), Some(secs(4210))),
        "0:10:05 / 1:10:10",
        "both long once the file is"
    );
    assert_eq!(
        time_label(secs(200), Some(secs(125))),
        "2:05 / 2:05",
        "clamped"
    );
    assert_eq!(time_label(secs(3), None), "0:03", "no duration yet");
}

#[test]
fn scrubber_positions_map_to_times_and_clamp() {
    assert_eq!(fraction_at(150., 100., 200.), 0.25);
    assert_eq!(fraction_at(50., 100., 200.), 0.0, "left of the track");
    assert_eq!(fraction_at(400., 100., 200.), 1.0, "right of it");
    assert_eq!(fraction_at(150., 100., 0.), 0.0, "no width yet");
    assert_eq!(time_at(0.25, secs(120)), secs(30));
    assert_eq!(time_at(1.5, secs(120)), secs(120));
    assert_eq!(time_at(-1., secs(120)), Duration::ZERO);
    // The hover time is the same mapping: the pointer at 3/4 of a 2:05 track.
    let hover = time_at(fraction_at(250., 100., 200.), secs(125));
    assert_eq!(format_time(hover), "1:33");
    assert_eq!(played_fraction(secs(30), Some(secs(120))), 0.25);
    assert_eq!(played_fraction(secs(300), Some(secs(120))), 1.0);
    assert_eq!(played_fraction(secs(30), None), 0.0);
    assert_eq!(played_fraction(secs(30), Some(Duration::ZERO)), 0.0);
}

#[test]
fn seeking_by_keys_stays_inside_the_file() {
    assert_eq!(seek_by(secs(10), true, SEEK_STEP, Some(secs(60))), secs(15));
    assert_eq!(seek_by(secs(58), true, SEEK_STEP, Some(secs(60))), secs(60));
    assert_eq!(
        seek_by(secs(3), false, SEEK_STEP, Some(secs(60))),
        Duration::ZERO
    );
    assert_eq!(seek_by(secs(3), true, SEEK_STEP, None), secs(8));
    assert_eq!(step_volume(1.0, true), 1.0);
    assert_eq!(step_volume(1.0, false), 0.9);
    let mut volume = 1.0;
    for _ in 0..10 {
        volume = step_volume(volume, false);
    }
    assert_eq!(volume, 0.0, "ten steps down reach silence exactly");
    assert_eq!(step_volume(0.0, false), 0.0);
}

#[test]
fn keys_map_to_commands_and_only_video_expands() {
    assert_eq!(key_command("space", true), Some(KeyCommand::Toggle));
    assert_eq!(
        key_command("left", false),
        Some(KeyCommand::Seek { forward: false })
    );
    assert_eq!(
        key_command("right", true),
        Some(KeyCommand::Seek { forward: true })
    );
    assert_eq!(
        key_command("up", true),
        Some(KeyCommand::Volume { up: true })
    );
    assert_eq!(
        key_command("down", false),
        Some(KeyCommand::Volume { up: false })
    );
    assert_eq!(key_command("m", false), Some(KeyCommand::Mute));
    assert_eq!(key_command("f", true), Some(KeyCommand::Expand));
    assert_eq!(key_command("escape", true), Some(KeyCommand::Collapse));
    assert_eq!(key_command("f", false), None);
    assert_eq!(key_command("escape", false), None);
    assert_eq!(key_command("a", true), None);
}

#[test]
fn every_state_maps_to_what_the_video_player_shows() {
    use Center::*;
    let shown = |phase: Phase, frame: bool, awake: bool| video_shown(&phase, frame, awake);
    assert_eq!(
        shown(Phase::Idle, false, true),
        Shown {
            picture: Picture::Poster,
            center: BigPlay,
            controls: false
        }
    );
    assert_eq!(shown(Phase::Loading, false, true).center, Spinner);
    assert_eq!(shown(Phase::Loading, false, true).picture, Picture::Poster);
    assert_eq!(
        shown(Phase::Loading, true, true).picture,
        Picture::Surface,
        "the first decoded frame replaces the poster"
    );
    assert_eq!(
        shown(Phase::Playing, true, true),
        Shown {
            picture: Picture::Surface,
            center: Nothing,
            controls: true
        }
    );
    assert!(
        !shown(Phase::Playing, true, false).controls,
        "asleep hides them"
    );
    assert!(
        shown(Phase::Paused, true, false).controls,
        "paused never hides"
    );
    assert_eq!(shown(Phase::Buffering, true, false).center, Spinner);
    assert!(shown(Phase::Buffering, true, false).controls);
    assert_eq!(shown(Phase::Ended, true, false).center, Replay);
    let unsupported = shown(Phase::Failed(PlayerError::Unsupported), true, true);
    assert_eq!(unsupported.center, Failed(Failure::Unsupported));
    assert_eq!(unsupported.picture, Picture::Poster);
    assert!(!unsupported.controls);
    assert_eq!(
        shown(Phase::Failed(PlayerError::Corrupt), false, true).center,
        Failed(Failure::Unsupported)
    );
    assert_eq!(
        shown(Phase::Failed(PlayerError::Network), false, true).center,
        Failed(Failure::Retryable)
    );
    assert_eq!(
        shown(Phase::Failed(PlayerError::AudioDevice), false, true).center,
        Failed(Failure::Retryable)
    );
}

#[test]
fn every_state_maps_to_the_audio_rows_button() {
    assert_eq!(audio_shown(&Phase::Idle), (MainButton::Play, None));
    assert_eq!(audio_shown(&Phase::Loading), (MainButton::Spinner, None));
    assert_eq!(audio_shown(&Phase::Playing), (MainButton::Pause, None));
    assert_eq!(audio_shown(&Phase::Buffering), (MainButton::Pause, None));
    assert_eq!(audio_shown(&Phase::Paused), (MainButton::Play, None));
    assert_eq!(audio_shown(&Phase::Ended), (MainButton::Replay, None));
    assert_eq!(
        audio_shown(&Phase::Failed(PlayerError::Unsupported)).1,
        Some(Failure::Unsupported)
    );
    assert_eq!(
        audio_shown(&Phase::Failed(PlayerError::Network)).1,
        Some(Failure::Retryable)
    );
}

#[test]
fn a_video_box_keeps_the_frame_inside_the_webs_limits() {
    assert_eq!(video_box(Some(1920), Some(1080)), (480., 270.));
    assert_eq!(
        video_box(Some(720), Some(1280)),
        (280., 400.),
        "tall: bars at the sides"
    );
    assert_eq!(
        video_box(Some(64), Some(64)),
        (400., 400.),
        "small: scaled up"
    );
    assert_eq!(video_box(Some(4000), Some(1000)), (480., 120.));
    assert_eq!(video_box(None, Some(1080)), VIDEO_DEFAULT);
    assert_eq!(video_box(Some(0), Some(0)), VIDEO_DEFAULT);
}

#[test]
fn surface_keys() {
    assert_eq!(surface_key("abc"), "player:abc");
}

// ---- The session. ----

fn playback(script: Script) -> (Playback, FakeOpener) {
    let (opener, fake) = FakeOpener::rc(script);
    (Playback::new(source("video").into(), opener, None), fake)
}

#[test]
fn nothing_opens_until_play_and_events_update_the_state() {
    let (mut playback, fake) = playback(Script::video().at(secs(7), PlaybackState::Playing));
    assert_eq!(fake.calls(), []);
    playback.toggle();
    assert_eq!(fake.calls(), [Call::Open("f-video".into()), Call::Play]);
    assert_eq!(playback.phase, Phase::Loading, "until the events are taken");
    assert!(playback.drain());
    assert_eq!(playback.phase, Phase::Playing);
    assert_eq!(playback.position, secs(7));
    assert_eq!(playback.duration, Some(secs(125)));
    assert_eq!(playback.buffered, [0.0..0.35]);
    assert_eq!(playback.natural, Some((1280, 720)));
    fake.handle()
        .emit(PlayerEvent::Buffered(vec![0.0..0.5, 0.75..1.0]));
    fake.handle().emit(PlayerEvent::State(PlaybackState::Ended));
    playback.drain();
    assert_eq!(playback.buffered, [0.0..0.5, 0.75..1.0]);
    assert_eq!(playback.phase, Phase::Ended);
    assert_eq!(playback.position, secs(125), "the end is the duration");
    assert!(!playback.drain(), "nothing new");
}

#[test]
fn a_retry_ignores_the_failed_players_late_events() {
    let (mut playback, fake) = playback(Script::failing(PlayerError::Network));
    playback.toggle();
    playback.drain();
    assert_eq!(playback.phase, Phase::Failed(PlayerError::Network));
    let stale = fake.handle();
    fake.set_script(Script::video());
    playback.retry();
    playback.drain();
    assert_eq!(playback.phase, Phase::Playing);
    stale.emit(PlayerEvent::Position(secs(99)));
    stale.emit(PlayerEvent::State(PlaybackState::Failed(
        PlayerError::Network,
    )));
    assert!(!playback.drain());
    assert_eq!(playback.phase, Phase::Playing);
    assert_eq!(playback.position, Duration::ZERO);
}

#[test]
fn volume_and_mute_reach_the_player_and_survive_a_reopen() {
    let (mut playback, fake) = playback(Script::video());
    playback.set_volume(0.4);
    playback.toggle_mute();
    assert_eq!(fake.calls(), [], "no player yet: kept for the open");
    playback.toggle();
    assert_eq!(
        fake.calls(),
        [
            Call::Open("f-video".into()),
            Call::Volume(0.4),
            Call::Muted(true),
            Call::Play
        ]
    );
    fake.clear();
    playback.set_volume(0.6);
    assert_eq!(
        fake.calls(),
        [Call::Volume(0.6), Call::Muted(false)],
        "moving the volume unmutes"
    );
}

#[test]
fn seeks_clamp_to_the_file_and_wait_for_an_open_player() {
    let (mut playback, fake) = playback(Script::video().at(secs(122), PlaybackState::Paused));
    playback.seek(secs(10));
    assert_eq!(fake.calls(), [], "nothing to seek before opening");
    playback.toggle();
    playback.drain();
    fake.clear();
    playback.seek_by(true);
    assert_eq!(fake.calls(), [Call::Seek(secs(125))]);
    playback.seek(secs(500));
    assert_eq!(fake.calls()[1], Call::Seek(secs(125)));
}

// ---- The video player in a window. ----

type VideoRig = Rig<VideoPlayer, PlayerViewEvent>;

fn video(cx: &mut TestAppContext, script: Script) -> (VideoRig, FakeOpener) {
    let (opener, fake) = FakeOpener::rc(script);
    let rig = rig(cx, 1000., move |window, cx| {
        let frames = VideoFrames::for_window(window);
        VideoPlayer::new(source("video"), (Some(1280), Some(720)), opener, frames, cx)
    });
    (rig, fake)
}

fn phase(rig: &VideoRig, cx: &mut TestAppContext) -> Phase {
    rig.with(cx, |view, _, cx| view.read(cx).phase().clone())
}

#[gpui_kit::test]
fn the_poster_plays_from_its_big_button_and_shows_the_first_frame(cx: &mut TestAppContext) {
    let (rig, fake) = video(
        cx,
        Script::video().at(Duration::ZERO, PlaybackState::Paused),
    );
    assert!(rig.has(cx, "player-poster"));
    assert!(rig.has(cx, "player-big-play"));
    assert!(!rig.has(cx, "player-controls"));
    assert_eq!(fake.calls(), []);
    rig.click(cx, "player-big-play");
    assert_eq!(fake.calls(), [Call::Open("f-video".into()), Call::Play]);
    assert_eq!(phase(&rig, cx), Phase::Paused);
    assert!(
        !rig.has(cx, "player-poster"),
        "the decoded frame is the poster now"
    );
    assert!(rig.has(cx, "player-controls"));
}

#[gpui_kit::test]
fn each_control_makes_its_call(cx: &mut TestAppContext) {
    let (rig, fake) = video(cx, Script::video());
    rig.click(cx, "player-big-play");
    assert_eq!(phase(&rig, cx), Phase::Playing);
    fake.clear();
    rig.click(cx, "player-play");
    assert_eq!(fake.calls(), [Call::Pause]);
    assert_eq!(phase(&rig, cx), Phase::Paused);
    rig.click(cx, "player-play");
    assert_eq!(fake.calls()[1], Call::Play);
    fake.clear();
    rig.click(cx, "player-mute");
    assert_eq!(fake.calls(), [Call::Muted(true)]);
    rig.click(cx, "player-mute");
    assert_eq!(fake.calls()[1], Call::Muted(false));
    fake.clear();
    // The middle of a 2:05 track.
    rig.click(cx, "player-scrubber");
    let seeks: Vec<_> = fake
        .calls()
        .into_iter()
        .filter(|c| matches!(c, Call::Seek(_)))
        .collect();
    assert_eq!(seeks.len(), 1, "{:?}", fake.calls());
    let Call::Seek(to) = seeks[0] else {
        unreachable!()
    };
    assert!(
        to.abs_diff(Duration::from_millis(62_500)) < Duration::from_secs(1),
        "{to:?}"
    );
    rig.click(cx, "player-expand");
    assert!(rig.has(cx, "player-overlay"));
    assert_eq!(rig.events(), [PlayerViewEvent::Expanded(true)]);
    rig.click(cx, "player-expand");
    assert!(!rig.has(cx, "player-overlay"));
    assert_eq!(rig.events()[1], PlayerViewEvent::Expanded(false));
}

#[gpui_kit::test]
fn the_ended_state_replays_from_the_start(cx: &mut TestAppContext) {
    let (rig, fake) = video(cx, Script::video().at(secs(125), PlaybackState::Ended));
    rig.click(cx, "player-big-play");
    assert_eq!(phase(&rig, cx), Phase::Ended);
    assert!(rig.has(cx, "player-replay"));
    fake.clear();
    rig.click(cx, "player-replay");
    assert_eq!(
        fake.calls(),
        [Call::Play],
        "the engine restarts an ended file on play"
    );
}

#[gpui_kit::test]
fn keys_drive_a_focused_player(cx: &mut TestAppContext) {
    let (rig, fake) = video(cx, Script::video().at(secs(20), PlaybackState::Playing));
    rig.click(cx, "player-big-play");
    fake.clear();
    let press = |cx: &mut TestAppContext, keys: &str| {
        cx.simulate_keystrokes(rig.window, keys);
        cx.run_until_parked();
    };
    press(cx, "space");
    assert_eq!(fake.calls(), [Call::Pause]);
    press(cx, "space");
    assert_eq!(fake.calls()[1], Call::Play);
    fake.clear();
    press(cx, "right");
    press(cx, "left");
    press(cx, "left");
    assert_eq!(
        fake.calls(),
        [
            Call::Seek(secs(25)),
            Call::Seek(secs(20)),
            Call::Seek(secs(15))
        ]
    );
    fake.clear();
    press(cx, "down");
    press(cx, "down");
    press(cx, "up");
    assert_eq!(
        fake.calls(),
        [Call::Volume(0.9), Call::Volume(0.8), Call::Volume(0.9)]
    );
    fake.clear();
    press(cx, "m");
    assert_eq!(fake.calls(), [Call::Muted(true)]);
    press(cx, "f");
    assert!(rig.with(cx, |view, _, cx| view.read(cx).is_expanded()));
    press(cx, "escape");
    assert!(!rig.with(cx, |view, _, cx| view.read(cx).is_expanded()));
    assert_eq!(
        rig.events(),
        [
            PlayerViewEvent::Expanded(true),
            PlayerViewEvent::Expanded(false)
        ]
    );
}

#[gpui_kit::test]
fn controls_hide_after_three_still_seconds_while_playing(cx: &mut TestAppContext) {
    let (rig, _) = video(cx, Script::video());
    rig.click(cx, "player-big-play");
    let visible = |cx: &mut TestAppContext| rig.with(cx, |v, _, cx| v.read(cx).controls_visible());
    assert!(visible(cx));
    cx.executor()
        .advance_clock(HIDE_AFTER - Duration::from_millis(1));
    cx.run_until_parked();
    assert!(visible(cx), "not yet");
    cx.executor().advance_clock(Duration::from_millis(1));
    cx.run_until_parked();
    assert!(!visible(cx));
    assert!(!rig.has(cx, "player-controls"));

    // Moving the pointer brings them back and starts the count again.
    rig.with(cx, |view, _, cx| view.update(cx, |v, cx| v.wake(cx)));
    assert!(visible(cx));
    cx.executor().advance_clock(Duration::from_secs(2));
    rig.with(cx, |view, _, cx| view.update(cx, |v, cx| v.wake(cx)));
    cx.executor().advance_clock(Duration::from_secs(2));
    cx.run_until_parked();
    assert!(visible(cx), "the second move restarted the count");

    // Paused, they stay.
    rig.click(cx, "player-play");
    cx.executor().advance_clock(secs(10));
    cx.run_until_parked();
    assert!(visible(cx));
}

#[gpui_kit::test]
fn animation_frames_are_requested_only_while_video_plays(cx: &mut TestAppContext) {
    let (rig, _) = video(cx, Script::video());
    let animating = |cx: &mut TestAppContext| rig.with(cx, |v, _, cx| v.read(cx).animating());
    assert!(!animating(cx), "idle");
    rig.click(cx, "player-big-play");
    assert!(animating(cx), "playing");
    rig.click(cx, "player-play");
    assert!(!animating(cx), "paused");
}

#[gpui_kit::test]
fn an_unsupported_video_offers_download_and_open_externally(cx: &mut TestAppContext) {
    let (rig, fake) = video(cx, Script::failing(PlayerError::Unsupported));
    rig.click(cx, "player-big-play");
    assert!(rig.has(cx, "player-unsupported"));
    assert!(!rig.has(cx, "player-retry"));
    rig.click(cx, "player-download");
    rig.click(cx, "player-open-external");
    assert_eq!(
        rig.events(),
        [
            PlayerViewEvent::Download {
                file_id: "f-video".into()
            },
            PlayerViewEvent::OpenExternally {
                file_id: "f-video".into()
            },
        ]
    );
    assert_eq!(fake.calls().len(), 2, "open and play, nothing after");
}

#[gpui_kit::test]
fn a_failed_video_retries_and_offers_download(cx: &mut TestAppContext) {
    let (rig, fake) = video(cx, Script::failing(PlayerError::Network));
    rig.click(cx, "player-big-play");
    assert!(rig.has(cx, "player-error"));
    assert!(rig.has(cx, "player-download"));
    assert!(!rig.has(cx, "player-open-external"));
    fake.set_script(Script::video());
    rig.click(cx, "player-retry");
    assert_eq!(
        fake.calls(),
        [
            Call::Open("f-video".into()),
            Call::Play,
            Call::Open("f-video".into()),
            Call::Play
        ]
    );
    assert_eq!(phase(&rig, cx), Phase::Playing);
    assert!(!rig.has(cx, "player-error"));
}

#[gpui_kit::test]
fn events_between_commands_reach_the_view_through_its_inbox(cx: &mut TestAppContext) {
    // As the player's thread sends them: outside any command, so only the inbox's task takes
    // them. (GPUI's test scheduler refuses a wake from another thread; the app's doesn't.)
    let (rig, fake) = video(cx, Script::video());
    rig.click(cx, "player-big-play");
    let handle = fake.handle();
    handle.emit(PlayerEvent::Position(secs(61)));
    handle.emit(PlayerEvent::State(PlaybackState::Buffering));
    cx.run_until_parked();
    assert_eq!(phase(&rig, cx), Phase::Buffering);
    assert!(rig.has(cx, "player-spinner"));
    let position = rig.with(cx, |v, _, cx| v.read(cx).playback_state().position);
    assert_eq!(position, secs(61));
}

// ---- The audio row. ----

type AudioRig = Rig<AudioPlayer, PlayerViewEvent>;

fn audio(cx: &mut TestAppContext, script: Script) -> (AudioRig, FakeOpener) {
    let (opener, fake) = FakeOpener::rc(script);
    let rig = rig(cx, 1000., move |_, cx| {
        AudioPlayer::new(source("audio"), opener, cx)
    });
    (rig, fake)
}

#[gpui_kit::test]
fn the_audio_row_plays_pauses_mutes_and_downloads(cx: &mut TestAppContext) {
    let (rig, fake) = audio(cx, Script::audio());
    assert!(rig.has(cx, "player-file-name"));
    rig.click(cx, "player-play");
    assert_eq!(fake.calls(), [Call::Open("f-audio".into()), Call::Play]);
    let phase = |cx: &mut TestAppContext| rig.with(cx, |v, _, cx| v.read(cx).phase().clone());
    assert_eq!(phase(cx), Phase::Playing);
    fake.clear();
    rig.click(cx, "player-play");
    rig.click(cx, "player-mute");
    assert_eq!(fake.calls(), [Call::Pause, Call::Muted(true)]);
    rig.click(cx, "player-download");
    assert_eq!(
        rig.events(),
        [PlayerViewEvent::Download {
            file_id: "f-audio".into()
        }]
    );
    fake.clear();
    cx.simulate_keystrokes(rig.window, "space right up");
    cx.run_until_parked();
    assert_eq!(
        fake.calls(),
        [
            Call::Play,
            Call::Seek(secs(5)),
            Call::Volume(1.0),
            Call::Muted(false)
        ]
    );
    cx.simulate_keystrokes(rig.window, "f");
    cx.run_until_parked();
    assert_eq!(rig.events().len(), 1, "audio has no expanded view");
}

#[gpui_kit::test]
fn a_failed_audio_row_offers_retry_and_an_unsupported_one_opens_externally(
    cx: &mut TestAppContext,
) {
    let (rig, fake) = audio(cx, Script::failing(PlayerError::Network));
    rig.click(cx, "player-play");
    assert!(rig.has(cx, "player-error"));
    assert!(rig.has(cx, "player-download"));
    fake.set_script(Script::audio());
    rig.click(cx, "player-retry");
    assert_eq!(fake.calls().len(), 4);
    assert!(!rig.has(cx, "player-error"));

    let (rig, _) = audio(cx, Script::failing(PlayerError::Unsupported));
    rig.click(cx, "player-play");
    assert!(rig.has(cx, "player-unsupported"));
    assert!(!rig.has(cx, "player-retry"));
    rig.click(cx, "player-open-external");
    rig.click(cx, "player-download");
    assert_eq!(
        rig.events(),
        [
            PlayerViewEvent::OpenExternally {
                file_id: "f-audio".into()
            },
            PlayerViewEvent::Download {
                file_id: "f-audio".into()
            },
        ]
    );
}

#[gpui_kit::test]
fn the_audio_row_shows_loading_and_buffering(cx: &mut TestAppContext) {
    let (rig, _) = audio(cx, Script::loading());
    rig.click(cx, "player-play");
    assert!(rig.has(cx, "player-spinner"));
    assert!(!rig.has(cx, "player-play"));

    let (rig, _) = audio(cx, Script::audio().at(secs(3), PlaybackState::Buffering));
    rig.click(cx, "player-play");
    assert!(rig.has(cx, "player-spinner"));
    assert!(
        rig.has(cx, "player-play"),
        "pause stays while waiting for data"
    );
    let label = rig.with(cx, |v, _, cx| {
        let p = v.read(cx).playback_state();
        time_label(p.position, p.duration)
    });
    assert_eq!(label, "0:03 / 3:04");
}

// ---- The registry. ----

#[gpui_kit::test]
fn the_registry_gives_videos_with_a_thumbnail_their_poster(cx: &mut TestAppContext) {
    use super::{AttachmentPlayer, Players};
    use semaphore_core::model::{AttachmentKind, AttachmentView};
    let attachment = |file_id: &str, has_thumbnail: bool| AttachmentView {
        file_id: file_id.into(),
        filename: "clip.mp4".into(),
        mime_type: "video/mp4".into(),
        size_bytes: 2048,
        kind: AttachmentKind::Video,
        has_thumbnail,
        width: None,
        height: None,
    };
    let rig: VideoRig = rig(cx, 600., |window, cx| {
        let (opener, _) = FakeOpener::rc(Script::video());
        let players = Players::new(opener, VideoFrames::for_window(window));
        let poster =
            |players: &Players, file_id: &str, thumb: bool, cx: &mut gpui_kit::App| match players
                .create(&attachment(file_id, thumb), cx)
            {
                AttachmentPlayer::Video(video) => video.read(cx).has_poster(),
                AttachmentPlayer::Audio(_) => panic!("a video attachment made an audio player"),
            };
        // Before the app gives a resolver, no poster.
        assert!(!poster(&players, "f-1", true, cx));
        players.set_posters(std::rc::Rc::new(|attachment: &AttachmentView| {
            attachment
                .has_thumbnail
                .then(|| gpui_kit::ImageSource::from("thumb.png"))
        }));
        assert!(poster(&players, "f-2", true, cx));
        assert!(!poster(&players, "f-3", false, cx));
        VideoPlayer::new(
            source("video"),
            (None, None),
            FakeOpener::rc(Script::video()).0,
            VideoFrames::for_window(window),
            cx,
        )
    });
    drop(rig);
}
