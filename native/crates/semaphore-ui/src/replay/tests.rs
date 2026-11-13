//! The replay views' rules (presets, the buffer's status, the trim's geometry and limits, the
//! ruler), then the views in a window: what each press emits.

use super::model::*;
use super::*;
use crate::dms::rig::rig;
use crate::panel::PanelClock;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use semaphore_core::model::{
    Clip, ClipsView, ErrorView, LoadState, ReplayMinutes, ReplaySessionView, ReplayState,
    ReplayTrim,
};

fn session(seconds: u32) -> ReplaySessionView {
    ReplaySessionView {
        state: LoadState::Ready,
        active: true,
        total_seconds: seconds,
        ..ReplaySessionView::default()
    }
}

fn recording() -> ReplayState {
    ReplayState::Recording {
        session_id: "s".into(),
    }
}

fn range(max: u32, start: u32, end: u32) -> TrimRange {
    TrimRange { max, start, end }
}

// ---- Presets and the buffer's status. ----

#[test]
fn presets_read_like_the_web() {
    assert_eq!(
        PRESETS.map(preset_label),
        ["1 min", "2 min", "5 min", "10 min"]
    );
    assert_eq!(
        PRESETS.map(preset_size),
        ["~45MB", "~90MB", "~225MB", "~450MB"]
    );
    assert_eq!(DEFAULT_PRESET, ReplayMinutes::Five);
}

#[test]
fn the_status_follows_the_buffer_and_only_recording_can_capture() {
    let ready = session(42);
    assert_eq!(
        buffer_status(&ReplayState::Off, &ready),
        BufferStatus::NotRecording
    );
    assert_eq!(
        buffer_status(&ReplayState::Starting, &ready),
        BufferStatus::Starting
    );
    assert_eq!(
        buffer_status(&recording(), &session(0)),
        BufferStatus::WarmingUp
    );
    assert_eq!(
        buffer_status(&recording(), &ready),
        BufferStatus::Recording { seconds: Some(42) }
    );
    assert_eq!(
        buffer_status(&recording(), &ReplaySessionView::default()),
        BufferStatus::Recording { seconds: None },
        "still loading"
    );
    let failed = buffer_status(
        &ReplayState::Failed {
            message: "boom".into(),
        },
        &ready,
    );
    assert!(failed.line().contains("boom"));
    assert!(!failed.can_capture());
    assert!(!BufferStatus::WarmingUp.can_capture());
    assert!(!BufferStatus::NotRecording.can_capture());
    assert!(BufferStatus::Recording { seconds: None }.can_capture());
    assert_eq!(
        BufferStatus::Recording { seconds: Some(252) }.line(),
        "Recording. 4:12 buffered."
    );
}

#[test]
fn clocks_are_minutes_then_hours() {
    assert_eq!(clock(0), "0:00");
    assert_eq!(clock(61), "1:01");
    assert_eq!(clock(1500), "25:00");
    assert_eq!(clock(3725), "1:02:05");
}

#[test]
fn capture_times_are_written_in_the_users_zone() {
    use crate::messages::TimeFormat;
    use chrono::FixedOffset;

    // Zone minutes east of UTC, the instant, the local time, and the UTC time.
    let cases = [
        (
            9 * 60,
            1_793_804_340_000,
            "Nov 4, 2026 11:59 PM",
            "Nov 4, 2026 2:59 PM",
        ),
        (
            9 * 60,
            1_793_804_460_000,
            "Nov 5, 2026 12:01 AM",
            "Nov 4, 2026 3:01 PM",
        ),
        (
            -8 * 60,
            1_793_865_540_000,
            "Nov 4, 2026 11:59 PM",
            "Nov 5, 2026 7:59 AM",
        ),
        (
            -8 * 60,
            1_793_865_660_000,
            "Nov 5, 2026 12:01 AM",
            "Nov 5, 2026 8:01 AM",
        ),
        // 2026-12-31 15:30 UTC: New Year's Day in +09:00.
        (
            9 * 60,
            1_798_731_000_000,
            "Jan 1, 2027 12:30 AM",
            "Dec 31, 2026 3:30 PM",
        ),
        // 2026-11-05 18:31 UTC: 00:01 the 6th in +05:30.
        (
            5 * 60 + 30,
            1_793_903_460_000,
            "Nov 6, 2026 12:01 AM",
            "Nov 5, 2026 6:31 PM",
        ),
        // 2026-11-05 18:16 UTC: 00:01 the 6th in +05:45.
        (
            5 * 60 + 45,
            1_793_902_560_000,
            "Nov 6, 2026 12:01 AM",
            "Nov 5, 2026 6:16 PM",
        ),
    ];
    for (minutes, ms, local, utc) in cases {
        let zone = FixedOffset::east_opt(minutes * 60).expect("a zone");
        let time = TimeFormat {
            zone: Some(zone),
            now: PanelClock::fixed(ms),
        };
        assert_eq!(captured_at(&time, ms), local, "{minutes} minutes east");
        assert_eq!(
            TimeFormat::fixed(ms).format_at(ms, "%b %-d, %Y %-I:%M %p"),
            utc,
            "{minutes} minutes east: the UTC time"
        );
    }
}

// ---- The trim. ----

#[test]
fn a_new_trim_is_the_last_minute_or_the_whole_short_buffer() {
    assert_eq!(TrimRange::new(0), None, "nothing buffered: warming up");
    assert_eq!(TrimRange::new(252), Some(range(252, 192, 252)));
    assert_eq!(TrimRange::new(25), Some(range(25, 0, 25)));
    assert_eq!(
        TrimRange::new(252).unwrap().trim(),
        ReplayTrim {
            start_seconds: 192,
            end_seconds: 252
        },
        "seconds from the buffer's start"
    );
}

#[test]
fn handles_stay_inside_the_buffer_and_a_second_apart() {
    let mut trim = range(252, 192, 252);
    trim.set(Handle::Start, 0);
    assert_eq!((trim.start, trim.end), (0, 252), "both at the limits");
    trim.set(Handle::End, 999);
    assert_eq!(trim.end, 252, "not past the buffer");
    trim.set(Handle::Start, 252);
    assert_eq!(trim.start, 251, "the start stops a second before the end");
    trim.set(Handle::End, 0);
    assert_eq!(trim.end, 252, "the end stops a second after the start");
    assert_eq!(trim.duration(), MIN_TRIM);
}

#[test]
fn keys_nudge_by_seconds_and_stop_at_the_edges() {
    let mut trim = range(100, 40, 60);
    trim.nudge(Handle::Start, -1);
    assert_eq!(trim.start, 39);
    trim.nudge(Handle::Start, -100);
    assert_eq!(trim.start, 0);
    trim.nudge(Handle::End, 10);
    assert_eq!(trim.end, 70);
    trim.nudge(Handle::End, 1000);
    assert_eq!(trim.end, 100);
    trim.nudge(Handle::End, -1000);
    assert_eq!(trim.end, 1, "a second after the start at 0");
}

#[test]
fn a_press_takes_the_nearer_handle_and_maps_to_whole_seconds() {
    let trim = range(200, 50, 150);
    assert_eq!(trim.nearest(0.0), Handle::Start, "left of the range");
    assert_eq!(trim.nearest(1.0), Handle::End, "right of the range");
    assert_eq!(trim.nearest(0.3), Handle::Start);
    assert_eq!(trim.nearest(0.7), Handle::End);
    assert_eq!(trim.nearest(0.5), Handle::Start, "a tie takes the start");
    assert_eq!(trim.seconds_at(0.333), 67);
    assert_eq!(trim.seconds_at(-1.), 0);
    assert_eq!(trim.seconds_at(2.), 200);
    assert_eq!(trim.fraction(Handle::End), 0.75);
}

#[test]
fn refresh_moves_an_end_at_the_edge_and_keeps_one_inside() {
    let mut at_edge = range(100, 40, 100);
    at_edge.refresh(160);
    assert_eq!(at_edge, range(160, 40, 160), "the end follows the edge");
    let mut inside = range(100, 40, 70);
    inside.refresh(160);
    assert_eq!(inside, range(160, 40, 70));
    let mut shrunk = range(100, 90, 95);
    shrunk.refresh(50);
    assert_eq!(shrunk, range(50, 49, 50), "pulled inside a shorter buffer");
    let mut same = range(100, 40, 70);
    same.refresh(0);
    assert_eq!(same, range(100, 40, 70), "an empty answer changes nothing");
}

#[test]
fn the_ruler_marks_every_30_or_60_seconds_and_thins_out_when_crowded() {
    assert_eq!(ruler_marks(100, usize::MAX), [0, 30, 60, 90]);
    assert_eq!(
        ruler_marks(300, usize::MAX),
        [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300]
    );
    assert_eq!(
        ruler_marks(301, usize::MAX).len(),
        6,
        "60 s marks past 5 minutes"
    );
    assert_eq!(ruler_marks(252, 5), [0, 60, 120, 180, 240]);
    assert_eq!(
        ruler_marks(1500, 13).len(),
        13,
        "2 min marks for 25 minutes"
    );
    assert!(ruler_marks(1500, 5).len() <= 5);
}

// ---- Clips. ----

fn clip(id: &str, public: bool) -> Clip {
    Clip {
        id: id.into(),
        file_id: format!("f-{id}"),
        channel_id: None,
        duration_seconds: 60,
        is_public: public,
        captured_at_ms: 0,
        download_url: String::new(),
        size_bytes: 1000,
        filename: format!("{id}.mp4"),
        mime_type: "video/mp4".into(),
        has_thumbnail: false,
    }
}

#[test]
fn a_clip_plays_as_its_own_type_and_counts_read_well() {
    let attachment = clip_attachment(&clip("a", true));
    assert_eq!(attachment.mime_type, "video/mp4");
    assert_eq!(attachment.file_id, "f-a");
    assert!(crate::player::Players::plays(&attachment));
    assert_eq!(public_count(1), "1 public clip");
    assert_eq!(public_count(3), "3 public clips");
}

// ---- The views. ----

fn ready(clips: Vec<Clip>) -> ClipsView {
    ClipsView {
        state: LoadState::Ready,
        clips,
        ..ClipsView::default()
    }
}

#[gpui_kit::test]
fn capture_sends_the_preset_or_the_trim(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., CaptureReplayDialog::new);
    rig.with(cx, |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.set_state(recording(), session(252), cx)
        })
    });
    rig.click(cx, "capture-preset-2");
    rig.click(cx, "capture-go");
    assert_eq!(
        rig.events(),
        [CaptureEvent::Capture(CaptureRequest {
            minutes: ReplayMinutes::Two,
            trim: None,
            destination: ClipDestination::Library,
        })]
    );
    rig.clear();
    rig.click(cx, "capture-trim");
    rig.with(cx, |dialog, _, cx| {
        let trim = dialog.read(cx).trim().clone();
        trim.update(cx, |trim, cx| trim.set_handle(model::Handle::Start, 10, cx));
    });
    rig.click(cx, "capture-go");
    assert_eq!(
        rig.events(),
        [CaptureEvent::Capture(CaptureRequest {
            minutes: ReplayMinutes::Two,
            trim: Some(ReplayTrim {
                start_seconds: 10,
                end_seconds: 252
            }),
            destination: ClipDestination::Library,
        })]
    );
}

#[gpui_kit::test]
fn a_channel_needs_its_list_and_a_pick(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., CaptureReplayDialog::new);
    rig.with(cx, |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.set_state(recording(), session(60), cx)
        })
    });
    rig.click(cx, "capture-target-channel");
    assert_eq!(
        rig.events(),
        [CaptureEvent::NeedDestinations(DestinationKind::Channel)]
    );
    rig.clear();
    rig.click(cx, "capture-go");
    assert!(rig.events().is_empty(), "no channel picked yet");
    rig.with(cx, |dialog, window, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.set_channels(Some(vec![PickOption::new("c1", "#general")]), window, cx);
            dialog.pick(CaptureTarget::Channel, "c1", window, cx);
        })
    });
    rig.click(cx, "capture-go");
    assert_eq!(
        rig.events(),
        [CaptureEvent::Capture(CaptureRequest {
            minutes: ReplayMinutes::Five,
            trim: None,
            destination: ClipDestination::Channel {
                channel_id: "c1".into()
            },
        })]
    );
}

#[gpui_kit::test]
fn download_only_takes_the_preset_and_nothing_captures_without_a_buffer(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., CaptureReplayDialog::new);
    rig.click(cx, "capture-go");
    assert!(rig.events().is_empty(), "not recording");
    rig.with(cx, |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.set_state(recording(), session(0), cx)
        })
    });
    rig.click(cx, "capture-go");
    assert!(rig.events().is_empty(), "warming up");
    rig.with(cx, |dialog, _, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.set_state(recording(), session(90), cx)
        })
    });
    rig.click(cx, "capture-preset-10");
    rig.click(cx, "capture-target-download");
    rig.click(cx, "capture-trim");
    rig.click(cx, "capture-go");
    assert_eq!(
        rig.events(),
        [CaptureEvent::DownloadOnly {
            minutes: ReplayMinutes::Ten
        }]
    );
    rig.clear();
    rig.click(cx, "capture-cancel");
    assert_eq!(rig.events(), [CaptureEvent::Close]);
}

#[gpui_kit::test]
fn the_trim_freezes_its_length_until_refresh(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., |_, cx| TrimTimeline::new(cx));
    rig.with(cx, |trim, _, cx| {
        trim.update(cx, |trim, cx| trim.set_session(session(100), cx))
    });
    assert_eq!(
        rig.events(),
        [TrimEvent::Changed(ReplayTrim {
            start_seconds: 40,
            end_seconds: 100
        })]
    );
    rig.clear();
    rig.with(cx, |trim, _, cx| {
        trim.update(cx, |trim, cx| trim.set_session(session(130), cx))
    });
    assert!(rig.events().is_empty(), "a grown buffer waits for Refresh");
    rig.click(cx, "trim-refresh");
    assert_eq!(
        rig.events(),
        [TrimEvent::Changed(ReplayTrim {
            start_seconds: 40,
            end_seconds: 130
        })]
    );
}

#[gpui_kit::test]
fn my_library_toggles_shares_and_deletes_after_the_confirm(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., |_, cx| ClipLibrary::new(true, None, cx));
    rig.with(cx, |library, _, cx| {
        library.update(cx, |library, cx| {
            library.set_view(ready(vec![clip("a", false), clip("b", true)]), cx)
        })
    });
    rig.click(cx, "clip-public-a");
    rig.click(cx, "clip-share-b");
    rig.click(cx, "clip-download-a");
    assert_eq!(
        rig.events(),
        [
            ClipEvent::SetPublic {
                clip_id: "a".into(),
                public: true
            },
            ClipEvent::Share {
                clip_id: "b".into()
            },
            ClipEvent::Download {
                clip_id: "a".into(),
                file_id: "f-a".into(),
                filename: "a.mp4".into()
            },
        ]
    );
    rig.clear();
    rig.click(cx, "clip-delete-a");
    assert!(rig.events().is_empty(), "the confirm first");
    assert!(rig.has(cx, "clip-delete-confirm"));
    rig.click(cx, "clip-delete-confirm");
    assert_eq!(
        rig.events(),
        [ClipEvent::Delete {
            clip_id: "a".into()
        }]
    );
    rig.with(cx, |library, _, cx| {
        library.update(cx, |library, cx| {
            library.set_view(
                ClipsView {
                    busy: vec!["a".into()],
                    ..ready(vec![clip("a", false), clip("b", true)])
                },
                cx,
            )
        })
    });
    assert!(rig.has(cx, "clip-delete-confirm"), "open while it deletes");
    rig.with(cx, |library, _, cx| {
        library.update(cx, |library, cx| {
            library.set_view(ready(vec![clip("b", true)]), cx)
        })
    });
    assert!(!rig.has(cx, "clip-delete-confirm"), "closed once it's gone");
}

#[gpui_kit::test]
fn another_users_clips_only_download_and_a_failure_retries(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., |_, cx| ClipLibrary::new(false, None, cx));
    rig.with(cx, |library, _, cx| {
        library.update(cx, |library, cx| {
            library.set_view(ready(vec![clip("a", true)]), cx)
        })
    });
    assert!(rig.has(cx, "clip-download-a"));
    assert!(!rig.has(cx, "clip-delete-a"));
    assert!(!rig.has(cx, "clip-share-a"));
    assert!(!rig.has(cx, "clip-public-a"));
    rig.with(cx, |library, _, cx| {
        library.update(cx, |library, cx| {
            library.set_view(
                ClipsView {
                    state: LoadState::Failed {
                        error: ErrorView {
                            code: "x".into(),
                            message: "x".into(),
                            retryable: true,
                            retry_after_ms: None,
                        },
                    },
                    ..ClipsView::default()
                },
                cx,
            )
        })
    });
    rig.click(cx, "clips-retry");
    assert_eq!(rig.events(), [ClipEvent::Retry]);
}

#[gpui_kit::test]
fn share_asks_for_channels_of_the_picked_community_or_dms(cx: &mut TestAppContext) {
    let rig = rig(cx, 1000., |window, cx| {
        ShareClipDialog::new("clip-1", window, cx)
    });
    rig.click(cx, "share-go");
    assert!(rig.events().is_empty(), "no channel picked");
    rig.with(cx, |dialog, window, cx| {
        dialog.update(cx, |dialog, cx| {
            dialog.set_communities(Some(vec![PickOption::new("k1", "Game Night")]), window, cx);
            dialog.pick_community("k1", window, cx);
            dialog.set_channels(
                "k-other",
                Some(vec![PickOption::new("x", "#x")]),
                window,
                cx,
            );
            dialog.set_channels(
                "k1",
                Some(vec![PickOption::new("c1", "#general")]),
                window,
                cx,
            );
            dialog.pick(DestinationKind::Channel, "c1", window, cx);
        })
    });
    rig.click(cx, "share-go");
    assert_eq!(
        rig.events(),
        [ShareEvent::Share {
            clip_id: "clip-1".into(),
            destination: ClipDestination::Channel {
                channel_id: "c1".into()
            },
        }]
    );
    rig.clear();
    rig.click(cx, "share-kind-dm");
    assert_eq!(rig.events(), [ShareEvent::NeedDms]);
    rig.clear();
    rig.click(cx, "share-cancel");
    assert_eq!(rig.events(), [ShareEvent::Close]);
}

// ---- The trim, under any presses. ----

mod properties {
    use super::super::model::*;
    use proptest::prelude::*;
    use proptest::test_runner::{Config, RngSeed};
    use std::prelude::rust_2024::test;

    fn config() -> Config {
        Config {
            cases: 512,
            rng_seed: RngSeed::Fixed(0x7c1a_0001),
            ..Config::default()
        }
    }

    #[derive(Debug, Clone)]
    enum Press {
        Set(bool, u32),
        Nudge(bool, i64),
        Drag(f32),
        Refresh(u32),
    }

    fn press() -> impl Strategy<Value = Press> {
        prop_oneof![
            (any::<bool>(), 0u32..2000).prop_map(|(start, at)| Press::Set(start, at)),
            (any::<bool>(), -700i64..700).prop_map(|(start, by)| Press::Nudge(start, by)),
            prop_oneof![-1f32..2., Just(f32::NAN)].prop_map(Press::Drag),
            (0u32..1500).prop_map(Press::Refresh),
        ]
    }

    fn handle(start: bool) -> Handle {
        if start { Handle::Start } else { Handle::End }
    }

    proptest! {
        #![proptest_config(config())]

        #[test]
        fn the_handles_stay_inside_the_buffer_and_apart(
            max in 1u32..1500,
            presses in prop::collection::vec(press(), 0..30),
        ) {
            let mut trim = TrimRange::new(max).unwrap();
            for press in presses {
                match press {
                    Press::Set(start, at) => trim.set(handle(start), at),
                    Press::Nudge(start, by) => trim.nudge(handle(start), by),
                    Press::Drag(fraction) => {
                        let at = trim.seconds_at(fraction);
                        prop_assert!(at <= trim.max);
                        trim.set(trim.nearest(fraction), at);
                    }
                    Press::Refresh(max) => trim.refresh(max),
                }
                prop_assert!(trim.start + MIN_TRIM <= trim.end, "{trim:?}");
                prop_assert!(trim.end <= trim.max, "{trim:?}");
                prop_assert!(trim.duration() >= MIN_TRIM);
                let (start, end) = (trim.fraction(Handle::Start), trim.fraction(Handle::End));
                prop_assert!((0.0..=1.0).contains(&start) && (0.0..=1.0).contains(&end));
            }
        }

        #[test]
        fn ruler_marks_rise_from_zero_within_the_buffer(max in 0u32..20_000, most in 0usize..40) {
            let marks = ruler_marks(max, most);
            prop_assert_eq!(marks.first(), Some(&0));
            prop_assert!(marks.windows(2).all(|pair| pair[0] < pair[1]));
            prop_assert!(marks.iter().all(|mark| *mark <= max));
        }
    }
}

// ---- The trim preview. ----

mod preview {
    use super::*;
    use crate::player::Players;
    use crate::player::fake::{Call, FakeOpener, Script};
    use crate::voice::VideoFrames;
    use gpui_kit::point;
    use gpui_kit::test::TestWindowExt as _;
    use semaphore_core::player::{PlaybackState, PlayerEvent};
    use std::time::Duration;

    const S: Duration = Duration::from_secs(1);

    type TrimRig = crate::dms::rig::Rig<TrimTimeline, TrimEvent>;

    /// A shown timeline over 100 s of buffer (the selection 40..100), with players when `fake`.
    fn timeline(cx: &mut TestAppContext, fake: Option<&FakeOpener>) -> TrimRig {
        let rig = rig(cx, 1000., |_, cx| TrimTimeline::new(cx));
        let opener = fake.cloned();
        rig.with(cx, move |trim, window, cx| {
            let players = opener.map(|opener| {
                Players::new(std::rc::Rc::new(opener), VideoFrames::for_window(window))
            });
            trim.update(cx, |trim, cx| {
                trim.set_players(players, cx);
                trim.set_session(session(100), cx);
                trim.set_session_id(Some("s".into()), cx);
                trim.set_shown(true, cx);
            })
        });
        // The engine says Paused once it has opened without a play; the fake leaves that to us.
        if let Some(fake) = fake {
            rig.with(cx, |_, _, _| {
                fake.handle()
                    .emit(PlayerEvent::State(PlaybackState::Paused))
            });
        }
        rig.clear();
        rig
    }

    fn opened_at_start() -> FakeOpener {
        FakeOpener::new(Script::video().at(40 * S, PlaybackState::Playing))
    }

    fn position(rig: &TrimRig, cx: &mut TestAppContext) -> Duration {
        rig.with(cx, |trim, _, cx| {
            trim.read(cx)
                .preview_entity()
                .map(|preview| preview.read(cx).position())
                .expect("a preview")
        })
    }

    #[gpui_kit::test]
    fn the_slot_is_filled_only_with_a_player(cx: &mut TestAppContext) {
        let rig = timeline(cx, None);
        assert!(rig.with(cx, |trim, _, cx| trim.read(cx).preview().is_none()));
        assert!(!rig.has(cx, "trim-preview"));
        assert!(rig.has(cx, "trim-refresh"), "Refresh stays in the header");

        let fake = opened_at_start();
        let rig = timeline(cx, Some(&fake));
        assert!(rig.with(cx, |trim, _, cx| trim.read(cx).preview().is_some()));
        assert!(rig.has(cx, "trim-preview"));
        assert!(rig.has(cx, "trim-playhead"));
        assert_eq!(
            fake.calls(),
            [Call::Open("replay:s".into())],
            "opened, paused"
        );
        assert_eq!(position(&rig, cx), 40 * S);
        // Hidden (the dialog's trim closed): the player goes.
        rig.with(cx, |trim, _, cx| {
            trim.update(cx, |trim, cx| trim.set_shown(false, cx))
        });
        assert_eq!(fake.alive(), 0);
        assert!(!rig.has(cx, "trim-preview"));
    }

    #[gpui_kit::test]
    fn loop_on_wraps_to_the_start(cx: &mut TestAppContext) {
        let fake = opened_at_start();
        let rig = timeline(cx, Some(&fake));
        rig.click(cx, "trim-loop");
        rig.click(cx, "trim-play-selection");
        assert_eq!(fake.calls()[1..], [Call::Seek(40 * S), Call::Play]);
        fake.clear();
        rig.with(cx, |_, _, _| {
            fake.handle()
                .emit(PlayerEvent::Position(Duration::from_millis(99_950)))
        });
        assert_eq!(fake.calls(), [Call::Seek(40 * S)], "back to the start");
        assert_eq!(position(&rig, cx), 40 * S);
        // The buffer ending before a position reached the end (they come every 250 ms) loops too.
        fake.clear();
        rig.with(cx, |_, _, _| {
            fake.handle().emit(PlayerEvent::State(PlaybackState::Ended))
        });
        assert_eq!(fake.calls(), [Call::Seek(40 * S), Call::Play]);
    }

    #[gpui_kit::test]
    fn loop_off_pauses_at_the_end(cx: &mut TestAppContext) {
        let fake = opened_at_start();
        let rig = timeline(cx, Some(&fake));
        rig.click(cx, "trim-play");
        assert_eq!(fake.calls()[1..], [Call::Play]);
        fake.clear();
        rig.with(cx, |_, _, _| {
            fake.handle().emit(PlayerEvent::Position(70 * S))
        });
        assert!(fake.calls().is_empty(), "inside the selection");
        rig.with(cx, |_, _, _| {
            fake.handle().emit(PlayerEvent::Position(100 * S))
        });
        assert_eq!(fake.calls(), [Call::Pause]);
        // Play again at the end starts the selection over.
        fake.clear();
        rig.click(cx, "trim-play");
        assert_eq!(fake.calls(), [Call::Seek(40 * S), Call::Play]);
        // Jump to end lands a second before it.
        fake.clear();
        rig.click(cx, "trim-jump-end");
        rig.click(cx, "trim-jump-start");
        assert_eq!(fake.calls(), [Call::Seek(99 * S), Call::Seek(40 * S)]);
    }

    #[gpui_kit::test]
    fn a_press_on_the_track_seeks_and_a_start_past_the_playhead_takes_it(cx: &mut TestAppContext) {
        let fake = opened_at_start();
        let rig = timeline(cx, Some(&fake));
        fake.clear();
        // A quarter along, away from both handles (at 40% and 100%): 25 s.
        rig.with(cx, |_, window, cx| {
            let bounds = window.find("trim-track").bounds();
            let at = point(bounds.size.width * 0.25, bounds.size.height / 2.);
            window.click_at("trim-track", at, cx);
        });
        let seeks: Vec<Call> = fake.calls();
        let [Call::Seek(to)] = seeks.as_slice() else {
            panic!("one seek: {seeks:?}");
        };
        assert!(to.abs_diff(25 * S) < S, "{to:?}");
        assert!(rig.events().is_empty(), "no handle moved");
        // The start dragged past the playhead (25 s) takes it along.
        fake.clear();
        rig.with(cx, |trim, _, cx| {
            trim.update(cx, |trim, cx| trim.set_handle(model::Handle::Start, 60, cx))
        });
        assert_eq!(fake.calls(), [Call::Seek(60 * S)]);
        // Behind the playhead it stays.
        fake.clear();
        rig.with(cx, |trim, _, cx| {
            trim.update(cx, |trim, cx| trim.set_handle(model::Handle::Start, 50, cx))
        });
        assert!(fake.calls().is_empty());
    }

    #[gpui_kit::test]
    fn refresh_reopens_at_the_playhead_and_a_failure_retries(cx: &mut TestAppContext) {
        let fake = opened_at_start();
        let rig = timeline(cx, Some(&fake));
        rig.with(cx, |trim, _, cx| {
            trim.update(cx, |trim, cx| trim.set_session(session(130), cx))
        });
        rig.with(cx, |_, _, _| {
            fake.handle().emit(PlayerEvent::Position(70 * S))
        });
        fake.clear();
        rig.clear();
        rig.click(cx, "trim-refresh");
        assert_eq!(fake.calls(), [Call::Open("replay:s".into())]);
        assert_eq!(
            rig.events(),
            [TrimEvent::Changed(ReplayTrim {
                start_seconds: 40,
                end_seconds: 130
            })]
        );
        assert_eq!(fake.alive(), 1, "the old player went");

        fake.set_script(Script::failing(
            semaphore_core::player::PlayerError::Network,
        ));
        rig.click(cx, "trim-refresh");
        assert!(rig.has(cx, "trim-preview-error"));
        fake.set_script(Script::video().at(40 * S, PlaybackState::Playing));
        fake.clear();
        rig.click(cx, "trim-preview-retry");
        assert_eq!(fake.calls(), [Call::Open("replay:s".into())]);
        assert!(!rig.has(cx, "trim-preview-error"));
    }

    #[gpui_kit::test]
    fn a_preview_without_sound_says_so(cx: &mut TestAppContext) {
        let mut script = Script::video().at(40 * S, PlaybackState::Playing);
        if let Some(Ok(meta)) = &mut script.open {
            meta.has_audio = false;
        }
        let fake = FakeOpener::new(script);
        let rig = timeline(cx, Some(&fake));
        assert!(rig.has(cx, "trim-preview-video-only"));
        let rig = timeline(cx, Some(&opened_at_start()));
        assert!(!rig.has(cx, "trim-preview-video-only"));
    }
}

#[test]
fn with_a_preview_only_a_press_on_a_handle_grabs_it() {
    // 100 s over 1000 px: the start at 400 px, the end at 1000 px.
    let range = range(100, 40, 100);
    assert_eq!(range.handle_at(400., 1000.), Some(Handle::Start));
    assert_eq!(range.handle_at(390., 1000.), Some(Handle::Start));
    assert_eq!(range.handle_at(411., 1000.), None);
    assert_eq!(range.handle_at(250., 1000.), None);
    assert_eq!(range.handle_at(995., 1000.), Some(Handle::End));
    assert_eq!(range.handle_at(400., 0.), None);
    // Handles a pixel apart: the nearer.
    let tight = TrimRange {
        max: 1000,
        start: 500,
        end: 501,
    };
    assert_eq!(tight.handle_at(499., 1000.), Some(Handle::Start));
    assert_eq!(tight.handle_at(502., 1000.), Some(Handle::End));
}
