//! The replay views' rules (presets, the buffer's status, the trim's geometry and limits, the
//! ruler), then the views in a window: what each press emits.

use super::model::*;
use super::*;
use crate::dms::rig::rig;
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
            now_ms: Some(ms),
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
