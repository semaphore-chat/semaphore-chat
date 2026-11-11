//! This account: editing the profile, sessions and appearance settings. Unit W3-core.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait AccountBackend: Send + Sync {
    /// An empty `avatar` or `banner` removes it; a file id sets it.
    async fn user_controller_update_profile(
        &self,
        _body: wire::UpdateProfileDto,
    ) -> BackendResult<wire::UserEntity> {
        Err(unsupported("editing the profile"))
    }
    async fn auth_controller_get_sessions(&self) -> BackendResult<Vec<wire::SessionInfoDto>> {
        Err(unsupported("listing sessions"))
    }
    async fn auth_controller_revoke_session(
        &self,
        _session_id: String,
    ) -> BackendResult<wire::RevokeSessionResponseDto> {
        Err(unsupported("revoking a session"))
    }
    async fn auth_controller_revoke_all_other_sessions(
        &self,
    ) -> BackendResult<wire::RevokeAllSessionsResponseDto> {
        Err(unsupported("revoking other sessions"))
    }
    /// This user's instance roles, with their actions.
    async fn roles_controller_get_my_instance_roles(
        &self,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        Err(unsupported("reading instance roles"))
    }
    async fn appearance_settings_controller_get_settings(
        &self,
    ) -> BackendResult<wire::AppearanceSettingsResponseDto> {
        Err(unsupported("reading appearance settings"))
    }
    async fn appearance_settings_controller_update_settings(
        &self,
        _body: wire::UpdateAppearanceSettingsDto,
    ) -> BackendResult<wire::AppearanceSettingsResponseDto> {
        Err(unsupported("changing appearance settings"))
    }
}
