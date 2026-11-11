//! Communities, channels, permissions, members and the rail's counters.

use super::UserView;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommunityRow {
    pub id: String,
    pub name: String,
    pub avatar_file_id: Option<String>,
    pub unread_count: u32,
    pub mention_count: u32,
}

/// Enums grow on the server, so each has a variant for what this build doesn't know.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelKind {
    Text,
    Voice,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelRow {
    pub id: String,
    pub community_id: String,
    pub name: String,
    pub kind: ChannelKind,
    pub is_private: bool,
    pub position: i32,
    pub unread_count: u32,
    pub mention_count: u32,
    /// Who is in the channel, for a voice channel.
    pub voice_users: Vec<UserView>,
    /// The gap the server enforces between this user's messages. 0 means none.
    pub slowmode_seconds: u32,
    /// `None` while they load, or if they failed to. Fail open then, as the web does: the server
    /// enforces them either way.
    pub permissions: Option<ChannelPermissions>,
}

/// What this user may do in a channel.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelPermissions {
    pub post: bool,
    pub attach: bool,
    pub react: bool,
    pub thread_reply: bool,
    pub connect: bool,
    pub speak: bool,
    pub video: bool,
    pub share: bool,
    pub manage_permissions: bool,
    /// Roles whose holders can post here, by rank, for the read-only notice.
    pub posting_role_names: Vec<String>,
    /// The end of this user's community timeout, if one is active.
    pub timed_out_until_ms: Option<i64>,
}

/// A custom emoji, so a UI can turn `SegKind::Emoji`'s id into a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmojiView {
    pub id: String,
    pub name: String,
    pub file_id: String,
}

/// A member's highest role other than the community's default. Lower positions rank higher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayRole {
    pub name: String,
    pub position: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberView {
    pub user: UserView,
    pub status: Option<String>,
    pub online: bool,
    pub display_role: Option<DisplayRole>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MemberList {
    pub members: Vec<MemberView>,
    /// The community has more members than core reads (1000), so this isn't all of them.
    pub truncated: bool,
}

/// The rail's counters.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RailCounts {
    pub dm_unread: u32,
    pub notifications_unread: u32,
}
