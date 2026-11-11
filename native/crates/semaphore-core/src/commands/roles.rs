//! Community roles: the list and editor, assigning them, and a channel's permission overrides.
//! Unit W5-B.
//!
//! The rank rules are the server's (`CommunityRolesService`): a user manages roles strictly below
//! their best one (holders of the top position, and the instance owner, any); grants only actions
//! they hold; never places a role above their own rank; changes the roles of members they outrank,
//! or their own. Core sets `RoleRow`'s flags and `RolesView::grantable` from them. A saved role keeps
//! the actions this build doesn't know.

use crate::client::Core;
use crate::model::{
    ChannelOverwritesView, MemberRolesView, OverwritesDraft, PermissionGroup, RoleDraft,
    RoleMembersView, RolesView,
};
use crate::platform::CoreError;
use crate::resync::unavailable;

impl Core {
    /// `ViewKey::Roles`.
    pub fn roles(&self, community_id: String) -> RolesView {
        RolesView {
            community_id,
            ..Default::default()
        }
    }

    /// The permission matrix's groups, in the web's order.
    pub fn permission_catalog(&self) -> Vec<PermissionGroup> {
        Vec::new()
    }

    /// Makes a role below this user's own; returns its id.
    pub async fn create_role(
        &self,
        _community_id: String,
        _draft: RoleDraft,
    ) -> Result<String, CoreError> {
        Err(unavailable("creating a role"))
    }

    pub async fn update_role(
        &self,
        _community_id: String,
        _role_id: String,
        _draft: RoleDraft,
    ) -> Result<(), CoreError> {
        Err(unavailable("updating a role"))
    }

    pub async fn delete_role(
        &self,
        _community_id: String,
        _role_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("deleting a role"))
    }

    /// The roles in their new order, highest first. "Member" stays last whatever is sent.
    pub async fn reorder_roles(
        &self,
        _community_id: String,
        _role_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        Err(unavailable("reordering roles"))
    }

    pub async fn reset_default_roles(&self, _community_id: String) -> Result<(), CoreError> {
        Err(unavailable("resetting the default roles"))
    }

    /// Who holds a role (`ViewKey::RoleMembers`).
    pub fn role_members(&self, _community_id: String, role_id: String) -> RoleMembersView {
        RoleMembersView {
            role_id,
            ..Default::default()
        }
    }

    /// One member's roles, for the assignment dialog (`ViewKey::MemberRoles`).
    pub fn member_roles(&self, _community_id: String, user_id: String) -> MemberRolesView {
        MemberRolesView {
            user_id,
            ..Default::default()
        }
    }

    pub async fn assign_role(
        &self,
        _community_id: String,
        _user_id: String,
        _role_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("assigning a role"))
    }

    pub async fn unassign_role(
        &self,
        _community_id: String,
        _user_id: String,
        _role_id: String,
    ) -> Result<(), CoreError> {
        Err(unavailable("removing a role"))
    }

    /// A channel's overrides (`ViewKey::ChannelOverwrites`).
    pub fn channel_overwrites(&self, channel_id: String) -> ChannelOverwritesView {
        ChannelOverwritesView {
            channel_id,
            ..Default::default()
        }
    }

    /// Replaces the channel's preset and overrides with these.
    pub async fn replace_channel_overwrites(
        &self,
        _channel_id: String,
        _draft: OverwritesDraft,
    ) -> Result<(), CoreError> {
        Err(unavailable("changing channel permissions"))
    }
}
