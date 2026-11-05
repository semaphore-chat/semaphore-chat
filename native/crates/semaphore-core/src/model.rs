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
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VoiceView {
    pub status: VoiceStatus,
    pub channel_id: Option<String>,
    pub muted: bool,
    pub deafened: bool,
    pub participants: Vec<ParticipantView>,
}

/// A part of the UI to re-read from core after `CoreEvent::ViewChanged`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ViewKey {
    Session,
    Communities,
    Channels { community_id: String },
    Mentionables { community_id: String },
    Voice,
    Typing { conversation: Conversation },
}
