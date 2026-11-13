//! The search panel, after `MessageSearchPanel.tsx`, `MessageSearch.tsx` and
//! `MessageSearchResults.tsx`.

use super::common::{
    design_icon, error_block, icon_button, is_phone, panel_header, preview_text, relative_time,
};
use super::{SearchPanel, SearchPanelEvent, SearchResults, SearchScopeChoice};
use crate::kit::{Button, Spinner, Variant, spacing, text};
use crate::theme::SemTheme;
use gpui_kit::base;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{Enter, Escape, Input, InputEvent, InputState, MoveDown, MoveUp};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::SearchHit;
use semaphore_design::Icon as DesignIcon;
use std::time::Duration;

/// `useDebounce(query, 300)`.
pub(crate) const DEBOUNCE: Duration = Duration::from_millis(300);
/// `getMessagePreview`'s cut.
const PREVIEW_CHARS: usize = 100;

/// What was typed, what was asked, and what came back for it. No GPUI, so it can be tested alone.
#[derive(Debug, Default)]
pub(crate) struct SearchModel {
    typed: String,
    scope: SearchScopeChoice,
    /// The last search the panel emitted: the only one whose results it takes.
    asked: Option<(SearchScopeChoice, String)>,
    results: SearchResults,
}

/// What the results area shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Shown<'a> {
    /// Nothing typed: the hint.
    Idle,
    /// Typed but not yet asked (the debounce is pending), or asked and not yet answered.
    Loading,
    Failed,
    Ready {
        hits: &'a [SearchHit],
        at_limit: bool,
    },
}

impl SearchModel {
    pub fn scope(&self) -> SearchScopeChoice {
        self.scope
    }

    fn query(&self) -> &str {
        self.typed.trim()
    }

    /// The field changed. True when the debounce should start again: there is something new to
    /// ask. An empty query asks nothing and shows the hint at once.
    pub fn set_text(&mut self, text: &str) -> bool {
        self.typed = text.to_owned();
        if self.query().is_empty() {
            self.asked = None;
            self.results = SearchResults::Idle;
            return false;
        }
        !self.is_asked()
    }

    fn is_asked(&self) -> bool {
        self.asked
            .as_ref()
            .is_some_and(|(scope, query)| *scope == self.scope && query == self.query())
    }

    /// Asks for what's typed now, unless that's already what was asked.
    fn ask(&mut self) -> Option<SearchPanelEvent> {
        if self.query().is_empty() || self.is_asked() {
            return None;
        }
        let query = self.query().to_owned();
        self.asked = Some((self.scope, query.clone()));
        self.results = SearchResults::Loading;
        Some(SearchPanelEvent::Search {
            scope: self.scope,
            query,
        })
    }

    /// The debounce ran out.
    pub fn debounce_elapsed(&mut self) -> Option<SearchPanelEvent> {
        self.ask()
    }

    /// The toggle changed: search again at once, as the web's query key changes.
    pub fn set_scope(&mut self, scope: SearchScopeChoice) -> Option<SearchPanelEvent> {
        if scope == self.scope {
            return None;
        }
        self.scope = scope;
        self.ask()
    }

    /// "Try again" after a failure: the same search again.
    pub fn retry(&mut self) -> Option<SearchPanelEvent> {
        if !matches!(self.results, SearchResults::Failed { .. }) {
            return None;
        }
        let (scope, query) = self.asked.clone()?;
        self.results = SearchResults::Loading;
        Some(SearchPanelEvent::Search { scope, query })
    }

    /// Takes results only for the search last asked; anything older or for the other scope is
    /// dropped. True when they were taken.
    pub fn accept(
        &mut self,
        scope: SearchScopeChoice,
        query: &str,
        results: SearchResults,
    ) -> bool {
        let current = self
            .asked
            .as_ref()
            .is_some_and(|(asked_scope, asked)| *asked_scope == scope && asked == query);
        if current && self.is_asked() {
            self.results = results;
            true
        } else {
            false
        }
    }

    pub fn shown(&self) -> Shown<'_> {
        if self.query().is_empty() {
            return Shown::Idle;
        }
        if !self.is_asked() {
            return Shown::Loading;
        }
        match &self.results {
            SearchResults::Idle | SearchResults::Loading => Shown::Loading,
            SearchResults::Failed { .. } => Shown::Failed,
            SearchResults::Ready { hits, at_limit } => Shown::Ready {
                hits,
                at_limit: *at_limit,
            },
        }
    }

    pub fn hits(&self) -> &[SearchHit] {
        match self.shown() {
            Shown::Ready { hits, .. } => hits,
            _ => &[],
        }
    }
}

impl SearchPanel {
    pub(super) fn on_field_event(
        &mut self,
        field: &Entity<InputState>,
        event: &InputEvent,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let InputEvent::Change = event {
            let text = field.read(cx).value().to_string();
            self.query_changed(&text, cx);
        }
    }

    /// The field's text changed: (re)start the debounce, or settle at once on an empty query.
    pub(crate) fn query_changed(&mut self, text: &str, cx: &mut Context<Self>) {
        self.selected = 0;
        if self.model.set_text(text) {
            self.debounce = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(DEBOUNCE).await;
                this.update(cx, |this, cx| {
                    this.debounce = None;
                    if let Some(event) = this.model.debounce_elapsed() {
                        cx.emit(event);
                    }
                    cx.notify();
                })
                .ok();
            }));
        } else {
            self.debounce = None;
        }
        cx.notify();
    }

    pub(crate) fn choose_scope(&mut self, scope: SearchScopeChoice, cx: &mut Context<Self>) {
        if let Some(event) = self.model.set_scope(scope) {
            // The search that just went out covers anything the debounce was waiting to ask.
            self.debounce = None;
            self.selected = 0;
            cx.emit(event);
        }
        cx.notify();
    }

    fn retry(&mut self, cx: &mut Context<Self>) {
        if let Some(event) = self.model.retry() {
            cx.emit(event);
        }
        cx.notify();
    }

    fn jump(&mut self, index: usize, cx: &mut Context<Self>) {
        if let Some(hit) = self.model.hits().get(index) {
            cx.emit(SearchPanelEvent::Jump(Box::new(hit.clone())));
        }
    }

    fn move_selection(&mut self, down: bool, cx: &mut Context<Self>) -> bool {
        let count = self.model.hits().len();
        if count == 0 {
            return false;
        }
        self.selected = if down {
            (self.selected + 1).min(count - 1)
        } else {
            self.selected.saturating_sub(1)
        };
        self.scroll.scroll_to_item(self.selected);
        cx.notify();
        true
    }

    fn on_up(&mut self, _: &MoveUp, _: &mut Window, cx: &mut Context<Self>) {
        if self.move_selection(false, cx) {
            cx.stop_propagation();
        }
    }

    fn on_down(&mut self, _: &MoveDown, _: &mut Window, cx: &mut Context<Self>) {
        if self.move_selection(true, cx) {
            cx.stop_propagation();
        }
    }

    fn on_enter(&mut self, _: &Enter, _: &mut Window, cx: &mut Context<Self>) {
        if !self.model.hits().is_empty() {
            self.jump(self.selected, cx);
            cx.stop_propagation();
        }
    }

    fn on_escape(&mut self, _: &Escape, _: &mut Window, cx: &mut Context<Self>) {
        cx.emit(SearchPanelEvent::Close);
        cx.stop_propagation();
    }

    #[cfg(test)]
    pub(crate) fn model(&self) -> &SearchModel {
        &self.model
    }

    #[cfg(test)]
    pub(crate) fn selected(&self) -> usize {
        self.selected
    }

    fn field(
        &self,
        touch: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let focused = self.field.read(cx).focus_handle(cx).is_focused(window);
        let empty = self.field.read(cx).value().is_empty();
        let border = if focused {
            sem.input_border_focused
        } else {
            sem.input_border
        };
        let secondary = sem.text_secondary;
        div()
            .id("search-field")
            .h(px(if touch { 48. } else { 40. }))
            .w_full()
            .flex()
            .items_center()
            .gap(spacing(1.))
            .px(px(if focused { 11. } else { 12. }))
            .rounded(px(4.))
            .border_1()
            .when(focused, |frame| frame.border_2())
            .border_color(border)
            .child(design_icon(DesignIcon::Search, 20., secondary))
            .child(
                div().flex_1().min_w_0().child(
                    Input::new(&self.field)
                        .aria_label("Search messages")
                        .appearance(false)
                        .px_0()
                        .text_size(px(14.)),
                ),
            )
            .when(!empty, |frame| {
                frame.child(
                    icon_button(
                        "search-clear",
                        DesignIcon::Close,
                        "Clear search",
                        false,
                        secondary,
                        cx,
                    )
                    .size(px(28.))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.field
                            .update(cx, |field, cx| field.set_value("", window, cx));
                        this.query_changed("", cx);
                        this.focus_field(window, cx);
                    })),
                )
            })
    }

    fn scope_toggle(&self, touch: bool, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let scope = self.model.scope();
        let (border, selected_bg, selected_fg, idle_fg, hover) = (
            sem.divider,
            sem.action_selected,
            sem.text_primary,
            sem.text_secondary,
            sem.action_hover,
        );
        let segment = |id: &'static str, label: &'static str, choice: SearchScopeChoice| {
            let on = scope == choice;
            base::Button::new(id)
                .accessibility_label(label)
                .selected(on)
                .flex_1()
                .h(px(if touch { 44. } else { 32. }))
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .when(on, |button| button.bg(selected_bg))
                .when(!on, |button| button.hover(move |style| style.bg(hover)))
                .text_color(if on { selected_fg } else { idle_fg })
                .child(text(Variant::Button, label).text_size(px(13.)))
                .on_click(cx.listener(move |this, _, _, cx| this.choose_scope(choice, cx)))
        };
        div()
            .id("search-scope")
            .test_support()
            .role(Role::RadioGroup)
            .aria_label("Search scope")
            .w_full()
            .flex()
            .rounded(px(4.))
            .border_1()
            .border_color(border)
            .overflow_hidden()
            .child(segment(
                "scope-here",
                "This Channel",
                SearchScopeChoice::Here,
            ))
            .child(div().w(px(1.)).h_full().bg(border))
            .child(segment(
                "scope-community",
                "All Channels",
                SearchScopeChoice::Community,
            ))
    }

    /// The scroller's children: the rows are its direct children, so `scroll_to_item` finds them.
    fn results(&self, touch: bool, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let sem = cx.sem();
        let secondary = sem.text_secondary;
        let line = |label: &'static str| {
            div()
                .py(spacing(2.))
                .flex()
                .justify_center()
                .text_color(secondary)
                .child(text(Variant::Body2, label))
                .into_any_element()
        };
        match self.model.shown() {
            Shown::Idle => vec![line("Type to search messages")],
            Shown::Loading => vec![
                div()
                    .id("search-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Searching")
                    .py(spacing(2.))
                    .flex()
                    .justify_center()
                    .child(Spinner::new("search-spinner").size(24.))
                    .into_any_element(),
            ],
            Shown::Failed => vec![
                error_block(
                    "search-retry",
                    "Couldn't search messages",
                    "Check your connection and try again.",
                    cx.listener(|this, _, _, cx| this.retry(cx)),
                    cx,
                )
                .into_any_element(),
            ],
            Shown::Ready { hits: [], .. } => vec![line("No messages found")],
            Shown::Ready { hits, at_limit } => {
                let community = self.model.scope() == SearchScopeChoice::Community;
                let now = self.clock.now_ms();
                let mut rows: Vec<AnyElement> = hits
                    .iter()
                    .enumerate()
                    .map(|(index, hit)| {
                        self.hit_row(index, hit, community, now, touch, cx)
                            .into_any_element()
                    })
                    .collect();
                if self.more_known {
                    if self.loading_more {
                        rows.push(
                            div()
                                .id("search-more-loading")
                                .flex_shrink_0()
                                .test_support()
                                .role(Role::ProgressIndicator)
                                .aria_label("Loading more results")
                                .py(spacing(2.))
                                .flex()
                                .justify_center()
                                .child(Spinner::new("search-more-spinner").size(24.))
                                .into_any_element(),
                        );
                    } else if self.more {
                        rows.push(
                            div()
                                .flex_shrink_0()
                                .py(spacing(1.))
                                .flex()
                                .justify_center()
                                .child(
                                    Button::new("search-more", "More results")
                                        .outlined()
                                        .on_click(cx.listener(|_, _, _, cx| {
                                            cx.emit(SearchPanelEvent::More)
                                        })),
                                )
                                .into_any_element(),
                        );
                    }
                } else if at_limit {
                    rows.push(
                        div()
                            .id("search-at-limit")
                            .flex_shrink_0()
                            .test_support()
                            .role(Role::Status)
                            .aria_label("More results")
                            .px(spacing(1.))
                            .py(spacing(1.5))
                            .text_color(secondary)
                            .child(
                                text(
                                    Variant::Caption,
                                    format!(
                                        "Showing the newest {} matches. Search for something \
                                         more specific to find older ones.",
                                        hits.len()
                                    ),
                                )
                                .text_center(),
                            )
                            .into_any_element(),
                    );
                }
                rows
            }
        }
    }

    fn hit_row(
        &self,
        index: usize,
        hit: &SearchHit,
        community: bool,
        now_ms: i64,
        touch: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let sem = cx.sem();
        let row = &hit.row;
        let author = row
            .author
            .display_name
            .clone()
            .unwrap_or_else(|| row.author.username.clone());
        let when = relative_time(now_ms, row.sent_at_ms);
        let preview = preview_text(&row.display, Some(PREVIEW_CHARS));
        let selected = index == self.selected;
        let channel = hit.channel_name.clone().filter(|_| community);
        let in_thread = hit.parent_message_id.is_some();
        let (chip_bg, primary, secondary, hover, selected_bg) = (
            sem.action_hover,
            sem.text_primary,
            sem.text_secondary,
            sem.action_hover,
            sem.action_selected,
        );
        let tint = sem.primary.opacity(if sem.is_dark { 0.2 } else { 0.12 });
        let accent = sem.primary;
        let mut label = format!("{author}, {when}");
        if let Some(channel) = &channel {
            label.push_str(&format!(", in #{channel}"));
        }
        if in_thread {
            label.push_str(", from a thread");
        }
        label.push_str(": ");
        label.push_str(&preview);
        let id = row.id.clone().unwrap_or_else(|| row.seq.to_string());
        base::Button::new(ElementId::Name(format!("search-hit-{id}").into()))
            .accessibility_label(label)
            .selected(selected)
            .w_full()
            .flex_shrink_0()
            .px(spacing(2.))
            .py(spacing(if touch { 1.25 } else { 1. }))
            .when(touch, |row| row.min_h(px(56.)))
            .flex()
            .flex_col()
            .items_start()
            .rounded(px(4.))
            .cursor_pointer()
            .when(selected, |row| row.bg(selected_bg))
            .when(!selected, |row| row.hover(move |style| style.bg(hover)))
            .focus_visible(move |style| style.bg(selected_bg))
            .child(
                div()
                    .w_full()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(spacing(1.))
                    .mb(px(4.))
                    .child(
                        text(Variant::Caption, author)
                            .font_weight(FontWeight(600.))
                            .text_color(primary)
                            .flex_shrink_0()
                            .max_w(relative(0.4))
                            .truncate(),
                    )
                    .children(channel.map(|channel| {
                        text(Variant::Caption, format!("#{channel}"))
                            .bg(chip_bg)
                            .text_color(primary)
                            .px(px(6.))
                            .py(px(2.))
                            .rounded(px(4.))
                            .max_w(relative(0.4))
                            .min_w(px(40.))
                            .truncate()
                    }))
                    .when(in_thread, |line| {
                        line.child(
                            div()
                                .flex()
                                .flex_shrink_0()
                                .items_center()
                                .gap(px(2.))
                                .px(px(6.))
                                .py(px(2.))
                                .rounded(px(4.))
                                .bg(tint)
                                .text_color(accent)
                                .child(design_icon(DesignIcon::ChatBubbleOutline, 12., accent))
                                .child(text(Variant::Caption, "from a thread")),
                        )
                    })
                    .child(
                        text(Variant::Caption, when)
                            .text_color(secondary)
                            .flex_shrink_0()
                            .whitespace_nowrap(),
                    ),
            )
            .child(
                text(Variant::Body2, preview)
                    .w_full()
                    .text_color(secondary)
                    .line_clamp(2)
                    .text_ellipsis(),
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                this.selected = index;
                this.jump(index, cx);
            }))
    }
}

impl Render for SearchPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let touch = is_phone(window);
        let sem = cx.sem();
        let (paper, secondary) = (sem.paper, sem.text_secondary);
        let close = icon_button(
            "search-close",
            DesignIcon::Close,
            "Close search",
            touch,
            secondary,
            cx,
        )
        .on_click(cx.listener(|_, _, _, cx| cx.emit(SearchPanelEvent::Close)))
        .into_any_element();
        let header = panel_header(DesignIcon::Search, "Search", None, vec![close], touch, cx);
        let field = self.field(touch, window, cx);
        let toggle = self
            .community_scope
            .then(|| self.scope_toggle(touch, cx).into_any_element());
        let results = self.results(touch, cx);
        div()
            .id("search-panel")
            .test_support()
            .role(Role::Complementary)
            .aria_label("Search")
            .track_focus(&self.focus)
            .key_context("SearchPanel")
            .capture_action(cx.listener(Self::on_up))
            .capture_action(cx.listener(Self::on_down))
            .capture_action(cx.listener(Self::on_enter))
            .capture_action(cx.listener(Self::on_escape))
            .size_full()
            .flex()
            .flex_col()
            .bg(paper)
            .child(header)
            .child(
                div()
                    .flex_shrink_0()
                    .flex()
                    .flex_col()
                    .gap(spacing(1.))
                    .px(spacing(2.))
                    .pt(spacing(2.))
                    .pb(spacing(1.))
                    .child(field)
                    .children(toggle),
            )
            .child(
                div()
                    .id("search-scroll")
                    .flex_1()
                    .min_h_0()
                    .test_support()
                    .role(Role::List)
                    .aria_label("Search results")
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll)
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .px(spacing(1.))
                    .pb(spacing(2.))
                    .children(results),
            )
    }
}
