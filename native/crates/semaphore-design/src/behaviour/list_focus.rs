//! Keyboard focus and selection in a list of rows: arrows, Home and End, typeahead, and what
//! happens when the rows change under the focus.
//!
//! A direct port of the `listFocus` reducers in `design/gen/behaviour_ref.py`; the rule numbers
//! below are that pattern's rules. A typeahead timer is an effect that comes back as a
//! `timerFired` event.

use crate::lounge::MOTION_TYPEAHEAD_MS;

/// One row, in display order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub id: String,
    pub label: String,
    pub disabled: bool,
}

/// The list's state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    /// The rows, in display order.
    pub rows: Vec<Row>,
    /// The focused row; never a disabled one.
    pub focused: Option<String>,
    /// The selected row.
    pub selected: Option<String>,
    /// The letters typed so far, lowercased.
    pub typeahead: String,
    /// The token of the latest typeahead timer.
    pub token: u32,
}

/// One thing that happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    SetRows { rows: Vec<Row> },
    FocusIn,
    Up,
    Down,
    Home,
    End,
    Type { char: String },
    TimerFired { token: u32 },
    Activate,
    Press { id: String },
}

/// What the list asks of its surroundings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    Select { id: String },
    StartTimer { token: u32, ms: u32 },
    CancelTimer { token: u32 },
}

/// The list's settings, from the pattern file's defaults.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    pub wrap: bool,
    pub selection_follows_focus: bool,
    pub typeahead_ms: u32,
}

impl Default for Params {
    fn default() -> Self {
        Self {
            wrap: false,
            selection_follows_focus: false,
            typeahead_ms: MOTION_TYPEAHEAD_MS,
        }
    }
}

pub fn initial(_params: &Params) -> State {
    State {
        rows: Vec::new(),
        focused: None,
        selected: None,
        typeahead: String::new(),
        token: 0,
    }
}

/// Rule 1: only enabled rows take focus.
fn enabled_ids(rows: &[Row]) -> Vec<String> {
    rows.iter()
        .filter(|row| !row.disabled)
        .map(|row| row.id.clone())
        .collect()
}

/// Rule 12: with selectionFollowsFocus on, every focus move also selects; rule 11: with it off,
/// moving focus never selects.
fn focus(state: &mut State, target: &str, params: &Params, effects: &mut Vec<Effect>) {
    if state.focused.as_deref() == Some(target) {
        return;
    }
    state.focused = Some(target.to_owned());
    if params.selection_follows_focus && state.selected.as_deref() != Some(target) {
        state.selected = Some(target.to_owned());
        effects.push(Effect::Select {
            id: target.to_owned(),
        });
    }
}

/// Rule 7: the first enabled row from the focused one onwards, wrapping round, whose label starts
/// with the buffer, ignoring case. Rule 8: one letter repeated (or a single letter) steps through
/// the rows that start with that letter, from the row after the focused one.
fn typeahead_match(state: &State) -> Option<String> {
    let ids: Vec<&str> = state.rows.iter().map(|row| row.id.as_str()).collect();
    let focused_at = state
        .focused
        .as_deref()
        .and_then(|focused| ids.iter().position(|id| *id == focused));
    let buffer = state.typeahead.as_str();
    let mut prefix = buffer;
    let mut start = focused_at.unwrap_or(0);
    if let Some(at) = focused_at {
        let mut chars = buffer.chars();
        if let Some(first) = chars.next()
            && chars.all(|char| char == first)
        {
            // `buffer` has one distinct character: step through its matches from the next row.
            prefix = &buffer[..first.len_utf8()];
            start = at + 1;
        }
    }
    for offset in 0..state.rows.len() {
        let row = &state.rows[(start + offset) % state.rows.len()];
        if !row.disabled && row.label.to_lowercase().starts_with(prefix) {
            return Some(row.id.clone());
        }
    }
    None
}

pub fn step(state: &State, event: &Event, params: &Params) -> (State, Vec<Effect>) {
    let mut next = state.clone();
    let mut effects = Vec::new();

    if let Event::SetRows { rows } = event {
        let old_ids: Vec<String> = state.rows.iter().map(|row| row.id.clone()).collect();
        next.rows = rows.clone();
        let enabled = enabled_ids(&next.rows);
        if let Some(focused) = next.focused.clone()
            && !enabled.contains(&focused)
        {
            // Rule 14: the focused row is gone or disabled: focus moves to the nearest
            // enabled survivor after it in the old order, else before it, else the first
            // enabled row, else nothing. The selection stays.
            let at = old_ids.iter().position(|id| *id == focused);
            let after: &[String] = at.map_or(&[], |at| &old_ids[at + 1..]);
            let before: &[String] = at.map_or(&old_ids[..], |at| &old_ids[..at]);
            let survivor = after
                .iter()
                .chain(before.iter().rev())
                .find(|id| enabled.contains(id));
            next.focused = survivor.cloned().or_else(|| enabled.first().cloned());
        }
        if let Some(selected) = &next.selected {
            // Rule 15: a selected row that is gone clears the selection, with no effect.
            if !next.rows.iter().any(|row| row.id == *selected) {
                next.selected = None;
            }
        }
        return (next, effects);
    }

    let enabled = enabled_ids(&next.rows);
    // Rule 2: with no enabled rows, every key does nothing.
    if enabled.is_empty() && !matches!(event, Event::TimerFired { .. }) {
        return (next, effects);
    }
    let focused = next.focused.clone();

    match event {
        // Handled above: every setRows event returns before this match.
        Event::SetRows { .. } => {}
        Event::Down | Event::Up => {
            // Rule 3: Down moves to the next enabled row, Up to the previous one; with nothing
            // focused, Down takes the first and Up the last.
            let down = matches!(event, Event::Down);
            let target = match focused.as_deref() {
                None => {
                    if down {
                        enabled.first()
                    } else {
                        enabled.last()
                    }
                }
                // A focused row that is not enabled cannot come from this state machine; leave
                // the focus where it is rather than indexing out of bounds.
                Some(focused) => enabled.iter().position(|id| id == focused).and_then(|at| {
                    let step = if down { at + 1 } else { at.wrapping_sub(1) };
                    if let Some(target) = enabled.get(step) {
                        Some(target)
                    } else if params.wrap {
                        // Rule 4: at the ends they stay put unless wrap is on.
                        if down {
                            enabled.first()
                        } else {
                            enabled.last()
                        }
                    } else {
                        None
                    }
                }),
            };
            if let Some(target) = target {
                focus(&mut next, target, params, &mut effects);
            }
        }
        Event::Home => {
            // Rule 5: Home focuses the first enabled row.
            if let Some(first) = enabled.first() {
                focus(&mut next, first, params, &mut effects);
            }
        }
        Event::End => {
            // Rule 5: End focuses the last enabled row.
            if let Some(last) = enabled.last() {
                focus(&mut next, last, params, &mut effects);
            }
        }
        Event::FocusIn => {
            // Rule 6: focus entering the list goes to the selected row if enabled, else the
            // first enabled row, and never changes the selection.
            if focused.is_none() {
                let selected = next.selected.clone();
                let target = selected
                    .filter(|selected| enabled.contains(selected))
                    .or_else(|| enabled.first().cloned());
                next.focused = target;
            }
        }
        Event::Type { char } => {
            // Rule 7: the character joins the buffer, lowercased, and the timer restarts with a
            // new token, cancelling the old one.
            if !next.typeahead.is_empty() {
                effects.push(Effect::CancelTimer { token: next.token });
            }
            next.typeahead.push_str(&char.to_lowercase());
            next.token = next.token.saturating_add(1);
            effects.push(Effect::StartTimer {
                token: next.token,
                ms: params.typeahead_ms,
            });
            let matched = typeahead_match(&next);
            // Rule 9: no match leaves focus where it is; the buffer still grows.
            if let Some(matched) = matched {
                focus(&mut next, &matched, params, &mut effects);
            }
        }
        Event::TimerFired { token } => {
            // Rule 10: the current token empties the buffer; any other does nothing.
            if *token == next.token && !next.typeahead.is_empty() {
                next.typeahead.clear();
            }
        }
        Event::Activate => {
            // Rule 11: Enter or Space selects the focused row and emits select, even when it was
            // already selected; with nothing focused it does nothing.
            if let Some(focused) = next.focused.clone() {
                next.selected = Some(focused.clone());
                effects.push(Effect::Select { id: focused });
            }
        }
        Event::Press { id } => {
            // Rule 13: a press on an enabled row focuses and selects it; on a disabled or
            // unknown row it does nothing.
            if enabled.contains(id) {
                next.focused = Some(id.clone());
                next.selected = Some(id.clone());
                effects.push(Effect::Select { id: id.clone() });
            }
        }
    }

    (next, effects)
}
