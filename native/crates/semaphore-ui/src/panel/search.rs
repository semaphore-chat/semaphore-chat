//! The search panel, after the web Lounge's `SearchPanel.tsx`: a kit PanelPane with the field
//! and the scope Tabs fixed at its top, and a ListRow for each result (who wrote it, the channel
//! in a community search, when, and the words on one line). Down from the field goes to the
//! results, Up and Down move between them, and Enter or a press opens one; Enter in the field
//! opens the first.

use super::common::{message_preview, panel_heading, relative_time};
use super::{SearchPanel, SearchPanelEvent, SearchResults, SearchScopeChoice};
use crate::kit::LiveElement as _;
use crate::kit::{
    Avatar, AvatarSize, Button, FieldShape, ListRow, PanelPane, Politeness, RowSize, Skeleton,
    Spinner, Tabs, TextField, Variant, announce, text,
};
use crate::messages::author_name;
use crate::shell::lounge::{Rows, focused};
use crate::theme::SemTheme;
use gpui_kit::accesskit::Live;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::{Enter, Escape, InputEvent, InputState, MoveDown, MoveUp};
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::SearchHit;
use semaphore_design::lounge::{SPACE_MD, SPACE_SM, SPACE_XS};
use semaphore_design::{LoungeIcon, person_colour};
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
            self.chosen = Some(result_id(hit));
            cx.emit(SearchPanelEvent::Jump(Box::new(hit.clone())));
        }
    }

    fn field_focused(&self, window: &Window, cx: &App) -> bool {
        self.field.read(cx).focus_handle(cx).is_focused(window)
    }

    /// Down in the field: the first result takes focus.
    fn on_down(&mut self, _: &MoveDown, window: &mut Window, cx: &mut Context<Self>) {
        if !self.field_focused(window, cx) {
            return;
        }
        if let Some(first) = self.model.hits().first() {
            self.focus_next = Some(result_id(first));
            cx.stop_propagation();
            cx.notify();
        }
    }

    /// Up in the field belongs to the field.
    fn on_up(&mut self, _: &MoveUp, _: &mut Window, _: &mut Context<Self>) {}

    /// An input method has marked text in the field: Enter and Escape are its, to commit or
    /// cancel the composition. The panel does nothing with them, and nothing past it (the
    /// pane's Escape) sees them either.
    fn composing(&self, window: &mut Window, cx: &mut App) -> bool {
        self.field
            .update(cx, |field, cx| field.marked_text_range(window, cx))
            .is_some()
    }

    /// Enter in the field opens the first result.
    fn on_enter(&mut self, _: &Enter, window: &mut Window, cx: &mut Context<Self>) {
        if self.composing(window, cx) {
            cx.stop_propagation();
            return;
        }
        if self.field_focused(window, cx) && !self.model.hits().is_empty() {
            self.jump(0, cx);
            cx.stop_propagation();
        }
    }

    fn on_escape(&mut self, _: &Escape, window: &mut Window, cx: &mut Context<Self>) {
        if self.composing(window, cx) {
            cx.stop_propagation();
            return;
        }
        cx.emit(SearchPanelEvent::Close);
        cx.stop_propagation();
    }

    #[cfg(test)]
    pub(crate) fn model(&self) -> &SearchModel {
        &self.model
    }

    fn top(&self, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let scope = self.model.scope();
        let placeholder = field_placeholder(scope, self.community_scope);
        let view = cx.entity().downgrade();
        let tabs = self.community_scope.then(|| {
            Tabs::new(
                "search-scope",
                vec!["This channel".into(), "All channels".into()],
                match scope {
                    SearchScopeChoice::Here => 0,
                    SearchScopeChoice::Community => 1,
                },
            )
            .segmented()
            .full_width()
            .on_select(move |index, _, cx| {
                let choice = if index == 0 {
                    SearchScopeChoice::Here
                } else {
                    SearchScopeChoice::Community
                };
                view.update(cx, |panel, cx| panel.choose_scope(choice, cx))
                    .ok();
            })
        });
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_SM))
            .child(
                TextField::new("search-field", &self.field, "Search messages")
                    .label_hidden()
                    .shape(FieldShape::Round)
                    .start_icon(LoungeIcon::Search)
                    .placeholder(placeholder),
            )
            .children(tabs)
    }

    fn hit_row(
        &self,
        index: usize,
        hit: &SearchHit,
        community: bool,
        now_ms: i64,
        rows: &Rows,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let row = &hit.row;
        let name = author_name(row);
        let channel = hit.channel_name.clone().filter(|_| community);
        let place = channel
            .as_ref()
            .map(|channel| format!(" · #{channel}"))
            .unwrap_or_default();
        let when = relative_time(now_ms, row.sent_at_ms);
        let words = result_words(hit);
        let mut label = format!("Show the message from {name}");
        if let Some(channel) = &channel {
            label.push_str(&format!(" in #{channel}"));
        }
        if hit.parent_message_id.is_some() {
            label.push_str(", from a thread");
        }
        label.push_str(&format!(": {words}"));
        let id = result_id(hit);
        let view = cx.entity().downgrade();
        let list_row = ListRow::new(
            SharedString::from(id.clone()),
            format!("{name}{place} · {when}"),
        )
        .size(RowSize::Lg)
        .secondary(words)
        .leading(
            Avatar::new(name.clone())
                .colour(person_colour(Some(&row.author.id)))
                .file(row.author.avatar_file_id.as_deref())
                .size(AvatarSize::Md)
                .decorative(true),
        )
        .label(label)
        .on_click(move |_, cx| {
            view.update(cx, |panel, cx| panel.jump(index, cx)).ok();
        });
        focused(list_row, rows, &id, cx)
    }

    fn body(&self, rows: &Rows, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let secondary = cx.sem().text_secondary;
        match self.model.shown() {
            Shown::Idle => vec![
                div()
                    .id("search-idle")
                    .test_support()
                    .child(text(Variant::Body2, "Type to search messages").text_color(secondary))
                    .into_any_element(),
            ],
            Shown::Loading => vec![
                div()
                    .id("search-loading")
                    .test_support()
                    .role(Role::ProgressIndicator)
                    .aria_label("Searching")
                    .flex()
                    .flex_col()
                    .gap(px(SPACE_MD))
                    .children((0..3usize).map(|index| {
                        div()
                            .flex()
                            .gap(px(SPACE_MD))
                            .child(Skeleton::circle(
                                ("search-loading-avatar", index),
                                AvatarSize::Md,
                            ))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .child(Skeleton::text(("search-loading", index), 2)),
                            )
                    }))
                    .into_any_element(),
            ],
            Shown::Failed => vec![
                div()
                    .id("search-failed")
                    .test_support()
                    .role(Role::Alert)
                    .aria_label("Couldn't search messages")
                    .aria_live(Live::Assertive)
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(px(SPACE_SM))
                    .child(text(Variant::Body1, "Couldn't search messages"))
                    .child(
                        Button::new("search-retry", "Try again")
                            .on_click(cx.listener(|this, _, _, cx| this.retry(cx))),
                    )
                    .into_any_element(),
            ],
            Shown::Ready { hits: [], .. } => {
                let here = self.community_scope && self.model.scope() == SearchScopeChoice::Here;
                vec![
                    div()
                        .id("search-empty")
                        .test_support()
                        .flex()
                        .flex_col()
                        .items_start()
                        .gap(px(SPACE_SM))
                        .child(text(Variant::Body1, "No messages found"))
                        .when(here, |block| {
                            block.child(
                                Button::new("search-all", "Search all channels")
                                    .soft()
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.choose_scope(SearchScopeChoice::Community, cx)
                                    })),
                            )
                        })
                        .into_any_element(),
                ]
            }
            Shown::Ready { hits, at_limit } => {
                let community = self.model.scope() == SearchScopeChoice::Community;
                let now = self.clock.now_ms();
                let items: Vec<AnyElement> = hits
                    .iter()
                    .enumerate()
                    .map(|(index, hit)| self.hit_row(index, hit, community, now, rows, cx))
                    .collect();
                let mut out = vec![
                    rows.keys(div().flex().flex_col().gap(px(SPACE_XS)).children(items))
                        .into_any_element(),
                ];
                if self.more_known {
                    if self.loading_more {
                        out.push(
                            div()
                                .id("search-more-loading")
                                .test_support()
                                .role(Role::ProgressIndicator)
                                .aria_label("Loading more results")
                                .py(px(SPACE_SM))
                                .flex()
                                .justify_center()
                                .child(Spinner::new("search-more-spinner"))
                                .into_any_element(),
                        );
                    } else if self.more {
                        out.push(
                            div()
                                .py(px(SPACE_SM))
                                .flex()
                                .justify_center()
                                .child(Button::new("search-more", "More results").soft().on_click(
                                    cx.listener(|_, _, _, cx| cx.emit(SearchPanelEvent::More)),
                                ))
                                .into_any_element(),
                        );
                    }
                } else if at_limit {
                    out.push(
                        div()
                            .id("search-at-limit")
                            .test_support()
                            .role(Role::Status)
                            .aria_label("More results")
                            .py(px(SPACE_SM))
                            .child(
                                text(
                                    Variant::Caption,
                                    format!(
                                        "Showing the newest {} matches. Search for something \
                                         more specific to find older ones.",
                                        hits.len()
                                    ),
                                )
                                .text_color(secondary),
                            )
                            .into_any_element(),
                    );
                }
                out
            }
        }
    }
}

/// A result's row id: the rig and the tests click `search-hit-<message id>`.
pub(crate) fn result_id(hit: &SearchHit) -> String {
    let row = &hit.row;
    format!(
        "search-hit-{}",
        row.id.clone().unwrap_or_else(|| row.seq.to_string())
    )
}

/// A result's words on one line, as the message draws them; "Files" or "No text" without any.
pub(crate) fn result_words(hit: &SearchHit) -> String {
    let words = message_preview(&hit.row, Some(PREVIEW_CHARS));
    if !words.is_empty() {
        words
    } else if !hit.row.attachments.is_empty() {
        "Files".to_owned()
    } else {
        "No text".to_owned()
    }
}

/// The search field's placeholder. `community_scope` false: a DM, which has no channels to choose
/// from and searches "this conversation".
pub(crate) fn field_placeholder(scope: SearchScopeChoice, community_scope: bool) -> &'static str {
    match scope {
        SearchScopeChoice::Here if !community_scope => "Search this conversation",
        SearchScopeChoice::Here => "Search this channel",
        SearchScopeChoice::Community => "Search all channels",
    }
}

/// What a screen reader hears when results arrive, as the web's. `community_scope` false: a DM,
/// "in this conversation".
pub(crate) fn results_announcement(
    count: usize,
    scope: SearchScopeChoice,
    community_scope: bool,
) -> String {
    if count == 0 {
        return "No messages found".to_owned();
    }
    let place = match scope {
        SearchScopeChoice::Here if !community_scope => "in this conversation",
        SearchScopeChoice::Here => "in this channel",
        SearchScopeChoice::Community => "in all channels",
    };
    if count == 1 {
        format!("1 message found {place}")
    } else {
        format!("{count} messages found {place}")
    }
}

impl Render for SearchPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(words) = self.announce.take() {
            announce(words, Politeness::Polite, window, cx);
        }
        let header = panel_heading(
            "search-heading",
            "Search messages",
            "search-close",
            "Close search",
            cx.listener(|_, _, _, cx| cx.emit(SearchPanelEvent::Close)),
        );
        let hits = self.model.hits().to_vec();
        let rows = Rows::new(
            "search-rows",
            hits.iter()
                .map(|hit| (result_id(hit), result_words(hit)))
                .collect(),
            self.chosen.clone(),
            Some(self.scroll.clone()),
            window,
            cx,
        );
        if let Some(id) = self.focus_next.take() {
            match rows.focus(&id) {
                Some((handle, _)) => window.focus(&handle, cx),
                // Not listed (yet): the field keeps it.
                None => self.focus_field(window, cx),
            }
        }
        let top = self.top(cx);
        let body = self.body(&rows, cx);
        let field = self.field.clone();
        div()
            .id("search-panel")
            .test_support()
            .track_focus(&self.focus)
            .key_context("SearchPanel")
            .capture_action(cx.listener(Self::on_up))
            .capture_action(cx.listener(Self::on_down))
            .capture_action(cx.listener(Self::on_enter))
            .capture_action(cx.listener(Self::on_escape))
            .on_key_down(cx.listener(move |_, event: &KeyDownEvent, window, cx| {
                // A result or a tab has focus: Escape closes the panel, as in the field.
                if event.keystroke.key == "escape"
                    && !field.read(cx).focus_handle(cx).is_focused(window)
                {
                    cx.emit(SearchPanelEvent::Close);
                    cx.stop_propagation();
                }
            }))
            .size_full()
            .child(
                PanelPane::new("search-pane", header)
                    .top(top)
                    .track_scroll(&self.scroll)
                    .list_label("Search results")
                    .children(body),
            )
    }
}
