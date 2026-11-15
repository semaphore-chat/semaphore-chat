//! What a screen shows while it loads from the server: loading, empty, error, ready or
//! refreshing. An error only replaces the screen when there is nothing to show.
//!
//! A direct port of the `loadState` reducers in `design/gen/behaviour_ref.py`; the rule numbers
//! below are that pattern's rules. A fetch is an effect that comes back as a `succeeded` or
//! `failed` event with its token.

/// What the screen shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Loading,
    Empty,
    Error,
    Ready,
    /// Still showing the old content.
    Refreshing,
}

/// The load state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    pub status: Status,
    /// The message the error screen shows.
    pub error: Option<String>,
    /// The token of the latest fetch; only its result counts.
    pub token: u32,
    /// A fetch is in flight.
    pub fetching: bool,
    /// A refresh the user started is in flight; the host shows busy on the control that
    /// started it.
    pub refresh_by_user: bool,
}

/// One thing that happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Start,
    /// `by_user` is false for a background refresh (refetch on focus or reconnect).
    Refresh {
        by_user: bool,
    },
    Retry,
    /// The answer has nothing in it.
    Succeeded {
        token: u32,
        empty: bool,
    },
    Failed {
        token: u32,
        message: String,
    },
}

/// What the screen asks of its surroundings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Fetch, and report the result with this token.
    Fetch { token: u32 },
    /// A toast, for an error the screen does not show. The id is `notifyId`, so repeated
    /// failures replace one toast.
    Notify { id: String, message: String },
}

/// The screen's settings, from the pattern file's defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// The toast id its failures use.
    pub notify_id: String,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            notify_id: "load".to_owned(),
        }
    }
}

pub fn initial(_params: &Params) -> State {
    // Rule 1: a screen starts as loading, before any fetch.
    State {
        status: Status::Loading,
        error: None,
        token: 0,
        fetching: false,
        refresh_by_user: false,
    }
}

/// Start a fetch: clear the error, take the next token, and mark what kind of fetch it is.
fn fetch(state: &mut State, status: Status, effects: &mut Vec<Effect>, by_user: bool) {
    state.status = status;
    state.error = None;
    state.token = state.token.saturating_add(1);
    state.fetching = true;
    // Rule 12: refreshByUser is true only while a refresh the user started is in flight.
    state.refresh_by_user = by_user;
    effects.push(Effect::Fetch { token: state.token });
}

pub fn step(state: &State, event: &Event, params: &Params) -> (State, Vec<Effect>) {
    let mut next = state.clone();
    let mut effects = Vec::new();
    let status = next.status;

    match event {
        Event::Start => {
            // Rule 2: start, from any state, discards what is shown and fetches.
            fetch(&mut next, Status::Loading, &mut effects, false);
        }
        Event::Refresh { by_user } => {
            if next.fetching {
                // Rule 6: refresh while a fetch is in flight starts no new fetch; one the user
                // started marks the fetch in flight as theirs, unless it is loading.
                if *by_user && status != Status::Loading {
                    next.refresh_by_user = true;
                }
            } else {
                match status {
                    // Rule 3: refresh while ready keeps the content on screen.
                    Status::Ready => fetch(&mut next, Status::Refreshing, &mut effects, *by_user),
                    // Rule 4: refresh while empty keeps the empty screen.
                    Status::Empty => fetch(&mut next, Status::Empty, &mut effects, *by_user),
                    // Rule 5: refresh while error is a retry.
                    Status::Error => fetch(&mut next, Status::Loading, &mut effects, false),
                    Status::Loading | Status::Refreshing => {}
                }
            }
        }
        Event::Retry => {
            // Rule 7: retry while error loads again; in any other state it does nothing.
            if status == Status::Error && !next.fetching {
                fetch(&mut next, Status::Loading, &mut effects, false);
            }
        }
        Event::Succeeded { token, empty } => {
            // Rule 11: a stale token, or a result when nothing is in flight, does nothing.
            if next.fetching && *token == next.token {
                next.fetching = false;
                // Rule 12: any result clears refreshByUser.
                next.refresh_by_user = false;
                // Rule 8: success shows the empty screen or the content.
                next.status = if *empty { Status::Empty } else { Status::Ready };
            }
        }
        Event::Failed { token, message } => {
            // Rule 11: as above.
            if next.fetching && *token == next.token {
                next.fetching = false;
                // Rule 12: any result clears refreshByUser.
                next.refresh_by_user = false;
                if status == Status::Loading {
                    // Rule 9: failure with nothing to show replaces the skeleton with the error.
                    next.status = Status::Error;
                    next.error = Some(message.clone());
                } else {
                    // Rule 10: failure during a refresh keeps what is shown and notifies, with
                    // the screen's stable notifyId so repeated failures replace one toast.
                    next.status = if status == Status::Refreshing {
                        Status::Ready
                    } else {
                        status
                    };
                    effects.push(Effect::Notify {
                        id: params.notify_id.clone(),
                        message: message.clone(),
                    });
                }
            }
        }
    }

    (next, effects)
}
