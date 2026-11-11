//! What both players draw: the scrubber (buffered and played ranges, a hover time, click and
//! drag to seek), the play button, the time and the volume. Generic over the view, which owns
//! the [`Playback`] and the [`Scrub`].

use super::model::{self, Phase};
use super::session::Playback;
use crate::kit::{IconButton, Slider, Variant, text};
use crate::theme::SemTheme as _;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::slider::SliderState;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use std::cell::Cell;
use std::rc::Rc;

/// The views both players are.
pub(crate) trait PlayerView: Render + Sized + 'static {
    fn playback(&mut self) -> &mut Playback;
    fn scrub(&mut self) -> &mut Scrub;
    /// After a command: take what the player answered, redraw, wake the controls.
    fn commanded(&mut self, cx: &mut Context<Self>);
}

/// The scrubber's pointer state.
#[derive(Default)]
pub(crate) struct Scrub {
    /// The track's bounds as last painted: pointer positions map through them.
    pub bounds: Rc<Cell<Option<Bounds<Pixels>>>>,
    /// The fraction under the pointer.
    pub hover: Option<f32>,
    /// Pressed and dragging: the fraction it will seek to on release.
    pub drag: Option<f32>,
}

impl Scrub {
    fn fraction(&self, position: Point<Pixels>) -> Option<f32> {
        let bounds = self.bounds.get()?;
        Some(model::fraction_at(
            f32::from(position.x),
            f32::from(bounds.origin.x),
            f32::from(bounds.size.width),
        ))
    }
}

/// Colours of the controls: over video (always light on dark) or on a card (the theme's).
#[derive(Clone, Copy)]
pub(crate) struct Ink {
    pub text: Hsla,
    pub icon: Hsla,
    pub track: Hsla,
    pub buffered: Hsla,
    pub played: Hsla,
    pub tip_bg: Hsla,
}

impl Ink {
    pub fn on_video(cx: &App) -> Self {
        let white = gpui_kit::white();
        Self {
            text: white,
            icon: white,
            track: white.opacity(0.25),
            buffered: white.opacity(0.5),
            played: cx.sem().primary,
            tip_bg: black().opacity(0.85),
        }
    }

    pub fn on_card(cx: &App) -> Self {
        let sem = cx.sem();
        Self {
            text: sem.text_secondary,
            icon: sem.action_active,
            track: sem.progress_track,
            buffered: sem.text_disabled,
            played: sem.primary,
            // Opaque: on a card the tip sits over the file name, which would show through.
            tip_bg: Hsla {
                a: 1.,
                ..sem.tooltip_bg
            },
        }
    }
}

pub(crate) fn scrubber<V: PlayerView>(
    playback: &Playback,
    scrub: &Scrub,
    ink: Ink,
    cx: &mut Context<V>,
) -> impl IntoElement + use<V> {
    let enabled = playback.phase.is_open() && playback.duration.is_some();
    let played = scrub
        .drag
        .unwrap_or_else(|| model::played_fraction(playback.position, playback.duration));
    let track = div()
        .absolute()
        .left_0()
        .right_0()
        .top(px(8.))
        .h(px(4.))
        .rounded(px(2.))
        .bg(ink.track)
        .children(playback.buffered.iter().map(|range| {
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left(relative(range.start.clamp(0., 1.)))
                .w(relative((range.end - range.start).clamp(0., 1.)))
                .rounded(px(2.))
                .bg(ink.buffered)
        }))
        .child(
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left_0()
                .w(relative(played))
                .rounded(px(2.))
                .bg(ink.played),
        );
    let bounds = scrub.bounds.clone();
    let measure = canvas(move |b, _, _| bounds.set(Some(b)), |_, _, _, _| {})
        .absolute()
        .size_full();
    let thumb = div()
        .absolute()
        .top(px(4.))
        .left(relative(played))
        .ml(px(-6.))
        .size(px(12.))
        .rounded_full()
        .bg(ink.played);
    let hover_tip =
        scrub
            .hover
            .filter(|_| enabled)
            .zip(playback.duration)
            .map(|(fraction, duration)| {
                div()
                    .id("player-hover-time")
                    .test_support()
                    .absolute()
                    .bottom(px(20.))
                    .left(relative(fraction))
                    .ml(px(-22.))
                    .w(px(44.))
                    .flex()
                    .justify_center()
                    .py(px(2.))
                    .rounded(px(4.))
                    .bg(ink.tip_bg)
                    .text_color(gpui_kit::white())
                    .child(text(
                        Variant::Xs,
                        model::format_time(model::time_at(fraction, duration)),
                    ))
            });
    let mut element = div()
        .id("player-scrubber")
        .test_support()
        .role(Role::Slider)
        .aria_label("Seek")
        .relative()
        .flex_1()
        .min_w(px(40.))
        .h(px(20.))
        .child(measure)
        .child(track)
        .when(enabled, |el| el.child(thumb))
        .children(hover_tip);
    if enabled {
        element = element
            .cursor_pointer()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|view, event: &MouseDownEvent, _, cx| {
                    let scrub = view.scrub();
                    if let Some(fraction) = scrub.fraction(event.position) {
                        scrub.drag = Some(fraction);
                        scrub.hover = Some(fraction);
                        cx.stop_propagation();
                        cx.notify();
                    }
                }),
            )
            .on_mouse_move(cx.listener(|view, event: &MouseMoveEvent, _, cx| {
                let scrub = view.scrub();
                let Some(fraction) = scrub.fraction(event.position) else {
                    return;
                };
                if scrub.drag.is_some() && event.pressed_button == Some(MouseButton::Left) {
                    scrub.drag = Some(fraction);
                }
                if scrub.hover != Some(fraction) {
                    scrub.hover = Some(fraction);
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|view, _: &MouseUpEvent, _, cx| finish_drag(view, cx)),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|view, _: &MouseUpEvent, _, cx| finish_drag(view, cx)),
            )
            .on_hover(cx.listener(|view, hovered: &bool, _, cx| {
                if !*hovered && view.scrub().hover.take().is_some() {
                    cx.notify();
                }
            }));
    }
    element
}

fn finish_drag<V: PlayerView>(view: &mut V, cx: &mut Context<V>) {
    let Some(fraction) = view.scrub().drag.take() else {
        return;
    };
    let playback = view.playback();
    if let Some(duration) = playback.duration {
        playback.seek(model::time_at(fraction, duration));
    }
    view.commanded(cx);
}

/// Play, Pause or Replay, as the state says.
pub(crate) fn play_button<V: PlayerView>(
    phase: &Phase,
    ink: Ink,
    cx: &mut Context<V>,
) -> impl IntoElement + use<V> {
    let (icon, label) = match phase {
        Phase::Playing | Phase::Buffering => (IconName::Pause, "Pause"),
        Phase::Ended => (IconName::Replay, "Replay"),
        _ => (IconName::PlayArrow, "Play"),
    };
    IconButton::new("player-play", icon, label)
        .small()
        .color(ink.icon)
        .disabled(matches!(phase, Phase::Loading | Phase::Failed(_)))
        .on_click(cx.listener(|view, _, _, cx| {
            view.playback().toggle();
            view.commanded(cx);
        }))
}

pub(crate) fn time<V: PlayerView>(playback: &Playback, ink: Ink) -> impl IntoElement + use<V> {
    div()
        .id("player-time")
        .test_support()
        .flex_none()
        .whitespace_nowrap()
        .text_color(ink.text)
        .child(text(
            Variant::Caption,
            model::time_label(playback.position, playback.duration),
        ))
}

pub(crate) fn mute_button<V: PlayerView>(
    playback: &Playback,
    ink: Ink,
    cx: &mut Context<V>,
) -> impl IntoElement + use<V> {
    let muted = playback.muted || playback.volume == 0.;
    let (icon, label) = if muted {
        (IconName::VolumeOff, "Unmute")
    } else {
        (IconName::VolumeUp, "Mute")
    };
    IconButton::new("player-mute", icon, label)
        .small()
        .color(ink.icon)
        .on_click(cx.listener(|view, _, _, cx| {
            view.playback().toggle_mute();
            view.commanded(cx);
        }))
}

pub(crate) fn volume_slider(state: &Entity<SliderState>) -> impl IntoElement {
    div()
        .id("player-volume")
        .test_support()
        .flex_none()
        .w(px(64.))
        .mx(px(6.))
        .child(Slider::new(state, "Volume"))
}

/// The slider's state for a volume of 0.0 to 1.0, shown as 0 to 100.
pub(crate) fn volume_state(cx: &mut App) -> Entity<SliderState> {
    cx.new(|_| {
        SliderState::new()
            .min(0.)
            .max(100.)
            .step(1.)
            .default_value(100.)
    })
}
