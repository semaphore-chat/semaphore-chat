//! One select over [`PickOption`]s, for the channel, DM and community pickers: it keeps the
//! picked id across a reload of the list and says when the list is loading or empty.

use super::model::{Choices, PickOption};
use crate::kit::{SelectField, Variant, select_state, text};
use crate::theme::SemTheme as _;
use gpui_kit::component::IndexPath;
use gpui_kit::component::select::{SelectEvent, SelectState};
use gpui_kit::prelude::*;
use gpui_kit::*;

pub(crate) struct Picker {
    pub state: Entity<SelectState<Vec<SharedString>>>,
    pub choices: Choices,
    pub picked: Option<String>,
}

/// What a Confirm in a picker's select means for its owner.
pub(crate) fn confirmed(
    picker: &mut Picker,
    event: &SelectEvent<Vec<SharedString>>,
    cx: &App,
) -> bool {
    let SelectEvent::Confirm(_) = event;
    let index = picker.state.read(cx).selected_index(cx).map(|at| at.row);
    let picked = index.and_then(|row| {
        picker
            .choices
            .as_ref()
            .and_then(|choices| choices.get(row))
            .map(|choice| choice.id.clone())
    });
    let changed = picked != picker.picked;
    picker.picked = picked;
    changed
}

impl Picker {
    pub fn new(window: &mut Window, cx: &mut App) -> Self {
        Self {
            state: select_state(Vec::new(), None, window, cx),
            choices: None,
            picked: None,
        }
    }

    /// A new list: the pick stays if it's still in it.
    pub fn set(&mut self, choices: Choices, window: &mut Window, cx: &mut App) {
        let options: &[PickOption] = choices.as_deref().unwrap_or_default();
        let labels: Vec<SharedString> = options
            .iter()
            .map(|choice| SharedString::from(choice.label.clone()))
            .collect();
        let index = self
            .picked
            .as_ref()
            .and_then(|id| options.iter().position(|choice| &choice.id == id));
        if index.is_none() {
            self.picked = None;
        }
        self.state.update(cx, |state, cx| {
            state.set_items(labels, window, cx);
            state.set_selected_index(index.map(|row| IndexPath::default().row(row)), window, cx);
        });
        self.choices = choices;
    }

    /// Picks an id (stories and tests; the user picks through the select).
    pub fn pick(&mut self, id: &str, window: &mut Window, cx: &mut App) {
        self.picked = Some(id.to_owned());
        let choices = self.choices.clone();
        self.set(choices, window, cx);
    }

    /// The field, or a loading or empty line in its place.
    pub fn field(
        &self,
        id: &'static str,
        label: &'static str,
        empty: &'static str,
        disabled: bool,
        cx: &App,
    ) -> AnyElement {
        let sem = cx.sem();
        let note = |line: &'static str| {
            text(Variant::Body2, line)
                .text_color(sem.text_secondary)
                .py(px(8.))
                .into_any_element()
        };
        match &self.choices {
            None => note("Loading..."),
            Some(choices) if choices.is_empty() => note(empty),
            Some(_) => SelectField::new(id, &self.state, label)
                .disabled(disabled)
                .into_any_element(),
        }
    }
}
