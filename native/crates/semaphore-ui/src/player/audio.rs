//! The audio attachment: one compact card with the file's name and size, play or pause, the
//! scrubber, the time and the volume, and the same states as the video player.

use super::PlayerViewEvent;
use super::controls::{self, Ink, PlayerView, Scrub};
use super::model::{self, Failure, KeyCommand, MainButton, Phase};
use super::session::{Playback, PlayerOpener};
use crate::kit::{Button, Icon, IconButton, Spinner, Variant, text};
use crate::theme::SemTheme as _;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::slider::{SliderEvent, SliderState, SliderValue};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::player::AttachmentSource;
use semaphore_design::Icon as IconName;
use std::rc::Rc;

/// Narrower windows drop the volume slider.
const PHONE_WIDTH: f32 = 600.;

pub struct AudioPlayer {
    source: AttachmentSource,
    playback: Playback,
    scrub: Scrub,
    focus: FocusHandle,
    volume: Entity<SliderState>,
    _inbox: Task<()>,
    _volume_events: Subscription,
}

impl EventEmitter<PlayerViewEvent> for AudioPlayer {}

impl AudioPlayer {
    /// A row for `source`, opened through `opener` on the first play (with no surface).
    pub fn new(
        source: AttachmentSource,
        opener: Rc<dyn PlayerOpener>,
        cx: &mut Context<Self>,
    ) -> Self {
        let playback = Playback::new(source.clone().into(), opener, None);
        let inbox = playback.inbox.clone();
        let task = cx.spawn(async move |this, cx| {
            loop {
                inbox.next().await;
                if this.update(cx, |view, cx| view.sync(cx)).is_err() {
                    return;
                }
            }
        });
        let volume = controls::volume_state(cx);
        let volume_events = cx.subscribe(&volume, |view: &mut Self, _, event, cx| {
            let (SliderEvent::Change(SliderValue::Single(value))
            | SliderEvent::Release(SliderValue::Single(value))) = *event
            else {
                return;
            };
            let volume = (value / 100.).clamp(0., 1.);
            if (view.playback.volume - volume).abs() > f32::EPSILON {
                view.playback.set_volume(volume);
                view.commanded(cx);
            }
        });
        Self {
            source,
            playback,
            scrub: Scrub::default(),
            focus: cx.focus_handle(),
            volume,
            _inbox: task,
            _volume_events: volume_events,
        }
    }

    pub fn phase(&self) -> &Phase {
        &self.playback.phase
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    /// The attachment this plays.
    pub fn source(&self) -> &AttachmentSource {
        &self.source
    }

    /// Stops for good and frees the file (a sign-out); the next play opens it again.
    pub fn close(&mut self, cx: &mut Context<Self>) {
        self.playback.close();
        cx.notify();
    }

    #[cfg(test)]
    pub(super) fn playback_state(&self) -> &Playback {
        &self.playback
    }

    pub fn toggle(&mut self, cx: &mut Context<Self>) {
        self.playback.toggle();
        self.commanded(cx);
    }

    fn sync(&mut self, cx: &mut Context<Self>) {
        if self.playback.drain() {
            cx.notify();
        }
    }

    fn on_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(command) = model::key_command(&event.keystroke.key, false) else {
            return;
        };
        cx.stop_propagation();
        match command {
            KeyCommand::Toggle => self.playback.toggle(),
            KeyCommand::Seek { forward } => self.playback.seek_by(forward),
            KeyCommand::Volume { up } => {
                let volume = model::step_volume(self.playback.volume, up);
                self.playback.set_volume(volume);
                self.volume
                    .update(cx, |state, cx| state.set_value(volume * 100., window, cx));
            }
            KeyCommand::Mute => self.playback.toggle_mute(),
            KeyCommand::Expand | KeyCommand::Collapse => {}
        }
        self.commanded(cx);
    }

    fn emit_for_file(&self, cx: &mut Context<Self>, make: fn(String) -> PlayerViewEvent) {
        cx.emit(make(self.source.file_id.clone()));
    }

    fn main_button(&self, button: MainButton, ink: Ink, cx: &mut Context<Self>) -> AnyElement {
        if button == MainButton::Spinner {
            return div()
                .id("player-spinner")
                .test_support()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(40.))
                .child(Spinner::new("player-spinner-icon").size(24.))
                .into_any_element();
        }
        let (icon, label) = match button {
            MainButton::Pause => (IconName::Pause, "Pause"),
            MainButton::Replay => (IconName::Replay, "Replay"),
            _ => (IconName::PlayArrow, "Play"),
        };
        IconButton::new("player-play", icon, label)
            .color(ink.played)
            .disabled(matches!(self.playback.phase, Phase::Failed(_)))
            .on_click(cx.listener(|view, _, window, cx| {
                window.focus(&view.focus, cx);
                view.toggle(cx);
            }))
            .into_any_element()
    }

    /// The error and what to do about it. At phone width the action takes its own line, pulled
    /// left by the button's inner padding so its icon lines up with the error's.
    fn failure_line(
        &self,
        failure: Failure,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let error = cx.sem().error;
        let (message, id) = match failure {
            Failure::Unsupported => ("Can't play this here", "player-unsupported"),
            Failure::Retryable => ("Couldn't play this file", "player-error"),
        };
        let action = match failure {
            Failure::Unsupported => Button::new("player-open-external", "Open externally")
                .start_icon(IconName::OpenInNew)
                .on_click(cx.listener(|view, _, _, cx| {
                    view.emit_for_file(cx, |file_id| PlayerViewEvent::OpenExternally { file_id })
                })),
            Failure::Retryable => Button::new("player-retry", "Retry")
                .start_icon(IconName::Refresh)
                .on_click(cx.listener(|view, _, _, cx| {
                    view.playback.retry();
                    view.commanded(cx);
                })),
        };
        let action = div()
            .when(narrow, |el| el.ml(px(-BUTTON_PADDING_X)))
            .child(action);
        div()
            .id(id)
            .test_support()
            .flex()
            .when(narrow, |el| el.flex_col().items_start().gap(px(2.)))
            .when(!narrow, |el| el.flex_wrap().items_center().gap(px(8.)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_color(error)
                    .child(Icon::new(IconName::ErrorOutline).size(18.).color(error))
                    .child(text(Variant::Body2, message)),
            )
            .child(action)
    }
}

/// A medium text button's inner padding (`kit::Button`).
const BUTTON_PADDING_X: f32 = 16.;

impl PlayerView for AudioPlayer {
    fn playback(&mut self) -> &mut Playback {
        &mut self.playback
    }

    fn scrub(&mut self) -> &mut Scrub {
        &mut self.scrub
    }

    fn commanded(&mut self, cx: &mut Context<Self>) {
        self.sync(cx);
        cx.notify();
    }
}

impl Render for AudioPlayer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // At phone width the scrubber needs the room; mute, and up and down, still work.
        let narrow = window.viewport_size().width < px(PHONE_WIDTH);
        let sem = cx.sem();
        let (divider, paper, primary) = (sem.divider, sem.paper, sem.primary);
        let (text_primary, text_secondary) = (sem.text_primary, sem.text_secondary);
        let ink = Ink::on_card(cx);
        let (button, failure) = model::audio_shown(&self.playback.phase);
        let source = &self.source;
        let name = div()
            .flex()
            .items_baseline()
            .gap(px(8.))
            .min_w_0()
            .child(
                div()
                    .id("player-file-name")
                    .test_support()
                    .min_w_0()
                    .truncate()
                    .text_color(text_primary)
                    .child(
                        text(Variant::Body2, source.filename.clone())
                            .font_weight(FontWeight::MEDIUM),
                    ),
            )
            .child(div().flex_none().text_color(text_secondary).child(text(
                Variant::Caption,
                crate::format::file_size(source.size),
            )));
        let lower =
            match failure {
                Some(failure) => self.failure_line(failure, narrow, cx).into_any_element(),
                None => div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    // The thumb overhangs the track's end by its radius; keep it off the time.
                    .child(div().flex().flex_1().min_w(px(40.)).pr(px(6.)).child(
                        controls::scrubber(
                            &self.playback,
                            &self.scrub,
                            ink,
                            controls::TipAt::Below,
                            cx,
                        ),
                    ))
                    .when(self.playback.phase == Phase::Buffering, |row| {
                        row.child(
                            div()
                                .id("player-spinner")
                                .test_support()
                                .flex_none()
                                .child(Spinner::new("player-spinner-icon").size(14.)),
                        )
                    })
                    .child(controls::time::<Self>(&self.playback, ink))
                    .child(controls::mute_button(&self.playback, ink, cx))
                    .when(!narrow, |row| {
                        row.child(controls::volume_slider(&self.volume))
                    })
                    .into_any_element(),
            };
        div()
            .id(("audio-player", cx.entity_id()))
            .track_focus(&self.focus)
            .key_context("AudioPlayer")
            .on_key_down(cx.listener(Self::on_key))
            .flex()
            .items_center()
            .gap(px(8.))
            .w(px(model::AUDIO_MAX_WIDTH))
            .max_w_full()
            .min_w_0()
            .pl(px(4.))
            .pr(px(8.))
            .py(px(8.))
            .rounded(px(8.))
            .border_1()
            .border_color(divider)
            .bg(paper)
            .child(self.main_button(button, ink, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(name)
                    .child(lower),
            )
            .child(
                IconButton::new("player-download", IconName::Download, "Download")
                    .small()
                    .color(primary)
                    .on_click(cx.listener(|view, _, _, cx| {
                        view.emit_for_file(cx, |file_id| PlayerViewEvent::Download { file_id })
                    })),
            )
    }
}
