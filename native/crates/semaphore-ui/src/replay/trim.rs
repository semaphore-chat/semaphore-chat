//! The trim timeline, after `TrimTimeline.tsx` and the states of `TrimPreview.tsx`: a start and
//! an end handle over the buffer, a ruler, the times, and Refresh.
//!
//! - **The preview** ([`TrimPreview`]) sits above it while the timeline is shown, the buffer has
//!   something and the window has [`Players`] (the app built with its player). Then the track
//!   draws the playhead, a press on a handle drags it and a press anywhere else seeks there, a
//!   start handle dragged past the playhead takes the playhead with it, and Refresh (in the
//!   preview's controls) reopens the preview at the playhead with the newest segments.
//! - **Without a player** a press moves the nearer handle there, and Refresh sits in the header.

use super::model::{self, Handle, TrimRange};
use super::preview::{PreviewEvent, TrimPreview};
use crate::kit::{Alert, Button, IconButton, Severity, Spinner, Variant, text, with_tip};
use crate::panel::common::is_phone;
use crate::player::Players;
use crate::theme::SemTheme as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{LoadState, ReplaySessionView, ReplayTrim};
use semaphore_design::Icon as IconName;
use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

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
    /// The window's players: `None` in a build without them (no preview).
    players: Option<Players>,
    /// The recording session, whose buffer the preview plays.
    session_id: Option<String>,
    /// The timeline is on screen (the dialog's trim is open): only then is a preview open.
    shown: bool,
    preview: Option<(Entity<TrimPreview>, [Subscription; 2])>,
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
            players: None,
            session_id: None,
            shown: false,
            preview: None,
        }
    }

    /// The window's players, for the preview; `None` keeps the timeline without one.
    pub fn set_players(&mut self, players: Option<Players>, cx: &mut Context<Self>) {
        self.players = players;
        self.sync_preview(cx);
    }

    /// The buffer's recording session (`ReplayState::Recording`), or `None` when not recording.
    pub fn set_session_id(&mut self, session_id: Option<String>, cx: &mut Context<Self>) {
        if self.session_id != session_id {
            self.session_id = session_id;
            self.preview = None;
        }
        self.sync_preview(cx);
    }

    /// Whether the timeline is on screen. Hidden, the preview closes and frees its player.
    pub fn set_shown(&mut self, shown: bool, cx: &mut Context<Self>) {
        self.shown = shown;
        self.sync_preview(cx);
    }

    /// Opens the preview when it can play, closes it when it can't.
    fn sync_preview(&mut self, cx: &mut Context<Self>) {
        let wanted = self.shown && self.range.is_some() && self.session_id.is_some();
        match (&self.players, wanted, &self.preview) {
            (Some(players), true, None) => {
                let (Some(range), Some(session_id)) = (self.range, self.session_id.clone()) else {
                    return;
                };
                let players = players.clone();
                let preview = cx.new(|cx| {
                    TrimPreview::new(&players, session_id, secs(range.start), secs(range.end), cx)
                });
                let subscriptions = [
                    cx.observe(&preview, |_, _, cx| cx.notify()),
                    cx.subscribe(&preview, |view, _, event: &PreviewEvent, cx| match event {
                        PreviewEvent::Refresh => view.refresh(cx),
                    }),
                ];
                self.preview = Some((preview, subscriptions));
                self.sync_selection(cx);
            }
            (None, _, Some(_)) | (_, false, Some(_)) => self.preview = None,
            _ => {}
        }
        cx.notify();
    }

    /// Hands the preview the selection and whether more has been recorded.
    fn sync_selection(&mut self, cx: &mut Context<Self>) {
        let (Some((preview, _)), Some(range)) = (&self.preview, self.range) else {
            return;
        };
        let has_more = self.has_more();
        preview.update(cx, |preview, cx| {
            preview.set_selection(secs(range.start), secs(range.end), cx);
            preview.set_has_more(has_more, cx);
        });
    }

    /// The preview, while one is open.
    pub fn preview_entity(&self) -> Option<&Entity<TrimPreview>> {
        self.preview.as_ref().map(|(preview, _)| preview)
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
        self.sync_preview(cx);
        self.sync_selection(cx);
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

    /// Refresh: take the buffer's newest length, and reopen the preview with its newest
    /// segments at the playhead.
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        if let Some(range) = &mut self.range {
            let before = *range;
            range.refresh(self.latest);
            if *range != before {
                cx.emit(TrimEvent::Changed(range.trim()));
            }
            self.sync_selection(cx);
            if let Some((preview, _)) = &self.preview {
                preview.update(cx, |preview, cx| preview.refresh(cx));
            }
            cx.notify();
        }
    }

    /// Moves a handle (a drag, the keys, a test).
    pub fn set_handle(&mut self, handle: Handle, seconds: u32, cx: &mut Context<Self>) {
        self.change(cx, |range| range.set(handle, seconds));
    }

    /// The preview of the selection, while the timeline is shown and the window has a player.
    pub fn preview(&self) -> Option<AnyView> {
        self.preview_entity().map(|preview| preview.clone().into())
    }

    /// The preview's playhead, if one is open.
    fn playhead(&self, cx: &App) -> Option<Duration> {
        self.preview_entity()
            .map(|preview| preview.read(cx).position())
    }

    /// Seeks the preview to `seconds` on the buffer (a press on the track away from a handle).
    pub fn seek_to(&mut self, seconds: f32, cx: &mut Context<Self>) {
        let Some(range) = self.range else {
            return;
        };
        let to = Duration::from_secs_f32(seconds.clamp(0., range.max as f32));
        if let Some((preview, _)) = &self.preview {
            preview.update(cx, |preview, cx| preview.seek(to, cx));
        }
    }

    fn change(&mut self, cx: &mut Context<Self>, edit: impl FnOnce(&mut TrimRange)) {
        let Some(range) = &mut self.range else {
            return;
        };
        let before = *range;
        edit(range);
        if *range != before {
            let range = *range;
            cx.emit(TrimEvent::Changed(range.trim()));
            self.sync_selection(cx);
            // A start dragged past the playhead takes it along, as on the web.
            if range.start != before.start
                && let Some(playhead) = self.playhead(cx)
                && playhead < secs(range.start)
                && let Some((preview, _)) = &self.preview
            {
                preview.update(cx, |preview, cx| preview.seek(secs(range.start), cx));
            }
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
        let playhead = self
            .playhead(cx)
            .map(|at| (at.as_secs_f32() / range.max.max(1) as f32).clamp(0., 1.));
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
            .children(playhead.map(|at| {
                div()
                    .id("trim-playhead")
                    .test_support()
                    .absolute()
                    .top(px(-4.))
                    .bottom(px(-4.))
                    .left(relative(at))
                    .ml(px(-1.))
                    .w(px(2.))
                    .rounded(px(1.))
                    .bg(sem.text_primary)
            }))
            .child(handle(Handle::Start, start, sem.success))
            .child(handle(Handle::End, end, sem.error))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|view, event: &MouseDownEvent, window, cx| {
                    let (Some(fraction), Some(range), Some(bounds)) =
                        (view.fraction(event.position), view.range, view.bounds.get())
                    else {
                        return;
                    };
                    let handle = if view.preview.is_some() {
                        let x = f32::from(event.position.x - bounds.origin.x);
                        match range.handle_at(x, f32::from(bounds.size.width)) {
                            Some(handle) => handle,
                            None => {
                                window.focus(&view.focus, cx);
                                cx.stop_propagation();
                                view.seek_to(fraction * range.max as f32, cx);
                                return;
                            }
                        }
                    } else {
                        range.nearest(fraction)
                    };
                    view.drag = Some(handle);
                    view.keyed = handle;
                    window.focus(&view.focus, cx);
                    cx.stop_propagation();
                    if view.preview.is_none() {
                        view.change(cx, |range| {
                            let at = range.seconds_at(fraction);
                            range.set(handle, at);
                        });
                    }
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
                    .when(self.preview.is_none(), |el| el.child(refresh)),
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

fn secs(seconds: u32) -> Duration {
    Duration::from_secs(seconds.into())
}
