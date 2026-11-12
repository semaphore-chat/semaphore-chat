//! W6-B: users: the list, one user, owner role, ban, password, delete and instance role assignment.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait AdminUsersBackend: Send + Sync {
    /// `GET /users/admin/list` (READ_USER). Newest first; `continuationToken` is the last row's id.
    async fn user_controller_find_all_users_admin(
        &self,
        _banned: Option<semaphore_wire::enums::BooleanString>,
        _continuation_token: Option<String>,
        _limit: Option<std::num::NonZeroU64>,
        _role: Option<semaphore_wire::enums::InstanceRole>,
        _search: Option<String>,
    ) -> BackendResult<wire::AdminUserListResponseDto> {
        Err(unsupported("the users list"))
    }
    /// `GET /users/admin/{id}` (READ_USER).
    async fn user_controller_get_user_by_id_admin(
        &self,
        _id: String,
    ) -> BackendResult<wire::AdminUserEntity> {
        Err(unsupported("a user"))
    }
    /// `GET /roles/user/{userId}/instance` (READ_USER).
    async fn roles_controller_get_user_instance_roles(
        &self,
        _user_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        Err(unsupported("a user's instance roles"))
    }
    /// `PATCH /users/admin/{id}/role` (UPDATE_USER; only an owner may grant or take OWNER).
    async fn user_controller_update_user_role(
        &self,
        _id: String,
        _body: wire::UpdateUserRoleDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        Err(unsupported("changing the owner role"))
    }
    /// `PATCH /users/admin/{id}/ban` (BAN_USER).
    async fn user_controller_set_ban_status(
        &self,
        _id: String,
        _body: wire::SetUserBanStatusDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        Err(unsupported("banning users"))
    }
    /// `PATCH /users/admin/{id}/password` (UPDATE_USER).
    async fn user_controller_set_user_password(
        &self,
        _id: String,
        _body: wire::SetUserPasswordDto,
    ) -> BackendResult<wire::AdminUserEntity> {
        Err(unsupported("resetting passwords"))
    }
    /// `DELETE /users/admin/{id}` (DELETE_USER).
    async fn user_controller_delete_user(
        &self,
        _id: String,
    ) -> BackendResult<wire::SuccessResponseDto> {
        Err(unsupported("deleting users"))
    }
    /// `POST /roles/instance/{roleId}/assign` (UPDATE_USER), 204.
    async fn roles_controller_assign_instance_role(
        &self,
        _role_id: String,
        _body: wire::AssignInstanceRoleDto,
    ) -> BackendResult<()> {
        Err(unsupported("assigning instance roles"))
    }
    /// `DELETE /roles/instance/{roleId}/users/{userId}` (UPDATE_USER), 204.
    async fn roles_controller_remove_instance_role(
        &self,
        _role_id: String,
        _user_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("removing instance roles"))
    }
}
