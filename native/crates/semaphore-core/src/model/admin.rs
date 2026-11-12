//! W5: running a community. Its settings, channels, private channel members, mention groups,
//! custom emoji, soundboard sounds, webhooks and invites. Unit W5-A.
//!
//! What this user may do here is `CommunityPermissionsView` (W5-B's): a UI shows an action only
//! when its flag there says so, and never decides from roles itself.

use super::{ChannelKind, DraftFile, ErrorView, ImageChange, LoadState, UploadView, UserView};

/// A settings form's change on its way, and why the last one failed. Each view below carries one.
///
/// `busy`, `upload`, `error` and `action` describe the change started last on the view (`busy` is
/// any change running). Several can overlap on one view (a move on one channel row while another
/// is deleted), so `actions` keeps each separately, keyed by `AdminAction`: a row reads its own
/// entry and never shows another action's error. An entry goes when its action succeeds; a failed
/// one stays until the same action starts again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AdminOp {
    /// A change is on its way: the form's Save waits.
    pub busy: bool,
    /// The file going up for the last change (an avatar, banner, emoji or sound), while it does.
    pub upload: Option<UploadView>,
    /// Why the last change failed, until it starts again.
    pub error: Option<ErrorView>,
    /// W5: which change the fields above describe.
    pub action: Option<AdminAction>,
    /// W5: every change running or failed on this view, oldest started first.
    pub actions: Vec<AdminActionState>,
    /// W5: the changes that ended on this view, oldest first, the last [`FINISHED_KEPT`] of them.
    /// An entry in `actions` goes when its change succeeds, and a start and an end can reach a UI
    /// in one batch of events; this record can't be missed that way. A UI notes
    /// [`AdminOp::last_finished_seq`] when it sends, then waits for its action with a later
    /// `seq` ([`AdminOp::finished_since`]).
    pub finished: Vec<AdminActionOutcome>,
}

/// How many ended changes each view keeps in `AdminOp::finished`.
pub const FINISHED_KEPT: usize = 16;

/// A change that ended: succeeded, or failed (also refused before it was sent) with why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminActionOutcome {
    pub action: AdminAction,
    /// When it ended, in core's order of changes: always greater than any earlier one's.
    pub seq: u64,
    pub error: Option<ErrorView>,
}

impl AdminOp {
    /// The newest ended change's `seq`, or 0: what a UI notes as it sends a change.
    pub fn last_finished_seq(&self) -> u64 {
        self.finished.iter().map(|done| done.seq).max().unwrap_or(0)
    }

    /// `action`'s newest end after `seq`, if it has ended since.
    pub fn finished_since(&self, action: &AdminAction, seq: u64) -> Option<&AdminActionOutcome> {
        self.finished
            .iter()
            .filter(|done| done.action == *action && done.seq > seq)
            .max_by_key(|done| done.seq)
    }
}

/// One kind of W5-A change, the command it comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AdminActionKind {
    UpdateCommunity,
    DeleteCommunity,
    CreateChannel,
    UpdateChannel,
    DeleteChannel,
    MoveChannel,
    AddMember,
    AddSound,
    DeleteSound,
    AddPrivateMember,
    RemovePrivateMember,
    CreateAliasGroup,
    RenameAliasGroup,
    DeleteAliasGroup,
    SetAliasGroupMembers,
    AddAliasGroupMember,
    RemoveAliasGroupMember,
    AddCustomEmoji,
    DeleteCustomEmoji,
    CreateWebhook,
    DeleteWebhook,
    CreateInvite,
    DeleteInvite,
    /// W5-B: on `Roles` (target: the role; `None` for a create).
    CreateRole,
    UpdateRole,
    DeleteRole,
    ReorderRoles,
    ResetDefaults,
    /// W5-B: on `MemberRoles` (target: the role).
    AssignRole,
    UnassignRole,
    /// W5-B: on `ChannelOverwrites` (target: the channel).
    ReplaceOverwrites,
    /// W5-B: on `ModerationTarget` (target: the member); `Unban` on `Bans`, `RemoveTimeout` on
    /// `Timeouts` and `ModerationTarget`.
    Ban,
    Unban,
    Kick,
    Timeout,
    RemoveTimeout,
}

/// A change and what it changes: the community, channel, user, group, emoji, sound, webhook or
/// invite code the command names; `None` for a create (nothing has an id yet).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AdminAction {
    pub kind: AdminActionKind,
    pub target_id: Option<String>,
}

/// One change's state within an `AdminOp`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdminActionState {
    pub action: AdminAction,
    pub busy: bool,
    pub upload: Option<UploadView>,
    pub error: Option<ErrorView>,
}

/// `Core::community_settings`. `ViewKey::CommunitySettings { community_id }` says when to read
/// again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommunitySettingsView {
    pub state: LoadState,
    pub community_id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_file_id: Option<String>,
    pub banner_file_id: Option<String>,
    pub op: AdminOp,
}

/// What `Core::update_community` changes: each `None` is left as it is. An empty `description`
/// clears it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommunityPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<ImageChange>,
    pub banner: Option<ImageChange>,
}

/// A new channel, or (`Core::update_channel`) an existing one's settings. The kind is fixed once
/// made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelDraft {
    pub name: String,
    pub kind: ChannelKind,
    pub is_private: bool,
    /// The gap the server enforces between a member's messages. 0 means none.
    pub slowmode_seconds: u32,
}

/// One step of `Core::move_channel`: the server reorders by one place at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelMove {
    Up,
    Down,
}

/// A private channel's member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrivateMemberRow {
    pub user: UserView,
    pub joined_at_ms: i64,
    /// Who added them, when the server says.
    pub added_by: Option<String>,
}

/// `Core::private_members`. `ViewKey::PrivateMembers { channel_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PrivateMembersView {
    pub state: LoadState,
    pub channel_id: String,
    pub members: Vec<PrivateMemberRow>,
    pub op: AdminOp,
}

/// A mention group (`@group`), as the list shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AliasGroupRow {
    pub id: String,
    pub name: String,
    pub member_count: u32,
}

/// `Core::alias_groups`. `ViewKey::AliasGroups { community_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AliasGroupsView {
    pub state: LoadState,
    pub community_id: String,
    pub groups: Vec<AliasGroupRow>,
    pub op: AdminOp,
}

/// `Core::alias_group`: one group with its members, for the editor. `ViewKey::AliasGroup
/// { group_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AliasGroupView {
    pub state: LoadState,
    pub group_id: String,
    pub name: String,
    pub members: Vec<UserView>,
    pub op: AdminOp,
}

/// A custom emoji in the management list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomEmojiRow {
    pub id: String,
    pub name: String,
    pub file_id: String,
    pub created_by: Option<UserView>,
}

/// `Core::custom_emoji`. `ViewKey::CustomEmoji { community_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CustomEmojiView {
    pub state: LoadState,
    pub community_id: String,
    pub emojis: Vec<CustomEmojiRow>,
    pub op: AdminOp,
}

/// A new soundboard sound. The list is W4's `SoundboardView`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundDraft {
    pub name: String,
    pub emoji: Option<String>,
    pub file: DraftFile,
}

/// A channel's webhook. Its secret URL is shown once, at creation (`CreatedWebhook`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookRow {
    pub id: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub created_at_ms: i64,
}

/// `Core::webhooks`. `ViewKey::Webhooks { channel_id }` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WebhooksView {
    pub state: LoadState,
    pub channel_id: String,
    pub webhooks: Vec<WebhookRow>,
    pub op: AdminOp,
}

/// What `Core::create_webhook` returns: the URL to post to, which nothing shows again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedWebhook {
    pub id: String,
    pub url: String,
}

/// An invite of mine that lets people join this community.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InviteRow {
    pub code: String,
    pub uses: u32,
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
    pub disabled: bool,
    pub created_at_ms: i64,
}

/// `Core::community_invites`: my invites that include this community (the server lists all of
/// mine; the web shows them all). `ViewKey::Invites` says when to read again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InvitesView {
    pub state: LoadState,
    pub community_id: String,
    pub invites: Vec<InviteRow>,
    pub op: AdminOp,
}

/// A new invite to one community. `None` means no limit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InviteDraft {
    pub max_uses: Option<u32>,
    pub valid_until_ms: Option<i64>,
}
