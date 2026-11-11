//! [`HttpBackend`] for [`AccountBackend`]: the profile, sessions, instance roles and appearance
//! settings.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{AccountBackend, BackendResult};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl AccountBackend for HttpBackend {
    async fn user_controller_update_profile(
        &self,
        body: wire::UpdateProfileDto,
    ) -> BackendResult<wire::UserEntity> {
        let body = &body;
        rpc!(self, c => c.user_controller_update_profile(body))
    }

    async fn auth_controller_get_sessions(&self) -> BackendResult<Vec<wire::SessionInfoDto>> {
        rpc!(self, c => c.auth_controller_get_sessions())
    }

    async fn auth_controller_revoke_session(
        &self,
        session_id: String,
    ) -> BackendResult<wire::RevokeSessionResponseDto> {
        let session_id = session_id.as_str();
        rpc!(self, c => c.auth_controller_revoke_session(session_id))
    }

    async fn auth_controller_revoke_all_other_sessions(
        &self,
    ) -> BackendResult<wire::RevokeAllSessionsResponseDto> {
        rpc!(self, c => c.auth_controller_revoke_all_other_sessions())
    }

    async fn roles_controller_get_my_instance_roles(
        &self,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        rpc!(self, c => c.roles_controller_get_my_instance_roles())
    }

    async fn appearance_settings_controller_get_settings(
        &self,
    ) -> BackendResult<wire::AppearanceSettingsResponseDto> {
        rpc!(self, c => c.appearance_settings_controller_get_settings())
    }

    async fn appearance_settings_controller_update_settings(
        &self,
        body: wire::UpdateAppearanceSettingsDto,
    ) -> BackendResult<wire::AppearanceSettingsResponseDto> {
        let body = &body;
        rpc!(self, c => c.appearance_settings_controller_update_settings(body))
    }
}
