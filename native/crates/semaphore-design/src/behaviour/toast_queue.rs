//! The toast queue: one toast on screen at a time, the rest waiting in order.
//!
//! A direct port of the `toastQueue` reducers in `design/gen/behaviour_ref.py`; the rule numbers
//! below are that pattern's rules. A toast leaves on its own after its timer, or when the user
//! dismisses it, and the timer stops while the pointer or focus is on the toast area.

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
    /// The pointer or focus is on the toast area; false whenever nothing is showing.
    pub paused: bool,
    /// The token of the latest timer; only that one counts when it fires.
    pub token: u32,
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
}

impl Default for Params {
    fn default() -> Self {
        Self {
            duration_ms: MOTION_TOAST_MS,
            duration_with_action_ms: MOTION_TOAST_ACTION_MS,
            max_queued: 3,
        }
    }
}

pub fn initial(_params: &Params) -> State {
    State {
        showing: None,
        queue: Vec::new(),
        paused: false,
        token: 0,
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

/// The showing toast is on screen, not paused, and has a timer to cancel.
fn timer_running(state: &State, params: &Params) -> bool {
    state
        .showing
        .as_ref()
        .is_some_and(|showing| !state.paused && toast_ms(showing, params).is_some())
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
        let next = state.queue.remove(0);
        present(state, next, params, effects, true);
    }
}

pub fn step(state: &State, event: &Event, params: &Params) -> (State, Vec<Effect>) {
    let mut next = state.clone();
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
                if timer_running(&next, params) {
                    effects.push(Effect::CancelTimer { token: next.token });
                }
                let changed = showing.as_ref().is_some_and(|item| {
                    item.message != toast.message || item.action != toast.action
                });
                present(&mut next, toast.clone(), params, &mut effects, changed);
            } else if let Some(at) = next.queue.iter().position(|item| item.id == toast.id) {
                // Rule 4: the same id as a queued toast replaces it in its place.
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
                        next.queue.remove(drop);
                    }
                }
                next.queue.push(toast.clone());
            }
        }
        Event::Dismiss { id, focus_inside } => {
            if showing.as_ref().is_some_and(|item| item.id == *id) {
                // Rule 8: dismissing the showing toast cancels its timer (when it has one) and
                // shows the next queued toast, or nothing.
                if timer_running(&next, params) {
                    effects.push(Effect::CancelTimer { token: next.token });
                }
                // Rule 16: focus that was inside the toast area goes back where it was.
                if *focus_inside {
                    effects.push(Effect::ReturnFocus);
                }
                leave(&mut next, params, &mut effects);
            } else {
                // Rule 9: dismissing a queued toast removes it; an unknown id does nothing.
                next.queue.retain(|item| item.id != *id);
            }
        }
        Event::TimerFired { token } => {
            // Rule 10: the current token makes the toast leave as if dismissed, without a
            // cancelTimer; any other token does nothing.
            if timer_running(&next, params) && *token == next.token {
                leave(&mut next, params, &mut effects);
            }
        }
        Event::Pause => {
            // Rule 11: pause cancels the timer (when there is one); while already paused, or
            // while nothing is showing, it does nothing.
            // Rule 15: the host sends one pause for all its reasons to pause.
            if showing.is_some() && !next.paused {
                if timer_running(&next, params) {
                    effects.push(Effect::CancelTimer { token: next.token });
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
                    effects.push(Effect::StartTimer {
                        token: next.token,
                        ms,
                    });
                }
            }
        }
    }

    (next, effects)
}
