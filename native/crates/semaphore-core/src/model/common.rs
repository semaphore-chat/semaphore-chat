//! Shared by every area: conversations, users, errors, and what a UI re-reads and waits on.

/// Where messages live. A thread is keyed by its parent message.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Conversation {
    Channel { id: String },
    DirectMessage { id: String },
    Thread { parent_message_id: String },
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserView {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_file_id: Option<String>,
}

/// A failure a UI can show. `code` is the server's `ErrorCode` as sent, including ones this
/// build has never heard of; decide by `retryable`, not by matching every code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorView {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub retry_after_ms: Option<u64>,
}

/// A part of the UI to re-read from core after `CoreEvent::ViewChanged`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ViewKey {
    Session,
    Communities,
    Channels {
        community_id: String,
    },
    Mentionables {
        community_id: String,
    },
    Members {
        community_id: String,
    },
    Rail,
    Voice,
    Typing {
        conversation: Conversation,
    },
    /// `Core::pinned_messages`.
    Pins {
        channel_id: String,
    },
    /// `Core::reaction_users`.
    ReactionUsers {
        message_id: String,
        emoji: String,
    },
    /// `Core::thread_info`.
    Thread {
        parent_message_id: String,
    },
    /// `Core::unread_marker`.
    UnreadMarker {
        conversation: Conversation,
    },
    /// `Core::channel_moderation`.
    ChannelModeration {
        channel_id: String,
    },
    /// `Core::dm_list` and `Core::dm`.
    DirectMessages,
    /// `Core::friends`.
    Friends,
    /// `Core::notifications`.
    Notifications,
    /// `Core::notification_settings`.
    NotificationSettings,
    /// `Core::channel_notify_level`.
    ChannelNotifyLevel {
        channel_id: String,
    },
    /// `Core::badge_count`: the tray and dock badge.
    Badge,
    /// `Core::profile`.
    Profile {
        user_id: String,
    },
    /// `Core::profile_edit`.
    ProfileEdit,
    /// `Core::sessions`.
    Sessions,
    /// `Core::appearance`.
    Appearance,
    /// `Core::invite_preview`.
    InvitePreview {
        code: String,
    },
    /// `Core::browser_sign_in`.
    BrowserSignIn,
    /// `Core::instance_permissions`.
    InstancePermissions,
    /// W4: `Core::incoming_call`.
    IncomingCall,
    /// W4: `Core::soundboard`.
    Soundboard {
        community_id: String,
    },
    /// W4: `Core::clips`, my clip library.
    Clips,
    /// W4: `Core::user_clips`.
    UserClips {
        user_id: String,
    },
    /// W4: `Core::replay_session`.
    ReplaySession,
    /// W4: `Core::voice_diagnostics`.
    VoiceDiagnostics,
    /// W5: `Core::community_settings`.
    CommunitySettings {
        community_id: String,
    },
    /// W5: `Core::private_members`.
    PrivateMembers {
        channel_id: String,
    },
    /// W5: `Core::alias_groups`.
    AliasGroups {
        community_id: String,
    },
    /// W5: `Core::alias_group`.
    AliasGroup {
        group_id: String,
    },
    /// W5: `Core::custom_emoji`.
    CustomEmoji {
        community_id: String,
    },
    /// W5: `Core::webhooks`.
    Webhooks {
        channel_id: String,
    },
    /// W5: `Core::community_invites`, for every community (the server lists all of mine at once).
    Invites,
    /// W5: `Core::community_permissions`.
    CommunityPermissions {
        community_id: String,
    },
    /// W5: `Core::roles`.
    Roles {
        community_id: String,
    },
    /// W5: `Core::role_members`.
    RoleMembers {
        community_id: String,
        role_id: String,
    },
    /// W5: `Core::member_roles`.
    MemberRoles {
        community_id: String,
        user_id: String,
    },
    /// W5: `Core::channel_overwrites`.
    ChannelOverwrites {
        channel_id: String,
    },
    /// W5: `Core::moderation_target`.
    ModerationTarget {
        community_id: String,
        user_id: String,
    },
    /// W5: `Core::bans`.
    Bans {
        community_id: String,
    },
    /// W5: `Core::timeouts`.
    Timeouts {
        community_id: String,
    },
    /// W5: `Core::moderation_log`.
    ModerationLog {
        community_id: String,
    },
    /// W6-A: `Core::admin_dashboard`.
    AdminDashboard,
    /// W6-A: `Core::instance_settings`.
    InstanceSettings,
    /// W6-B: `Core::admin_users`.
    AdminUsers {
        query: super::AdminUserQuery,
    },
    /// W6-B: `Core::admin_user`.
    AdminUser {
        user_id: String,
    },
    /// W6-B: `Core::admin_user_roles`.
    AdminUserRoles {
        user_id: String,
    },
    /// W6-C: `Core::admin_storage`.
    AdminStorage {
        min_percent: u32,
    },
    /// W6-D: `Core::admin_communities`.
    AdminCommunities {
        search: String,
    },
    /// W6-D: `Core::admin_community`.
    AdminCommunity {
        community_id: String,
    },
    /// W6-D: `Core::admin_invites`.
    AdminInvites,
    /// W6-E: `Core::instance_roles`.
    InstanceRoles,
    /// W6-E: `Core::instance_role_users`.
    InstanceRoleUsers {
        role_id: String,
    },
    /// W7-A: `Core::gifs` (an empty query is the featured list).
    Gifs {
        query: String,
    },
}

/// Whether a list a UI reads from core has arrived. `ViewChanged` for the same `ViewKey` says when to
/// ask again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum LoadState {
    #[default]
    Loading,
    Ready,
    /// The last fetch failed. Core won't try again until `Core::retry_failed`, or a new connection.
    Failed {
        error: ErrorView,
    },
}
