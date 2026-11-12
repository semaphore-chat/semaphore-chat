//! W6-C: per-user storage.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait AdminStorageBackend: Send + Sync {
    /// `GET /storage/users` (MANAGE_USER_STORAGE).
    async fn storage_quota_controller_get_users_storage_list(
        &self,
        _min_percent_used: Option<i64>,
        _skip: Option<i64>,
        _take: Option<i64>,
    ) -> BackendResult<wire::UserStorageListResponseDto> {
        Err(unsupported("the storage list"))
    }
    /// `GET /storage/users/{userId}` (MANAGE_USER_STORAGE).
    async fn storage_quota_controller_get_user_storage_stats(
        &self,
        _user_id: String,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        Err(unsupported("a user's storage"))
    }
    /// `PATCH /storage/users/{userId}/quota` (MANAGE_USER_STORAGE).
    async fn storage_quota_controller_update_user_quota(
        &self,
        _user_id: String,
        _body: wire::UpdateUserQuotaDto,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        Err(unsupported("changing quotas"))
    }
    /// `POST /storage/users/{userId}/recalculate` (MANAGE_USER_STORAGE).
    async fn storage_quota_controller_recalculate_user_storage(
        &self,
        _user_id: String,
    ) -> BackendResult<wire::UserStorageStatsDto> {
        Err(unsupported("recalculating storage"))
    }
}
