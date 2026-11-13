//! The words the web uses (the count, the timeout, the other call), then the panel in a window:
//! what each join sends, what a deafened view joins as, what each mode offers, and Retry.

use super::fixtures::*;
use super::*;
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::TestAppContext;

fn panel_rig(
    cx: &mut TestAppContext,
    width: f32,
    view: VoicePreJoinView,
) -> Rig<PreJoinPanel, PreJoinEvent> {
    rig(cx, width, move |window, cx| {
        let mut panel = PreJoinPanel::new(window, cx);
        panel.set_time(TimeFormat::fixed(NOW_MS), cx);
        panel.set_media(Rc::new(Pictures::new()), cx);
        panel.set_view(view, cx);
        panel
    })
}

fn join(muted: bool, deafened: bool) -> PreJoinEvent {
    PreJoinEvent::Join(VoiceJoinOptions { muted, deafened })
}

#[test]
fn count_labels() {
    assert_eq!(count_label(&loading()), None);
    assert_eq!(
        count_label(&failed()).as_deref(),
        Some("Couldn't load who's here")
    );
    let mut view = ready(VoiceJoinMode::Full, Vec::new());
    assert_eq!(count_label(&view).as_deref(), Some("Nobody's here yet"));
    view.users = few()[..1].to_vec();
    assert_eq!(count_label(&view).as_deref(), Some("1 person here"));
    view.users = crowd();
    assert_eq!(count_label(&view).as_deref(), Some("34 people here"));
}

#[test]
fn timeout_sentence_uses_the_display_clock() {
    let time = TimeFormat::fixed(NOW_MS);
    // NOW_MS is 4:12 PM UTC on Thursday, November 5.
    assert_eq!(
        listen_only_note(&timed_out(false), &time),
        "You can listen, but you can't speak until 6:12 PM"
    );
    assert_eq!(
        listen_only_note(&timed_out(true), &time),
        "You can listen, but you can't speak until Fri, Nov 6 at 12:12 PM"
    );
    assert_eq!(
        listen_only_note(&ready(VoiceJoinMode::ListenOnly, few()), &time),
        "You can listen but not speak here"
    );
    // Another display zone moves the time, never the wall clock.
    let east = TimeFormat {
        zone: chrono::FixedOffset::east_opt(2 * 3600),
        ..TimeFormat::fixed(NOW_MS)
    };
    assert_eq!(until_label(&east, NOW_MS + 2 * 3_600_000), "8:12 PM");
}

#[test]
fn deafened_joins_are_muted() {
    let view = deafened();
    assert_eq!(
        join_options(false, &view),
        VoiceJoinOptions {
            muted: true,
            deafened: true
        }
    );
    assert_eq!(
        join_options(true, &view),
        VoiceJoinOptions {
            muted: true,
            deafened: true
        }
    );
    // A view's own mute doesn't decide which button was pressed.
    let mut muted_before = ready(VoiceJoinMode::Full, few());
    muted_before.muted = true;
    assert_eq!(
        join_options(false, &muted_before),
        VoiceJoinOptions::default()
    );
}

#[gpui_kit::test]
fn join_voice_sends_unmuted(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 1200., ready(VoiceJoinMode::Full, few()));
    rig.click(cx, "voice-prejoin-join");
    assert_eq!(rig.events(), [join(false, false)]);
    assert!(!rig.has(cx, "voice-prejoin-deafened-note"));
}

#[gpui_kit::test]
fn join_muted_sends_muted(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 1200., ready(VoiceJoinMode::Full, few()));
    rig.click(cx, "voice-prejoin-join-muted");
    assert_eq!(rig.events(), [join(true, false)]);
}

#[gpui_kit::test]
fn a_deafened_view_joins_deafened_and_muted(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 1200., deafened());
    assert!(rig.has(cx, "voice-prejoin-deafened-note"));
    rig.click(cx, "voice-prejoin-join");
    rig.click(cx, "voice-prejoin-join-muted");
    assert_eq!(rig.events(), [join(true, true), join(true, true)]);
}

#[gpui_kit::test]
fn listen_only_joins_muted(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 390., timed_out(false));
    assert!(!rig.has(cx, "voice-prejoin-join"));
    assert!(!rig.has(cx, "voice-prejoin-join-muted"));
    assert!(rig.has(cx, "voice-prejoin-listen-note"));
    rig.click(cx, "voice-prejoin-listen");
    assert_eq!(rig.events(), [join(true, false)]);
}

#[gpui_kit::test]
fn none_mode_offers_no_join_and_says_why(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 1200., ready(VoiceJoinMode::None, few()));
    assert!(rig.has(cx, "voice-prejoin-blocked"));
    for id in [
        "voice-prejoin-join",
        "voice-prejoin-join-muted",
        "voice-prejoin-listen",
    ] {
        assert!(!rig.has(cx, id), "{id} is offered");
    }
    // Who's here still shows.
    assert!(rig.has(cx, "voice-prejoin-people"));
    assert!(rig.events().is_empty());
}

#[gpui_kit::test]
fn failed_read_retry_emits_retry(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 390., failed());
    rig.click(cx, "voice-prejoin-retry");
    assert_eq!(rig.events(), [PreJoinEvent::Retry]);
    // The joins stay: the server still decides.
    assert!(rig.has(cx, "voice-prejoin-join"));
}

#[gpui_kit::test]
fn the_view_decides_what_shows(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 1200., loading());
    assert!(!rig.has(cx, "voice-prejoin-retry"));
    assert!(!rig.has(cx, "voice-prejoin-people"));
    assert!(!rig.has(cx, "voice-prejoin-elsewhere"));
    rig.with(cx, |panel, _, cx| {
        panel.update(cx, |panel, cx| panel.set_view(elsewhere(), cx))
    });
    assert!(rig.has(cx, "voice-prejoin-elsewhere"));
    assert!(rig.has(cx, "voice-prejoin-people"));
    assert_eq!(
        elsewhere_note("Gaming"),
        "You're in \u{201c}Gaming\u{201d}. Joining moves you here."
    );
}

#[gpui_kit::test]
fn a_crowd_keeps_the_joins_on_a_phone(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 390., many());
    assert_eq!(count_label(&many()).as_deref(), Some("34 people here"));
    // Three to a row; the window is 800 tall, so only the first rows are drawn.
    for id in [
        "voice-prejoin-user-0",
        "voice-prejoin-user-2",
        "voice-prejoin-user-3",
    ] {
        assert!(rig.has(cx, id), "{id} isn't drawn");
    }
    rig.click(cx, "voice-prejoin-join");
    assert_eq!(rig.events(), [join(false, false)]);
}

#[gpui_kit::test]
fn clicking_a_person_opens_their_profile(cx: &mut TestAppContext) {
    let rig = panel_rig(cx, 1200., ready(VoiceJoinMode::Full, few()));
    rig.click(cx, "voice-prejoin-user-1");
    assert_eq!(
        rig.events(),
        [PreJoinEvent::OpenProfile {
            user_id: "u-bo".into()
        }]
    );
    // A blocked channel still shows who's here, and they still open.
    let rig = panel_rig(cx, 390., ready(VoiceJoinMode::None, few()));
    rig.click(cx, "voice-prejoin-user-0");
    assert_eq!(
        rig.events(),
        [PreJoinEvent::OpenProfile {
            user_id: "u-ana".into()
        }]
    );
}
