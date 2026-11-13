//! The video attachment: a poster with a big play button, then frames with a control bar, an
//! in-window expanded view, and the loading, buffering, ended and failed states.

use super::PlayerViewEvent;
use super::controls::{self, Ink, PlayerView, Scrub};
use super::model::{self, Center, KeyCommand, Phase, Picture};
use super::session::{Playback, PlayerOpener};
use crate::kit::{Button, ButtonSize, Icon, IconButton, Spinner, Variant, text};
use crate::theme::SemTheme as _;
use crate::voice::VideoFrames;
use crate::voice::frames::Fit;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::slider::{SliderEvent, SliderState, SliderValue};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::player::AttachmentSource;
use semaphore_design::Icon as IconName;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::Ordering;

pub struct VideoPlayer {
    source: AttachmentSource,
    playback: Playback,
    scrub: Scrub,
    poster: Option<ImageSource>,
    size: (f32, f32),
    expanded: bool,
    /// The pointer moved within `HIDE_AFTER`: the controls show while playing.
    awake: bool,
    hide: Option<Task<()>>,
    focus: FocusHandle,
    volume: Entity<SliderState>,
    _inbox: Task<()>,
    _volume_events: Subscription,
}

impl EventEmitter<PlayerViewEvent> for VideoPlayer {}

impl VideoPlayer {
    /// A player for `source`, opened through `opener` on the first play, drawing into `frames`
    /// (the window's, as the call tiles use) under `player:<file_id>`. Sized from the
    /// attachment's dimensions ([`model::video_box`]); give it [`Self::set_poster`] for the
    /// thumbnail.
    pub fn new(
        source: AttachmentSource,
        dimensions: (Option<u32>, Option<u32>),
        opener: Rc<dyn PlayerOpener>,
        frames: Arc<VideoFrames>,
        cx: &mut Context<Self>,
    ) -> Self {
        let playback = Playback::new(source.clone().into(), opener, Some(frames));
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
            poster: None,
            size: model::video_box(dimensions.0, dimensions.1),
            expanded: false,
            awake: true,
            hide: None,
            focus: cx.focus_handle(),
            volume,
            _inbox: task,
            _volume_events: volume_events,
        }
    }

    /// The thumbnail (`/file/{id}/thumbnail`, loaded by the owner), or `None` for a plain box.
    pub fn set_poster(&mut self, poster: Option<ImageSource>, cx: &mut Context<Self>) {
        self.poster = poster;
        cx.notify();
    }

    pub fn has_poster(&self) -> bool {
        self.poster.is_some()
    }

    pub fn phase(&self) -> &Phase {
        &self.playback.phase
    }

    pub fn is_expanded(&self) -> bool {
        self.expanded
    }

    pub fn controls_visible(&self) -> bool {
        model::video_shown(&self.playback.phase, self.playback.has_frame(), self.awake).controls
    }

    /// The box this player takes inline, in px, before the row's `max_w_full`.
    pub fn size(&self) -> (f32, f32) {
        self.size
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

    /// A frame of this player's video is on its surface.
    pub fn has_frame(&self) -> bool {
        self.playback.has_frame()
    }

    /// Whether the last frame asked for the next: only while video plays.
    #[cfg(test)]
    pub(super) fn animating(&self) -> bool {
        self.playback.inbox.animating.load(Ordering::Acquire)
    }

    #[cfg(test)]
    pub(super) fn playback_state(&self) -> &Playback {
        &self.playback
    }

    /// Play or pause, as a click on the button does.
    pub fn toggle(&mut self, cx: &mut Context<Self>) {
        self.playback.toggle();
        self.commanded(cx);
    }

    pub fn set_expanded(&mut self, expanded: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.expanded != expanded {
            self.expanded = expanded;
            window.focus(&self.focus, cx);
            cx.emit(PlayerViewEvent::Expanded(expanded));
            self.wake(cx);
        }
    }

    /// Takes the player's events. Called by the inbox's task, and after every command.
    fn sync(&mut self, cx: &mut Context<Self>) {
        let was_playing = self.playback.phase == Phase::Playing;
        if self.playback.drain() {
            let playing = self.playback.phase == Phase::Playing;
            if playing && !was_playing {
                self.wake(cx);
            } else if !playing {
                self.awake = true;
                self.hide = None;
            }
            cx.notify();
        }
    }

    /// The pointer moved: show the controls, and hide them again after `HIDE_AFTER` if still
    /// playing then.
    pub(super) fn wake(&mut self, cx: &mut Context<Self>) {
        if !self.awake {
            self.awake = true;
            cx.notify();
        }
        if self.playback.phase != Phase::Playing {
            self.hide = None;
            return;
        }
        self.hide = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(model::HIDE_AFTER).await;
            this.update(cx, |view, cx| {
                if view.playback.phase == Phase::Playing && view.scrub.drag.is_none() {
                    view.awake = false;
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    fn on_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(command) = model::key_command(&event.keystroke.key, true) else {
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
            KeyCommand::Expand => {
                let expanded = !self.expanded;
                self.set_expanded(expanded, window, cx);
            }
            KeyCommand::Collapse => self.set_expanded(false, window, cx),
        }
        self.commanded(cx);
    }

    fn emit_for_file(&self, cx: &mut Context<Self>, make: fn(String) -> PlayerViewEvent) {
        cx.emit(make(self.source.file_id.clone()));
    }

    fn picture(&self, picture: Picture, radius: Pixels) -> AnyElement {
        match picture {
            Picture::Surface => {
                let frames = self.playback.frames().cloned();
                let key = self.playback.key();
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, cx| {
                        if let Some(frames) = &frames {
                            frames.paint(&key, bounds, radius, Fit::Contain, window, cx);
                        }
                    },
                )
                .absolute()
                .size_full()
                .into_any_element()
            }
            Picture::Poster => match &self.poster {
                Some(poster) => div()
                    .id("player-poster")
                    .test_support()
                    .absolute()
                    .size_full()
                    .child(
                        img(poster.clone())
                            .size_full()
                            .rounded(radius)
                            .object_fit(ObjectFit::Contain),
                    )
                    .into_any_element(),
                // No thumbnail: the name, top left, where nothing in the middle covers it. The
                // box is black in every theme, so the text is too.
                None => div()
                    .id("player-poster")
                    .test_support()
                    .absolute()
                    .size_full()
                    .flex()
                    .items_start()
                    .gap(px(6.))
                    .p(px(12.))
                    .text_color(white().opacity(0.75))
                    .child(
                        Icon::new(IconName::MovieCreation)
                            .size(18.)
                            .color(white().opacity(0.75)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .child(text(Variant::Caption, self.source.filename.clone())),
                    )
                    .into_any_element(),
            },
        }
    }

    fn center(&self, center: Center, radius: Pixels, cx: &mut Context<Self>) -> Option<AnyElement> {
        let round = |id: &'static str, icon: IconName, label: &'static str| {
            base::Button::new(id)
                .accessibility_label(label)
                .size(px(64.))
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(black().opacity(0.6))
                .cursor_pointer()
                .hover(|style| style.bg(black().opacity(0.8)))
                .child(Icon::new(icon).size(40.).color(white()))
        };
        Some(match center {
            Center::Nothing => return None,
            Center::BigPlay => round("player-big-play", IconName::PlayArrow, "Play")
                .on_click(cx.listener(|view, _, window, cx| {
                    window.focus(&view.focus, cx);
                    view.toggle(cx);
                }))
                .into_any_element(),
            Center::Replay => round("player-replay", IconName::Replay, "Replay")
                .on_click(cx.listener(|view, _, _, cx| view.toggle(cx)))
                .into_any_element(),
            Center::Spinner => div()
                .id("player-spinner")
                .test_support()
                .child(Spinner::new("player-spinner-icon").size(40.).color(white()))
                .into_any_element(),
            Center::Failed(failure) => self.failure(failure, radius, cx).into_any_element(),
        })
    }

    fn failure(
        &self,
        failure: model::Failure,
        radius: Pixels,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let (title, detail) = match failure {
            model::Failure::Unsupported => (
                "Can't play this here",
                "This video's format isn't supported in the app.",
            ),
            model::Failure::Retryable => (
                "Couldn't play this video",
                "Check your connection and try again.",
            ),
        };
        let download = Button::new("player-download", "Download")
            .size(ButtonSize::Small)
            .start_icon(IconName::Download)
            .on_click(cx.listener(|view, _, _, cx| {
                view.emit_for_file(cx, |file_id| PlayerViewEvent::Download { file_id })
            }));
        let actions = match failure {
            model::Failure::Unsupported => div()
                .flex()
                .flex_wrap()
                .justify_center()
                .gap(px(8.))
                .child(download.contained())
                .child(
                    Button::new("player-open-external", "Open externally")
                        .size(ButtonSize::Small)
                        .outlined()
                        .color(white())
                        .start_icon(IconName::OpenInNew)
                        .on_click(cx.listener(|view, _, _, cx| {
                            view.emit_for_file(cx, |file_id| PlayerViewEvent::OpenExternally {
                                file_id,
                            })
                        })),
                ),
            model::Failure::Retryable => div()
                .flex()
                .flex_wrap()
                .justify_center()
                .gap(px(8.))
                .child(
                    Button::new("player-retry", "Retry")
                        .size(ButtonSize::Small)
                        .contained()
                        .start_icon(IconName::Refresh)
                        .on_click(cx.listener(|view, _, _, cx| {
                            view.playback.retry();
                            view.commanded(cx);
                        })),
                )
                .child(download.outlined().color(white())),
        };
        div()
            .id(match failure {
                model::Failure::Unsupported => "player-unsupported",
                model::Failure::Retryable => "player-error",
            })
            .test_support()
            .absolute()
            .inset_0()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(6.))
            .p(px(12.))
            .rounded(radius)
            .bg(black().opacity(0.72))
            .text_color(white())
            .child(Icon::new(IconName::ErrorOutline).size(28.).color(white()))
            .child(text(Variant::Subtitle2, title))
            .child(
                div()
                    .text_center()
                    .text_color(white().opacity(0.8))
                    .child(text(Variant::Caption, detail)),
            )
            .child(actions)
    }

    fn control_bar(&self, radius: Pixels, cx: &mut Context<Self>) -> impl IntoElement {
        let ink = Ink::on_video(cx);
        let (expand_icon, expand_label) = if self.expanded {
            (IconName::Close, "Close expanded view")
        } else {
            (IconName::OpenInFull, "Expand")
        };
        div()
            .id("player-controls")
            .test_support()
            .absolute()
            .left_0()
            .right_0()
            .bottom_0()
            .flex()
            .flex_col()
            .px(px(8.))
            .pt(px(4.))
            .pb(px(2.))
            .rounded_b(radius)
            .bg(black().opacity(0.6))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .items_center()
                    .px(px(6.))
                    .child(controls::scrubber(
                        &self.playback,
                        &self.scrub,
                        ink,
                        controls::TipAt::Above,
                        cx,
                    )),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(controls::play_button(&self.playback.phase, ink, cx))
                    .child(controls::time::<Self>(&self.playback, ink))
                    .child(div().flex_1())
                    .child(controls::mute_button(&self.playback, ink, cx))
                    .child(controls::volume_slider(&self.volume))
                    .child(
                        IconButton::new("player-expand", expand_icon, expand_label)
                            .small()
                            .color(white())
                            .on_click(cx.listener(|view, _, window, cx| {
                                let expanded = !view.expanded;
                                view.set_expanded(expanded, window, cx);
                            })),
                    ),
            )
    }

    /// Picture, centre and controls, filling whatever holds it.
    fn stage(&self, radius: Pixels, cx: &mut Context<Self>) -> Stateful<Div> {
        let shown = model::video_shown(&self.playback.phase, self.playback.has_frame(), self.awake);
        let picture = self.picture(shown.picture, radius);
        let center = self.center(shown.center, radius, cx);
        let size_badge = (self.playback.phase == Phase::Idle).then(|| {
            div()
                .absolute()
                .right(px(8.))
                .bottom(px(8.))
                .px(px(8.))
                .py(px(2.))
                .rounded(px(4.))
                .bg(black().opacity(0.7))
                .text_color(white())
                .child(text(
                    Variant::Xs,
                    crate::format::file_size(self.source.size),
                ))
        });
        div()
            .id("player-stage")
            .relative()
            .size_full()
            .overflow_hidden()
            // Content masks are rectangles, so every layer that reaches a corner rounds itself.
            .rounded(radius)
            .bg(black())
            .on_mouse_move(cx.listener(|view, _: &MouseMoveEvent, _, cx| view.wake(cx)))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|view, _, window, cx| window.focus(&view.focus, cx)),
            )
            .child(picture)
            .children(center.map(|center| {
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(center)
            }))
            .children(size_badge)
            .when(shown.controls, |el| el.child(self.control_bar(radius, cx)))
    }
}

impl PlayerView for VideoPlayer {
    fn playback(&mut self) -> &mut Playback {
        &mut self.playback
    }

    fn scrub(&mut self) -> &mut Scrub {
        &mut self.scrub
    }

    fn commanded(&mut self, cx: &mut Context<Self>) {
        self.sync(cx);
        self.wake(cx);
        cx.notify();
    }
}

impl Render for VideoPlayer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Frames write their textures off-thread; while video plays, draw every frame. Otherwise
        // a frame (a seek's landing, the poster frame) wakes the inbox instead.
        let animating = self.playback.phase == Phase::Playing && self.playback.has_video;
        self.playback
            .inbox
            .animating
            .store(animating, Ordering::Release);
        if animating {
            window.request_animation_frame();
        }
        let (width, height) = self.size;
        let border = cx.sem().divider;
        let inline = div()
            .id(("video-player", cx.entity_id()))
            .relative()
            .w(px(width))
            .max_w_full()
            .aspect_ratio(width / height)
            .rounded(px(8.))
            .border_1()
            .border_color(border)
            // No fill: the stage paints the black inside the border, so the translucent divider
            // reads as the theme's divider rather than as black.
            .overflow_hidden();
        if !self.expanded {
            return inline
                .track_focus(&self.focus)
                .key_context("VideoPlayer")
                .on_key_down(cx.listener(Self::on_key))
                .child(self.stage(px(7.), cx));
        }
        let viewport = window.viewport_size();
        let overlay = div()
            .id("player-overlay")
            .test_support()
            .track_focus(&self.focus)
            .key_context("VideoPlayer")
            .on_key_down(cx.listener(Self::on_key))
            .occlude()
            .w(viewport.width)
            .h(viewport.height)
            .bg(black())
            .child(self.stage(px(0.), cx));
        inline
            .child(
                div()
                    .absolute()
                    .inset_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(cx.sem().text_secondary)
                    .child(text(Variant::Caption, "Playing in the expanded view")),
            )
            .child(
                deferred(anchored().position(point(px(0.), px(0.))).child(overlay))
                    .with_priority(2),
            )
    }
}
