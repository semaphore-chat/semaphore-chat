//! [`HttpBackend`] for [`AdminUsersBackend`]: users: the list, one user, owner role, ban, password,
//! delete and instance role assignment. Each method is one generated operation.

use async_trait::async_trait;
use semaphore_core::backend::{AdminUsersBackend, BackendResult};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl AdminUsersBackend for HttpBackend {
    async fn user_controller_find_all_users_admin(
        &self,
        banned: Option<semaphore_wire::enums::BooleanString>,
        continuation_token: Option<String>,
        limit: Option<std::num::NonZeroU64>,
        role: Option<semaphore_wire::enums::InstanceRole>,
        search: Option<String>,
    ) -> BackendResult<wire::AdminUserListResponseDto> {
        let (banned, continuation_token, role, search) = (
            banned.as_ref(),
            continuation_token.as_deref(),
            role.as_ref(),
            search.as_deref(),
        );
        rpc!(self, c => c.user_controller_find_all_users_admin(
            banned,
            continuation_token,
            limit,
            role,
            search
        ))
    }

    async fn user_controller_get_user_by_id_admin(
        &self,
        id: String,
    ) -> BackendResult<wire::AdminUserEntity> {
        let id = id.as_str();
        rpc!(self, c => c.user_controller_get_user_by_id_admin(id))
    }

    async fn roles_controller_get_user_instance_roles(
        &self,
        user_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        let user_id = user_id.as_str();
        rpc!(self, c => c.roles_controller_get_user_instance_roles(user_id))
    }

    async fn user_controller_update_user_role(
        &self,
        id: String,
        body: wire::UpdateUserRoleDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.user_controller_update_user_role(id, body))
    }

    async fn user_controller_set_ban_status(
        &self,
        id: String,
        body: wire::SetUserBanStatusDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.user_controller_set_ban_status(id, body))
    }

    async fn user_controller_set_user_password(
        &self,
        id: String,
        body: wire::SetUserPasswordDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.user_controller_set_user_password(id, body))
    }

    async fn user_controller_delete_user(
        &self,
        id: String,
    ) -> BackendResult<wire::SuccessResponseDto> {
        let id = id.as_str();
        rpc!(self, c => c.user_controller_delete_user(id))
    }

    async fn roles_controller_assign_instance_role(
        &self,
        role_id: String,
        body: wire::AssignInstanceRoleDto,
    ) -> BackendResult<()> {
        let (role_id, body) = (role_id.as_str(), &body);
        rpc!(self, c => c.roles_controller_assign_instance_role(role_id, body))
    }

    async fn roles_controller_remove_instance_role(
        &self,
        role_id: String,
        user_id: String,
    ) -> BackendResult<()> {
        let (role_id, user_id) = (role_id.as_str(), user_id.as_str());
        rpc!(self, c => c.roles_controller_remove_instance_role(role_id, user_id))
    }
}
