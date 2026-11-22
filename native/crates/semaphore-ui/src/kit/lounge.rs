//! The Lounge pieces: Island, Card, Dock, DockDivider and DockItem, the native side of
//! `frontend/src/kit/surfaces/` and `frontend/src/kit/dock/` (web PR #784).
//!
//! Every colour is a role (`sem.roles`) or a state tint over one, every size a token from
//! `design/tokens.json`. Island and Dock give their children the `Surface` layer, a Card `Fill`
//! (or `Surface` on a fill), so the kit pieces inside draw to stand out from them
//! ([`super::surface`]).

use super::behaviour::list_focus::{ListFocusHost, ListKeys, ListOrientation, list_key};
use super::overlays::{ShadowKind, shadow, state_over};
use super::surface::stand_out_token;
use super::{
    Action, Avatar, AvatarShape, AvatarSize, Badge, BadgeTone, CountMeaning, IconButton, Surface,
    SurfaceScope, count_words, with_tip,
};
use crate::kit::look::{outer_focus_ring, shows_focus};
use crate::theme::SemTheme;
use crate::theme::color::hsla_of;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::Rgba as Token;
use semaphore_design::behaviour::list_focus;
use semaphore_design::lounge::{
    AVATAR_MD, BORDER_HAIRLINE, BORDER_SELECTED, CONTROL_MD, ICON_XL, LAYOUT_DOCK, RADIUS_CARD,
    RADIUS_FULL, RADIUS_ISLAND, SPACE_LG, SPACE_MD, SPACE_SM, SPACE_XL, SPACE_XS, STATE_DISABLED,
    STATE_HOVER, STATE_PRESSED,
};
use std::rc::Rc;

/// The space inside an Island or a Card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Padding {
    None,
    Md,
    #[default]
    Lg,
}

impl Padding {
    pub fn px(self) -> f32 {
        match self {
            Padding::None => 0.,
            Padding::Md => SPACE_MD,
            Padding::Lg => SPACE_LG,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Island

/// The landmark an island is. A navigation or complementary landmark must be named (two unnamed
/// ones of a kind cannot be told apart); a main one may be; a region is a named section.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Landmark {
    /// No landmark: a plain panel.
    #[default]
    None,
    Navigation(SharedString),
    Complementary(SharedString),
    Main(Option<SharedString>),
    Region(SharedString),
}

impl Landmark {
    pub fn role(&self) -> Option<Role> {
        match self {
            Landmark::None => None,
            Landmark::Navigation(_) => Some(Role::Navigation),
            Landmark::Complementary(_) => Some(Role::Complementary),
            Landmark::Main(_) => Some(Role::Main),
            Landmark::Region(_) => Some(Role::Region),
        }
    }

    pub fn label(&self) -> Option<SharedString> {
        match self {
            Landmark::None | Landmark::Main(None) => None,
            Landmark::Navigation(label)
            | Landmark::Complementary(label)
            | Landmark::Region(label)
            | Landmark::Main(Some(label)) => Some(label.clone()),
        }
    }
}

/// The Lounge's big surface: a rounded panel on the ground, with the island shadow and no border.
/// Pick the landmark with [`Island::nav`], [`Island::aside`], [`Island::main`] or
/// [`Island::region`]. With [`Island::scroll`] it fills the height its parent gives it and
/// scrolls its own content. The layout, not the island, sets the gap between islands.
#[derive(IntoElement)]
pub struct Island {
    id: ElementId,
    landmark: Landmark,
    padding: Padding,
    scroll: bool,
    /// `Some` splits the island into a body and a foot, even while the foot is `None`.
    footer: Option<Option<AnyElement>>,
    children: Vec<AnyElement>,
}

impl Island {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            landmark: Landmark::None,
            padding: Padding::Lg,
            scroll: false,
            footer: None,
            children: Vec::new(),
        }
    }

    /// A navigation landmark, named `label`.
    pub fn nav(mut self, label: impl Into<SharedString>) -> Self {
        self.landmark = Landmark::Navigation(label.into());
        self
    }

    /// A complementary landmark (the web's `aside`), named `label`.
    pub fn aside(mut self, label: impl Into<SharedString>) -> Self {
        self.landmark = Landmark::Complementary(label.into());
        self
    }

    /// The main landmark; a name is optional.
    pub fn main(mut self, label: Option<SharedString>) -> Self {
        self.landmark = Landmark::Main(label);
        self
    }

    /// A named region (the web's labelled `section`).
    pub fn region(mut self, label: impl Into<SharedString>) -> Self {
        self.landmark = Landmark::Region(label.into());
        self
    }

    pub fn padding(mut self, padding: Padding) -> Self {
        self.padding = padding;
        self
    }

    /// Fills the parent's height; the content scrolls inside the island, never the page.
    pub fn scroll(mut self, scroll: bool) -> Self {
        self.scroll = scroll;
        self
    }

    /// A block that stays at the island's foot (the user's own card): with `scroll`, only the
    /// content above it scrolls. Pass `None` while there is nothing to show: the island keeps the
    /// same structure, so its content keeps its place in the tree.
    pub fn footer(mut self, footer: Option<AnyElement>) -> Self {
        self.footer = Some(footer);
        self
    }
}

impl ParentElement for Island {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Island {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem();
        let pad = px(self.padding.px());
        let role = self.landmark.role();
        let label = self.landmark.label();
        let root = div()
            .id(self.id.clone())
            .test_support()
            .when_some(role, |root, role| root.role(role))
            .when_some(label, |root, label| root.aria_label(label))
            .flex()
            .flex_col()
            .min_w_0()
            .bg(sem.role.surface)
            .text_color(sem.role.text)
            .rounded(px(RADIUS_ISLAND))
            .shadow(shadow(sem, ShadowKind::Island));
        let root = match self.footer {
            None => root
                .p(pad)
                .when(self.scroll, |root| {
                    root.h_full()
                        .min_h_0()
                        .overflow_y_scroll()
                        .overflow_x_hidden()
                })
                .when(!self.scroll, |root| root.overflow_hidden())
                .children(self.children),
            Some(footer) => root
                .overflow_hidden()
                .when(self.scroll, |root| root.h_full().min_h_0())
                .child(
                    div()
                        .id("island-body")
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .flex_1()
                        .p(pad)
                        .when(self.scroll, |body| {
                            body.min_h_0().overflow_y_scroll().overflow_x_hidden()
                        })
                        .children(self.children),
                )
                .children(footer.map(|footer| {
                    div()
                        .flex_shrink_0()
                        .min_w_0()
                        .pt(px(SPACE_SM))
                        .px(pad)
                        .pb(pad)
                        .child(footer)
                })),
        };
        SurfaceScope::new(Surface::Surface, root)
    }
}

// ---------------------------------------------------------------------------------------------
// Card

/// The accessible name of a card: its label, and ", current" when selected (GPUI has no
/// `aria-current`, so the state is in the name).
pub fn card_name(label: Option<&str>, selected: bool) -> Option<String> {
    match (label, selected) {
        (Some(label), true) => Some(format!("{label}, current")),
        (Some(label), false) => Some(label.to_owned()),
        (None, true) => Some("current".into()),
        (None, false) => None,
    }
}

/// A soft-filled card inside an island. Plain, or one button ([`Card::on_click`]) covering the
/// whole card and named by [`Card::label`]. A clickable card holds no other controls: use a plain
/// card with the controls inside, or a ListRow with a trailing control. `selected` (you are in
/// this voice room, or it is the current item) draws an accent outline that is always there
/// (transparent when unselected), so selecting never resizes the card, and puts ", current" in
/// the name.
#[derive(IntoElement)]
pub struct Card {
    id: ElementId,
    label: Option<SharedString>,
    selected: bool,
    padding: Padding,
    on: Option<Surface>,
    on_click: Option<Action>,
    children: Vec<AnyElement>,
}

impl Card {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            label: None,
            selected: false,
            padding: Padding::Md,
            on: None,
            on_click: None,
            children: Vec::new(),
        }
    }

    /// The accessible name: a clickable card needs one; a plain one has it as a group's name.
    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// `Md` (the default) or `Lg`.
    pub fn padding(mut self, padding: Padding) -> Self {
        self.padding = padding;
        self
    }

    pub fn on_surface(mut self, on: Surface) -> Self {
        self.on = Some(on);
        self
    }

    /// The whole card is one button.
    pub fn on_click(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for Card {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

/// A card's fill on `on`, and its hover and pressed tints.
pub(crate) fn card_paint(sem: &crate::theme::Sem, on: Surface) -> (Token, Hsla, Hsla) {
    let fill = stand_out_token(&sem.roles, on);
    (
        fill,
        state_over(sem, fill, STATE_HOVER),
        state_over(sem, fill, STATE_PRESSED),
    )
}

impl RenderOnce for Card {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let on = Surface::or_current(self.on, cx);
        let (fill, hover, pressed) = card_paint(&sem, on);
        let name = card_name(self.label.as_deref(), self.selected);
        let border = if self.selected {
            sem.role.accent
        } else {
            transparent_black()
        };
        let padding = self.padding.px();
        let look = CardLook {
            padding,
            border,
            fill: hsla_of(fill),
            ink: sem.role.text,
        };
        let content = SurfaceScope::new(
            on.inside_fill(),
            div()
                .flex()
                .flex_col()
                .gap(px(SPACE_MD))
                .w_full()
                .min_w_0()
                .children(self.children),
        );
        match self.on_click {
            Some(handler) => {
                let focus = crate::kit::look::focus_handle(&self.id, window, cx);
                let ring = shows_focus(&focus, window);
                let button = base::Button::new(self.id.clone())
                    .track_focus(&focus)
                    .when_some(name, |button, name| button.accessibility_label(name))
                    .relative()
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .active(move |style| style.bg(pressed))
                    .on_click(move |_, window, cx| handler(window, cx));
                look.apply(button)
                    .when(ring, |button| {
                        button.child(outer_focus_ring(&sem.roles, RADIUS_CARD))
                    })
                    .child(content)
                    .into_any_element()
            }
            None => look
                .apply(
                    div()
                        .id(self.id)
                        .test_support()
                        .when_some(name, |card, name| card.role(Role::Group).aria_label(name)),
                )
                .child(content)
                .into_any_element(),
        }
    }
}

/// One look for the plain and button forms.
struct CardLook {
    padding: f32,
    border: Hsla,
    fill: Hsla,
    ink: Hsla,
}

impl CardLook {
    fn apply<E: Styled>(&self, el: E) -> E {
        // Content starts at the top left, as in a plain block (a base button centres by default).
        el.flex()
            .flex_col()
            .items_stretch()
            .justify_start()
            .w_full()
            .min_w_0()
            .p(px(self.padding))
            .border(px(BORDER_SELECTED))
            .border_color(self.border)
            .rounded(px(RADIUS_CARD))
            .bg(self.fill)
            .text_color(self.ink)
    }
}

// ---------------------------------------------------------------------------------------------
// Dock

/// The ring around a dock item and the gap inside it; the item's outer size always includes both.
const RING: f32 = BORDER_SELECTED;
/// The fade at a scrolled edge of the dock, and the room kept beside an item scrolled into view.
pub const DOCK_FADE: f32 = SPACE_XL;
/// Room inside the dock's scrolling region on each side: a badge or dot sits up to `space.xs`
/// outside its item, plus its ring.
const DOCK_INSET: f32 = SPACE_SM;

/// What a dock item says to assistive technology: the name, then ", current", the count (or
/// ", new messages" when there is no count) and ", reconnecting", as they apply.
pub fn dock_item_name(
    name: &str,
    current: bool,
    unread: u32,
    meaning: CountMeaning,
    new_messages: bool,
    reconnecting: bool,
) -> String {
    let mut parts = vec![name.to_owned()];
    if current {
        parts.push("current".into());
    }
    if unread > 0 {
        parts.push(count_words(unread, meaning));
    } else if new_messages {
        parts.push("new messages".into());
    }
    if reconnecting {
        parts.push("reconnecting".into());
    }
    parts.join(", ")
}

/// A community in the [`Dock`]: a round button holding its picture. Its accessible name says
/// everything the picture shows ([`dock_item_name`]); the name also shows in a tooltip.
#[derive(IntoElement)]
pub struct DockItem {
    key: SharedString,
    name: SharedString,
    image: Option<ImageSource>,
    file: Option<SharedString>,
    colour: Option<Token>,
    current: bool,
    unread: u32,
    meaning: CountMeaning,
    new_messages: bool,
    reconnecting: bool,
    on_click: Option<Action>,
    focus: Option<FocusHandle>,
    tab_stop: Option<bool>,
    element_id: Option<ElementId>,
}

impl DockItem {
    /// `key` is unique in the dock (the community's id); `name` the community's name.
    pub fn new(key: impl Into<SharedString>, name: impl Into<SharedString>) -> Self {
        Self {
            key: key.into(),
            name: name.into(),
            image: None,
            file: None,
            colour: None,
            current: false,
            unread: 0,
            meaning: CountMeaning::Unread,
            new_messages: false,
            reconnecting: false,
            on_click: None,
            focus: None,
            tab_stop: None,
            element_id: None,
        }
    }

    /// The item's element id; the default is `dock-item-<key>`.
    pub fn id(mut self, id: impl Into<ElementId>) -> Self {
        self.element_id = Some(id.into());
        self
    }

    pub fn image(mut self, image: Option<ImageSource>) -> Self {
        self.image = image;
        self
    }

    /// A file id drawn through the app's avatar images.
    pub fn file(mut self, file: Option<SharedString>) -> Self {
        self.file = file;
        self
    }

    /// The community's own colour, behind the initials.
    pub fn colour(mut self, colour: impl Into<Option<Token>>) -> Self {
        self.colour = colour.into();
        self
    }

    /// The community you are in: an accent ring, and ", current" in the name.
    pub fn current(mut self, current: bool) -> Self {
        self.current = current;
        self
    }

    /// A count on the item; nothing is shown for 0.
    pub fn unread(mut self, unread: u32) -> Self {
        self.unread = unread;
        self
    }

    /// What the count counts, in the name: unread (default) or mentions.
    pub fn meaning(mut self, meaning: CountMeaning) -> Self {
        self.meaning = meaning;
        self
    }

    /// New messages that do not mention you: an accent dot, unless a count is shown.
    pub fn new_messages(mut self, new_messages: bool) -> Self {
        self.new_messages = new_messages;
        self
    }

    /// A warning dot, and the picture dimmed.
    pub fn reconnecting(mut self, reconnecting: bool) -> Self {
        self.reconnecting = reconnecting;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }

    pub fn key(&self) -> &SharedString {
        &self.key
    }

    pub fn is_current(&self) -> bool {
        self.current
    }
}

/// A small round mark at a corner of a dock item, ringed in the surface colour.
fn corner_dot(colour: Hsla, ring: Hsla) -> Div {
    div()
        .absolute()
        .size(px(SPACE_SM + 2. * RING))
        .rounded_full()
        .border(px(RING))
        .border_color(ring)
        .bg(colour)
}

impl RenderOnce for DockItem {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let id = self
            .element_id
            .clone()
            .unwrap_or_else(|| ElementId::Name(format!("dock-item-{}", self.key).into()));
        let focus = self
            .focus
            .clone()
            .unwrap_or_else(|| crate::kit::look::focus_handle(&id, window, cx));
        let ring = shows_focus(&focus, window);
        let count = self.unread;
        // The count wins: a dot beside a badge would say the same thing twice.
        let dot = self.new_messages && count == 0;
        let name = dock_item_name(
            &self.name,
            self.current,
            count,
            self.meaning,
            self.new_messages,
            self.reconnecting,
        );
        let surface = sem.role.surface;
        let (hover, pressed) = (
            state_over(&sem, sem.roles.surface, STATE_HOVER),
            state_over(&sem, sem.roles.surface, STATE_PRESSED),
        );
        let outer = CONTROL_MD + 2. * RING;
        let avatar = Avatar::new(self.name.clone())
            .size(AvatarSize::Md)
            .shape(AvatarShape::Circle)
            .colour(self.colour)
            .image(self.image)
            .file(self.file.as_deref())
            .decorative(true);
        let mut button = base::Button::new(id)
            .track_focus(&focus)
            .accessibility_label(name)
            .when_some(self.tab_stop, |button, stop| button.tab_stop(stop))
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(outer))
            .p(px((CONTROL_MD - AVATAR_MD) / 2.))
            .rounded(px(RADIUS_FULL))
            .border(px(RING))
            .border_color(if self.current {
                sem.role.accent
            } else {
                transparent_black()
            })
            .bg(surface)
            .text_color(sem.role.text)
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .active(move |style| style.bg(pressed))
            .child(
                div()
                    .flex()
                    .when(self.reconnecting, |picture| picture.opacity(STATE_DISABLED))
                    .child(avatar),
            );
        if count > 0 {
            button = button.child(
                div()
                    .absolute()
                    .top(px(-SPACE_XS - RING))
                    .right(px(-SPACE_XS - RING))
                    .flex()
                    .rounded_full()
                    .border(px(RING))
                    .border_color(surface)
                    .child(
                        Badge::new(count_words(count, self.meaning))
                            .count(count)
                            .tone(BadgeTone::Danger)
                            .decorative(true),
                    ),
            );
        }
        if dot {
            // Pushed out by half of `space.xs`, so on the current item it clears the accent ring.
            button = button.child(
                corner_dot(sem.role.accent, surface)
                    .top(px(-SPACE_XS / 2. - RING))
                    .right(px(-SPACE_XS / 2. - RING)),
            );
        }
        if self.reconnecting {
            button = button.child(
                corner_dot(sem.role.warning, surface)
                    .right(px(-RING))
                    .bottom(px(-RING)),
            );
        }
        if ring {
            button = button.child(outer_focus_ring(&sem.roles, RADIUS_FULL));
        }
        if let Some(handler) = self.on_click {
            button = button.on_click(move |_, window, cx| handler(window, cx));
        }
        with_tip(button, self.name)
    }
}

/// A vertical hairline between groups in a [`Dock`]. Decorative.
#[derive(IntoElement, Default)]
pub struct DockDivider;

impl RenderOnce for DockDivider {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .flex_none()
            .w(px(BORDER_HAIRLINE))
            .h(px(ICON_XL))
            .bg(cx.sem().role.fill)
    }
}

/// One thing in a [`Dock`].
pub enum DockEntry {
    Item(DockItem),
    /// An icon button (Inbox, "All communities") with the key it has in the dock's keyboard list.
    Button(SharedString, IconButton),
    Divider,
    /// Any element that is not a stop of the dock's keyboard list: a loading placeholder.
    Element(AnyElement),
}

impl DockEntry {
    pub fn button(key: impl Into<SharedString>, button: IconButton) -> Self {
        DockEntry::Button(key.into(), button)
    }

    fn key(&self) -> Option<&SharedString> {
        match self {
            DockEntry::Item(item) => Some(&item.key),
            DockEntry::Button(key, _) => Some(key),
            DockEntry::Divider | DockEntry::Element(_) => None,
        }
    }

    fn is_disabled(&self) -> bool {
        matches!(self, DockEntry::Button(_, button) if button.is_disabled())
    }

    fn is_current(&self) -> bool {
        matches!(self, DockEntry::Item(item) if item.current)
    }

    fn render(self, focus: Option<(FocusHandle, bool)>) -> AnyElement {
        match self {
            DockEntry::Item(mut item) => {
                if let Some((handle, stop)) = focus {
                    item.focus = Some(handle);
                    item.tab_stop = Some(stop);
                }
                item.into_any_element()
            }
            DockEntry::Button(_, button) => match focus {
                Some((handle, stop)) => button
                    .track_focus(&handle)
                    .tab_stop(stop)
                    .into_any_element(),
                None => button.into_any_element(),
            },
            DockEntry::Divider => DockDivider.into_any_element(),
            DockEntry::Element(element) => element,
        }
    }
}

impl From<DockItem> for DockEntry {
    fn from(item: DockItem) -> Self {
        DockEntry::Item(item)
    }
}

impl From<DockDivider> for DockEntry {
    fn from(_: DockDivider) -> Self {
        DockEntry::Divider
    }
}

/// How far to scroll the dock (a distance from the start, `>= 0`) so the item from `start` to
/// `end` (content coordinates) is in view with `fade` of room beside it; `None` when it already
/// is. `scroll` is the current distance, `view` the visible width, `max` the largest distance.
pub fn reveal_scroll(
    start: f32,
    end: f32,
    scroll: f32,
    view: f32,
    max: f32,
    fade: f32,
) -> Option<f32> {
    let left = start - fade;
    let right = end + fade;
    let next = if left < scroll {
        left.max(0.)
    } else if right > scroll + view {
        right - view
    } else {
        return None;
    };
    let next = next.clamp(0., max.max(0.));
    ((next - scroll).abs() > 0.5).then_some(next)
}

/// Which edges of the dock fade: there is more beyond the start, and more beyond the end.
pub fn dock_fades(scroll: f32, max: f32) -> (bool, bool) {
    (scroll > 1., scroll < max - 1.)
}

/// The dock's keyboard list and its scroll.
struct DockState {
    focus: ListFocusHost,
    scroll: ScrollHandle,
    /// The current item last brought into view, and the bar's width then.
    revealed: Option<(String, Pixels)>,
}

fn dock_focus(state: &mut DockState) -> &mut ListFocusHost {
    &mut state.focus
}

#[cfg(test)]
pub(crate) use super::behaviour::list_focus::tab_stop_of;

const DOCK_PARAMS: list_focus::Params = list_focus::Params {
    wrap: false,
    selection_follows_focus: false,
    typeahead_ms: semaphore_design::lounge::MOTION_TYPEAHEAD_MS,
};

/// The dock's keys: a horizontal list (Left and Right, Up and Down, Home and End), no typeahead,
/// as the web's Dock on `useListFocus({ orientation: 'horizontal' })`.
const DOCK_KEYS: ListKeys = ListKeys {
    orientation: ListOrientation::Horizontal,
    typeahead: false,
    allow_shift: false,
};

/// Scrolls the dock so the middle child `index` is in view, from the last frame's layout.
fn reveal_index(scroll: &ScrollHandle, index: usize) -> bool {
    let Some(item) = scroll.bounds_for_item(index) else {
        return false;
    };
    let view = scroll.bounds();
    let offset = scroll.offset();
    let start = f32::from(item.left() - view.left());
    let end = f32::from(item.right() - view.left());
    let current = -f32::from(offset.x);
    let max = f32::from(scroll.max_offset().x);
    match reveal_scroll(
        start,
        end,
        current,
        f32::from(view.size.width),
        max,
        DOCK_FADE,
    ) {
        Some(next) => {
            scroll.set_offset(point(px(-next), offset.y));
            true
        }
        None => false,
    }
}

/// The community switcher: a pill-shaped navigation bar of [`DockItem`]s and icon buttons. The
/// `start` and `end` entries stay put; the items between them scroll sideways when they do not
/// fit (a vertical wheel scrolls them too), with a fade at an edge that has more beyond it. It
/// keeps the current item in view on the first frame, whenever the current item changes and when
/// the bar's width changes, and a focused item in view; a scroll the user made is otherwise left
/// alone. The whole bar is one Tab stop; Left, Right, Home and End move between its entries.
#[derive(IntoElement)]
pub struct Dock {
    id: ElementId,
    label: SharedString,
    start: Vec<DockEntry>,
    items: Vec<DockEntry>,
    end: Vec<DockEntry>,
}

impl Dock {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            start: Vec::new(),
            items: Vec::new(),
            end: Vec::new(),
        }
    }

    /// An entry fixed at the start of the bar (an Inbox button, a divider).
    pub fn start(mut self, entry: impl Into<DockEntry>) -> Self {
        self.start.push(entry.into());
        self
    }

    /// An entry in the part that scrolls.
    pub fn item(mut self, entry: impl Into<DockEntry>) -> Self {
        self.items.push(entry.into());
        self
    }

    pub fn items(mut self, entries: impl IntoIterator<Item = impl Into<DockEntry>>) -> Self {
        self.items.extend(entries.into_iter().map(Into::into));
        self
    }

    /// An entry fixed at the end of the bar (an "All communities" button).
    pub fn end(mut self, entry: impl Into<DockEntry>) -> Self {
        self.end.push(entry.into());
        self
    }
}

impl RenderOnce for Dock {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let sem = cx.sem().clone();
        let state = window.use_keyed_state(self.id.clone(), cx, |_, _| DockState {
            focus: ListFocusHost::new(DOCK_PARAMS, DOCK_KEYS),
            scroll: ScrollHandle::new(),
            revealed: None,
        });
        let entries = || self.start.iter().chain(&self.items).chain(&self.end);
        let rows: Vec<list_focus::Row> = entries()
            .filter_map(|entry| {
                entry.key().map(|key| list_focus::Row {
                    id: key.to_string(),
                    label: String::new(),
                    disabled: entry.is_disabled(),
                })
            })
            .collect();
        let current = self
            .items
            .iter()
            .position(DockEntry::is_current)
            .and_then(|ix| self.items[ix].key().map(|key| (ix, key.to_string())));
        let middle_index = |key: &str| {
            self.items
                .iter()
                .position(|entry| entry.key().is_some_and(|known| known.as_ref() == key))
        };
        // What the web host feeds the reducer: the rows (with their disabled state), the
        // selection (the current item), and where focus is. Focus moves (a click, Tab, an arrow)
        // re-render the window, so the focused entry is read here.
        let (handles, scroll, entered, stop) = state.update(cx, |state, cx| {
            let selected = current.as_ref().map(|(_, key)| key.clone());
            let synced = state.focus.sync(rows.clone(), Some(selected), window, cx);
            (
                synced.handles,
                state.scroll.clone(),
                synced.entered,
                state.focus.tab_stop(),
            )
        });
        let focus_of = |entry: &DockEntry| {
            entry.key().and_then(|key| {
                handles
                    .iter()
                    .find(|(known, _)| known.as_str() == key.as_ref())
                    .map(|(_, handle)| (handle.clone(), stop.as_deref() == Some(key.as_ref())))
            })
        };

        // After the frame: bring the current item into view when it changed or the bar's width
        // did, and a newly focused entry; and draw again once when the layout this render read
        // (the width, the overflow) is not the one the frame laid out, so the reveal and the
        // fades follow a resize. A bar that was not laid out (hidden) does nothing and retries
        // on the next real frame.
        let width = scroll.bounds().size.width;
        let max_px = scroll.max_offset().x;
        let reveal_current = current.clone().filter(|(_, key)| {
            state
                .read(cx)
                .revealed
                .as_ref()
                .is_none_or(|(shown, shown_width)| shown != key || *shown_width != width)
        });
        let reveal_focused = entered.as_deref().and_then(middle_index);
        {
            let (state, scroll) = (state.clone(), scroll.clone());
            window.defer(cx, move |window, cx| {
                let laid_out = scroll.bounds().size.width;
                if laid_out <= px(0.) {
                    return;
                }
                let mut again = laid_out != width || scroll.max_offset().x != max_px;
                if let Some((index, key)) = reveal_current {
                    state.update(cx, |state, _| state.revealed = Some((key, laid_out)));
                    again |= reveal_index(&scroll, index);
                }
                if let Some(index) = reveal_focused {
                    again |= reveal_index(&scroll, index);
                }
                if again {
                    window.refresh();
                }
            });
        }

        let max = f32::from(scroll.max_offset().x);
        let (fade_start, fade_end) = dock_fades(-f32::from(scroll.offset().x), max);
        let surface = sem.role.surface;
        let clear = surface.opacity(0.);
        let fixed = |entries: Vec<DockEntry>| {
            (!entries.is_empty()).then(|| {
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_XS))
                    .children(entries.into_iter().map(|entry| {
                        let focus = focus_of(&entry);
                        entry.render(focus)
                    }))
            })
        };
        let start = fixed(self.start);
        let end = fixed(self.end);
        let middle: Vec<AnyElement> = self
            .items
            .into_iter()
            .map(|entry| {
                let focus = focus_of(&entry);
                entry.render(focus)
            })
            .collect();
        let key_state = state.clone();
        let fade = |left: bool| {
            let (from, to) = if left {
                (surface, clear)
            } else {
                (clear, surface)
            };
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .w(px(DOCK_FADE))
                .when(left, |strip| strip.left_0())
                .when(!left, |strip| strip.right_0())
                .bg(linear_gradient(
                    90.,
                    linear_color_stop(from, 0.),
                    linear_color_stop(to, 1.),
                ))
        };
        let scroller = div()
            .relative()
            .flex_initial()
            .min_w_0()
            .h_full()
            .child(
                div()
                    .id("dock-scroll")
                    .test_support()
                    .h_full()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_XS))
                    .px(px(DOCK_INSET))
                    .overflow_x_scroll()
                    .track_scroll(&scroll)
                    .children(middle),
            )
            .when(fade_start, |scroller| scroller.child(fade(true)))
            .when(fade_end, |scroller| scroller.child(fade(false)));
        let bar = div()
            .id(self.id)
            .test_support()
            .role(Role::Navigation)
            .aria_label(self.label)
            .flex()
            .items_center()
            .justify_center()
            .gap(px(SPACE_XS))
            .max_w_full()
            .h(px(LAYOUT_DOCK))
            .px(px(SPACE_SM))
            .bg(surface)
            .rounded(px(RADIUS_FULL))
            .shadow(shadow(&sem, ShadowKind::Island))
            .on_key_down(move |event, window, cx| {
                let Some(list_event) = key_state.read(cx).focus.event_for(&event.keystroke) else {
                    return;
                };
                // The next render sees the focus move and brings the entry into view.
                if list_key(&key_state, dock_focus, list_event, window, cx).is_some() {
                    cx.stop_propagation();
                }
            })
            .children(start)
            .child(scroller)
            .children(end);
        SurfaceScope::new(Surface::Surface, bar)
    }
}
