//! W5: what this user may do in a community, and moderation: ban, kick, timeout, their lists and
//! the moderation log. Unit W5-B.
//!
//! Core works these out the way the server decides (`RbacGuard`, `PermissionsService`,
//! `ModerationService`): the instance owner skips RBAC; community actions are the union of the
//! user's community roles; moderating someone needs a role that strictly outranks theirs (lower
//! position ranks higher). The server stays the judge: a refusal shows its message.

use super::{AdminOp, LoadState, UserView};

/// The web's timeout lengths (`TimeoutDialog.tsx`), in seconds.
pub const TIMEOUT_PRESETS_SECONDS: [u32; 6] = [60, 300, 600, 3_600, 86_400, 604_800];
/// The web's temporary ban lengths (`BanDialog.tsx`), in seconds. Permanent is
/// `BanDuration::Permanent`.
pub const BAN_PRESETS_SECONDS: [u32; 4] = [3_600, 86_400, 604_800, 2_592_000];

/// What this user may do in a community, one flag per thing a UI offers. All false until
/// `CommunityPermissionsView::state` is `Ready`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CommunityCaps {
    pub update_community: bool,
    pub delete_community: bool,
    pub create_channel: bool,
    pub update_channel: bool,
    pub delete_channel: bool,
    /// Add and remove private channel members (CREATE_MEMBER and DELETE_MEMBER).
    pub manage_private_members: bool,
    pub manage_channel_permissions: bool,
    pub read_roles: bool,
    pub create_role: bool,
    pub update_role: bool,
    pub delete_role: bool,
    /// Give and take roles (UPDATE_MEMBER), within the rank rule.
    pub assign_roles: bool,
    pub read_members: bool,
    pub add_members: bool,
    pub read_alias_groups: bool,
    pub create_alias_group: bool,
    pub update_alias_group: bool,
    pub delete_alias_group: bool,
    /// Change a mention group's members.
    pub manage_alias_members: bool,
    pub manage_emoji: bool,
    pub read_sounds: bool,
    pub create_sound: bool,
    pub delete_sound: bool,
    pub manage_webhooks: bool,
    /// Community CREATE_INVITE and instance CREATE_INSTANCE_INVITE: the server asks for both.
    pub create_invite: bool,
    pub delete_invite: bool,
    pub ban: bool,
    pub unban: bool,
    pub kick: bool,
    pub timeout: bool,
    pub view_bans: bool,
    pub view_moderation_log: bool,
}

/// `Core::community_permissions`. `ViewKey::CommunityPermissions { community_id }` says when to
/// read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommunityPermissionsView {
    pub state: LoadState,
    pub community_id: String,
    pub caps: CommunityCaps,
    pub is_instance_owner: bool,
    /// This user's best role position here (lower ranks higher); `None` with no role.
    pub best_position: Option<i32>,
    /// They hold the community's top-ranked position, which acts as its owner for roles.
    pub is_top: bool,
}

/// Why an action on a member isn't offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotAllowed {
    /// This user lacks the action.
    Missing,
    /// The member ranks equal or higher (the instance owner too, when they hold no role here: the
    /// server doesn't let them past the rank rule).
    Rank,
    /// It's this user.
    SelfTarget,
}

/// What this user may do to one member. `ViewKey::ModerationTarget { community_id, user_id }`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModerationTargetView {
    pub state: LoadState,
    pub user_id: String,
    pub can_ban: bool,
    pub can_kick: bool,
    pub can_timeout: bool,
    pub can_remove_timeout: bool,
    pub can_change_roles: bool,
    /// Why ban, kick and timeout aren't offered, when none is.
    pub not_allowed: Option<NotAllowed>,
    /// Why each one isn't offered, when it isn't.
    pub ban_not_allowed: Option<NotAllowed>,
    pub kick_not_allowed: Option<NotAllowed>,
    pub timeout_not_allowed: Option<NotAllowed>,
    pub roles_not_allowed: Option<NotAllowed>,
    /// Ban, kick, timeout and lifting it, each with its own state.
    pub op: AdminOp,
    /// The member's active timeout, if any.
    pub timed_out_until_ms: Option<i64>,
}

/// A ban's length.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BanDuration {
    Permanent,
    Seconds { seconds: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BanRequest {
    pub reason: Option<String>,
    pub duration: BanDuration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeoutRequest {
    pub seconds: u32,
    pub reason: Option<String>,
}

/// An active ban.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BanRow {
    pub user: UserView,
    pub moderator: UserView,
    pub reason: Option<String>,
    pub created_at_ms: i64,
    /// `None`: permanent.
    pub expires_at_ms: Option<i64>,
    /// This user may lift it (not their own, not set by a higher rank).
    pub can_lift: bool,
}

/// `Core::bans`. `ViewKey::Bans { community_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BanListView {
    pub state: LoadState,
    pub community_id: String,
    pub bans: Vec<BanRow>,
    /// Unban, per member.
    pub op: AdminOp,
}

/// An active timeout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TimeoutRow {
    pub user: UserView,
    pub moderator: UserView,
    pub reason: Option<String>,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub can_lift: bool,
}

/// `Core::timeouts`. `ViewKey::Timeouts { community_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TimeoutListView {
    pub state: LoadState,
    pub community_id: String,
    pub timeouts: Vec<TimeoutRow>,
    /// Lifting, per member.
    pub op: AdminOp,
}

/// What a moderation log entry records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModerationLogRow {
    pub id: String,
    pub action: ModerationActionKind,
    pub moderator: Option<UserView>,
    pub target: Option<UserView>,
    pub reason: Option<String>,
    pub created_at_ms: i64,
    /// A timeout's or ban's length, when the entry has one.
    pub duration_seconds: Option<u32>,
    /// The message a delete, pin or unpin entry is about (`ModerationLogDto.targetMessageId`).
    pub target_message_id: Option<String>,
}

/// `Core::moderation_log`, newest first, a page at a time. `ViewKey::ModerationLog
/// { community_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModerationLogView {
    pub state: LoadState,
    pub community_id: String,
    pub rows: Vec<ModerationLogRow>,
    /// Only entries of this kind, when set.
    pub filter: Option<ModerationActionKind>,
    /// The server's count of entries matching the filter.
    pub total: u32,
    /// `Core::more_moderation_log` is reading the next page.
    pub loading_more: bool,
}

/// Why this user lost a community (`CoreEvent::CommunityRemoved`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemovalCause {
    Kicked {
        reason: Option<String>,
    },
    Banned {
        reason: Option<String>,
        /// `None`: permanent.
        until_ms: Option<i64>,
    },
    /// The community was deleted.
    Deleted,
}
