//! One row of the list, following `frontend/src/components/Message/`: `MessageComponent` and its
//! styles, `MessageSpan`, `QuotePreview`, `MessageReactions`, `MessageAttachments`, `DaySeparator`,
//! `OptimisticMessageActions` and `ThreadReplyBadge`, with `messageGrouping.ts` for the grouping.

use super::actions::{
    ListPermissions, UnreadDivider, render_reaction_tooltip, render_toolbar, render_unread_divider,
};
use super::format::{TimeFormat, file_size};
use super::icons::{self, Glyph, glyph as icon};
use super::media::{CacheKind, Media, MediaRef, MediaState, contain};
use super::palette::*;
use super::selection::Selection;
use super::store::RowStore;
use super::text::{self, BlockKind};
use super::text_element::{BlockGeom, MessageText};
use super::view::{MessageList, MessageListEvent};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{
    AttachmentKind, AttachmentView, MessageRow, ReactionUsers, SegKind, SendState,
};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

const GROUP_WINDOW_MS: i64 = 5 * 60 * 1000;
/// Prepared rows held for repainting. About three screens' worth.
const PREPARED_LIMIT: usize = 512;
/// What a reserved image box measures when the server hasn't sent a size. It never resizes, so a
/// late load can't move the rows below it, at the cost of letterboxing the image.
const UNKNOWN_IMAGE: (f32, f32) = (320., 200.);
const IMAGE_MAX_HEIGHT: f32 = 400.;
const VIDEO_WIDTH: f32 = 480.;
const VIDEO_HEIGHT: f32 = 270.;
const MULTI_ATTACHMENT_WIDTH: f32 = 250.;
const EDITED_MARK: &str = "(edited)";

/// A quoted message, shown above the body.
///
/// `MessageRow` has no field for this yet, so it travels beside the rows, keyed by seq. Core should
/// carry it on the row (see the unit's report); nothing else here depends on where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplyPreview {
    pub author: String,
    pub text: String,
    pub deleted: bool,
}

/// What a row shows of its neighbours.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Decor {
    /// The day separator's label, if the row starts a day.
    pub day: Option<SharedString>,
    /// Continues the same author's run: no avatar or author line.
    pub grouped: bool,
}

/// A rounded rectangle behind a run of text: inline code and channel mentions.
pub(crate) struct Chip {
    pub range: std::ops::Range<u32>,
    pub background: Hsla,
    pub border: Option<Hsla>,
}

/// A text block ready to lay out. `text` holds the message's bytes plus, on a grouped row, marks
/// that aren't part of it.
pub(crate) struct PreparedBlock {
    pub base: u32,
    pub kind: BlockKind,
    pub text: SharedString,
    pub selectable: u32,
    pub runs: Vec<TextRun>,
    pub chips: Vec<Chip>,
    /// Inline emoji: byte in this block, and id.
    pub emoji: Vec<(u32, String)>,
    pub pending_icon_at: Option<u32>,
}

/// What a row needs repainting, held until the row's `revision` changes.
pub(crate) struct Prepared {
    revision: u64,
    inline_marks: bool,
    pub blocks: Vec<Rc<PreparedBlock>>,
    pub clock: SharedString,
    pub author: SharedString,
    pub initial: SharedString,
    pub mentions_me: bool,
}

/// State row elements read while they lay out and paint, when the view can't be borrowed.
pub(crate) struct Shared {
    pub rows: RefCell<RowStore>,
    pub prepared: RefCell<HashMap<i64, Rc<Prepared>>>,
    /// Text blocks painted in the last frame, by seq and the block's first byte.
    pub visible: RefCell<BTreeMap<(i64, u32), BlockGeom>>,
    pub selection: Cell<Option<Selection>>,
    pub hovered_link: Cell<Option<(i64, u32)>>,
    pub palette: Palette,
    pub fonts: Fonts,
    pub me_id: String,
    pub time: TimeFormat,
    pub media: Media,
    pub replies: RefCell<HashMap<i64, ReplyPreview>>,
    /// Rows keeping their old header and separator, because taking them away now would move the
    /// rows under the reader's eyes. See `MessageList::freeze_anchor_decor`.
    pub frozen_decor: RefCell<HashMap<i64, Decor>>,
    pub animation_started: Cell<Option<Instant>>,
    /// When the soonest animated image painted this frame next changes.
    pub next_animation_frame: Cell<Option<Duration>>,
    /// How many animated images have been painted, for tests and rigs.
    pub animated_paints: Cell<u64>,
    pub view: RefCell<WeakEntity<MessageList>>,
    /// The row under the pointer: it shows the toolbar.
    pub hovered: Cell<Option<i64>>,
    pub permissions: Cell<ListPermissions>,
    /// The row whose toolbar asks "Delete?".
    pub staged_delete: Cell<Option<i64>>,
    /// The row whose menu is open: it keeps its toolbar.
    pub menu_for: Cell<Option<i64>>,
    /// The row being edited, and the editor drawn in place of its text.
    pub editing: RefCell<Option<(i64, AnyView)>>,
    pub unread: Cell<Option<UnreadDivider>>,
    /// A row just jumped to.
    pub highlight: Cell<Option<i64>>,
    /// The reaction chip under the pointer: seq and emoji.
    pub hovered_reaction: RefCell<Option<(i64, String)>>,
    /// `Core::reaction_users`, by message id and emoji.
    pub reaction_users: RefCell<HashMap<(String, String), ReactionUsers>>,
    /// Laid out at a phone's width last frame: the toolbar becomes one button, the menu a sheet.
    pub phone: Cell<bool>,
}

impl Shared {
    fn should_group(&self, previous: &MessageRow, row: &MessageRow) -> bool {
        if row.author.id.is_empty() || row.author.id != previous.author.id {
            return false;
        }
        let gap = row.sent_at_ms - previous.sent_at_ms;
        (0..GROUP_WINDOW_MS).contains(&gap)
            && self.time.day(row.sent_at_ms) == self.time.day(previous.sent_at_ms)
            && !self.replies.borrow().contains_key(&row.seq)
            && previous.reply_count == 0
    }

    pub(crate) fn decor_at(&self, rows: &RowStore, ix: usize) -> Decor {
        let Some(row) = rows.get(ix) else {
            return Decor {
                day: None,
                grouped: false,
            };
        };
        if let Some(frozen) = self.frozen_decor.borrow().get(&row.seq) {
            return frozen.clone();
        }
        let previous = ix.checked_sub(1).and_then(|ix| rows.get(ix));
        let new_day = previous
            .is_none_or(|prev| self.time.day(prev.sent_at_ms) != self.time.day(row.sent_at_ms));
        Decor {
            day: new_day.then(|| self.time.day_label(row.sent_at_ms).into()),
            // The unread divider between two rows starts a new group: the row after it shows its
            // name again.
            grouped: previous.is_some_and(|prev| {
                self.should_group(prev, row)
                    && self
                        .unread
                        .get()
                        .is_none_or(|divider| divider.after_seq != prev.seq)
            }),
        }
    }

    fn prepared_for(&self, row: &Arc<MessageRow>, inline_marks: bool) -> Rc<Prepared> {
        let mut cache = self.prepared.borrow_mut();
        if let Some(prepared) = cache.get(&row.seq)
            && prepared.revision == row.revision
            && prepared.inline_marks == inline_marks
        {
            return prepared.clone();
        }
        if cache.len() >= PREPARED_LIMIT {
            cache.clear();
        }
        let prepared = Rc::new(prepare(row, inline_marks, self));
        cache.insert(row.seq, prepared.clone());
        prepared
    }

    fn notify_view(&self, cx: &mut App) {
        let view = self.view.borrow().clone();
        view.update(cx, |_, cx| cx.notify()).ok();
    }

    fn hover_row(&self, seq: i64, hovered: bool, cx: &mut App) {
        let now = if hovered {
            Some(seq)
        } else if self.hovered.get() == Some(seq) {
            None
        } else {
            return;
        };
        if self.hovered.replace(now) != now {
            self.notify_view(cx);
        }
    }

    pub(crate) fn hover_reaction(
        &self,
        seq: i64,
        message_id: Option<&str>,
        emoji: &str,
        hovered: bool,
        cx: &mut App,
    ) {
        let key = (seq, emoji.to_owned());
        {
            let mut current = self.hovered_reaction.borrow_mut();
            if hovered {
                if current.as_ref() == Some(&key) {
                    return;
                }
                *current = Some(key);
            } else if current.as_ref() == Some(&key) {
                *current = None;
            } else {
                return;
            }
        }
        if hovered && let Some(message_id) = message_id {
            self.emit(
                MessageListEvent::ReactionHovered {
                    message_id: message_id.to_owned(),
                    emoji: emoji.to_owned(),
                },
                cx,
            );
        }
        self.notify_view(cx);
    }

    pub(crate) fn emit(&self, event: MessageListEvent, cx: &mut App) {
        let view = self.view.borrow().clone();
        view.update(cx, |_, cx| cx.emit(event)).ok();
    }
}

fn author_name(row: &MessageRow) -> SharedString {
    if row.author.id.is_empty() && row.author.username.is_empty() {
        return "[Deleted User]".into();
    }
    row.author
        .display_name
        .as_deref()
        .filter(|name| !name.is_empty())
        .unwrap_or(if row.author.username.is_empty() {
            row.author.id.as_str()
        } else {
            row.author.username.as_str()
        })
        .to_owned()
        .into()
}

/// Builds the runs for one block. Emoji placeholders are transparent: their image paints over them.
fn prepare_block(
    row: &MessageRow,
    block: &text::Block,
    suffix: Option<(&str, bool)>,
    palette: &Palette,
    fonts: &Fonts,
) -> PreparedBlock {
    let base = block.range.start;
    let base_font = || font(fonts.body.clone());
    let code_font = || font(fonts.code.clone());
    let mut runs = Vec::new();
    let mut chips = Vec::new();
    let mut emoji = Vec::new();
    for span in text::spans(row) {
        if span.range.start < block.range.start || span.range.end > block.range.end {
            continue;
        }
        let mut run = TextRun {
            len: (span.range.end - span.range.start) as usize,
            font: base_font(),
            color: palette.text,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let local = span.range.start - base..span.range.end - base;
        match span.kind {
            SegKind::Text => {}
            SegKind::Link { .. } => {
                run.color = palette.primary;
                run.underline = Some(UnderlineStyle {
                    thickness: px(1.),
                    color: Some(palette.primary),
                    wavy: false,
                });
            }
            SegKind::UserMention { .. } => {
                run.color = palette.primary;
                run.font.weight = FontWeight::SEMIBOLD;
            }
            SegKind::SpecialMention { .. } => {
                run.color = palette.positive;
                run.font.weight = FontWeight::SEMIBOLD;
            }
            SegKind::CommunityMention { .. } => {
                run.color = palette.primary_light;
                run.font.weight = FontWeight::SEMIBOLD;
            }
            SegKind::AliasMention { .. } => {
                run.color = palette.warning;
                run.font.weight = FontWeight::SEMIBOLD;
            }
            SegKind::ChannelMention { .. } => {
                run.color = palette.primary_light;
                run.font.weight = FontWeight::SEMIBOLD;
                chips.push(Chip {
                    range: local.clone(),
                    background: palette.hover,
                    border: None,
                });
            }
            SegKind::Emoji { emoji_id, .. } => {
                run.color = Hsla::transparent_black();
                emoji.push((local.start, emoji_id.clone()));
            }
            SegKind::CodeBlock => run.font = code_font(),
        }
        if span.style.code && !matches!(span.kind, SegKind::CodeBlock) {
            run.font = code_font();
            chips.push(Chip {
                range: local.clone(),
                background: palette.hover,
                border: Some(palette.divider),
            });
        }
        if span.style.bold {
            run.font.weight = FontWeight::BOLD;
        }
        if span.style.italic {
            run.font.style = FontStyle::Italic;
        }
        if span.style.strikethrough {
            run.strikethrough = Some(StrikethroughStyle {
                thickness: px(1.),
                color: Some(run.color),
            });
        }
        runs.push(run);
    }

    let body = &row.display[block.range.start as usize..block.range.end as usize];
    let selectable = body.len() as u32;
    let mut pending_icon_at = None;
    let text: SharedString = match suffix {
        None => body.to_owned().into(),
        Some((mark, pending)) => {
            let mut text = body.to_owned();
            if !mark.is_empty() {
                let mark = format!(" {mark}");
                runs.push(TextRun {
                    len: mark.len(),
                    font: base_font(),
                    color: palette.text_secondary,
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                });
                text.push_str(&mark);
            }
            if pending {
                // Room for the clock icon, drawn over a blank like an emoji.
                let blank = " \u{2003}";
                pending_icon_at = Some((text.len() + 1) as u32);
                runs.push(TextRun {
                    len: blank.len(),
                    font: base_font(),
                    color: Hsla::transparent_black(),
                    background_color: None,
                    underline: None,
                    strikethrough: None,
                });
                text.push_str(blank);
            }
            text.into()
        }
    };
    PreparedBlock {
        base,
        kind: block.kind,
        text,
        selectable,
        runs,
        chips,
        emoji,
        pending_icon_at,
    }
}

fn prepare(row: &MessageRow, inline_marks: bool, shared: &Shared) -> Prepared {
    let pending = matches!(row.send_state, SendState::Pending) || row.edit_pending;
    let blocks = text::blocks(row);
    let suffix_at = blocks
        .iter()
        .rposition(|block| block.kind == BlockKind::Inline);
    let has_marks = row.edited || pending;
    let blocks = blocks
        .iter()
        .enumerate()
        .map(|(ix, block)| {
            let suffix = (inline_marks && has_marks && Some(ix) == suffix_at)
                .then_some((if row.edited { EDITED_MARK } else { "" }, pending));
            Rc::new(prepare_block(
                row,
                block,
                suffix,
                &shared.palette,
                &shared.fonts,
            ))
        })
        .collect();
    let author = author_name(row);
    Prepared {
        revision: row.revision,
        inline_marks,
        blocks,
        clock: shared.time.clock(row.sent_at_ms).into(),
        initial: author
            .chars()
            .next()
            .map_or("?".to_owned(), |c| c.to_uppercase().to_string())
            .into(),
        author,
        mentions_me: text::mentions_user(row, &shared.me_id),
    }
}

/// A clickable child of a row. A press on it must not start a selection.
pub(crate) fn clickable(id: impl Into<ElementId>) -> Stateful<Div> {
    div()
        .id(id)
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .cursor_pointer()
}

/// An image, filling its box, at whichever frame it's due.
fn image_canvas(shared: &Rc<Shared>, image: Arc<RenderImage>, radius: Pixels) -> impl IntoElement {
    let shared = shared.clone();
    canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            let frame = shared.frame_of(&image, bounds, window, cx);
            let fitted = contain(bounds, image.size(frame));
            window
                .paint_image(
                    fitted,
                    fitted,
                    Corners::all(radius),
                    image.clone(),
                    frame,
                    false,
                )
                .ok();
        },
    )
    .size_full()
}

fn render_avatar(
    shared: &Rc<Shared>,
    row: &MessageRow,
    prepared: &Prepared,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let palette = shared.palette;
    let state = row
        .author
        .avatar_file_id
        .as_deref()
        .map(|file_id| shared.media.source.avatar(file_id))
        .map(|media| shared.media.resolve(media, CacheKind::Small, window, cx));
    let frame = div()
        .size(px(AVATAR))
        .flex_none()
        .rounded_full()
        .overflow_hidden()
        .bg(palette.avatar_bg);
    match state {
        Some(MediaState::Ready(image)) => frame.child(image_canvas(shared, image, px(AVATAR / 2.))),
        Some(MediaState::Loading) => frame.bg(palette.skeleton),
        None | Some(MediaState::Failed) => frame
            .flex()
            .items_center()
            .justify_center()
            .text_color(palette.background)
            .text_size(px(BODY_SIZE))
            .child(prepared.initial.clone()),
    }
}

fn render_day_separator(label: SharedString, palette: &Palette) -> impl IntoElement {
    let rule = || div().flex_1().h(px(1.)).bg(palette.divider);
    div()
        .flex()
        .items_center()
        .gap(px(12.))
        .px(px(16.))
        .pt(px(16.))
        .pb(px(4.))
        .child(rule())
        .child(
            div()
                .flex_none()
                .whitespace_nowrap()
                .text_size(px(CAPTION_SIZE))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(palette.text_secondary)
                .child(label),
        )
        .child(rule())
}

fn render_reply(reply: &ReplyPreview, palette: &Palette) -> impl IntoElement {
    let (author, text, author_color, text_color): (SharedString, SharedString, Hsla, Hsla) =
        if reply.deleted {
            (
                "[Deleted User]".into(),
                "[Original message was deleted]".into(),
                palette.text_disabled,
                palette.text_disabled,
            )
        } else {
            (
                reply.author.clone().into(),
                if reply.text.is_empty() {
                    "Message".into()
                } else {
                    reply.text.replace('\n', " ").into()
                },
                palette.primary,
                palette.text_secondary,
            )
        };
    let mut preview = div()
        .flex()
        .items_center()
        .gap(px(4.))
        .min_w_0()
        .pl(px(12.))
        .py(px(2.))
        .mb(px(2.))
        .border_l_2()
        .border_color(palette.primary)
        .text_size(px(CAPTION_SIZE))
        .child(
            div()
                .flex_none()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(author_color)
                .child(author),
        );
    let mut text = div()
        .min_w_0()
        .truncate()
        .text_color(text_color)
        .child(text);
    if reply.deleted {
        text = text.italic();
    }
    preview = preview.child(text);
    preview
}

fn render_marks(row: &MessageRow, palette: &Palette) -> Option<Div> {
    let pending = matches!(row.send_state, SendState::Pending) || row.edit_pending;
    (row.edited || pending).then(|| {
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .text_size(px(CAPTION_SIZE))
            .text_color(palette.text_secondary)
            .when(row.edited, |marks| marks.child(EDITED_MARK))
            .when(pending, |marks| {
                marks.child(icon(icons::SCHEDULE, 14., palette.text_secondary))
            })
    })
}

/// Who removed it and why: only moderators are sent these.
fn render_removed_by(row: &MessageRow, palette: &Palette) -> Option<impl IntoElement> {
    let by = row.removed_by.as_ref().map(|user| {
        user.display_name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| user.username.clone())
    });
    let label = match (by, row.removed_reason.as_deref().filter(|r| !r.is_empty())) {
        (None, None) => return None,
        (Some(by), None) => format!("Removed by {by}"),
        (None, Some(reason)) => format!("Removed: {reason}"),
        (Some(by), Some(reason)) => format!("Removed by {by}: {reason}"),
    };
    Some(
        div()
            .id("removed-by")
            .text_size(px(CAPTION_SIZE))
            .text_color(palette.error)
            .child(label),
    )
}

fn render_header(row: &MessageRow, prepared: &Prepared, palette: &Palette) -> impl IntoElement {
    let name = div()
        .min_w_0()
        .truncate()
        .text_size(px(NAME_SIZE))
        .font_weight(FontWeight::BOLD)
        .child(prepared.author.clone());
    let name = if row.author.id.is_empty() {
        name.italic().text_color(palette.text_secondary)
    } else {
        name.text_color(palette.text)
    };
    div()
        .flex()
        .items_baseline()
        .gap(px(6.))
        .min_w_0()
        .child(name)
        .child(
            div()
                .flex_none()
                .whitespace_nowrap()
                .text_size(px(CAPTION_SIZE))
                .text_color(palette.text_secondary)
                .child(prepared.clock.clone()),
        )
        .children(render_marks(row, palette))
}

fn image_box(attachment: &AttachmentView) -> (f32, f32) {
    match (attachment.width, attachment.height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => {
            let scale = (IMAGE_MAX_HEIGHT / height as f32).min(1.);
            (width as f32 * scale, height as f32 * scale)
        }
        _ => UNKNOWN_IMAGE,
    }
}

fn card(palette: &Palette) -> Div {
    div()
        .rounded(px(8.))
        .border_1()
        .border_color(palette.divider)
        .bg(palette.paper)
        .overflow_hidden()
}

/// The download card: `DownloadLink`, and for now audio too, since playback is another unit's.
fn render_file_card(
    shared: &Rc<Shared>,
    seq: i64,
    index: usize,
    attachment: &AttachmentView,
    file_icon: Glyph,
) -> impl IntoElement {
    let palette = shared.palette;
    let event_shared = shared.clone();
    let file_id = attachment.file_id.clone();
    clickable(("attachment", (seq as u64) << 8 | index as u64))
        .flex()
        .items_center()
        .gap(px(16.))
        .p(px(16.))
        .max_w(px(TEXT_MAX_WIDTH))
        .min_w_0()
        .rounded(px(8.))
        .border_1()
        .border_color(palette.divider)
        .bg(palette.paper)
        .hover(|style| style.bg(palette.hover))
        .on_click(move |_, _, cx| {
            event_shared.emit(
                MessageListEvent::OpenAttachment {
                    file_id: file_id.clone(),
                },
                cx,
            );
        })
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(48.))
                .rounded(px(4.))
                .bg(palette.hover)
                .child(icon(file_icon, 24., palette.text_secondary)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .truncate()
                        .text_size(px(BODY_SIZE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(palette.text)
                        .child(attachment.filename.clone()),
                )
                .child(
                    div()
                        .text_size(px(CAPTION_SIZE))
                        .text_color(palette.text_secondary)
                        .child(file_size(attachment.size_bytes)),
                ),
        )
        .child(icon(icons::DOWNLOAD, 24., palette.primary))
}

fn render_image(
    shared: &Rc<Shared>,
    seq: i64,
    index: usize,
    attachment: &AttachmentView,
    fixed_width: Option<f32>,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let palette = shared.palette;
    let media = shared.media.source.attachment(attachment);
    let state = shared.media.resolve(media, CacheKind::Images, window, cx);
    let (natural_w, natural_h) = image_box(attachment);
    let frame = card(&palette)
        .w(px(fixed_width.unwrap_or(natural_w)))
        .max_w_full()
        .flex_none()
        .aspect_ratio(natural_w / natural_h);
    match state {
        // The web's image opens its lightbox. A press here doesn't start a selection.
        MediaState::Ready(image) => {
            let event_shared = shared.clone();
            let file_id = attachment.file_id.clone();
            frame
                .id(("image", (seq as u64) << 8 | index as u64))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    event_shared.emit(
                        MessageListEvent::OpenAttachment {
                            file_id: file_id.clone(),
                        },
                        cx,
                    );
                })
                .child(image_canvas(shared, image, px(0.)))
                .test_support()
                .into_any_element()
        }
        MediaState::Loading => frame.bg(palette.hover).into_any_element(),
        // Unavailable, or refused as too big to decode: the file itself is still there to save.
        MediaState::Failed => {
            render_file_card(shared, seq, index, attachment, icons::FILE).into_any_element()
        }
    }
}

/// This client's uploads to the message, and what the server still waits for from others.
fn render_uploads(shared: &Rc<Shared>, row: &MessageRow) -> Option<AnyElement> {
    let others = (row.pending_attachments as usize).saturating_sub(row.uploads.len());
    if row.uploads.is_empty() && others == 0 {
        return None;
    }
    let palette = shared.palette;
    let mut column = div().mt(px(8.)).flex().flex_col().gap(px(6.));
    for (index, upload) in row.uploads.iter().enumerate() {
        let fraction = if upload.size_bytes == 0 {
            1.
        } else {
            upload.sent_bytes as f32 / upload.size_bytes as f32
        };
        let mut line = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .max_w(px(TEXT_MAX_WIDTH))
            .text_size(px(CAPTION_SIZE))
            .child(icon(icons::FILE, 18., palette.text_secondary))
            .child(
                div()
                    .min_w_0()
                    .flex_shrink(1.)
                    .truncate()
                    .text_color(palette.text)
                    .child(upload.name.clone()),
            )
            .child(
                div()
                    .flex_none()
                    .text_color(palette.text_secondary)
                    .child(file_size(upload.size_bytes)),
            );
        match (&upload.failed, &row.client_nonce) {
            (Some(error), Some(nonce)) => {
                let (retry_shared, remove_shared) = (shared.clone(), shared.clone());
                let (retry_nonce, remove_nonce) = (nonce.clone(), nonce.clone());
                let index = index as u32;
                line = line
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_color(palette.error)
                            .child(error.message.clone()),
                    )
                    .child(
                        action_button(
                            ("upload-retry", (row.seq as u64) << 8 | u64::from(index)),
                            "Retry",
                            icons::REPLAY,
                            palette.primary,
                            palette.tint(palette.primary, 0.08),
                        )
                        .on_click(move |_, _, cx| {
                            retry_shared.emit(
                                MessageListEvent::RetryUpload {
                                    client_nonce: retry_nonce.clone(),
                                    index,
                                },
                                cx,
                            );
                        })
                        .test_support(),
                    )
                    .child(
                        action_button(
                            ("upload-remove", (row.seq as u64) << 8 | u64::from(index)),
                            "Remove",
                            icons::DELETE,
                            palette.error,
                            palette.tint(palette.error, 0.08),
                        )
                        .on_click(move |_, _, cx| {
                            remove_shared.emit(
                                MessageListEvent::RemoveUpload {
                                    client_nonce: remove_nonce.clone(),
                                    index,
                                },
                                cx,
                            );
                        })
                        .test_support(),
                    );
            }
            _ => {
                line = line.child(
                    div()
                        .w(px(120.))
                        .h(px(4.))
                        .flex_none()
                        .rounded(px(2.))
                        .bg(palette.hover)
                        .child(
                            div()
                                .h_full()
                                .rounded(px(2.))
                                .bg(palette.primary)
                                .w(px(120. * fraction.clamp(0., 1.))),
                        ),
                );
            }
        }
        column = column.child(line);
    }
    if others > 0 {
        column = column.child(
            div()
                .text_size(px(CAPTION_SIZE))
                .text_color(palette.text_secondary)
                .child(if others == 1 {
                    "1 file still uploading".to_owned()
                } else {
                    format!("{others} files still uploading")
                }),
        );
    }
    Some(column.into_any_element())
}

/// The web's `LinkPreview` card: site, title, description, and the image only where the source
/// allows third-party images.
fn render_link_previews(
    shared: &Rc<Shared>,
    row: &MessageRow,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    if row.link_previews.is_empty() || row.removed {
        return None;
    }
    let palette = shared.palette;
    let mut cards = div().mt(px(8.)).flex().flex_col().gap(px(8.));
    for (index, preview) in row.link_previews.iter().enumerate() {
        let event_shared = shared.clone();
        let url = preview.url.clone();
        let mut text = div().flex().flex_col().gap(px(2.)).min_w_0().flex_1();
        if let Some(site) = &preview.site_name {
            text = text.child(
                div()
                    .text_size(px(CAPTION_SIZE))
                    .text_color(palette.text_secondary)
                    .truncate()
                    .child(site.clone()),
            );
        }
        text = text.child(
            div()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(palette.primary)
                .truncate()
                .child(preview.title.clone().unwrap_or_else(|| preview.url.clone())),
        );
        if let Some(description) = &preview.description {
            text = text.child(
                div()
                    .text_size(px(CAPTION_SIZE))
                    .text_color(palette.text_secondary)
                    .line_clamp(2)
                    .child(description.clone()),
            );
        }
        let mut card = clickable(("preview", (row.seq as u64) << 8 | index as u64))
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(12.))
            .max_w(px(TEXT_MAX_WIDTH))
            .min_w_0()
            .rounded(px(8.))
            .border_l_4()
            .border_color(palette.primary)
            .bg(palette.paper)
            .on_click(move |_, _, cx| {
                event_shared.emit(MessageListEvent::OpenLink { url: url.clone() }, cx);
            })
            .child(text);
        if let Some(image_url) = &preview.image_url {
            let media = shared.media.source.link_image(image_url);
            if !matches!(media, MediaRef::Missing) {
                let state = shared.media.resolve(media, CacheKind::Images, window, cx);
                let frame = div().w_full().h(px(160.)).rounded(px(4.)).overflow_hidden();
                card = card.child(match state {
                    MediaState::Ready(image) => frame
                        .child(image_canvas(shared, image, px(4.)))
                        .into_any_element(),
                    MediaState::Loading => frame.bg(palette.hover).into_any_element(),
                    MediaState::Failed => div().into_any_element(),
                });
            }
        }
        cards = cards.child(card);
    }
    Some(cards.into_any_element())
}

fn render_video(attachment: &AttachmentView, palette: &Palette) -> impl IntoElement {
    card(palette)
        .relative()
        .w(px(VIDEO_WIDTH))
        .max_w_full()
        .aspect_ratio(VIDEO_WIDTH / VIDEO_HEIGHT)
        .bg(rgb(0x000000))
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(8.))
        .child(icon(icons::PLAY, 48., palette.text_secondary))
        .child(
            div()
                .max_w_full()
                .px(px(16.))
                .truncate()
                .text_size(px(CAPTION_SIZE))
                .text_color(palette.text_secondary)
                .child(attachment.filename.clone()),
        )
}

fn render_attachments(
    shared: &Rc<Shared>,
    row: &MessageRow,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    if row.attachments.is_empty() {
        return None;
    }
    let palette = shared.palette;
    let multi = row.attachments.len() > 1;
    let mut items = Vec::with_capacity(row.attachments.len());
    for (index, attachment) in row.attachments.iter().enumerate() {
        let element = match attachment.kind {
            AttachmentKind::Image => render_image(
                shared,
                row.seq,
                index,
                attachment,
                multi.then_some(MULTI_ATTACHMENT_WIDTH),
                window,
                cx,
            )
            .into_any_element(),
            AttachmentKind::Video => render_video(attachment, &palette).into_any_element(),
            AttachmentKind::Audio => {
                render_file_card(shared, row.seq, index, attachment, icons::AUDIO_FILE)
                    .into_any_element()
            }
            AttachmentKind::Document | AttachmentKind::Other => {
                render_file_card(shared, row.seq, index, attachment, icons::FILE).into_any_element()
            }
        };
        items.push(element);
    }
    Some(
        div()
            .mt(px(8.))
            .flex()
            .flex_wrap()
            .items_start()
            .gap(px(8.))
            .min_w_0()
            .children(items)
            .into_any_element(),
    )
}

fn render_reactions(
    shared: &Rc<Shared>,
    row: &MessageRow,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    if row.reactions.is_empty() {
        return None;
    }
    let palette = shared.palette;
    let mut chips = Vec::with_capacity(row.reactions.len());
    for (index, reaction) in row.reactions.iter().enumerate() {
        let event_shared = shared.clone();
        let hover_shared = shared.clone();
        let (message_id, emoji) = (row.id.clone(), reaction.emoji.clone());
        let (hover_id, hover_emoji, seq) = (row.id.clone(), reaction.emoji.clone(), row.seq);
        let tint = palette.tint(palette.primary, 0.15);
        let tooltip = shared
            .hovered_reaction
            .borrow()
            .as_ref()
            .is_some_and(|(hovered_seq, hovered)| {
                *hovered_seq == row.seq && *hovered == reaction.emoji
            })
            .then(|| {
                let users = row.id.as_ref().and_then(|id| {
                    shared
                        .reaction_users
                        .borrow()
                        .get(&(id.clone(), reaction.emoji.clone()))
                        .cloned()
                });
                // Above the chip; deferred so the rows painted after it don't cover it.
                deferred(
                    div()
                        .absolute()
                        .left_0()
                        .bottom(px(30.))
                        .child(render_reaction_tooltip(users.as_ref(), &palette)),
                )
            });
        let mut chip = clickable(("reaction", (row.seq as u64) << 8 | index as u64))
            .test_support()
            .relative()
            .flex()
            .items_center()
            .gap(px(4.))
            .h(px(26.))
            .px(px(8.))
            .rounded(px(12.))
            .border_1()
            .text_size(px(13.))
            .on_hover(move |hovered, _, cx| {
                hover_shared.hover_reaction(seq, hover_id.as_deref(), &hover_emoji, *hovered, cx);
            })
            .children(tooltip)
            .on_click(move |_, _, cx| {
                if let Some(message_id) = message_id.clone() {
                    event_shared.emit(
                        MessageListEvent::ToggleReaction {
                            message_id,
                            emoji: emoji.clone(),
                        },
                        cx,
                    );
                }
            });
        chip = if reaction.me {
            chip.bg(tint)
                .border_color(palette.tint(palette.primary, 0.3))
                .text_color(palette.primary)
                .font_weight(FontWeight::SEMIBOLD)
                .hover(|style| style.bg(palette.tint(palette.primary, 0.25)))
        } else {
            chip.bg(palette.overlay_medium)
                .border_color(palette.divider)
                .text_color(palette.text)
                .font_weight(FontWeight::MEDIUM)
                .hover(|style| style.bg(palette.overlay_heavy))
        };
        let custom = reaction.emoji.strip_prefix("custom:");
        chip = match custom {
            Some(emoji_id) => {
                let media = shared.media.source.emoji(emoji_id);
                let state = shared.media.resolve(media, CacheKind::Small, window, cx);
                let glyph = div().size(px(15.)).flex_none();
                chip.child(match state {
                    MediaState::Ready(image) => glyph
                        .child(image_canvas(shared, image, px(0.)))
                        .into_any_element(),
                    MediaState::Loading => glyph
                        .rounded(px(4.))
                        .bg(palette.skeleton)
                        .into_any_element(),
                    // Unknown or deleted, as `CustomReactionLabel` shows it.
                    MediaState::Failed => div().child("\u{2753}").into_any_element(),
                })
                .child(reaction.count.to_string())
            }
            None => chip.child(format!("{} {}", reaction.emoji, reaction.count)),
        };
        chips.push(chip);
    }
    Some(
        div()
            .mt(px(4.))
            .flex()
            .flex_wrap()
            .gap(px(4.))
            .children(chips)
            .into_any_element(),
    )
}

fn render_thread_badge(shared: &Rc<Shared>, row: &MessageRow) -> Option<AnyElement> {
    if row.reply_count == 0 {
        return None;
    }
    let palette = shared.palette;
    let label = if row.reply_count == 1 {
        "1 reply".to_owned()
    } else {
        format!("{} replies", row.reply_count)
    };
    let event_shared = shared.clone();
    let message_id = row.id.clone();
    Some(
        clickable(("thread", row.seq as u64))
            .mt(px(4.))
            .flex()
            .w_auto()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .px(px(8.))
            .py(px(4.))
            .rounded(px(4.))
            .text_size(px(CAPTION_SIZE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(palette.primary)
            .hover(|style| style.bg(palette.tint(palette.primary, 0.08)))
            .on_click(move |_, _, cx| {
                if let Some(message_id) = message_id.clone() {
                    event_shared.emit(MessageListEvent::OpenThread { message_id }, cx);
                }
            })
            .child(icon(icons::THREAD, 16., palette.primary))
            .child(label)
            .into_any_element(),
    )
}

fn action_button(
    id: impl Into<ElementId>,
    label: &'static str,
    action_icon: Glyph,
    color: Hsla,
    hover: Hsla,
) -> Stateful<Div> {
    clickable(id)
        .flex()
        .items_center()
        .gap(px(4.))
        .px(px(5.))
        .py(px(4.))
        .rounded(px(4.))
        .text_size(px(13.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(color)
        .hover(move |style| style.bg(hover))
        .child(icon(action_icon, 16., color))
        .child(label)
}

fn render_failed(shared: &Rc<Shared>, row: &MessageRow) -> Option<AnyElement> {
    let SendState::Failed { error } = &row.send_state else {
        return None;
    };
    let palette = shared.palette;
    let nonce = row.client_nonce.clone().unwrap_or_default();
    let label = if error.retryable || error.message.is_empty() {
        "Failed to send".to_owned()
    } else {
        format!("Failed to send: {}", error.message)
    };
    let retry_shared = shared.clone();
    let retry_nonce = nonce.clone();
    let discard_shared = shared.clone();
    Some(
        div()
            .mt(px(4.))
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .child(
                div()
                    .text_size(px(CAPTION_SIZE))
                    .text_color(palette.error)
                    .child(label),
            )
            .when(error.retryable, |actions| {
                actions.child(
                    action_button(
                        ("retry", row.seq as u64),
                        "Retry",
                        icons::REPLAY,
                        palette.primary,
                        palette.tint(palette.primary, 0.08),
                    )
                    .on_click(move |_, _, cx| {
                        retry_shared.emit(
                            MessageListEvent::RetrySend {
                                client_nonce: retry_nonce.clone(),
                            },
                            cx,
                        );
                    })
                    .test_support(),
                )
            })
            .child(
                action_button(
                    ("discard", row.seq as u64),
                    "Delete",
                    icons::DELETE,
                    palette.error,
                    palette.tint(palette.error, 0.08),
                )
                .on_click(move |_, _, cx| {
                    discard_shared.emit(
                        MessageListEvent::DiscardFailed {
                            client_nonce: nonce.clone(),
                        },
                        cx,
                    );
                })
                .test_support(),
            )
            .into_any_element(),
    )
}

fn render_block(
    shared: &Rc<Shared>,
    row: &Arc<MessageRow>,
    block: &Rc<PreparedBlock>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let palette = shared.palette;
    let emoji = block
        .emoji
        .iter()
        .map(|(byte, emoji_id)| {
            let media: MediaRef = shared.media.source.emoji(emoji_id);
            (
                *byte,
                shared.media.resolve(media, CacheKind::Small, window, cx),
            )
        })
        .collect();
    let element = MessageText {
        seq: row.seq,
        row: row.clone(),
        block: block.clone(),
        styled: StyledText::new(block.text.clone()).with_runs(block.runs.clone()),
        shared: shared.clone(),
        emoji,
    };
    match block.kind {
        BlockKind::Inline => div()
            .max_w(px(TEXT_MAX_WIDTH))
            .min_w_0()
            .text_size(px(BODY_SIZE))
            .line_height(px(BODY_LINE))
            .child(element)
            .into_any_element(),
        BlockKind::Code => div()
            .my(px(4.))
            .px(px(12.))
            .py(px(8.))
            .max_w(px(CODE_MAX_WIDTH))
            .min_w_0()
            .rounded(px(6.))
            .bg(palette.hover)
            .border_1()
            .border_color(palette.divider)
            .text_size(px(CODE_SIZE))
            .line_height(px(CODE_SIZE * 1.5))
            .child(element)
            .into_any_element(),
    }
}

pub(crate) fn render_row(
    shared: &Rc<Shared>,
    ix: usize,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let (row, decor, total) = {
        let rows = shared.rows.borrow();
        let Some(row) = rows.get(ix).cloned() else {
            return div().into_any_element();
        };
        (row, shared.decor_at(&rows, ix), rows.len())
    };
    let palette = shared.palette;
    let prepared = shared.prepared_for(&row, decor.grouped);
    let failed = matches!(row.send_state, SendState::Failed { .. });
    let pending = matches!(row.send_state, SendState::Pending);
    let selected = shared
        .selection
        .get()
        .is_some_and(|selection| selection.covers(row.seq));

    let reply = shared.replies.borrow().get(&row.seq).cloned();
    let mut body = div().flex().flex_col().flex_1().min_w_0();
    if !decor.grouped {
        body = body.child(render_header(&row, &prepared, &palette));
    }
    if let Some(reply) = &reply {
        let preview = render_reply(reply, &palette);
        // A click jumps to the message answered, unless it's gone.
        let target = row
            .reply_to
            .as_ref()
            .filter(|reply_to| !reply_to.deleted && !reply_to.message_id.is_empty())
            .map(|reply_to| reply_to.message_id.clone());
        body = match target {
            Some(message_id) => {
                let event_shared = shared.clone();
                body.child(
                    clickable(("reply", row.seq as u64))
                        .test_support()
                        .on_click(move |_, _, cx| {
                            event_shared.emit(
                                MessageListEvent::OpenReply {
                                    message_id: message_id.clone(),
                                },
                                cx,
                            );
                        })
                        .child(preview),
                )
            }
            None => body.child(preview),
        };
    }
    if row.removed {
        body = body.child(
            div()
                .text_size(px(BODY_SIZE))
                .line_height(px(BODY_LINE))
                .italic()
                .text_color(palette.text_disabled)
                .child("[Message deleted]"),
        );
        body = body.children(render_removed_by(&row, &palette));
    }
    let editor = shared
        .editing
        .borrow()
        .as_ref()
        .filter(|(seq, _)| *seq == row.seq)
        .map(|(_, editor)| editor.clone());
    let is_editing = editor.is_some();
    if let Some(editor) = editor {
        body = body.child(
            div()
                .id("message-editor")
                .mt(px(4.))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(editor),
        );
    } else {
        for block in &prepared.blocks {
            body = body.child(render_block(shared, &row, block, window, cx));
        }
        body = body
            .children(render_attachments(shared, &row, window, cx))
            .children(render_uploads(shared, &row))
            .children(render_link_previews(shared, &row, window, cx));
    }
    body = body
        .children(render_reactions(shared, &row, window, cx))
        .children(render_thread_badge(shared, &row))
        .children(render_failed(shared, &row));
    // A grouped row with nothing to hang its marks on: they get their own line.
    if decor.grouped && prepared.blocks.iter().all(|b| b.kind != BlockKind::Inline) {
        body = body.children(render_marks(&row, &palette));
    }

    let highlighted = prepared.mentions_me;
    let jumped_to = shared.highlight.get() == Some(row.seq);
    let staged = shared.staged_delete.get() == Some(row.seq);
    let show_toolbar = !is_editing
        && (staged
            || shared.menu_for.get() == Some(row.seq)
            || shared.hovered.get() == Some(row.seq));
    let toolbar = show_toolbar
        .then(|| render_toolbar(shared, &row, staged, shared.phone.get()))
        .flatten();
    let hover_shared = shared.clone();
    let menu_shared = shared.clone();
    let seq = row.seq;
    let group = SharedString::new_static("message-row");
    let mut container = div()
        .id(("message", row.seq as u64))
        .test_support()
        .group(group.clone())
        .relative()
        .flex()
        .items_start()
        .w_full()
        .px(px(16.))
        .pt(px(if decor.grouped { 1. } else { 8. }))
        .pb(px(1.))
        .border_2()
        .border_color(Hsla::transparent_black())
        .role(Role::ListItem)
        .aria_selected(selected)
        .aria_position_in_set(ix + 1)
        .aria_size_of_set(total)
        .on_hover(move |hovered, _, cx| hover_shared.hover_row(seq, *hovered, cx))
        .on_mouse_down(MouseButton::Right, move |event, _, cx| {
            cx.stop_propagation();
            let view = menu_shared.view.borrow().clone();
            let position = event.position;
            view.update(cx, |list, cx| list.open_menu(seq, position, cx))
                .ok();
        });
    if window.is_a11y_active() {
        container = container.aria_label(accessible_label(
            &row,
            &prepared.author,
            &prepared.clock,
            reply.as_ref(),
        ));
    }
    container = if jumped_to {
        container
            .bg(palette.tint(palette.warning, 0.15))
            .hover(|style| style.bg(palette.tint(palette.warning, 0.2)))
    } else if staged {
        container.bg(palette.tint(palette.error, 0.08))
    } else if failed {
        container
            .bg(palette.tint(palette.error, 0.06))
            .hover(|style| style.bg(palette.tint(palette.error, 0.1)))
    } else if highlighted {
        container
            .bg(palette.tint(palette.primary, 0.08))
            .border_1()
            .px(px(17.))
            .border_color(palette.tint(palette.primary, 0.3))
            .hover(|style| style.bg(palette.tint(palette.primary, 0.12)))
    } else {
        container.hover(|style| style.bg(palette.hover))
    };
    if pending {
        container = container.opacity(0.6);
    }
    container = if decor.grouped {
        container.child(
            div()
                .flex_none()
                .w(px(AVATAR_GUTTER + 8.))
                .ml(px(-8.))
                .pr(px(8.))
                .pt(px(3.))
                .whitespace_nowrap()
                .text_right()
                .text_size(px(11.))
                .line_height(px(18.))
                .text_color(palette.text_secondary)
                .opacity(0.)
                .group_hover(group, |style| style.opacity(1.))
                .child(prepared.clock.clone()),
        )
    } else {
        container.child(
            div()
                .flex_none()
                .w(px(AVATAR))
                .mr(px(12.))
                .mt(px(4.))
                .child(render_avatar(shared, &row, &prepared, window, cx)),
        )
    };
    let container = container.child(body).children(toolbar);
    let divider = shared
        .unread
        .get()
        .filter(|divider| divider.after_seq == row.seq && ix + 1 < total)
        .map(|divider| render_unread_divider(divider.count, &palette));

    match (decor.day, divider) {
        (None, None) => container.into_any_element(),
        (day, divider) => div()
            .w_full()
            .children(day.map(|label| render_day_separator(label, &palette)))
            .child(container)
            .children(divider)
            .into_any_element(),
    }
}

/// What a screen reader hears for a row: who, when, then the text.
pub(crate) fn accessible_label(
    row: &MessageRow,
    author: &str,
    clock: &str,
    reply: Option<&ReplyPreview>,
) -> String {
    let mut label = format!("{author}, {clock}");
    if let Some(reply) = reply {
        label.push_str(&format!(", replying to {}", reply.author));
    }
    if row.edited {
        label.push_str(", edited");
    }
    match &row.send_state {
        SendState::Pending => label.push_str(", sending"),
        SendState::Failed { .. } => label.push_str(", failed to send"),
        SendState::Sent => {}
    }
    label.push_str(": ");
    if row.removed {
        label.push_str("message deleted");
    } else {
        label.push_str(&text::plain_text(row));
    }
    for attachment in &row.attachments {
        label.push_str(&format!(". Attachment: {}", attachment.filename));
    }
    label
}

/// One grey row while history loads: `MessageSkeleton`. Still, because MUI's pulse would be the only
/// thing on screen redrawing the window.
pub(crate) fn render_skeleton(palette: &Palette) -> impl IntoElement {
    let bar = |width: f32, height: f32| {
        div()
            .w(relative(width))
            .h(px(height))
            .rounded(px(4.))
            .bg(palette.skeleton)
    };
    div()
        .flex()
        .items_start()
        .w_full()
        .px(px(16.))
        .py(px(4.))
        .mb(px(8.))
        .child(
            div()
                .flex_none()
                .size(px(AVATAR))
                .mr(px(8.))
                .rounded_full()
                .bg(palette.skeleton),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .gap(px(6.))
                .pt(px(2.))
                .child(bar(0.3, 14.))
                .child(bar(0.8, 12.)),
        )
}

/// `EmptyState` with the `messages` variant.
pub(crate) fn render_empty(palette: &Palette) -> impl IntoElement {
    div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .py(px(48.))
        .px(px(24.))
        .child(
            div()
                .flex()
                .items_center()
                .justify_center()
                .size(px(120.))
                .rounded_full()
                .mb(px(24.))
                .bg(palette.tint(palette.primary, 0.2))
                .child(icon(
                    icons::FORUM,
                    64.,
                    palette.tint(palette.primary_light, 0.7),
                )),
        )
        .child(
            div()
                .mb(px(8.))
                .text_size(px(20.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(palette.text)
                .child("No messages yet"),
        )
        .child(
            div()
                .text_size(px(NAME_SIZE))
                .text_color(palette.text_secondary)
                .child("Start the conversation!"),
        )
}
