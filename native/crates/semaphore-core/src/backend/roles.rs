//! W5: community roles, assigning them, and channel permission overrides. Unit W5-B.

use async_trait::async_trait;
use semaphore_wire::types as wire;

use super::{BackendResult, unsupported};

/// Part of [`Backend`](super::Backend). Defaults until a backend has them.
#[async_trait]
pub trait RolesBackend: Send + Sync {
    /// This user's community roles: the union of their actions is what they may do there.
    async fn roles_controller_get_my_roles_for_community(
        &self,
        _community_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        Err(unsupported("reading my community roles"))
    }
    async fn roles_controller_get_community_roles(
        &self,
        _community_id: String,
    ) -> BackendResult<wire::CommunityRolesResponseDto> {
        Err(unsupported("listing roles"))
    }
    async fn roles_controller_create_community_role(
        &self,
        _community_id: String,
        _body: wire::CreateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        Err(unsupported("creating a role"))
    }
    /// `actions` replaces the whole list.
    async fn roles_controller_update_role(
        &self,
        _community_id: String,
        _role_id: String,
        _body: wire::UpdateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        Err(unsupported("updating a role"))
    }
    async fn roles_controller_delete_role(
        &self,
        _community_id: String,
        _role_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("deleting a role"))
    }
    async fn roles_controller_reorder_roles(
        &self,
        _community_id: String,
        _body: wire::ReorderRolesDto,
    ) -> BackendResult<Vec<wire::RoleDto>> {
        Err(unsupported("reordering roles"))
    }
    async fn roles_controller_reset_default_community_roles(
        &self,
        _community_id: String,
    ) -> BackendResult<wire::CommunityRolesResponseDto> {
        Err(unsupported("resetting the default roles"))
    }
    async fn roles_controller_assign_role_to_user(
        &self,
        _community_id: String,
        _body: wire::AssignRoleDto,
    ) -> BackendResult<()> {
        Err(unsupported("assigning a role"))
    }
    async fn roles_controller_remove_role_from_user(
        &self,
        _community_id: String,
        _user_id: String,
        _role_id: String,
    ) -> BackendResult<()> {
        Err(unsupported("removing a role"))
    }
    async fn roles_controller_get_users_for_role(
        &self,
        _community_id: String,
        _role_id: String,
    ) -> BackendResult<Vec<wire::RoleUserDto>> {
        Err(unsupported("listing a role's members"))
    }
    async fn roles_controller_get_user_roles_for_community(
        &self,
        _user_id: String,
        _community_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        Err(unsupported("reading a member's roles"))
    }
    async fn channel_permissions_controller_get_overwrites(
        &self,
        _id: String,
    ) -> BackendResult<wire::ChannelOverwritesDto> {
        Err(unsupported("reading channel overrides"))
    }
    async fn channel_permissions_controller_replace_overwrites(
        &self,
        _id: String,
        _body: wire::ReplaceChannelOverwritesDto,
    ) -> BackendResult<wire::ChannelOverwritesDto> {
        Err(unsupported("replacing channel overrides"))
    }
}
