//! The settings stories: the shell on each tab and the phone list, then each tab on its own in the
//! states it can be in. `rigs/shot/scripts/w3-settings.steps` renders them all.

use super::{
    AppearanceSettings, DesktopAppSettings, DesktopAppState, DeviceLists, DeviceOption, InputMode,
    LinkHandler, SessionsSettings, SettingsScreen, SettingsTab, VoiceLimits, VoiceVideoSettings,
    VoiceVideoState,
};
use crate::dms::stories::failed;
use crate::kit::Severity;
use crate::messages::fixture::NOW_MS;
use crate::panel::PanelClock;
use crate::stories::Story;
use gpui_kit::*;
use semaphore_core::model::{
    AccentColor, Appearance, AppearanceView, LoadState, NotificationSettings,
    NotificationSettingsView, SessionRow, SessionsView, ThemeIntensity, ThemeMode,
};

const MIN: i64 = 60 * 1000;
const DAY: i64 = 24 * 60 * MIN;

fn device(id: &str, name: &str, is_default: bool) -> DeviceOption {
    DeviceOption {
        id: id.into(),
        name: name.into(),
        is_default,
    }
}

pub(crate) fn sample_devices() -> DeviceLists {
    DeviceLists {
        state: LoadState::Ready,
        inputs: vec![
            device("mic-builtin", "Built-in Microphone", true),
            device("mic-yeti", "Blue Yeti USB Microphone", false),
        ],
        outputs: vec![
            device("out-builtin", "Built-in Speakers", true),
            device("out-xm5", "WH-1000XM5", false),
        ],
        cameras: vec![device("cam-integrated", "Integrated Camera", true)],
    }
}

fn long_devices() -> DeviceLists {
    let long = |id: &str, prefix: &str| {
        device(
            id,
            &format!(
                "{prefix} Family 17h/19h HD Audio Controller Analog Stereo Duplex (USB Composite Device, Rear Panel)"
            ),
            false,
        )
    };
    DeviceLists {
        state: LoadState::Ready,
        inputs: vec![long("mic-long", "Advanced Micro Devices, Inc. [AMD]")],
        outputs: vec![long("out-long", "Advanced Micro Devices, Inc. [AMD]")],
        cameras: vec![long("cam-long", "Logitech BRIO Ultra HD Pro Webcam")],
    }
}

pub(crate) fn sample_voice() -> VoiceVideoState {
    VoiceVideoState {
        input_device: Some("mic-yeti".into()),
        input_mode: InputMode::VoiceActivity { threshold: 30 },
        ..VoiceVideoState::default()
    }
}

fn voice_story(
    state: VoiceVideoState,
    devices: DeviceLists,
    level: Option<f32>,
    window: &mut Window,
    cx: &mut App,
) -> AnyView {
    cx.new(|cx| {
        let mut voice = VoiceVideoSettings::new(window, cx);
        voice.set_devices(devices, window, cx);
        voice.set_state(state, window, cx);
        voice.set_mic_level(level, cx);
        voice
    })
    .into()
}

fn appearance_view(
    mode: ThemeMode,
    accent: AccentColor,
    intensity: ThemeIntensity,
) -> AppearanceView {
    AppearanceView {
        state: LoadState::Ready,
        appearance: Appearance {
            mode,
            accent,
            intensity,
        },
    }
}

fn appearance_story(view: AppearanceView, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut settings = AppearanceSettings::new(cx);
        settings.set_view(view, cx);
        settings
    })
    .into()
}

fn session(id: &str, name: Option<&str>, ip: Option<&str>, used_ago: i64) -> SessionRow {
    SessionRow {
        id: id.into(),
        device_name: name.map(str::to_owned),
        ip_address: ip.map(str::to_owned),
        created_at_ms: NOW_MS - 20 * DAY,
        last_used_at_ms: NOW_MS - used_ago,
        expires_at_ms: NOW_MS + 10 * DAY,
        is_current: false,
        busy: false,
    }
}

fn current() -> SessionRow {
    SessionRow {
        is_current: true,
        ..session(
            "s-here",
            Some("Semaphore Desktop on Linux"),
            Some("192.168.1.20"),
            10_000,
        )
    }
}

pub(crate) fn sample_sessions() -> SessionsView {
    SessionsView {
        state: LoadState::Ready,
        sessions: vec![
            current(),
            session(
                "s-phone",
                Some("Chrome on Android"),
                Some("10.0.0.7"),
                5 * MIN,
            ),
            session(
                "s-laptop",
                Some("Firefox on macOS"),
                Some("203.0.113.9"),
                3 * DAY,
            ),
            session("s-unknown", None, None, 40 * DAY),
        ],
        revoking_others: false,
    }
}

fn many_sessions() -> SessionsView {
    let mut view = sample_sessions();
    for index in 0..10 {
        view.sessions.push(session(
            &format!("s-long-{index}"),
            Some(&format!(
                "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0 Developer Edition Nightly Build {index}"
            )),
            Some("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
            (index + 1) * 7 * DAY,
        ));
    }
    view
}

fn sessions_story(view: SessionsView, notice: Option<(Severity, String)>, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut settings = SessionsSettings::new(cx);
        settings.set_clock(PanelClock::fixed(NOW_MS), cx);
        settings.set_time(crate::messages::TimeFormat::fixed(NOW_MS), cx);
        settings.set_view(view, cx);
        settings.set_notice(notice, cx);
        settings
    })
    .into()
}

pub(crate) fn sample_desktop(links: LinkHandler) -> DesktopAppState {
    DesktopAppState {
        close_to_tray: true,
        links,
        link_preview_images: false,
        server_url: "https://chat.example.org".into(),
        server_name: Some("Example Community".into()),
        app_version: "0.9.0".into(),
        server_version: Some("0.8.2".into()),
        links_note: None,
        links_blocked: None,
        update: crate::update::UpdateStatus::UpToDate,
        update_enabled: true,
        update_note: None,
        log_folder: true,
    }
}

fn desktop_story(state: DesktopAppState, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut settings = DesktopAppSettings::new(cx);
        settings.set_state(state, cx);
        settings
    })
    .into()
}

/// The shell with every tab fed; `tab: None` leaves it as it opens (on a phone, the list).
fn shell_story(tab: Option<SettingsTab>, window: &mut Window, cx: &mut App) -> AnyView {
    cx.new(|cx| {
        let mut screen = SettingsScreen::new(window, cx);
        screen.notifications().update(cx, |section, cx| {
            section.set_view(
                NotificationSettingsView {
                    state: LoadState::Ready,
                    settings: NotificationSettings::default(),
                },
                window,
                cx,
            )
        });
        screen.voice().update(cx, |voice, cx| {
            voice.set_devices(sample_devices(), window, cx);
            voice.set_state(sample_voice(), window, cx);
        });
        screen.appearance().update(cx, |settings, cx| {
            settings.set_view(
                appearance_view(ThemeMode::Dark, AccentColor::Blue, ThemeIntensity::Balanced),
                cx,
            )
        });
        screen.sessions().update(cx, |settings, cx| {
            settings.set_clock(PanelClock::fixed(NOW_MS), cx);
            settings.set_time(crate::messages::TimeFormat::fixed(NOW_MS), cx);
            settings.set_view(sample_sessions(), cx);
        });
        screen.desktop().update(cx, |settings, cx| {
            settings.set_state(sample_desktop(LinkHandler::NotRegistered), cx)
        });
        if let Some(tab) = tab {
            screen.set_tab(tab, cx);
        }
        screen
    })
    .into()
}

pub fn stories() -> Vec<Story> {
    vec![
        // The shell.
        Story::new("settings-shell-notifications", |_, window, cx| {
            shell_story(Some(SettingsTab::Notifications), window, cx)
        }),
        Story::new("settings-shell-voice", |_, window, cx| {
            shell_story(Some(SettingsTab::VoiceVideo), window, cx)
        }),
        Story::new("settings-shell-appearance", |_, window, cx| {
            shell_story(Some(SettingsTab::Appearance), window, cx)
        }),
        Story::new("settings-shell-sessions", |_, window, cx| {
            shell_story(Some(SettingsTab::Sessions), window, cx)
        }),
        Story::new("settings-shell-desktop", |_, window, cx| {
            shell_story(Some(SettingsTab::DesktopApp), window, cx)
        }),
        Story::new("settings-shell-phone-list", |_, window, cx| {
            shell_story(None, window, cx)
        }),
        // Voice and video.
        Story::new("settings-voice-transmitting", |_, window, cx| {
            voice_story(sample_voice(), sample_devices(), Some(0.62), window, cx)
        }),
        Story::new("settings-voice-gated", |_, window, cx| {
            voice_story(sample_voice(), sample_devices(), Some(0.12), window, cx)
        }),
        Story::new("settings-voice-ptt", |_, window, cx| {
            let state = VoiceVideoState {
                input_mode: InputMode::PushToTalk,
                ptt_key: None,
                ..sample_voice()
            };
            voice_story(state, sample_devices(), None, window, cx)
        }),
        Story::new("settings-voice-ptt-key", |_, window, cx| {
            let state = VoiceVideoState {
                input_mode: InputMode::PushToTalk,
                ptt_key: Some("F13".into()),
                ..sample_voice()
            };
            voice_story(state, sample_devices(), Some(0.9), window, cx)
        }),
        // What the desktop build says today: no mic test, and push to talk only from the bar.
        Story::new("settings-voice-limited", |_, window, cx| {
            let state = VoiceVideoState {
                input_mode: InputMode::PushToTalk,
                ptt_key: Some("f13".into()),
                ..sample_voice()
            };
            let view = voice_story(state, sample_devices(), None, window, cx);
            if let Ok(voice) = view.clone().downcast::<VoiceVideoSettings>() {
                voice.update(cx, |voice, cx| {
                    voice.set_limits(
                        VoiceLimits {
                            mic_test: Some("Testing the microphone isn't available in this version yet.".into()),
                            push_to_talk: Some("The key is saved, but this version doesn't listen for it yet: hold the voice bar's Push to Talk button to transmit.".into()),
                        },
                        cx,
                    )
                });
            }
            view
        }),
        Story::new("settings-voice-devices-loading", |_, window, cx| {
            voice_story(sample_voice(), DeviceLists::default(), None, window, cx)
        }),
        Story::new("settings-voice-devices-failed", |_, window, cx| {
            let devices = DeviceLists {
                state: failed(),
                ..DeviceLists::default()
            };
            voice_story(sample_voice(), devices, None, window, cx)
        }),
        Story::new("settings-voice-no-devices", |_, window, cx| {
            let devices = DeviceLists {
                state: LoadState::Ready,
                ..DeviceLists::default()
            };
            voice_story(VoiceVideoState::default(), devices, None, window, cx)
        }),
        Story::new("settings-voice-long-devices", |_, window, cx| {
            let state = VoiceVideoState {
                input_device: Some("mic-long".into()),
                output_device: Some("out-gone".into()),
                camera: Some("cam-long".into()),
                ..sample_voice()
            };
            voice_story(state, long_devices(), None, window, cx)
        }),
        // Appearance.
        Story::new("settings-appearance-dark", |_, _, cx| {
            appearance_story(
                appearance_view(ThemeMode::Dark, AccentColor::Teal, ThemeIntensity::Minimal),
                cx,
            )
        }),
        Story::new("settings-appearance-light", |_, _, cx| {
            appearance_story(
                appearance_view(ThemeMode::Light, AccentColor::Rose, ThemeIntensity::Minimal),
                cx,
            )
        }),
        Story::new("settings-appearance-balanced", |_, _, cx| {
            appearance_story(
                appearance_view(
                    ThemeMode::Dark,
                    AccentColor::Indigo,
                    ThemeIntensity::Balanced,
                ),
                cx,
            )
        }),
        Story::new("settings-appearance-vibrant", |_, _, cx| {
            appearance_story(
                appearance_view(
                    ThemeMode::Light,
                    AccentColor::Amber,
                    ThemeIntensity::Vibrant,
                ),
                cx,
            )
        }),
        Story::new("settings-appearance-loading", |_, _, cx| {
            appearance_story(AppearanceView::default(), cx)
        }),
        Story::new("settings-appearance-failed", |_, _, cx| {
            appearance_story(
                AppearanceView {
                    state: failed(),
                    ..AppearanceView::default()
                },
                cx,
            )
        }),
        // Sessions.
        Story::new("settings-sessions-loading", |_, _, cx| {
            sessions_story(SessionsView::default(), None, cx)
        }),
        Story::new("settings-sessions-failed", |_, _, cx| {
            let view = SessionsView {
                state: failed(),
                ..SessionsView::default()
            };
            sessions_story(view, None, cx)
        }),
        Story::new("settings-sessions-empty", |_, _, cx| {
            let view = SessionsView {
                state: LoadState::Ready,
                ..SessionsView::default()
            };
            sessions_story(view, None, cx)
        }),
        Story::new("settings-sessions-only-current", |_, _, cx| {
            let view = SessionsView {
                state: LoadState::Ready,
                sessions: vec![current()],
                revoking_others: false,
            };
            sessions_story(view, None, cx)
        }),
        Story::new("settings-sessions-list", |_, _, cx| {
            sessions_story(sample_sessions(), None, cx)
        }),
        Story::new("settings-sessions-many", |_, _, cx| {
            sessions_story(many_sessions(), None, cx)
        }),
        Story::new("settings-sessions-busy", |_, _, cx| {
            let mut view = sample_sessions();
            view.sessions[1].busy = true;
            sessions_story(view, None, cx)
        }),
        Story::new("settings-sessions-revoking", |_, _, cx| {
            let view = SessionsView {
                revoking_others: true,
                ..sample_sessions()
            };
            sessions_story(view, None, cx)
        }),
        Story::new("settings-sessions-notice", |_, _, cx| {
            let view = SessionsView {
                state: LoadState::Ready,
                sessions: vec![current()],
                revoking_others: false,
            };
            sessions_story(
                view,
                Some((Severity::Success, "Signed out 3 other devices".into())),
                cx,
            )
        }),
        Story::new("settings-sessions-notice-failed", |_, _, cx| {
            sessions_story(
                sample_sessions(),
                Some((
                    Severity::Error,
                    "Couldn't sign out the other devices".into(),
                )),
                cx,
            )
        }),
        // Desktop app.
        Story::new("settings-desktop-registered", |_, _, cx| {
            desktop_story(sample_desktop(LinkHandler::Registered), cx)
        }),
        Story::new("settings-desktop-not-registered", |_, _, cx| {
            desktop_story(sample_desktop(LinkHandler::NotRegistered), cx)
        }),
        Story::new("settings-desktop-package-owned", |_, _, cx| {
            desktop_story(sample_desktop(LinkHandler::PackageOwned), cx)
        }),
        Story::new("settings-desktop-dev-build", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    links_note: Some("This is a development build: registering takes semaphore:// links away from an installed Semaphore app.".into()),
                    ..sample_desktop(LinkHandler::NotRegistered)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-links-blocked", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    links_blocked: Some(
                        "Turned off for this computer (SEMAPHORE_REGISTER_SCHEME=0).".into(),
                    ),
                    ..sample_desktop(LinkHandler::NotRegistered)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-update-available", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    update: crate::update::UpdateStatus::Available {
                        version: "1.4.0".into(),
                        notes_url: Some(
                            "https://github.com/semaphore-chat/semaphore-chat/releases/tag/v1.4.0"
                                .into(),
                        ),
                    },
                    ..sample_desktop(LinkHandler::PackageOwned)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-update-downloading", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    update: crate::update::UpdateStatus::Downloading {
                        received: 12_138_288,
                        total: 30_345_720,
                    },
                    ..sample_desktop(LinkHandler::PackageOwned)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-update-checking", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    update: crate::update::UpdateStatus::Checking,
                    ..sample_desktop(LinkHandler::PackageOwned)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-update-ready", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    update: crate::update::UpdateStatus::Ready {
                        version: "1.4.0".into(),
                        how: crate::update::ReadyHow::Package {
                            command: "sudo apt install '/home/mike/.cache/semaphore/updates/semaphore-chat-native_1.4.0_amd64.deb'".into(),
                        },
                    },
                    ..sample_desktop(LinkHandler::PackageOwned)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-update-failed", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    update: crate::update::UpdateStatus::Failed {
                        message:
                            "The download didn't match the release's SHA-256, so it was discarded."
                                .into(),
                        retryable: true,
                    },
                    ..sample_desktop(LinkHandler::PackageOwned)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-update-off", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    update: crate::update::UpdateStatus::Unknown,
                    update_enabled: false,
                    update_note: Some("This build has no update feed.".into()),
                    ..sample_desktop(LinkHandler::PackageOwned)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-update-dev-build", |_, _, cx| {
            desktop_story(
                DesktopAppState {
                    update: crate::update::UpdateStatus::Unknown,
                    update_enabled: false,
                    update_note: Some(
                        "Updates aren't available for the way this copy was installed.".into(),
                    ),
                    ..sample_desktop(LinkHandler::NotRegistered)
                },
                cx,
            )
        }),
        Story::new("settings-desktop-log-folder", |_, _, cx| {
            desktop_story(sample_desktop(LinkHandler::Registered), cx)
        }),
        Story::new("settings-desktop-unknown", |_, _, cx| {
            let state = DesktopAppState {
                server_name: None,
                server_version: None,
                link_preview_images: true,
                close_to_tray: false,
                server_url: "https://a-very-long-self-hosted-server-name.chat.example-community.org:8443/semaphore".into(),
                ..sample_desktop(LinkHandler::Unknown)
            };
            desktop_story(state, cx)
        }),
    ]
}
