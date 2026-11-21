//! TextField and SelectField in the design system's look (`frontend/src/kit/fields/`): the label
//! above, never floating; a fill box that stands out from its layer, with a focus ring; the helper
//! or the error under it. gpui-kit's editor and select supply the behaviour.
//!
//! [`notched`] and [`floating_label`] are the old outlined frame, for the hand-built multiline
//! fields of screens not yet on the design system (epic #848).

use super::controls::field_label;
use super::look::{Surface, c, focus_ring, stand_out_fill, styled_text};
use super::{Icon, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::component::IndexPath;
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::select::{Select, SelectState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    BORDER_FOCUS_OFFSET, BORDER_SELECTED, CONTROL_LG, ICON_MD, ICON_XS, RADIUS_FIELD, RADIUS_FULL,
    SPACE_LG, SPACE_SM, SPACE_XS, STATE_DISABLED, TEXT_BODY, TEXT_META,
};
use semaphore_design::{LoungeIcon, Palette};

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

/// A bordered `frame` with its `label` (from [`floating_label`]) painted over the border.
pub(crate) fn notched(frame: impl IntoElement, label: Div) -> Div {
    div().relative().w_full().child(frame).child(label)
}

/// The floated or resting label for [`notched`]. `surface` is whatever the field sits on.
/// Positions are from the frame's outer edge, so the label stays put when the border thickens.
pub(crate) fn floating_label(
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
        .left(px(15.))
        .top(px(17.))
        .text_color(color);
    if floated {
        div()
            .absolute()
            .left(px(10.))
            .top(px(-8.))
            .px(px(5.))
            .bg(surface)
            .text_color(color)
            .child(text(Variant::Caption, content).line_height(px(18.)))
    } else {
        at_rest.child(text(Variant::Body1, content))
    }
}

/// A field's shape: the standard rounded box, or fully round (a search).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FieldShape {
    #[default]
    Field,
    Round,
}

impl FieldShape {
    pub fn radius(self) -> f32 {
        match self {
            FieldShape::Field => RADIUS_FIELD,
            FieldShape::Round => RADIUS_FULL,
        }
    }
}

/// The field box's paint (`FieldBox`): the fill that stands out from `on`, and a border that is
/// clear at rest (it holds the room an error takes) and danger when invalid.
pub fn field_box_paint(
    p: &Palette,
    on: Surface,
    error: bool,
) -> (semaphore_design::Rgba, Option<semaphore_design::Rgba>) {
    (stand_out_fill(p, on), error.then_some(p.danger))
}

/// The label above a field, with "required" beside it when it is.
fn label_row(label: SharedString, required: bool, p: &Palette) -> Div {
    div()
        .flex()
        .items_baseline()
        .gap(px(SPACE_SM))
        .min_w_0()
        .child(field_label(label, p))
        .when(required, |row| {
            row.child(styled_text(TEXT_META, "required").text_color(c(p.text_dim)))
        })
}

/// The helper, or the error in its place in danger with a warning icon.
fn message(helper: Option<SharedString>, error: bool, p: &Palette) -> Option<Div> {
    let helper = helper.filter(|helper| !helper.is_empty())?;
    let tone = if error { p.danger } else { p.text_secondary };
    Some(
        div()
            .flex()
            .items_start()
            .gap(px(SPACE_XS))
            .min_w_0()
            .text_color(c(tone))
            .when(error, |row| {
                row.child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(TEXT_META.line_height))
                        .child(
                            Icon::lounge(LoungeIcon::TriangleAlert)
                                .size(ICON_XS)
                                .color(c(p.danger)),
                        ),
                )
            })
            .child(styled_text(TEXT_META, helper).min_w_0()),
    )
}

/// The label, the box and the message around a field (`FieldShell`), dimmed as a whole when
/// disabled.
fn shell(
    id: ElementId,
    label: Option<Div>,
    field: impl IntoElement,
    message: Option<Div>,
    disabled: bool,
) -> Stateful<Div> {
    div()
        .id(id)
        .w_full()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(SPACE_XS))
        .when(disabled, |root| root.opacity(STATE_DISABLED))
        .children(label)
        .child(field)
        .children(message)
}

/// The box itself: fill, clear or danger border, the ring while focused (on any focus, as a
/// browser field shows it).
fn field_box(p: &Palette, on: Surface, error: bool, shape: FieldShape, focused: bool) -> Div {
    let (fill, border) = field_box_paint(p, on, error);
    div()
        .relative()
        .w_full()
        .min_w_0()
        .min_h(px(CONTROL_LG))
        .flex()
        .items_center()
        .gap(px(SPACE_SM))
        .px(px(SPACE_LG - BORDER_SELECTED))
        .rounded(px(shape.radius()))
        .border(px(BORDER_SELECTED))
        .border_color(border.map(c).unwrap_or(transparent_black()))
        .bg(c(fill))
        .text_color(c(p.text))
        .when(focused, |frame| {
            frame.child(focus_ring(p, shape.radius(), BORDER_FOCUS_OFFSET))
        })
}

/// A field where the user types text (`TextField`), on one line. The label sits above it unless
/// hidden; `error` marks it invalid and shows the helper as the error in its place.
#[derive(IntoElement)]
pub struct TextField {
    id: ElementId,
    state: Entity<InputState>,
    label: SharedString,
    label_hidden: bool,
    placeholder: Option<SharedString>,
    helper: Option<SharedString>,
    error: bool,
    required: bool,
    disabled: bool,
    shape: FieldShape,
    start_icon: Option<LoungeIcon>,
    on: Surface,
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
            label_hidden: false,
            placeholder: None,
            helper: None,
            error: false,
            required: false,
            disabled: false,
            shape: FieldShape::default(),
            start_icon: None,
            on: Surface::default(),
        }
    }

    /// A hint inside the empty field. It does not replace the label.
    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = Some(placeholder.into());
        self
    }

    /// A line of help under the field; with [`TextField::error`], the error message.
    pub fn helper(mut self, helper: impl Into<SharedString>) -> Self {
        self.helper = Some(helper.into());
        self
    }

    /// Marks the field invalid: a danger border, and the helper drawn as the error.
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

    /// Hides the label from the eye. It still names the field.
    pub fn label_hidden(mut self) -> Self {
        self.label_hidden = true;
        self
    }

    pub fn shape(mut self, shape: FieldShape) -> Self {
        self.shape = shape;
        self
    }

    /// An icon at the start of the field.
    pub fn start_icon(mut self, icon: LoungeIcon) -> Self {
        self.start_icon = Some(icon);
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = on;
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
        let p = cx.sem().roles;
        let field = field_box(&p, self.on, self.error, self.shape, focused)
            .children(
                self.start_icon
                    .map(|icon| Icon::lounge(icon).size(ICON_MD).color(c(p.text_secondary))),
            )
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_w_0()
                    .child(
                        Input::new(&self.state)
                            .id(self.id.clone())
                            .aria_label(self.label.clone())
                            .appearance(false)
                            .disabled(self.disabled)
                            .px_0()
                            .text_size(px(TEXT_BODY.size)),
                    )
                    .children(self.placeholder.filter(|_| empty).map(|shown| {
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .bottom_0()
                            .flex()
                            .items_center()
                            .text_color(c(p.text_dim))
                            .child(styled_text(TEXT_BODY, shown))
                    })),
            );
        shell(
            ElementId::NamedChild(std::sync::Arc::new(self.id), "shell".into()),
            (!self.label_hidden).then(|| label_row(self.label, self.required, &p)),
            field,
            message(self.helper, self.error, &p),
            self.disabled,
        )
    }
}

/// A field where the user picks one option from a list that opens on demand (`SelectField`):
/// gpui-kit's list and keyboard handling in the field box.
#[derive(IntoElement)]
pub struct SelectField {
    id: ElementId,
    state: Entity<SelectState<Vec<SharedString>>>,
    label: SharedString,
    label_hidden: bool,
    placeholder: Option<SharedString>,
    helper: Option<SharedString>,
    error: bool,
    disabled: bool,
    on: Surface,
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
            label_hidden: false,
            placeholder: None,
            helper: None,
            error: false,
            disabled: false,
            on: Surface::default(),
        }
    }

    /// Shown while nothing is chosen.
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

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn label_hidden(mut self) -> Self {
        self.label_hidden = true;
        self
    }
}

impl RenderOnce for SelectField {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let focused = self
            .state
            .read(cx)
            .focus_handle(cx)
            .contains_focused(window, cx);
        let p = cx.sem().roles;
        let field = field_box(&p, self.on, self.error, FieldShape::Field, focused)
            .px_0()
            .child(
                div().size_full().flex().items_center().child(
                    Select::new(&self.state)
                        .id(self.id.clone())
                        .accessibility_label(self.label.clone())
                        .placeholder(self.placeholder.unwrap_or_default())
                        .appearance(false)
                        .disabled(self.disabled)
                        .h(px(CONTROL_LG - 2. * BORDER_SELECTED))
                        .pl(px(SPACE_LG - BORDER_SELECTED))
                        .pr(px(SPACE_SM))
                        .text_size(px(TEXT_BODY.size)),
                ),
            );
        shell(
            ElementId::NamedChild(std::sync::Arc::new(self.id), "shell".into()),
            (!self.label_hidden).then(|| label_row(self.label, false, &p)),
            field,
            message(self.helper, self.error, &p),
            self.disabled,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kit::look::tests::inputs;
    use crate::theme::Sem;
    use crate::theme::color::contrast_ratio;
    use core::prelude::v1::test;

    #[test]
    fn the_box_stands_out_and_an_error_draws_the_border() {
        let p = Sem::default().roles;
        assert_eq!(field_box_paint(&p, Surface::Surface, false), (p.fill, None));
        assert_eq!(
            field_box_paint(&p, Surface::Fill, true),
            (p.surface, Some(p.danger))
        );
        assert_eq!(FieldShape::Field.radius(), RADIUS_FIELD);
        assert_eq!(FieldShape::Round.radius(), RADIUS_FULL);
    }

    /// The lowest placeholder contrast the palette gives today: `text_dim` on a field's fill is
    /// under the 4.5:1 text target (about 4.2 to 4.4 on the default base, in both clients). The
    /// palette promises `text_dim` only on the ground and the surface; the placeholder question is
    /// issue #873. Until it is settled this holds the level where it is, so it can only go up.
    const PLACEHOLDER_FLOOR: f32 = 4.1;

    #[test]
    fn text_dim_pairings_on_every_theme() {
        for input in inputs() {
            let p = Sem::new(input).roles;
            let name = input.name();
            for on in [Surface::Ground, Surface::Surface] {
                let (fill, _) = field_box_paint(&p, on, false);
                let ratio = contrast_ratio(p.text_dim, fill);
                assert!(
                    ratio >= PLACEHOLDER_FLOOR,
                    "{name} on {on:?}: placeholder {ratio:.2}:1"
                );
                // "required", the off switch track and the unchecked checkbox and radio borders
                // all draw `text_dim` on the layer itself.
                let under = crate::kit::look::tint_base(&p, on);
                let ratio = contrast_ratio(p.text_dim, under);
                assert!(
                    ratio >= 4.5,
                    "{name} on {on:?}: text_dim on the layer {ratio:.2}:1"
                );
            }
        }
    }

    #[test]
    fn field_text_reads_on_every_theme() {
        for input in inputs() {
            let p = Sem::new(input).roles;
            for on in [Surface::Ground, Surface::Surface] {
                let (fill, _) = field_box_paint(&p, on, false);
                let name = input.name();
                let check = |what: &str, ink, target: f32| {
                    let ratio = contrast_ratio(ink, fill);
                    assert!(ratio >= target, "{name} on {on:?}: {what} {ratio:.2}:1");
                };
                check("value", p.text, 4.5);
                check("start icon", p.text_secondary, 3.);
                // The danger border is a non-text mark beside the fill.
                check("error border", p.danger, 3.);
                let under = crate::kit::look::tint_base(&p, on);
                for (what, ink) in [
                    ("helper", p.text_secondary),
                    ("error", p.danger),
                    ("label", p.text_secondary),
                ] {
                    let ratio = contrast_ratio(ink, under);
                    assert!(ratio >= 4.5, "{name} on {on:?}: {what} {ratio:.2}:1");
                }
            }
        }
    }
}
