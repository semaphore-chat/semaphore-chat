//! [`HttpBackend`] for [`AdminStorageBackend`]: per-user storage, quotas and recalculation.

use async_trait::async_trait;
use semaphore_core::backend::{AdminStorageBackend, BackendResult};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl AdminStorageBackend for HttpBackend {
    async fn storage_quota_controller_get_users_storage_list(
        &self,
        min_percent_used: Option<i64>,
        skip: Option<i64>,
        take: Option<i64>,
    ) -> BackendResult<wire::UserStorageListResponseDto> {
        rpc!(self, c => c.storage_quota_controller_get_users_storage_list(min_percent_used, skip, take))
    }

    async fn storage_quota_controller_get_user_storage_stats(
        &self,
        user_id: String,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        let user_id = user_id.as_str();
        rpc!(self, c => c.storage_quota_controller_get_user_storage_stats(user_id))
    }

    async fn storage_quota_controller_update_user_quota(
        &self,
        user_id: String,
        body: wire::UpdateUserQuotaDto,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        let (user_id, body) = (user_id.as_str(), &body);
        rpc!(self, c => c.storage_quota_controller_update_user_quota(user_id, body))
    }

    async fn storage_quota_controller_recalculate_user_storage(
        &self,
        user_id: String,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        let user_id = user_id.as_str();
        rpc!(self, c => c.storage_quota_controller_recalculate_user_storage(user_id))
    }
}
