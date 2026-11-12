//! GIFs, wave 7 (lane W7-A): the picker's featured list and search, a page at a time.
//!
//! This file is W7-A's own: its state, its cached values (`GifsValue`, inside `CacheValue::W7`),
//! which views its queries feed and how they are fetched. The shared files only call these, so
//! no other lane edits this file. A GIF message is the GIF's URL as the whole text, sent with the
//! ordinary send; `text::gif::lone_gif_url` tells a received one apart, and the message rows carry
//! it (`MessageRow::gif`).
//!
//! No socket event covers a GIF list, so a view reads when shown, again when shown
//! (`keys::RECONNECT` lists the queries a new connection reads) and after this user's own paging.
//! Neither list ages on its own. Nothing here loads an image: the results carry URLs, and the app
//! decides when to fetch them.

use std::collections::HashSet;
use std::num::NonZeroU64;

use crate::cache::{CacheValue, QueryKey, keys as cache_keys};
use crate::client::{Core, State};
use crate::model::{GifResultsView, GifView, LoadState, ViewKey};
use crate::platform::CoreError;
use crate::resync::unavailable;
use semaphore_wire::events::ServerEvent;
use semaphore_wire::types as wire;

/// W7-A's query ids: the web's `operationId`s.
pub mod keys {
    pub const FEATURED: &str = "gifsControllerFeatured";
    pub const SEARCH: &str = "gifsControllerSearch";

    /// What a new connection reads again: neither query has a socket event.
    pub const RECONNECT: &[&str] = &[FEATURED, SEARCH];
}

/// How many results one page asks for: the DTO's default (`DEFAULT_GIF_LIMIT`).
const PAGE: u64 = 20;
/// `MAX_QUERY_LENGTH` in `giphy.provider.ts`: a longer search is sent cut to its first 50
/// characters.
const MAX_QUERY_CHARS: usize = 50;

/// W7-A's state: gone at sign-out.
#[derive(Debug, Default)]
pub struct GifsState {
    /// The keys loading their next page.
    pub(crate) loading_more: HashSet<QueryKey>,
}

/// W7-A's cached responses.
#[derive(Debug, Clone)]
pub enum GifsValue {
    Page {
        results: Vec<wire::GifResultDto>,
        next: Option<String>,
    },
}

/// The key a trimmed query reads: the featured list for an empty one, else the search.
fn key_of(query: &str) -> QueryKey {
    if query.is_empty() {
        cache_keys::op(keys::FEATURED)
    } else {
        cache_keys::scoped(keys::SEARCH, query)
    }
}

/// The text a search sends: its first [`MAX_QUERY_CHARS`] characters, as the server cuts it.
fn sent_query(query: &str) -> String {
    match query.char_indices().nth(MAX_QUERY_CHARS) {
        Some((end, _)) => query[..end].to_owned(),
        None => query.to_owned(),
    }
}

fn gif_view(gif: &wire::GifResultDto) -> GifView {
    // A provider's size is untrusted: a negative one is 0, a huge one the largest it can be.
    let extent = |value: i64| value.clamp(0, u32::MAX as i64) as u32;
    GifView {
        id: gif.id.clone(),
        title: gif.title.clone(),
        url: gif.url.clone(),
        preview_url: gif.preview_url.clone(),
        width: extent(gif.width),
        height: extent(gif.height),
    }
}

/// The view a W7-A query feeds (`commands::view_for` asks here for what it doesn't know).
pub(crate) fn view_for(key: &QueryKey) -> Option<ViewKey> {
    match key.op() {
        keys::FEATURED => Some(ViewKey::Gifs {
            query: String::new(),
        }),
        keys::SEARCH => Some(ViewKey::Gifs {
            query: key.segments.get(1).cloned().unwrap_or_default(),
        }),
        _ => None,
    }
}

/// The query behind a W7-A view, the reverse of [`view_for`].
pub(crate) fn key_for(view: &ViewKey) -> Option<QueryKey> {
    let ViewKey::Gifs { query } = view else {
        return None;
    };
    Some(key_of(query.trim()))
}

impl State {
    /// The cached page behind `key`, when it has one.
    fn w7_page(&self, key: &QueryKey) -> Option<&GifsValue> {
        match self.cache.get(key).map(|entry| &entry.value) {
            Some(CacheValue::W7(value)) => Some(value),
            _ => None,
        }
    }

    /// Changes the cached page's results and cursor, as a direct update.
    fn w7_edit<R>(
        &mut self,
        key: &QueryKey,
        change: impl FnOnce(&mut Vec<wire::GifResultDto>, &mut Option<String>) -> R,
    ) -> Option<R> {
        // A fetch already on its way answers from before this edit.
        self.note_direct_update(key);
        let entry = self.cache.get_mut(key)?;
        let CacheValue::W7(GifsValue::Page { results, next }) = &mut entry.value else {
            return None;
        };
        Some(change(results, next))
    }

    /// A W7-A query's data changed: say which view reads it. False when it isn't W7-A's.
    pub(crate) fn w7_query_changed(&mut self, key: &QueryKey) -> bool {
        let Some(view) = view_for(key) else {
            return false;
        };
        self.view_changed(view);
        true
    }

    pub(crate) fn w7_event(&mut self, _event: &ServerEvent, _now: u64) {}
}

impl Core {
    pub(crate) async fn w7_fetch(&self, key: &QueryKey) -> Option<Result<CacheValue, CoreError>> {
        view_for(key)?;
        Some(self.w7_fetch_value(key).await)
    }

    /// The first page of a W7-A query.
    async fn w7_fetch_value(&self, key: &QueryKey) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        let limit = NonZeroU64::new(PAGE);
        let page = match key.op() {
            keys::FEATURED => backend
                .gifs_controller_featured(limit, None)
                .await
                .map_err(|error| self.backend_failed(error))?,
            keys::SEARCH => {
                let query = sent_query(&key.segments.get(1).cloned().unwrap_or_default());
                backend
                    .gifs_controller_search(limit, None, query)
                    .await
                    .map_err(|error| self.backend_failed(error))?
            }
            op => {
                return Err(CoreError::Failed {
                    message: format!("no fetch for {op}"),
                });
            }
        };
        Ok(CacheValue::W7(GifsValue::Page {
            results: page.results,
            next: page.next,
        }))
    }

    /// The featured GIFs for an empty `query`, else the search's results (trimmed).
    pub fn gifs(&self, query: String) -> GifResultsView {
        let query = query.trim().to_owned();
        self.write(|state, _| {
            let enabled = state
                .auth
                .server_info
                .as_ref()
                .is_some_and(|info| info.gif_search);
            if !enabled {
                // Nothing to read: the picker stays hidden.
                return GifResultsView {
                    state: LoadState::Ready,
                    query,
                    ..GifResultsView::default()
                };
            }
            let key = key_of(&query);
            // GIF lists don't age: a cached page is what the view shows.
            state.ensure_query(key.clone());
            let (results, more) = match state.w7_page(&key) {
                Some(GifsValue::Page { results, next }) => {
                    (results.iter().map(gif_view).collect(), next.is_some())
                }
                None => (Vec::new(), false),
            };
            GifResultsView {
                state: state.load_of(&key),
                query,
                results,
                more,
                loading_more: state.w7.loading_more.contains(&key),
                enabled: true,
            }
        })
    }

    /// The next page of `gifs(query)`, when `more`.
    pub async fn load_more_gifs(&self, query: String) -> Result<(), CoreError> {
        let query = query.trim().to_owned();
        let key = key_of(&query);
        let view = ViewKey::Gifs {
            query: query.clone(),
        };
        let (services, epoch) = self.begin("GIFs")?;
        let start = self.write(|state, _| {
            if state.w7.loading_more.contains(&key) {
                return None;
            }
            let next = match state.w7_page(&key) {
                Some(GifsValue::Page {
                    next: Some(next), ..
                }) => next.clone(),
                // Nothing cached, nothing more: nothing to read.
                _ => return None,
            };
            state.w7.loading_more.insert(key.clone());
            state.view_changed(view.clone());
            Some(next)
        });
        let Some(pos) = start else {
            return Ok(());
        };
        let limit = NonZeroU64::new(PAGE);
        let page = if key.op() == keys::SEARCH {
            services
                .backend
                .gifs_controller_search(limit, Some(pos), sent_query(&query))
                .await
        } else {
            services
                .backend
                .gifs_controller_featured(limit, Some(pos))
                .await
        };
        let landed = self.write(|state, _| {
            // An answer for a session that ended writes nothing and fails.
            if state.session_epoch != epoch {
                return false;
            }
            state.w7.loading_more.remove(&key);
            state.view_changed(view.clone());
            let Ok(page) = &page else {
                return true;
            };
            state.w7_edit(&key, |results, next| {
                // A repeated result (the list moved under the cursor) keeps its place once.
                for gif in &page.results {
                    if !results.iter().any(|known| known.id == gif.id) {
                        results.push(gif.clone());
                    }
                }
                *next = page.next.clone();
            });
            true
        });
        if !landed {
            return Err(CoreError::Failed {
                message: "signed out".into(),
            });
        }
        page.map(|_| ()).map_err(|error| self.backend_failed(error))
    }
}
