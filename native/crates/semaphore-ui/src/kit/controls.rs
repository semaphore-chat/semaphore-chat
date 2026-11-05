//! Button, IconButton, Switch, Radio, Checkbox and Slider: gpui-kit's unstyled controls in MUI's paint.

use super::{Action, Icon, Spinner, ValueAction, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::component::slider as kit_slider;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use std::rc::Rc;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

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

/// MuiButton, with the theme's `contained` and `outlined` overrides.
#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    label: SharedString,
    variant: ButtonVariant,
    size: ButtonSize,
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
        let foreground = match self.variant {
            _ if inactive => sem.action_disabled,
            ButtonVariant::Contained => sem.primary_contrast,
            ButtonVariant::Outlined | ButtonVariant::Text => {
                self.color.unwrap_or(sem.outlined_text)
            }
        };
        let hover_bg = self
            .color
            .map(|color| color.opacity(0.08))
            .unwrap_or(sem.outlined_hover_bg);
        let (variant, contained_hover, outlined_hover_border, outlined_border) = (
            self.variant,
            sem.contained_hover,
            sem.outlined_hover_border,
            sem.outlined_border,
        );

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
                .bg(sem.contained.background())
                .hover(move |style| style.bg(contained_hover.background()))
                .focus_visible(move |style| style.bg(contained_hover.background())),
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

/// MuiCheckbox: the 18px box MUI's icon draws, in a 42px target.
#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    label: SharedString,
    checked: bool,
    disabled: bool,
    on_change: Option<ValueAction<bool>>,
}

impl Checkbox {
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

impl RenderOnce for Checkbox {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
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
        let checked = self.checked;
        let check_color = if sem.is_dark {
            sem.background_default
        } else {
            sem.paper
        };
        let focus = sem.action_selected;
        let mut element = base::Checkbox::new(self.id)
            .checked(checked)
            .disabled(self.disabled)
            .accessibility_label(self.label.clone())
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(12.))
            .p(px(12.))
            .rounded(px(21.))
            .focus_visible(move |style| style.bg(focus))
            .when(!self.disabled, |element| element.cursor_pointer());
        if let Some(handler) = self.on_change {
            element = element.on_change(move |state, _, window, cx| {
                handler(state == base::CheckboxState::Checked, window, cx);
            });
        }
        element
            .child(
                div()
                    .size(px(18.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(2.))
                    .when(checked, |box_| {
                        box_.bg(on)
                            .child(Icon::new(IconName::Check).size(16.).color(check_color))
                    })
                    .when(!checked, |box_| box_.border_2().border_color(off)),
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
