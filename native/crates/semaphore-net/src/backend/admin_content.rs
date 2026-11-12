//! [`HttpBackend`] for [`AdminContentBackend`]: every community and force delete (instance
//! invites are W5-A's `CommunityAdminBackend` calls).

use async_trait::async_trait;
use semaphore_core::backend::{AdminContentBackend, BackendResult};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl AdminContentBackend for HttpBackend {
    async fn community_controller_find_all_with_stats(
        &self,
        continuation_token: Option<String>,
        limit: Option<i64>,
        search: Option<String>,
    ) -> BackendResult<wire::CommunityStatsListResponseDto> {
        let (continuation_token, search) = (continuation_token.as_deref(), search.as_deref());
        rpc!(self, c => c.community_controller_find_all_with_stats(continuation_token, limit, search))
    }

    async fn community_controller_find_one_with_stats(
        &self,
        id: String,
    ) -> BackendResult<wire::CommunityStatsDetailDto> {
        let id = id.as_str();
        rpc!(self, c => c.community_controller_find_one_with_stats(id))
    }

    async fn community_controller_force_remove(&self, id: String) -> BackendResult<()> {
        let id = id.as_str();
        rpc!(self, c => c.community_controller_force_remove(id))
    }
}
