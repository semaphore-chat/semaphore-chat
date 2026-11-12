//! W6-D: every community and force delete (instance invites are W5-A's `CommunityAdminBackend` calls).

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait AdminContentBackend: Send + Sync {
    /// `GET /community/admin/list` (READ_ALL_COMMUNITIES).
    async fn community_controller_find_all_with_stats(
        &self,
        _continuation_token: Option<String>,
        _limit: Option<i64>,
        _search: Option<String>,
    ) -> BackendResult<wire::CommunityStatsListResponseDto> {
        Err(unsupported("the communities list"))
    }
    /// `GET /community/admin/{id}` (READ_ALL_COMMUNITIES).
    async fn community_controller_find_one_with_stats(
        &self,
        _id: String,
    ) -> BackendResult<wire::CommunityStatsDetailDto> {
        Err(unsupported("a community"))
    }
    /// `DELETE /community/admin/{id}` (DELETE_COMMUNITY), 204.
    async fn community_controller_force_remove(&self, _id: String) -> BackendResult<()> {
        Err(unsupported("deleting communities"))
    }
}
