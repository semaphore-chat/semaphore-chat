//! Instance administration: the dashboard, instance settings, users, storage, communities,
//! instance invites and instance roles. Wave 6 (lanes W6-A to W6-E, `commands/instance_admin/`).
//!
//! What this user may open and do is `InstancePermissionsView::admin` (`InstanceAdminCaps`); a
//! user row says per action whether it's allowed (`AdminUserActions`). An instance owner may do
//! everything here: the server lets the owner past every instance check.
//!
//! None of these has socket events: each view is read again when shown and older than
//! `ADMIN_STALE_MS` (30 s), after this user's own change, and on a new connection.

use super::{AdminOp, LoadState, RegistrationMode, UserView};

/// What this user may do on the instance, from their instance roles (an owner: everything).
/// Each flag is one RBAC action unless it says otherwise. False until known.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceAdminCaps {
    /// Show the Admin entry: an owner, or anyone holding any of the actions below.
    pub show_admin: bool,
    /// `READ_INSTANCE_STATS`: the dashboard.
    pub dashboard: bool,
    /// `READ_INSTANCE_SETTINGS`.
    pub settings_read: bool,
    /// `UPDATE_INSTANCE_SETTINGS`.
    pub settings_write: bool,
    /// `READ_USER`.
    pub users_read: bool,
    /// `UPDATE_USER`: roles and passwords.
    pub users_update: bool,
    /// `BAN_USER`.
    pub users_ban: bool,
    /// `DELETE_USER`.
    pub users_delete: bool,
    /// `MANAGE_USER_STORAGE`.
    pub storage: bool,
    /// `READ_ALL_COMMUNITIES`. No role can hold it today (#706): in practice owners only.
    pub communities_read: bool,
    /// `DELETE_COMMUNITY`.
    pub communities_delete: bool,
    /// `READ_INSTANCE_INVITE`.
    pub invites_read: bool,
    /// `CREATE_INSTANCE_INVITE`.
    pub invites_create: bool,
    /// `DELETE_INSTANCE_INVITE`.
    pub invites_delete: bool,
    /// `READ_INSTANCE_SETTINGS`: the instance roles list.
    pub roles_read: bool,
    /// `UPDATE_INSTANCE_SETTINGS`: create, edit and delete instance roles.
    pub roles_write: bool,
    /// The instance owner.
    pub is_owner: bool,
    /// The owner, or someone holding every action of the default Instance Admin role
    /// (`INSTANCE_ADMIN_ACTIONS`): below that, a user can only grant, and only act on users
    /// holding, instance actions they hold themselves.
    pub full_authority: bool,
}

/// The 12 actions an instance role may hold: the default Instance Admin role's
/// (`backend/src/roles/default-roles.config.ts`), as wire names.
pub const INSTANCE_ADMIN_ACTIONS: [&str; 12] = [
    "READ_INSTANCE_SETTINGS",
    "UPDATE_INSTANCE_SETTINGS",
    "READ_INSTANCE_STATS",
    "MANAGE_USER_STORAGE",
    "READ_USER",
    "UPDATE_USER",
    "BAN_USER",
    "DELETE_USER",
    "READ_INSTANCE_INVITE",
    "CREATE_INSTANCE_INVITE",
    "DELETE_INSTANCE_INVITE",
    "UPDATE_INSTANCE_INVITE",
];

/// One group of the instance role editor's permission list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceActionGroup {
    pub label: String,
    /// Wire names, in the order shown.
    pub actions: Vec<String>,
}

/// The instance role editor's groups: every action of `INSTANCE_ADMIN_ACTIONS` exactly once.
pub fn instance_action_groups() -> Vec<InstanceActionGroup> {
    let group = |label: &str, actions: &[&str]| InstanceActionGroup {
        label: label.into(),
        actions: actions.iter().map(|action| (*action).to_owned()).collect(),
    };
    vec![
        group(
            "Instance",
            &[
                "READ_INSTANCE_SETTINGS",
                "UPDATE_INSTANCE_SETTINGS",
                "READ_INSTANCE_STATS",
                "MANAGE_USER_STORAGE",
            ],
        ),
        group(
            "Users",
            &["READ_USER", "UPDATE_USER", "BAN_USER", "DELETE_USER"],
        ),
        group(
            "Invites",
            &[
                "READ_INSTANCE_INVITE",
                "CREATE_INSTANCE_INVITE",
                "DELETE_INSTANCE_INVITE",
                "UPDATE_INSTANCE_INVITE",
            ],
        ),
    ]
}

// ---- W6-A: dashboard and instance settings ----

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum AttentionSeverity {
    Error,
    #[default]
    Warning,
}

/// Which attention item, as the web's `adminAttention.ts` names them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum AttentionId {
    #[default]
    Disk,
    OverQuota,
    StorageUnavailable,
    Livekit,
}

/// A page of the admin area.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum AdminPage {
    #[default]
    Dashboard,
    Users,
    Communities,
    Invites,
    Roles,
    Storage,
    Settings,
}

/// Where an attention item's action goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttentionTarget {
    /// An admin page; for Storage, the usage filter to open it with.
    Page {
        page: AdminPage,
        storage_min_percent: Option<u32>,
    },
    /// A web page (the LiveKit setup docs).
    Url { url: String },
    /// Read the dashboard again (`Core::retry_failed`).
    Retry,
}

/// Something on the instance that needs an admin's attention.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionItem {
    pub id: AttentionId,
    pub severity: AttentionSeverity,
    pub title: String,
    pub detail: Option<String>,
    pub target: AttentionTarget,
    pub action_label: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceStats {
    pub total_users: u64,
    pub total_communities: u64,
    pub total_channels: u64,
    pub total_messages: u64,
    pub active_invites: u64,
    pub banned_users: u64,
}

/// The server's own resources, from the instance storage stats.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ServerHealth {
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub memory_used_percent: f64,
    pub cpu_cores: u32,
    pub cpu_model: String,
    /// 1, 5 and 15 minute averages.
    pub load_average: Vec<f64>,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_free_bytes: u64,
    pub disk_used_percent: f64,
    pub platform: String,
    pub hostname: String,
    pub uptime_secs: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StorageByKind {
    /// The server's resource type name, as sent.
    pub kind: String,
    pub bytes: u64,
    pub count: u64,
}

/// How many users are in each band of quota use.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StorageDistribution {
    pub under_25: u64,
    pub under_50: u64,
    pub under_75: u64,
    pub under_90: u64,
    pub over_90: u64,
}

/// `GET /storage/instance`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct InstanceStorage {
    pub total_used_bytes: u64,
    pub total_files: u64,
    pub total_users: u64,
    pub average_per_user_bytes: u64,
    pub distribution: StorageDistribution,
    pub by_kind: Vec<StorageByKind>,
    pub default_quota_bytes: u64,
    pub max_file_bytes: u64,
    /// Over 75% of their quota.
    pub users_approaching_quota: u64,
    /// Over 90% of their quota.
    pub users_over_quota: u64,
    pub server: ServerHealth,
}

/// `Core::admin_dashboard`. `ViewKey::AdminDashboard` says when to read again. `state` is the
/// stats' read; a storage read that failed shows as the `StorageUnavailable` attention item.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AdminDashboardView {
    pub state: LoadState,
    pub stats: Option<InstanceStats>,
    pub storage: Option<InstanceStorage>,
    /// `GET /livekit/health`'s `configured`, once read.
    pub livekit_configured: Option<bool>,
    /// Errors first.
    pub attention: Vec<AttentionItem>,
}

/// `Core::instance_settings`. `ViewKey::InstanceSettings` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceSettingsView {
    pub state: LoadState,
    pub name: String,
    pub description: Option<String>,
    pub registration: RegistrationMode,
    pub default_quota_bytes: u64,
    pub max_file_bytes: u64,
    pub op: AdminOp,
}

/// What `Core::update_instance_settings` changes: each `None` is left as it is. An empty
/// `description` clears it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceSettingsPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub registration: Option<RegistrationMode>,
    pub default_quota_bytes: Option<u64>,
    pub max_file_bytes: Option<u64>,
}

// ---- W6-B: users ----

/// The users list's filters. Each distinct value is its own cached list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub struct AdminUserQuery {
    /// Username, display name or email contains this; empty for everyone.
    pub search: String,
    /// `Some(true)`: banned only; `Some(false)`: not banned only.
    pub banned: Option<bool>,
    /// `Some(true)`: owners only; `Some(false)`: everyone but owners.
    pub owners: Option<bool>,
}

/// Why an action on a user isn't offered (shown disabled, with this reason).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AdminNotAllowed {
    /// It's me (ban, delete).
    Myself,
    /// The target is an instance owner (ban, delete; a password unless I'm an owner too).
    Owner,
    /// Only an owner may grant or take the owner role.
    OnlyOwner,
    /// The last owner can't be demoted.
    LastOwner,
    /// Below full authority, the target holds an instance action I don't.
    Rank,
    /// I don't hold the action.
    NoPermission,
}

/// Per action on one user: `None` allowed, else why not.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminUserActions {
    pub ban: Option<AdminNotAllowed>,
    pub unban: Option<AdminNotAllowed>,
    pub delete: Option<AdminNotAllowed>,
    pub reset_password: Option<AdminNotAllowed>,
    pub set_owner: Option<AdminNotAllowed>,
    pub edit_roles: Option<AdminNotAllowed>,
    pub set_quota: Option<AdminNotAllowed>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
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

/// `Core::admin_users`. `ViewKey::AdminUsers { query }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminUsersView {
    pub state: LoadState,
    pub query: AdminUserQuery,
    pub rows: Vec<AdminUserRow>,
    /// The server has more: `Core::load_more_admin_users`.
    pub more: bool,
    pub loading_more: bool,
    pub op: AdminOp,
}

/// `Core::admin_user`. `ViewKey::AdminUser { user_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminUserView {
    pub state: LoadState,
    pub user: Option<AdminUserRow>,
    pub op: AdminOp,
}

/// An instance role, by name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceRoleRef {
    pub id: String,
    pub name: String,
}

/// `Core::admin_user_roles`: a user's instance roles. `ViewKey::AdminUserRoles { user_id }`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminUserRolesView {
    pub state: LoadState,
    pub user_id: String,
    pub held: Vec<InstanceRoleRef>,
    /// Roles the user doesn't hold that I may grant.
    pub available: Vec<InstanceRoleRef>,
    pub op: AdminOp,
}

// ---- W6-C: storage ----

#[derive(Debug, Clone, Default, PartialEq)]
pub struct StorageRow {
    pub user_id: String,
    pub username: String,
    pub used_bytes: u64,
    pub quota_bytes: u64,
    pub percent_used: f64,
    pub file_count: u64,
}

/// `Core::admin_storage`. `ViewKey::AdminStorage { min_percent }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AdminStorageView {
    pub state: LoadState,
    pub min_percent: u32,
    pub rows: Vec<StorageRow>,
    pub total: u64,
    pub more: bool,
    pub loading_more: bool,
    pub op: AdminOp,
}

// ---- W6-D: communities and instance invites ----

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminCommunityRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_file_id: Option<String>,
    pub member_count: u64,
    pub channel_count: u64,
    pub created_at_ms: i64,
}

/// `Core::admin_communities`. `ViewKey::AdminCommunities { search }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminCommunitiesView {
    pub state: LoadState,
    pub search: String,
    pub rows: Vec<AdminCommunityRow>,
    pub more: bool,
    pub loading_more: bool,
    pub op: AdminOp,
}

/// `Core::admin_community`. `ViewKey::AdminCommunity { community_id }`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminCommunityView {
    pub state: LoadState,
    pub community: Option<AdminCommunityRow>,
    pub message_count: u64,
    pub op: AdminOp,
}

/// A community an invite adds its users to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InviteCommunity {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
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

/// `Core::admin_invites`: every instance invite the server lists. `ViewKey::AdminInvites`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminInvitesView {
    pub state: LoadState,
    pub rows: Vec<InstanceInviteRow>,
    pub op: AdminOp,
}

/// A new instance invite. `None` means no limit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceInviteDraft {
    pub community_ids: Vec<String>,
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
}

// ---- W6-E: instance roles ----

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceRoleRow {
    pub id: String,
    /// Wire names; ones this build doesn't know are kept.
    pub actions: Vec<String>,
    pub name: String,
    pub is_default: bool,
    pub position: i64,
    /// I may change it: full authority, or I hold every action it has.
    pub editable: bool,
    /// Not the default Instance Admin role, and `editable`. The server also refuses a role
    /// that still has users.
    pub deletable: bool,
}

/// `Core::instance_roles`. `ViewKey::InstanceRoles` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceRolesView {
    pub state: LoadState,
    pub roles: Vec<InstanceRoleRow>,
    /// The actions I may put in a role (all 12 with full authority, else the ones I hold).
    pub grantable: Vec<String>,
    pub op: AdminOp,
}

/// A new instance role, or an edit of one (the name and the whole action list).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceRoleDraft {
    pub name: String,
    pub actions: Vec<String>,
}

/// `Core::instance_role_users`. `ViewKey::InstanceRoleUsers { role_id }`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstanceRoleUsersView {
    pub state: LoadState,
    pub role_id: String,
    pub users: Vec<UserView>,
    pub op: AdminOp,
}
