//! The behaviour layer: the five interaction patterns of `design/behaviour/`, ported from the
//! reference reducers in `design/gen/behaviour_ref.py` and tested against the shared vectors.
//!
//! Each pattern is a pure state machine, `step` being `(state, event, params) -> (state,
//! effects)`: it never reads a clock, never makes an id and never mutates the state it is
//! given. A timer is an effect that comes back as a `timerFired` event, and a token that is not
//! the current one does nothing. The rule numbers in the comments are the pattern file's rules.
//!
//! The test-only `canon` module is the shared reader and writer for the canonical JSON form the
//! generated vectors use; `tests` holds the port of each pattern to them.

pub mod confirm_destructive;
pub mod list_focus;
pub mod load_state;
pub mod overlay_stack;
pub mod toast_queue;

#[cfg(test)]
mod canon;
#[cfg(test)]
mod tests;
