//! What the owner hands the composer and what comes back.

use gpui_kit::{Image, ImageSource, SharedString};
use semaphore_core::model::{Conversation, MentionCandidate, MessageDraft};

/// What the composer is for.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ComposerMode {
    /// The conversation's composer: drafts, replies, files.
    #[default]
    Send,
    /// A thread's reply box (`ThreadMessageInput`): no files and no reply banner.
    Thread,
    /// Editing a sent message in place (`MessageEditForm`): the owner fills it with
    /// `Composer::set_edit_content`. Enter saves and Escape cancels; it keeps no draft.
    Edit { message_id: String },
}
use std::collections::HashMap;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

/// Whether this user can post here: `useComposerAvailability`, without the hook. The web fails open
/// while permissions load, because the server enforces them either way, and so should the owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Availability {
    Open {
        /// `ATTACH_FILES` in this channel.
        can_attach: bool,
        channel_name: Option<String>,
    },
    ReadOnly {
        channel_name: Option<String>,
        posting_roles: Vec<String>,
    },
    NoPermission {
        channel_name: Option<String>,
    },
    /// An active community timeout. `until` is from the app's clock: `cx.background_executor().now()`.
    TimedOut {
        until: Option<Instant>,
        reason: Option<String>,
    },
    Banned {
        reason: Option<String>,
    },
}

impl Default for Availability {
    fn default() -> Self {
        Self::Open {
            can_attach: true,
            channel_name: None,
        }
    }
}

/// Which message this one answers, as `ReplyComposerBanner` shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyTarget {
    pub message_id: String,
    pub author_name: String,
    pub snippet: String,
}

#[derive(Clone)]
pub enum AttachmentSource {
    Path(PathBuf),
    /// From the clipboard, not yet on disk.
    Image(Arc<Image>),
}

/// A file waiting to go with the message. The owner uploads it on `Send`, because
/// The files themselves go into `MessageDraft::files`; core uploads them after the message.
#[derive(Clone)]
pub struct PendingAttachment {
    pub name: SharedString,
    pub size_bytes: Option<u64>,
    pub source: AttachmentSource,
    /// A thumbnail, for an image. Anything else is drawn as a chip.
    pub preview: Option<ImageSource>,
}

impl PendingAttachment {
    pub fn from_path(path: &Path) -> Self {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        let is_image = path.extension().is_some_and(|ext| {
            let ext = ext.to_string_lossy().to_lowercase();
            matches!(
                ext.as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"
            )
        });
        Self {
            name: name.into(),
            size_bytes: std::fs::metadata(path).ok().map(|meta| meta.len()),
            source: AttachmentSource::Path(path.to_owned()),
            preview: is_image.then(|| ImageSource::from(path.to_owned())),
        }
    }

    pub fn from_clipboard_image(image: Image) -> Self {
        let extension = image.format.extension();
        let size_bytes = Some(image.bytes.len() as u64);
        let image = Arc::new(image);
        Self {
            name: format!("image.{extension}").into(),
            size_bytes,
            source: AttachmentSource::Image(image.clone()),
            preview: Some(ImageSource::Image(image)),
        }
    }
}

/// One conversation's unsent state. The web keeps only the text across navigation, and resets a
/// reply on navigation; here all of it follows the conversation, so a file can't go to the wrong one.
#[derive(Clone, Default)]
pub struct Draft {
    pub text: String,
    pub selection: Range<usize>,
    pub attachments: Vec<PendingAttachment>,
    pub reply: Option<ReplyTarget>,
    pub picked: Vec<MentionCandidate>,
}

impl Draft {
    pub(super) fn is_empty(&self) -> bool {
        self.text.is_empty() && self.attachments.is_empty() && self.reply.is_none()
    }
}

/// Drafts per conversation. Its owner outlives any one composer, as `sessionStorage` does on the web,
/// and it is memory only: the web's drafts don't outlive the session either.
#[derive(Default)]
pub struct DraftStore {
    drafts: HashMap<Conversation, Draft>,
}

impl DraftStore {
    pub fn get(&self, conversation: &Conversation) -> Option<&Draft> {
        self.drafts.get(conversation)
    }

    pub(super) fn put(&mut self, conversation: Conversation, draft: Draft) {
        if draft.is_empty() {
            self.drafts.remove(&conversation);
        } else {
            self.drafts.insert(conversation, draft);
        }
    }
}

/// Where suggestions come from: `Core::mention_candidates` for this community. The candidates come
/// back in the order to show them, as `useMentionAutocomplete` ranks them.
pub trait MentionSource {
    fn candidates(&self, query: &str) -> Vec<MentionCandidate>;
}

#[derive(Clone)]
pub enum ComposerEvent {
    /// U-freeze (UG): the GIF button: the owner opens the `GifPicker` over the composer.
    /// Offered with `Composer::set_gifs_enabled(true)` (`ServerInfo::gif_search`).
    OpenGifs,
    /// Upload `attachments`, send `draft`, then call `Composer::send_settled`.
    Send {
        conversation: Conversation,
        draft: MessageDraft,
        attachments: Vec<PendingAttachment>,
    },
    /// The text changed through typing. The owner debounces it into typing indicators.
    Typing,
    /// The owner shows its picker, then calls `Composer::insert_at_caret` and
    /// `Composer::set_emoji_picker_open(false)`.
    OpenEmojiPicker,
    /// The owner shows the system file dialog, then calls `Composer::add_attachments`.
    OpenFilePicker,
    /// Up in an empty composer: edit the last message.
    EditLastMessage,
    /// A timeout ran out. The composer has opened; the owner refetches what it may do now.
    TimeoutEnded,
    /// Edit mode's save: `Core::edit_message`. `keep_attachment_ids` is `None` unless the user removed
    /// an attachment, so files still uploading aren't dropped.
    SaveEdit {
        message_id: String,
        draft: MessageDraft,
        keep_attachment_ids: Option<Vec<String>>,
    },
    /// Edit mode's cancel, or Escape: the owner closes the editor.
    CancelEdit { message_id: String },
}
