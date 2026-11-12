//! W6-E: instance roles.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait InstanceRolesBackend: Send + Sync {
    /// `GET /roles/instance/all` (READ_INSTANCE_SETTINGS).
    async fn roles_controller_get_instance_roles(&self) -> BackendResult<Vec<wire::RoleDto>> {
        Err(unsupported("instance roles"))
    }
    /// `POST /roles/instance` (UPDATE_INSTANCE_SETTINGS).
    async fn roles_controller_create_instance_role(
        &self,
        _body: wire::CreateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        Err(unsupported("creating instance roles"))
    }
    /// `PUT /roles/instance/{roleId}` (UPDATE_INSTANCE_SETTINGS).
    async fn roles_controller_update_instance_role(
        &self,
        _role_id: String,
        _body: wire::UpdateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        Err(unsupported("changing instance roles"))
    }
    /// `DELETE /roles/instance/{roleId}` (UPDATE_INSTANCE_SETTINGS), 204.
    async fn roles_controller_delete_instance_role(&self, _role_id: String) -> BackendResult<()> {
        Err(unsupported("deleting instance roles"))
    }
    /// `GET /roles/instance/{roleId}/users` (READ_USER).
    async fn roles_controller_get_instance_role_users(
        &self,
        _role_id: String,
    ) -> BackendResult<Vec<wire::RoleUserDto>> {
        Err(unsupported("an instance role's users"))
    }
}
