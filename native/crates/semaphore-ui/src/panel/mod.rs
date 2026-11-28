//! W1-ui-panels: what the shell's side panel shows, from `PinnedMessagesPanel.tsx`,
//! `MessageSearchPanel.tsx` and `MessageSearch.tsx`. The owner puts a panel's view in
//! `Shell::set_side_panel`; the shell docks it, or draws it as a drawer or a phone layer. Each panel
//! draws its own header with a close button and emits `Close`.
//!
//! - `common`: the header, empty and error blocks and relative times, shared with the thread pane.
//! - `pins`: the pinned messages list.
//! - `search`: the search field, the scope toggle and the results, over `SearchModel`, which holds
//!   what was typed, what was asked and what came back, with no GPUI in it.

pub(crate) mod common;
mod pins;
mod search;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;

pub use common::PanelClock;

use gpui_kit::component::input::InputState;
use gpui_kit::*;
use search::SearchModel;
use semaphore_core::model::{PinnedList, SearchHit};

/// The pinned messages of a channel.
pub struct PinsPanel {
    pins: PinnedList,
    can_unpin: bool,
    clock: PanelClock,
    scroll: ScrollHandle,
    focus: FocusHandle,
    /// The pin Unpin was pressed on, and where it was: focus goes to its neighbour once it's gone.
    unpinned: Option<(String, usize)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PinsPanelEvent {
    /// A pin was clicked. For a thread reply `parent_message_id` is its parent.
    Jump {
        message_id: String,
        parent_message_id: Option<String>,
    },
    /// Only offered when `can_unpin`.
    Unpin {
        message_id: String,
    },
    /// The list failed and the user asked again.
    Retry,
    Close,
}

impl PinsPanel {
    pub fn new(cx: &mut Context<Self>) -> Self {
        Self {
            pins: PinnedList::default(),
            can_unpin: false,
            clock: PanelClock::default(),
            scroll: ScrollHandle::new(),
            focus: cx.focus_handle(),
            unpinned: None,
        }
    }

    /// Moves focus into the panel, as the web's panel does when it opens: its first pin, else
    /// the panel itself.
    pub fn focus_in(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus, cx);
    }

    /// `Core::pinned_messages`, read again on `ViewChanged { Pins }`; `can_unpin` from
    /// `Core::channel_moderation`.
    pub fn set_pins(&mut self, pins: PinnedList, can_unpin: bool, cx: &mut Context<Self>) {
        self.pins = pins;
        self.can_unpin = can_unpin;
        cx.notify();
    }

    /// What "5 minutes ago" is measured from. The real clock unless a story fixes it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }
}

impl EventEmitter<PinsPanelEvent> for PinsPanel {}

impl Focusable for PinsPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

/// The web's scope toggle: "This channel" (or this DM) and "All channels".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum SearchScopeChoice {
    #[default]
    Here,
    Community,
}

/// What a search found, for the query it was asked with.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum SearchResults {
    /// Nothing asked yet (an empty query).
    #[default]
    Idle,
    Loading,
    Failed {
        message: String,
    },
    /// Newest first. `at_limit`: the server returned as many as asked for, so there may be more.
    Ready {
        hits: Vec<SearchHit>,
        at_limit: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchPanelEvent {
    /// Debounced 300 ms after typing stops, as the web's `useDebounce`, and at once when the scope
    /// changes. The owner calls `Core::search_messages` and answers with `set_results` for this
    /// same `query` and `scope`.
    Search {
        scope: SearchScopeChoice,
        query: String,
    },
    /// A hit was clicked.
    Jump(Box<SearchHit>),
    /// U-freeze (US2): "More results": `Core::load_more_search(scope, query)`. Offered with
    /// `set_more`.
    More,
    Close,
}

pub struct SearchPanel {
    community_scope: bool,
    model: SearchModel,
    field: Entity<InputState>,
    /// The pending debounce; replacing it cancels the one before.
    debounce: Option<Task<()>>,
    /// The result last opened: the list's Tab stop, and where focus goes back to.
    chosen: Option<String>,
    /// A result to move focus to in the next frame, once its row's handle exists.
    focus_next: Option<String>,
    /// What to announce in the next frame: how many results came back.
    announce: Option<String>,
    scroll: ScrollHandle,
    clock: PanelClock,
    focus: FocusHandle,
    /// US2: `SearchResultsView::more` and `loading_more`; `more` is known only once core answered.
    more: bool,
    more_known: bool,
    loading_more: bool,
    _subscriptions: Vec<Subscription>,
}

impl SearchPanel {
    /// U-freeze (US2): whether the results have more (`SearchResultsView::more`) and a page is
    /// on its way (`loading_more`). Drawn by US2; until then nothing shows.
    pub fn set_more(&mut self, more: bool, loading_more: bool, cx: &mut Context<Self>) {
        if !self.more_known || self.more != more || self.loading_more != loading_more {
            self.more = more;
            self.more_known = true;
            self.loading_more = loading_more;
            cx.notify();
        }
    }

    /// `community_scope`: offer "All channels" (false in a DM).
    pub fn new(community_scope: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = cx.new(|cx| InputState::new(window, cx).placeholder("Search messages..."));
        let subscriptions = vec![cx.subscribe_in(&field, window, Self::on_field_event)];
        Self {
            community_scope,
            model: SearchModel::default(),
            field,
            debounce: None,
            chosen: None,
            focus_next: None,
            announce: None,
            scroll: ScrollHandle::new(),
            clock: PanelClock::default(),
            focus: cx.focus_handle(),
            more: false,
            more_known: false,
            loading_more: false,
            _subscriptions: subscriptions,
        }
    }

    /// Results for `query` in `scope`; the panel drops any that aren't for what it shows now.
    pub fn set_results(
        &mut self,
        scope: SearchScopeChoice,
        query: String,
        results: SearchResults,
        cx: &mut Context<Self>,
    ) {
        let ready = match &results {
            SearchResults::Ready { hits, .. } => Some(hits.len()),
            _ => None,
        };
        let before = matches!(self.model.shown(), search::Shown::Ready { .. })
            .then(|| self.model.hits().len());
        if self.model.accept(scope, &query, results) {
            // Once per answer: core sends the same page again on every change to its view.
            if let Some(count) = ready
                && before != Some(count)
            {
                self.announce = Some(search::results_announcement(count, scope));
            }
            cx.notify();
        }
    }

    /// What "5 minutes ago" is measured from. The real clock unless a story fixes it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    /// The hits shown now, newest first.
    pub fn hits(&self) -> &[SearchHit] {
        self.model.hits()
    }

    /// Focus back on the result `message_id` was opened from (a thread over the search closed),
    /// or the field when it is no longer listed.
    pub fn focus_result(&mut self, message_id: &str, cx: &mut Context<Self>) {
        let id = format!("search-hit-{message_id}");
        self.chosen = Some(id.clone());
        self.focus_next = Some(id);
        cx.notify();
    }

    /// Puts the caret in the search field, as the web does when the panel opens.
    pub fn focus_field(&self, window: &mut Window, cx: &mut App) {
        self.field.update(cx, |field, cx| field.focus(window, cx));
    }
}

impl EventEmitter<SearchPanelEvent> for SearchPanel {}

impl Focusable for SearchPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
