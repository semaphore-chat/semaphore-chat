//! The call bar (design §3.5, guide "Three islands" › The call bar), the native side of
//! `frontend/src/shell/lounge/pieces/call/CallBar.tsx` and `callBarLine.ts`: the strip in the
//! frame's call slot that shows the call you are in.
//!
//! - Every width: the room and its state line, which together are the Open call view control; the
//!   mic, Deafen and Leave. Nobody is ever deafened without a control on screen to undeafen.
//! - A mic that can do nothing (muted by a moderator, the push-to-talk key) stays focusable and
//!   named, reads as unavailable, and says why when pressed. A moderator's mute is also the line,
//!   in full.
//! - Joining: the room and "Joining…" only, with nothing to press.
//! - Reconnecting: a row with the attempt and Cancel above the rest, and no "connected" line.
//!
//! Not offered here (camera, starting a share, soundboard, replay, device settings, the debug
//! panel): they are on the call view, which the room's name opens, and in settings.

use super::super::text_line;
use crate::kit::{
    Button, ButtonSize, Card, IconButton, IconButtonVariant, ListRow, Padding, Politeness, Spinner,
    announce,
};
use crate::theme::SemTheme;
use crate::voice::{VoiceController, VoiceStageModel};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LocalShare, VoiceStatus};
use semaphore_design::lounge::{self as t, SPACE_XS};
use semaphore_design::{Icon as IconName, LoungeIcon};
use std::sync::Arc;

/// Where the call is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallPhase {
    Connecting,
    Connected,
    /// Rejoining, on this attempt.
    Reconnecting(u32),
}

/// How the mic works.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MicMode {
    /// A press mutes or unmutes.
    Toggle,
    /// Push to talk on a key: the mic opens only while it is held.
    PushToTalk { key: String },
}

/// What the call bar shows, from the stage's model: both read the same call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallBarModel {
    pub room: String,
    pub is_dm: bool,
    pub phase: CallPhase,
    /// Muted by you (`VoiceView::muted`).
    pub muted: bool,
    /// The push-to-talk key is held.
    pub transmitting: bool,
    pub mode: MicMode,
    pub server_muted: bool,
    pub deafened: bool,
    /// Who else is talking, first in the list.
    pub talking: Option<String>,
    pub sharing_screen: bool,
}

impl CallBarModel {
    /// `None` while there is no call.
    pub fn from_stage(model: &VoiceStageModel) -> Option<Self> {
        let voice = &model.voice;
        voice.room.as_ref()?;
        let phase = match (voice.status, model.reconnect_attempt) {
            (VoiceStatus::Disconnected, _) => return None,
            (VoiceStatus::Connecting, _) => CallPhase::Connecting,
            (_, Some(attempt)) => CallPhase::Reconnecting(attempt),
            (VoiceStatus::Reconnecting, None) => CallPhase::Reconnecting(1),
            (VoiceStatus::Connected, None) => CallPhase::Connected,
        };
        let room = if model.channel_name.is_empty() {
            if model.is_dm {
                "Direct Message"
            } else {
                "Voice Channel"
            }
            .to_owned()
        } else {
            model.channel_name.clone()
        };
        let (mode, transmitting) = match &model.ptt {
            Some(ptt) => (
                MicMode::PushToTalk {
                    key: ptt.key_label.clone(),
                },
                ptt.held,
            ),
            None => (MicMode::Toggle, false),
        };
        let talking = voice
            .participants
            .iter()
            .find(|person| !person.is_self && person.speaking)
            .map(|person| crate::voice::display_name(person).to_owned());
        Some(Self {
            room,
            is_dm: model.is_dm,
            phase,
            muted: voice.muted,
            transmitting,
            mode,
            server_muted: voice.server_muted,
            deafened: voice.deafened,
            talking,
            sharing_screen: voice.local.screen == LocalShare::On,
        })
    }

    /// The mic is sending: unmuted, or the push-to-talk key held.
    pub fn live(&self) -> bool {
        match self.mode {
            MicMode::Toggle => !self.muted && !self.server_muted,
            MicMode::PushToTalk { .. } => self.transmitting,
        }
    }
}

/// How the line reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineTone {
    Secondary,
    Danger,
    Accent,
}

/// The line under the room's name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallBarLine {
    pub text: String,
    pub tone: LineTone,
    /// The user must read it in full: drawn on its own line under the room, wrapping.
    pub full: bool,
}

fn line(text: impl Into<String>, tone: LineTone, full: bool) -> Option<CallBarLine> {
    Some(CallBarLine {
        text: text.into(),
        tone,
        full,
    })
}

/// What is happening now, most important first. `None` while reconnecting with the mic open: the
/// status row above says it, and nothing here may claim the call is connected.
pub fn call_bar_line(model: &CallBarModel) -> Option<CallBarLine> {
    use LineTone::*;
    if model.phase == CallPhase::Connecting {
        return line("Joining\u{2026}", Secondary, false);
    }
    if model.server_muted {
        return line("Muted by a moderator", Danger, true);
    }
    let live = model.live();
    // Mute doesn't undeafen: unmuting while deafened leaves you talking without hearing anyone.
    if model.deafened && live {
        return line("Deafened \u{b7} your mic is on", Danger, true);
    }
    if model.deafened {
        return line("Deafened", Secondary, false);
    }
    if let CallPhase::Reconnecting(_) = model.phase {
        return if live {
            None
        } else {
            line("Muted", Secondary, false)
        };
    }
    if model.transmitting {
        return line("You're talking", Accent, false);
    }
    if let MicMode::PushToTalk { key } = &model.mode {
        return line(format!("Hold {} to talk", key_name(key)), Secondary, false);
    }
    if !live {
        return line("Muted", Secondary, false);
    }
    if let Some(name) = &model.talking {
        return line(format!("{name} is talking"), Accent, false);
    }
    line(
        if model.is_dm {
            "Call connected"
        } else {
            "Voice connected"
        },
        Secondary,
        false,
    )
}

fn key_name(key: &str) -> &str {
    if key.is_empty() { "the key" } else { key }
}

/// Why the mic can do nothing right now, said when it is pressed. `None` when a press acts.
pub fn mic_unavailable_reason(model: &CallBarModel) -> Option<String> {
    if model.server_muted {
        return Some("Muted by a moderator".into());
    }
    if let MicMode::PushToTalk { key } = &model.mode {
        return Some(format!("Hold {} to talk", key_name(key)));
    }
    None
}

/// The bar. Its buttons call the controller, as the call view's do.
#[derive(IntoElement)]
pub struct CallBar {
    model: CallBarModel,
    controller: Arc<dyn VoiceController>,
}

impl CallBar {
    pub fn new(model: CallBarModel, controller: Arc<dyn VoiceController>) -> Self {
        Self { model, controller }
    }
}

impl RenderOnce for CallBar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let model = self.model;
        let line = call_bar_line(&model);
        let joining = model.phase == CallPhase::Connecting;
        let room = model.room.clone();

        let controls = (!joining).then(|| {
            let live = model.live();
            let reason = mic_unavailable_reason(&model);
            let (mute, deafen, leave) = (
                self.controller.clone(),
                self.controller.clone(),
                self.controller.clone(),
            );
            let muted = model.muted;
            let deafened = model.deafened;
            let toggle = model.mode == MicMode::Toggle;
            let said = reason.clone();
            let mic = IconButton::new(
                "call-bar-mic",
                if live {
                    IconName::Mic
                } else {
                    IconName::MicOff
                },
                "Mute",
            )
            .lounge_icon(if live {
                LoungeIcon::Mic
            } else {
                LoungeIcon::MicOff
            })
            // The name stays "Mute"; pressed means muted.
            .selected(toggle && !live)
            .variant(if model.transmitting {
                IconButtonVariant::Primary
            } else {
                IconButtonVariant::Ghost
            })
            .unavailable(reason.is_some())
            .on_unavailable_press(move |_, window, cx| {
                if let Some(said) = &said {
                    announce(said.clone(), Politeness::Polite, window, cx);
                }
            })
            .on_click(move |_, _, _| mute.set_muted(!muted));
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_XS))
                .child(mic)
                .child(
                    IconButton::new(
                        "call-bar-deafen",
                        if deafened {
                            IconName::HeadsetOff
                        } else {
                            IconName::Headphones
                        },
                        "Deafen",
                    )
                    .lounge_icon(if deafened {
                        LoungeIcon::HeadphoneOff
                    } else {
                        LoungeIcon::Headphones
                    })
                    .selected(deafened)
                    .on_click(move |_, _, _| deafen.set_deafened(!deafened)),
                )
                .child(
                    IconButton::new("call-bar-leave", IconName::CallEnd, "Leave call")
                        .lounge_icon(LoungeIcon::PhoneOff)
                        .variant(IconButtonVariant::Danger)
                        .on_click(move |_, _, _| leave.leave()),
                )
        });

        let short = line.as_ref().filter(|line| !line.full);
        let mut row = ListRow::new("call-bar-open", room.clone())
            .size(crate::kit::RowSize::Lg)
            // The kit's strong primary line: the room is the bar's title.
            .strong(true)
            .chevron(!joining);
        if let Some(short) = short {
            row = row.secondary(short.text.clone());
        }
        if !joining {
            let open = self.controller.clone();
            row = row
                .label(format!("Open call view, {room}"))
                .on_click(move |_, _| open.open_call_view());
        }
        if let Some(controls) = controls {
            row = row.trailing(controls);
        }

        let tone = |tone: LineTone| match tone {
            LineTone::Secondary => sem.role.text_secondary,
            LineTone::Danger => sem.role.danger,
            LineTone::Accent => sem.role.accent,
        };
        let full = line.as_ref().filter(|line| line.full).map(|line| {
            div()
                .id("call-bar-line")
                .test_support()
                .child(text_line(t::TEXT_META, line.text.clone()).text_color(tone(line.tone)))
        });

        let reconnecting = match model.phase {
            CallPhase::Reconnecting(attempt) => {
                let cancel = self.controller.clone();
                let words = format!("Reconnecting ({attempt})\u{2026}");
                Some(
                    div()
                        .id("call-bar-reconnecting")
                        .test_support()
                        .role(Role::Status)
                        .aria_label(words.clone())
                        .child(
                            ListRow::new("call-bar-reconnecting-row", words)
                                .leading(Spinner::new("call-bar-spinner").size(16.))
                                .trailing(
                                    Button::new("call-bar-cancel", "Cancel")
                                        .ghost()
                                        .size(ButtonSize::Sm)
                                        .on_click(move |_, _, _| cancel.leave()),
                                ),
                        ),
                )
            }
            _ => None,
        };

        div()
            .id("call-bar")
            .test_support()
            .role(Role::Region)
            .aria_label(format!("Call in {room}"))
            .child(
                Card::new("call-bar-card")
                    .padding(Padding::Md)
                    .children(reconnecting)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(SPACE_XS))
                            .child(row)
                            .children(full),
                    ),
            )
    }
}
