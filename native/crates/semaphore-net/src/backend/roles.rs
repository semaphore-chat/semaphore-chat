//! [`HttpBackend`] for [`RolesBackend`]: community roles, assignment and channel overrides (W5-B).

use async_trait::async_trait;
use semaphore_api::{Client, ResponseValue};
use semaphore_core::backend::{BackendResult, RolesBackend};
use semaphore_wire::types as wire;

use super::*;

#[async_trait]
impl RolesBackend for HttpBackend {
    async fn roles_controller_get_my_roles_for_community(
        &self,
        community_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.roles_controller_get_my_roles_for_community(community_id))
    }

    async fn roles_controller_get_community_roles(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityRolesResponseDto> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.roles_controller_get_community_roles(community_id))
    }

    async fn roles_controller_create_community_role(
        &self,
        community_id: String,
        body: wire::CreateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        let (community_id, body) = (community_id.as_str(), &body);
        rpc!(self, c => c.roles_controller_create_community_role(community_id, body))
    }

    async fn roles_controller_update_role(
        &self,
        community_id: String,
        role_id: String,
        body: wire::UpdateRoleDto,
    ) -> BackendResult<wire::RoleDto> {
        let (community_id, role_id, body) = (community_id.as_str(), role_id.as_str(), &body);
        rpc!(self, c => c.roles_controller_update_role(community_id, role_id, body))
    }

    async fn roles_controller_delete_role(
        &self,
        community_id: String,
        role_id: String,
    ) -> BackendResult<()> {
        let (community_id, role_id) = (community_id.as_str(), role_id.as_str());
        rpc!(self, c => c.roles_controller_delete_role(community_id, role_id)).map(|_| ())
    }

    async fn roles_controller_reorder_roles(
        &self,
        community_id: String,
        body: wire::ReorderRolesDto,
    ) -> BackendResult<Vec<wire::RoleDto>> {
        let (community_id, body) = (community_id.as_str(), &body);
        rpc!(self, c => c.roles_controller_reorder_roles(community_id, body))
    }

    async fn roles_controller_reset_default_community_roles(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityRolesResponseDto> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.roles_controller_reset_default_community_roles(community_id))
    }

    async fn roles_controller_assign_role_to_user(
        &self,
        community_id: String,
        body: wire::AssignRoleDto,
    ) -> BackendResult<()> {
        let (community_id, body) = (community_id.as_str(), &body);
        rpc!(self, c => c.roles_controller_assign_role_to_user(community_id, body)).map(|_| ())
    }

    async fn roles_controller_remove_role_from_user(
        &self,
        community_id: String,
        user_id: String,
        role_id: String,
    ) -> BackendResult<()> {
        let (community_id, user_id, role_id) =
            (community_id.as_str(), user_id.as_str(), role_id.as_str());
        rpc!(self, c => c.roles_controller_remove_role_from_user(community_id, user_id, role_id))
            .map(|_| ())
    }

    async fn roles_controller_get_users_for_role(
        &self,
        community_id: String,
        role_id: String,
    ) -> BackendResult<Vec<wire::RoleUserDto>> {
        let (community_id, role_id) = (community_id.as_str(), role_id.as_str());
        rpc!(self, c => c.roles_controller_get_users_for_role(community_id, role_id))
    }

    async fn roles_controller_get_user_roles_for_community(
        &self,
        user_id: String,
        community_id: String,
    ) -> BackendResult<wire::UserRolesResponseDto> {
        let (user_id, community_id) = (user_id.as_str(), community_id.as_str());
        rpc!(self, c => c.roles_controller_get_user_roles_for_community(user_id, community_id))
    }

    async fn channel_permissions_controller_get_overwrites(
        &self,
        id: String,
    ) -> BackendResult<wire::ChannelOverwritesDto> {
        let id = id.as_str();
        rpc!(self, c => c.channel_permissions_controller_get_overwrites(id))
    }

    async fn channel_permissions_controller_replace_overwrites(
        &self,
        id: String,
        body: wire::ReplaceChannelOverwritesDto,
    ) -> BackendResult<wire::ChannelOverwritesDto> {
        let (id, body) = (id.as_str(), &body);
        rpc!(self, c => c.channel_permissions_controller_replace_overwrites(id, body))
    }
}
