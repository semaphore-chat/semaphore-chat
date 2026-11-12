//! W6-A: the admin dashboard and instance settings.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait InstanceAdminBackend: Send + Sync {
    /// `GET /instance/settings` (READ_INSTANCE_SETTINGS).
    async fn instance_controller_get_settings(
        &self,
    ) -> BackendResult<wire::InstanceSettingsResponseDto> {
        Err(unsupported("instance settings"))
    }
    /// `PATCH /instance/settings` (UPDATE_INSTANCE_SETTINGS).
    async fn instance_controller_update_settings(
        &self,
        _body: wire::UpdateInstanceSettingsDto,
    ) -> BackendResult<wire::InstanceSettingsResponseDto> {
        Err(unsupported("instance settings"))
    }
    /// `GET /instance/stats` (READ_INSTANCE_STATS).
    async fn instance_controller_get_stats(&self) -> BackendResult<wire::InstanceStatsResponseDto> {
        Err(unsupported("instance stats"))
    }
    /// `GET /storage/instance` (READ_INSTANCE_STATS).
    async fn storage_quota_controller_get_instance_storage_stats(
        &self,
    ) -> BackendResult<wire::InstanceStorageStatsDto> {
        Err(unsupported("instance storage"))
    }
    /// `GET /livekit/health`.
    async fn livekit_controller_validate_configuration(
        &self,
    ) -> BackendResult<wire::LivekitHealthResponseDto> {
        Err(unsupported("LiveKit health"))
    }
}
