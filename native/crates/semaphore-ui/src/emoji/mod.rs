//! W1-ui-emoji: the emoji picker, from `EmojiPicker.tsx` and `emojiData.ts`. Search, the
//! community's custom emoji first, then the unicode categories, with keyboard movement across the
//! grid. The composer and reactions both use it; the owner anchors it in a popover and closes it on
//! `Picked` or `Dismissed`.
//!
//! - `data`: the web's categories and names (`assets/emoji/emoji.json`) and the search over them.
//! - `grid`: arrow, Home/End and Page keys over sections of uneven length.
//!
//! The picker is 300x400 on a desktop, as the web's popover, and fills what it's given on a phone
//! (the web's bottom sheet), with larger cells. Arrows, Page Up/Down, Enter and Escape work while
//! the search field has the caret, so typing and moving don't fight over focus; Home and End stay
//! with the field there and move along the row when the picker itself has focus. Call
//! `focus_search` when the picker opens, as the web's `autoFocus` does.
//!
//! Built-in emoji draw in the system's emoji font, through GPUI's fallback: the app bundles none.

mod data;
mod grid;
#[cfg(feature = "stories")]
mod stories;
#[cfg(test)]
mod tests;

use crate::kit::{Variant, spacing, text};
use crate::messages::{CacheKind, Media, MediaSource, MediaState};
use crate::panel::common::{design_icon, icon_button, is_phone};
use crate::theme::SemTheme;
use data::{Cell, Section, SectionKey, sections};
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{
    Enter, Escape, Input, InputEvent, InputState, MoveDown, MoveLeft, MovePageDown, MovePageUp,
    MoveRight, MoveUp,
};
use gpui_kit::prelude::*;
use gpui_kit::*;
use grid::{COLUMNS, NavKey, Pos};
use semaphore_core::model::EmojiView;
use semaphore_design::Icon as DesignIcon;
use std::rc::Rc;

/// `QUICK_REACTIONS`: the first eight of "Frequently Used".
pub const QUICK_REACTIONS: [&str; 8] = [
    "\u{1F44D}",
    "\u{1F44E}",
    "\u{2764}\u{FE0F}",
    "\u{1F602}",
    "\u{1F62E}",
    "\u{1F622}",
    "\u{1F621}",
    "\u{1F44F}",
];

/// The web popover's size.
const WIDTH: f32 = 300.;
const HEIGHT: f32 = 400.;

/// What the user picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmojiPick {
    Unicode(String),
    Custom { id: String, name: String },
}

impl EmojiPick {
    /// The `emoji` a reaction carries: the character, or `custom:{id}`.
    pub fn reaction_key(&self) -> String {
        match self {
            Self::Unicode(emoji) => emoji.clone(),
            Self::Custom { id, .. } => format!("custom:{id}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmojiPickerEvent {
    Picked(EmojiPick),
    /// Escape, or the owner's popover lost focus.
    Dismissed,
}

pub struct EmojiPicker {
    custom: Vec<EmojiView>,
    #[allow(dead_code)]
    media: Rc<dyn MediaSource>,
    images: Media,
    field: Entity<InputState>,
    query: String,
    sections: Vec<Section>,
    /// The keyboard's cell, by section key so it survives the sections changing under it.
    active: (SectionKey, usize),
    scroll: ScrollHandle,
    focus: FocusHandle,
    _subscriptions: Vec<Subscription>,
}

impl EmojiPicker {
    /// `custom` is the community's emoji (`Core::custom_emojis`), empty outside a community.
    /// `media` loads their images (`MediaSource::emoji`).
    pub fn new(
        custom: Vec<EmojiView>,
        media: Rc<dyn MediaSource>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx).placeholder("Search emojis..."));
        let subscriptions = vec![cx.subscribe_in(&field, window, Self::on_field_event)];
        let images = Media::new(media.clone(), cx);
        let mut picker = Self {
            custom,
            media,
            images,
            field,
            query: String::new(),
            sections: Vec::new(),
            active: (SectionKey::Custom, 0),
            scroll: ScrollHandle::new(),
            focus: cx.focus_handle(),
            _subscriptions: subscriptions,
        };
        picker.refilter();
        picker
    }

    /// The custom emoji changed (`ViewChanged { Mentionables }`).
    pub fn set_custom(&mut self, custom: Vec<EmojiView>, cx: &mut Context<Self>) {
        self.custom = custom;
        self.refilter();
        cx.notify();
    }

    /// Puts the caret in the search field: call it when the picker opens.
    pub fn focus_search(&self, window: &mut Window, cx: &mut App) {
        self.field.update(cx, |field, cx| field.focus(window, cx));
    }

    fn on_field_event(
        &mut self,
        field: &Entity<InputState>,
        event: &InputEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let InputEvent::Change = event {
            let query = field.read(cx).value().to_string();
            self.set_query(&query, cx);
        }
    }

    /// Filters for `query`, as typing it does.
    pub(crate) fn set_query(&mut self, query: &str, cx: &mut Context<Self>) {
        if self.query == query {
            return;
        }
        self.query = query.to_owned();
        self.refilter();
        self.scroll.scroll_to_item(0);
        cx.notify();
    }

    fn refilter(&mut self) {
        self.sections = sections(&self.custom, &self.query);
        // Keep the active cell while it still exists, as the web's effect does; else the first.
        if self.position().is_none() {
            self.active = (
                self.sections
                    .first()
                    .map_or(SectionKey::Custom, |section| section.key.clone()),
                0,
            );
        }
    }

    /// The active cell in the current sections, if there is one.
    fn position(&self) -> Option<Pos> {
        let (key, index) = &self.active;
        let section = self
            .sections
            .iter()
            .position(|section| section.key == *key)?;
        (*index < self.sections[section].cells.len()).then_some(Pos {
            section,
            index: *index,
        })
    }

    pub(crate) fn navigate(&mut self, key: NavKey, cx: &mut Context<Self>) -> bool {
        let Some(current) = self.position() else {
            return false;
        };
        let counts: Vec<usize> = self.sections.iter().map(|s| s.cells.len()).collect();
        let next = grid::next(key, current, &counts, COLUMNS);
        if next != current {
            self.active = (self.sections[next.section].key.clone(), next.index);
            self.scroll.scroll_to_item(self.child_index(next));
            cx.notify();
        }
        true
    }

    /// The scroller's child that holds `pos`: each section is a header and then its rows.
    fn child_index(&self, pos: Pos) -> usize {
        let before: usize = self.sections[..pos.section]
            .iter()
            .map(|section| 1 + grid::rows(section.cells.len(), COLUMNS))
            .sum();
        before + 1 + pos.index / COLUMNS
    }

    fn pick_active(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(pos) = self.position() else {
            return false;
        };
        let cell = self.sections[pos.section].cells[pos.index].clone();
        self.pick(&cell, cx);
        true
    }

    fn pick(&mut self, cell: &Cell, cx: &mut Context<Self>) {
        cx.emit(EmojiPickerEvent::Picked(match cell {
            Cell::Unicode(emoji) => EmojiPick::Unicode(emoji.clone()),
            Cell::Custom(emoji) => EmojiPick::Custom {
                id: emoji.id.clone(),
                name: emoji.name.clone(),
            },
        }));
    }

    #[cfg(test)]
    pub(crate) fn active_cell(&self) -> Option<(String, usize)> {
        let pos = self.position()?;
        Some((self.sections[pos.section].title.clone(), pos.index))
    }

    fn nav_action(&mut self, key: NavKey, cx: &mut Context<Self>) {
        if self.navigate(key, cx) {
            cx.stop_propagation();
        }
    }

    fn on_up(&mut self, _: &MoveUp, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Up, cx);
    }

    fn on_down(&mut self, _: &MoveDown, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Down, cx);
    }

    fn on_left(&mut self, _: &MoveLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Left, cx);
    }

    fn on_right(&mut self, _: &MoveRight, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::Right, cx);
    }

    fn on_page_up(&mut self, _: &MovePageUp, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::PageUp, cx);
    }

    fn on_page_down(&mut self, _: &MovePageDown, _: &mut Window, cx: &mut Context<Self>) {
        self.nav_action(NavKey::PageDown, cx);
    }

    fn on_enter(&mut self, _: &Enter, _: &mut Window, cx: &mut Context<Self>) {
        if self.pick_active(cx) {
            cx.stop_propagation();
        }
    }

    fn on_escape(&mut self, _: &Escape, _: &mut Window, cx: &mut Context<Self>) {
        cx.emit(EmojiPickerEvent::Dismissed);
        cx.stop_propagation();
    }

    /// Keys while the picker itself has focus (the field's keys arrive as its actions above).
    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.field.read(cx).focus_handle(cx).is_focused(window) {
            return;
        }
        let key = event.keystroke.key.as_str();
        if let Some(nav) = NavKey::from_key(key) {
            self.nav_action(nav, cx);
        } else if key == "enter" {
            if self.pick_active(cx) {
                cx.stop_propagation();
            }
        } else if key == "escape" {
            cx.emit(EmojiPickerEvent::Dismissed);
            cx.stop_propagation();
        }
    }

    fn search_field(
        &self,
        touch: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let focused = self.field.read(cx).focus_handle(cx).is_focused(window);
        let (fill, primary, disabled, secondary) = (
            sem.action_hover,
            sem.primary,
            sem.text_disabled,
            sem.text_secondary,
        );
        div()
            .id("emoji-search")
            .h(px(if touch { 44. } else { 36. }))
            .w_full()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(px(12.))
            .rounded(px(8.))
            .bg(fill)
            .border_1()
            .border_color(if focused {
                primary
            } else {
                transparent_black()
            })
            .child(design_icon(DesignIcon::Search, 20., disabled))
            .child(
                div().flex_1().min_w_0().child(
                    Input::new(&self.field)
                        .aria_label("Search emojis")
                        .appearance(false)
                        .px_0()
                        .text_size(px(14.)),
                ),
            )
            .when(!self.query.is_empty(), |frame| {
                frame.child(
                    icon_button(
                        "emoji-search-clear",
                        DesignIcon::Clear,
                        "Clear search",
                        false,
                        secondary,
                        cx,
                    )
                    .size(px(26.))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.field
                            .update(cx, |field, cx| field.set_value("", window, cx));
                        this.set_query("", cx);
                        this.focus_search(window, cx);
                    })),
                )
            })
    }

    fn cell(
        &self,
        cell: &Cell,
        active: bool,
        touch: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let sem = cx.sem();
        let hover = sem.primary.opacity(0.12);
        let selected = sem.action_selected;
        let (fill, secondary) = (sem.action_hover, sem.text_secondary);
        let side = if touch { 44. } else { 32. };
        let (id, label, content): (SharedString, String, AnyElement) = match cell {
            Cell::Unicode(emoji) => (
                format!("emoji-{emoji}").into(),
                data::label(emoji),
                div()
                    .text_size(px(if touch { 28. } else { 20. }))
                    .line_height(px(side))
                    .child(emoji.clone())
                    .into_any_element(),
            ),
            Cell::Custom(emoji) => {
                let size = px(if touch { 24. } else { 18. });
                let media = self.images.source.emoji(&emoji.id);
                let image = match self.images.resolve(media, CacheKind::Small, window, cx) {
                    MediaState::Ready(image) => img(image)
                        .size(size)
                        .object_fit(ObjectFit::Contain)
                        .into_any_element(),
                    MediaState::Loading => {
                        div().size(size).rounded(px(4.)).bg(fill).into_any_element()
                    }
                    MediaState::Failed => div()
                        .size(size)
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(4.))
                        .bg(fill)
                        .text_color(secondary)
                        .child(text(Variant::Caption, "?"))
                        .into_any_element(),
                };
                (
                    format!("emoji-custom-{}", emoji.id).into(),
                    format!(":{}:", emoji.name),
                    image,
                )
            }
        };
        let picked = cell.clone();
        base::Button::new(ElementId::Name(id))
            .accessibility_label(label)
            .selected(active)
            .flex_1()
            .min_w_0()
            .h(px(side))
            .flex()
            .items_center()
            .justify_center()
            .rounded(px(4.))
            .cursor_pointer()
            .when(active, |cell| cell.bg(selected))
            .hover(move |style| style.bg(hover))
            .child(content)
            .on_click(cx.listener(move |this, _, _, cx| this.pick(&picked, cx)))
            .into_any_element()
    }

    /// The scroller's children: per section a header, then its rows of `COLUMNS`.
    fn grid(&self, touch: bool, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let sem = cx.sem();
        let (disabled, secondary) = (sem.text_disabled, sem.text_secondary);
        if self.sections.is_empty() {
            return vec![
                div()
                    .id("emoji-no-results")
                    .test_support()
                    .role(Role::Status)
                    .aria_label("No emojis found")
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .py(spacing(4.))
                    .gap(px(4.))
                    .child(text(Variant::Body2, "No emojis found").text_color(disabled))
                    .child(
                        text(Variant::Caption, "Try a different search term").text_color(secondary),
                    )
                    .into_any_element(),
            ];
        }
        let active = self.position();
        let mut children = Vec::new();
        for (section_index, section) in self.sections.iter().enumerate() {
            children.push(
                div()
                    .flex_shrink_0()
                    .when(section_index > 0, |header| header.mt(spacing(1.5)))
                    .mb(px(6.))
                    .text_color(disabled)
                    .child(
                        text(Variant::Caption, section.title.to_uppercase())
                            .text_size(px(11.))
                            .font_weight(FontWeight(500.)),
                    )
                    .into_any_element(),
            );
            for (row_index, row) in section.cells.chunks(COLUMNS).enumerate() {
                let mut cells: Vec<AnyElement> = row
                    .iter()
                    .enumerate()
                    .map(|(column, cell)| {
                        let index = row_index * COLUMNS + column;
                        let is_active = active
                            == Some(Pos {
                                section: section_index,
                                index,
                            });
                        self.cell(cell, is_active, touch, window, cx)
                    })
                    .collect();
                // A short last row keeps the columns: empty cells fill it out.
                cells.extend(
                    (row.len()..COLUMNS).map(|_| div().flex_1().min_w_0().into_any_element()),
                );
                children.push(
                    div()
                        .flex_shrink_0()
                        .w_full()
                        .flex()
                        .gap(px(2.))
                        .mb(px(2.))
                        .children(cells)
                        .into_any_element(),
                );
            }
        }
        children
    }
}

impl EventEmitter<EmojiPickerEvent> for EmojiPicker {}

impl Focusable for EmojiPicker {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for EmojiPicker {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem();
        let (paper, divider) = (sem.paper, sem.divider);
        let field = self.search_field(touch, window, cx);
        let grid = self.grid(touch, window, cx);
        div()
            .id("emoji-picker")
            .test_support()
            .role(Role::Dialog)
            .aria_label("Emoji picker")
            .track_focus(&self.focus)
            .key_context("EmojiPicker")
            .capture_action(cx.listener(Self::on_up))
            .capture_action(cx.listener(Self::on_down))
            .capture_action(cx.listener(Self::on_left))
            .capture_action(cx.listener(Self::on_right))
            .capture_action(cx.listener(Self::on_page_up))
            .capture_action(cx.listener(Self::on_page_down))
            .capture_action(cx.listener(Self::on_enter))
            .capture_action(cx.listener(Self::on_escape))
            .on_key_down(cx.listener(Self::on_key_down))
            .when(touch, |picker| picker.size_full())
            .when(!touch, |picker| picker.w(px(WIDTH)).h(px(HEIGHT)))
            .flex()
            .flex_col()
            .bg(paper)
            .child(
                div()
                    .flex_shrink_0()
                    .px(px(12.))
                    .pt(px(12.))
                    .pb(spacing(1.))
                    .border_b_1()
                    .border_color(divider)
                    .child(field),
            )
            .child(
                div()
                    .id("emoji-grid")
                    .test_support()
                    .role(Role::Group)
                    .aria_label("Emojis")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll)
                    .flex()
                    .flex_col()
                    .px(px(12.))
                    .py(spacing(1.))
                    .children(grid),
            )
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
