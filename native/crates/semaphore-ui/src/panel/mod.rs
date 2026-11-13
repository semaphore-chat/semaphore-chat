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

use crate::messages::{Media, MediaSource};
use gpui_kit::component::input::InputState;
use gpui_kit::*;
use search::SearchModel;
use semaphore_core::model::{PinnedList, SearchHit};
use std::rc::Rc;

/// The pinned messages of a channel.
pub struct PinsPanel {
    #[allow(dead_code)]
    media: Rc<dyn MediaSource>,
    pins: PinnedList,
    can_unpin: bool,
    images: Media,
    clock: PanelClock,
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
    pub fn new(media: Rc<dyn MediaSource>, cx: &mut Context<Self>) -> Self {
        let images = Media::new(media.clone(), cx);
        Self {
            media,
            pins: PinnedList::default(),
            can_unpin: false,
            images,
            clock: PanelClock::default(),
        }
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
    /// The keyboard-highlighted hit, as the web's `selectedIndex`.
    selected: usize,
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
            selected: 0,
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
        if self.model.accept(scope, &query, results) {
            self.selected = 0;
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
