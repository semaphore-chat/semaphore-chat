//! Menu, Popover, Dialog and Tooltip, on the design system (`design/guide/components.md`), and
//! Paper for the screens not yet converted.
//!
//! Every colour is a role (`sem.roles`) or a state tint over one, every size a token from
//! `design/tokens.json` (`semaphore_design::lounge`). The overlays hold no flow logic: they report
//! what happened (an item chosen, Escape, Tab, a press on the scrim) and the owner decides. In a
//! window with a behaviour host (`kit::BehaviourRoot`) each is a layer of the overlay stack
//! (`kit/behaviour/overlay.rs`), which decides the order and returns focus.

use super::behaviour::list_focus::{ListFocusHost, ListKeys, ListOrientation, key_event, list_key};
use super::behaviour::overlay::{
    CloseReason, FocusLayer, LAYER_CONTEXT, LayerHandle, LayerKind, LayerScope, LayerSpec,
    layer_keys, use_layer,
};
use super::behaviour::{self, BehaviourHost};
use super::modal::{ModalAlign, ModalClose, ModalReason, modal};
use super::{Action, Icon, Surface, SurfaceScope, ValueAction};
use crate::theme::color::{alpha, blend, hsla_of};
use crate::theme::{Sem, SemTheme};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use semaphore_design::Rgba as Token;
use semaphore_design::behaviour::list_focus;
use semaphore_design::lounge::{
    self as t, BORDER_FOCUS, BORDER_HAIRLINE, CONTROL_MD, ICON_MD, LAYOUT_DIALOG_MD,
    LAYOUT_DIALOG_SM, LAYOUT_GUTTER, RADIUS_CARD, RADIUS_ISLAND, RADIUS_MD, RADIUS_SM, SPACE_2XS,
    SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL, SPACE_XS, STATE_DISABLED, STATE_HOVER, STATE_PRESSED,
    TextStyle,
};
use std::rc::Rc;
use std::sync::Arc;

// ---------------------------------------------------------------------------------------------
// Shared paint (lists and overlays)

/// One run of text in a `design/tokens.json` text style. It inherits its colour.
pub(crate) fn type_text(style: TextStyle, content: impl Into<SharedString>) -> Div {
    div()
        .font_family(style.family)
        .text_size(px(style.size))
        .line_height(px(style.line_height))
        .font_weight(FontWeight(style.weight as f32))
        .child(content.into())
}

/// The kit's opaque state colour: `amount` of the `text` role mixed over `under`, as the web's
/// `mix(palette.text, under, amount)`.
pub(crate) fn state_over(sem: &Sem, under: Token, amount: f32) -> Hsla {
    hsla_of(blend(sem.roles.text, under, amount))
}

/// The colour `design/tokens.json`'s shadows are an alpha of.
const SHADOW_BLACK: Token = Token(0x000000ff);

/// Which of `design/tokens.json`'s shadows: an island's (and the dock's) or a floating panel's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ShadowKind {
    Island,
    Overlay,
}

/// `shadow.island` or `shadow.overlay`: deeper in dark mode, lighter in light.
pub(crate) fn shadow(sem: &Sem, kind: ShadowKind) -> Vec<BoxShadow> {
    let s = match kind {
        ShadowKind::Island => t::SHADOW_ISLAND,
        ShadowKind::Overlay => t::SHADOW_OVERLAY,
    };
    vec![BoxShadow {
        // `design/tokens.json` gives a shadow as an alpha of black, per mode.
        color: hsla_of(alpha(
            SHADOW_BLACK,
            if sem.is_dark { s.alpha } else { s.alpha_light },
        )),
        offset: point(px(s.x), px(s.y)),
        blur_radius: px(s.blur),
        spread_radius: px(0.),
        inset: false,
    }]
}

/// The look every floating panel shares (a menu, a popover): the `surface` role, a hairline edge,
/// the card radius and the overlay shadow. The web's `overlaySurface`.
pub(crate) fn overlay_surface<E: Styled>(element: E, sem: &Sem) -> E {
    element
        .bg(sem.role.surface)
        .text_color(sem.role.text)
        .border(px(BORDER_HAIRLINE))
        .border_color(sem.role.hairline)
        .rounded(px(RADIUS_CARD))
        .shadow(shadow(sem, ShadowKind::Overlay))
}

// ---------------------------------------------------------------------------------------------
// Paper

/// MuiPaper for the screens not yet converted to the design system: the `surface` role and a
/// hairline. Elevated, it takes the overlay shadow. New screens use an Island or a Card.
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
            .when(self.elevated, |paper| {
                paper.shadow(shadow(sem, ShadowKind::Overlay))
            })
            .children(self.children)
    }
}

// ---------------------------------------------------------------------------------------------
// Menu

/// The second line of a [`MenuItem`]: muted for a reason, or `danger` for a failed last try.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SecondaryTone {
    #[default]
    Muted,
    Error,
}

/// An item's tone, as the web's `tone`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MenuTone {
    #[default]
    Default,
    /// A destructive action: the `danger` role. Put it last, apart from the rest.
    Danger,
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
    shortcut: Vec<SharedString>,
    tone: MenuTone,
    disabled: bool,
    min_height: f32,
    on_select: Action,
    /// Set by a [`Menu`]: its keyboard focus for this item, and what follows a choice.
    focus: Option<FocusHandle>,
    after_select: Option<Action>,
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
            shortcut: Vec::new(),
            tone: MenuTone::Default,
            disabled: false,
            min_height: CONTROL_MD,
            on_select: Rc::new(on_select),
            focus: None,
            after_select: None,
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

    /// Keys shown at the end, one key cap each: `["Shift", "D"]`. They count as the item's text
    /// for typeahead, as on the web.
    pub fn shortcut(mut self, keys: impl IntoIterator<Item = impl Into<SharedString>>) -> Self {
        self.shortcut = keys.into_iter().map(Into::into).collect();
        self
    }

    pub fn tone(mut self, tone: MenuTone) -> Self {
        self.tone = tone;
        self
    }

    /// `tone(MenuTone::Danger)`.
    pub fn destructive(self) -> Self {
        self.tone(MenuTone::Danger)
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// A phone's rows take touch height (`control.lg`); a desktop's are `control.md`, the least.
    pub fn min_height(mut self, height: f32) -> Self {
        self.min_height = height.max(CONTROL_MD);
        self
    }

    /// What typeahead matches: the label, then the shortcut keys.
    fn typeahead_label(&self) -> String {
        let mut label = self.label.to_string();
        for key in &self.shortcut {
            label.push(' ');
            label.push_str(key);
        }
        label
    }
}

/// A key cap in a menu item: the `fill` role, `radius.sm`, `text.small`.
fn key_cap(key: SharedString, sem: &Sem) -> Div {
    type_text(t::TEXT_SMALL, key)
        .min_w(px(ICON_MD))
        .px(px(SPACE_XS))
        .flex()
        .justify_center()
        .rounded(px(RADIUS_SM))
        .bg(sem.role.fill)
        .border(px(BORDER_HAIRLINE))
        .border_color(sem.role.hairline)
        .text_color(sem.role.text_secondary)
}

impl RenderOnce for MenuItem {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let danger = self.tone == MenuTone::Danger;
        let (label_color, icon_color) = if danger {
            (sem.role.danger, sem.role.danger)
        } else {
            (sem.role.text, sem.role.text_secondary)
        };
        let secondary_color = match self.secondary_tone {
            SecondaryTone::Muted => sem.role.text_secondary,
            SecondaryTone::Error => sem.role.danger,
        };
        let under = sem.roles.surface;
        let (hover, pressed, ring) = (
            state_over(sem, under, STATE_HOVER),
            state_over(sem, under, STATE_PRESSED),
            sem.role.focus,
        );
        let accessible = match &self.secondary {
            Some(secondary) => format!("{}, {secondary}", self.label),
            None => self.label.to_string(),
        };
        let handler = self.on_select.clone();
        let after = self.after_select.clone();
        let keys = (!self.shortcut.is_empty()).then(|| {
            div()
                .flex()
                .items_center()
                .gap(px(SPACE_2XS))
                .ml(px(SPACE_LG))
                .children(self.shortcut.iter().cloned().map(|key| key_cap(key, sem)))
        });
        // A base button with the menu item role: it reports a disabled item as disabled and
        // takes it out of the Tab order.
        base::Button::new(ElementId::Name(self.id.clone()))
            .role(Role::MenuItem)
            .disabled(self.disabled)
            .accessibility_label(accessible)
            // In a menu, focus moves by the arrow keys, not Tab: Tab leaves the menu.
            .when_some(self.focus.as_ref(), |row, focus| {
                row.track_focus(focus).tab_stop(false)
            })
            .w_full()
            .min_h(px(self.min_height))
            .px(px(SPACE_MD))
            .rounded(px(RADIUS_MD))
            .flex()
            .items_center()
            .justify_start()
            .gap(px(SPACE_SM))
            .text_color(label_color)
            .when(self.disabled, |row| row.opacity(STATE_DISABLED))
            // The keyboard focus ring, inside the row: a constant-width border, so nothing
            // shifts when it shows.
            .border(px(BORDER_FOCUS))
            .border_color(transparent_black())
            .children(
                self.icon
                    .map(|icon| Icon::new(icon).size(ICON_MD).color(icon_color)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(type_text(t::TEXT_BODY, self.label).truncate())
                    .children(self.secondary.map(|secondary| {
                        type_text(t::TEXT_META, secondary).text_color(secondary_color)
                    })),
            )
            .children(keys)
            .when(!self.disabled, |row| {
                row.cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .active(move |style| style.bg(pressed))
                    .focus_visible(move |style| style.bg(pressed).border_color(ring))
                    .on_click(move |_, window, cx| {
                        handler(window, cx);
                        if let Some(after) = &after {
                            after(window, cx);
                        }
                    })
            })
    }
}

/// An entry of a [`Menu`]: an item, or a divider that groups them.
pub enum MenuEntry {
    Item(MenuItem),
    Divider(SharedString),
}

impl MenuEntry {
    pub fn divider(id: impl Into<SharedString>) -> Self {
        Self::Divider(id.into())
    }
}

impl From<MenuItem> for MenuEntry {
    fn from(item: MenuItem) -> Self {
        Self::Item(item)
    }
}

/// Why a [`Menu`] asks to close.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuCloseReason {
    /// An item was chosen (after its own action ran).
    Selected,
    Escape,
    /// Tab or Shift+Tab: a menu closes rather than letting focus leave it.
    Tab,
    /// A press outside the menu (the window's behaviour host reports it).
    PressOutside,
    /// The layer the menu was opened in has closed: the owner must close it.
    ParentClosed,
}

impl MenuCloseReason {
    fn from_stack(reason: CloseReason) -> Self {
        match reason {
            CloseReason::Escape | CloseReason::Back => MenuCloseReason::Escape,
            CloseReason::Tab => MenuCloseReason::Tab,
            CloseReason::PressOutside | CloseReason::Scrim => MenuCloseReason::PressOutside,
            CloseReason::ParentClosed => MenuCloseReason::ParentClosed,
        }
    }
}

actions!(kit_menu, [MenuTab]);

/// The key context of a [`Menu`]: Tab is the menu's there, ahead of the window's focus move.
const MENU_CONTEXT: &str = "KitMenu";

/// A hosted menu's contexts: its own, and the layer's (Escape goes to the stack).
const MENU_LAYER_CONTEXT: &str = "KitMenu KitLayer";

/// Binds the menu's Tab keys once per app.
struct MenuKeysBound;
impl Global for MenuKeysBound {}

fn bind_menu_keys(cx: &mut App) {
    if !cx.has_global::<MenuKeysBound>() {
        cx.bind_keys([
            KeyBinding::new("tab", MenuTab, Some(MENU_CONTEXT)),
            KeyBinding::new("shift-tab", MenuTab, Some(MENU_CONTEXT)),
        ]);
        cx.set_global(MenuKeysBound);
    }
}

/// The menu's keyboard: the list-focus host with wrapping at the ends, as the web's MUI menu list.
struct MenuKeys {
    list: ListFocusHost,
    focused_once: bool,
    /// What had focus when the menu took it: focus goes back there on Escape or a choice, when
    /// the window has no behaviour host to do it.
    opener: Option<FocusHandle>,
}

fn menu_list(keys: &mut MenuKeys) -> &mut ListFocusHost {
    &mut keys.list
}

const MENU_PARAMS: list_focus::Params = list_focus::Params {
    wrap: true,
    selection_follows_focus: false,
    typeahead_ms: t::MOTION_TYPEAHEAD_MS,
};

const MENU_KEYS: ListKeys = ListKeys {
    orientation: ListOrientation::Vertical,
    typeahead: true,
    allow_shift: true,
};

/// What a key does in a menu: a list-focus event, a close request, or nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MenuKey {
    Move(list_focus::Event),
    Close(MenuCloseReason),
}

/// The menu's key map (`design/guide/components.md`, "Menu"): Up and Down, Home and End, a letter
/// for typeahead (Space too while a prefix is being typed), and Escape to close. Enter and Space
/// choose the focused item through the item's own button; Tab is a key binding (`MenuTab`), so it
/// comes ahead of the window's focus move.
pub(crate) fn menu_key(keystroke: &Keystroke, typing: bool) -> Option<MenuKey> {
    let m = &keystroke.modifiers;
    if keystroke.key == "escape" && !(m.control || m.alt || m.platform || m.function) {
        return Some(MenuKey::Close(MenuCloseReason::Escape));
    }
    key_event(keystroke, MENU_KEYS, typing).map(MenuKey::Move)
}

/// A menu of actions on one thing, as the web's Menu: items, dividers, icons, shortcut key caps
/// and a danger tone, on the overlay surface. Put it where it opens from (the owner anchors it).
///
/// When it is drawn, focus goes to the first item that is not disabled. Up and Down move between
/// items and wrap; Home and End jump; typing jumps by prefix; Enter or Space (or a press) chooses.
/// Escape and Tab ask to close ([`Menu::on_close`]), and so does a choice, after the item's own
/// action. In a window with a behaviour host the menu is a layer of its overlay stack: Escape, a
/// press outside and the closing of the layer it is in come from there, and focus goes back to
/// what had it when the menu opened once the menu is gone.
#[derive(IntoElement)]
pub struct Menu {
    id: ElementId,
    label: SharedString,
    entries: Vec<MenuEntry>,
    on_close: Option<ValueAction<MenuCloseReason>>,
    inline: bool,
    /// A child after the items, for the surface tests.
    #[cfg(test)]
    probe: Option<AnyElement>,
}

impl Menu {
    /// A child after the items, for the surface tests.
    #[cfg(test)]
    pub(crate) fn probe(mut self, element: impl IntoElement) -> Self {
        self.probe = Some(element.into_any_element());
        self
    }

    pub fn new(
        label: impl Into<SharedString>,
        entries: impl IntoIterator<Item = impl Into<MenuEntry>>,
    ) -> Self {
        Self {
            id: "menu".into(),
            label: label.into(),
            entries: entries.into_iter().map(Into::into).collect(),
            on_close: None,
            inline: false,
            #[cfg(test)]
            probe: None,
        }
    }

    /// The menu's element id (default `menu`), for two menus in one view.
    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.id = id.into();
        self
    }

    pub fn on_close(
        mut self,
        handler: impl Fn(MenuCloseReason, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }

    /// A menu drawn as part of another surface (a dialog's body), not floating over the page: it
    /// is not a layer of its own. Escape is reported to [`Menu::on_close`] as today, and Tab moves
    /// on to the surface's other controls.
    pub fn inline(mut self) -> Self {
        self.inline = true;
        self
    }
}

impl RenderOnce for Menu {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        bind_menu_keys(cx);
        let sem = cx.sem().clone();
        let keys = window.use_keyed_state(self.id.clone(), cx, |_, _| MenuKeys {
            list: ListFocusHost::new(MENU_PARAMS, MENU_KEYS),
            focused_once: false,
            opener: None,
        });
        let rows: Vec<list_focus::Row> = self
            .entries
            .iter()
            .filter_map(|entry| match entry {
                MenuEntry::Item(item) => Some(list_focus::Row {
                    id: item.id.to_string(),
                    label: item.typeahead_label(),
                    disabled: item.disabled,
                }),
                MenuEntry::Divider(_) => None,
            })
            .collect();
        let handles: Vec<(String, FocusHandle)> = keys.update(cx, |keys, cx| {
            keys.list.sync(rows.clone(), None, window, cx).handles
        });
        let on_close = self.on_close.clone();
        // A layer of the window's overlay stack, opened before focus moves into the menu, so the
        // element that has focus now is its opener.
        let layer = if self.inline {
            None
        } else {
            on_close.clone().and_then(|close| {
                let roots: Vec<FocusHandle> =
                    handles.iter().map(|(_, handle)| handle.clone()).collect();
                let first = first_enabled(&rows, &handles);
                use_layer(
                    ElementId::NamedChild(Arc::new(self.id.clone()), "layer".into()),
                    LayerSpec {
                        kind: LayerKind::Menu,
                        roots,
                        on_request_close: Rc::new(move |reason, window, cx| {
                            close(MenuCloseReason::from_stack(reason), window, cx)
                        }),
                        focus_layer: first.map(|first| {
                            Rc::new(move |window: &mut Window, cx: &mut App| {
                                window.focus(&first, cx)
                            }) as FocusLayer
                        }),
                        opener: None,
                        fallback_opener: None,
                    },
                    window,
                    cx,
                )
            })
        };
        let hosted = layer.is_some();
        // Focus starts on the first enabled item, once the items are in the frame.
        if !keys.read(cx).focused_once {
            let first = first_enabled(&rows, &handles);
            let opener = window.focused(cx);
            keys.update(cx, |keys, _| {
                keys.focused_once = true;
                keys.opener = opener;
            });
            if let Some(first) = first {
                window.focus(&first, cx);
            }
        }

        let after_select: Option<Action> = on_close.clone().map(|close| {
            let keys = keys.clone();
            Rc::new(move |window: &mut Window, cx: &mut App| {
                if !hosted {
                    return_focus(&keys, window, cx);
                }
                close(MenuCloseReason::Selected, window, cx)
            }) as Action
        });
        let key_state = keys.clone();
        let hairline = sem.role.hairline;
        let items = self.entries.into_iter().map(move |entry| match entry {
            MenuEntry::Item(mut item) => {
                item.focus = handles
                    .iter()
                    .find(|(id, _)| id.as_str() == item.id.as_ref())
                    .map(|(_, handle)| handle.clone());
                item.after_select = after_select.clone();
                item.into_any_element()
            }
            MenuEntry::Divider(id) => div()
                .id(ElementId::Name(id))
                .role(Role::Splitter)
                .h(px(BORDER_HAIRLINE))
                .my(px(SPACE_XS))
                .bg(hairline)
                .into_any_element(),
        });
        let list = div()
            .id(self.id)
            .test_support()
            .role(Role::Menu)
            .aria_label(self.label)
            // Four controls wide at least, so a short menu is not a sliver.
            .min_w(px(4. * CONTROL_MD))
            .p(px(SPACE_XS))
            .relative()
            .flex()
            .flex_col()
            .key_context(if hosted {
                MENU_LAYER_CONTEXT
            } else {
                MENU_CONTEXT
            })
            .map(|list| if hosted { layer_keys(list, cx) } else { list })
            .on_action({
                let on_close = on_close.clone();
                // Tab is reported, then moves focus as anywhere else: a menu that is a dialog's
                // body stays open and Tab reaches the dialog's buttons. On the stack, a Tab that
                // closes the menu is consumed; focus goes back to the opener as it closes.
                move |_: &MenuTab, window, cx| {
                    if hosted && let Some(host) = BehaviourHost::of(window, cx) {
                        if !behaviour::overlay::tab(&host, window, cx) {
                            cx.propagate();
                        }
                        return;
                    }
                    if let Some(close) = &on_close {
                        close(MenuCloseReason::Tab, window, cx);
                    }
                    cx.propagate();
                }
            })
            .on_key_down(move |event, window, cx| {
                let typing = !key_state.read(cx).list.state().typeahead.is_empty();
                let Some(key) = menu_key(&event.keystroke, typing) else {
                    return;
                };
                match key {
                    // Escape is the menu's only when it has an owner to ask; otherwise it goes on
                    // to what holds the menu (a dialog closes). On the stack it goes on to the
                    // window, which asks the topmost layer.
                    MenuKey::Close(reason) => {
                        if !hosted && let Some(close) = &on_close {
                            cx.stop_propagation();
                            return_focus(&key_state, window, cx);
                            close(reason, window, cx);
                        }
                    }
                    MenuKey::Move(event) => {
                        if list_key(&key_state, menu_list, event, window, cx).is_some() {
                            cx.stop_propagation();
                        }
                    }
                }
            })
            .children(items)
            .children(layer.as_ref().map(LayerHandle::panel_probe));
        #[cfg(test)]
        let list = list.children(self.probe);
        let menu = SurfaceScope::new(Surface::Surface, overlay_surface(list, &sem));
        match layer {
            Some(layer) => LayerScope::new(layer.id, menu).into_any_element(),
            None => menu.into_any_element(),
        }
    }
}

/// The focus handle of the first item that is not disabled.
fn first_enabled(
    rows: &[list_focus::Row],
    handles: &[(String, FocusHandle)],
) -> Option<FocusHandle> {
    rows.iter()
        .find(|row| !row.disabled)
        .and_then(|row| handles.iter().find(|(id, _)| *id == row.id))
        .map(|(_, handle)| handle.clone())
}

/// Focus back to what had it when the menu opened (the menu's button), while it is still on an
/// item: the owner may move it elsewhere in its close handler. Only without a behaviour host:
/// the overlay stack does it otherwise.
fn return_focus(keys: &Entity<MenuKeys>, window: &mut Window, cx: &mut App) {
    let keys = keys.read(cx);
    let inside = window
        .focused(cx)
        .is_some_and(|focused| keys.list.has_handle(&focused));
    if inside && let Some(opener) = keys.opener.clone() {
        window.focus(&opener, cx);
    }
}

// ---------------------------------------------------------------------------------------------
// Popover

/// Which side of the anchor a Menu or Popover opens on, and which edge it lines up with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Placement {
    #[default]
    BottomStart,
    BottomEnd,
    TopStart,
    TopEnd,
}

impl Placement {
    pub const ALL: [Placement; 4] = [
        Placement::BottomStart,
        Placement::BottomEnd,
        Placement::TopStart,
        Placement::TopEnd,
    ];

    /// The panel's corner that meets the anchor.
    pub fn anchor(self) -> Anchor {
        match self {
            Placement::BottomStart => Anchor::TopLeft,
            Placement::BottomEnd => Anchor::TopRight,
            Placement::TopStart => Anchor::BottomLeft,
            Placement::TopEnd => Anchor::BottomRight,
        }
    }
}

/// The gap between an anchor and the panel that opens from it: `space.xs`, as the web's
/// `ANCHOR_GAP`.
pub const ANCHOR_GAP: f32 = SPACE_XS;

/// A panel that opens from a trigger and floats beside it, as the web's Popover: a non-modal
/// dialog. Give it a [`PopoverPanel`] as content and a [`Placement`]. A press on the trigger
/// opens and closes it; when it opens, focus moves into it.
///
/// It is the kit's own, on gpui-kit's `Popup` positioner (anchored and deferred). In a window
/// with a behaviour host it is a layer of the overlay stack: Escape, a press outside (a press on
/// the trigger is inside) and the closing of the layer it is in close it, and focus goes back to
/// what had it when it opened. Without a host it closes on Escape and a press outside itself.
#[derive(IntoElement)]
pub struct Popover {
    id: ElementId,
    placement: Placement,
    default_open: bool,
    open: Option<bool>,
    on_open_change: Option<ValueAction<bool>>,
    trigger: Option<AnyElement>,
    content: Option<PopoverContent>,
}

/// What a popover draws while open.
type PopoverContent = Box<dyn FnOnce(&mut Window, &mut App) -> AnyElement>;

/// An open or closed popover's own state.
struct PopoverState {
    open: bool,
    /// The panel's focus: taken when the popover opens.
    focus: FocusHandle,
    /// Focus was moved into this opening.
    placed: bool,
    /// What had focus as it opened, for a window without a behaviour host.
    opener: Option<FocusHandle>,
    /// The owner passes `open`: the popover only asks to open or close.
    controlled: bool,
}

impl Popover {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            placement: Placement::default(),
            default_open: false,
            open: None,
            on_open_change: None,
            trigger: None,
            content: None,
        }
    }

    /// Places the panel on a side of its trigger, `ANCHOR_GAP` away.
    pub fn placement(mut self, placement: Placement) -> Self {
        self.placement = placement;
        self
    }

    /// Opens on its first frame (a story; a screen that opens it at once).
    pub fn default_open(mut self, open: bool) -> Self {
        self.default_open = open;
        self
    }

    /// Makes the popover controlled: it shows while `open`, and asks [`Popover::on_open_change`].
    pub fn open(mut self, open: bool) -> Self {
        self.open = Some(open);
        self
    }

    /// Called when the popover opens or closes (a press on the trigger, Escape, a press outside).
    pub fn on_open_change(
        mut self,
        handler: impl Fn(bool, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_open_change = Some(Rc::new(handler));
        self
    }

    /// The element it opens from (a kit Button).
    pub fn trigger_element(mut self, trigger: impl IntoElement) -> Self {
        self.trigger = Some(trigger.into_any_element());
        self
    }

    /// What it shows while open: a [`PopoverPanel`].
    pub fn content<E: IntoElement>(
        mut self,
        content: impl FnOnce(&mut Window, &mut App) -> E + 'static,
    ) -> Self {
        self.content = Some(Box::new(move |window, cx| {
            content(window, cx).into_any_element()
        }));
        self
    }
}

/// Opens or closes `state`, telling the owner; on a close without a host, focus that was inside
/// goes back to the opener.
fn set_popover_open(
    state: &Entity<PopoverState>,
    open: bool,
    on_change: &Option<ValueAction<bool>>,
    hosted: bool,
    window: &mut Window,
    cx: &mut App,
) {
    // A controlled popover only asks: it opens or closes when its owner changes `open` (the
    // owner may refuse, and focus stays where it is).
    if state.read(cx).controlled {
        if state.read(cx).open != open
            && let Some(on_change) = on_change
        {
            on_change(open, window, cx);
        }
        return;
    }
    let (was, focus, opener) = state.update(cx, |state, _| {
        let was = state.open;
        state.open = open;
        if !open {
            state.placed = false;
        }
        (was, state.focus.clone(), state.opener.take())
    });
    if was == open {
        return;
    }
    if !open
        && !hosted
        && focus.contains_focused(window, cx)
        && let Some(opener) = opener
    {
        window.focus(&opener, cx);
    }
    if let Some(on_change) = on_change {
        on_change(open, window, cx);
    }
    window.refresh();
}

impl RenderOnce for Popover {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let default_open = self.default_open;
        let state = window.use_keyed_state(self.id.clone(), cx, |_, cx| PopoverState {
            open: default_open,
            focus: cx.focus_handle(),
            placed: false,
            opener: None,
            controlled: false,
        });
        let controlled = self.open;
        state.update(cx, |state, _| {
            state.controlled = controlled.is_some();
            // Only a change of the prop opens or closes a controlled popover.
            if let Some(open) = controlled
                && state.open != open
            {
                state.open = open;
                state.placed = false;
            }
        });
        let (open, focus) = {
            let state = state.read(cx);
            (state.open, state.focus.clone())
        };
        let on_change = self.on_open_change.clone();
        let layer = if open {
            let (state, on_change) = (state.clone(), on_change.clone());
            use_layer(
                ElementId::NamedChild(Arc::new(self.id.clone()), "layer".into()),
                LayerSpec {
                    kind: LayerKind::Popover,
                    roots: vec![focus.clone()],
                    on_request_close: Rc::new(move |_, window, cx| {
                        set_popover_open(&state, false, &on_change, true, window, cx)
                    }),
                    focus_layer: Some({
                        let focus = focus.clone();
                        Rc::new(move |window: &mut Window, cx: &mut App| window.focus(&focus, cx))
                            as FocusLayer
                    }),
                    opener: None,
                    fallback_opener: None,
                },
                window,
                cx,
            )
        } else {
            None
        };
        let hosted = layer.is_some();
        if open && !state.read(cx).placed {
            let opener = window.focused(cx);
            state.update(cx, |state, _| {
                state.placed = true;
                state.opener = opener;
            });
            let focus = focus.clone();
            // After this frame is drawn, when the panel is in it.
            window.defer(cx, move |window, cx| window.focus(&focus, cx));
        }
        let trigger = div()
            .relative()
            .children(self.trigger)
            .children(layer.as_ref().map(LayerHandle::anchor_probe));
        let popup = base::Popup::new(self.id, trigger)
            .anchor(self.placement.anchor())
            .offset(px(ANCHOR_GAP))
            // On the click (the press coming up), after the stack has seen the press: a press on
            // this trigger while another popover is open closes that one first (rule 7).
            .on_click({
                let (state, on_change) = (state.clone(), on_change.clone());
                move |_, window, cx| {
                    cx.stop_propagation();
                    set_popover_open(&state, !open, &on_change, hosted, window, cx);
                }
            });
        if !open {
            return popup.into_any_element();
        }
        let content = self
            .content
            .map(|content| content(window, cx))
            .unwrap_or_else(|| div().into_any_element());
        let panel = div()
            .id("popover-content")
            .when(hosted, |panel| {
                layer_keys(panel.key_context(LAYER_CONTEXT), cx)
            })
            .relative()
            .occlude()
            .tab_group()
            .track_focus(&focus)
            .child(content)
            .children(layer.as_ref().map(LayerHandle::panel_probe))
            .when(!hosted, |panel| {
                let (escape, outside) = (state.clone(), state.clone());
                let (on_escape, on_outside) = (on_change.clone(), on_change.clone());
                panel
                    .on_key_down(move |event, window, cx| {
                        if event.keystroke.key == "escape" && !event.keystroke.modifiers.modified()
                        {
                            cx.stop_propagation();
                            set_popover_open(&escape, false, &on_escape, false, window, cx);
                        }
                    })
                    .on_mouse_down_out(move |_, window, cx| {
                        set_popover_open(&outside, false, &on_outside, false, window, cx);
                    })
            });
        let panel = match &layer {
            Some(layer) => LayerScope::new(layer.id.clone(), panel).into_any_element(),
            None => panel.into_any_element(),
        };
        popup.content(panel).into_any_element()
    }
}

/// The space inside a [`PopoverPanel`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PopoverPadding {
    /// For content that brings its own, such as a list of rows.
    None,
    #[default]
    Md,
    Lg,
}

impl PopoverPadding {
    pub fn px(self) -> f32 {
        match self {
            PopoverPadding::None => 0.,
            PopoverPadding::Md => SPACE_MD,
            PopoverPadding::Lg => SPACE_LG,
        }
    }
}

/// The web Popover's panel: the overlay surface, named for assistive technology, never wider than
/// the window less a gutter each side.
#[derive(IntoElement)]
pub struct PopoverPanel {
    label: SharedString,
    padding: PopoverPadding,
    children: Vec<AnyElement>,
}

impl PopoverPanel {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            padding: PopoverPadding::Md,
            children: Vec::new(),
        }
    }

    pub fn padding(mut self, padding: PopoverPadding) -> Self {
        self.padding = padding;
        self
    }
}

impl ParentElement for PopoverPanel {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for PopoverPanel {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let most = window.viewport_size().width - px(2. * LAYOUT_GUTTER);
        // An overlay panel is the surface, whatever it was opened from (a card).
        SurfaceScope::new(
            Surface::Surface,
            overlay_surface(
                div()
                    .id("popover-panel")
                    .test_support()
                    .role(Role::Dialog)
                    .aria_label(self.label)
                    .max_w(most)
                    .p(px(self.padding.px())),
                sem,
            )
            .children(self.children),
        )
    }
}

// ---------------------------------------------------------------------------------------------
// Dialog

/// Why a [`Dialog`] asks to close, as the web's `DialogCloseReason`. The owner may refuse
/// `Escape` and `Scrim` (unsaved changes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogCloseReason {
    Escape,
    /// A left press that started and ended on the dimmed page: a drag out of the panel does not
    /// count.
    Scrim,
    /// The layer the dialog was opened in has closed (the window's overlay stack): the owner must
    /// close it.
    ParentClosed,
}

/// The dialog's width: `layout.dialogSm` (400) or `layout.dialogMd` (560).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DialogSize {
    #[default]
    Sm,
    Md,
}

impl DialogSize {
    pub fn width(self) -> f32 {
        match self {
            DialogSize::Sm => LAYOUT_DIALOG_SM,
            DialogSize::Md => LAYOUT_DIALOG_MD,
        }
    }
}

/// A modal dialog on gpui-kit's focus trap, Escape and backdrop handling, as the web's Dialog: the
/// `surface` role, `radius.island`, the overlay shadow, a title, an optional description, the
/// body, and the actions (safe action first). Focus starts on the first action, unless something
/// in the dialog already took it (a field the screen focuses). Escape and a press on the scrim
/// call [`Dialog::on_request_close`] (and [`Dialog::on_close`]); the owner removes the dialog.
/// Below the phone breakpoint the actions stack, one to a row, safe action on top.
#[derive(IntoElement)]
pub struct Dialog {
    id: ElementId,
    title: SharedString,
    description: Option<SharedString>,
    body: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    width: f32,
    on_close: Option<ValueAction<DialogCloseReason>>,
}

impl Dialog {
    /// `id` keys the dialog's focus state: unique among the dialogs a screen can show at once.
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            description: None,
            body: Vec::new(),
            actions: Vec::new(),
            width: DialogSize::Sm.width(),
            on_close: None,
        }
    }

    pub fn size(mut self, size: DialogSize) -> Self {
        self.width = size.width();
        self
    }

    /// A width of its own, for the screens not yet converted; new screens use [`Dialog::size`].
    pub fn width(mut self, width: f32) -> Self {
        self.width = width;
        self
    }

    /// A line under the title that says more.
    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
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

    /// Called on Escape or a press on the scrim, with which.
    pub fn on_request_close(
        mut self,
        handler: impl Fn(DialogCloseReason, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }

    /// [`Dialog::on_request_close`] for an owner that treats both reasons alike.
    pub fn on_close(self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_request_close(move |_, window, cx| handler(window, cx))
    }
}

impl RenderOnce for Dialog {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let phone = window.viewport_size().width < px(t::BREAKPOINT_PHONE);
        let on_close: Option<ModalClose> = self.on_close.clone().map(|close| {
            Rc::new(
                move |reason: ModalReason, window: &mut Window, cx: &mut App| {
                    let reason = match reason {
                        ModalReason::Escape => DialogCloseReason::Escape,
                        ModalReason::Scrim => DialogCloseReason::Scrim,
                        ModalReason::ParentClosed => DialogCloseReason::ParentClosed,
                    };
                    close(reason, window, cx)
                },
            ) as ModalClose
        });
        let place_focus = !self.actions.is_empty();
        let (title, description, body, actions, width) = (
            self.title,
            self.description,
            self.body,
            self.actions,
            self.width,
        );
        modal(
            self.id,
            LayerKind::Dialog,
            ModalAlign::Centre,
            place_focus,
            on_close,
            window,
            cx,
            move |first| {
                div()
                    .id("dialog-panel")
                    .test_support()
                    .aria_label(title.clone())
                    .when_some(description.clone(), |panel, description| {
                        panel.aria_description(description)
                    })
                    .occlude()
                    .w(px(width))
                    .max_w_full()
                    .max_h_full()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .p(px(SPACE_XL))
                    .bg(sem.role.surface)
                    .text_color(sem.role.text)
                    .border(px(BORDER_HAIRLINE))
                    .border_color(sem.role.hairline)
                    .rounded(px(RADIUS_ISLAND))
                    .shadow(shadow(&sem, ShadowKind::Overlay))
                    .child(
                        type_text(t::TEXT_TITLE, title)
                            .id("dialog-title")
                            .role(Role::Heading),
                    )
                    .children(description.map(|description| {
                        type_text(t::TEXT_BODY, description)
                            .mt(px(SPACE_SM))
                            .text_color(sem.role.text_secondary)
                    }))
                    .when(!body.is_empty(), |panel| {
                        panel.child(div().mt(px(SPACE_LG)).children(body))
                    })
                    .when(!actions.is_empty(), |panel| {
                        panel.child(
                            div()
                                .track_focus(first)
                                .tab_group()
                                .mt(px(SPACE_XL))
                                .flex()
                                .gap(px(SPACE_SM))
                                .map(|row| {
                                    if phone {
                                        row.flex_col().items_stretch()
                                    } else {
                                        row.flex_row().flex_wrap().justify_end().items_center()
                                    }
                                })
                                .children(actions),
                        )
                    })
                    .into_any_element()
            },
        )
    }
}

// ---------------------------------------------------------------------------------------------
// Tooltip

/// The tooltip's box, as the web kit's Tooltip: the `text` role as the fill and `ground` as the
/// ink (inverted, so it reads on any surface), `radius.sm`, `text.small`, never wider than the
/// window less a gutter each side. Attach it with [`with_tip`].
pub struct Tip(pub SharedString);

impl Tip {
    /// The box itself, for a story or a screen that shows a tip without a pointer.
    pub fn panel(label: impl Into<SharedString>, window: &Window, cx: &App) -> impl IntoElement {
        let sem = cx.sem();
        let most = window.viewport_size().width - px(2. * LAYOUT_GUTTER);
        let label: SharedString = label.into();
        type_text(t::TEXT_SMALL, label.clone())
            .id("tooltip")
            .test_support()
            .aria_label(label)
            .max_w(most)
            .px(px(SPACE_SM))
            .py(px(SPACE_XS))
            .rounded(px(RADIUS_SM))
            .bg(sem.tooltip_bg)
            .text_color(sem.tooltip_text)
    }
}

impl Render for Tip {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        Tip::panel(self.0.clone(), window, cx)
    }
}

/// Adds a tooltip to anything with an id.
pub fn with_tip<E: StatefulInteractiveElement>(element: E, tip: impl Into<SharedString>) -> E {
    let tip = tip.into();
    element.tooltip(move |_, cx| cx.new(|_| Tip(tip.clone())).into())
}
