//! [`HttpBackend`] for [`InstanceRolesBackend`]: instance roles. Each call is one generated client
//! operation (`semaphore-api`), so the contract and the error mapping stay the client's.

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, InstanceRolesBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl InstanceRolesBackend for HttpBackend {
    async fn roles_controller_get_instance_roles(&self) -> BackendResult<Vec<wire::RoleDto>> {
        rpc!(self, c => c.roles_controller_get_instance_roles())
    }

    async fn roles_controller_create_instance_role(
        &self,
        body: wire::CreateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        let body = &body;
        rpc!(self, c => c.roles_controller_create_instance_role(body))
    }

    async fn roles_controller_update_instance_role(
        &self,
        role_id: String,
        body: wire::UpdateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        let (role_id, body) = (role_id.as_str(), &body);
        rpc!(self, c => c.roles_controller_update_instance_role(role_id, body))
    }

    async fn roles_controller_delete_instance_role(&self, role_id: String) -> BackendResult<()> {
        let role_id = role_id.as_str();
        rpc!(self, c => c.roles_controller_delete_instance_role(role_id))
    }

    async fn roles_controller_get_instance_role_users(
        &self,
        role_id: String,
    ) -> BackendResult<Vec<wire::RoleUserDto>> {
        let role_id = role_id.as_str();
        rpc!(self, c => c.roles_controller_get_instance_role_users(role_id))
    }
}
