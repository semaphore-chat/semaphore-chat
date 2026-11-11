//! W5-B's roles, channel overrides, the community permission set and moderation.

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    AdminOp, BanDuration, BanListView, BanRequest, BanRow, BuiltPreset, ChannelOverwritesView,
    ChannelPreset, CommunityCaps, CommunityPermissionsView, DetectedPreset, LoadState,
    MemberRolesView, ModerationActionKind, ModerationLogRow, ModerationLogView,
    ModerationTargetView, NotAllowed, OverwriteRoleOption, OverwriteRow, OverwriteTarget,
    OverwritesDraft, PermissionGroup, PresetAccess, RemovalCause, RoleBlock, RoleDraft,
    RoleMembersView, RolePatch, RoleRow, RolesView, TimeoutListView, TimeoutRequest, TimeoutRow,
    UserView,
};

#[uniffi::remote(Record)]
pub struct RoleRow {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub is_default: bool,
    pub actions: Vec<String>,
    pub editable: bool,
    pub deletable: bool,
    pub assignable: bool,
    pub fixed: bool,
    pub can_move_up: bool,
    pub can_move_down: bool,
    pub created_at_ms: Option<i64>,
    pub edit_blocked: Option<RoleBlock>,
    pub delete_blocked: Option<RoleBlock>,
    pub assign_blocked: Option<RoleBlock>,
}

#[uniffi::remote(Enum)]
pub enum RoleBlock {
    Missing,
    Rank,
    HoldsUngrantable,
    DefaultRole,
}

#[uniffi::remote(Record)]
pub struct RolePatch {
    pub name: Option<String>,
    pub actions: Option<Vec<String>>,
}

#[uniffi::remote(Record)]
pub struct RolesView {
    pub state: LoadState,
    pub community_id: String,
    pub roles: Vec<RoleRow>,
    pub grantable: Vec<String>,
    pub can_create: bool,
    pub can_reorder: bool,
    pub can_reset_defaults: bool,
    pub can_read: bool,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct RoleDraft {
    pub name: String,
    pub actions: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct PermissionGroup {
    pub id: String,
    pub actions: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct RoleMembersView {
    pub state: LoadState,
    pub role_id: String,
    pub users: Vec<UserView>,
}

#[uniffi::remote(Record)]
pub struct MemberRolesView {
    pub state: LoadState,
    pub user_id: String,
    pub held: Vec<String>,
    pub changeable: Vec<String>,
    pub not_allowed: Option<NotAllowed>,
    pub op: AdminOp,
}

#[uniffi::remote(Enum)]
pub enum OverwriteTarget {
    Everyone,
    Role { role_id: String, name: String },
}

#[uniffi::remote(Enum)]
pub enum ChannelPreset {
    Normal,
    ReadOnly,
    Announcement,
    ModsOnly,
    Custom,
    Unknown,
}

#[uniffi::remote(Record)]
pub struct OverwriteRow {
    pub target: OverwriteTarget,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub role_missing: bool,
}

#[uniffi::remote(Record)]
pub struct OverwriteRoleOption {
    pub id: String,
    pub name: String,
    pub position: i32,
    pub below_me: bool,
}

#[uniffi::remote(Record)]
pub struct DetectedPreset {
    pub preset: ChannelPreset,
    pub post_role_ids: Vec<String>,
    pub members_can_attach: bool,
}

#[uniffi::remote(Record)]
pub struct PresetAccess {
    pub preset: ChannelPreset,
    pub missing: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct BuiltPreset {
    pub preset: ChannelPreset,
    pub overwrites: Vec<OverwriteRow>,
    pub auto_allowed_role_ids: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct ChannelOverwritesView {
    pub state: LoadState,
    pub channel_id: String,
    pub preset: ChannelPreset,
    pub overwrites: Vec<OverwriteRow>,
    pub editable: bool,
    pub roles: Vec<OverwriteRoleOption>,
    pub detected: DetectedPreset,
    pub preset_access: Vec<PresetAccess>,
    pub default_post_role_ids: Vec<String>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct OverwritesDraft {
    pub preset: ChannelPreset,
    pub overwrites: Vec<OverwriteRow>,
}

#[uniffi::remote(Record)]
pub struct CommunityCaps {
    pub update_community: bool,
    pub delete_community: bool,
    pub create_channel: bool,
    pub update_channel: bool,
    pub delete_channel: bool,
    pub manage_private_members: bool,
    pub manage_channel_permissions: bool,
    pub read_roles: bool,
    pub create_role: bool,
    pub update_role: bool,
    pub delete_role: bool,
    pub assign_roles: bool,
    pub read_members: bool,
    pub add_members: bool,
    pub read_alias_groups: bool,
    pub create_alias_group: bool,
    pub update_alias_group: bool,
    pub delete_alias_group: bool,
    pub manage_alias_members: bool,
    pub manage_emoji: bool,
    pub read_sounds: bool,
    pub create_sound: bool,
    pub delete_sound: bool,
    pub manage_webhooks: bool,
    pub create_invite: bool,
    pub delete_invite: bool,
    pub ban: bool,
    pub unban: bool,
    pub kick: bool,
    pub timeout: bool,
    pub view_bans: bool,
    pub view_moderation_log: bool,
}

#[uniffi::remote(Record)]
pub struct CommunityPermissionsView {
    pub state: LoadState,
    pub community_id: String,
    pub caps: CommunityCaps,
    pub is_instance_owner: bool,
    pub best_position: Option<i32>,
    pub is_top: bool,
}

#[uniffi::remote(Enum)]
pub enum NotAllowed {
    Missing,
    Rank,
    SelfTarget,
}

#[uniffi::remote(Record)]
pub struct ModerationTargetView {
    pub state: LoadState,
    pub user_id: String,
    pub can_ban: bool,
    pub can_kick: bool,
    pub can_timeout: bool,
    pub can_remove_timeout: bool,
    pub can_change_roles: bool,
    pub not_allowed: Option<NotAllowed>,
    pub ban_not_allowed: Option<NotAllowed>,
    pub kick_not_allowed: Option<NotAllowed>,
    pub timeout_not_allowed: Option<NotAllowed>,
    pub roles_not_allowed: Option<NotAllowed>,
    pub op: AdminOp,
    pub timed_out_until_ms: Option<i64>,
}

#[uniffi::remote(Enum)]
pub enum BanDuration {
    Permanent,
    Seconds { seconds: u32 },
}

#[uniffi::remote(Record)]
pub struct BanRequest {
    pub reason: Option<String>,
    pub duration: BanDuration,
}

#[uniffi::remote(Record)]
pub struct TimeoutRequest {
    pub seconds: u32,
    pub reason: Option<String>,
}

#[uniffi::remote(Record)]
pub struct BanRow {
    pub user: UserView,
    pub moderator: UserView,
    pub reason: Option<String>,
    pub created_at_ms: i64,
    pub expires_at_ms: Option<i64>,
    pub can_lift: bool,
}

#[uniffi::remote(Record)]
pub struct BanListView {
    pub state: LoadState,
    pub community_id: String,
    pub bans: Vec<BanRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct TimeoutRow {
    pub user: UserView,
    pub moderator: UserView,
    pub reason: Option<String>,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub can_lift: bool,
}

#[uniffi::remote(Record)]
pub struct TimeoutListView {
    pub state: LoadState,
    pub community_id: String,
    pub timeouts: Vec<TimeoutRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Enum)]
pub enum ModerationActionKind {
    Ban,
    Unban,
    Kick,
    Timeout,
    RemoveTimeout,
    DeleteMessage,
    PinMessage,
    UnpinMessage,
    Unknown,
}

#[uniffi::remote(Record)]
pub struct ModerationLogRow {
    pub id: String,
    pub action: ModerationActionKind,
    pub moderator: Option<UserView>,
    pub target: Option<UserView>,
    pub reason: Option<String>,
    pub created_at_ms: i64,
    pub duration_seconds: Option<u32>,
    pub target_message_id: Option<String>,
}

#[uniffi::remote(Record)]
pub struct ModerationLogView {
    pub state: LoadState,
    pub community_id: String,
    pub rows: Vec<ModerationLogRow>,
    pub filter: Option<ModerationActionKind>,
    pub total: u32,
    pub loading_more: bool,
}

#[uniffi::remote(Enum)]
pub enum RemovalCause {
    Kicked {
        reason: Option<String>,
    },
    Banned {
        reason: Option<String>,
        until_ms: Option<i64>,
    },
    Deleted,
}

#[uniffi::export]
impl SemaphoreCore {
    pub fn roles(&self, community_id: String) -> RolesView {
        self.core.roles(community_id)
    }

    pub fn permission_catalog(&self) -> Vec<PermissionGroup> {
        self.core.permission_catalog()
    }

    pub async fn create_role(
        &self,
        community_id: String,
        draft: RoleDraft,
    ) -> Result<String, CoreError> {
        self.core.create_role(community_id, draft).await
    }

    pub async fn update_role(
        &self,
        community_id: String,
        role_id: String,
        patch: RolePatch,
    ) -> Result<(), CoreError> {
        self.core.update_role(community_id, role_id, patch).await
    }

    pub async fn delete_role(
        &self,
        community_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        self.core.delete_role(community_id, role_id).await
    }

    pub async fn reorder_roles(
        &self,
        community_id: String,
        role_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        self.core.reorder_roles(community_id, role_ids).await
    }

    pub async fn reset_default_roles(&self, community_id: String) -> Result<(), CoreError> {
        self.core.reset_default_roles(community_id).await
    }

    pub fn role_members(&self, community_id: String, role_id: String) -> RoleMembersView {
        self.core.role_members(community_id, role_id)
    }

    pub fn member_roles(&self, community_id: String, user_id: String) -> MemberRolesView {
        self.core.member_roles(community_id, user_id)
    }

    pub async fn assign_role(
        &self,
        community_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        self.core.assign_role(community_id, user_id, role_id).await
    }

    pub async fn unassign_role(
        &self,
        community_id: String,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        self.core
            .unassign_role(community_id, user_id, role_id)
            .await
    }

    pub fn channel_overwrites(&self, channel_id: String) -> ChannelOverwritesView {
        self.core.channel_overwrites(channel_id)
    }

    pub fn build_preset(
        &self,
        channel_id: String,
        preset: ChannelPreset,
        post_role_ids: Vec<String>,
        members_can_attach: bool,
    ) -> BuiltPreset {
        self.core
            .build_preset(channel_id, preset, post_role_ids, members_can_attach)
    }

    pub async fn replace_channel_overwrites(
        &self,
        channel_id: String,
        draft: OverwritesDraft,
    ) -> Result<(), CoreError> {
        self.core
            .replace_channel_overwrites(channel_id, draft)
            .await
    }

    pub fn community_permissions(&self, community_id: String) -> CommunityPermissionsView {
        self.core.community_permissions(community_id)
    }

    pub fn moderation_target(&self, community_id: String, user_id: String) -> ModerationTargetView {
        self.core.moderation_target(community_id, user_id)
    }

    pub async fn ban_member(
        &self,
        community_id: String,
        user_id: String,
        request: BanRequest,
    ) -> Result<(), CoreError> {
        self.core.ban_member(community_id, user_id, request).await
    }

    pub async fn unban_member(
        &self,
        community_id: String,
        user_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.core.unban_member(community_id, user_id, reason).await
    }

    pub async fn timeout_member(
        &self,
        community_id: String,
        user_id: String,
        request: TimeoutRequest,
    ) -> Result<(), CoreError> {
        self.core
            .timeout_member(community_id, user_id, request)
            .await
    }

    pub async fn remove_timeout(
        &self,
        community_id: String,
        user_id: String,
        reason: Option<String>,
    ) -> Result<(), CoreError> {
        self.core
            .remove_timeout(community_id, user_id, reason)
            .await
    }

    pub fn bans(&self, community_id: String) -> BanListView {
        self.core.bans(community_id)
    }

    pub fn timeouts(&self, community_id: String) -> TimeoutListView {
        self.core.timeouts(community_id)
    }

    pub fn moderation_log(&self, community_id: String) -> ModerationLogView {
        self.core.moderation_log(community_id)
    }

    pub fn set_moderation_log_filter(
        &self,
        community_id: String,
        filter: Option<ModerationActionKind>,
    ) {
        self.core.set_moderation_log_filter(community_id, filter)
    }

    pub async fn more_moderation_log(&self, community_id: String) -> Result<(), CoreError> {
        self.core.more_moderation_log(community_id).await
    }

    pub fn timeout_elapsed(&self, community_id: String) {
        self.core.timeout_elapsed(community_id)
    }

    pub fn timeout_presets_seconds(&self) -> Vec<u32> {
        semaphore_core::model::TIMEOUT_PRESETS_SECONDS.to_vec()
    }

    pub fn ban_presets_seconds(&self) -> Vec<u32> {
        semaphore_core::model::BAN_PRESETS_SECONDS.to_vec()
    }
}
