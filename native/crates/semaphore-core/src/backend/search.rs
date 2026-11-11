//! Message search. Newest first, no paging, and removed messages are never found.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait SearchBackend: Send + Sync {
    async fn messages_controller_search_channel_messages(
        &self,
        _channel_id: String,
        _q: String,
        _limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MessageDto>> {
        Err(unsupported("searching a channel"))
    }
    async fn messages_controller_search_direct_messages(
        &self,
        _group_id: String,
        _q: String,
        _limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MessageDto>> {
        Err(unsupported("searching a conversation"))
    }
    async fn messages_controller_search_community_messages(
        &self,
        _community_id: String,
        _q: String,
        _limit: Option<i64>,
    ) -> BackendResult<Vec<wire::CommunitySearchResultDto>> {
        Err(unsupported("searching a community"))
    }
}
