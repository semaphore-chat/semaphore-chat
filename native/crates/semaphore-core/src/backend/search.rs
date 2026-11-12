//! Message search. Newest first, a page at a time, and removed messages are never found.
//!
//! The server sends the cursor for the next page in a response header, which a backend returns
//! beside the rows (the generated client keeps it); the backend translates its own naming back to
//! this one. A cursor is only sent when the page was full, so `None` means the search is done.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// One page of search results, and the cursor for the page after it when the server sent one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchPage<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait SearchBackend: Send + Sync {
    /// `continuation_token` is the cursor the previous page answered with, or `None` for the
    /// first page.
    async fn messages_controller_search_channel_messages(
        &self,
        _channel_id: String,
        _q: String,
        _limit: Option<i64>,
        _continuation_token: Option<String>,
    ) -> BackendResult<SearchPage<wire::MessageDto>> {
        Err(unsupported("searching a channel"))
    }
    async fn messages_controller_search_direct_messages(
        &self,
        _group_id: String,
        _q: String,
        _limit: Option<i64>,
        _continuation_token: Option<String>,
    ) -> BackendResult<SearchPage<wire::MessageDto>> {
        Err(unsupported("searching a conversation"))
    }
    async fn messages_controller_search_community_messages(
        &self,
        _community_id: String,
        _q: String,
        _limit: Option<i64>,
        _continuation_token: Option<String>,
    ) -> BackendResult<SearchPage<wire::CommunitySearchResultDto>> {
        Err(unsupported("searching a community"))
    }
}
