//! Message rows and their parts, list changes, mentions and the composer's draft.

use super::{DraftFile, ErrorView, UploadView, UserView};

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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReactionView {
    pub emoji: String,
    pub count: u32,
    pub me: bool,
    /// Who reacted, in the server's order. `Core::reaction_users` names them.
    pub user_ids: Vec<String>,
    /// Set for a community emoji, which the server spells `custom:{emojiId}` in `emoji`.
    pub custom_emoji_id: Option<String>,
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
    /// The author is the signed-in user.
    pub mine: bool,
    /// An edit of this client's is on its way: the row shows the new text already.
    pub edit_pending: bool,
    /// Removed by a moderator. The server blanks what a reader may not see, so a removed row shows
    /// whatever text it was sent: none for most readers, the original for moderators.
    pub removed: bool,
    /// Who removed it and why, sent only to readers who may see removed messages.
    pub removed_by: Option<UserView>,
    pub removed_reason: Option<String>,
    /// What is laid out and selected.
    pub display: String,
    pub segs: Vec<TextSeg>,
    pub attachments: Vec<AttachmentView>,
    pub reactions: Vec<ReactionView>,
    pub reply_count: u32,
    pub last_reply_at_ms: Option<i64>,
    /// As the server sent it: blank on a removed message, except for moderators.
    pub reply_to: Option<ReplyToView>,
    pub link_previews: Vec<LinkPreviewView>,
    pub pinned: bool,
    pub pinned_by: Option<UserView>,
    pub pinned_at_ms: Option<i64>,
    pub webhook: Option<WebhookView>,
    pub send_state: SendState,
    /// Files the server still expects for this message (`pendingAttachments`), from anyone.
    pub pending_attachments: u32,
    /// This client's uploads to it, in the order they were picked.
    pub uploads: Vec<UploadView>,
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
    /// In a draft only, as an edit keeps it: core offers no community candidates.
    Community,
    /// A custom emoji in a draft: `id` is the emoji's id and the range covers `:name:`.
    Emoji,
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
    /// Sent after the message, as the web does: the message goes with `pendingAttachments` set to
    /// how many, then each file uploads against it. Core holds the bytes only until each one has.
    pub files: Vec<DraftFile>,
}
