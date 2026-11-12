//! GIFs, wave 7 (lane W7-A): the picker's featured list and search, a page at a time.
//!
//! This file is W7-A's own: its state, its cached values (`GifsValue`, inside `CacheValue::W7`),
//! which views its queries feed and how they are fetched. The shared files only call these, so
//! no other lane edits this file. The W6/W7 freeze left them as stubs. A GIF message is the GIF's
//! URL as the whole text, sent with the ordinary send; `text::gif::lone_gif_url` tells a received
//! one apart, and the message rows carry it (`MessageRow::gif`).

use crate::cache::{CacheValue, QueryKey};
use crate::client::{Core, State};
#[allow(unused_imports)]
use crate::model::{GifResultsView, ViewKey};
use crate::platform::CoreError;
#[allow(unused_imports)]
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;

/// W7-A's query ids: the web's `operationId`s.
pub mod keys {
    pub const FEATURED: &str = "gifsControllerFeatured";
    pub const SEARCH: &str = "gifsControllerSearch";
}

/// W7-A's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct GifsState {}

/// W7-A's cached responses.
#[derive(Debug, Clone)]
pub enum GifsValue {}

pub(crate) fn view_for(_key: &QueryKey) -> Option<ViewKey> {
    None
}

pub(crate) fn key_for(_view: &ViewKey) -> Option<QueryKey> {
    None
}

impl State {
    pub(crate) fn w7_query_changed(&mut self, _key: &QueryKey) -> bool {
        false
    }

    pub(crate) fn w7_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    pub(crate) async fn w7_fetch(&self, _key: &QueryKey) -> Option<Result<CacheValue, CoreError>> {
        None
    }

    /// The featured GIFs for an empty `query`, else the search's results (trimmed).
    pub fn gifs(&self, _query: String) -> GifResultsView {
        GifResultsView::default()
    }

    /// The next page of `gifs(query)`, when `more`.
    pub async fn load_more_gifs(&self, _query: String) -> Result<(), CoreError> {
        Err(unavailable("GIFs"))
    }
}
