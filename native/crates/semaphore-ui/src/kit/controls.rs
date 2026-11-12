//! Button, IconButton, Switch, Radio, Checkbox and Slider: gpui-kit's unstyled controls in MUI's paint.

use super::{Action, Icon, Spinner, ValueAction, Variant, text};
use crate::theme::color::{contrast_ratio, darken, hsla_of, parse_hex, readable_text_color};
use crate::theme::{Paint, Sem, SemTheme};
use gpui_kit::base;
use gpui_kit::component::slider as kit_slider;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use std::rc::Rc;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;
type StateHandler = Rc<dyn Fn(CheckState, &mut Window, &mut App)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ButtonVariant {
    #[default]
    Text,
    Outlined,
    Contained,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ButtonSize {
    Small,
    #[default]
    Medium,
    Large,
}

/// What a filled button is filled with: the accent (the default), `error`'s red or `warning`'s
/// amber. Only [`ButtonVariant::Contained`] paints it; outlined and text buttons keep [`Button::color`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ButtonTone {
    #[default]
    Default,
    Danger,
    Warning,
}

/// The three paints and the label a filled button draws with. For the default tone `background` and
/// `hover` are the theme's accent (a gradient in the balanced and vibrant intensities).
#[derive(Debug, Clone, Copy, PartialEq)]
struct FilledTone {
    background: Paint,
    hover: Paint,
    pressed: Paint,
    label: Hsla,
}

impl ButtonTone {
    fn paint(self, sem: &Sem) -> FilledTone {
        let (main, contrast) = match self {
            ButtonTone::Default => {
                return FilledTone {
                    background: sem.contained,
                    hover: sem.contained_hover,
                    pressed: sem.contained_hover,
                    label: sem.primary_contrast,
                };
            }
            ButtonTone::Danger => (sem.palette.error_main, sem.palette.error_contrast_text),
            ButtonTone::Warning => (sem.palette.warning_main, sem.palette.warning_contrast_text),
        };
        let hover = darken(main, 0.08);
        let pressed = darken(main, 0.12);
        FilledTone {
            background: Paint::Solid(hsla_of(main)),
            hover: Paint::Solid(hsla_of(hover)),
            pressed: Paint::Solid(hsla_of(pressed)),
            label: readable_label(contrast, [main, hover, pressed]),
        }
    }
}

/// The label for a filled tone: white or black, whichever reads better on the fill, and mixed
/// towards the other extreme until it meets WCAG AA on every state's fill (warning's amber needs
/// the dark extreme in both modes; dark mode's lighter red does too).
fn readable_label(contrast: semaphore_design::Rgba, fills: [semaphore_design::Rgba; 3]) -> Hsla {
    let white = parse_hex("#ffffff");
    let black = parse_hex("#000000");
    let preferred = if contrast_ratio(contrast, fills[0]) >= contrast_ratio(black, fills[0]) {
        contrast
    } else {
        black
    };
    let towards = if preferred == black { white } else { black };
    hsla_of(readable_text_color(preferred, &fills, towards))
}

/// MuiButton, with the theme's `contained` and `outlined` overrides.
#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: SharedString,
    variant: ButtonVariant,
    size: ButtonSize,
    tone: ButtonTone,
    start_icon: Option<IconName>,
    full_width: bool,
    disabled: bool,
    loading: bool,
    color: Option<Hsla>,
    on_click: Option<ClickHandler>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            variant: ButtonVariant::default(),
            size: ButtonSize::default(),
            tone: ButtonTone::default(),
            start_icon: None,
            full_width: false,
            disabled: false,
            loading: false,
            color: None,
            on_click: None,
        }
    }

    pub fn contained(mut self) -> Self {
        self.variant = ButtonVariant::Contained;
        self
    }

    pub fn outlined(mut self) -> Self {
        self.variant = ButtonVariant::Outlined;
        self
    }

    pub fn size(mut self, size: ButtonSize) -> Self {
        self.size = size;
        self
    }

    /// A filled button's colour: the accent by default, or the danger or warning tone. Outlined and
    /// text buttons ignore it; use [`Button::color`] for those.
    pub fn tone(mut self, tone: ButtonTone) -> Self {
        self.tone = tone;
        self
    }

    pub fn start_icon(mut self, icon: IconName) -> Self {
        self.start_icon = Some(icon);
        self
    }

    pub fn full_width(mut self) -> Self {
        self.full_width = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// A spinner replaces the label and the button stops responding.
    pub fn loading(mut self, loading: bool) -> Self {
        self.loading = loading;
        self
    }

    /// A text colour other than the accent: `color="error"`, say.
    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Button {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let inactive = self.disabled || self.loading;
        let (height, padding_x, icon_size, label_size) = match self.size {
            ButtonSize::Small => (30., 10., 18., 13.),
            ButtonSize::Medium => (36., 16., 20., 14.),
            ButtonSize::Large => (42., 22., 22., 15.),
        };
        let tone = self.tone.paint(&sem);
        let foreground = match self.variant {
            _ if inactive => sem.action_disabled,
            ButtonVariant::Contained => tone.label,
            ButtonVariant::Outlined | ButtonVariant::Text => {
                self.color.unwrap_or(sem.outlined_text)
            }
        };
        let hover_bg = self
            .color
            .map(|color| color.opacity(0.08))
            .unwrap_or(sem.outlined_hover_bg);
        let (variant, outlined_hover_border, outlined_border) =
            (self.variant, sem.outlined_hover_border, sem.outlined_border);

        let mut button = base::Button::new(self.id)
            .disabled(inactive)
            .accessibility_label(self.label.clone())
            .h(px(height))
            .px(px(padding_x))
            .flex()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .rounded(px(4.))
            .text_color(foreground)
            .when(self.full_width, |button| button.w_full())
            .when(!inactive, |button| button.cursor_pointer());
        button = match variant {
            ButtonVariant::Contained if inactive => button.bg(sem.action_disabled_bg),
            ButtonVariant::Contained => button
                .bg(tone.background.background())
                .hover(move |style| style.bg(tone.hover.background()))
                .active(move |style| style.bg(tone.pressed.background()))
                .focus_visible(move |style| style.bg(tone.hover.background())),
            ButtonVariant::Outlined => button
                .border_1()
                .border_color(if inactive {
                    sem.action_disabled_bg
                } else {
                    outlined_border
                })
                .when(!inactive, |button| {
                    button
                        .hover(move |style| style.border_color(outlined_hover_border).bg(hover_bg))
                        .focus_visible(move |style| {
                            style.border_color(outlined_hover_border).bg(hover_bg)
                        })
                }),
            ButtonVariant::Text => button.when(!inactive, |button| {
                button
                    .hover(move |style| style.bg(hover_bg))
                    .focus_visible(move |style| style.bg(hover_bg))
            }),
        };
        if let Some(handler) = self.on_click.filter(|_| !inactive) {
            button = button.on_click(move |event, window, cx| handler(event, window, cx));
        }
        let (_, weight, _) = Variant::Button.metrics();
        button
            .when(self.loading, |button| {
                button.child(Spinner::new("button-spinner").size(24.).color(foreground))
            })
            .when(!self.loading, |button| {
                button
                    .children(
                        self.start_icon
                            .map(|icon| Icon::new(icon).size(icon_size).color(foreground)),
                    )
                    .child(
                        text(Variant::Button, self.label.clone())
                            .text_size(px(label_size))
                            .font_weight(FontWeight(weight)),
                    )
            })
    }
}

/// MuiIconButton: round, tinted by the accent on hover. Needs a label: the icon alone says nothing
/// to a screen reader.
#[derive(IntoElement)]
pub struct IconButton {
    id: ElementId,
    icon: IconName,
    label: SharedString,
    size: f32,
    icon_size: f32,
    color: Option<Hsla>,
    selected: bool,
    disabled: bool,
    on_click: Option<ClickHandler>,
}

impl IconButton {
    pub fn new(id: impl Into<ElementId>, icon: IconName, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            icon,
            label: label.into(),
            size: 40.,
            icon_size: 24.,
            color: None,
            selected: false,
            disabled: false,
            on_click: None,
        }
    }

    /// `size="small"`: 34px with a 20px icon.
    pub fn small(mut self) -> Self {
        self.size = 34.;
        self.icon_size = 20.;
        self
    }

    /// `size="small"` with `fontSize="small"`'s tighter padding: 30px.
    pub fn tiny(mut self) -> Self {
        self.size = 30.;
        self.icon_size = 20.;
        self
    }

    /// A small button with a regular 24px icon.
    pub fn small_with_large_icon(mut self) -> Self {
        self.size = 34.;
        self.icon_size = 24.;
        self
    }

    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for IconButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let hover = sem.icon_button_hover;
        let focus = sem.action_selected;
        let color = if self.disabled {
            sem.action_disabled
        } else {
            self.color.unwrap_or(sem.action_active)
        };
        let mut button = base::Button::new(self.id)
            .disabled(self.disabled)
            .selected(self.selected)
            .accessibility_label(self.label)
            .size(px(self.size))
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .rounded_full()
            .when(!self.disabled, |button| {
                button
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .focus_visible(move |style| style.bg(focus))
            })
            .when(self.selected, |button| button.bg(hover));
        if let Some(handler) = self.on_click.filter(|_| !self.disabled) {
            button = button.on_click(move |event, window, cx| handler(event, window, cx));
        }
        button.child(Icon::new(self.icon).size(self.icon_size).color(color))
    }
}

/// MuiSwitch: a 34x14 track and a 20px thumb that overhangs it.
#[derive(IntoElement)]
pub struct Switch {
    id: ElementId,
    label: SharedString,
    checked: bool,
    disabled: bool,
    on_change: Option<ValueAction<bool>>,
}

impl Switch {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, checked: bool) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            checked,
            disabled: false,
            on_change: None,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_change(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Switch {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let track = if self.checked {
            sem.control_on.opacity(0.5)
        } else if sem.is_dark {
            hsla(0., 0., 1., 0.3)
        } else {
            hsla(0., 0., 0., 0.38)
        };
        let focus = sem.action_selected;
        let thumb = match (self.checked, sem.is_dark) {
            (true, _) => sem.control_on,
            (false, true) => Hsla::from(rgb(0xe0e0e0)),
            (false, false) => Hsla::from(rgb(0xffffff)),
        };
        let mut element = base::Switch::new(self.id)
            .checked(self.checked)
            .disabled(self.disabled)
            .accessibility_label(self.label)
            .w(px(58.))
            .h(px(38.))
            .relative()
            .flex_shrink_0()
            .rounded(px(19.))
            .focus_visible(move |style| style.bg(focus))
            .when(self.disabled, |element| element.opacity(0.38))
            .when(!self.disabled, |element| element.cursor_pointer());
        if let Some(handler) = self.on_change {
            element = element.on_change(move |checked, _, window, cx| {
                handler(checked, window, cx);
            });
        }
        element
            .child(
                div()
                    .absolute()
                    .left(px(12.))
                    .top(px(12.))
                    .w(px(34.))
                    .h(px(14.))
                    .rounded(px(7.))
                    .bg(track),
            )
            .child(
                div()
                    .absolute()
                    .left(px(if self.checked { 29. } else { 9. }))
                    .top(px(9.))
                    .size(px(20.))
                    .rounded_full()
                    .shadow_sm()
                    .bg(thumb),
            )
    }
}

/// MuiRadio: a 20px ring in a 42px target.
#[derive(IntoElement)]
pub struct Radio {
    id: ElementId,
    label: SharedString,
    checked: bool,
    disabled: bool,
    on_select: Option<Action>,
}

impl Radio {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, checked: bool) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            checked,
            disabled: false,
            on_select: None,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_select(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Radio {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let color = if self.disabled {
            sem.action_disabled
        } else if self.checked {
            sem.control_on
        } else {
            sem.text_secondary
        };
        let focus = sem.action_selected;
        let mut element = base::Radio::new(self.id)
            .checked(self.checked)
            .disabled(self.disabled)
            .accessibility_label(self.label.clone())
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(11.))
            .p(px(11.))
            .rounded(px(21.))
            .focus_visible(move |style| style.bg(focus))
            .when(!self.disabled, |element| element.cursor_pointer());
        if let Some(handler) = self.on_select {
            element = element.on_change(move |_, _, window, cx| handler(window, cx));
        }
        element
            .child(
                div()
                    .size(px(20.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .border_2()
                    .border_color(color)
                    .when(self.checked, |ring| {
                        ring.child(div().size(px(10.)).rounded_full().bg(color))
                    }),
            )
            .child(
                text(Variant::Body1, self.label).text_color(if self.disabled {
                    sem.text_disabled
                } else {
                    sem.text_primary
                }),
            )
    }
}

/// MuiCheckbox's three states: `indeterminate` is the bar a group shows when only some of it is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CheckState {
    #[default]
    Unchecked,
    Checked,
    Indeterminate,
}

impl CheckState {
    pub fn is_checked(self) -> bool {
        matches!(self, CheckState::Checked)
    }

    /// What a press gives, as MUI does: a partly selected box becomes checked, a checked one clears.
    pub fn toggled(self) -> Self {
        match self {
            CheckState::Checked => CheckState::Unchecked,
            CheckState::Unchecked | CheckState::Indeterminate => CheckState::Checked,
        }
    }

    fn of(state: base::CheckboxState) -> Self {
        match state {
            base::CheckboxState::Unchecked => CheckState::Unchecked,
            base::CheckboxState::Checked => CheckState::Checked,
            base::CheckboxState::Indeterminate => CheckState::Indeterminate,
        }
    }

    fn base(self) -> base::CheckboxState {
        match self {
            CheckState::Unchecked => base::CheckboxState::Unchecked,
            CheckState::Checked => base::CheckboxState::Checked,
            CheckState::Indeterminate => base::CheckboxState::Indeterminate,
        }
    }
}

impl From<bool> for CheckState {
    fn from(checked: bool) -> Self {
        if checked {
            CheckState::Checked
        } else {
            CheckState::Unchecked
        }
    }
}

/// MuiCheckbox: the 18px box MUI's icon draws, in a 42px target.
///
/// The label sits beside the box and wraps onto as many lines as its width needs; [`Checkbox::caption`]
/// adds a smaller muted line under it. [`Checkbox::hide_label`] keeps the label as the accessible name
/// and draws only the box, for a row that names the thing itself.
#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    label: SharedString,
    state: CheckState,
    caption: Option<SharedString>,
    hide_label: bool,
    dense: bool,
    disabled: bool,
    on_change: Option<StateHandler>,
    base: Div,
}

impl Checkbox {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, checked: bool) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            state: checked.into(),
            caption: None,
            hide_label: false,
            dense: false,
            disabled: false,
            on_change: None,
            base: div(),
        }
    }

    /// The third state: `indeterminate` draws the bar instead of the check.
    pub fn state(mut self, state: CheckState) -> Self {
        self.state = state;
        self
    }

    /// A smaller, muted line under the label: a permission key, or the username beside a name.
    pub fn caption(mut self, caption: impl Into<SharedString>) -> Self {
        self.caption = Some(caption.into());
        self
    }

    /// Draw only the box. The label stays the accessible name.
    pub fn hide_label(mut self) -> Self {
        self.hide_label = true;
        self
    }

    /// A dense list row's tighter geometry: 42px tall rather than 48.
    pub fn dense(mut self) -> Self {
        self.dense = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// The new checked value. A partly selected box reports `true`, as a press checks it.
    pub fn on_change(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(move |state, window, cx| {
            handler(state.is_checked(), window, cx);
        }));
        self
    }

    /// The new state, for a box that has a partly selected state or a handler that decides its own.
    pub fn on_toggle(
        mut self,
        handler: impl Fn(CheckState, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl Styled for Checkbox {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl RenderOnce for Checkbox {
    fn render(mut self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let on = if self.disabled {
            sem.action_disabled
        } else {
            sem.control_on
        };
        let off = if self.disabled {
            sem.action_disabled
        } else {
            sem.text_secondary
        };
        let check_color = if sem.is_dark {
            sem.background_default
        } else {
            sem.paper
        };
        let focus = sem.action_selected;
        let state = self.state;
        let (outer_padding, gap, label_padding, box_padding, radius) = if self.dense {
            (0., 0., 4., 12., 4.)
        } else {
            (12., 12., 0., 0., 21.)
        };
        let mut element = base::Checkbox::new(self.id);
        *element.style() = self.base.style().clone();
        element = element
            .state(state.base())
            .disabled(self.disabled)
            .accessibility_label(self.label.clone())
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(gap))
            .p(px(outer_padding))
            .rounded(px(radius))
            .focus_visible(move |style| style.bg(focus))
            .when(!self.disabled, |element| element.cursor_pointer());
        if let Some(handler) = self.on_change {
            element = element.on_change(move |state, _, window, cx| {
                handler(CheckState::of(state), window, cx);
            });
        }
        element
            .child(
                div()
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(box_padding))
                    .rounded(px(21.))
                    .child(
                        div()
                            .size(px(18.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(2.))
                            .map(|box_| match state {
                                CheckState::Unchecked => box_.border_2().border_color(off),
                                CheckState::Indeterminate => box_
                                    .bg(on)
                                    .child(div().w(px(10.)).h(px(2.)).bg(check_color)),
                                CheckState::Checked => box_
                                    .bg(on)
                                    .child(Icon::new(IconName::Check).size(16.).color(check_color)),
                            }),
                    ),
            )
            .when(!self.hide_label, |element| {
                element.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .py(px(label_padding))
                        .child(
                            text(Variant::Body1, self.label).text_color(if self.disabled {
                                sem.text_disabled
                            } else {
                                sem.text_primary
                            }),
                        )
                        .children(self.caption.map(|caption| {
                            text(Variant::Caption, caption).text_color(sem.text_secondary)
                        })),
                )
            })
    }
}

/// MuiSlider, on gpui-kit's own: dragging, keys and the role come with it. Hold a
/// `kit_slider::SliderState` entity in your view; the colours come from the theme mapping.
#[derive(IntoElement)]
pub struct Slider {
    state: Entity<kit_slider::SliderState>,
    label: SharedString,
    disabled: bool,
}

impl Slider {
    pub fn new(state: &Entity<kit_slider::SliderState>, label: impl Into<SharedString>) -> Self {
        Self {
            state: state.clone(),
            label: label.into(),
            disabled: false,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl RenderOnce for Slider {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        kit_slider::Slider::new(&self.state)
            .horizontal()
            .disabled(self.disabled)
            .accessibility_label(self.label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
    use crate::theme::ThemeChoice;
    use crate::theme::color::{contrast_ratio, token_of};
    use core::prelude::v1::test;

    fn solid(paint: Paint) -> Hsla {
        match paint {
            Paint::Solid(color) => color,
            Paint::Linear(..) => panic!("a tone fill is solid"),
        }
    }

    #[test]
    fn tone_labels_read_on_every_fill_in_every_theme() {
        for choice in ThemeChoice::all() {
            let sem = Sem::new(choice);
            for tone in [ButtonTone::Danger, ButtonTone::Warning] {
                let paint = tone.paint(&sem);
                for fill in [paint.background, paint.hover, paint.pressed] {
                    let ratio = contrast_ratio(token_of(paint.label), token_of(solid(fill)));
                    assert!(ratio >= 4.5, "{tone:?} label in {}: {ratio}", choice.name());
                }
            }
        }
    }

    #[test]
    fn the_default_tone_is_the_accent() {
        for choice in ThemeChoice::all() {
            let sem = Sem::new(choice);
            let paint = ButtonTone::Default.paint(&sem);
            assert_eq!(paint.background, sem.contained);
            assert_eq!(paint.hover, sem.contained_hover);
            assert_eq!(paint.label, sem.primary_contrast);
        }
    }

    #[test]
    fn a_press_checks_a_partly_selected_box() {
        assert_eq!(CheckState::Unchecked.toggled(), CheckState::Checked);
        assert_eq!(CheckState::Checked.toggled(), CheckState::Unchecked);
        assert_eq!(CheckState::Indeterminate.toggled(), CheckState::Checked);
        assert!(CheckState::Checked.is_checked());
        assert!(!CheckState::Indeterminate.is_checked());
    }
}
