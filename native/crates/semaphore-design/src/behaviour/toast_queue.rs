//! The toast queue: one toast on screen at a time, the rest waiting in order.
//!
//! A direct port of the `toastQueue` reducers in `design/gen/behaviour_ref.py`; the rule numbers
//! below are that pattern's rules. A toast leaves on its own after its timer, or when the user
//! dismisses it, and the timer stops while the host has a reason to pause. A waiting toast that
//! is not danger is dropped once it has waited `max_wait_ms` (rule 17).

use crate::lounge::{MOTION_TOAST_ACTION_MS, MOTION_TOAST_MS};

/// A toast's tone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Neutral,
    Positive,
    Danger,
}

/// How a screen reader announces a toast.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Politeness {
    Polite,
    Assertive,
}

/// One toast.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Toast {
    pub id: String,
    pub tone: Tone,
    pub message: String,
    /// The action's label; a toast with an action stays longer.
    pub action: Option<String>,
}

/// The toast queue's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    /// The toast on screen.
    pub showing: Option<Toast>,
    /// The toasts waiting, oldest first.
    pub queue: Vec<Toast>,
    /// Rule 17: for each waiting toast, in queue order, the token of its wait timer; `None` once
    /// the wait of a danger toast has ended.
    pub waits: Vec<Option<u32>>,
    /// The host has a reason to pause; false whenever nothing is showing.
    pub paused: bool,
    /// The last timer token handed out; every timer takes the next one.
    pub token: u32,
    /// The token of the showing toast's timer while it runs.
    pub timer: Option<u32>,
}

/// One thing that happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Show {
        toast: Toast,
    },
    /// The toast's Dismiss button or its action was pressed, or the caller withdrew it.
    Dismiss {
        id: String,
        /// Focus is inside the toast area, so it goes back where it was.
        focus_inside: bool,
    },
    TimerFired {
        token: u32,
    },
    Pause,
    Resume,
}

/// What the queue asks of its surroundings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    StartTimer {
        token: u32,
        ms: u32,
    },
    CancelTimer {
        token: u32,
    },
    Announce {
        message: String,
        politeness: Politeness,
        /// The action's label, or `None`; read after the message.
        action: Option<String>,
    },
    /// Focus that was inside the toast area goes back where it was.
    ReturnFocus,
}

/// The queue's settings, from the pattern file's defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    pub duration_ms: u32,
    pub duration_with_action_ms: u32,
    pub max_queued: usize,
    /// Rule 17: how long a waiting toast that is not danger may wait.
    pub max_wait_ms: u32,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            duration_ms: MOTION_TOAST_MS,
            duration_with_action_ms: MOTION_TOAST_ACTION_MS,
            max_queued: 3,
            max_wait_ms: MOTION_TOAST_ACTION_MS,
        }
    }
}

pub fn initial(_params: &Params) -> State {
    State {
        showing: None,
        queue: Vec::new(),
        waits: Vec::new(),
        paused: false,
        token: 0,
        timer: None,
    }
}

/// Rules 6 and 7: how long `toast` stays, or `None` when it has no timer and stays until
/// dismissed. A danger toast with an action has no timer; one without an action stays for the
/// longer duration, as does any other toast with an action.
fn toast_ms(toast: &Toast, params: &Params) -> Option<u32> {
    if toast.tone == Tone::Danger {
        if toast.action.is_some() {
            None
        } else {
            Some(params.duration_with_action_ms)
        }
    } else if toast.action.is_some() {
        Some(params.duration_with_action_ms)
    } else {
        Some(params.duration_ms)
    }
}

/// Rule 17: only a waiting toast with no action that is not danger is dropped for waiting.
fn droppable(toast: &Toast) -> bool {
    toast.tone != Tone::Danger && toast.action.is_none()
}

/// Rule 17: start the wait of the waiting toast at `index` with the next token.
fn start_wait(state: &mut State, index: usize, params: &Params, effects: &mut Vec<Effect>) {
    if let Some(wait) = state.waits.get_mut(index) {
        state.token = state.token.saturating_add(1);
        *wait = Some(state.token);
        effects.push(Effect::StartTimer {
            token: state.token,
            ms: params.max_wait_ms,
        });
    }
}

/// Keeps `waits` as long as `queue`, so a malformed state (one built by hand with lists of different
/// lengths) cannot make the step panic: missing waits are none, extra ones are dropped.
fn align_waits(state: &mut State) {
    state.waits.resize(state.queue.len(), None);
}

/// Cancel the showing toast's timer, if one runs.
fn cancel_showing_timer(state: &mut State, effects: &mut Vec<Effect>) {
    if let Some(token) = state.timer.take() {
        effects.push(Effect::CancelTimer { token });
    }
}

/// Rule 17: take the waiting toast at `index` out of the queue and cancel its wait.
fn unqueue(state: &mut State, index: usize, effects: &mut Vec<Effect>) -> Toast {
    if let Some(token) = state.waits.remove(index) {
        effects.push(Effect::CancelTimer { token });
    }
    state.queue.remove(index)
}

/// Rules 1, 3, 7, 13 and 14: put `toast` on screen with a fresh token, its timer (unless paused)
/// and, when `announce` is set, its announcement. A danger toast is announced assertively, every
/// other toast politely, and every announcement carries the toast's action label.
fn present(
    state: &mut State,
    toast: Toast,
    params: &Params,
    effects: &mut Vec<Effect>,
    announce: bool,
) {
    let ms = toast_ms(&toast, params);
    let politeness = if toast.tone == Tone::Danger {
        Politeness::Assertive
    } else {
        Politeness::Polite
    };
    let message = toast.message.clone();
    let action = toast.action.clone();
    state.showing = Some(toast);
    state.token = state.token.saturating_add(1);
    if !state.paused
        && let Some(ms) = ms
    {
        state.timer = Some(state.token);
        effects.push(Effect::StartTimer {
            token: state.token,
            ms,
        });
    }
    if announce {
        effects.push(Effect::Announce {
            message,
            politeness,
            action,
        });
    }
}

/// Rules 8 and 13: the showing toast has gone; show the next queued one, or nothing.
fn leave(state: &mut State, params: &Params, effects: &mut Vec<Effect>) {
    if state.queue.is_empty() {
        state.showing = None;
        // Rule 13: when the last toast leaves, the pause ends.
        state.paused = false;
    } else {
        // Rule 17: a waiting toast that shows before its wait ends is never dropped.
        let next = unqueue(state, 0, effects);
        present(state, next, params, effects, true);
    }
}

pub fn step(state: &State, event: &Event, params: &Params) -> (State, Vec<Effect>) {
    let mut next = state.clone();
    align_waits(&mut next);
    let mut effects = Vec::new();
    let showing = next.showing.clone();

    match event {
        Event::Show { toast } => {
            if showing.is_none() {
                // Rule 1: shown while nothing is showing, it appears at once.
                present(&mut next, toast.clone(), params, &mut effects, true);
            } else if showing.as_ref().is_some_and(|item| item.id == toast.id) {
                // Rule 3: the same id as the showing toast replaces it in place: the old timer
                // (if any) is cancelled and a new one starts with a new token; it is announced
                // only when the message or the action changed.
                cancel_showing_timer(&mut next, &mut effects);
                let changed = showing.as_ref().is_some_and(|item| {
                    item.message != toast.message || item.action != toast.action
                });
                present(&mut next, toast.clone(), params, &mut effects, changed);
            } else if let Some(at) = next.queue.iter().position(|item| item.id == toast.id) {
                // Rule 4: the same id as a queued toast replaces it in its place; it keeps its
                // wait (rule 17).
                next.queue[at] = toast.clone();
            } else {
                // Rule 2: it waits at the end of the queue.
                // Rule 5: when the queue is full, drop the oldest waiting toast with no action
                // that is not danger; failing that, the oldest waiting non-danger toast. Never
                // the incoming toast or a danger toast: with only danger waiting, it grows.
                if next.queue.len() >= params.max_queued {
                    let plain = next
                        .queue
                        .iter()
                        .position(|item| item.tone != Tone::Danger && item.action.is_none());
                    let other = next.queue.iter().position(|item| item.tone != Tone::Danger);
                    if let Some(drop) = plain.or(other) {
                        unqueue(&mut next, drop, &mut effects);
                    }
                }
                next.queue.push(toast.clone());
                next.waits.push(None);
                // Rule 17: a droppable toast's wait starts when it joins the queue, unless the
                // area is paused: then it starts at resume.
                if droppable(toast) && !next.paused {
                    let last = next.queue.len() - 1;
                    start_wait(&mut next, last, params, &mut effects);
                }
            }
        }
        Event::Dismiss { id, focus_inside } => {
            if showing.as_ref().is_some_and(|item| item.id == *id) {
                // Rule 8: dismissing the showing toast cancels its timer (when it has one) and
                // shows the next queued toast, or nothing.
                cancel_showing_timer(&mut next, &mut effects);
                // Rule 16: focus that was inside the toast area goes back where it was.
                if *focus_inside {
                    effects.push(Effect::ReturnFocus);
                }
                leave(&mut next, params, &mut effects);
            } else {
                // Rule 9: dismissing a queued toast removes it and cancels its wait; an unknown
                // id does nothing.
                if let Some(at) = next.queue.iter().position(|item| item.id == *id) {
                    unqueue(&mut next, at, &mut effects);
                }
            }
        }
        Event::TimerFired { token } => {
            if next.timer == Some(*token) {
                // Rule 10: the showing toast's timer makes it leave as if dismissed, without a
                // cancelTimer.
                next.timer = None;
                leave(&mut next, params, &mut effects);
            } else if let Some(at) = next.waits.iter().position(|wait| *wait == Some(*token)) {
                // Rule 17: a waiting toast whose wait ends is dropped with no other effect if it
                // is still droppable; otherwise it waits on, with no wait.
                if droppable(&next.queue[at]) {
                    next.queue.remove(at);
                    next.waits.remove(at);
                } else {
                    next.waits[at] = None;
                }
            }
            // Rule 10: a timer with any other token does nothing.
        }
        Event::Pause => {
            // Rule 11: pause cancels the showing toast's timer (when there is one); while already paused, or
            // while nothing is showing, it does nothing.
            // Rule 15: the host sends one pause for all its reasons to pause.
            // Rule 17: the waits do not count while paused: every running wait is cancelled.
            if showing.is_some() && !next.paused {
                cancel_showing_timer(&mut next, &mut effects);
                for wait in &mut next.waits {
                    if let Some(token) = wait.take() {
                        effects.push(Effect::CancelTimer { token });
                    }
                }
                next.paused = true;
            }
        }
        Event::Resume => {
            // Rule 12: resume starts the timer again (when the toast has one) with the full
            // duration and a new token, never the remaining time; while not paused it does
            // nothing. A pause belongs to a showing toast, so `showing` is the one to time.
            if next.paused {
                next.paused = false;
                next.token = next.token.saturating_add(1);
                if let Some(ms) = next
                    .showing
                    .as_ref()
                    .and_then(|showing| toast_ms(showing, params))
                {
                    next.timer = Some(next.token);
                    effects.push(Effect::StartTimer {
                        token: next.token,
                        ms,
                    });
                }
                // Rule 17: each droppable waiting toast's wait starts again from the full time.
                for index in 0..next.queue.len() {
                    if droppable(&next.queue[index]) {
                        start_wait(&mut next, index, params, &mut effects);
                    }
                }
            }
        }
    }

    (next, effects)
}
