//! Paper, Menu, Popover, Dialog and Tooltip.

use super::{Action, Icon, Variant, text};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use std::rc::Rc;

/// MuiPaper as the theme overrides it: `background.paper`, an accent hairline, and the balanced and
/// vibrant inner glow reduced to the hairline, because GPUI shadows have no inset.
#[derive(IntoElement)]
pub struct Paper {
    children: Vec<AnyElement>,
    elevated: bool,
    radius: f32,
    base: Div,
}

impl Paper {
    pub fn new() -> Self {
        Self {
            children: Vec::new(),
            elevated: false,
            radius: 4.,
            base: div(),
        }
    }

    pub fn elevated(mut self) -> Self {
        self.elevated = true;
        self
    }

    pub fn radius(mut self, radius: f32) -> Self {
        self.radius = radius;
        self
    }
}

impl Default for Paper {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Paper {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for Paper {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl RenderOnce for Paper {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        self.base
            .bg(sem.paper)
            .text_color(sem.text_primary)
            .border_1()
            .border_color(sem.paper_border)
            .rounded(px(self.radius))
            .when(self.elevated, |paper| paper.shadow_lg())
            .children(self.children)
    }
}

/// The second line of a [`MenuItem`]: muted for a reason, or `error` for a failed last try.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SecondaryTone {
    #[default]
    Muted,
    Error,
}

/// One line of a [`Menu`]. It can stand alone too, for a menu that builds its own list (the
/// moderation menu's header and dividers), because it is an element of its own.
#[derive(IntoElement)]
pub struct MenuItem {
    id: SharedString,
    label: SharedString,
    secondary: Option<SharedString>,
    secondary_tone: SecondaryTone,
    icon: Option<IconName>,
    destructive: bool,
    disabled: bool,
    min_height: f32,
    on_select: Action,
}

impl MenuItem {
    pub fn new(
        id: impl Into<SharedString>,
        label: impl Into<SharedString>,
        on_select: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            secondary: None,
            secondary_tone: SecondaryTone::Muted,
            icon: None,
            destructive: false,
            disabled: false,
            min_height: 36.,
            on_select: Rc::new(on_select),
        }
    }

    /// A smaller line under the label: why the item is off, or what it is doing.
    pub fn secondary(mut self, secondary: impl Into<SharedString>) -> Self {
        self.secondary = Some(secondary.into());
        self
    }

    pub fn secondary_tone(mut self, tone: SecondaryTone) -> Self {
        self.secondary_tone = tone;
        self
    }

    pub fn icon(mut self, icon: IconName) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// A phone's rows take touch height (48); a desktop's are 36.
    pub fn min_height(mut self, height: f32) -> Self {
        self.min_height = height;
        self
    }
}

impl RenderOnce for MenuItem {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let (label_color, icon_color) = if self.disabled {
            (sem.text_disabled, sem.text_disabled)
        } else if self.destructive {
            (sem.error, sem.error)
        } else {
            (sem.text_primary, sem.action_active)
        };
        let secondary_color = match self.secondary_tone {
            SecondaryTone::Muted => sem.text_secondary,
            SecondaryTone::Error => sem.error,
        };
        let hover = sem.action_hover;
        let accessible = match &self.secondary {
            Some(secondary) => format!("{}, {secondary}", self.label),
            None => self.label.to_string(),
        };
        let handler = self.on_select.clone();
        // A base button with the menu item role: it reports a disabled item as disabled.
        base::Button::new(ElementId::Name(self.id.clone()))
            .role(Role::MenuItem)
            .disabled(self.disabled)
            .accessibility_label(accessible)
            .w_full()
            .min_h(px(self.min_height))
            .px(px(16.))
            .py(px(6.))
            .flex()
            .items_center()
            .justify_start()
            .gap(px(12.))
            .text_color(label_color)
            .children(
                self.icon
                    .map(|icon| Icon::new(icon).size(20.).color(icon_color)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(text(Variant::Body1, self.label))
                    .children(self.secondary.map(|secondary| {
                        text(Variant::Caption, secondary).text_color(secondary_color)
                    })),
            )
            .when(!self.disabled, |row| {
                row.cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .focus_visible(move |style| style.bg(hover))
                    .on_click(move |_, window, cx| handler(window, cx))
            })
    }
}

/// MuiMenu's list. Put it in a [`Popover`] to anchor it.
#[derive(IntoElement)]
pub struct Menu {
    label: SharedString,
    items: Vec<MenuItem>,
}

impl Menu {
    pub fn new(label: impl Into<SharedString>, items: Vec<MenuItem>) -> Self {
        Self {
            label: label.into(),
            items,
        }
    }
}

impl RenderOnce for Menu {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let items = div()
            .id("menu")
            .test_support()
            .role(Role::Menu)
            .aria_label(self.label)
            .min_w(px(160.))
            .py(px(8.))
            .flex()
            .flex_col()
            .children(self.items);
        Paper::new().elevated().child(items)
    }
}

/// gpui-kit's positioning and dismissal, with whatever content you give it, usually [`Paper`].
pub use gpui_kit::base::Popover;

/// A modal dialog on gpui-kit's focus trap, Escape handling and role, in MUI's paint.
#[derive(IntoElement)]
pub struct Dialog {
    title: SharedString,
    body: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    width: f32,
    on_close: Option<Action>,
}

impl Dialog {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            body: Vec::new(),
            actions: Vec::new(),
            width: 444.,
            on_close: None,
        }
    }

    pub fn width(mut self, width: f32) -> Self {
        self.width = width;
        self
    }

    pub fn body(mut self, element: impl IntoElement) -> Self {
        self.body.push(element.into_any_element());
        self
    }

    pub fn action(mut self, element: impl IntoElement) -> Self {
        self.actions.push(element.into_any_element());
        self
    }

    /// Called on Escape or a press on the backdrop. The owner removes the dialog from its tree.
    pub fn on_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Dialog {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let on_close = self.on_close;
        let scrim = hsla(0., 0., 0., 0.5);
        let secondary = cx.sem().text_secondary;
        let popup = div()
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .p(px(32.))
            .child(
                Paper::new()
                    .elevated()
                    .radius(12.)
                    .w(px(self.width))
                    .max_w_full()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .px(px(24.))
                            .py(px(16.))
                            .child(text(Variant::H6, self.title)),
                    )
                    .child(
                        div()
                            .px(px(24.))
                            .pb(px(20.))
                            .text_color(secondary)
                            .children(self.body),
                    )
                    // The actions keep to the body's side padding, so a filled button never
                    // runs past the column the fields end at, and wrap on a narrow window.
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .justify_end()
                            .items_center()
                            .gap(px(8.))
                            .px(px(24.))
                            .pb(px(20.))
                            .children(self.actions),
                    ),
            );
        base::Dialog::new(cx)
            .open(true)
            .on_open_change(move |open, _, window, cx| {
                if !open && let Some(on_close) = &on_close {
                    on_close(window, cx);
                }
            })
            .backdrop(div().absolute().inset_0().occlude().bg(scrim))
            .popup(popup)
    }
}

/// MuiTooltip's box. Attach it with [`with_tip`].
pub struct Tip(pub SharedString);

impl Render for Tip {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .px(px(8.))
            .py(px(4.))
            .rounded(px(4.))
            .bg(cx.sem().tooltip_bg)
            .text_color(rgb(0xffffff))
            .child(text(Variant::Xs, self.0.clone()).font_weight(FontWeight(500.)))
    }
}

/// Adds a tooltip to anything with an id.
pub fn with_tip<E: StatefulInteractiveElement>(element: E, tip: impl Into<SharedString>) -> E {
    let tip = tip.into();
    element.tooltip(move |_, cx| cx.new(|_| Tip(tip.clone())).into())
}
