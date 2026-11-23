//! The destructive-confirmation host (`design/guide/behaviour.md`, "Confirm destructive" and "One
//! dialog, two patterns"), the native side of the web's `useConfirmDestructive`: a kit Dialog that
//! asks before an irreversible action, runs it, and stays open with the error when it fails.
//!
//! ```ignore
//! let remove = confirm_destructive("delete-channel", ConfirmOptions::new(
//!     "Delete #general?", "This removes 214 messages for everyone.", "Delete channel",
//!     move |window, cx| delete(window, cx),        // a Task<Result<(), String>>
//! ), window, cx);
//! Button::new("delete", "Delete").danger().on_click(move |_, w, cx| (remove.request)(w, cx));
//! // and draw `remove.dialog` somewhere in the screen
//! ```
//!
//! The dialog is a layer of the window's overlay stack: Escape and the scrim become `cancel`,
//! which the pattern ignores while the action runs. `parentClosed` (the layer it was opened from
//! closed) is a cancel before the action and after a failure; while the action runs, the run goes
//! on, and a failure has no dialog to show in, so it becomes a danger toast.

use super::machine::{Machine, drive};
use super::toasts::{ToastRequest, Toasts};
use crate::kit::{Alert, Button, Dialog, DialogCloseReason, Severity};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::behaviour::confirm_destructive::{
    self as pattern, CancelReason, Effect, Event, Params, Phase, State,
};
use std::rc::Rc;
use std::time::Duration;

/// How long the action may take before it counts as failed.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
pub const DEFAULT_ERROR_MESSAGE: &str = "Couldn't finish that. Try again.";
/// The result of a timed-out action is unknown, so the user checks before trying again.
pub const TIMEOUT_MESSAGE: &str =
    "This is taking too long. It may still have worked, so check before you try again.";
/// The toast id a failure without a dialog uses: `confirm-<id>`, one per confirmation, so two
/// screens' failures never replace each other.
pub fn confirm_notify_id(id: &ElementId) -> String {
    format!("confirm-{id}")
}

type Run = Rc<dyn Fn(&mut Window, &mut App) -> Task<Result<(), String>>>;
type Done = Rc<dyn Fn(&mut Window, &mut App)>;
/// One of the confirmation's actions.
pub type ConfirmAction = Rc<dyn Fn(&mut Window, &mut App)>;

/// What the confirmation asks and does.
#[derive(Clone)]
pub struct ConfirmOptions {
    /// Names what is lost: "Delete #general?".
    pub title: SharedString,
    /// What goes with it: "This removes 214 messages for everyone."
    pub description: SharedString,
    /// The confirm button, and the retry button after a failure: "Delete channel".
    pub confirm_label: SharedString,
    /// The action: `Err(message)` is a failure, and the dialog shows the message.
    pub run: Run,
    pub timeout: Duration,
    /// Called once the action worked and the dialog has closed.
    pub on_done: Option<Done>,
}

impl ConfirmOptions {
    pub fn new(
        title: impl Into<SharedString>,
        description: impl Into<SharedString>,
        confirm_label: impl Into<SharedString>,
        run: impl Fn(&mut Window, &mut App) -> Task<Result<(), String>> + 'static,
    ) -> Self {
        Self {
            title: title.into(),
            description: description.into(),
            confirm_label: confirm_label.into(),
            run: Rc::new(run),
            timeout: DEFAULT_TIMEOUT,
            on_done: None,
        }
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn on_done(mut self, done: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_done = Some(Rc::new(done));
        self
    }
}

/// What a screen gets back: the request to wire to its dangerous button, and the dialog to draw
/// while the confirmation is open.
pub struct ConfirmDestructive {
    pub request: ConfirmAction,
    /// What the dialog's confirm button does, for rigs and stories that drive it without a press.
    pub confirm: ConfirmAction,
    pub dialog: Option<ConfirmDialog>,
    pub phase: Phase,
}

/// The confirmation's dialog, to draw anywhere in the screen. Drawn again after the layer it was
/// opened from closed and reopened while the action runs, a failure shows in it again (the
/// web's `viewBack()`).
#[derive(IntoElement)]
pub struct ConfirmDialog {
    dialog: Dialog,
    state: Entity<Confirm>,
}

impl RenderOnce for ConfirmDialog {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        self.state
            .update(cx, |confirm, _| confirm.parent_gone = false);
        self.dialog
    }
}

type ConfirmMachine = Machine<State, Event, Effect, Params>;

struct Confirm {
    machine: ConfirmMachine,
    options: ConfirmOptions,
    /// The attempt whose result has not been reported yet.
    open: Option<u32>,
    /// The dialog went with its parent while the action worked: a failure has nowhere to show.
    parent_gone: bool,
    /// The current attempt's run and its timeout; dropping the run stops it.
    answer: Option<Task<()>>,
    timer: Option<Task<()>>,
    /// The toast id a failure without a dialog uses.
    notify_id: String,
}

fn machine(confirm: &mut Confirm) -> &mut ConfirmMachine {
    &mut confirm.machine
}

/// The confirmation `id` names in the screen's element state, with the latest `options`.
pub fn confirm_destructive(
    id: impl Into<ElementId>,
    options: ConfirmOptions,
    window: &mut Window,
    cx: &mut App,
) -> ConfirmDestructive {
    let id: ElementId = id.into();
    let latest = options.clone();
    let state = window.use_keyed_state(id.clone(), cx, |_, _| Confirm {
        machine: Machine::new(pattern::step, pattern::initial(&Params), Params),
        options: latest,
        open: None,
        parent_gone: false,
        answer: None,
        timer: None,
        notify_id: confirm_notify_id(&id),
    });
    state.update(cx, |confirm, _| confirm.options = options.clone());
    let phase = state.read(cx).machine.state().phase;
    let request: ConfirmAction = {
        let state = state.clone();
        Rc::new(move |window, cx| send(&state, Event::Request, window, cx))
    };
    let confirm_now: ConfirmAction = {
        let state = state.clone();
        Rc::new(move |window, cx| send(&state, Event::Confirm, window, cx))
    };
    let dialog_state = state.clone();
    let dialog = (phase != Phase::Idle).then(|| {
        let working = phase == Phase::Working;
        let error = state.read(cx).machine.state().error.clone();
        let (cancel, confirm, close) = (state.clone(), state.clone(), state.clone());
        Dialog::new(id.clone(), options.title.clone())
            .description(options.description.clone())
            .when_some(error, |dialog, error| {
                dialog.body(Alert::new("confirm-error", Severity::Danger, error))
            })
            .action(
                Button::new("confirm-cancel", "Cancel")
                    .ghost()
                    .disabled(working)
                    .on_click(move |_, window, cx| {
                        send(
                            &cancel,
                            Event::Cancel {
                                reason: CancelReason::Button,
                            },
                            window,
                            cx,
                        )
                    }),
            )
            .action(
                Button::new("confirm-run", options.confirm_label.clone())
                    .danger()
                    .loading(working)
                    .on_click(move |_, window, cx| send(&confirm, Event::Confirm, window, cx)),
            )
            .on_request_close(move |reason, window, cx| match reason {
                DialogCloseReason::Escape => send(
                    &close,
                    Event::Cancel {
                        reason: CancelReason::Escape,
                    },
                    window,
                    cx,
                ),
                DialogCloseReason::Scrim => send(
                    &close,
                    Event::Cancel {
                        reason: CancelReason::Scrim,
                    },
                    window,
                    cx,
                ),
                DialogCloseReason::ParentClosed => parent_closed(&close, window, cx),
            })
    });
    let dialog = dialog.map(|dialog| ConfirmDialog {
        dialog,
        state: dialog_state,
    });
    ConfirmDestructive {
        request,
        confirm: confirm_now,
        dialog,
        phase,
    }
}

/// The dialog went with the layer it was opened from: a cancel, unless the action is running.
fn parent_closed(state: &Entity<Confirm>, window: &mut Window, cx: &mut App) {
    match state.read(cx).machine.state().phase {
        Phase::Working => state.update(cx, |confirm, _| confirm.parent_gone = true),
        Phase::Idle => {}
        _ => send(
            state,
            Event::Cancel {
                reason: CancelReason::Button,
            },
            window,
            cx,
        ),
    }
}

fn send(state: &Entity<Confirm>, event: Event, window: &mut Window, cx: &mut App) {
    drive(state, machine, event, window, cx, |effect, window, cx| {
        apply(state, effect, window, cx)
    });
    window.refresh();
}

fn apply(state: &Entity<Confirm>, effect: Effect, window: &mut Window, cx: &mut App) {
    match effect {
        Effect::Run { attempt } => {
            let (run, timeout) = state.update(cx, |confirm, _| {
                confirm.open = Some(attempt);
                (confirm.options.run.clone(), confirm.options.timeout)
            });
            let running = run(window, cx);
            let weak = state.downgrade();
            // Exactly one result per attempt: the answer or the timeout, whichever comes first.
            let answer = window.spawn(cx, {
                let weak = weak.clone();
                async move |cx| {
                    let result = running.await;
                    cx.update(|window, cx| {
                        if let Some(state) = weak.upgrade() {
                            let event = match result {
                                Ok(()) => Event::Succeeded { attempt },
                                Err(message) if message.trim().is_empty() => Event::Failed {
                                    attempt,
                                    message: DEFAULT_ERROR_MESSAGE.into(),
                                },
                                Err(message) => Event::Failed { attempt, message },
                            };
                            state.update(cx, |confirm, _| confirm.timer = None);
                            report(&state, attempt, event, window, cx);
                        }
                    })
                    .ok();
                }
            });
            let timer = window.spawn(cx, async move |cx| {
                cx.background_executor().timer(timeout).await;
                cx.update(|window, cx| {
                    if let Some(state) = weak.upgrade() {
                        let event = Event::Failed {
                            attempt,
                            message: TIMEOUT_MESSAGE.into(),
                        };
                        // The answer no longer counts: stop the run, as the web aborts its
                        // signal, so a retry never runs alongside it.
                        state.update(cx, |confirm, _| confirm.answer = None);
                        report(&state, attempt, event, window, cx);
                    }
                })
                .ok();
            });
            // One run and one timer at a time: a new attempt drops the last one's.
            state.update(cx, |confirm, _| {
                confirm.answer = Some(answer);
                confirm.timer = Some(timer);
            });
        }
        Effect::Done => {
            if let Some(done) = state.read(cx).options.on_done.clone() {
                // After the dialog has closed and focus has gone back.
                window.defer(cx, move |window, cx| done(window, cx));
            }
        }
    }
}

/// The run's one result. A failure whose dialog went with its parent closes the confirmation
/// and becomes a danger toast.
fn report(state: &Entity<Confirm>, attempt: u32, event: Event, window: &mut Window, cx: &mut App) {
    let gone = state.update(cx, |confirm, _| {
        if confirm.open != Some(attempt) {
            return None;
        }
        confirm.open = None;
        Some(std::mem::replace(&mut confirm.parent_gone, false))
    });
    let Some(gone) = gone else { return };
    let failure = match &event {
        Event::Failed { message, .. } => Some(message.clone()),
        _ => None,
    };
    send(state, event, window, cx);
    if gone && let Some(message) = failure {
        send(
            state,
            Event::Cancel {
                reason: CancelReason::Button,
            },
            window,
            cx,
        );
        let id = state.read(cx).notify_id.clone();
        if let Some(toasts) = Toasts::of(window, cx) {
            toasts.show(ToastRequest::new(message).id(id).danger(), cx);
        }
    }
}
