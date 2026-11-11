//! The voice debug panel: the web's `VoiceDebugPanel.tsx`, fed by core's `VoiceDiagnosticsView` and
//! the call's `VoiceView`. The web's LiveKit internals (subscription states, attached elements,
//! force resubscribe) have no native counterpart and are left out.
//!
//! The owner shows it over the top-right of the window (full width on a phone), toggled by
//! Ctrl+Shift+D as on the web, refreshes the numbers with `Core::refresh_voice_diagnostics` and
//! copies the report (`Core::voice_diagnostics_report`, coming) to the clipboard on "Copy report".

use crate::kit::{Button, ButtonSize, Icon, IconButton, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    ConnectionQuality, JoinFailureClass, ParticipantView, VoiceDiagnosticsView, VoiceStatus,
    VoiceView,
};
use semaphore_design::Icon as IconName;
use std::rc::Rc;

type Action = Rc<dyn Fn(&mut Window, &mut App)>;

pub struct DebugActions {
    pub on_refresh: Action,
    /// "Copy report": the owner puts core's report on the clipboard.
    pub on_copy: Action,
    pub on_close: Action,
}

/// The newest events this shows; the report has the rest.
pub const EVENTS_SHOWN: usize = 50;

pub fn status_label(status: VoiceStatus) -> &'static str {
    match status {
        VoiceStatus::Disconnected => "Disconnected",
        VoiceStatus::Connecting => "Connecting",
        VoiceStatus::Connected => "Connected",
        VoiceStatus::Reconnecting => "Reconnecting",
    }
}

pub fn failure_label(class: JoinFailureClass) -> &'static str {
    match class {
        JoinFailureClass::MediaUnreachable => "Media server unreachable",
        JoinFailureClass::ServerUnreachable => "Server unreachable",
        JoinFailureClass::Permission => "Not allowed",
        JoinFailureClass::NotFound => "Not found",
        JoinFailureClass::Session => "Session expired",
        JoinFailureClass::ServerError => "Server error",
        JoinFailureClass::Unknown => "Unknown",
    }
}

fn quality_label(quality: ConnectionQuality) -> &'static str {
    match quality {
        ConnectionQuality::Unknown => "unknown",
        ConnectionQuality::Excellent => "excellent",
        ConnectionQuality::Good => "good",
        ConnectionQuality::Poor => "poor",
        ConnectionQuality::Lost => "lost",
    }
}

/// `HH:MM:SS` of a wall-clock time, UTC, as the event log shows it.
pub fn clock(at_ms: u64) -> String {
    let seconds = at_ms / 1000;
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600 % 24,
        seconds / 60 % 60,
        seconds % 60
    )
}

#[derive(Clone, Copy)]
enum Tone {
    Neutral,
    Good,
    Warn,
    Bad,
}

fn chip(label: impl Into<SharedString>, tone: Tone, cx: &App) -> impl IntoElement {
    let sem = cx.sem();
    let (bg, fg) = match tone {
        Tone::Neutral => (sem.chip_bg, sem.chip_text),
        Tone::Good => (sem.success.opacity(0.16), sem.success),
        Tone::Warn => (sem.warning.opacity(0.16), sem.warning),
        Tone::Bad => (sem.error.opacity(0.16), sem.error),
    };
    div()
        .flex_shrink_0()
        .h(px(22.))
        .px(px(8.))
        .rounded_full()
        .flex()
        .items_center()
        .bg(bg)
        .text_color(fg)
        .text_size(px(12.))
        .font_weight(FontWeight::MEDIUM)
        .child(label.into())
}

fn section(title: impl Into<SharedString>, cx: &App) -> Div {
    let sem = cx.sem();
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .pt(px(12.))
        .mt(px(12.))
        .border_t_1()
        .border_color(sem.divider)
        .child(text(Variant::Subtitle2, title.into()).text_color(sem.text_secondary))
}

fn chips() -> Div {
    div().flex().flex_wrap().gap(px(4.))
}

fn row(label: &'static str, value: impl Into<SharedString>, cx: &App) -> impl IntoElement {
    let sem = cx.sem();
    div()
        .flex()
        .gap(px(8.))
        .child(
            text(Variant::Body2, label)
                .w(px(120.))
                .flex_shrink_0()
                .text_color(sem.text_secondary),
        )
        .child(
            text(Variant::Body2, value.into())
                .flex_1()
                .min_w_0()
                .text_color(sem.text_primary),
        )
}

fn participant(person: &ParticipantView, cx: &App) -> impl IntoElement {
    let sem = cx.sem();
    let name = person
        .user
        .display_name
        .clone()
        .unwrap_or_else(|| person.user.username.clone());
    let quality_tone = match person.quality {
        ConnectionQuality::Excellent | ConnectionQuality::Good => Tone::Good,
        ConnectionQuality::Poor => Tone::Warn,
        ConnectionQuality::Lost => Tone::Bad,
        ConnectionQuality::Unknown => Tone::Neutral,
    };
    div()
        .flex()
        .flex_col()
        .gap(px(4.))
        .p(px(8.))
        .rounded(px(4.))
        .bg(sem.action_hover)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .child(
                    text(
                        Variant::Body2,
                        if person.is_self {
                            format!("{name} (You)")
                        } else {
                            name
                        },
                    )
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(sem.text_primary)
                    .min_w_0()
                    .truncate(),
                )
                .child(chip(quality_label(person.quality), quality_tone, cx)),
        )
        .child(
            text(Variant::Caption, person.identity.clone())
                .text_color(sem.text_secondary)
                .truncate(),
        )
        .child(
            chips()
                .child(if person.speaking {
                    chip("speaking", Tone::Good, cx).into_any_element()
                } else {
                    chip("silent", Tone::Neutral, cx).into_any_element()
                })
                .when(person.muted, |chips| {
                    chips.child(chip("muted", Tone::Neutral, cx))
                })
                .when(person.server_muted, |chips| {
                    chips.child(chip("server muted", Tone::Bad, cx))
                })
                .when(person.deafened, |chips| {
                    chips.child(chip("deafened", Tone::Neutral, cx))
                })
                .when(person.camera.is_some(), |chips| {
                    chips.child(chip("camera", Tone::Neutral, cx))
                })
                .when(person.screen_share.is_some(), |chips| {
                    chips.child(chip("screen", Tone::Neutral, cx))
                }),
        )
}

pub fn voice_debug_panel(
    diagnostics: &VoiceDiagnosticsView,
    voice: &VoiceView,
    narrow: bool,
    actions: DebugActions,
    cx: &App,
) -> impl IntoElement + use<> {
    let sem = cx.sem().clone();
    let status_tone = match diagnostics.status {
        VoiceStatus::Connected => Tone::Good,
        VoiceStatus::Connecting | VoiceStatus::Reconnecting => Tone::Warn,
        VoiceStatus::Disconnected => Tone::Bad,
    };
    let (refresh, copy, close) = (actions.on_refresh, actions.on_copy, actions.on_close);
    let header = div()
        .flex()
        .items_center()
        .gap(px(8.))
        .child(
            Icon::new(IconName::BugReport)
                .size(20.)
                .color(sem.action_active),
        )
        .child(
            text(Variant::H6, "Voice Debug")
                .flex_1()
                .min_w_0()
                .truncate()
                .text_color(sem.text_primary),
        )
        .child(
            IconButton::new("voice-debug-refresh", IconName::Refresh, "Refresh numbers")
                .small()
                .on_click(move |_, window, cx| refresh(window, cx)),
        )
        .child(if narrow {
            // No room for the label beside the title on a phone.
            IconButton::new("voice-debug-copy", IconName::ContentCopy, "Copy report")
                .small()
                .on_click(move |_, window, cx| copy(window, cx))
                .into_any_element()
        } else {
            Button::new("voice-debug-copy", "Copy report")
                .outlined()
                .size(ButtonSize::Small)
                .start_icon(IconName::ContentCopy)
                .on_click(move |_, window, cx| copy(window, cx))
                .into_any_element()
        })
        .child(
            IconButton::new("voice-debug-close", IconName::Close, "Close debug panel")
                .small()
                .on_click(move |_, window, cx| close(window, cx)),
        );

    let connection = section("Connection", cx)
        .child(
            chips()
                .child(chip(status_label(diagnostics.status), status_tone, cx))
                .child(chip(
                    format!("Participants: {}", voice.participants.len()),
                    Tone::Neutral,
                    cx,
                ))
                .children(
                    voice
                        .reconnect_attempt
                        .map(|attempt| chip(format!("Rejoin attempt {attempt}"), Tone::Warn, cx)),
                ),
        )
        .child(row(
            "Server",
            diagnostics
                .server_host
                .clone()
                .unwrap_or_else(|| "\u{2014}".into()),
            cx,
        ))
        .children(voice.error.clone().map(|error| row("Error", error, cx)));

    let dash = || "\u{2014}".to_owned();
    let media = section("Media", cx).child(match &diagnostics.media {
        None => text(
            Variant::Body2,
            "No measurements yet. Refresh once the call is up.",
        )
        .text_color(sem.text_secondary)
        .into_any_element(),
        Some(media) => div()
            .flex()
            .flex_col()
            .gap(px(2.))
            .child(row(
                "ICE candidates",
                if media.candidate_types.is_empty() {
                    dash()
                } else {
                    media.candidate_types.join(", ")
                },
                cx,
            ))
            .child(row(
                "Round trip",
                media.rtt_ms.map_or_else(dash, |ms| format!("{ms} ms")),
                cx,
            ))
            .child(row(
                "Packet loss",
                media
                    .packet_loss_pct
                    .map_or_else(dash, |pct| format!("{pct:.1}%")),
                cx,
            ))
            .child(row(
                "Audio codec",
                media.audio_codec.clone().unwrap_or_else(dash),
                cx,
            ))
            .child(row(
                "Bitrate",
                format!(
                    "{} in / {} out",
                    media
                        .bitrate_in_kbps
                        .map_or_else(dash, |kbps| format!("{kbps} kbps")),
                    media
                        .bitrate_out_kbps
                        .map_or_else(dash, |kbps| format!("{kbps} kbps")),
                ),
                cx,
            ))
            .into_any_element(),
    });

    let local = &voice.local;
    let microphone = section("Microphone", cx).child(
        chips()
            .child(if voice.muted {
                chip("muted", Tone::Warn, cx)
            } else {
                chip("live", Tone::Good, cx)
            })
            .child(if local.may_speak {
                chip("may speak", Tone::Good, cx)
            } else {
                chip("may not speak", Tone::Bad, cx)
            })
            .when(voice.server_muted, |chips| {
                chips.child(chip("server muted", Tone::Bad, cx))
            })
            .when(voice.deafened, |chips| {
                chips.child(chip("deafened", Tone::Warn, cx))
            }),
    );

    let failure = diagnostics.last_failure.as_ref().map(|failure| {
        section("Last failed join", cx)
            .child(chips().child(chip(failure_label(failure.class), Tone::Bad, cx)))
            .child(text(Variant::Body2, failure.message.clone()).text_color(sem.text_primary))
            .child(row(
                "After",
                format!("{:.1} s", failure.duration_ms as f64 / 1000.),
                cx,
            ))
            .child(row("At", clock(failure.at_ms), cx))
    });

    let others: Vec<&ParticipantView> = voice.participants.iter().collect();
    let people =
        section(format!("Participants ({})", others.len()), cx).child(if others.is_empty() {
            text(Variant::Body2, "Nobody in the room.")
                .text_color(sem.text_secondary)
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .children(others.into_iter().map(|person| participant(person, cx)))
                .into_any_element()
        });

    let events = section(format!("Events ({})", diagnostics.events.len()), cx).child(
        if diagnostics.events.is_empty() {
            text(Variant::Body2, "Nothing yet.")
                .text_color(sem.text_secondary)
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .children(
                    diagnostics
                        .events
                        .iter()
                        .rev()
                        .take(EVENTS_SHOWN)
                        .map(|event| {
                            div()
                                .flex()
                                .gap(px(8.))
                                .text_size(px(12.))
                                .child(
                                    div()
                                        .flex_shrink_0()
                                        .text_color(sem.text_secondary)
                                        .child(clock(event.at_ms)),
                                )
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .text_color(sem.text_primary)
                                        .child(event.message.clone()),
                                )
                        }),
                )
                .into_any_element()
        },
    );

    div()
        .id("voice-debug")
        .test_support()
        .role(Role::Dialog)
        .aria_label("Voice debug panel")
        .when(narrow, |panel| panel.w_full())
        .when(!narrow, |panel| panel.w(px(420.)))
        .max_h_full()
        .overflow_y_scroll()
        .p(px(16.))
        .rounded(px(if narrow { 0. } else { 4. }))
        .bg(sem.paper)
        .text_color(sem.text_primary)
        .border_1()
        .border_color(sem.paper_border)
        .shadow_lg()
        .occlude()
        .child(header)
        .child(connection)
        .child(media)
        .when(diagnostics.status != VoiceStatus::Disconnected, |panel| {
            panel.child(microphone)
        })
        .children(failure)
        .child(people)
        .child(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn the_log_clock_is_utc_hours_minutes_seconds() {
        assert_eq!(clock(0), "00:00:00");
        assert_eq!(clock((13 * 3600 + 4 * 60 + 5) * 1000 + 999), "13:04:05");
        assert_eq!(clock(25 * 3600 * 1000), "01:00:00");
    }

    #[test]
    fn every_failure_class_has_words() {
        for class in [
            JoinFailureClass::MediaUnreachable,
            JoinFailureClass::ServerUnreachable,
            JoinFailureClass::Permission,
            JoinFailureClass::NotFound,
            JoinFailureClass::Session,
            JoinFailureClass::ServerError,
            JoinFailureClass::Unknown,
        ] {
            assert!(!failure_label(class).is_empty());
        }
    }
}
