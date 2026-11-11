//! [`HttpBackend`] for [`SearchBackend`]: message search.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, SearchBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl SearchBackend for HttpBackend {
    async fn messages_controller_search_channel_messages(
        &self,
        channel_id: String,
        q: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MessageDto>> {
        let (channel_id, q) = (channel_id.as_str(), q.as_str());
        rpc!(self, c => c.messages_controller_search_channel_messages(channel_id, limit, q))
    }

    async fn messages_controller_search_direct_messages(
        &self,
        group_id: String,
        q: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MessageDto>> {
        let (group_id, q) = (group_id.as_str(), q.as_str());
        rpc!(self, c => c.messages_controller_search_direct_messages(group_id, limit, q))
    }

    async fn messages_controller_search_community_messages(
        &self,
        community_id: String,
        q: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::CommunitySearchResultDto>> {
        let (community_id, q) = (community_id.as_str(), q.as_str());
        rpc!(self, c => c.messages_controller_search_community_messages(community_id, limit, q))
    }
}
