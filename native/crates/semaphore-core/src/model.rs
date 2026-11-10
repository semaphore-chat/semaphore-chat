//! View models: what a UI renders. Frozen by U0, so UI units can build against them before core
//! is real. Change one only with the coordinator's agreement, because every UI unit reads them.
//!
//! All owned, no lifetimes or generics, so UniFFI can export them as records.

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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum SessionState {
    #[default]
    SignedOut,
    SigningIn,
    SignedIn {
        me: UserView,
    },
    SignInFailed {
        error: ErrorView,
    },
}

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

/// Inline formatting from a span's `bold`, `italic`, `strikethrough` and `code` flags.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TextStyle {
    pub bold: bool,
    pub italic: bool,
    pub strikethrough: bool,
    pub code: bool,
}

/// What a run of the display string is. A kind this build doesn't know becomes `Text`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SegKind {
    Text,
    Link {
        url: String,
    },
    UserMention {
        user_id: String,
    },
    /// `specialKind` as sent: `here`, `everyone`, or a newer one.
    SpecialMention {
        kind: String,
    },
    CommunityMention {
        community_id: String,
    },
    AliasMention {
        alias_id: String,
    },
    ChannelMention {
        channel_id: String,
    },
    /// One placeholder character in the display string, painted over with the emoji image.
    Emoji {
        emoji_id: String,
        name: String,
    },
    CodeBlock,
}

/// One run of `MessageRow::display`. Runs are contiguous and in order: each starts where the
/// last ended, and `end` is a byte offset, the coordinate selection uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextSeg {
    pub end: u32,
    pub kind: SegKind,
    pub style: TextStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    Image,
    Video,
    Audio,
    Document,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentView {
    pub file_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub kind: AttachmentKind,
    pub has_thumbnail: bool,
    /// Pixels. `None` until the server sends them (unit U12). With no size, a late load moves
    /// the rows below it (T2 measured 360 px), so reserve a fixed box and don't resize it.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionView {
    pub emoji: String,
    pub count: u32,
    pub me: bool,
}

/// What a reply shows of the message it answers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReplyToView {
    pub message_id: String,
    pub author: UserView,
    /// Plain text. Blank when the message was removed.
    pub text: String,
    pub deleted: bool,
}

/// Who posted a message that came through a webhook. Such a message has no author.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WebhookView {
    pub id: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

/// As sent. The image and favicon are third-party URLs: core passes them on and loads nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LinkPreviewView {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub favicon_url: Option<String>,
    pub author_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum SendState {
    #[default]
    Sent,
    Pending,
    Failed {
        error: ErrorView,
    },
}

/// One row of a message list. Rows are values: to change one, core sends a replacement.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MessageRow {
    /// Order within its conversation, and a row's identity for selection. Assigned by core,
    /// never reused, and unchanged when an ack turns a pending row into a real message. Message
    /// ids are UUIDs, so they give no order. Not stable across restarts or a window reset.
    pub seq: i64,
    /// `None` until the server accepts it.
    pub id: Option<String>,
    pub client_nonce: Option<String>,
    pub author: UserView,
    pub sent_at_ms: i64,
    pub edited: bool,
    /// Removed: blank `display`, no attachments or reactions.
    pub removed: bool,
    /// What is laid out and selected.
    pub display: String,
    pub segs: Vec<TextSeg>,
    pub attachments: Vec<AttachmentView>,
    pub reactions: Vec<ReactionView>,
    pub reply_count: u32,
    pub last_reply_at_ms: Option<i64>,
    /// Blank on a removed message, like the rest of its content.
    pub reply_to: Option<ReplyToView>,
    pub link_previews: Vec<LinkPreviewView>,
    pub pinned: bool,
    pub webhook: Option<WebhookView>,
    pub send_state: SendState,
    /// Bumped whenever the row changes, so a view can keep its shaped text until then.
    pub revision: u64,
}

/// How a conversation's rows changed. Indices are into the list after the earlier ops.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListOp {
    /// Replaces everything: first load, or a detached window reset.
    Reset {
        rows: Vec<MessageRow>,
    },
    Insert {
        index: u32,
        rows: Vec<MessageRow>,
    },
    Remove {
        index: u32,
        count: u32,
    },
    /// Replaces the rows starting at `index`. A list, because UniFFI records can't hold a `Box`.
    Replace {
        index: u32,
        rows: Vec<MessageRow>,
    },
}

/// A completion offered while typing `@` or `#`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MentionKind {
    User,
    Special,
    Alias,
    Channel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MentionCandidate {
    pub kind: MentionKind,
    pub id: String,
    pub label: String,
    /// What goes in the composer, for example `@ava`.
    pub insert_text: String,
    pub avatar_file_id: Option<String>,
}

/// A mention the composer inserted, by byte range in `MessageDraft::text`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftMention {
    pub start: u32,
    pub end: u32,
    pub kind: MentionKind,
    pub id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MessageDraft {
    pub text: String,
    pub mentions: Vec<DraftMention>,
    pub reply_to_message_id: Option<String>,
    pub attachment_file_ids: Vec<String>,
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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum VoiceStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
    Reconnecting,
}

/// A video track. Frames never pass through core: the media crate gives them, by this sid, to
/// whatever the app connected as its video sink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoTrackView {
    pub track_sid: String,
    pub width: u32,
    pub height: u32,
}

/// A connection's health, as the three-bar indicator shows it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ConnectionQuality {
    #[default]
    Unknown,
    Excellent,
    Good,
    Poor,
    Lost,
}

/// A video tile on screen right now. A track with no demand is paused at the SFU, so it costs no
/// downlink and no decode. The engine picks the layer from this: decoding the top layer costs about
/// a core per tile, and core has no business knowing what a layer is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoDemand {
    pub track_sid: String,
    /// Tile size in physical pixels.
    pub width_px: u32,
    pub height_px: u32,
    /// The main view: a focused share gets its top layer whatever its size, as on the web, because
    /// the top layer is the only one that carries the full frame rate.
    pub focused: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParticipantView {
    pub identity: String,
    pub user: UserView,
    pub is_self: bool,
    pub speaking: bool,
    pub muted: bool,
    pub deafened: bool,
    pub camera: Option<VideoTrackView>,
    pub screen_share: Option<VideoTrackView>,
    pub quality: ConnectionQuality,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VoiceView {
    pub status: VoiceStatus,
    pub channel_id: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    pub participants: Vec<ParticipantView>,
    /// Which attempt a rejoin is on while one runs, for "Reconnecting voice (3)...".
    pub reconnect_attempt: Option<u32>,
    /// Why a rejoin keeps failing, or, once `Disconnected`, why the call ended.
    pub error: Option<String>,
}

/// A part of the UI to re-read from core after `CoreEvent::ViewChanged`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ViewKey {
    Session,
    Communities,
    Channels { community_id: String },
    Mentionables { community_id: String },
    Members { community_id: String },
    Rail,
    Voice,
    Typing { conversation: Conversation },
}

/// Whether a list a UI reads from core has arrived. `ViewChanged` for the same `ViewKey` says when to
/// ask again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum LoadState {
    #[default]
    Loading,
    Ready,
    /// The last fetch failed. Core won't try again until `Core::retry_failed`, or a new connection.
    Failed { error: ErrorView },
}

/// Why the last session ended, for the sign-in screen to say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignOutReason {
    /// The user signed out.
    SignedOut,
    /// The server refused the session: it expired, or was revoked elsewhere.
    Expired,
}

/// What a server says about itself before anyone signs in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServerInfo {
    /// The URL requests go to, as it was normalised.
    pub url: String,
    pub name: Option<String>,
    pub max_file_bytes: Option<u64>,
    pub password_reset: bool,
}
