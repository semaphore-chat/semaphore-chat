//! Menu, Popover, Dialog and Tooltip, on the design system (`design/guide/components.md`), and
//! Paper for the screens not yet converted.
//!
//! Every colour is a role (`sem.roles`) or a state tint over one, every size a token from
//! `design/tokens.json` (`semaphore_design::lounge`). The overlays hold no flow logic: they report
//! what happened (an item chosen, Escape, Tab, a press on the scrim) and the owner decides. Wiring
//! them to the overlay stack's reducer is the behaviour hosts' job (epic #848, B8).

use super::{Action, Icon, ValueAction};
use crate::theme::color::{blend, hsla_of};
use crate::theme::{Sem, SemTheme};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Icon as IconName;
use semaphore_design::Rgba as Token;
use semaphore_design::behaviour::list_focus;
use semaphore_design::lounge::{
    self as t, BORDER_HAIRLINE, CONTROL_MD, ICON_MD, LAYOUT_DIALOG_MD, LAYOUT_DIALOG_SM,
    LAYOUT_GUTTER, RADIUS_CARD, RADIUS_ISLAND, RADIUS_MD, RADIUS_SM, SPACE_2XS, SPACE_LG, SPACE_MD,
    SPACE_SM, SPACE_XL, SPACE_XS, STATE_DISABLED, STATE_HOVER, STATE_PRESSED, TextStyle,
};
use std::rc::Rc;
use std::time::Duration;

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

/// `shadow.overlay`: deeper in dark mode, lighter in light.
pub(crate) fn overlay_shadow(sem: &Sem) -> Vec<BoxShadow> {
    let s = t::SHADOW_OVERLAY;
    vec![BoxShadow {
        color: hsla(
            0.,
            0.,
            0.,
            if sem.is_dark { s.alpha } else { s.alpha_light },
        ),
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
        .shadow(overlay_shadow(sem))
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
            .when(self.elevated, |paper| paper.shadow(overlay_shadow(sem)))
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
        let (hover, pressed) = (
            state_over(sem, under, STATE_HOVER),
            state_over(sem, under, STATE_PRESSED),
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
            .when_some(self.focus.as_ref(), |row, focus| row.track_focus(focus))
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
                    .focus_visible(move |style| style.bg(pressed))
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
}

actions!(kit_menu, [MenuTab]);

/// The key context of a [`Menu`]: Tab is the menu's there, ahead of the window's focus move.
const MENU_CONTEXT: &str = "KitMenu";

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

/// The menu's keyboard: the shared list-focus pattern with wrapping at the ends, as the web's
/// MUI menu list.
struct MenuKeys {
    list: list_focus::State,
    handles: Vec<(String, FocusHandle)>,
    focused_once: bool,
}

const MENU_PARAMS: list_focus::Params = list_focus::Params {
    wrap: true,
    selection_follows_focus: false,
    typeahead_ms: t::MOTION_TYPEAHEAD_MS,
};

impl MenuKeys {
    fn handle(&mut self, id: &str, cx: &mut App) -> FocusHandle {
        if let Some((_, handle)) = self.handles.iter().find(|(known, _)| known == id) {
            return handle.clone();
        }
        let handle = cx.focus_handle();
        self.handles.push((id.to_owned(), handle.clone()));
        handle
    }
}

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
    if m.control || m.alt || m.platform || m.function {
        return None;
    }
    let event = match keystroke.key.as_str() {
        "escape" => return Some(MenuKey::Close(MenuCloseReason::Escape)),
        "up" => list_focus::Event::Up,
        "down" => list_focus::Event::Down,
        "home" => list_focus::Event::Home,
        "end" => list_focus::Event::End,
        "space" if !typing => return None,
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
                (Some(char), None) if !char.is_control() => list_focus::Event::Type { char },
                _ => return None,
            }
        }
    };
    Some(MenuKey::Move(event))
}

/// A menu of actions on one thing, as the web's Menu: items, dividers, icons, shortcut key caps
/// and a danger tone, on the overlay surface. Put it where it opens from (the owner anchors it).
///
/// When it is drawn, focus goes to the first item that is not disabled. Up and Down move between
/// items and wrap; Home and End jump; typing jumps by prefix; Enter or Space (or a press) chooses.
/// Escape and Tab ask to close ([`Menu::on_close`]), and so does a choice, after the item's own
/// action; where focus goes after is the owner's (the overlay stack's) to decide.
#[derive(IntoElement)]
pub struct Menu {
    id: ElementId,
    label: SharedString,
    entries: Vec<MenuEntry>,
    on_close: Option<ValueAction<MenuCloseReason>>,
}

impl Menu {
    pub fn new(
        label: impl Into<SharedString>,
        entries: impl IntoIterator<Item = impl Into<MenuEntry>>,
    ) -> Self {
        Self {
            id: "menu".into(),
            label: label.into(),
            entries: entries.into_iter().map(Into::into).collect(),
            on_close: None,
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
}

impl RenderOnce for Menu {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        bind_menu_keys(cx);
        let sem = cx.sem().clone();
        let keys = window.use_keyed_state(self.id.clone(), cx, |_, _| MenuKeys {
            list: list_focus::initial(&MENU_PARAMS),
            handles: Vec::new(),
            focused_once: false,
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
            if keys.list.rows != rows {
                keys.list = list_focus::step(
                    &keys.list,
                    &list_focus::Event::SetRows { rows: rows.clone() },
                    &MENU_PARAMS,
                )
                .0;
            }
            rows.iter()
                .map(|row| (row.id.clone(), keys.handle(&row.id, cx)))
                .collect()
        });
        // Focus starts on the first enabled item, once the items are in the frame.
        if !keys.read(cx).focused_once {
            let first = rows
                .iter()
                .find(|row| !row.disabled)
                .and_then(|row| handles.iter().find(|(id, _)| *id == row.id))
                .map(|(_, handle)| handle.clone());
            keys.update(cx, |keys, _| keys.focused_once = true);
            if let Some(first) = first {
                window.focus(&first, cx);
            }
        }

        let on_close = self.on_close.clone();
        let after_select: Option<Action> = on_close.clone().map(|close| {
            Rc::new(move |window: &mut Window, cx: &mut App| {
                close(MenuCloseReason::Selected, window, cx)
            }) as Action
        });
        let key_state = keys.clone();
        let key_handles = handles.clone();
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
            .flex()
            .flex_col()
            .key_context(MENU_CONTEXT)
            .on_action({
                let on_close = on_close.clone();
                move |_: &MenuTab, window, cx| {
                    if let Some(close) = &on_close {
                        close(MenuCloseReason::Tab, window, cx);
                    }
                }
            })
            .on_key_down(move |event, window, cx| {
                let typing = !key_state.read(cx).list.typeahead.is_empty();
                let Some(key) = menu_key(&event.keystroke, typing) else {
                    return;
                };
                cx.stop_propagation();
                match key {
                    MenuKey::Close(reason) => {
                        if let Some(close) = &on_close {
                            close(reason, window, cx);
                        }
                    }
                    MenuKey::Move(event) => {
                        move_menu_focus(&key_state, &key_handles, event, window, cx)
                    }
                }
            })
            .children(items);
        overlay_surface(list, &sem)
    }
}

/// Runs one list-focus event from the item that has focus, then focuses the result. A typeahead
/// timer comes back as `TimerFired`.
fn move_menu_focus(
    keys: &Entity<MenuKeys>,
    handles: &[(String, FocusHandle)],
    event: list_focus::Event,
    window: &mut Window,
    cx: &mut App,
) {
    let focused = handles
        .iter()
        .find(|(_, handle)| handle.is_focused(window))
        .map(|(id, _)| id.clone());
    let (target, timers) = keys.update(cx, |keys, _| {
        let mut state = keys.list.clone();
        if let Some(id) = focused {
            state = list_focus::step(&state, &list_focus::Event::FocusRow { id }, &MENU_PARAMS).0;
        } else {
            state = list_focus::step(&state, &list_focus::Event::FocusIn, &MENU_PARAMS).0;
        }
        let (state, effects) = list_focus::step(&state, &event, &MENU_PARAMS);
        keys.list = state;
        (keys.list.focused.clone(), effects)
    });
    for effect in timers {
        if let list_focus::Effect::StartTimer { token, ms } = effect {
            let keys = keys.downgrade();
            window
                .spawn(cx, async move |cx| {
                    cx.background_executor()
                        .timer(Duration::from_millis(ms.into()))
                        .await;
                    keys.update(cx, |keys, _| {
                        keys.list = list_focus::step(
                            &keys.list,
                            &list_focus::Event::TimerFired { token },
                            &MENU_PARAMS,
                        )
                        .0;
                    })
                    .ok();
                })
                .detach();
        }
    }
    if let Some(target) = target
        && let Some((_, handle)) = handles.iter().find(|(id, _)| *id == target)
    {
        window.focus(handle, cx);
    }
}

// ---------------------------------------------------------------------------------------------
// Popover

/// gpui-kit's positioning, dismissal (Escape, a press outside) and focus restore. Give it a
/// [`PopoverPanel`] as content and a [`Placement`] with [`PopoverExt::placement`].
pub use gpui_kit::base::Popover;

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

pub trait PopoverExt {
    /// Places the panel on a side of its trigger, `ANCHOR_GAP` away.
    fn placement(self, placement: Placement) -> Self;
    /// Any element as the trigger (a kit Button), for gpui-kit's, which wants a `Selectable`.
    fn trigger_element(self, trigger: impl IntoElement + 'static) -> Self;
}

impl PopoverExt for Popover {
    fn placement(self, placement: Placement) -> Self {
        self.anchor(placement.anchor()).offset(px(ANCHOR_GAP))
    }

    fn trigger_element(self, trigger: impl IntoElement + 'static) -> Self {
        self.trigger_with(move |_, _, _| trigger.into_any_element())
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
        .children(self.children)
    }
}

// ---------------------------------------------------------------------------------------------
// Dialog

/// Why a [`Dialog`] asks to close, as the web's `DialogCloseReason`. The owner may refuse
/// `Escape` and `Scrim` (unsaved changes).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialogCloseReason {
    Escape,
    /// A press that started and ended on the dimmed page.
    Scrim,
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

/// Where the dialog keeps its first focus: the host's handle, and whether focus was placed.
struct DialogFocus {
    host: FocusHandle,
    actions: FocusHandle,
    placed: bool,
}

/// A modal dialog on gpui-kit's focus trap, Escape and backdrop handling, as the web's Dialog: the
/// `surface` role, `radius.island`, the overlay shadow, a title, an optional description, the
/// body, and the actions (safe action first). Focus starts on the first action, unless something
/// in the dialog already took it (a field the screen focuses). Escape and a press on the scrim
/// call [`Dialog::on_request_close`] (and [`Dialog::on_close`]); the owner removes the dialog.
/// Below the phone breakpoint the actions stack, one to a row, safe action on top.
#[derive(IntoElement)]
pub struct Dialog {
    title: SharedString,
    description: Option<SharedString>,
    body: Vec<AnyElement>,
    actions: Vec<AnyElement>,
    width: f32,
    on_close: Option<ValueAction<DialogCloseReason>>,
}

impl Dialog {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
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
        let on_close = self.on_close.clone();
        let sem = cx.sem().clone();
        let phone = window.viewport_size().width < px(t::BREAKPOINT_PHONE);
        let focus = window.use_keyed_state(
            ElementId::Name(format!("kit-dialog-{}", self.title).into()),
            cx,
            |_, cx| DialogFocus {
                host: cx.focus_handle(),
                actions: cx.focus_handle(),
                placed: false,
            },
        );
        let (host, actions_focus, placed) = {
            let focus = focus.read(cx);
            (focus.host.clone(), focus.actions.clone(), focus.placed)
        };
        if !placed && !self.actions.is_empty() {
            focus.update(cx, |focus, _| focus.placed = true);
            let (host, actions_focus) = (host.clone(), actions_focus.clone());
            // After this frame is drawn, when its Tab order exists.
            window.defer(cx, move |window, cx| {
                // The trap focuses its own host; a control inside that took focus keeps it.
                if host.is_focused(window) || !host.contains_focused(window, cx) {
                    window.focus(&actions_focus, cx);
                    window.focus_next(cx);
                }
            });
        }
        let titled = self.title.clone();
        let escape = on_close.clone();
        let popup = div()
            .absolute()
            .inset_0()
            // Escape is the dialog's own, in the bubble phase, so a focused control that uses it
            // (a field's IME, an open select list) has it first. gpui-kit's dialog keys are off:
            // they would make Enter close the dialog instead of pressing the focused button.
            .on_key_down(move |event, window, cx| {
                if event.keystroke.key == "escape" && !event.keystroke.modifiers.modified() {
                    cx.stop_propagation();
                    if let Some(close) = &escape {
                        close(DialogCloseReason::Escape, window, cx);
                    }
                }
            })
            .flex()
            .items_center()
            .justify_center()
            .p(px(LAYOUT_GUTTER))
            .child(
                div()
                    .id("dialog-panel")
                    .test_support()
                    .aria_label(titled)
                    .when_some(self.description.clone(), |panel, description| {
                        panel.aria_description(description)
                    })
                    .occlude()
                    .w(px(self.width))
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
                    .shadow(overlay_shadow(&sem))
                    .child(
                        type_text(t::TEXT_TITLE, self.title)
                            .id("dialog-title")
                            .role(Role::Heading),
                    )
                    .children(self.description.map(|description| {
                        type_text(t::TEXT_BODY, description)
                            .mt(px(SPACE_SM))
                            .text_color(sem.role.text_secondary)
                    }))
                    .when(!self.body.is_empty(), |panel| {
                        panel.child(div().mt(px(SPACE_LG)).children(self.body))
                    })
                    .when(!self.actions.is_empty(), |panel| {
                        panel.child(
                            div()
                                .track_focus(&actions_focus)
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
                                .children(self.actions),
                        )
                    }),
            );
        base::Dialog::new(cx)
            .focus_handle(host)
            .close_on_escape(false)
            .open(true)
            .on_open_change(move |open, reason, window, cx| {
                let reason = match reason {
                    base::DialogChangeReason::BackdropPress => DialogCloseReason::Scrim,
                    base::DialogChangeReason::Cancel => DialogCloseReason::Escape,
                    _ => return,
                };
                if !open && let Some(on_close) = &on_close {
                    on_close(reason, window, cx);
                }
            })
            .backdrop(div().absolute().inset_0().occlude().bg(sem.role.scrim))
            .popup(popup)
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
    pub fn panel(label: impl Into<SharedString>, window: &Window, cx: &App) -> Div {
        let sem = cx.sem();
        let most = window.viewport_size().width - px(2. * LAYOUT_GUTTER);
        type_text(t::TEXT_SMALL, label)
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
