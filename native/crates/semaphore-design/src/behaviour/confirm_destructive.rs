//! The destructive confirmation: a dialog that asks before an irreversible action, runs it, and
//! stays open with the error when it fails.
//!
//! A direct port of the `confirmDestructive` reducers in `design/gen/behaviour_ref.py`; the rule
//! numbers below are that pattern's rules. While the action runs, nothing closes the dialog.

/// Where the dialog is: `Idle` is closed, the others show it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Confirming,
    Working,
    Failed,
}

/// How the dialog was cancelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelReason {
    Button,
    Escape,
    Scrim,
}

/// The confirmation's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub phase: Phase,
    /// The failure shown in the dialog.
    pub error: Option<String>,
    /// The number of the latest run; only its result counts.
    pub attempt: u32,
}

/// One thing that happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Request,
    Confirm,
    Cancel { reason: CancelReason },
    Succeeded { attempt: u32 },
    Failed { attempt: u32, message: String },
}

/// What the confirmation asks of its surroundings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Start the action, and report its result with this number.
    Run {
        attempt: u32,
    },
    Done,
}

/// The confirmation has no settings.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Params;

pub fn initial(_params: &Params) -> State {
    State {
        phase: Phase::Idle,
        error: None,
        attempt: 0,
    }
}

pub fn step(state: &State, event: &Event, _params: &Params) -> (State, Vec<Effect>) {
    let mut next = state.clone();
    let mut effects = Vec::new();

    match event {
        Event::Request => {
            // Rule 1: request opens the closed dialog; while it is open it does nothing.
            if next.phase == Phase::Idle {
                next.phase = Phase::Confirming;
            }
        }
        Event::Confirm => {
            // Rule 2: confirm while confirming starts the action.
            // Rule 8: confirm while failed retries, with the error cleared.
            // Rule 3: while working, a second confirm does nothing.
            if matches!(next.phase, Phase::Confirming | Phase::Failed) {
                next.phase = Phase::Working;
                next.error = None;
                next.attempt = next.attempt.saturating_add(1);
                effects.push(Effect::Run {
                    attempt: next.attempt,
                });
            }
        }
        Event::Cancel { .. } => {
            // Rule 5: cancel (the button, Escape or the scrim) while confirming or failed closes
            // the dialog and clears the error.
            // Rule 4: while working, nothing closes the dialog.
            if matches!(next.phase, Phase::Confirming | Phase::Failed) {
                next.phase = Phase::Idle;
                next.error = None;
            }
        }
        Event::Succeeded { attempt } => {
            // Rule 9: a result for another attempt, or when nothing is working, does nothing.
            if next.phase == Phase::Working && *attempt == next.attempt {
                // Rule 6: success closes the dialog and emits done.
                next.phase = Phase::Idle;
                effects.push(Effect::Done);
            }
        }
        Event::Failed { attempt, message } => {
            // Rule 9: as above.
            if next.phase == Phase::Working && *attempt == next.attempt {
                // Rule 7: failure keeps the dialog open, showing the error message.
                next.phase = Phase::Failed;
                next.error = Some(message.clone());
            }
        }
    }

    (next, effects)
}
