//! TextField and Select, outlined with a floating label: gpui-kit's editor inside MUI's frame.
//!
//! GPUI has no CSS outline notch, so a floated label sits on a patch of the surface colour.

use super::{Variant, text};
use crate::theme::SemTheme;
use gpui_kit::component::IndexPath;
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::select::{Select, SelectState};
use gpui_kit::prelude::*;
use gpui_kit::*;

/// A text state for [`TextField`]. Hold it in your view: it is the field's value and focus.
pub fn text_state(window: &mut Window, cx: &mut App, masked: bool) -> Entity<InputState> {
    cx.new(|cx| InputState::new(window, cx).masked(masked))
}

/// A state for [`SelectField`] over a fixed list of labels.
pub fn select_state(
    items: Vec<SharedString>,
    selected: Option<usize>,
    window: &mut Window,
    cx: &mut App,
) -> Entity<SelectState<Vec<SharedString>>> {
    let selected = selected.map(|index| IndexPath::default().row(index));
    cx.new(|cx| SelectState::new(items, selected, window, cx))
}

fn frame_color(focused: bool, error: bool, disabled: bool, cx: &App) -> Hsla {
    let sem = cx.sem();
    if disabled {
        sem.action_disabled_bg
    } else if error {
        sem.error
    } else if focused {
        sem.input_border_focused
    } else {
        sem.input_border
    }
}

/// The floated or resting label over a frame. `surface` is whatever the field sits on.
fn floating_label(
    label: SharedString,
    required: bool,
    floated: bool,
    color: Hsla,
    surface: Hsla,
) -> Div {
    let content: SharedString = if required {
        format!("{label} *").into()
    } else {
        label
    };
    let at_rest = div()
        .absolute()
        .left(px(14.))
        .top(px(16.))
        .text_color(color);
    if floated {
        div()
            .absolute()
            .left(px(9.))
            .top(px(-9.))
            .px(px(5.))
            .bg(surface)
            .text_color(color)
            .child(text(Variant::Caption, content).line_height(px(18.)))
    } else {
        at_rest.child(text(Variant::Body1, content))
    }
}

/// MuiTextField, outlined.
#[derive(IntoElement)]
pub struct TextField {
    id: ElementId,
    state: Entity<InputState>,
    label: SharedString,
    placeholder: Option<SharedString>,
    helper: Option<SharedString>,
    error: bool,
    required: bool,
    disabled: bool,
    surface: Option<Hsla>,
}

impl TextField {
    pub fn new(
        id: impl Into<ElementId>,
        state: &Entity<InputState>,
        label: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            state: state.clone(),
            label: label.into(),
            placeholder: None,
            helper: None,
            error: false,
            required: false,
            disabled: false,
            surface: None,
        }
    }

    /// Shows only while focused and empty, as MUI's does under a label.
    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = Some(placeholder.into());
        self
    }

    pub fn helper(mut self, helper: impl Into<SharedString>) -> Self {
        self.helper = Some(helper.into());
        self
    }

    pub fn error(mut self, error: bool) -> Self {
        self.error = error;
        self
    }

    pub fn required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// The colour behind the field, for the label's notch. Defaults to paper.
    pub fn surface(mut self, surface: Hsla) -> Self {
        self.surface = Some(surface);
        self
    }
}

impl RenderOnce for TextField {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let (focused, empty) = {
            let state = self.state.read(cx);
            (
                state.focus_handle(cx).is_focused(window),
                state.value().is_empty(),
            )
        };
        let sem = cx.sem();
        let color = frame_color(focused, self.error, self.disabled, cx);
        let label_color = if self.error {
            sem.error
        } else if focused {
            sem.primary
        } else if self.disabled {
            sem.text_disabled
        } else {
            sem.text_secondary
        };
        let surface = self.surface.unwrap_or(sem.paper);
        let helper_color = if self.error {
            sem.error
        } else {
            sem.text_secondary
        };
        let placeholder_color = sem.text_secondary.opacity(0.75);
        let hover_border = sem.text_primary;
        let (error, disabled) = (self.error, self.disabled);
        div()
            .id(self.id.clone())
            .w_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .id("frame")
                    .relative()
                    .h(px(56.))
                    .w_full()
                    .rounded(px(4.))
                    .border_1()
                    .when(focused || error, |frame| frame.border_2())
                    .border_color(color)
                    .when(!focused && !error && !disabled, |frame| {
                        frame.hover(move |style| style.border_color(hover_border))
                    })
                    .flex()
                    .items_center()
                    .px(px(if focused || error { 13. } else { 14. }))
                    .child(
                        Input::new(&self.state)
                            .id(self.id)
                            .aria_label(self.label.clone())
                            .appearance(false)
                            .disabled(self.disabled)
                            .px_0()
                            .text_size(px(16.)),
                    )
                    .children(self.placeholder.filter(|_| focused && empty).map(|shown| {
                        div()
                            .absolute()
                            .left(px(13.))
                            .top(px(15.))
                            .text_color(placeholder_color)
                            .child(text(Variant::Body1, shown))
                    }))
                    .child(floating_label(
                        self.label,
                        self.required,
                        focused || !empty,
                        label_color,
                        surface,
                    )),
            )
            .children(self.helper.map(|helper| {
                div()
                    .px(px(14.))
                    .pt(px(3.))
                    .text_color(helper_color)
                    .child(text(Variant::Caption, helper))
            }))
    }
}

/// MuiSelect, outlined: gpui-kit's list and keyboard handling in our frame.
#[derive(IntoElement)]
pub struct SelectField {
    id: ElementId,
    state: Entity<SelectState<Vec<SharedString>>>,
    label: SharedString,
    disabled: bool,
    surface: Option<Hsla>,
}

impl SelectField {
    pub fn new(
        id: impl Into<ElementId>,
        state: &Entity<SelectState<Vec<SharedString>>>,
        label: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            state: state.clone(),
            label: label.into(),
            disabled: false,
            surface: None,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn surface(mut self, surface: Hsla) -> Self {
        self.surface = Some(surface);
        self
    }
}

impl RenderOnce for SelectField {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let chosen = self.state.read(cx).selected_value().is_some();
        let sem = cx.sem();
        let surface = self.surface.unwrap_or(sem.paper);
        let label_color = if self.disabled {
            sem.text_disabled
        } else {
            sem.text_secondary
        };
        let border = frame_color(false, false, self.disabled, cx);
        div()
            .relative()
            .h(px(56.))
            .w_full()
            .rounded(px(4.))
            .border_1()
            .border_color(border)
            .child(
                div().size_full().flex().items_center().child(
                    Select::new(&self.state)
                        .id(self.id)
                        .accessibility_label(self.label.clone())
                        .appearance(false)
                        .disabled(self.disabled)
                        .h_full()
                        .pl(px(14.))
                        .pr(px(10.))
                        .text_size(px(16.)),
                ),
            )
            .child(floating_label(
                self.label,
                false,
                chosen,
                label_color,
                surface,
            ))
    }
}
