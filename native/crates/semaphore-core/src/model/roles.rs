//! W5: roles, assigning them, and a channel's permission overrides. Unit W5-B.
//!
//! An action is its wire name (`"MANAGE_EMOJIS"`): the server's list grows, and a role saved by
//! this build must keep the actions it doesn't know. `Core::permission_catalog` groups the ones it
//! does, for the matrix; a UI labels them.
//!
//! The flags on each row are the server's rank rules, worked out by core (lower position ranks
//! higher; holders of the top position act as the community's owners): a UI shows what they allow
//! and never re-derives them.

use super::{AdminOp, LoadState, NotAllowed, UserView};

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
    /// The Member role: always last, never moved, renamed or deleted.
    pub fixed: bool,
    /// One place up or down is a reorder the server takes from this user (`reorder_roles` with
    /// the two swapped): neither neighbour is at or above their rank, and `fixed` never moves.
    pub can_move_up: bool,
    pub can_move_down: bool,
    pub created_at_ms: Option<i64>,
    /// Why `editable`, `deletable` or `assignable` is false, when it is.
    pub edit_blocked: Option<RoleBlock>,
    pub delete_blocked: Option<RoleBlock>,
    pub assign_blocked: Option<RoleBlock>,
}

/// Why a role can't be edited, deleted or assigned by this user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoleBlock {
    /// They lack UPDATE_ROLE, DELETE_ROLE or UPDATE_MEMBER.
    Missing,
    /// The role is at or above their own best one.
    Rank,
    /// It holds an action they lack, and the server refuses a role like that whole (#690).
    HoldsUngrantable,
    /// A default role can't be deleted.
    DefaultRole,
}

/// What `Core::update_role` changes: `None` is left as it is and isn't sent. A default role's name
/// is never sent (the server refuses a rename). `actions` replaces the whole list, unknown ones
/// included.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RolePatch {
    pub name: Option<String>,
    pub actions: Option<Vec<String>>,
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
    /// READ_ROLE (or the instance owner): false means the list is not allowed, not that it failed.
    pub can_read: bool,
    pub op: AdminOp,
}

/// A new role (`Core::create_role`): a name of 1 to 50 characters once trimmed, and its actions.
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
    /// Why this user can't change this member's roles at all (lacks UPDATE_MEMBER, doesn't
    /// outrank them), when they can't.
    pub not_allowed: Option<NotAllowed>,
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
    /// Its role is no longer one of the community's (read only; ignored when sent).
    pub role_missing: bool,
}

/// A community role as the overrides editor offers it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverwriteRoleOption {
    pub id: String,
    pub name: String,
    pub position: i32,
    /// Strictly below this user's best role (any, for the instance owner): one they may pick.
    pub below_me: bool,
}

/// Which preset a stored set of overrides is (`detectPreset`): `Custom` when none.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DetectedPreset {
    pub preset: ChannelPreset,
    /// Roles allowed every action the preset denies.
    pub post_role_ids: Vec<String>,
    pub members_can_attach: bool,
}

/// The actions this user lacks to apply a preset (the server refuses overrides of actions you
/// don't hold); empty means they may.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresetAccess {
    pub preset: ChannelPreset,
    pub missing: Vec<String>,
}

/// `Core::build_preset`: the overrides a preset is (`buildPresetOverwrites`), ready for
/// `replace_channel_overwrites`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BuiltPreset {
    pub preset: ChannelPreset,
    pub overwrites: Vec<OverwriteRow>,
    /// Roles at or above this user's rank that got an allow so the preset doesn't silence them.
    pub auto_allowed_role_ids: Vec<String>,
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
    /// The community's roles, highest first.
    pub roles: Vec<OverwriteRoleOption>,
    /// What the stored overrides are as a preset.
    pub detected: DetectedPreset,
    /// For Normal, ReadOnly and Announcement: what this user lacks to apply each.
    pub preset_access: Vec<PresetAccess>,
    /// Who posts when a read-only or announcement preset is first picked: the roles below this
    /// user that hold MANAGE_CHANNEL_PERMISSIONS (the web's default).
    pub default_post_role_ids: Vec<String>,
    pub op: AdminOp,
}

/// What `Core::replace_channel_overwrites` sends: the whole set.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OverwritesDraft {
    pub preset: ChannelPreset,
    pub overwrites: Vec<OverwriteRow>,
}
