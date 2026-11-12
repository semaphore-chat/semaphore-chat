//! [`HttpBackend`] for [`InstanceAdminBackend`]: the admin dashboard and instance settings.

use async_trait::async_trait;
use semaphore_core::backend::{BackendResult, InstanceAdminBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl InstanceAdminBackend for HttpBackend {
    async fn instance_controller_get_settings(
        &self,
    ) -> BackendResult<wire::InstanceSettingsResponseDto> {
        rpc!(self, c => c.instance_controller_get_settings())
    }

    async fn instance_controller_update_settings(
        &self,
        body: wire::UpdateInstanceSettingsDto,
    ) -> BackendResult<wire::InstanceSettingsResponseDto> {
        let body = &body;
        rpc!(self, c => c.instance_controller_update_settings(body))
    }

    async fn instance_controller_get_stats(&self) -> BackendResult<wire::InstanceStatsResponseDto> {
        rpc!(self, c => c.instance_controller_get_stats())
    }

    async fn storage_quota_controller_get_instance_storage_stats(
        &self,
    ) -> BackendResult<wire::InstanceStorageStatsDto> {
        rpc!(self, c => c.storage_quota_controller_get_instance_storage_stats())
    }

    async fn livekit_controller_validate_configuration(
        &self,
    ) -> BackendResult<wire::LivekitHealthResponseDto> {
        rpc!(self, c => c.livekit_controller_validate_configuration())
    }
}
