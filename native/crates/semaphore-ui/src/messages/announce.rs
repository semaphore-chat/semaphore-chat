//! Screen-reader announcements of new messages: the web's `useMessageListAnnouncer`.
//!
//! Only messages that arrive while the reader is away from the live edge are announced, and never
//! the reader's own. The first qualifying message starts a two-second window; everything that
//! arrives in it is one announcement: one message reads "Author: preview", several read "N new
//! messages". A reset (first load, a channel switch) drops a pending batch: the page that loads
//! then is not news.
//!
//! This is the decision only, with no GPUI in it: [`Announcer::observe`] says whether a batch was
//! started (the view arms its timer then), and [`Announcer::flush`] is what a fired timer asks.
//! The epoch makes a timer from before a reset say nothing.

use super::seen::name_of;
use super::text;
use crate::kit::{Said, Speaker};
use semaphore_core::model::{ListOp, MessageRow, SendState};
use std::time::Duration;

/// Messages arriving within this window of the first one share an announcement, as the web's
/// `ANNOUNCEMENT_BATCH_WINDOW_MS`.
pub const BATCH_WINDOW: Duration = Duration::from_millis(2_000);
/// A preview stops here, with an ellipsis, as the web's `PREVIEW_MAX_LENGTH`.
pub const PREVIEW_MAX_CHARS: usize = 80;

/// One qualifying message, ready to read.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Queued {
    author: String,
    preview: String,
}

#[derive(Debug, Default)]
pub struct Announcer {
    pending: Vec<Queued>,
    /// Bumped by a reset, so a timer armed before it says nothing.
    epoch: u64,
    /// A flush is due: this batch already has its window.
    armed: bool,
    speaker: Speaker,
}

impl Announcer {
    /// Takes one change from core, decided before the list applies it: `len_before` is the list's
    /// length then, `away` whether the reader is scrolled away from the live edge (not following
    /// the tail and not detached from it: the web's `!atBottom` plus the native detached window),
    /// and `loading` whether the list is still loading. `true` when a batch's window has just
    /// started.
    pub fn observe(&mut self, op: &ListOp, len_before: usize, away: bool, loading: bool) -> bool {
        if matches!(op, ListOp::Reset { .. }) {
            // A page load or a channel switch: whatever was queued belonged to the last context.
            self.pending.clear();
            self.armed = false;
            self.epoch += 1;
            return false;
        }
        let ListOp::Insert { index, rows } = op else {
            // Older history at the top is not an arrival; a replacement is an edit, a removal an
            // absence. None of them is news.
            return false;
        };
        if loading || !away || (*index as usize) < len_before {
            return false;
        }
        for row in rows {
            if row.mine || matches!(row.send_state, SendState::Pending) {
                continue;
            }
            self.pending.push(Queued {
                author: author(row),
                preview: preview(row),
            });
        }
        let started = !self.armed && !self.pending.is_empty();
        self.armed |= started;
        started
    }

    /// The number a timer must carry to be allowed to flush: a reset moves it on.
    pub fn epoch(&self) -> u64 {
        self.epoch
    }

    /// What a fired timer says, if this is the batch it was armed for. One message reads
    /// "Author: preview", several "N new messages". Each call that says something gets a fresh
    /// sequence number, so the same words twice are still two announcements.
    pub fn flush(&mut self, epoch: u64) -> Option<Said> {
        if epoch != self.epoch {
            return None;
        }
        self.armed = false;
        let batch = std::mem::take(&mut self.pending);
        let text = match batch.as_slice() {
            [] => return None,
            [queued] => {
                if queued.author.is_empty() {
                    queued.preview.clone()
                } else {
                    format!("{}: {}", queued.author, queued.preview)
                }
            }
            many => format!("{} new messages", many.len()),
        };
        if !self.speaker.say(text) {
            return None;
        }
        self.speaker.last().cloned()
    }

    /// What the region last said, for the view's node and for tests.
    pub fn last(&self) -> Option<&Said> {
        self.speaker.last()
    }
}

/// Who to name: a webhook's name, else the display name, else the username (`seen::name_of`).
fn author(row: &MessageRow) -> String {
    if let Some(webhook) = &row.webhook {
        return webhook.name.clone();
    }
    name_of(&row.author).to_owned()
}

/// The message as one line of text: what copy gives (`text::plain_text`), whitespace collapsed,
/// cut to [`PREVIEW_MAX_CHARS`]. Nothing to read but files reads "Sent an attachment".
fn preview(row: &MessageRow) -> String {
    let joined = text::plain_text(row)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if joined.is_empty() {
        return if row.attachments.is_empty() {
            "New message".to_owned()
        } else {
            "Sent an attachment".to_owned()
        };
    }
    if joined.chars().count() > PREVIEW_MAX_CHARS {
        let cut: String = joined.chars().take(PREVIEW_MAX_CHARS).collect();
        return format!("{}…", cut.trim_end());
    }
    joined
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::{AttachmentKind, AttachmentView, UserView, WebhookView};

    fn alice() -> UserView {
        UserView {
            id: "u-alice".into(),
            username: "alice".into(),
            display_name: Some("Alice".into()),
            avatar_file_id: None,
        }
    }

    fn row(seq: i64, author: UserView, text: &str) -> MessageRow {
        MessageRow {
            seq,
            id: Some(format!("m{seq}")),
            author,
            display: text.into(),
            ..MessageRow::default()
        }
    }

    fn append(announcer: &mut Announcer, len: usize, rows: Vec<MessageRow>) -> bool {
        let op = ListOp::Insert {
            index: len as u32,
            rows,
        };
        announcer.observe(&op, len, true, false)
    }

    fn flush(announcer: &mut Announcer) -> Option<String> {
        let epoch = announcer.epoch();
        announcer.flush(epoch).map(|said| said.text)
    }

    #[test]
    fn the_first_load_is_not_news() {
        let mut announcer = Announcer::default();
        let reset = ListOp::Reset {
            rows: vec![row(1, alice(), "hello")],
        };
        assert!(!announcer.observe(&reset, 0, false, false));
        assert_eq!(flush(&mut announcer), None);
        assert!(announcer.last().is_none());
    }

    #[test]
    fn nothing_is_announced_while_following_the_bottom() {
        let mut announcer = Announcer::default();
        assert!(!announcer.observe(
            &ListOp::Insert {
                index: 0,
                rows: vec![row(1, alice(), "hello")],
            },
            0,
            false,
            false,
        ));
        assert_eq!(flush(&mut announcer), None);
    }

    #[test]
    fn nothing_while_loading() {
        let mut announcer = Announcer::default();
        let op = ListOp::Insert {
            index: 0,
            rows: vec![row(1, alice(), "hello")],
        };
        assert!(!announcer.observe(&op, 0, true, true));
        assert_eq!(flush(&mut announcer), None);
    }

    #[test]
    fn older_history_at_the_top_and_edits_are_not_news() {
        let mut announcer = Announcer::default();
        // A page of older history, inserted at the top while away from the bottom.
        let older = ListOp::Insert {
            index: 0,
            rows: vec![row(1, alice(), "an old message")],
        };
        assert!(!announcer.observe(&older, 10, true, false));
        let edit = ListOp::Replace {
            index: 9,
            rows: vec![row(10, alice(), "edited")],
        };
        assert!(!announcer.observe(&edit, 10, true, false));
        let removal = ListOp::Remove { index: 9, count: 1 };
        assert!(!announcer.observe(&removal, 10, true, false));
        assert_eq!(flush(&mut announcer), None);
    }

    #[test]
    fn a_page_loaded_while_detached_is_not_news_either() {
        // A detached list is not away from the edge but at it: its newer pages are history too.
        let mut announcer = Announcer::default();
        assert!(!announcer.observe(
            &ListOp::Insert {
                index: 10,
                rows: vec![row(11, alice(), "a newer page")],
            },
            10,
            false,
            false,
        ));
        assert_eq!(flush(&mut announcer), None);
    }

    #[test]
    fn the_readers_own_messages_and_pending_sends_are_silent() {
        let mut announcer = Announcer::default();
        let mut mine = row(1, alice(), "mine");
        mine.mine = true;
        let mut pending = row(2, alice(), "not yet sent");
        pending.send_state = SendState::Pending;
        assert!(!append(&mut announcer, 0, vec![mine, pending]));
        assert_eq!(flush(&mut announcer), None);
    }

    #[test]
    fn one_message_reads_author_and_preview() {
        let mut announcer = Announcer::default();
        assert!(append(
            &mut announcer,
            0,
            vec![row(1, alice(), "hello there")]
        ));
        assert_eq!(flush(&mut announcer).as_deref(), Some("Alice: hello there"));
    }

    #[test]
    fn several_messages_in_one_window_are_counted() {
        let mut announcer = Announcer::default();
        assert!(append(&mut announcer, 0, vec![row(1, alice(), "one")]));
        assert!(!append(&mut announcer, 1, vec![row(2, alice(), "two")]));
        assert!(!append(&mut announcer, 2, vec![row(3, alice(), "three")]));
        assert_eq!(flush(&mut announcer).as_deref(), Some("3 new messages"));
    }

    #[test]
    fn a_messages_text_is_cut_to_eighty_characters() {
        let mut announcer = Announcer::default();
        append(&mut announcer, 0, vec![row(1, alice(), &"x".repeat(100))]);
        let text = flush(&mut announcer).expect("an announcement");
        let preview = text.strip_prefix("Alice: ").expect("the author");
        assert_eq!(preview.chars().count(), PREVIEW_MAX_CHARS + 1);
        assert!(preview.ends_with('…'));
        assert_eq!(&preview[..PREVIEW_MAX_CHARS], "x".repeat(PREVIEW_MAX_CHARS));
    }

    #[test]
    fn whitespace_is_collapsed_before_the_cut() {
        let mut announcer = Announcer::default();
        append(
            &mut announcer,
            0,
            vec![row(1, alice(), "  two\n\nlines\there  ")],
        );
        assert_eq!(
            flush(&mut announcer).as_deref(),
            Some("Alice: two lines here")
        );
    }

    #[test]
    fn a_row_with_only_attachments_says_so() {
        let mut announcer = Announcer::default();
        let mut attachment = row(1, alice(), "");
        attachment.attachments = vec![AttachmentView {
            file_id: "f1".into(),
            filename: "notes.pdf".into(),
            mime_type: "application/pdf".into(),
            size_bytes: 10,
            kind: AttachmentKind::Document,
            has_thumbnail: false,
            width: None,
            height: None,
        }];
        append(&mut announcer, 0, vec![attachment]);
        assert_eq!(
            flush(&mut announcer).as_deref(),
            Some("Alice: Sent an attachment")
        );
    }

    #[test]
    fn a_webhook_speaks_with_its_own_name() {
        let mut announcer = Announcer::default();
        let mut row = row(1, alice(), "a release");
        row.webhook = Some(WebhookView {
            id: "w1".into(),
            name: "Deploy Bot".into(),
            avatar_url: None,
        });
        append(&mut announcer, 0, vec![row]);
        assert_eq!(
            flush(&mut announcer).as_deref(),
            Some("Deploy Bot: a release")
        );
    }

    #[test]
    fn a_display_name_else_the_username() {
        let mut announcer = Announcer::default();
        let ben = UserView {
            id: "u-ben".into(),
            username: "ben".into(),
            display_name: None,
            avatar_file_id: None,
        };
        append(&mut announcer, 0, vec![row(1, ben, "hi")]);
        assert_eq!(flush(&mut announcer).as_deref(), Some("ben: hi"));
    }

    #[test]
    fn a_channel_switch_drops_a_pending_batch() {
        let mut announcer = Announcer::default();
        assert!(append(&mut announcer, 0, vec![row(1, alice(), "hello")]));
        let epoch = announcer.epoch();
        announcer.observe(
            &ListOp::Reset {
                rows: vec![row(9, alice(), "another channel")],
            },
            1,
            true,
            false,
        );
        assert_eq!(announcer.flush(epoch), None, "the old timer says nothing");
        assert_eq!(flush(&mut announcer), None, "and nothing was left queued");
    }

    #[test]
    fn the_same_words_twice_are_two_announcements() {
        let mut announcer = Announcer::default();
        append(&mut announcer, 0, vec![row(1, alice(), "hello")]);
        let epoch = announcer.epoch();
        let first = announcer.flush(epoch).expect("the first");
        append(&mut announcer, 1, vec![row(2, alice(), "hello")]);
        let epoch = announcer.epoch();
        let second = announcer.flush(epoch).expect("the second");
        assert_eq!(first.text, second.text);
        assert!(second.seq > first.seq);
    }
}
