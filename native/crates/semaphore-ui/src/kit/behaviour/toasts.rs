//! The toast-queue host (`design/guide/behaviour.md`, "Toast queue"), the native side of the web's
//! `hosts/toasts.ts`: one toast on screen at a time, the rest waiting, each gone after its timer
//! unless something holds it.
//!
//! Screens show toasts through [`Toasts`] (`Toasts::of(window, cx)`), from an event handler or a
//! task: it needs no window, so a result that lands later can show one. They never render a
//! `Toast` themselves: the window's one [`ToastRegion`] draws the showing toast at the foot of the
//! window. A toast's id names its subject (`replay-toast`, `offline`): showing it again replaces
//! it, and it is also the toast's element id, so a rig can wait for it.
//!
//! The reasons to pause (rule 15) are read each time the region renders: the pointer on it, focus
//! in it, the window inactive, and a dialog or sheet in the overlay stack. The host sends one
//! `pause` when they start to hold and one `resume` when the last one ends.

use super::BehaviourHost;
use super::machine::{Machine, drive_app};
use super::overlay::LayerKind;
use crate::kit::{Toast, ToastTone};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
pub use semaphore_design::behaviour::toast_queue::Tone as ToastQueueTone;
use semaphore_design::behaviour::toast_queue::{self, Effect, Event, Params, State};
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

type ToastAction = Rc<dyn Fn(&mut Window, &mut App)>;

/// What a screen asks for: one notice.
#[derive(Clone)]
pub struct ToastRequest {
    id: Option<String>,
    tone: ToastQueueTone,
    message: String,
    action: Option<(String, ToastAction)>,
}

impl ToastRequest {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            id: None,
            tone: ToastQueueTone::Neutral,
            message: message.into(),
            action: None,
        }
    }

    /// One id per subject: showing it again replaces it. Default: a fresh id.
    pub fn id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    pub fn positive(mut self) -> Self {
        self.tone = ToastQueueTone::Positive;
        self
    }

    /// Interrupts the screen reader, and never drops out of the queue.
    pub fn danger(mut self) -> Self {
        self.tone = ToastQueueTone::Danger;
        self
    }

    /// One action, a text button ("Undo"). Pressing it dismisses the toast, then runs `run`, so a
    /// follow-up `run` shows under the same id stays.
    pub fn action(
        mut self,
        label: impl Into<String>,
        run: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.action = Some((label.into(), Rc::new(run)));
        self
    }
}

type QueueMachine = Machine<State, Event, Effect, Params>;

pub(crate) struct ToastHost {
    machine: QueueMachine,
    actions: HashMap<String, ToastAction>,
    next_id: u64,
    /// The region's own focus: focus in it is "focus inside the toast area".
    pub(crate) region: Option<FocusHandle>,
    /// Focus was in the region when it last rendered.
    focus_inside: bool,
    /// The pointer is on the region.
    pointer: bool,
    /// The element focused last outside the region: where focus goes back to.
    before: Option<WeakFocusHandle>,
}

impl ToastHost {
    pub(crate) fn new() -> Self {
        let params = Params::default();
        Self {
            machine: Machine::new(toast_queue::step, toast_queue::initial(&params), params),
            actions: HashMap::new(),
            next_id: 0,
            region: None,
            focus_inside: false,
            pointer: false,
            before: None,
        }
    }

    pub(crate) fn state(&self) -> &State {
        self.machine.state()
    }

    /// Forgets the actions of toasts that are gone.
    fn prune(&mut self) {
        let state = self.machine.state();
        let live: Vec<String> = state
            .showing
            .iter()
            .chain(&state.queue)
            .map(|toast| toast.id.clone())
            .collect();
        self.actions.retain(|id, _| live.contains(id));
    }
}

fn queue(host: &mut BehaviourHost) -> &mut QueueMachine {
    &mut host.toasts.machine
}

/// The toasts of one window. Cheap to clone; the same for the life of the window. It finds the
/// window's host each time it is used, so it can be made before the host exists (a root view's
/// constructor); without a host, showing does nothing.
#[derive(Clone)]
pub struct Toasts {
    window: AnyWindowHandle,
}

impl Toasts {
    /// The toasts of `window`.
    pub fn of(window: &Window, _cx: &App) -> Option<Toasts> {
        Some(Self::for_window(window.window_handle()))
    }

    /// The toasts of the window `handle` names.
    pub fn for_window(window: AnyWindowHandle) -> Toasts {
        Toasts { window }
    }

    fn host(&self, cx: &App) -> Option<Entity<BehaviourHost>> {
        BehaviourHost::for_window(self.window.window_id(), cx)
    }

    /// Shows a toast, or queues it behind the one showing. Returns its id.
    pub fn show(&self, request: ToastRequest, cx: &mut App) -> String {
        let Some(host) = self.host(cx) else {
            return request.id.unwrap_or_default();
        };
        let ToastRequest {
            id,
            tone,
            message,
            action,
        } = request;
        let id = host.update(cx, |host, _| {
            let id = id.unwrap_or_else(|| {
                host.toasts.next_id += 1;
                format!("toast-{}", host.toasts.next_id)
            });
            match &action {
                Some((_, run)) => host.toasts.actions.insert(id.clone(), run.clone()),
                None => host.toasts.actions.remove(&id),
            };
            id
        });
        let toast = toast_queue::Toast {
            id: id.clone(),
            tone,
            message,
            action: action.map(|(label, _)| label),
        };
        self.send(&host, Event::Show { toast }, cx);
        id
    }

    /// Takes the toast away, showing or waiting. An id that is not there does nothing.
    pub fn dismiss(&self, id: &str, cx: &mut App) {
        let Some(host) = self.host(cx) else {
            return;
        };
        let focus_inside = host.read(cx).toasts.focus_inside;
        self.send(
            &host,
            Event::Dismiss {
                id: id.to_owned(),
                focus_inside,
            },
            cx,
        );
    }

    /// The toast's action was pressed: dismiss it, then run the action.
    fn act(&self, id: &str, window: &mut Window, cx: &mut App) {
        let action = self
            .host(cx)
            .and_then(|host| host.read(cx).toasts.actions.get(id).cloned());
        self.dismiss(id, cx);
        if let Some(action) = action {
            action(window, cx);
        }
    }

    /// The message of the toast `id` names, showing or waiting, for rigs and tests.
    pub fn message_of(&self, id: &str, cx: &App) -> Option<String> {
        let host = self.host(cx)?;
        let state = host.read(cx).toasts.state();
        state
            .showing
            .iter()
            .chain(&state.queue)
            .find(|toast| toast.id == id)
            .map(|toast| toast.message.clone())
    }

    /// The message of the toast showing, for rigs and tests.
    pub fn showing(&self, cx: &App) -> Option<String> {
        let host = self.host(cx)?;
        let showing = host.read(cx).toasts.state().showing.clone();
        showing.map(|toast| toast.message)
    }

    fn send(&self, host: &Entity<BehaviourHost>, event: Event, cx: &mut App) {
        let was_empty = host.read(cx).toasts.state().showing.is_none();
        let this = self.clone();
        drive_app(host, queue, event, cx, |effect, cx| this.apply(effect, cx));
        host.update(cx, |host, _| host.toasts.prune());
        // Rule 13: a toast that shows from empty while a reason holds is paused at once, without
        // waiting for a frame (a hidden window may draw none). Through the window, after this
        // update: the caller may be updating it now.
        if was_empty && host.read(cx).toasts.state().showing.is_some() {
            let window = self.window;
            cx.defer(move |cx| {
                window
                    .update(cx, |_, window, cx| {
                        if let Some(host) = BehaviourHost::of(window, cx) {
                            sync_pause(&host, window, cx);
                        }
                    })
                    .ok();
            });
        }
        cx.refresh_windows();
    }

    fn apply(&self, effect: Effect, cx: &mut App) {
        match effect {
            Effect::StartTimer { token, ms } => {
                let Some(host) = self.host(cx) else {
                    return;
                };
                // Rule 17: a wait that ends at the same moment as the showing toast's timer goes
                // second, so the toast whose turn has come shows.
                let wait = host.read(cx).toasts.state().waits.contains(&Some(token));
                let this = self.clone();
                cx.spawn(async move |cx| {
                    let executor = cx.background_executor().clone();
                    executor.timer(Duration::from_millis(ms.into())).await;
                    if wait {
                        executor.timer(Duration::ZERO).await;
                    }
                    cx.update(|cx| {
                        if let Some(host) = this.host(cx) {
                            this.send(&host, Event::TimerFired { token }, cx);
                        }
                    });
                })
                .detach();
            }
            // A stale token does nothing when its timer fires, so there is nothing to stop.
            Effect::CancelTimer { .. } => {}
            Effect::Announce {
                message,
                politeness,
                action,
            } => {
                if let Some(host) = self.host(cx) {
                    let text = match action {
                        Some(action) => format!("{message}. {action}"),
                        None => message,
                    };
                    host.update(cx, |host, _| host.announcer.say(text, politeness));
                }
            }
            Effect::ReturnFocus => {
                let window = self.window;
                cx.defer(move |cx| {
                    window
                        .update(cx, |_, window, cx| {
                            if let Some(host) = BehaviourHost::of(window, cx) {
                                return_focus(&host, window, cx);
                            }
                        })
                        .ok();
                });
            }
        }
    }
}

/// Rule 15: one `pause` while any reason holds, one `resume` when none does. The reasons are the
/// pointer on the region, focus in it (both as the region last saw them), the window inactive, and
/// a dialog or sheet in the overlay stack. Called by the region as it renders, when a toast shows
/// from empty, and when the window's activation changes.
pub(crate) fn sync_pause(host: &Entity<BehaviourHost>, window: &mut Window, cx: &mut App) {
    let (hold, paused, showing) = {
        let host = host.read(cx);
        let modal = host
            .overlay
            .layers()
            .iter()
            .any(|layer| matches!(layer.kind, LayerKind::Dialog | LayerKind::Sheet));
        let toasts = &host.toasts;
        (
            toasts.pointer || toasts.focus_inside || !window.is_window_active() || modal,
            toasts.state().paused,
            toasts.state().showing.is_some(),
        )
    };
    if showing && hold != paused {
        let toasts = Toasts::for_window(window.window_handle());
        toasts.send(host, if hold { Event::Pause } else { Event::Resume }, cx);
    }
}

/// Focus back where it was before it entered the toast area, else the screen's focus target.
fn return_focus(host: &Entity<BehaviourHost>, window: &mut Window, cx: &mut App) {
    let target = {
        let host = host.read(cx);
        host.toasts
            .before
            .as_ref()
            .and_then(WeakFocusHandle::upgrade)
            .filter(|before| host.drawn(before, window))
            .or_else(|| host.screen_focus(cx))
    };
    if let Some(target) = target {
        window.focus(&target, cx);
    }
}

fn tone_of(tone: ToastQueueTone) -> ToastTone {
    match tone {
        ToastQueueTone::Neutral => ToastTone::Neutral,
        ToastQueueTone::Positive => ToastTone::Positive,
        ToastQueueTone::Danger => ToastTone::Danger,
    }
}

/// The window's toast area: the showing toast, centred at the foot of what holds it (put it in a
/// `relative` element that fills the window). Draws nothing without a host or a toast.
#[derive(IntoElement, Default)]
pub struct ToastRegion;

impl ToastRegion {
    pub fn new() -> Self {
        Self
    }
}

impl RenderOnce for ToastRegion {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let (Some(host), Some(toasts)) = (BehaviourHost::of(window, cx), Toasts::of(window, cx))
        else {
            return div().into_any_element();
        };
        let region = host.update(cx, |host, cx| {
            host.toasts
                .region
                .get_or_insert_with(|| cx.focus_handle())
                .clone()
        });
        // Where focus is, read each render: focus inside, and the last place outside.
        let focus_inside = region.contains_focused(window, cx);
        let focused = window.focused(cx);
        let showing = host.update(cx, |host, _| {
            let toasts = &mut host.toasts;
            toasts.focus_inside = focus_inside;
            if !focus_inside && let Some(focused) = focused {
                toasts.before = Some(focused.downgrade());
            }
            toasts.state().showing.clone()
        });
        let Some(toast) = showing else {
            // The area went with the last toast: the pointer cannot be on it any more.
            host.update(cx, |host, _| host.toasts.pointer = false);
            return div().into_any_element();
        };
        sync_pause(&host, window, cx);
        let id = toast.id.clone();
        let (dismiss, act) = (toasts.clone(), toasts.clone());
        let (dismiss_id, act_id) = (id.clone(), id.clone());
        let hover = host.downgrade();
        let mut piece = Toast::new(SharedString::from(id), toast.message)
            .tone(tone_of(toast.tone))
            // The queue's `announce` effect speaks it, through the window's announcer.
            .announce(false)
            .on_close(move |_, cx| dismiss.dismiss(&dismiss_id, cx));
        if let Some(label) = toast.action {
            piece = piece.action(label, move |window, cx| act.act(&act_id, window, cx));
        }
        // Laid out where the region is (a template's main pane), painted after the rest of the
        // window: a toast stays over the dialogs and sheets drawn later in the tree.
        let area = div()
            .absolute()
            .left_0()
            .right_0()
            .bottom(px(24.))
            .px(px(16.))
            .flex()
            .justify_center()
            .child(
                div()
                    .id("kit-toast-region")
                    .test_support()
                    .track_focus(&region)
                    .relative()
                    .child(piece)
                    // The pointer on the area: from its painted bounds, as the toast's own
                    // panel occludes the area's hitbox. A mouse or pen; GPUI has no touch here.
                    .child(
                        canvas(
                            |bounds, _, _| bounds,
                            move |_, bounds, window, _| {
                                window.on_mouse_event(
                                    move |event: &MouseMoveEvent, phase, _, cx| {
                                        if phase != DispatchPhase::Capture {
                                            return;
                                        }
                                        let inside = bounds.contains(&event.position);
                                        let Some(host) = hover.upgrade() else { return };
                                        if host.read(cx).toasts.pointer != inside {
                                            host.update(cx, |host, _| host.toasts.pointer = inside);
                                            cx.refresh_windows();
                                        }
                                    },
                                );
                            },
                        )
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full(),
                    ),
            );
        deferred(area).with_priority(2).into_any_element()
    }
}
