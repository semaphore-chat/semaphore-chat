//! The pure parts first (key capture, the theme mapping, device rows, session lines, the link
//! status), then every tab and the shell in a window: the event each control sends.

use super::desktop::link_note;
use super::voice::{device_rows, transmitting};
use super::*;
use crate::dms::rig::{Rig, rig};
use crate::theme::ThemeChoice;
use core::prelude::v1::test;
use gpui_kit::TestAppContext;
use gpui_kit::component::select::SelectEvent;
use gpui_kit::component::slider::{SliderEvent, SliderValue};
use gpui_kit::{
    AppContext as _, Bounds, Context, EventEmitter, Point, Render, Window, WindowBounds,
    WindowOptions, px, size,
};
use semaphore_core::model::{
    AccentColor, Appearance, AppearancePatch, AppearanceView, ErrorView, SessionRow,
    ThemeIntensity, ThemeMode,
};
use std::cell::RefCell;
use std::rc::Rc;

const MIN: i64 = 60 * 1000;
const DAY: i64 = 24 * 60 * MIN;
/// 2026-11-01T00:00:00Z.
const NOW: i64 = 1_793_491_200_000;

fn failed() -> LoadState {
    LoadState::Failed {
        error: ErrorView {
            code: "NETWORK".into(),
            message: "network unreachable".into(),
            retryable: true,
            retry_after_ms: None,
        },
    }
}

// ---- Key capture. ----

fn key(source: &'static str) -> Capture {
    ptt_key_from(&Keystroke::parse(source).expect("keystroke"))
}

#[test]
fn a_keystroke_records_its_key_without_modifiers() {
    assert_eq!(key("f13"), Capture::Key("f13".into()));
    assert_eq!(key("shift-a"), Capture::Key("a".into()));
    assert_eq!(key("ctrl-alt-f5"), Capture::Key("f5".into()));
    assert_eq!(key("space"), Capture::Key("space".into()));
    assert_eq!(key("`"), Capture::Key("`".into()));
    assert_eq!(
        key("tab"),
        Capture::Key("tab".into()),
        "Tab is a key like any other"
    );
    assert_eq!(key("escape"), Capture::Cancel);
    assert_eq!(key("shift"), Capture::Ignore, "a modifier alone waits");
    assert_eq!(key("control"), Capture::Ignore);
}

#[test]
fn stored_keys_read_as_names() {
    assert_eq!(ptt_key_label("space"), "Space");
    assert_eq!(ptt_key_label("f13"), "F13");
    assert_eq!(
        ptt_key_label("F13"),
        "F13",
        "today's stored F13 still reads"
    );
    assert_eq!(ptt_key_label("`"), "`");
    assert_eq!(ptt_key_label("a"), "A");
    assert_eq!(ptt_key_label("tab"), "Tab");
    assert_eq!(ptt_key_label("pageup"), "Page Up");
}

// ---- Appearance. ----

#[test]
fn every_appearance_maps_to_its_theme() {
    let modes = [(ThemeMode::Dark, "dark"), (ThemeMode::Light, "light")];
    let intensities = [
        (ThemeIntensity::Minimal, "minimal"),
        (ThemeIntensity::Balanced, "balanced"),
        (ThemeIntensity::Vibrant, "vibrant"),
    ];
    let accents = [
        (AccentColor::Teal, "teal"),
        (AccentColor::Blue, "blue"),
        (AccentColor::Indigo, "indigo"),
        (AccentColor::Purple, "purple"),
        (AccentColor::Rose, "rose"),
        (AccentColor::Red, "red"),
        (AccentColor::Orange, "orange"),
        (AccentColor::Amber, "amber"),
        (AccentColor::Lime, "lime"),
        (AccentColor::Emerald, "emerald"),
        (AccentColor::Cyan, "cyan"),
        (AccentColor::Slate, "slate"),
    ];
    for (mode, mode_name) in modes {
        for (accent, accent_key) in accents {
            for (intensity, intensity_name) in intensities {
                let appearance = Appearance {
                    mode,
                    accent,
                    intensity,
                };
                assert_eq!(
                    theme_choice(appearance).name(),
                    format!("{mode_name}-{accent_key}-{intensity_name}")
                );
            }
        }
    }
    assert_eq!(theme_choice(Appearance::default()), ThemeChoice::default());
    assert_eq!(accent_name(AccentColor::Slate), "Slate Gray");
}

// ---- Voice and video, the pure parts. ----

fn device(id: &str, name: &str, is_default: bool) -> DeviceOption {
    DeviceOption {
        id: id.into(),
        name: name.into(),
        is_default,
    }
}

#[test]
fn device_rows_lead_with_the_default_and_keep_a_lost_device() {
    let devices = [
        device("a", "USB Audio", true),
        device("b", "USB Audio", false),
        device("c", "Headset", false),
    ];
    let rows = device_rows(&devices, None, "No devices found");
    let labels: Vec<&str> = rows.iter().map(|(label, _)| label.as_ref()).collect();
    assert_eq!(
        labels,
        [
            "System default",
            "USB Audio (default)",
            "USB Audio",
            "Headset"
        ]
    );
    assert_eq!(rows[0].1, None);
    assert_eq!(rows[2].1.as_deref(), Some("b"));

    let twins = [device("a", "Mic", false), device("b", "Mic", false)];
    let rows = device_rows(&twins, Some("gone"), "No devices found");
    let labels: Vec<&str> = rows.iter().map(|(label, _)| label.as_ref()).collect();
    assert_eq!(
        labels,
        [
            "System default",
            "Previously selected device (disconnected)",
            "Mic",
            "Mic (2)"
        ]
    );
    assert_eq!(rows[1].1.as_deref(), Some("gone"));

    assert_eq!(
        device_rows(&[], Some("gone"), "No devices found"),
        [("No devices found".into(), None)]
    );
}

#[test]
fn the_gate_opens_above_the_threshold() {
    assert!(transmitting(0.5, 30));
    assert!(!transmitting(0.3, 30));
    assert!(transmitting(0.01, 0));
    assert!(!transmitting(1.0, 100));
}

// ---- Sessions, the pure parts. ----

fn row(id: &str) -> SessionRow {
    SessionRow {
        id: id.into(),
        device_name: Some("Firefox on Linux".into()),
        ip_address: Some("203.0.113.9".into()),
        created_at_ms: NOW - 10 * DAY,
        last_used_at_ms: NOW - 5 * MIN,
        expires_at_ms: NOW + 20 * DAY,
        is_current: false,
        busy: false,
    }
}

#[test]
fn session_lines_read_against_the_clock() {
    let utc = crate::messages::TimeFormat::fixed(NOW);
    assert_eq!(
        session_details(&row("a"), &utc, NOW),
        [
            "Last active: 5 minutes ago",
            "IP: 203.0.113.9",
            "Signed in Oct 22, 2026 · Expires Nov 21, 2026"
        ]
    );
    let bare = SessionRow {
        device_name: Some("  ".into()),
        ip_address: None,
        last_used_at_ms: NOW - 3 * DAY,
        ..row("b")
    };
    assert_eq!(session_device_name(&bare), "Unknown device");
    assert_eq!(
        session_details(&bare, &utc, NOW),
        [
            "Last active: 3 days ago",
            "Signed in Oct 22, 2026 · Expires Nov 21, 2026"
        ]
    );
    assert_eq!(session_device_name(&row("c")), "Firefox on Linux");
}

#[test]
fn session_dates_are_written_in_the_users_zone() {
    use crate::messages::TimeFormat;
    use chrono::FixedOffset;

    // Zone minutes east of UTC, the instant, the local date, and the UTC date.
    let cases = [
        (9 * 60, 1_793_804_340_000, "Nov 4, 2026", "Nov 4, 2026"),
        (9 * 60, 1_793_804_460_000, "Nov 5, 2026", "Nov 4, 2026"),
        (-8 * 60, 1_793_865_540_000, "Nov 4, 2026", "Nov 5, 2026"),
        (-8 * 60, 1_793_865_660_000, "Nov 5, 2026", "Nov 5, 2026"),
        // 2026-12-31 15:30 UTC: New Year's Day in +09:00.
        (9 * 60, 1_798_731_000_000, "Jan 1, 2027", "Dec 31, 2026"),
        // 2026-11-05 18:31 UTC: 00:01 the 6th in +05:30.
        (5 * 60 + 30, 1_793_903_460_000, "Nov 6, 2026", "Nov 5, 2026"),
        // 2026-11-05 18:16 UTC: 00:01 the 6th in +05:45.
        (5 * 60 + 45, 1_793_902_560_000, "Nov 6, 2026", "Nov 5, 2026"),
    ];
    for (minutes, ms, local, utc_date) in cases {
        let zone = FixedOffset::east_opt(minutes * 60).expect("a zone");
        let zone_time = TimeFormat {
            zone: Some(zone),
            now: PanelClock::fixed(NOW),
        };
        let signed_in = SessionRow {
            created_at_ms: ms,
            expires_at_ms: ms,
            last_used_at_ms: NOW,
            ip_address: None,
            ..row("zone")
        };
        assert_eq!(
            session_details(&signed_in, &zone_time, NOW).last(),
            Some(&format!("Signed in {local} · Expires {local}")),
            "{minutes} minutes east"
        );
        assert_eq!(
            TimeFormat::fixed(NOW).format_at(ms, "%b %-d, %Y"),
            utc_date,
            "{minutes} minutes east: the UTC date"
        );
    }
}

#[test]
fn each_link_owner_reads_as_the_settings_row_says_it() {
    assert_eq!(LinkHandler::Registered.owner(), "This app");
    assert_eq!(LinkHandler::PackageOwned.owner(), "This app");
    assert_eq!(LinkHandler::AnotherApp.owner(), "Another app");
    assert_eq!(LinkHandler::NotRegistered.owner(), "Not registered");
    assert_eq!(LinkHandler::Unknown.owner(), "Couldn't tell");
    // The line under the switch says something only when there is more to say than the owner.
    assert_eq!(link_note(LinkHandler::Registered, true), None);
    assert!(link_note(LinkHandler::PackageOwned, true).is_some());
    assert!(
        link_note(LinkHandler::AnotherApp, true)
            .unwrap()
            .contains("takes them back")
    );
    assert!(link_note(LinkHandler::AnotherApp, false).is_some());
    assert!(link_note(LinkHandler::NotRegistered, true).is_some());
    assert!(link_note(LinkHandler::Unknown, false).is_some());
}

// ---- Voice and video in a window. ----

/// `dms::rig::rig`, but tall enough that the whole voice tab is on screen: a click needs its
/// target visible.
fn tall_rig<V, E>(
    cx: &mut TestAppContext,
    build: impl FnOnce(&mut Window, &mut Context<V>) -> V,
) -> Rig<V, E>
where
    V: Render + EventEmitter<E> + 'static,
    E: Clone + 'static,
{
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        crate::kit::set_reduced_motion(true, cx);
    });
    let events = Rc::new(RefCell::new(Vec::new()));
    let log = events.clone();
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Point::default(),
            size: size(px(900.), px(2400.)),
        })),
        ..Default::default()
    };
    let (window, view) = cx.update(|cx| {
        let mut made = None;
        let handle = gpui_kit::open_window(options, cx, |window, cx| {
            let view = cx.new(|cx| build(window, cx));
            cx.subscribe(&view, move |_, event: &E, _| {
                log.borrow_mut().push(event.clone());
            })
            .detach();
            made = Some(view.clone());
            view
        })
        .expect("window");
        (handle.0, made.expect("built"))
    });
    Rig {
        window,
        view,
        events,
    }
}

fn devices() -> DeviceLists {
    DeviceLists {
        state: LoadState::Ready,
        inputs: vec![
            device("mic-a", "Mic A", true),
            device("mic-b", "Mic B", false),
        ],
        outputs: vec![device("out-a", "Speakers", true)],
        cameras: vec![device("cam-a", "Webcam", true)],
    }
}

fn voice(
    cx: &mut TestAppContext,
    state: VoiceVideoState,
) -> Rig<VoiceVideoSettings, VoiceSettingsEvent> {
    tall_rig(cx, move |window, cx| {
        let mut voice = VoiceVideoSettings::new(window, cx);
        voice.set_devices(devices(), window, cx);
        voice.set_state(state, window, cx);
        voice
    })
}

fn last_state(rig: &Rig<VoiceVideoSettings, VoiceSettingsEvent>) -> VoiceVideoState {
    match rig.events().last() {
        Some(VoiceSettingsEvent::Changed(state)) => state.clone(),
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[gpui_kit::test]
fn each_voice_control_sends_the_new_state(cx: &mut TestAppContext) {
    let rig = voice(cx, VoiceVideoState::default());
    rig.click(cx, "voice-echo-cancellation");
    assert!(!last_state(&rig).processing.echo_cancellation);
    rig.click(cx, "voice-noise-suppression");
    assert!(!last_state(&rig).processing.noise_suppression);
    rig.click(cx, "voice-auto-gain");
    let state = last_state(&rig);
    assert!(!state.processing.auto_gain);
    assert!(
        !state.processing.echo_cancellation,
        "earlier changes carry on"
    );

    rig.click(cx, "voice-mode-push-to-talk");
    assert_eq!(last_state(&rig).input_mode, InputMode::PushToTalk);
    rig.click(cx, "voice-mode-voice-activity");
    assert_eq!(
        last_state(&rig).input_mode,
        InputMode::VoiceActivity { threshold: 0 }
    );

    rig.click(cx, "share-size-720");
    assert_eq!(last_state(&rig).share.resolution, ShareResolution::P720);
    rig.click(cx, "share-fps-60");
    assert_eq!(last_state(&rig).share.fps, 60);
    rig.click(cx, "share-audio");
    assert!(!last_state(&rig).share.audio);
    assert_eq!(rig.events().len(), 8, "one event a change");

    rig.clear();
    rig.click(cx, "share-fps-60");
    assert_eq!(
        rig.events(),
        [],
        "picking what's already chosen sends nothing"
    );
}

#[gpui_kit::test]
fn the_selects_and_the_slider_send_the_new_state(cx: &mut TestAppContext) {
    let rig = voice(cx, VoiceVideoState::default());
    rig.with(cx, |view, _, cx| {
        let quality = view.read(cx).quality.clone();
        quality.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Music (128 kbps)".into())))
        });
    });
    assert_eq!(last_state(&rig).mic_quality, MicQuality::Music);
    rig.with(cx, |view, _, cx| {
        let input = view.read(cx).input.clone();
        input.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Mic B".into())))
        });
    });
    assert_eq!(last_state(&rig).input_device.as_deref(), Some("mic-b"));
    rig.with(cx, |view, _, cx| {
        let input = view.read(cx).input.clone();
        input.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("System default".into())))
        });
    });
    assert_eq!(last_state(&rig).input_device, None);
    rig.with(cx, |view, _, cx| {
        let output = view.read(cx).output.clone();
        output.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Speakers (default)".into())))
        });
    });
    assert_eq!(last_state(&rig).output_device.as_deref(), Some("out-a"));
    rig.with(cx, |view, _, cx| {
        let camera = view.read(cx).camera.clone();
        camera.update(cx, |_, cx| {
            cx.emit(SelectEvent::Confirm(Some("Webcam (default)".into())))
        });
    });
    assert_eq!(last_state(&rig).camera.as_deref(), Some("cam-a"));
    rig.with(cx, |view, _, cx| {
        let slider = view.read(cx).threshold.clone();
        slider.update(cx, |_, cx| {
            cx.emit(SliderEvent::Change(SliderValue::Single(42.4)))
        });
    });
    assert_eq!(
        last_state(&rig).input_mode,
        InputMode::VoiceActivity { threshold: 42 }
    );
    // Push to talk keeps the threshold to go back to.
    rig.click(cx, "voice-mode-push-to-talk");
    rig.click(cx, "voice-mode-voice-activity");
    assert_eq!(
        last_state(&rig).input_mode,
        InputMode::VoiceActivity { threshold: 42 }
    );
}

#[gpui_kit::test]
fn the_buttons_ask_the_owner(cx: &mut TestAppContext) {
    let rig = voice(cx, VoiceVideoState::default());
    rig.click(cx, "voice-mic-test");
    rig.click(cx, "voice-test-sound");
    rig.click(cx, "voice-refresh-devices");
    assert!(
        !rig.has(cx, "voice-mic-meter"),
        "no meter until a level comes"
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |voice, cx| voice.set_mic_level(Some(0.5), cx))
    });
    assert!(rig.has(cx, "voice-mic-meter"));
    rig.click(cx, "voice-mic-test");
    assert_eq!(
        rig.events(),
        [
            VoiceSettingsEvent::StartMicTest,
            VoiceSettingsEvent::PlayTestSound,
            VoiceSettingsEvent::RefreshDevices,
            VoiceSettingsEvent::StopMicTest,
        ]
    );
}

#[gpui_kit::test]
fn failed_devices_offer_a_retry(cx: &mut TestAppContext) {
    let rig = tall_rig(cx, |window, cx| {
        let mut voice = VoiceVideoSettings::new(window, cx);
        voice.set_devices(
            DeviceLists {
                state: failed(),
                ..DeviceLists::default()
            },
            window,
            cx,
        );
        voice
    });
    rig.click(cx, "voice-devices-retry");
    assert_eq!(rig.events(), [VoiceSettingsEvent::RefreshDevices]);
}

// ---- Push-to-talk key capture in a window. ----

fn ptt(cx: &mut TestAppContext) -> Rig<VoiceVideoSettings, VoiceSettingsEvent> {
    voice(
        cx,
        VoiceVideoState {
            input_mode: InputMode::PushToTalk,
            ptt_key: Some("F13".into()),
            ..VoiceVideoState::default()
        },
    )
}

fn capturing(rig: &Rig<VoiceVideoSettings, VoiceSettingsEvent>, cx: &mut TestAppContext) -> bool {
    rig.with(cx, |view, _, cx| view.read(cx).is_capturing())
}

#[gpui_kit::test]
fn a_pressed_key_becomes_the_push_to_talk_key(cx: &mut TestAppContext) {
    let rig = ptt(cx);
    rig.click(cx, "voice-ptt-change");
    assert!(capturing(&rig, cx));
    // A modifier alone keeps waiting.
    cx.simulate_keystrokes(rig.window, "shift");
    assert!(capturing(&rig, cx));
    assert_eq!(rig.events(), []);
    cx.simulate_keystrokes(rig.window, "f14");
    assert!(!capturing(&rig, cx), "back to idle");
    let state = last_state(&rig);
    assert_eq!(state.ptt_key.as_deref(), Some("f14"));
    assert_eq!(state.input_mode, InputMode::PushToTalk);
    assert_eq!(rig.events().len(), 1);
}

#[gpui_kit::test]
fn escape_and_blur_cancel_the_capture(cx: &mut TestAppContext) {
    let rig = ptt(cx);
    // Focus events only reach a window the platform says is active.
    rig.with(cx, |_, window, _| window.activate_window());
    rig.click(cx, "voice-ptt-change");
    cx.simulate_keystrokes(rig.window, "escape");
    assert!(!capturing(&rig, cx));
    rig.click(cx, "voice-ptt-change");
    assert!(capturing(&rig, cx));
    rig.with(cx, |_, window, cx| window.blur(cx));
    assert!(!capturing(&rig, cx), "losing focus cancels");
    rig.click(cx, "voice-ptt-change");
    rig.click(cx, "voice-ptt-change");
    assert!(!capturing(&rig, cx), "Cancel cancels");
    assert_eq!(rig.events(), [], "nothing changed");
    assert_eq!(
        rig.with(cx, |view, _, cx| view.read(cx).state().ptt_key.clone()),
        Some("F13".into())
    );
}

// ---- Appearance in a window. ----

fn appearance(
    cx: &mut TestAppContext,
    state: LoadState,
) -> Rig<AppearanceSettings, AppearanceEvent> {
    rig(cx, 900., move |_, cx| {
        let mut settings = AppearanceSettings::new(cx);
        settings.set_view(
            AppearanceView {
                state,
                appearance: Appearance::default(),
            },
            cx,
        );
        settings
    })
}

#[gpui_kit::test]
fn each_appearance_pick_goes_out_at_once(cx: &mut TestAppContext) {
    let rig = appearance(cx, LoadState::Ready);
    rig.click(cx, "appearance-dark");
    rig.click(cx, "appearance-accent-amber");
    rig.click(cx, "appearance-intensity-vibrant");
    assert_eq!(
        rig.events(),
        [
            AppearanceEvent::Update(AppearancePatch {
                mode: Some(ThemeMode::Light),
                ..AppearancePatch::default()
            }),
            AppearanceEvent::Update(AppearancePatch {
                accent: Some(AccentColor::Amber),
                ..AppearancePatch::default()
            }),
            AppearanceEvent::Update(AppearancePatch {
                intensity: Some(ThemeIntensity::Vibrant),
                ..AppearancePatch::default()
            }),
        ]
    );
    assert!(rig.has(cx, "appearance-preview"));
}

#[gpui_kit::test]
fn failed_appearance_offers_a_retry(cx: &mut TestAppContext) {
    let rig = appearance(cx, failed());
    assert!(!rig.has(cx, "appearance-dark"));
    rig.click(cx, "appearance-retry");
    assert_eq!(rig.events(), [AppearanceEvent::Retry]);
}

// ---- Sessions in a window. ----

fn sessions(cx: &mut TestAppContext, view: SessionsView) -> Rig<SessionsSettings, SessionsEvent> {
    rig(cx, 900., move |_, cx| {
        let mut settings = SessionsSettings::new(cx);
        settings.set_clock(PanelClock::fixed(NOW), cx);
        settings.set_view(view, cx);
        settings
    })
}

fn session_view() -> SessionsView {
    SessionsView {
        state: LoadState::Ready,
        sessions: vec![
            SessionRow {
                is_current: true,
                ..row("here")
            },
            row("phone"),
            SessionRow {
                busy: true,
                ..row("laptop")
            },
        ],
        revoking_others: false,
    }
}

#[gpui_kit::test]
fn only_other_sessions_can_be_revoked(cx: &mut TestAppContext) {
    let rig = sessions(cx, session_view());
    assert!(rig.has(cx, "session-here"));
    assert!(
        !rig.has(cx, "session-revoke-here"),
        "the current one has no revoke"
    );
    assert!(
        !rig.has(cx, "session-revoke-laptop"),
        "a busy one shows a spinner"
    );
    assert!(rig.has(cx, "session-busy-laptop"));
    rig.click(cx, "session-revoke-phone");
    assert_eq!(
        rig.events(),
        [SessionsEvent::Revoke {
            session_id: "phone".into()
        }]
    );
}

#[gpui_kit::test]
fn signing_out_the_others_asks_first(cx: &mut TestAppContext) {
    let rig = sessions(cx, session_view());
    rig.click(cx, "sessions-revoke-others");
    assert!(rig.has(cx, "sessions-confirm-revoke"), "a confirm opens");
    assert_eq!(rig.events(), [], "nothing until it's confirmed");
    rig.click(cx, "sessions-confirm-cancel");
    assert!(!rig.has(cx, "sessions-confirm-revoke"));
    assert_eq!(rig.events(), []);
    rig.click(cx, "sessions-revoke-others");
    rig.click(cx, "sessions-confirm-revoke");
    assert!(
        !rig.has(cx, "sessions-confirm-revoke"),
        "the confirm closes"
    );
    assert_eq!(rig.events(), [SessionsEvent::RevokeOthers]);
}

#[gpui_kit::test]
fn sign_out_all_is_hidden_with_only_this_session(cx: &mut TestAppContext) {
    let view = SessionsView {
        sessions: vec![SessionRow {
            is_current: true,
            ..row("here")
        }],
        ..session_view()
    };
    let rig = sessions(cx, view);
    assert!(rig.has(cx, "session-here"));
    assert!(!rig.has(cx, "sessions-revoke-others"));
}

#[gpui_kit::test]
fn failed_sessions_offer_a_retry(cx: &mut TestAppContext) {
    let rig = sessions(
        cx,
        SessionsView {
            state: failed(),
            ..SessionsView::default()
        },
    );
    rig.click(cx, "sessions-retry");
    assert_eq!(rig.events(), [SessionsEvent::Retry]);
}

// ---- Desktop app in a window. ----

fn desktop_state(links: LinkHandler, open_links: bool) -> DesktopAppState {
    DesktopAppState {
        close_to_tray: true,
        open_links,
        links,
        link_preview_images: false,
        server_url: "https://chat.example.org".into(),
        server_name: None,
        app_version: "0.9.0".into(),
        server_version: None,
        links_note: None,
        links_blocked: None,
        update_enabled: true,
        log_folder: true,
        ..DesktopAppState::default()
    }
}

fn desktop(
    cx: &mut TestAppContext,
    links: LinkHandler,
) -> Rig<DesktopAppSettings, DesktopAppEvent> {
    desktop_with(cx, desktop_state(links, true))
}

fn desktop_with(
    cx: &mut TestAppContext,
    state: DesktopAppState,
) -> Rig<DesktopAppSettings, DesktopAppEvent> {
    rig(cx, 900., move |_, cx| {
        let mut settings = DesktopAppSettings::new(cx);
        settings.set_state(state, cx);
        settings
    })
}

#[gpui_kit::test]
fn each_desktop_control_sends_its_event(cx: &mut TestAppContext) {
    let rig = desktop(cx, LinkHandler::NotRegistered);
    rig.click(cx, "desktop-close-to-tray");
    rig.click(cx, "desktop-open-links");
    rig.click(cx, "desktop-link-preview-images");
    rig.click(cx, "desktop-change-server");
    rig.click(cx, "desktop-check-updates");
    rig.click(cx, "desktop-open-logs");
    assert_eq!(
        rig.events(),
        [
            DesktopAppEvent::SetCloseToTray(false),
            DesktopAppEvent::SetOpenLinks(false),
            DesktopAppEvent::SetLinkPreviewImages(true),
            DesktopAppEvent::ChangeServer,
            DesktopAppEvent::CheckForUpdates,
            DesktopAppEvent::OpenLogFolder,
        ]
    );
}

#[gpui_kit::test]
fn the_links_switch_shows_the_owner_for_each_state(cx: &mut TestAppContext) {
    for (links, open_links, owner) in [
        (LinkHandler::Registered, true, "This app"),
        (LinkHandler::PackageOwned, true, "This app"),
        (LinkHandler::AnotherApp, true, "Another app"),
        (LinkHandler::NotRegistered, false, "Not registered"),
        (LinkHandler::Unknown, false, "Couldn't tell"),
    ] {
        use gpui_kit::test::TestQueryExt as _;
        let rig = desktop_with(cx, desktop_state(links, open_links));
        assert!(rig.has(cx, "desktop-open-links"), "{links:?}");
        assert!(rig.has(cx, "desktop-link-owner"), "{links:?}");
        let label = format!("Opens semaphore:// links: {owner}");
        let found = rig.with(cx, |_, window, _| {
            !window.find_all_by_label(&label).is_empty()
        });
        assert!(found, "{links:?}: {label}");
    }
}

#[gpui_kit::test]
fn a_blocked_machine_has_the_switch_off_and_clicking_it_does_nothing(cx: &mut TestAppContext) {
    let mut state = desktop_state(LinkHandler::NotRegistered, false);
    state.links_blocked = Some("Turned off on this computer".into());
    let rig = desktop_with(cx, state);
    rig.click(cx, "desktop-open-links");
    assert!(rig.events().is_empty(), "{:?}", rig.events());
}

// ---- The shell. ----

fn shell(cx: &mut TestAppContext, width: f32) -> Rig<SettingsScreen, SettingsShellEvent> {
    rig(cx, width, SettingsScreen::new)
}

#[gpui_kit::test]
fn the_nav_switches_tabs(cx: &mut TestAppContext) {
    let rig = shell(cx, 1280.);
    assert!(
        rig.has(cx, "notification-settings"),
        "opens on Notifications"
    );
    rig.click(cx, "settings-tab-voice");
    assert!(rig.has(cx, "voice-settings"));
    assert!(!rig.has(cx, "notification-settings"));
    rig.click(cx, "settings-tab-appearance");
    assert!(rig.has(cx, "appearance-settings"));
    rig.click(cx, "settings-tab-sessions");
    assert!(rig.has(cx, "sessions-settings"));
    rig.click(cx, "settings-tab-desktop");
    assert!(rig.has(cx, "desktop-settings"));
    rig.click(cx, "settings-close");
    assert_eq!(
        rig.events(),
        [
            SettingsShellEvent::TabChanged(SettingsTab::VoiceVideo),
            SettingsShellEvent::TabChanged(SettingsTab::Appearance),
            SettingsShellEvent::TabChanged(SettingsTab::Sessions),
            SettingsShellEvent::TabChanged(SettingsTab::DesktopApp),
            SettingsShellEvent::Close,
        ]
    );
    // The route's own tab changes what shows, without an event.
    rig.clear();
    rig.with(cx, |view, _, cx| {
        view.update(cx, |screen, cx| {
            screen.set_tab(SettingsTab::Notifications, cx)
        })
    });
    assert!(rig.has(cx, "notification-settings"));
    assert_eq!(rig.events(), []);
}

#[gpui_kit::test]
fn a_phone_taps_into_a_tab_and_back(cx: &mut TestAppContext) {
    let rig = shell(cx, 390.);
    assert!(rig.has(cx, "settings-tab-sessions"), "the list first");
    assert!(!rig.has(cx, "notification-settings"));
    rig.click(cx, "settings-tab-sessions");
    assert!(rig.has(cx, "sessions-settings"));
    assert!(!rig.has(cx, "settings-tab-voice"), "the list gives way");
    rig.click(cx, "settings-back");
    assert!(rig.has(cx, "settings-tab-voice"), "back to the list");
    assert!(!rig.has(cx, "sessions-settings"));
    assert_eq!(
        rig.events(),
        [SettingsShellEvent::TabChanged(SettingsTab::Sessions)]
    );
    // A route straight to a tab opens it.
    rig.with(cx, |view, _, cx| {
        view.update(cx, |screen, cx| screen.set_tab(SettingsTab::VoiceVideo, cx))
    });
    assert!(rig.has(cx, "voice-settings"));
    assert!(rig.has(cx, "settings-back"));
}
