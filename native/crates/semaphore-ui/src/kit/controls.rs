//! Button, IconButton, KeyCap, Switch, Checkbox, Radio, RadioGroup and Slider: gpui-kit's unstyled
//! controls in the design system's look (`frontend/src/kit/controls/`, `design/guide/components.md`).
//!
//! The colours are [`super::look`]'s, the sizes the generated tokens. Behaviour follows the guide:
//! disabled takes a control out of the tab order and dims it; loading keeps it focusable, ignores
//! presses and shows a spinner; focus is drawn only for keyboard focus.

use super::look::{
    ButtonLook, ButtonVariant, ControlSize, Surface, button_look, c, focus_handle,
    outer_focus_ring, shows_focus, stand_out_fill, styled_text, tint_base,
};
use super::{Action, Icon, Spinner, ValueAction};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::component::slider as kit_slider;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{
    BORDER_HAIRLINE, BORDER_SELECTED, CONTROL_MD, ICON_LG, ICON_MD, ICON_SM, ICON_XL, ICON_XS,
    RADIUS_FULL, RADIUS_SM, SPACE_2XS, SPACE_MD, SPACE_SM, SPACE_XL, SPACE_XS, STATE_DISABLED,
    STATE_HOVER, STATE_HOVER_ON_FILL, STATE_PRESSED, STATE_PRESSED_ON_FILL, TEXT_BODY,
    TEXT_BODY_STRONG, TEXT_META, TEXT_TAG,
};
use semaphore_design::{Icon as IconName, LoungeIcon, Palette};
use std::rc::Rc;

/// A button's size: `sm`, `md` (the default) or `lg`.
pub type ButtonSize = ControlSize;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;
type StateHandler = Rc<dyn Fn(CheckState, &mut Window, &mut App)>;

/// What a control's busy and unavailable flags come to, with `disabled` winning over both and
/// `loading` over `unavailable` (the guide's rules).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Availability {
    /// Out of the tab order, dimmed.
    pub disabled: bool,
    /// Focusable, shows a spinner, ignores presses.
    pub busy: bool,
    /// Focusable, dimmed, ignores presses.
    pub unavailable: bool,
}

impl Availability {
    pub fn of(disabled: bool, loading: bool, unavailable: bool) -> Self {
        let busy = loading && !disabled;
        Self {
            disabled,
            busy,
            unavailable: unavailable && !disabled && !busy,
        }
    }

    /// Whether a press runs the action.
    pub fn acts(self) -> bool {
        !self.disabled && !self.busy && !self.unavailable
    }

    /// Whether the control is still a Tab stop.
    pub fn focusable(self) -> bool {
        !self.disabled
    }

    /// What assistive technology hears after the name: "busy" or "unavailable".
    pub fn announcement(self) -> Option<&'static str> {
        if self.busy {
            Some("busy")
        } else if self.unavailable {
            Some("unavailable")
        } else {
            None
        }
    }

    /// The opacity the control draws at.
    pub fn opacity(self) -> f32 {
        if self.disabled || self.unavailable {
            STATE_DISABLED
        } else {
            1.
        }
    }
}

/// A pill button with a text label (`Button`). `variant` defaults to `soft`, `size` to `md`.
#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    focus: Option<FocusHandle>,
    label: SharedString,
    variant: ButtonVariant,
    size: ControlSize,
    start_icon: Option<IconName>,
    full_width: bool,
    disabled: bool,
    loading: bool,
    unavailable: bool,
    on: Option<Surface>,
    on_click: Option<ClickHandler>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            focus: None,
            label: label.into(),
            variant: ButtonVariant::default(),
            size: ControlSize::default(),
            start_icon: None,
            full_width: false,
            disabled: false,
            loading: false,
            unavailable: false,
            on: None,
            on_click: None,
        }
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    /// `variant="primary"`: the one main action on a surface.
    pub fn primary(self) -> Self {
        self.variant(ButtonVariant::Primary)
    }

    /// `variant="soft"` (the default): ordinary actions.
    pub fn soft(self) -> Self {
        self.variant(ButtonVariant::Soft)
    }

    /// `variant="ghost"`: low-emphasis actions in toolbars and rows.
    pub fn ghost(self) -> Self {
        self.variant(ButtonVariant::Ghost)
    }

    /// `variant="danger"`: the destructive main action of a confirmation.
    pub fn danger(self) -> Self {
        self.variant(ButtonVariant::Danger)
    }

    /// `variant="quietDanger"`: a destructive action among other actions.
    pub fn quiet_danger(self) -> Self {
        self.variant(ButtonVariant::QuietDanger)
    }

    /// `variant="text"`: an inline action that reads like a link.
    pub fn text(self) -> Self {
        self.variant(ButtonVariant::Text)
    }

    pub fn size(mut self, size: ControlSize) -> Self {
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

    /// The action is not available: out of the tab order, dimmed.
    /// Tracks focus with `handle`, so a view can focus the control.
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// Busy: still focusable, ignores presses, a spinner in the icon's place or over the label (so
    /// the width never changes). `disabled` wins: a disabled button shows no spinner.
    pub fn loading(mut self, loading: bool) -> Self {
        self.loading = loading;
        self
    }

    /// `aria-disabled`: not available right now, but still focusable. Dimmed, ignores presses.
    pub fn unavailable(mut self, unavailable: bool) -> Self {
        self.unavailable = unavailable;
        self
    }

    /// The layer the button sits on, for a kit composite that knows it (a card is `Fill`).
    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
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

/// The interactive part every button shares: the pill, its states, its ring and its handler.
fn pill(
    id: ElementId,
    focus: Option<FocusHandle>,
    look: ButtonLook,
    p: &Palette,
    state: Availability,
    window: &mut Window,
    cx: &mut App,
) -> base::Button {
    let focus = focus.unwrap_or_else(|| focus_handle(&id, window, cx));
    let ring = state.focusable() && shows_focus(&focus, window);
    let (hover, pressed) = (c(look.hover(p)), c(look.pressed(p)));
    base::Button::new(id)
        .track_focus(&focus)
        .disabled(state.disabled)
        .relative()
        .flex()
        .flex_shrink_0()
        .items_center()
        .justify_center()
        .rounded(px(RADIUS_FULL))
        .text_color(c(look.label))
        .opacity(state.opacity())
        .when_some(look.background, |pill, background| pill.bg(c(background)))
        .when(state.acts(), |pill| {
            pill.cursor_pointer()
                .hover(move |style| style.bg(hover))
                .active(move |style| style.bg(pressed))
        })
        .when(ring, |pill| pill.child(outer_focus_ring(p, RADIUS_FULL)))
        // GPUI has no busy state and its disabled state also takes focus away, so a busy or
        // unavailable control says so in its accessible description.
        .when_some(state.announcement(), |pill, said| {
            pill.aria_description(said)
        })
}

impl RenderOnce for Button {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let state = Availability::of(self.disabled, self.loading, self.unavailable);
        let look = button_look(&p, self.variant, Surface::or_current(self.on, cx));
        let label_color = c(look.label);
        let mut button = pill(self.id, self.focus, look, &p, state, window, cx)
            .accessibility_label(self.label.clone())
            .h(px(self.size.height()))
            .max_w_full()
            .px(px(self.size.padding()))
            .gap(px(SPACE_SM))
            .when(self.full_width, |button| button.w_full());
        if let Some(handler) = self.on_click.filter(|_| state.acts()) {
            button = button.on_click(move |event, window, cx| handler(event, window, cx));
        }
        let spinner = || {
            Spinner::new("button-spinner")
                .size(ICON_SM)
                .color(label_color)
        };
        let over_label = state.busy && self.start_icon.is_none();
        button
            .children(self.start_icon.map(|icon| {
                div()
                    .size(px(ICON_SM))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .map(|slot| {
                        if state.busy {
                            slot.child(spinner())
                        } else {
                            slot.child(Icon::new(icon).size(ICON_SM).color(label_color))
                        }
                    })
            }))
            .child(
                styled_text(self.size.label_type(), self.label)
                    .min_w_0()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .text_ellipsis()
                    .when(over_label, |label| label.opacity(0.)),
            )
            .when(over_label, |button| {
                button.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(spinner()),
                )
            })
    }
}

/// The variants an icon button takes: the Button looks of those names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IconButtonVariant {
    #[default]
    Ghost,
    Soft,
    Primary,
    Danger,
}

impl IconButtonVariant {
    pub const ALL: [IconButtonVariant; 4] = [
        IconButtonVariant::Ghost,
        IconButtonVariant::Soft,
        IconButtonVariant::Primary,
        IconButtonVariant::Danger,
    ];

    fn button(self) -> ButtonVariant {
        match self {
            IconButtonVariant::Ghost => ButtonVariant::Ghost,
            IconButtonVariant::Soft => ButtonVariant::Soft,
            IconButtonVariant::Primary => ButtonVariant::Primary,
            IconButtonVariant::Danger => ButtonVariant::Danger,
        }
    }
}

/// An icon button's paint (`IconButton`'s `Root`): the variant's look, or for `selected` a fill that
/// stands out with an accent icon; on the accent pill a ghost or soft button takes the on-accent ink.
pub fn icon_button_look(
    p: &Palette,
    variant: IconButtonVariant,
    selected: bool,
    on: Surface,
) -> ButtonLook {
    let look = button_look(p, variant.button(), on);
    let quiet = matches!(variant, IconButtonVariant::Ghost | IconButtonVariant::Soft);
    let on_accent = on == Surface::Accent && !selected && quiet;
    let tint = stand_out_fill(p, Surface::Accent);
    let selected_fill = if on == Surface::Accent {
        p.fill
    } else {
        stand_out_fill(p, on)
    };
    let soft = variant == IconButtonVariant::Soft;
    let (background, label, state_base) = if selected {
        (Some(selected_fill), p.accent_text, selected_fill)
    } else if on_accent {
        let background = soft.then_some(tint);
        (background, p.on_accent, if soft { tint } else { p.accent })
    } else {
        (look.background, look.label, look.state_base)
    };
    let on_fill = on_accent || (!selected && !quiet);
    ButtonLook {
        background,
        label,
        state_base,
        hover_amount: if on_fill {
            STATE_HOVER_ON_FILL
        } else {
            STATE_HOVER
        },
        pressed_amount: if on_fill {
            STATE_PRESSED_ON_FILL
        } else {
            STATE_PRESSED
        },
    }
}

/// The icon an icon button of `size` draws: `icon.sm`, `md` or `lg`.
pub fn icon_size(size: ControlSize) -> f32 {
    match size {
        ControlSize::Sm => ICON_SM,
        ControlSize::Md => ICON_MD,
        ControlSize::Lg => ICON_LG,
    }
}

/// A round button that shows only an icon (`IconButton`). Its label is not shown; it names the
/// button for screen readers.
#[derive(IntoElement)]
pub struct IconButton {
    id: ElementId,
    focus: Option<FocusHandle>,
    icon: IconName,
    label: SharedString,
    size: ControlSize,
    variant: IconButtonVariant,
    color: Option<Hsla>,
    selected: bool,
    disabled: bool,
    loading: bool,
    unavailable: bool,
    on: Option<Surface>,
    tab_stop: Option<bool>,
    on_click: Option<ClickHandler>,
}

impl IconButton {
    pub fn new(id: impl Into<ElementId>, icon: IconName, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            focus: None,
            icon,
            label: label.into(),
            size: ControlSize::default(),
            variant: IconButtonVariant::default(),
            color: None,
            selected: false,
            disabled: false,
            loading: false,
            unavailable: false,
            on: None,
            tab_stop: None,
            on_click: None,
        }
    }

    pub fn size(mut self, size: ControlSize) -> Self {
        self.size = size;
        self
    }

    /// `size="sm"`.
    pub fn small(self) -> Self {
        self.size(ControlSize::Sm)
    }

    pub fn variant(mut self, variant: IconButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    /// The icon's colour, only for the player's controls, which draw over a picture or take the
    /// player's own ink. Everything else uses `variant`.
    pub fn color(mut self, color: Hsla) -> Self {
        self.color = Some(color);
        self
    }

    /// A toggle that is on: the fill, with an accent icon.
    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// Tracks focus with `handle`, so a view can focus the control.
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }

    /// Whether Tab reaches it: off for all but one control of a keyboard list (the Dock).
    pub fn tab_stop(mut self, tab_stop: bool) -> Self {
        self.tab_stop = Some(tab_stop);
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// Busy: focusable, ignores presses, a spinner in the icon's place.
    pub fn loading(mut self, loading: bool) -> Self {
        self.loading = loading;
        self
    }

    /// `aria-disabled`: focusable and named, dimmed, ignores presses.
    pub fn unavailable(mut self, unavailable: bool) -> Self {
        self.unavailable = unavailable;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
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
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let state = Availability::of(self.disabled, self.loading, self.unavailable);
        let look = icon_button_look(
            &p,
            self.variant,
            self.selected,
            Surface::or_current(self.on, cx),
        );
        let ink = self
            .color
            .filter(|_| !self.selected)
            .unwrap_or(c(look.label));
        let icon_size = icon_size(self.size);
        let mut button = pill(self.id, self.focus, look, &p, state, window, cx)
            .selected(self.selected)
            .accessibility_label(self.label)
            .when_some(self.tab_stop, |button, stop| button.tab_stop(stop))
            .size(px(self.size.height()));
        if let Some(handler) = self.on_click.filter(|_| state.acts()) {
            button = button.on_click(move |event, window, cx| handler(event, window, cx));
        }
        if state.busy {
            button.child(
                Spinner::new("icon-button-spinner")
                    .size(icon_size)
                    .color(ink),
            )
        } else {
            button.child(Icon::new(self.icon).size(icon_size).color(ink))
        }
    }
}

/// One keyboard key as a small outlined tag (`KeyCap`): "Ctrl", "K", "Esc".
#[derive(IntoElement)]
pub struct KeyCap {
    key: SharedString,
    on: Option<Surface>,
}

impl KeyCap {
    pub fn new(key: impl Into<SharedString>) -> Self {
        Self {
            key: key.into(),
            on: None,
        }
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }
}

impl RenderOnce for KeyCap {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        styled_text(TEXT_TAG, self.key)
            .flex_shrink_0()
            .whitespace_nowrap()
            .px(px(SPACE_SM))
            .py(px(SPACE_2XS))
            .border(px(BORDER_HAIRLINE))
            .border_color(c(p.hairline))
            .rounded(px(RADIUS_SM))
            .bg(c(stand_out_fill(&p, Surface::or_current(self.on, cx))))
            .text_color(c(p.text_secondary))
    }
}

/// Vertical room that lifts a one-line choice row to the touch minimum (`ROW_PADDING`).
const ROW_PADDING: f32 = (CONTROL_MD - TEXT_BODY.line_height) / 2.;

/// The offset that centres a control of `height` on the first text line.
fn first_line_offset(height: f32) -> f32 {
    (TEXT_BODY.line_height - height) / 2.
}

/// A choice's label and its optional description (`ChoiceText`).
fn choice_text(
    label: SharedString,
    description: Option<SharedString>,
    disabled: bool,
    p: &Palette,
) -> Div {
    div()
        .flex_1()
        .min_w_0()
        .flex()
        .flex_col()
        .text_color(c(p.text))
        .when(disabled, |column| column.opacity(STATE_DISABLED))
        .child(styled_text(TEXT_BODY, label))
        .children(
            description.map(|description| {
                styled_text(TEXT_META, description).text_color(c(p.text_secondary))
            }),
        )
}

/// The clickable row around a choice: the whole row, text included, activates the control.
fn choice_row<E: Styled + IntoElement>(row: E, disabled: bool) -> E {
    row.flex()
        .items_start()
        .gap(px(SPACE_MD))
        .max_w_full()
        .min_w_0()
        .py(px(ROW_PADDING))
        .when(!disabled, |row| row.cursor_pointer())
}

/// The track's padding and the thumb's travel (`Switch`).
const SWITCH_PAD: f32 = (ICON_XL - ICON_MD) / 2.;
const SWITCH_TRAVEL: f32 = CONTROL_MD - 2. * SWITCH_PAD - ICON_MD;

/// A switch's track and thumb colours: accent and on-accent when on, dim and surface when off.
pub fn switch_paint(p: &Palette, checked: bool) -> ButtonLook {
    let (track, thumb) = if checked {
        (p.accent, p.on_accent)
    } else {
        (p.text_dim, p.surface)
    };
    ButtonLook {
        background: Some(track),
        label: thumb,
        state_base: track,
        hover_amount: if checked {
            STATE_HOVER_ON_FILL
        } else {
            STATE_HOVER
        },
        pressed_amount: if checked {
            STATE_PRESSED_ON_FILL
        } else {
            STATE_PRESSED
        },
    }
}

/// An on/off switch that takes effect at once (`Switch`). The label and an optional description
/// sit at the left, the track at the right; the whole row toggles it.
#[derive(IntoElement)]
pub struct Switch {
    id: ElementId,
    focus: Option<FocusHandle>,
    label: SharedString,
    description: Option<SharedString>,
    label_hidden: bool,
    checked: bool,
    disabled: bool,
    on_change: Option<ValueAction<bool>>,
}

impl Switch {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, checked: bool) -> Self {
        Self {
            id: id.into(),
            focus: None,
            label: label.into(),
            description: None,
            label_hidden: false,
            checked,
            disabled: false,
            on_change: None,
        }
    }

    /// A line of help under the label.
    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Hides the text from the eye. It still names the switch.
    pub fn label_hidden(mut self) -> Self {
        self.label_hidden = true;
        self
    }

    /// Tracks focus with `handle`, so a view can focus the control.
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
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
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let paint = switch_paint(&p, self.checked);
        let hover = c(paint.hover(&p));
        let focus = self
            .focus
            .clone()
            .unwrap_or_else(|| focus_handle(&self.id, window, cx));
        let ring = !self.disabled && shows_focus(&focus, window);
        let interactive = !self.disabled;
        let group: SharedString = format!("switch-{}", self.id).into();
        let mut element = base::Switch::new(self.id)
            .track_focus(&focus)
            .checked(self.checked)
            .disabled(self.disabled)
            .accessibility_label(self.label.clone())
            .group(group.clone());
        element = choice_row(element, self.disabled);
        if let Some(handler) = self.on_change {
            element = element.on_change(move |checked, _, window, cx| handler(checked, window, cx));
        }
        let track = div()
            .relative()
            .flex_shrink_0()
            .w(px(CONTROL_MD))
            .h(px(ICON_XL))
            .mt(px(first_line_offset(ICON_XL)))
            .p(px(SWITCH_PAD))
            .rounded(px(RADIUS_FULL))
            .bg(c(paint.resting()))
            .when(self.disabled, |track| track.opacity(STATE_DISABLED))
            .when(interactive, |track| {
                track.group_hover(group.clone(), move |style| style.bg(hover))
            })
            .child(
                div()
                    .size(px(ICON_MD))
                    .ml(px(if self.checked { SWITCH_TRAVEL } else { 0. }))
                    .rounded(px(RADIUS_FULL))
                    .bg(c(paint.label)),
            )
            .when(ring, |track| track.child(outer_focus_ring(&p, RADIUS_FULL)));
        element
            .when(!self.label_hidden, |row| {
                row.child(choice_text(self.label, self.description, self.disabled, &p))
            })
            .child(track)
    }
}

/// A checkbox's three states: `Indeterminate` is the dash a parent shows when only some of its
/// children are ticked.
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

    /// What a press gives: a partly ticked box becomes checked, a checked one clears.
    pub fn toggled(self) -> Self {
        match self {
            CheckState::Checked => CheckState::Unchecked,
            CheckState::Unchecked | CheckState::Indeterminate => CheckState::Checked,
        }
    }

    /// Drawn filled with the accent: checked or the dash.
    pub fn is_on(self) -> bool {
        !matches!(self, CheckState::Unchecked)
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

/// A choice mark's paint (`Mark`, `Ring`): the border, the fill (`None` is clear) and the tint base.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MarkPaint {
    pub border: semaphore_design::Rgba,
    pub fill: Option<semaphore_design::Rgba>,
    pub ink: semaphore_design::Rgba,
    pub look: ButtonLook,
}

/// A checkbox mark: accent filled with an on-accent tick when on, a dim outline when off.
pub fn checkbox_paint(p: &Palette, on: bool, layer: Surface) -> MarkPaint {
    let under = if on { p.accent } else { tint_base(p, layer) };
    MarkPaint {
        border: if on { p.accent } else { p.text_dim },
        fill: on.then_some(p.accent),
        ink: p.on_accent,
        look: ButtonLook {
            background: on.then_some(p.accent),
            label: p.on_accent,
            state_base: under,
            hover_amount: if on { STATE_HOVER_ON_FILL } else { STATE_HOVER },
            pressed_amount: if on {
                STATE_PRESSED_ON_FILL
            } else {
                STATE_PRESSED
            },
        },
    }
}

/// A radio ring: an accent ring and dot when chosen, a dim ring when not.
pub fn radio_paint(p: &Palette, on: bool, layer: Surface) -> MarkPaint {
    let under = tint_base(p, layer);
    MarkPaint {
        border: if on { p.accent } else { p.text_dim },
        fill: None,
        ink: p.accent,
        look: ButtonLook {
            background: None,
            label: p.accent,
            state_base: under,
            hover_amount: STATE_HOVER,
            pressed_amount: STATE_PRESSED,
        },
    }
}

/// The slot that holds a drawn mark, centred on the first text line, with its focus ring.
fn mark_slot(mark: Div, ring: bool, radius: f32, p: &Palette) -> Div {
    div()
        .relative()
        .flex_shrink_0()
        .size(px(ICON_LG))
        .mt(px(first_line_offset(ICON_LG)))
        .child(mark)
        .when(ring, |slot| slot.child(outer_focus_ring(p, radius)))
}

/// A box the user ticks to include or exclude an item (`Checkbox`). The whole row toggles it.
#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    focus: Option<FocusHandle>,
    label: SharedString,
    state: CheckState,
    description: Option<SharedString>,
    label_hidden: bool,
    disabled: bool,
    on: Option<Surface>,
    on_change: Option<StateHandler>,
    base: Div,
}

impl Checkbox {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, checked: bool) -> Self {
        Self {
            id: id.into(),
            focus: None,
            label: label.into(),
            state: checked.into(),
            description: None,
            label_hidden: false,
            disabled: false,
            on: None,
            on_change: None,
            base: div(),
        }
    }

    /// `indeterminate`: the dash instead of the tick.
    pub fn state(mut self, state: CheckState) -> Self {
        self.state = state;
        self
    }

    /// A line of help under the label.
    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Hides the text from the eye. It still names the checkbox.
    pub fn label_hidden(mut self) -> Self {
        self.label_hidden = true;
        self
    }

    /// Tracks focus with `handle`, so a view can focus the control.
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }

    /// The new checked value. A partly ticked box reports `true`, as a press checks it.
    pub fn on_change(mut self, handler: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(move |state, window, cx| {
            handler(state.is_checked(), window, cx);
        }));
        self
    }

    /// The new state, for a box that has a partly ticked state or a handler that decides its own.
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
    fn render(mut self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let paint = checkbox_paint(&p, self.state.is_on(), Surface::or_current(self.on, cx));
        let hover = c(paint.look.hover(&p));
        let focus = self
            .focus
            .clone()
            .unwrap_or_else(|| focus_handle(&self.id, window, cx));
        let ring = !self.disabled && shows_focus(&focus, window);
        let group: SharedString = format!("checkbox-{}", self.id).into();
        let mut element = base::Checkbox::new(self.id);
        *element.style() = self.base.style().clone();
        element = element
            .track_focus(&focus)
            .state(self.state.base())
            .disabled(self.disabled)
            .accessibility_label(self.label.clone())
            .group(group.clone());
        element = choice_row(element, self.disabled);
        if let Some(handler) = self.on_change {
            element = element.on_change(move |state, _, window, cx| {
                handler(CheckState::of(state), window, cx);
            });
        }
        let tick = match self.state {
            CheckState::Unchecked => None,
            CheckState::Checked => Some(LoungeIcon::Check),
            CheckState::Indeterminate => Some(LoungeIcon::Minus),
        };
        let mark = div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(RADIUS_SM))
            .border(px(BORDER_SELECTED))
            .border_color(c(paint.border))
            .when_some(paint.fill, |mark, fill| mark.bg(c(fill)))
            .when(self.disabled, |mark| mark.opacity(STATE_DISABLED))
            .when(!self.disabled, |mark| {
                mark.group_hover(group.clone(), move |style| style.bg(hover))
            })
            .children(tick.map(|tick| Icon::lounge(tick).size(ICON_XS).color(c(paint.ink))));
        element
            .child(mark_slot(mark, ring, RADIUS_SM, &p))
            .when(!self.label_hidden, |row| {
                row.child(choice_text(self.label, self.description, self.disabled, &p))
            })
    }
}

/// One option of a [`RadioGroup`], or a radio a screen lays out itself.
#[derive(IntoElement)]
pub struct Radio {
    id: ElementId,
    label: SharedString,
    description: Option<SharedString>,
    checked: bool,
    disabled: bool,
    on: Option<Surface>,
    focus: Option<FocusHandle>,
    tab_stop: bool,
    position: Option<(usize, usize)>,
    on_select: Option<Action>,
}

impl Radio {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>, checked: bool) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            description: None,
            checked,
            disabled: false,
            on: None,
            focus: None,
            tab_stop: true,
            position: None,
            on_select: None,
        }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
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
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let paint = radio_paint(&p, self.checked, Surface::or_current(self.on, cx));
        let hover = c(paint.look.hover(&p));
        let focus = self
            .focus
            .clone()
            .unwrap_or_else(|| focus_handle(&self.id, window, cx));
        let ring = !self.disabled && shows_focus(&focus, window);
        let group: SharedString = format!("radio-{}", self.id).into();
        let mut element = base::Radio::new(self.id)
            .track_focus(&focus)
            .tab_stop(self.tab_stop)
            .checked(self.checked)
            .disabled(self.disabled)
            .accessibility_label(self.label.clone())
            .group(group.clone());
        if let Some((index, count)) = self.position {
            element = element.set_position(index, count);
        }
        element = choice_row(element, self.disabled);
        if let Some(handler) = self.on_select {
            element = element.on_change(move |_, _, window, cx| handler(window, cx));
        }
        let mark = div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(RADIUS_FULL))
            .border(px(BORDER_SELECTED))
            .border_color(c(paint.border))
            .when(self.disabled, |mark| mark.opacity(STATE_DISABLED))
            .when(!self.disabled, |mark| {
                mark.group_hover(group.clone(), move |style| style.bg(hover))
            })
            .when(self.checked, |mark| {
                mark.child(
                    div()
                        .size(px(SPACE_SM))
                        .rounded(px(RADIUS_FULL))
                        .bg(c(paint.ink)),
                )
            });
        element
            .child(mark_slot(mark, ring, RADIUS_FULL, &p))
            .child(choice_text(self.label, self.description, self.disabled, &p))
    }
}

/// One choice of a [`RadioGroup`].
#[derive(Debug, Clone, PartialEq)]
pub struct RadioOption {
    pub label: SharedString,
    pub description: Option<SharedString>,
    pub disabled: bool,
}

impl RadioOption {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            description: None,
            disabled: false,
        }
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

/// How a radio group lays its options out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Orientation {
    #[default]
    Vertical,
    Horizontal,
}

/// The option an arrow key moves to from `current`: the next (`step` 1) or previous (-1) enabled
/// one, wrapping round. `None` when no option is enabled or `current` is not one of them.
pub fn radio_step(disabled: &[bool], current: usize, step: isize) -> Option<usize> {
    let enabled: Vec<usize> = (0..disabled.len()).filter(|&i| !disabled[i]).collect();
    let at = enabled.iter().position(|&i| i == current)?;
    let count = enabled.len() as isize;
    let next = (at as isize + step).rem_euclid(count) as usize;
    enabled.get(next).copied()
}

/// Where a key moves the focus of a roving list (a radio group, a tab row): the arrows step one
/// enabled item, wrapping round; Home and End go to the first and last enabled item.
pub fn roving_target(disabled: &[bool], current: usize, key: &str) -> Option<usize> {
    match key {
        "down" | "right" => radio_step(disabled, current, 1),
        "up" | "left" => radio_step(disabled, current, -1),
        "home" => disabled.iter().position(|&off| !off),
        "end" => disabled.iter().rposition(|&off| !off),
        _ => None,
    }
}

/// The option that is the group's one Tab stop: the selected one, or the first enabled one.
pub fn radio_tab_stop(disabled: &[bool], selected: Option<usize>) -> Option<usize> {
    selected
        .filter(|&i| disabled.get(i) == Some(&false))
        .or_else(|| disabled.iter().position(|&off| !off))
}

/// A set of options where exactly one is chosen (`RadioGroup`). The group is one Tab stop (the
/// selected option); the arrows move focus and selection together, skipping disabled options and
/// wrapping round.
#[derive(IntoElement)]
pub struct RadioGroup {
    id: ElementId,
    label: SharedString,
    label_hidden: bool,
    options: Vec<RadioOption>,
    selected: Option<usize>,
    orientation: Orientation,
    disabled: bool,
    on: Option<Surface>,
    focus: Option<FocusHandle>,
    on_change: Option<ValueAction<usize>>,
}

impl RadioGroup {
    pub fn new(
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        options: Vec<RadioOption>,
        selected: Option<usize>,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            label_hidden: false,
            options,
            selected,
            orientation: Orientation::default(),
            disabled: false,
            on: None,
            focus: None,
            on_change: None,
        }
    }

    pub fn label_hidden(mut self) -> Self {
        self.label_hidden = true;
        self
    }

    /// Tracks the group's Tab stop with `handle`, so a view can focus the group.
    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.focus = Some(handle.clone());
        self
    }

    pub fn orientation(mut self, orientation: Orientation) -> Self {
        self.orientation = orientation;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_change(mut self, handler: impl Fn(usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for RadioGroup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let disabled: Vec<bool> = self
            .options
            .iter()
            .map(|option| self.disabled || option.disabled)
            .collect();
        let stop = radio_tab_stop(&disabled, self.selected);
        let name = self.id.to_string();
        let handles: Vec<FocusHandle> = (0..self.options.len())
            .map(|index| {
                let id = ElementId::named_usize(format!("{name}-option"), index);
                focus_handle(&id, window, cx)
            })
            .collect();
        // A caller's handle stands for the whole group: focusing it hands focus to the Tab stop.
        if let (Some(caller), Some(stop)) = (&self.focus, stop)
            && caller.is_focused(window)
        {
            let target = handles[stop].clone();
            window.defer(cx, move |window, cx| target.focus(window, cx));
        }
        let count = self.options.len();
        let horizontal = self.orientation == Orientation::Horizontal;
        let on_change = self.on_change.clone();
        let keys = handles.clone();
        let mut group = base::RadioGroup::new(self.id.clone())
            .axis(if horizontal {
                Axis::Horizontal
            } else {
                Axis::Vertical
            })
            .flex()
            .min_w_0()
            .max_w_full()
            .when(horizontal, |group| {
                group.flex_row().flex_wrap().gap_x(px(SPACE_XL))
            })
            .when(!horizontal, |group| group.flex_col())
            .when_some(self.focus.clone(), |group, caller| {
                group.track_focus(&caller.tab_stop(false))
            });
        if !self.disabled {
            let disabled = disabled.clone();
            group = group.on_key_down(move |event: &KeyDownEvent, window, cx| {
                // A radio group moves with the arrows only (Home and End are a tab row's).
                let key = event.keystroke.key.as_str();
                if !matches!(key, "down" | "right" | "up" | "left") {
                    return;
                }
                let Some(current) = keys.iter().position(|handle| handle.is_focused(window)) else {
                    return;
                };
                let Some(next) = roving_target(&disabled, current, key) else {
                    return;
                };
                cx.stop_propagation();
                keys[next].focus(window, cx);
                if let Some(on_change) = &on_change {
                    on_change(next, window, cx);
                }
            });
        }
        let options = self.options.into_iter().enumerate().map(|(index, option)| {
            let on_change = self.on_change.clone();
            let mut radio = Radio::new(
                ElementId::named_usize(format!("{name}-radio"), index),
                option.label,
                self.selected == Some(index),
            )
            .disabled(disabled[index]);
            radio.description = option.description;
            radio.on = self.on;
            radio.focus = Some(handles[index].clone());
            radio.tab_stop = stop == Some(index);
            radio.position = Some((index, count));
            radio.on_select(move |window, cx| {
                if let Some(on_change) = &on_change {
                    on_change(index, window, cx);
                }
            })
        });
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_XS))
            .min_w_0()
            .max_w_full()
            .when(!self.label_hidden, |root| {
                root.child(field_label(self.label.clone(), &p))
            })
            .child(group.children(options))
    }
}

/// The label every field and group label shares: meta size, semibold, secondary (`FieldLabelText`).
pub(crate) fn field_label(label: impl Into<SharedString>, p: &Palette) -> Div {
    styled_text(
        semaphore_design::lounge::TextStyle {
            weight: TEXT_BODY_STRONG.weight,
            ..TEXT_META
        },
        label,
    )
    .text_color(c(p.text_secondary))
}

/// A number in a range by dragging (`Slider`), on gpui-kit's own: dragging, keys and the role come
/// with it. Hold a `kit_slider::SliderState` entity in your view. The label row (the label, and
/// the formatted value at the right) shows unless `label_hidden`.
#[derive(IntoElement)]
pub struct Slider {
    state: Entity<kit_slider::SliderState>,
    label: SharedString,
    label_hidden: bool,
    format_value: Option<Rc<dyn Fn(f32) -> SharedString>>,
    disabled: bool,
}

impl Slider {
    pub fn new(state: &Entity<kit_slider::SliderState>, label: impl Into<SharedString>) -> Self {
        Self {
            state: state.clone(),
            label: label.into(),
            label_hidden: false,
            format_value: None,
            disabled: false,
        }
    }

    /// The value as text beside the label: "80%".
    pub fn format_value(mut self, format: impl Fn(f32) -> SharedString + 'static) -> Self {
        self.format_value = Some(Rc::new(format));
        self
    }

    /// Hides the label row from the eye. It still names the slider.
    pub fn label_hidden(mut self) -> Self {
        self.label_hidden = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl RenderOnce for Slider {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let p = cx.sem().roles;
        let value = self.state.read(cx).value().start();
        let shown = self.format_value.as_ref().map(|format| format(value));
        // The fill and thumb are the accent, which the theme mapping hands to gpui-kit. Its rail
        // takes no colour of ours, so the web's `railFill` (the surface colour on a card) is not
        // drawn here yet.
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_XS))
            .w_full()
            .min_w_0()
            .when(self.disabled, |root| root.opacity(STATE_DISABLED))
            .when(!self.label_hidden, |root| {
                root.child(
                    div()
                        .flex()
                        .items_baseline()
                        .justify_between()
                        .gap(px(SPACE_MD))
                        .min_w_0()
                        .child(field_label(self.label.clone(), &p))
                        .children(shown.map(|shown| field_label(shown, &p).flex_shrink_0())),
                )
            })
            .child(
                div().h(px(CONTROL_MD)).flex().items_center().child(
                    kit_slider::Slider::new(&self.state)
                        .horizontal()
                        .disabled(self.disabled)
                        .accessibility_label(self.label),
                ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
    use crate::kit::look::mix;
    use crate::kit::look::tests::inputs;
    use crate::theme::Sem;
    use crate::theme::color::contrast_ratio;
    use core::prelude::v1::test;

    #[test]
    fn disabled_wins_over_loading_and_unavailable() {
        let state = Availability::of(true, true, true);
        assert!(state.disabled && !state.busy && !state.unavailable);
        assert!(!state.acts() && !state.focusable());
        assert_eq!(state.opacity(), STATE_DISABLED);
        // Disabled is the base control's own state; nothing extra is said.
        assert_eq!(state.announcement(), None);
        assert_eq!(
            Availability::of(false, true, false).announcement(),
            Some("busy")
        );
        assert_eq!(
            Availability::of(false, false, true).announcement(),
            Some("unavailable")
        );
    }

    #[test]
    fn loading_stays_focusable_and_ignores_presses() {
        let state = Availability::of(false, true, true);
        assert!(state.busy && !state.unavailable);
        assert!(!state.acts());
        assert!(state.focusable());
        // Busy is not dimmed: it shows a spinner instead.
        assert_eq!(state.opacity(), 1.);
    }

    #[test]
    fn unavailable_is_focusable_dimmed_and_inert() {
        let state = Availability::of(false, false, true);
        assert!(state.unavailable && state.focusable() && !state.acts());
        assert_eq!(state.opacity(), STATE_DISABLED);
        let ready = Availability::of(false, false, false);
        assert!(ready.acts() && ready.focusable());
        assert_eq!(ready.opacity(), 1.);
    }

    #[test]
    fn icon_buttons_follow_the_web_look() {
        for input in inputs() {
            let p = Sem::new(input).roles;
            let ghost = icon_button_look(&p, IconButtonVariant::Ghost, false, Surface::Surface);
            assert_eq!(ghost.background, None);
            assert_eq!(ghost.label, p.text_secondary);
            assert_eq!(ghost.hover_amount, STATE_HOVER);
            let primary = icon_button_look(&p, IconButtonVariant::Primary, false, Surface::Surface);
            assert_eq!(primary.background, Some(p.accent));
            assert_eq!(primary.hover_amount, STATE_HOVER_ON_FILL);
            let selected = icon_button_look(&p, IconButtonVariant::Primary, true, Surface::Surface);
            assert_eq!(selected.background, Some(p.fill));
            assert_eq!(selected.label, p.accent_text);
            assert_eq!(selected.hover_amount, STATE_HOVER);
            let on_card = icon_button_look(&p, IconButtonVariant::Ghost, true, Surface::Fill);
            assert_eq!(on_card.background, Some(p.surface));
            let on_accent = icon_button_look(&p, IconButtonVariant::Ghost, false, Surface::Accent);
            assert_eq!(on_accent.background, None);
            assert_eq!(on_accent.label, p.on_accent);
            assert_eq!(on_accent.state_base, p.accent);
            assert_eq!(on_accent.hover_amount, STATE_HOVER_ON_FILL);
            let soft_on_accent =
                icon_button_look(&p, IconButtonVariant::Soft, false, Surface::Accent);
            assert_eq!(
                soft_on_accent.background,
                Some(mix(p.on_accent, p.accent, STATE_PRESSED_ON_FILL))
            );
        }
        assert_eq!(icon_size(ControlSize::Sm), ICON_SM);
        assert_eq!(icon_size(ControlSize::Md), ICON_MD);
        assert_eq!(icon_size(ControlSize::Lg), ICON_LG);
    }

    #[test]
    fn switches_checkboxes_and_radios_paint_their_roles() {
        let p = Sem::default().roles;
        let on = switch_paint(&p, true);
        assert_eq!((on.resting(), on.label), (p.accent, p.on_accent));
        assert_eq!(on.hover_amount, STATE_HOVER_ON_FILL);
        let off = switch_paint(&p, false);
        assert_eq!((off.resting(), off.label), (p.text_dim, p.surface));
        assert_eq!(off.hover_amount, STATE_HOVER);
        assert_eq!(SWITCH_PAD, 3.);
        assert_eq!(SWITCH_TRAVEL, 16.);
        assert_eq!(ROW_PADDING, 9.);

        let ticked = checkbox_paint(&p, true, Surface::Surface);
        assert_eq!((ticked.border, ticked.fill), (p.accent, Some(p.accent)));
        assert_eq!(ticked.look.state_base, p.accent);
        let clear = checkbox_paint(&p, false, Surface::Fill);
        assert_eq!((clear.border, clear.fill), (p.text_dim, None));
        assert_eq!(clear.look.state_base, p.fill);

        let chosen = radio_paint(&p, true, Surface::Ground);
        assert_eq!((chosen.border, chosen.ink), (p.accent, p.accent));
        assert_eq!(chosen.look.state_base, p.ground);
        assert_eq!(radio_paint(&p, false, Surface::Surface).border, p.text_dim);
    }

    #[test]
    fn arrows_skip_disabled_radios_and_wrap() {
        let disabled = [false, true, false, false];
        assert_eq!(radio_step(&disabled, 0, 1), Some(2));
        assert_eq!(radio_step(&disabled, 3, 1), Some(0));
        assert_eq!(radio_step(&disabled, 0, -1), Some(3));
        assert_eq!(radio_step(&disabled, 2, -1), Some(0));
        // Focus on a disabled one (never happens) or no enabled options: nothing moves.
        assert_eq!(radio_step(&disabled, 1, 1), None);
        assert_eq!(radio_step(&[true, true], 0, 1), None);
        assert_eq!(radio_step(&[false], 0, 1), Some(0));
    }

    #[test]
    fn the_tab_stop_is_the_selected_radio_or_the_first_enabled() {
        assert_eq!(radio_tab_stop(&[false, false], Some(1)), Some(1));
        assert_eq!(radio_tab_stop(&[true, false, false], None), Some(1));
        assert_eq!(radio_tab_stop(&[false, true], Some(1)), Some(0));
        assert_eq!(radio_tab_stop(&[true, true], None), None);
    }

    #[test]
    fn a_press_checks_a_partly_selected_box() {
        assert_eq!(CheckState::Unchecked.toggled(), CheckState::Checked);
        assert_eq!(CheckState::Checked.toggled(), CheckState::Unchecked);
        assert_eq!(CheckState::Indeterminate.toggled(), CheckState::Checked);
        assert!(CheckState::Checked.is_checked());
        assert!(!CheckState::Indeterminate.is_checked());
        assert!(CheckState::Indeterminate.is_on());
        assert!(!CheckState::Unchecked.is_on());
    }

    #[test]
    fn control_marks_read_on_every_theme() {
        // The new pairings, swept as the theme tests sweep theirs: non-text marks and the
        // switch's thumb need 3:1 against what they sit on; the tick and the key cap's text 4.5:1
        // and 3:1.
        for input in inputs() {
            let p = Sem::new(input).roles;
            let name = input.name();
            let check = |what: &str, ink, on, target: f32| {
                let ratio = contrast_ratio(ink, on);
                assert!(
                    ratio >= target,
                    "{name}: {what} is {ratio:.2}:1, need {target}:1"
                );
            };
            check("tick on the accent", p.on_accent, p.accent, 4.5);
            check("thumb on the on-track", p.on_accent, p.accent, 3.);
            for layer in [Surface::Ground, Surface::Surface, Surface::Fill] {
                let under = tint_base(&p, layer);
                // The palette promises the accent 3:1 on the ground and the surface, not on fill.
                if layer != Surface::Fill {
                    check("accent mark on its layer", p.accent, under, 3.);
                }
                let fill = stand_out_fill(&p, layer);
                check("key cap text", p.text_secondary, fill, 4.5);
                check("field label", p.text_secondary, under, 4.5);
                check("choice text", p.text, under, 4.5);
            }
        }
    }
}
