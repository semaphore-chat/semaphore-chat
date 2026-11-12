//! The menu on someone in a call (a right-click on their tile or their row in the channel list):
//! the web's `VoiceUserContextMenu.tsx`.
//!
//! "View Profile" for anyone. For someone else: "Mute for Me" and a volume up to 200%. A moderator
//! in a channel call also gets "Server Mute" (or "Server Unmute") and "Kick", as
//! `VoiceModerationCaps` allows. Kick hands the member to the owner, who asks first with W5's
//! moderation kick dialog (`moderation::ModerationDialog`, as `KickConfirmDialog.tsx`).
//!
//! The owner places it at the pointer (`set_position`), drops it on `Close`, and calls core for
//! everything else. A refused server mute is the owner's to show (a toast): the menu has closed by
//! then, as on the web.

use super::model::display_name;
use crate::kit::{Icon, Slider, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::slider::{SliderEvent, SliderState, SliderValue};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ParticipantView, UserView, VoiceModerationCaps};
use semaphore_design::Icon as IconName;

pub const MAX_VOLUME: u32 = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParticipantMenuEvent {
    ViewProfile {
        user_id: String,
    },
    /// The slider moved, or "Mute for Me"/"Unmute for Me": `Core::set_participant_volume`.
    SetVolume {
        identity: String,
        percent: u32,
    },
    /// `Core::server_mute`. The menu closes with it.
    ServerMute {
        identity: String,
        mute: bool,
    },
    /// "Kick": the owner opens the moderation kick dialog for them (the menu closes with it).
    Kick {
        user: UserView,
    },
    /// Done with: a press outside, Escape, an action that closes it, or the confirm cancelled.
    Close,
}

/// Everything the menu shows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParticipantMenuModel {
    pub participant: ParticipantView,
    /// How loud they play here, 0 to 200. Core's `ParticipantView` will carry it.
    pub volume_percent: u32,
    /// `Core::voice_moderation_caps(channel_id)`. Ignored outside a channel call.
    pub caps: VoiceModerationCaps,
    /// A channel call: moderation only makes sense in a community.
    pub in_channel: bool,
}

impl ParticipantMenuModel {
    fn others(&self) -> bool {
        !self.participant.is_self
    }

    pub fn shows_server_mute(&self) -> bool {
        self.others() && self.in_channel && self.caps.can_server_mute
    }

    pub fn shows_kick(&self) -> bool {
        self.others() && self.in_channel && self.caps.can_kick
    }
}

/// What "Mute for Me" or "Unmute for Me" sets: silence, or back to 100% as the web does.
pub fn toggled_volume(percent: u32) -> u32 {
    if percent == 0 { 100 } else { 0 }
}

pub struct ParticipantMenu {
    model: ParticipantMenuModel,
    position: Point<Pixels>,
    slider: Entity<SliderState>,
    _slider_events: Subscription,
}

impl EventEmitter<ParticipantMenuEvent> for ParticipantMenu {}

impl ParticipantMenu {
    pub fn new(
        model: ParticipantMenuModel,
        position: Point<Pixels>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (slider, events) = Self::slider(model.volume_percent, cx);
        Self {
            model,
            position,
            slider,
            _slider_events: events,
        }
    }

    fn slider(percent: u32, cx: &mut Context<Self>) -> (Entity<SliderState>, Subscription) {
        let slider = cx.new(|_| {
            SliderState::new()
                .min(0.)
                .max(MAX_VOLUME as f32)
                .step(1.)
                .default_value(percent.min(MAX_VOLUME) as f32)
        });
        let events = cx.subscribe(&slider, |menu: &mut Self, _, event, cx| {
            let (SliderEvent::Change(SliderValue::Single(value))
            | SliderEvent::Release(SliderValue::Single(value))) = *event
            else {
                return;
            };
            let percent = value.round().clamp(0., MAX_VOLUME as f32) as u32;
            if percent != menu.model.volume_percent {
                menu.model.volume_percent = percent;
                cx.emit(ParticipantMenuEvent::SetVolume {
                    identity: menu.model.participant.identity.clone(),
                    percent,
                });
                cx.notify();
            }
        });
        (slider, events)
    }

    pub fn model(&self) -> &ParticipantMenuModel {
        &self.model
    }

    pub fn set_model(&mut self, model: ParticipantMenuModel, cx: &mut Context<Self>) {
        if model.volume_percent != self.model.volume_percent
            || model.participant.identity != self.model.participant.identity
        {
            let (slider, events) = Self::slider(model.volume_percent, cx);
            self.slider = slider;
            self._slider_events = events;
        }
        self.model = model;
        cx.notify();
    }

    /// Where the pointer was, in window coordinates.
    pub fn set_position(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        self.position = position;
        cx.notify();
    }

    fn item(
        &self,
        id: &'static str,
        glyph: IconName,
        (icon_color, color): (Hsla, Hsla),
        label: impl Into<SharedString>,
        cx: &mut Context<Self>,
        on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> impl IntoElement {
        let hover = cx.sem().list_hover;
        let label = label.into();
        div()
            .id(id)
            .test_support()
            .role(Role::MenuItem)
            .aria_label(label.clone())
            .min_h(px(36.))
            .px(px(16.))
            .flex()
            .items_center()
            .gap(px(12.))
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .text_color(color)
            .child(Icon::new(glyph).size(20.).color(icon_color))
            .child(text(Variant::Body1, label))
            .on_click(cx.listener(move |menu, _, window, cx| on_click(menu, window, cx)))
    }

    fn divider(cx: &App) -> impl IntoElement {
        div().my(px(8.)).h(px(1.)).bg(cx.sem().divider)
    }

    fn menu(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let sem = cx.sem().clone();
        let model = &self.model;
        let participant = &model.participant;
        let name = display_name(participant).to_owned();
        let user_id = participant.user.id.clone();
        let identity = participant.identity.clone();
        let mut list = div()
            .id("participant-menu")
            .test_support()
            .role(Role::Menu)
            .aria_label(format!("Actions for {name}"))
            .w(px(240.))
            .py(px(8.))
            .rounded(px(4.))
            .bg(sem.paper)
            .text_color(sem.text_primary)
            .border_1()
            .border_color(sem.divider)
            .shadow_lg()
            .occlude()
            .on_mouse_down_out(cx.listener(|_, _, _, cx| cx.emit(ParticipantMenuEvent::Close)))
            .child(self.item(
                "participant-profile",
                IconName::Person,
                (sem.action_active, sem.text_primary),
                "View Profile",
                cx,
                move |_, _, cx| {
                    cx.emit(ParticipantMenuEvent::ViewProfile {
                        user_id: user_id.clone(),
                    });
                    cx.emit(ParticipantMenuEvent::Close);
                },
            ));
        if !model.others() {
            return list;
        }
        let silenced = model.volume_percent == 0;
        let volume_identity = identity.clone();
        list = list
            .child(Self::divider(cx))
            .child(self.item(
                "participant-local-mute",
                if silenced {
                    IconName::VolumeUp
                } else {
                    IconName::VolumeOff
                },
                (sem.action_active, sem.text_primary),
                if silenced {
                    "Unmute for Me"
                } else {
                    "Mute for Me"
                },
                cx,
                move |menu, _, cx| {
                    cx.emit(ParticipantMenuEvent::SetVolume {
                        identity: volume_identity.clone(),
                        percent: toggled_volume(menu.model.volume_percent),
                    });
                    cx.emit(ParticipantMenuEvent::Close);
                },
            ))
            .child(
                div()
                    .px(px(16.))
                    .py(px(8.))
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .child(
                                text(Variant::Caption, "User Volume")
                                    .text_color(sem.text_secondary),
                            )
                            .child(
                                text(Variant::Caption, format!("{}%", model.volume_percent))
                                    .text_color(sem.text_secondary),
                            ),
                    )
                    .child(Slider::new(&self.slider, format!("Volume for {name}"))),
            );
        if model.shows_server_mute() {
            let mute = !participant.server_muted;
            let mute_identity = identity.clone();
            list = list.child(Self::divider(cx)).child(self.item(
                "participant-server-mute",
                IconName::MicOff,
                (sem.warning, sem.text_primary),
                if mute { "Server Mute" } else { "Server Unmute" },
                cx,
                move |_, _, cx| {
                    cx.emit(ParticipantMenuEvent::ServerMute {
                        identity: mute_identity.clone(),
                        mute,
                    });
                    cx.emit(ParticipantMenuEvent::Close);
                },
            ));
        }
        if model.shows_kick() {
            list = list.child(Self::divider(cx)).child(self.item(
                "participant-kick",
                IconName::PersonRemove,
                (sem.error, sem.error),
                "Kick",
                cx,
                |menu, _, cx| {
                    cx.emit(ParticipantMenuEvent::Kick {
                        user: menu.model.participant.user.clone(),
                    });
                    cx.emit(ParticipantMenuEvent::Close);
                },
            ));
        }
        list
    }

}

impl Render for ParticipantMenu {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        deferred(
            anchored()
                .position(self.position)
                .snap_to_window_with_margin(px(8.))
                .child(self.menu(cx)),
        )
        .with_priority(1)
        .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    fn model(is_self: bool, in_channel: bool, mute: bool, kick: bool) -> ParticipantMenuModel {
        ParticipantMenuModel {
            participant: ParticipantView {
                identity: "u2".into(),
                is_self,
                ..ParticipantView::default()
            },
            volume_percent: 100,
            caps: VoiceModerationCaps {
                can_server_mute: mute,
                can_kick: kick,
            },
            in_channel,
        }
    }

    #[test]
    fn moderation_shows_by_caps_for_others_in_a_channel_only() {
        assert!(model(false, true, true, true).shows_server_mute());
        assert!(model(false, true, true, true).shows_kick());
        assert!(!model(false, true, false, true).shows_server_mute());
        assert!(!model(false, true, true, false).shows_kick());
        // A DM call has no community to moderate.
        assert!(!model(false, false, true, true).shows_server_mute());
        assert!(!model(false, false, true, true).shows_kick());
        // Nobody moderates themselves.
        assert!(!model(true, true, true, true).shows_server_mute());
        assert!(!model(true, true, true, true).shows_kick());
    }

    #[test]
    fn mute_for_me_silences_and_unmute_goes_back_to_full() {
        assert_eq!(toggled_volume(150), 0);
        assert_eq!(toggled_volume(1), 0);
        assert_eq!(toggled_volume(0), 100);
    }
}
