//! W1-ui-panels: what the shell's side panel shows, from `PinnedMessagesPanel.tsx`,
//! `MessageSearchPanel.tsx` and `MessageSearch.tsx`. The owner puts a panel's view in
//! `Shell::set_side_panel`; the shell docks it, or draws it as a drawer or a phone layer. Each panel
//! draws its own header with a close button and emits `Close`.
//!
//! P0 stub: the types and signatures are fixed; the second agent fills in the views.

use crate::messages::MediaSource;
use gpui_kit::*;
use semaphore_core::model::{PinnedList, SearchHit};
use std::rc::Rc;

/// The pinned messages of a channel.
pub struct PinsPanel {
    #[allow(dead_code)]
    media: Rc<dyn MediaSource>,
    #[allow(dead_code)]
    pins: PinnedList,
    #[allow(dead_code)]
    can_unpin: bool,
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
    pub fn new(media: Rc<dyn MediaSource>, _cx: &mut Context<Self>) -> Self {
        Self {
            media,
            pins: PinnedList::default(),
            can_unpin: false,
        }
    }

    /// `Core::pinned_messages`, read again on `ViewChanged { Pins }`; `can_unpin` from
    /// `Core::channel_moderation`.
    pub fn set_pins(&mut self, pins: PinnedList, can_unpin: bool, cx: &mut Context<Self>) {
        self.pins = pins;
        self.can_unpin = can_unpin;
        cx.notify();
    }
}

impl EventEmitter<PinsPanelEvent> for PinsPanel {}

impl Render for PinsPanel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().id("pins-panel").size_full()
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
    Close,
}

pub struct SearchPanel {
    #[allow(dead_code)]
    community_scope: bool,
    #[allow(dead_code)]
    results: SearchResults,
    focus: FocusHandle,
}

impl SearchPanel {
    /// `community_scope`: offer "All channels" (false in a DM).
    pub fn new(community_scope: bool, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            community_scope,
            results: SearchResults::Idle,
            focus: cx.focus_handle(),
        }
    }

    /// Results for `query` in `scope`; the panel drops any that aren't for what it shows now.
    pub fn set_results(
        &mut self,
        _scope: SearchScopeChoice,
        _query: String,
        results: SearchResults,
        cx: &mut Context<Self>,
    ) {
        self.results = results;
        cx.notify();
    }
}

impl EventEmitter<SearchPanelEvent> for SearchPanel {}

impl Focusable for SearchPanel {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for SearchPanel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("search-panel")
            .track_focus(&self.focus)
            .size_full()
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
