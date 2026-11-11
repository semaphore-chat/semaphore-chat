//! The trim timeline, after `TrimTimeline.tsx` and the states of `TrimPreview.tsx`: a start and
//! an end handle over the buffer, a ruler, the times, and Refresh. No preview yet: the player
//! can't read the buffer's MPEG-TS segments, so [`TrimTimeline::preview`] is where it goes later.

use super::model::{self, Handle, TrimRange};
use crate::kit::{Alert, Button, IconButton, Severity, Spinner, Variant, text, with_tip};
use crate::panel::common::is_phone;
use crate::theme::SemTheme as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, ReplaySessionView, ReplayTrim};
use semaphore_design::Icon as IconName;
use std::cell::Cell;
use std::rc::Rc;

/// What the timeline asks of its owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrimEvent {
    /// The range moved (and once when the timeline first loads, with the last minute).
    Changed(ReplayTrim),
    /// The session view failed and the user asked again: `Core::retry_failed`.
    Retry,
}

/// Seconds the arrow keys move a handle, and with shift.
const STEP: i64 = 1;
const BIG_STEP: i64 = 10;
/// Room at each side for the ruler's first and last labels.
const GUTTER: f32 = 20.;

pub struct TrimTimeline {
    session: ReplaySessionView,
    range: Option<TrimRange>,
    /// The buffer's newest length, which Refresh applies.
    latest: u32,
    drag: Option<Handle>,
    /// The handle the arrow keys move: the last one pressed.
    keyed: Handle,
    focus: FocusHandle,
    bounds: Rc<Cell<Option<Bounds<Pixels>>>>,
}

impl EventEmitter<TrimEvent> for TrimTimeline {}

impl TrimTimeline {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            session: ReplaySessionView::default(),
            range: None,
            latest: 0,
            drag: None,
            keyed: Handle::End,
            focus: cx.focus_handle(),
            bounds: Rc::default(),
        }
    }

    /// Core's `replay_session()`. The first view with something buffered sets the range to the
    /// last minute; after that the length holds still until Refresh, as on the web.
    pub fn set_session(&mut self, session: ReplaySessionView, cx: &mut Context<Self>) {
        self.latest = session.total_seconds;
        if !session.active && session.state == LoadState::Ready {
            self.range = None;
        } else if self.range.is_none()
            && session.active
            && let Some(range) = TrimRange::new(session.total_seconds)
        {
            self.range = Some(range);
            cx.emit(TrimEvent::Changed(range.trim()));
        }
        self.session = session;
        cx.notify();
    }

    /// The range now, if the buffer holds anything.
    pub fn range(&self) -> Option<TrimRange> {
        self.range
    }

    /// The buffer grew since the timeline froze its length.
    pub fn has_more(&self) -> bool {
        self.range.is_some_and(|range| self.latest != range.max)
    }

    /// Refresh: take the buffer's newest length.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        if let Some(range) = &mut self.range {
            let before = *range;
            range.refresh(self.latest);
            if *range != before {
                cx.emit(TrimEvent::Changed(range.trim()));
            }
            cx.notify();
        }
    }

    /// Moves a handle (a drag, the keys, a test).
    pub fn set_handle(&mut self, handle: Handle, seconds: u32, cx: &mut Context<Self>) {
        self.change(cx, |range| range.set(handle, seconds));
    }

    /// Where a preview of the selection will go: `None` until the player reads HLS.
    pub fn preview(&self) -> Option<AnyView> {
        None
    }

    fn change(&mut self, cx: &mut Context<Self>, edit: impl FnOnce(&mut TrimRange)) {
        let Some(range) = &mut self.range else {
            return;
        };
        let before = *range;
        edit(range);
        if *range != before {
            cx.emit(TrimEvent::Changed(range.trim()));
            cx.notify();
        }
    }

    fn fraction(&self, position: Point<Pixels>) -> Option<f32> {
        let bounds = self.bounds.get()?;
        Some(crate::player::model::fraction_at(
            f32::from(position.x),
            f32::from(bounds.origin.x),
            f32::from(bounds.size.width),
        ))
    }

    fn on_key(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let step = if event.keystroke.modifiers.shift {
            BIG_STEP
        } else {
            STEP
        };
        let delta = match event.keystroke.key.as_str() {
            "left" | "down" => -step,
            "right" | "up" => step,
            _ => return,
        };
        cx.stop_propagation();
        let handle = self.keyed;
        self.change(cx, |range| range.nudge(handle, delta));
    }

    fn track(
        &self,
        range: TrimRange,
        phone: bool,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let sem = cx.sem().clone();
        let (start, end) = (range.fraction(Handle::Start), range.fraction(Handle::End));
        let dim = black().opacity(if sem.is_dark { 0.55 } else { 0.35 });
        let focused = self.focus.is_focused(window);
        let handle = |handle: Handle, at: f32, color: Hsla| {
            let keyed = focused && self.keyed == handle;
            div()
                .id(match handle {
                    Handle::Start => "trim-start",
                    Handle::End => "trim-end",
                })
                .test_support()
                .role(Role::Slider)
                .aria_label(match handle {
                    Handle::Start => "Trim start time",
                    Handle::End => "Trim end time",
                })
                .absolute()
                .top_0()
                .bottom_0()
                .left(relative(at))
                .ml(px(-6.))
                .w(px(12.))
                .bg(color)
                .rounded(px(4.))
                .cursor(CursorStyle::ResizeLeftRight)
                .when(keyed, |el| el.border_2().border_color(sem.text_primary))
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .w(px(3.))
                        .h(px(if phone { 48. } else { 40. }))
                        .rounded(px(2.))
                        .bg(white().opacity(0.85)),
                )
        };
        let bounds = self.bounds.clone();
        let measure = canvas(move |b, _, _| bounds.set(Some(b)), |_, _, _, _| {})
            .absolute()
            .size_full();
        div()
            .id("trim-track")
            .test_support()
            .track_focus(&self.focus)
            .key_context("TrimTimeline")
            .on_key_down(cx.listener(Self::on_key))
            .relative()
            .h(px(if phone { 100. } else { 80. }))
            .rounded(px(8.))
            .border_1()
            .border_color(sem.divider)
            .bg(sem.action_selected)
            .cursor_pointer()
            .child(measure)
            // Dimmed outside the selection.
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left_0()
                    .w(relative(start))
                    .rounded_l(px(8.))
                    .bg(dim),
            )
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right_0()
                    .w(relative(1. - end))
                    .rounded_r(px(8.))
                    .bg(dim),
            )
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(relative(start))
                    .w(relative(end - start))
                    .bg(sem.primary.opacity(0.22))
                    .border_t(px(3.))
                    .border_b(px(3.))
                    .border_color(sem.primary),
            )
            .child(handle(Handle::Start, start, sem.success))
            .child(handle(Handle::End, end, sem.error))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|view, event: &MouseDownEvent, window, cx| {
                    let (Some(fraction), Some(range)) = (view.fraction(event.position), view.range)
                    else {
                        return;
                    };
                    let handle = range.nearest(fraction);
                    view.drag = Some(handle);
                    view.keyed = handle;
                    window.focus(&view.focus, cx);
                    cx.stop_propagation();
                    view.change(cx, |range| {
                        let at = range.seconds_at(fraction);
                        range.set(handle, at);
                    });
                    cx.notify();
                }),
            )
            .on_mouse_move(cx.listener(|view, event: &MouseMoveEvent, _, cx| {
                let (Some(handle), Some(fraction)) = (view.drag, view.fraction(event.position))
                else {
                    return;
                };
                if event.pressed_button != Some(MouseButton::Left) {
                    view.drag = None;
                    return;
                }
                view.change(cx, |range| {
                    let at = range.seconds_at(fraction);
                    range.set(handle, at);
                });
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|view, _: &MouseUpEvent, _, _| view.drag = None),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|view, _: &MouseUpEvent, _, _| view.drag = None),
            )
    }

    fn timeline(
        &self,
        range: TrimRange,
        phone: bool,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let sem = cx.sem().clone();
        let ruler = div().relative().h(px(20.)).mb(px(4.)).children(
            model::ruler_marks(range.max, if phone { 5 } else { 13 })
                .into_iter()
                .map(|mark| {
                    div()
                        .absolute()
                        .top_0()
                        .left(relative(mark as f32 / range.max as f32))
                        .ml(px(-GUTTER))
                        .w(px(GUTTER * 2.))
                        .flex()
                        .justify_center()
                        .text_color(sem.text_secondary)
                        .child(text(Variant::Xs, model::clock(mark)))
                }),
        );
        let refresh = with_tip(
            div().id("trim-refresh-tip").child(
                IconButton::new("trim-refresh", IconName::Refresh, "Refresh segments")
                    .small()
                    .selected(self.has_more())
                    .on_click(cx.listener(|view, _, _, cx| view.refresh(cx))),
            ),
            if self.has_more() {
                "Refresh segments: more has been recorded"
            } else {
                "Refresh segments"
            },
        );
        let times = div()
            .flex()
            .flex_wrap()
            .justify_between()
            .items_center()
            .gap(px(8.))
            .mt(px(12.))
            .child(
                text(
                    Variant::Body2,
                    format!("Start: {}", model::clock(range.start)),
                )
                .text_color(sem.success),
            )
            .child(
                text(
                    Variant::Subtitle2,
                    format!("Duration: {}", model::clock(range.duration())),
                )
                .text_color(sem.text_primary),
            )
            .child(
                text(Variant::Body2, format!("End: {}", model::clock(range.end)))
                    .text_color(sem.error),
            );
        div()
            .flex()
            .flex_col()
            .children(self.preview())
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .mb(px(4.))
                    .child(text(Variant::Subtitle2, "Trim the clip").text_color(sem.text_primary))
                    .child(refresh),
            )
            .child(
                div()
                    .px(px(GUTTER))
                    .child(ruler)
                    .child(self.track(range, phone, window, cx)),
            )
            .child(times)
            .child(
                text(
                    Variant::Caption,
                    format!(
                        "Drag the green and red handles, or use the arrow keys, to set the clip. \
                         Buffer: {} total",
                        model::clock(range.max)
                    ),
                )
                .text_color(sem.text_secondary)
                .mt(px(8.)),
            )
    }
}

impl Render for TrimTimeline {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let phone = is_phone(window);
        let body = match (&self.session.state, self.range) {
            (_, Some(range)) => self.timeline(range, phone, window, cx).into_any_element(),
            (LoadState::Loading, None) => div()
                .flex()
                .justify_center()
                .py(px(32.))
                .child(Spinner::new("trim-loading").size(32.))
                .into_any_element(),
            (LoadState::Failed { error }, None) => div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(Alert::new(
                    Severity::Error,
                    format!("Couldn't load the replay: {}", error.message),
                ))
                .child(
                    div().child(
                        Button::new("trim-retry", "Try again")
                            .outlined()
                            .on_click(cx.listener(|_, _, _, cx| cx.emit(TrimEvent::Retry))),
                    ),
                )
                .into_any_element(),
            (LoadState::Ready, None) if !self.session.active => Alert::new(
                Severity::Info,
                "No replay yet. Start screen sharing to record a replay.",
            )
            .into_any_element(),
            (LoadState::Ready, None) => Alert::new(
                Severity::Info,
                "Getting your replay ready — keep sharing your screen for a few seconds.",
            )
            .into_any_element(),
        };
        div()
            .id("trim-timeline")
            .test_support()
            .w_full()
            .child(body)
    }
}
