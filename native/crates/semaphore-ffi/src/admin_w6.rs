//! W6: instance administration (lanes W6-A to W6-E). The records mirror
//! `semaphore_core::model::instance_admin`; the exports below only forward to core, so a lane
//! changes this file only if it changes a command's signature (with the coordinator).

use crate::SemaphoreCore;
use semaphore_core::CoreError;
use semaphore_core::model::{
    AdminCommunitiesView, AdminCommunityRow, AdminCommunityView, AdminDashboardView,
    AdminInvitesView, AdminNotAllowed, AdminOp, AdminPage, AdminStorageView, AdminUserActions,
    AdminUserQuery, AdminUserRolesView, AdminUserRow, AdminUserView, AdminUsersView, AttentionId,
    AttentionItem, AttentionSeverity, AttentionTarget, InstanceActionGroup, InstanceAdminCaps,
    InstanceInviteDraft, InstanceInviteRow, InstanceRoleDraft, InstanceRoleRef, InstanceRoleRow,
    InstanceRoleUsersView, InstanceRolesView, InstanceSettingsPatch, InstanceSettingsView,
    InstanceStats, InstanceStorage, InviteCommunity, LoadState, RegistrationMode, ServerHealth,
    StorageByKind, StorageDistribution, StorageRow, UserView,
};

#[uniffi::remote(Record)]
pub struct InstanceAdminCaps {
    pub show_admin: bool,
    pub dashboard: bool,
    pub settings_read: bool,
    pub settings_write: bool,
    pub users_read: bool,
    pub users_update: bool,
    pub users_ban: bool,
    pub users_delete: bool,
    pub storage: bool,
    pub communities_read: bool,
    pub communities_delete: bool,
    pub invites_read: bool,
    pub invites_create: bool,
    pub invites_delete: bool,
    pub roles_read: bool,
    pub roles_write: bool,
    pub is_owner: bool,
    pub full_authority: bool,
}

#[uniffi::remote(Record)]
pub struct InstanceActionGroup {
    pub label: String,
    pub actions: Vec<String>,
}

#[uniffi::remote(Enum)]
pub enum AttentionSeverity {
    Error,
    Warning,
}

#[uniffi::remote(Enum)]
pub enum AttentionId {
    Disk,
    OverQuota,
    StorageUnavailable,
    Livekit,
}

#[uniffi::remote(Enum)]
pub enum AdminPage {
    Dashboard,
    Users,
    Communities,
    Invites,
    Roles,
    Storage,
    Settings,
}

#[uniffi::remote(Enum)]
pub enum AttentionTarget {
    Page {
        page: AdminPage,
        storage_min_percent: Option<u32>,
    },
    Url {
        url: String,
    },
    Retry,
}

#[uniffi::remote(Record)]
pub struct AttentionItem {
    pub id: AttentionId,
    pub severity: AttentionSeverity,
    pub title: String,
    pub detail: Option<String>,
    pub target: AttentionTarget,
    pub action_label: String,
}

#[uniffi::remote(Record)]
pub struct InstanceStats {
    pub total_users: u64,
    pub total_communities: u64,
    pub total_channels: u64,
    pub total_messages: u64,
    pub active_invites: u64,
    pub banned_users: u64,
}

#[uniffi::remote(Record)]
pub struct ServerHealth {
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub memory_used_percent: f64,
    pub cpu_cores: u32,
    pub cpu_model: String,
    pub load_average: Vec<f64>,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_free_bytes: u64,
    pub disk_used_percent: f64,
    pub platform: String,
    pub hostname: String,
    pub uptime_secs: u64,
}

#[uniffi::remote(Record)]
pub struct StorageByKind {
    pub kind: String,
    pub bytes: u64,
    pub count: u64,
}

#[uniffi::remote(Record)]
pub struct StorageDistribution {
    pub under_25: u64,
    pub under_50: u64,
    pub under_75: u64,
    pub under_90: u64,
    pub over_90: u64,
}

#[uniffi::remote(Record)]
pub struct InstanceStorage {
    pub total_used_bytes: u64,
    pub total_files: u64,
    pub total_users: u64,
    pub average_per_user_bytes: u64,
    pub distribution: StorageDistribution,
    pub by_kind: Vec<StorageByKind>,
    pub default_quota_bytes: u64,
    pub max_file_bytes: u64,
    pub users_approaching_quota: u64,
    pub users_over_quota: u64,
    pub server: ServerHealth,
}

#[uniffi::remote(Record)]
pub struct AdminDashboardView {
    pub state: LoadState,
    pub stats: Option<InstanceStats>,
    pub storage: Option<InstanceStorage>,
    pub livekit_configured: Option<bool>,
    pub attention: Vec<AttentionItem>,
}

#[uniffi::remote(Record)]
pub struct InstanceSettingsView {
    pub state: LoadState,
    pub name: String,
    pub description: Option<String>,
    pub registration: RegistrationMode,
    pub default_quota_bytes: u64,
    pub max_file_bytes: u64,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct InstanceSettingsPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub registration: Option<RegistrationMode>,
    pub default_quota_bytes: Option<u64>,
    pub max_file_bytes: Option<u64>,
}

#[uniffi::remote(Record)]
pub struct AdminUserQuery {
    pub search: String,
    pub banned: Option<bool>,
    pub owners: Option<bool>,
}

#[uniffi::remote(Enum)]
pub enum AdminNotAllowed {
    Myself,
    Owner,
    OnlyOwner,
    LastOwner,
    Rank,
    NoPermission,
}

#[uniffi::remote(Record)]
pub struct AdminUserActions {
    pub ban: Option<AdminNotAllowed>,
    pub unban: Option<AdminNotAllowed>,
    pub delete: Option<AdminNotAllowed>,
    pub reset_password: Option<AdminNotAllowed>,
    pub set_owner: Option<AdminNotAllowed>,
    pub edit_roles: Option<AdminNotAllowed>,
    pub set_quota: Option<AdminNotAllowed>,
}

#[uniffi::remote(Record)]
pub struct AdminUserRow {
    pub user: UserView,
    pub email: Option<String>,
    pub is_owner: bool,
    pub banned: bool,
    pub banned_at_ms: Option<i64>,
    pub created_at_ms: i64,
    pub last_seen_ms: Option<i64>,
    pub storage_used_bytes: u64,
    pub storage_quota_bytes: u64,
    pub actions: AdminUserActions,
}

#[uniffi::remote(Record)]
pub struct AdminUsersView {
    pub state: LoadState,
    pub query: AdminUserQuery,
    pub rows: Vec<AdminUserRow>,
    pub more: bool,
    pub loading_more: bool,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct AdminUserView {
    pub state: LoadState,
    pub user: Option<AdminUserRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct InstanceRoleRef {
    pub id: String,
    pub name: String,
}

#[uniffi::remote(Record)]
pub struct AdminUserRolesView {
    pub state: LoadState,
    pub user_id: String,
    pub held: Vec<InstanceRoleRef>,
    pub available: Vec<InstanceRoleRef>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct StorageRow {
    pub user_id: String,
    pub username: String,
    pub used_bytes: u64,
    pub quota_bytes: u64,
    pub percent_used: f64,
    pub file_count: u64,
}

#[uniffi::remote(Record)]
pub struct AdminStorageView {
    pub state: LoadState,
    pub min_percent: u32,
    pub rows: Vec<StorageRow>,
    pub total: u64,
    pub more: bool,
    pub loading_more: bool,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct AdminCommunityRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_file_id: Option<String>,
    pub member_count: u64,
    pub channel_count: u64,
    pub created_at_ms: i64,
}

#[uniffi::remote(Record)]
pub struct AdminCommunitiesView {
    pub state: LoadState,
    pub search: String,
    pub rows: Vec<AdminCommunityRow>,
    pub more: bool,
    pub loading_more: bool,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct AdminCommunityView {
    pub state: LoadState,
    pub community: Option<AdminCommunityRow>,
    pub message_count: u64,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct InviteCommunity {
    pub id: String,
    pub name: String,
}

#[uniffi::remote(Record)]
pub struct InstanceInviteRow {
    pub code: String,
    pub created_by: Option<UserView>,
    pub uses: u32,
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
    pub created_at_ms: i64,
    pub disabled: bool,
    pub communities: Vec<InviteCommunity>,
}

#[uniffi::remote(Record)]
pub struct AdminInvitesView {
    pub state: LoadState,
    pub rows: Vec<InstanceInviteRow>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct InstanceInviteDraft {
    pub community_ids: Vec<String>,
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
}

#[uniffi::remote(Record)]
pub struct InstanceRoleRow {
    pub id: String,
    pub actions: Vec<String>,
    pub name: String,
    pub is_default: bool,
    pub position: i64,
    pub editable: bool,
    pub deletable: bool,
}

#[uniffi::remote(Record)]
pub struct InstanceRolesView {
    pub state: LoadState,
    pub roles: Vec<InstanceRoleRow>,
    pub grantable: Vec<String>,
    pub op: AdminOp,
}

#[uniffi::remote(Record)]
pub struct InstanceRoleDraft {
    pub name: String,
    pub actions: Vec<String>,
}

#[uniffi::remote(Record)]
pub struct InstanceRoleUsersView {
    pub state: LoadState,
    pub role_id: String,
    pub users: Vec<UserView>,
    pub op: AdminOp,
}

/// The instance role editor's groups (`semaphore_core::model::instance_action_groups`).
#[uniffi::export]
pub fn instance_action_groups() -> Vec<InstanceActionGroup> {
    semaphore_core::model::instance_action_groups()
}

#[uniffi::export]
impl SemaphoreCore {
    // W6-A
    pub fn admin_dashboard(&self) -> AdminDashboardView {
        self.core.admin_dashboard()
    }

    pub fn instance_settings(&self) -> InstanceSettingsView {
        self.core.instance_settings()
    }

    pub async fn update_instance_settings(
        &self,
        patch: InstanceSettingsPatch,
    ) -> Result<(), CoreError> {
        self.core.update_instance_settings(patch).await
    }

    // W6-B
    pub fn admin_users(&self, query: AdminUserQuery) -> AdminUsersView {
        self.core.admin_users(query)
    }

    pub async fn load_more_admin_users(&self, query: AdminUserQuery) -> Result<(), CoreError> {
        self.core.load_more_admin_users(query).await
    }

    pub fn admin_user(&self, user_id: String) -> AdminUserView {
        self.core.admin_user(user_id)
    }

    pub fn admin_user_roles(&self, user_id: String) -> AdminUserRolesView {
        self.core.admin_user_roles(user_id)
    }

    pub async fn set_user_owner(&self, user_id: String, owner: bool) -> Result<(), CoreError> {
        self.core.set_user_owner(user_id, owner).await
    }

    pub async fn ban_user(&self, user_id: String) -> Result<(), CoreError> {
        self.core.ban_user(user_id).await
    }

    pub async fn unban_user(&self, user_id: String) -> Result<(), CoreError> {
        self.core.unban_user(user_id).await
    }

    pub async fn reset_user_password(
        &self,
        user_id: String,
        password: String,
    ) -> Result<(), CoreError> {
        self.core.reset_user_password(user_id, password).await
    }

    pub async fn delete_user(&self, user_id: String) -> Result<(), CoreError> {
        self.core.delete_user(user_id).await
    }

    pub async fn assign_instance_role(
        &self,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        self.core.assign_instance_role(user_id, role_id).await
    }

    pub async fn unassign_instance_role(
        &self,
        user_id: String,
        role_id: String,
    ) -> Result<(), CoreError> {
        self.core.unassign_instance_role(user_id, role_id).await
    }

    // W6-C
    pub fn admin_storage(&self, min_percent: u32) -> AdminStorageView {
        self.core.admin_storage(min_percent)
    }

    pub async fn load_more_storage(&self, min_percent: u32) -> Result<(), CoreError> {
        self.core.load_more_storage(min_percent).await
    }

    pub async fn set_user_quota(&self, user_id: String, quota_bytes: u64) -> Result<(), CoreError> {
        self.core.set_user_quota(user_id, quota_bytes).await
    }

    pub async fn recalculate_storage(&self, user_id: String) -> Result<(), CoreError> {
        self.core.recalculate_storage(user_id).await
    }

    // W6-D
    pub fn admin_communities(&self, search: String) -> AdminCommunitiesView {
        self.core.admin_communities(search)
    }

    pub async fn load_more_admin_communities(&self, search: String) -> Result<(), CoreError> {
        self.core.load_more_admin_communities(search).await
    }

    pub fn admin_community(&self, community_id: String) -> AdminCommunityView {
        self.core.admin_community(community_id)
    }

    pub async fn force_delete_community(&self, community_id: String) -> Result<(), CoreError> {
        self.core.force_delete_community(community_id).await
    }

    pub fn admin_invites(&self) -> AdminInvitesView {
        self.core.admin_invites()
    }

    pub async fn create_instance_invite(
        &self,
        draft: InstanceInviteDraft,
    ) -> Result<String, CoreError> {
        self.core.create_instance_invite(draft).await
    }

    pub async fn delete_instance_invite(&self, code: String) -> Result<(), CoreError> {
        self.core.delete_instance_invite(code).await
    }

    // W6-E
    pub fn instance_roles(&self) -> InstanceRolesView {
        self.core.instance_roles()
    }

    pub async fn create_instance_role(
        &self,
        draft: InstanceRoleDraft,
    ) -> Result<String, CoreError> {
        self.core.create_instance_role(draft).await
    }

    pub async fn update_instance_role(
        &self,
        role_id: String,
        draft: InstanceRoleDraft,
    ) -> Result<(), CoreError> {
        self.core.update_instance_role(role_id, draft).await
    }

    pub async fn delete_instance_role(&self, role_id: String) -> Result<(), CoreError> {
        self.core.delete_instance_role(role_id).await
    }

    pub fn instance_role_users(&self, role_id: String) -> InstanceRoleUsersView {
        self.core.instance_role_users(role_id)
    }
}
