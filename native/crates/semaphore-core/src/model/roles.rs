//! W5: roles, assigning them, and a channel's permission overrides. Unit W5-B.
//!
//! An action is its wire name (`"MANAGE_EMOJIS"`): the server's list grows, and a role saved by
//! this build must keep the actions it doesn't know. `Core::permission_catalog` groups the ones it
//! does, for the matrix; a UI labels them.
//!
//! The flags on each row are the server's rank rules, worked out by core (lower position ranks
//! higher; holders of the top position act as the community's owners): a UI shows what they allow
//! and never re-derives them.

use super::{AdminOp, LoadState, UserView};

/// A community role.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoleRow {
    pub id: String,
    pub name: String,
    /// Lower ranks higher.
    pub position: i32,
    /// One of the community's default roles. The "Member" one is always last and can't move.
    pub is_default: bool,
    /// Wire names, unknown ones included.
    pub actions: Vec<String>,
    /// This user may rename it and change its actions (within `RolesView::grantable`).
    pub editable: bool,
    pub deletable: bool,
    /// This user may give it to, or take it from, members they outrank.
    pub assignable: bool,
}

/// `Core::roles`. `ViewKey::Roles { community_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RolesView {
    pub state: LoadState,
    pub community_id: String,
    /// Highest rank first.
    pub roles: Vec<RoleRow>,
    /// The actions this user may put on a role: those they hold (all, for the instance owner).
    pub grantable: Vec<String>,
    pub can_create: bool,
    pub can_reorder: bool,
    pub can_reset_defaults: bool,
    pub op: AdminOp,
}

/// A new role, or (`Core::update_role`) an existing one's name and actions. `actions` replaces
/// the role's whole list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoleDraft {
    pub name: String,
    pub actions: Vec<String>,
}

/// One group of the permission matrix, in the web's order (`frontend/src/constants/rbacActions.ts`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionGroup {
    /// Stable id for a UI's label (`"community"`, `"channels"`, `"messages"`, ...).
    pub id: String,
    pub actions: Vec<String>,
}

/// `Core::role_members`: who holds a role. `ViewKey::RoleMembers { community_id, role_id }`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RoleMembersView {
    pub state: LoadState,
    pub role_id: String,
    pub users: Vec<UserView>,
}

/// `Core::member_roles`: one member's roles, for the assignment dialog.
/// `ViewKey::MemberRoles { community_id, user_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MemberRolesView {
    pub state: LoadState,
    pub user_id: String,
    /// Role ids they hold.
    pub held: Vec<String>,
    /// Role ids this user may give or take here: assignable roles, if they outrank the member (or
    /// it's themselves, or they hold the top rank).
    pub changeable: Vec<String>,
    pub op: AdminOp,
}

/// What an override applies to. Per-member overrides exist in the server's data model only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OverwriteTarget {
    Everyone,
    Role { role_id: String, name: String },
}

/// The channel's permission preset, a label the web shows (the overrides are what's enforced).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ChannelPreset {
    #[default]
    Normal,
    ReadOnly,
    Announcement,
    ModsOnly,
    Custom,
    Unknown,
}

/// One override: actions it allows and denies, as wire names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverwriteRow {
    pub target: OverwriteTarget,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
}

/// `Core::channel_overwrites`. `ViewKey::ChannelOverwrites { channel_id }` says when to read
/// again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelOverwritesView {
    pub state: LoadState,
    pub channel_id: String,
    pub preset: ChannelPreset,
    pub overwrites: Vec<OverwriteRow>,
    /// MANAGE_CHANNEL_PERMISSIONS here.
    pub editable: bool,
    pub op: AdminOp,
}

/// What `Core::replace_channel_overwrites` sends: the whole set.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OverwritesDraft {
    pub preset: ChannelPreset,
    pub overwrites: Vec<OverwriteRow>,
}
