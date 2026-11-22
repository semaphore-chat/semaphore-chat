//! The list-focus host (`design/guide/behaviour.md`, "List focus"), the native side of the web's
//! `hosts/listFocus.ts`: one Tab stop for a list of rows, the arrows, Home and End, typeahead, and
//! a focus handle per row. Menu, Dock and Tabs run on it.
//!
//! The host is plain state a piece keeps in its own keyed element state; [`list_key`] runs a key
//! on it (its typeahead timer comes back to that entity), and [`ListFocusHost::sync`] feeds the
//! reducer what it reads each render: the rows, the selection and where focus is.

use gpui_kit::*;
use semaphore_design::behaviour::list_focus::{self, Effect, Event, Params, Row, State};
use std::time::Duration;

/// Which arrows move focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ListOrientation {
    /// Up and Down.
    Vertical,
    /// Left and Right, and Up and Down too.
    Horizontal,
}

/// How a list reads its keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ListKeys {
    pub orientation: ListOrientation,
    /// Typing letters jumps to a row.
    pub typeahead: bool,
    /// Shift with an arrow still moves (a menu); a bar ignores Shift.
    pub allow_shift: bool,
}

pub(crate) struct ListFocusHost {
    params: Params,
    keys: ListKeys,
    state: State,
    handles: Vec<(String, FocusHandle)>,
    /// Focus is on one of the rows.
    inside: bool,
}

/// What a render learnt from [`ListFocusHost::sync`].
pub(crate) struct Synced {
    /// Each row's focus handle, in row order.
    pub handles: Vec<(String, FocusHandle)>,
    /// The row that just took focus (focus entered the list, or moved to another row).
    pub entered: Option<String>,
}

impl ListFocusHost {
    pub(crate) fn new(params: Params, keys: ListKeys) -> Self {
        Self {
            state: list_focus::initial(&params),
            params,
            keys,
            handles: Vec::new(),
            inside: false,
        }
    }

    pub(crate) fn state(&self) -> &State {
        &self.state
    }

    fn step(&mut self, event: &Event) -> Vec<Effect> {
        let (state, effects) = list_focus::step(&self.state, event, &self.params);
        self.state = state;
        effects
    }

    /// The row's focus handle, made the first time it is asked for.
    pub(crate) fn handle(&mut self, id: &str, cx: &mut App) -> FocusHandle {
        if let Some((_, handle)) = self.handles.iter().find(|(known, _)| known == id) {
            return handle.clone();
        }
        let handle = cx.focus_handle();
        self.handles.push((id.to_owned(), handle.clone()));
        handle
    }

    /// Whether `handle` is one of the rows'.
    pub(crate) fn has_handle(&self, handle: &FocusHandle) -> bool {
        self.handles.iter().any(|(_, known)| known == handle)
    }

    /// What the reducer is told each render: the rows when they changed, the selection when it
    /// changed (`None` leaves it to the list), and where focus is.
    pub(crate) fn sync(
        &mut self,
        rows: Vec<Row>,
        selected: Option<Option<String>>,
        window: &Window,
        cx: &mut App,
    ) -> Synced {
        // What these report (a selected row gone) is the owner's to read from its own data: the
        // pieces on this host show the selection they are given.
        if self.state.rows != rows {
            self.step(&Event::SetRows { rows });
        }
        if let Some(selected) = selected
            && self.state.selected != selected
        {
            self.step(&Event::SetSelected { id: selected });
        }
        let ids: Vec<String> = self.state.rows.iter().map(|row| row.id.clone()).collect();
        let handles: Vec<(String, FocusHandle)> = ids
            .iter()
            .map(|id| (id.clone(), self.handle(id, cx)))
            .collect();
        let focused = handles
            .iter()
            .find(|(_, handle)| handle.is_focused(window))
            .map(|(id, _)| id.clone());
        let mut entered = None;
        match focused {
            Some(id) => {
                if !self.inside || self.state.focused.as_deref() != Some(id.as_str()) {
                    entered = Some(id.clone());
                }
                if self.state.focused.as_deref() != Some(id.as_str()) {
                    self.step(&Event::FocusRow { id });
                }
                self.inside = true;
            }
            None if self.inside => {
                self.step(&Event::FocusOut);
                self.inside = false;
            }
            None => {}
        }
        Synced { handles, entered }
    }

    /// The row that holds the list's one Tab stop, as the web host's `tabStopOf` (rule 6): while
    /// focus is in the list, the focused row; while it is outside, the selected row if enabled,
    /// else the focused one if enabled, else the first enabled.
    pub(crate) fn tab_stop(&self) -> Option<String> {
        tab_stop_of(&self.state, self.inside)
    }

    /// The list-focus event for a key, or `None` when the list does not use it. Space is typeahead
    /// while a prefix is being typed; Enter and Space otherwise are the row's own (its button).
    pub(crate) fn event_for(&self, keystroke: &Keystroke) -> Option<Event> {
        key_event(keystroke, self.keys, !self.state.typeahead.is_empty())
    }
}

/// See [`ListFocusHost::tab_stop`].
pub(crate) fn tab_stop_of(state: &State, inside: bool) -> Option<String> {
    let usable = |id: &Option<String>| {
        id.as_ref()
            .filter(|id| state.rows.iter().any(|row| &row.id == *id && !row.disabled))
            .cloned()
    };
    if inside && let Some(focused) = usable(&state.focused) {
        return Some(focused);
    }
    usable(&state.selected)
        .or_else(|| usable(&state.focused))
        .or_else(|| {
            state
                .rows
                .iter()
                .find(|row| !row.disabled)
                .map(|row| row.id.clone())
        })
}

/// A list's key map: the arrows of its orientation, Home and End, and a printable character for
/// typeahead (Space only while a prefix is being typed).
pub(crate) fn key_event(keystroke: &Keystroke, keys: ListKeys, typing: bool) -> Option<Event> {
    let m = &keystroke.modifiers;
    if m.control || m.alt || m.platform || m.function || (m.shift && !keys.allow_shift) {
        return None;
    }
    let horizontal = keys.orientation == ListOrientation::Horizontal;
    Some(match keystroke.key.as_str() {
        "up" => Event::Up,
        "down" => Event::Down,
        "left" if horizontal => Event::Up,
        "right" if horizontal => Event::Down,
        "home" => Event::Home,
        "end" => Event::End,
        "escape" | "enter" | "tab" => return None,
        "space" if !typing => return None,
        _ if !keys.typeahead => return None,
        _ => {
            let typed = keystroke
                .key_char
                .as_deref()
                .unwrap_or(match keystroke.key.as_str() {
                    "space" => " ",
                    other => other,
                });
            let mut chars = typed.chars();
            match (chars.next(), chars.next()) {
                (Some(char), None) if !char.is_control() => Event::Type { char },
                _ => return None,
            }
        }
    })
}

/// Runs one key's event on the list `access` finds in `entity`, from the row that has focus, then
/// focuses the result. A typeahead timer comes back as `TimerFired`. Returns the effects the owner
/// acts on (`Select`, `Deselect`), or `None` when focus is not on a row (the key is not the list's).
pub(crate) fn list_key<T: 'static>(
    entity: &Entity<T>,
    access: fn(&mut T) -> &mut ListFocusHost,
    event: Event,
    window: &mut Window,
    cx: &mut App,
) -> Option<Vec<Effect>> {
    let (handle, effects) = entity.update(cx, |owner, _| {
        let list = access(owner);
        let focused = list
            .handles
            .iter()
            .find(|(_, handle)| handle.is_focused(window))
            .map(|(id, _)| id.clone())?;
        if list.state.focused.as_deref() != Some(focused.as_str()) {
            list.step(&Event::FocusRow { id: focused });
        }
        let effects = list.step(&event);
        let handle = list.state.focused.as_ref().and_then(|target| {
            list.handles
                .iter()
                .find(|(id, _)| id == target)
                .map(|(_, handle)| handle.clone())
        });
        Some((handle, effects))
    })?;
    let mut owner_effects = Vec::new();
    for effect in effects {
        match effect {
            Effect::StartTimer { token, ms } => {
                let weak = entity.downgrade();
                window
                    .spawn(cx, async move |cx| {
                        cx.background_executor()
                            .timer(Duration::from_millis(ms.into()))
                            .await;
                        weak.update(cx, |owner, _| {
                            access(owner).step(&Event::TimerFired { token });
                        })
                        .ok();
                    })
                    .detach();
            }
            // A stale token does nothing when its timer fires, so there is nothing to stop.
            Effect::CancelTimer { .. } => {}
            other => owner_effects.push(other),
        }
    }
    if let Some(handle) = handle {
        window.focus(&handle, cx);
    }
    Some(owner_effects)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn stroke(key: &'static str) -> Keystroke {
        Keystroke::parse(key).unwrap()
    }

    const MENU: ListKeys = ListKeys {
        orientation: ListOrientation::Vertical,
        typeahead: true,
        allow_shift: true,
    };
    const BAR: ListKeys = ListKeys {
        orientation: ListOrientation::Horizontal,
        typeahead: false,
        allow_shift: false,
    };

    #[test]
    fn a_vertical_list_moves_with_up_and_down_and_types_ahead() {
        assert_eq!(key_event(&stroke("down"), MENU, false), Some(Event::Down));
        assert_eq!(key_event(&stroke("left"), MENU, false), None);
        assert_eq!(
            key_event(&stroke("p"), MENU, false),
            Some(Event::Type { char: 'p' })
        );
        assert_eq!(key_event(&stroke("space"), MENU, false), None);
        assert_eq!(
            key_event(&stroke("space"), MENU, true),
            Some(Event::Type { char: ' ' })
        );
        assert_eq!(key_event(&stroke("escape"), MENU, false), None);
        assert_eq!(key_event(&stroke("ctrl-p"), MENU, false), None);
    }

    #[test]
    fn a_horizontal_bar_moves_with_every_arrow_and_ignores_letters_and_shift() {
        assert_eq!(key_event(&stroke("left"), BAR, false), Some(Event::Up));
        assert_eq!(key_event(&stroke("right"), BAR, false), Some(Event::Down));
        assert_eq!(key_event(&stroke("up"), BAR, false), Some(Event::Up));
        assert_eq!(key_event(&stroke("end"), BAR, false), Some(Event::End));
        assert_eq!(key_event(&stroke("a"), BAR, false), None);
        assert_eq!(key_event(&stroke("shift-right"), BAR, false), None);
    }

    fn rows(ids: &[(&str, bool)]) -> Vec<Row> {
        ids.iter()
            .map(|(id, disabled)| Row {
                id: (*id).into(),
                label: (*id).into(),
                disabled: *disabled,
            })
            .collect()
    }

    #[test]
    fn the_tab_stop_is_the_selected_row_outside_and_the_focused_row_inside() {
        let params = Params::default();
        let mut state = list_focus::initial(&params);
        state = list_focus::step(
            &state,
            &Event::SetRows {
                rows: rows(&[("a", true), ("b", false), ("c", false)]),
            },
            &params,
        )
        .0;
        assert_eq!(tab_stop_of(&state, false).as_deref(), Some("b"));
        state = list_focus::step(
            &state,
            &Event::SetSelected {
                id: Some("c".into()),
            },
            &params,
        )
        .0;
        assert_eq!(tab_stop_of(&state, false).as_deref(), Some("c"));
        state = list_focus::step(&state, &Event::FocusRow { id: "b".into() }, &params).0;
        assert_eq!(tab_stop_of(&state, true).as_deref(), Some("b"));
        assert_eq!(tab_stop_of(&state, false).as_deref(), Some("c"));
    }
}
