//! One row of the list, following `frontend/src/components/Message/`: `MessageComponent` and its
//! styles, `MessageSpan`, `QuotePreview`, `MessageReactions`, `MessageAttachments`, `DaySeparator`,
//! `OptimisticMessageActions` and `ThreadReplyBadge`, with `messageGrouping.ts` for the grouping.

use super::actions::{
    ListPermissions, UnreadDivider, render_reaction_tooltip, render_toolbar, render_unread_divider,
};
use super::format::TimeFormat;
use super::icons::{self, Glyph, glyph as icon};
use super::media::{CacheKind, Media, MediaRef, MediaState, contain};
use super::palette::*;
use super::seen::{self, SeenState};
use super::segments::{DrawnMap, RowText, row_text};
use super::selection::Selection;
use super::store::RowStore;
use super::text;
use super::third_party::{self, ThirdParty};
use super::view::{MessageList, MessageListEvent};
use crate::format::file_size;
use crate::kit::chat::{
    ListText, MessageRow as KitRow, MessageState, MessageText, OpenActionsRequest,
};
use crate::kit::{Button as KitButton, ButtonSize};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::links::check_link;
use semaphore_core::model::{
    AttachmentKind, AttachmentView, GifEmbed, MessageRow, ReactionUsers, SendState,
};
use semaphore_design::chat::strip_bidi;
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
/// Animated avatars kept as still copies (`Shared::still`), before the copies are dropped.
const STILLS_LIMIT: usize = 64;

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

/// What a row needs repainting, held until the row's `revision` changes.
pub(crate) struct Prepared {
    revision: u64,
    /// The words as the kit's segments, and where they sit as drawn.
    pub text: Rc<RowText>,
    pub clock: SharedString,
    pub author: SharedString,
    pub mentions_me: bool,
}

/// State row elements read while they lay out and paint, when the view can't be borrowed.
pub(crate) struct Shared {
    pub rows: RefCell<RowStore>,
    pub prepared: RefCell<HashMap<i64, Rc<Prepared>>>,
    /// Text blocks painted in the last frame, by seq and the block's first byte.
    pub visible: RefCell<BTreeMap<(i64, u32), BlockGeom>>,
    pub selection: Cell<Option<Selection>>,
    /// Set again on each draw when the list follows the theme (`ListOptions::follow_theme`).
    pub palette: Cell<Palette>,
    pub fonts: Fonts,
    /// Still copies of animated avatars, by the animated image's id: an avatar never animates,
    /// and the kit's avatar would otherwise redraw the window every frame for it.
    pub stills: RefCell<HashMap<ImageId, Arc<RenderImage>>>,
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
    /// The window's players (`ListOptions::players`), and this list's own.
    pub players: Option<crate::player::Players>,
    pub list_players: crate::player::ListPlayers,
    /// "Load images from other sites" (`MessageList::set_third_party_media`). Off until the app
    /// says otherwise: see `third_party`.
    pub third_party: Cell<bool>,
    /// "Seen by" for the own latest message (`MessageList::set_seen_by`).
    pub seen: RefCell<SeenState>,
    /// The pointer is over the "Seen by" line: its tooltip shows.
    pub seen_hovered: Cell<bool>,
    /// `MessageList::set_dm_peer_reads`, kept for the app; the list draws "Seen by" from core's
    /// `SeenByView` only, so nothing reads it yet.
    pub dm_peer_reads: RefCell<Option<semaphore_core::model::DmPeerReadsView>>,
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

    fn prepared_for(&self, row: &Arc<MessageRow>) -> Rc<Prepared> {
        let mut cache = self.prepared.borrow_mut();
        if let Some(prepared) = cache.get(&row.seq)
            && prepared.revision == row.revision
        {
            return prepared.clone();
        }
        if cache.len() >= PREPARED_LIMIT {
            cache.clear();
        }
        let prepared = Rc::new(prepare(row, self));
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
        let was = self.hovered.replace(now);
        if was != now {
            // Entering or leaving the own latest message asks the app to refresh its "Seen by".
            let target = self.seen.borrow().target.clone();
            if let Some((target_seq, message_id)) = target {
                if now == Some(target_seq) {
                    self.emit(
                        MessageListEvent::SeenByHovered {
                            message_id: Some(message_id),
                        },
                        cx,
                    );
                } else if was == Some(target_seq) {
                    self.emit(MessageListEvent::SeenByHovered { message_id: None }, cx);
                }
            }
            self.notify_view(cx);
        }
    }

    fn hover_seen(&self, hovered: bool, cx: &mut App) {
        if self.seen_hovered.replace(hovered) != hovered {
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

    /// Opens a web address from a row (a preview card, a GIF) only as `check_link` passes it.
    /// Words are opened by `MessageText`'s `on_link`, which hands over the checked address.
    fn open_checked(&self, url: &str, cx: &mut App) {
        if let Some(link) = check_link(url) {
            self.emit(MessageListEvent::OpenLink { url: link.href }, cx);
        }
    }

    /// The image to draw for an avatar: a still copy of an animated one.
    fn still(
        &self,
        image: Arc<RenderImage>,
        window: &mut Window,
        cx: &mut App,
    ) -> Arc<RenderImage> {
        if image.frame_count() <= 1 {
            return image;
        }
        let mut stills = self.stills.borrow_mut();
        if let Some(still) = stills.get(&image.id) {
            return still.clone();
        }
        let size = image.size(0);
        let still = image
            .as_bytes(0)
            .and_then(|bytes| {
                ::image::RgbaImage::from_raw(
                    size.width.0 as u32,
                    size.height.0 as u32,
                    bytes.to_vec(),
                )
            })
            .map(|buffer| Arc::new(RenderImage::new([::image::Frame::new(buffer)])));
        let Some(still) = still else {
            return image;
        };
        if stills.len() >= STILLS_LIMIT {
            for (_, old) in stills.drain() {
                cx.drop_image(old, Some(window));
            }
        }
        stills.insert(image.id, still.clone());
        still
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

fn prepare(row: &MessageRow, shared: &Shared) -> Prepared {
    let author = author_name(row);
    Prepared {
        revision: row.revision,
        text: Rc::new(row_text(row, &shared.me_id)),
        clock: shared.time.clock(row.sent_at_ms).into(),
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
            .id(("removed-by", row.seq as u64))
            .text_size(px(CAPTION_SIZE))
            .text_color(palette.error)
            .child(label),
    )
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
    let palette = shared.palette.get();
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
    let palette = shared.palette.get();
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
    let palette = shared.palette.get();
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
    let palette = shared.palette.get();
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
                .text_color(palette.primary_light)
                .truncate()
                .child(
                    preview
                        .title
                        .clone()
                        .unwrap_or_else(|| link_label(&preview.url)),
                ),
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
            .on_click(move |_, _, cx| event_shared.open_checked(&url, cx))
            .child(text);
        match third_party::link_image(
            shared.third_party.get(),
            shared.media.source.as_ref(),
            preview,
        ) {
            None | Some(ThirdParty::Allowed(MediaRef::Missing)) => {}
            Some(ThirdParty::Blocked { host }) => {
                card = card.child(render_image_strip(shared, row.seq, index, &host));
            }
            Some(ThirdParty::Allowed(media)) => {
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

/// A "Load" button inside a row: it turns third-party pictures on for everything, and a press on it
/// neither selects text nor reaches the card or row under it.
fn load_button(shared: &Rc<Shared>, id: String) -> impl IntoElement {
    let event_shared = shared.clone();
    div()
        .flex_none()
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .child(
            KitButton::new(SharedString::from(id), "Load")
                .soft()
                .size(ButtonSize::Sm)
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    event_shared.emit(MessageListEvent::EnableThirdPartyMedia, cx);
                }),
        )
}

/// A link preview's picture while third-party pictures are off: "Image from <host>" and Load.
fn render_image_strip(
    shared: &Rc<Shared>,
    seq: i64,
    index: usize,
    host: &SharedString,
) -> impl IntoElement {
    let palette = shared.palette.get();
    let title = SharedString::from(third_party::image_title(host));
    div()
        .id(SharedString::from(format!(
            "message-preview-blocked-{seq}-{index}"
        )))
        .test_support()
        .role(Role::Group)
        .aria_label(title.clone())
        .flex()
        .items_center()
        .gap(px(8.))
        .min_w_0()
        .px(px(8.))
        .py(px(4.))
        .rounded(px(4.))
        .bg(palette.hover)
        .child(icon(icons::IMAGE, 20., palette.text_secondary))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_size(px(NAME_SIZE))
                .text_color(palette.text_secondary)
                .child(title),
        )
        .child(load_button(
            shared,
            format!("message-preview-load-{seq}-{index}"),
        ))
}

/// A GIF message while third-party pictures are off: "GIF from <host>", what Load does, and Load.
fn render_gif_card(shared: &Rc<Shared>, seq: i64, host: &SharedString) -> AnyElement {
    let palette = shared.palette.get();
    let title = SharedString::from(third_party::gif_title(host));
    div()
        .id(SharedString::from(format!("message-gif-blocked-{seq}")))
        .test_support()
        .role(Role::Group)
        .aria_label(title.clone())
        .mt(px(4.))
        .flex()
        .items_start()
        .gap(px(12.))
        .p(px(12.))
        .max_w(px(TEXT_MAX_WIDTH))
        .min_w_0()
        .rounded(px(8.))
        .border_1()
        .border_color(palette.divider)
        .bg(palette.paper)
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(40.))
                .rounded(px(4.))
                .bg(palette.hover)
                .child(icon(icons::GIF, 28., palette.text_secondary)),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .truncate()
                        .text_size(px(NAME_SIZE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(palette.text)
                        .child(title),
                )
                .child(
                    div()
                        .text_size(px(CAPTION_SIZE))
                        .text_color(palette.text_secondary)
                        .child(third_party::GIF_NOTE),
                )
                // Under the text, so a phone keeps the host and the note readable.
                .child(
                    div()
                        .mt(px(6.))
                        .flex()
                        .child(load_button(shared, format!("message-gif-load-{seq}"))),
                ),
        )
        .into_any_element()
}

/// A box of `width` x `height` in a flex column (a row's body) that narrows with a column
/// narrower than that, keeping its shape, and is never taller than the box itself.
///
/// Taffy applies `aspect_ratio` to the preferred width before `max_w` clamps it, so with
/// `w_full` + `max_w(width)` alone the flex base size is the column's whole width over the ratio
/// (W25: a 400x225 GIF in a 1900 px list made an 1100 px row with the picture at its top, and a
/// GIF still loading a 1450 px one; after Load every GIF in the list loads at once, and the list
/// drew rows of nothing). `max_h(height)` clamps that height in proportion with the width. The
/// item must also stay shrinkable, unlike `flex_none`: when the column measures its content,
/// Taffy takes an unshrinkable item's flex base size as its minimum, and the minimum wins over
/// `max_h`. In a list the column has no fixed height, so nothing ever shrinks it.
pub(crate) fn fitted_frame(width: f32, height: f32) -> Div {
    div()
        .w_full()
        .max_w(px(width))
        .max_h(px(height))
        .flex_grow_0()
        .aspect_ratio(width / height)
}

/// A GIF message's picture, as the web's `GifEmbed`: its own shape inside 400x300, never wider
/// than the column, opening its URL on a click. `None` when it failed: the row falls back to the
/// URL and its preview, as the web's `onError` does.
fn render_gif(
    shared: &Rc<Shared>,
    row: &MessageRow,
    embed: &GifEmbed,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    let palette = shared.palette.get();
    let media = match third_party::gif(
        shared.third_party.get(),
        shared.media.source.as_ref(),
        embed,
    ) {
        ThirdParty::Blocked { host } => return Some(render_gif_card(shared, row.seq, &host)),
        ThirdParty::Allowed(media) => media,
    };
    let state = shared.media.resolve(media, CacheKind::Images, window, cx);
    let (width, height, image) = match state {
        MediaState::Failed => return None,
        MediaState::Loading => (third_party::GIF_MAX.0, third_party::GIF_MAX.1, None),
        MediaState::Ready(image) => {
            let size = image.size(0);
            let (width, height) = third_party::gif_box(size.width.0 as f32, size.height.0 as f32);
            (width, height, Some(image))
        }
    };
    let frame = fitted_frame(width, height)
        .mt(px(4.))
        .rounded(px(4.))
        .overflow_hidden();
    Some(match image {
        None => frame.bg(palette.hover).into_any_element(),
        Some(image) => {
            let event_shared = shared.clone();
            let url = embed.url.clone();
            frame
                .id(SharedString::from(format!("message-gif-{}", row.seq)))
                .test_support()
                .role(Role::Image)
                .aria_label("GIF")
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .cursor_pointer()
                .on_click(move |_, _, cx| event_shared.open_checked(&url, cx))
                .child(image_canvas(shared, image, px(4.)))
                .into_any_element()
        }
    })
}

/// "Seen by" under the own latest message: an eye, two names and "+N", the full list on hover.
fn render_seen(shared: &Rc<Shared>, row: &MessageRow) -> Option<AnyElement> {
    let seen_state = shared.seen.borrow();
    let view = seen_state.for_row(row.seq)?;
    let line = seen::seen_line(view)?;
    let palette = shared.palette.get();
    let tooltip = shared
        .seen_hovered
        .get()
        .then(|| seen::seen_tooltip(view))
        .flatten()
        .map(|tip| {
            // Above the line; moved down into the window when the row sits near its top.
            deferred(
                anchored()
                    .anchor(Anchor::BottomLeft)
                    .snap_to_window_with_margin(px(8.))
                    .child(div().pb(px(4.)).child(render_seen_tooltip(tip, &palette))),
            )
        });
    let label = match &line.more {
        Some(more) => format!("{} {more}", line.names),
        None => line.names.clone(),
    };
    let hover_shared = shared.clone();
    Some(
        div()
            .id("message-seen-by")
            .test_support()
            .role(Role::Status)
            .aria_label(SharedString::from(label))
            .relative()
            .mt(px(2.))
            .flex()
            .items_center()
            .gap(px(4.))
            .max_w(px(TEXT_MAX_WIDTH))
            .min_w_0()
            .text_size(px(CAPTION_SIZE))
            .line_height(px(18.))
            .text_color(palette.text_secondary)
            .on_hover(move |hovered, _, cx| hover_shared.hover_seen(*hovered, cx))
            .child(icon(icons::VISIBILITY, 14., palette.primary))
            .child(div().min_w_0().truncate().child(line.names))
            .children(line.more.map(|more| div().flex_none().child(more)))
            .children(tooltip)
            .into_any_element(),
    )
}

/// The web's `SeenByTooltip`: a paper card with a header, the names, and "+N more".
fn render_seen_tooltip(tip: seen::SeenTooltip, palette: &Palette) -> impl IntoElement {
    div()
        .id("message-seen-tooltip")
        .test_support()
        .role(Role::Tooltip)
        .aria_label(SharedString::from(tip.header.clone()))
        .flex()
        .flex_col()
        .gap(px(2.))
        .min_w(px(150.))
        .max_w(px(250.))
        .p(px(8.))
        .rounded(px(4.))
        .border_1()
        .border_color(palette.divider)
        .bg(palette.paper)
        .shadow_md()
        .text_size(px(CAPTION_SIZE))
        .text_color(palette.text)
        .child(
            div()
                .mb(px(2.))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(palette.text_secondary)
                .truncate()
                .child(tip.header),
        )
        .when(tip.names.len() > 1 || tip.more.is_some(), |card| {
            card.children(
                tip.names
                    .into_iter()
                    .map(|name| div().text_size(px(NAME_SIZE - 1.)).truncate().child(name)),
            )
        })
        .children(tip.more.map(|more| {
            div()
                .mt(px(2.))
                .italic()
                .text_size(px(NAME_SIZE - 1.))
                .text_color(palette.text_secondary)
                .child(more)
        }))
}

fn render_video(attachment: &AttachmentView, palette: &Palette) -> impl IntoElement {
    // The icon and caption sit on the black box in every theme, so they take the dark theme's
    // ink: a light theme's secondary text would vanish there.
    let ink = Palette::dark().text_secondary;
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
        .child(icon(icons::PLAY, 48., ink))
        .child(
            div()
                .max_w_full()
                .px(px(16.))
                .truncate()
                .text_size(px(CAPTION_SIZE))
                .text_color(ink)
                .child(attachment.filename.clone()),
        )
}

/// An audio or video attachment with its inline player, which outlives the row's element.
fn render_player(
    shared: &Rc<Shared>,
    players: &crate::player::Players,
    row: &MessageRow,
    index: usize,
    attachment: &AttachmentView,
    cx: &mut App,
) -> AnyElement {
    let weak = Rc::downgrade(shared);
    let player = shared.list_players.get_or_create(
        players,
        row,
        attachment,
        |player, cx| {
            let on_event = move |event: &crate::player::PlayerViewEvent, cx: &mut App| {
                let Some(shared) = weak.upgrade() else {
                    return;
                };
                let event = match event {
                    crate::player::PlayerViewEvent::Download { file_id } => {
                        MessageListEvent::OpenAttachment {
                            file_id: file_id.clone(),
                        }
                    }
                    crate::player::PlayerViewEvent::OpenExternally { file_id } => {
                        MessageListEvent::OpenExternally {
                            file_id: file_id.clone(),
                        }
                    }
                    crate::player::PlayerViewEvent::Expanded(_) => return,
                };
                shared.emit(event, cx);
            };
            match player {
                crate::player::AttachmentPlayer::Audio(view) => {
                    cx.subscribe(view, move |_, event, cx| on_event(event, cx))
                }
                crate::player::AttachmentPlayer::Video(view) => {
                    cx.subscribe(view, move |_, event, cx| on_event(event, cx))
                }
            }
        },
        cx,
    );
    div()
        .id(("attachment-player", (row.seq as u64) << 8 | index as u64))
        .test_support()
        // Audio fills its width; video sizes itself from the clip's shape.
        .when(
            matches!(player, crate::player::AttachmentPlayer::Audio(_)),
            |el| el.w(px(crate::player::model::AUDIO_MAX_WIDTH)),
        )
        .max_w_full()
        .min_w_0()
        // Presses on the controls are the player's, not the start of a text selection.
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .child(player.into_any_element())
        .into_any_element()
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
    let palette = shared.palette.get();
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
            AttachmentKind::Video | AttachmentKind::Audio
                if let Some(players) = shared
                    .players
                    .as_ref()
                    // A removed message's files (a moderator sees them) don't play.
                    .filter(|_| !row.removed && crate::player::Players::plays(attachment)) =>
            {
                render_player(shared, players, row, index, attachment, cx)
            }
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
    let palette = shared.palette.get();
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
                .text_color(palette.primary_light)
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
    let palette = shared.palette.get();
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
            .text_color(palette.primary_light)
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
    let palette = shared.palette.get();
    let prepared = shared.prepared_for(&row);
    let pending = matches!(row.send_state, SendState::Pending) || row.edit_pending;
    let selected = shared
        .selection
        .get()
        .is_some_and(|selection| selection.covers(row.seq));
    let seq = row.seq;

    let reply = shared.replies.borrow().get(&row.seq).cloned();
    let quote = reply.as_ref().map(|reply| {
        let preview = render_reply(reply, &palette);
        // A click jumps to the message answered, unless it's gone.
        let target = row
            .reply_to
            .as_ref()
            .filter(|reply_to| !reply_to.deleted && !reply_to.message_id.is_empty())
            .map(|reply_to| reply_to.message_id.clone());
        match target {
            Some(message_id) => {
                let event_shared = shared.clone();
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
                    .child(preview)
                    .into_any_element()
            }
            None => preview.into_any_element(),
        }
    });

    let editor = shared
        .editing
        .borrow()
        .as_ref()
        .filter(|(seq, _)| *seq == row.seq)
        .map(|(_, editor)| editor.clone());
    let is_editing = editor.is_some();
    let mut body = div().flex().flex_col().flex_1().min_w_0();
    let mut extras = div().flex().flex_col().flex_1().min_w_0();
    if row.removed {
        body = body
            .child(
                div()
                    .text_size(px(BODY_SIZE))
                    .line_height(px(BODY_LINE))
                    .italic()
                    .text_color(palette.text_disabled)
                    .child("[Message deleted]"),
            )
            .children(render_removed_by(&row, &palette));
    }
    if let Some(editor) = editor {
        body = body.child(
            div()
                .id("message-editor")
                .mt(px(4.))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(editor),
        );
    } else {
        // A lone GIF URL draws the GIF (or its Load card) in place of the link and its preview.
        let gif = row
            .gif
            .as_ref()
            .filter(|_| !row.removed)
            .and_then(|embed| render_gif(shared, &row, embed, window, cx));
        let has_gif = gif.is_some();
        if !has_gif && !prepared.text.segments.is_empty() {
            body = body.child(render_words(shared, &row, &prepared.text, window, cx));
        }
        extras = extras
            .children(gif)
            .children(render_attachments(shared, &row, window, cx))
            .children(render_uploads(shared, &row));
        if !has_gif {
            extras = extras.children(render_link_previews(shared, &row, window, cx));
        }
    }
    let footer = div()
        .flex()
        .flex_col()
        .min_w_0()
        .children(render_reactions(shared, &row, window, cx))
        .children(render_thread_badge(shared, &row))
        .children(render_seen(shared, &row));

    let avatar = row
        .author
        .avatar_file_id
        .as_deref()
        .map(|file_id| shared.media.source.avatar(file_id))
        .map(|media| shared.media.resolve(media, CacheKind::Small, window, cx))
        .and_then(|state| match state {
            MediaState::Ready(image) => Some(shared.still(image, window, cx)),
            _ => None,
        });

    let state = match &row.send_state {
        SendState::Failed { .. } => MessageState::Failed,
        _ if pending => MessageState::Pending,
        _ => MessageState::Sent,
    };
    let mut kit_row = KitRow::new(
        ("message", row.seq as u64),
        prepared.author.clone(),
        prepared.clock.clone(),
    )
    .continued(decor.grouped)
    .mentioned(prepared.mentions_me)
    .highlighted(shared.highlight.get() == Some(row.seq))
    .state(state)
    .edited(row.edited)
    .pinned(row.pinned)
    .body(body)
    .attachments(extras)
    .footer(footer);
    if let Some(image) = avatar {
        kit_row = kit_row.avatar(ImageSource::Render(image));
    }
    if let Some(quote) = quote {
        kit_row = kit_row.quote(quote);
    }
    if let SendState::Failed { error } = &row.send_state {
        let nonce = row.client_nonce.clone().unwrap_or_default();
        kit_row = kit_row.failed_reason(if error.retryable || error.message.is_empty() {
            "Failed to send".to_owned()
        } else {
            format!("Failed to send: {}", error.message)
        });
        if error.retryable {
            let retry_shared = shared.clone();
            let retry_nonce = nonce.clone();
            kit_row = kit_row.on_retry(move |_, cx| {
                retry_shared.emit(
                    MessageListEvent::RetrySend {
                        client_nonce: retry_nonce.clone(),
                    },
                    cx,
                );
            });
        }
        let discard_shared = shared.clone();
        kit_row = kit_row.on_delete(move |_, cx| {
            discard_shared.emit(
                MessageListEvent::DiscardFailed {
                    client_nonce: nonce.clone(),
                },
                cx,
            );
        });
    }
    if !row.author.id.is_empty() {
        let profile_shared = shared.clone();
        let user_id = row.author.id.clone();
        kit_row = kit_row.on_open_author(move |_, cx| {
            profile_shared.emit(
                MessageListEvent::OpenProfile {
                    user_id: user_id.clone(),
                },
                cx,
            );
        });
    }
    let menu_shared = shared.clone();
    kit_row = kit_row.on_open_actions(move |request, _, cx| {
        let view = menu_shared.view.borrow().clone();
        let position = match request {
            OpenActionsRequest::Pointer { position } | OpenActionsRequest::Touch { position } => {
                position
            }
            OpenActionsRequest::Keyboard => return,
        };
        view.update(cx, |list, cx| list.open_menu(seq, position, cx))
            .ok();
    });

    let staged = shared.staged_delete.get() == Some(row.seq);
    let show_toolbar = !is_editing
        && (staged
            || shared.menu_for.get() == Some(row.seq)
            || shared.hovered.get() == Some(row.seq));
    let toolbar = show_toolbar
        .then(|| render_toolbar(shared, &row, staged, shared.phone.get()))
        .flatten();
    let hover_shared = shared.clone();
    let mut container = div()
        .id(("message-item", row.seq as u64))
        .relative()
        .w_full()
        .px(px(SPACE_LIST_GUTTER))
        .role(Role::ListItem)
        .aria_selected(selected)
        .aria_position_in_set(ix + 1)
        .aria_size_of_set(total)
        .on_hover(move |hovered, _, cx| hover_shared.hover_row(seq, *hovered, cx));
    if window.is_a11y_active() {
        container = container.aria_label(accessible_label(
            &row,
            &prepared.author,
            &prepared.clock,
            reply.as_ref(),
        ));
    }
    if staged {
        container = container.bg(palette.tint(palette.error, 0.08));
    }
    let container = container.child(kit_row).children(toolbar);
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

/// Side padding of a row in the list, outside the kit row's own.
const SPACE_LIST_GUTTER: f32 = 4.;

/// What a link with no title shows: its checked label, or the address as text when refused.
fn link_label(url: &str) -> String {
    check_link(url).map_or_else(|| strip_bidi(url), |link| link.label)
}

/// A row's words: the kit's `MessageText`, with the list's selection, geometry and emoji. Links
/// open through `on_link` with their checked address, and nowhere else.
fn render_words(
    shared: &Rc<Shared>,
    row: &Arc<MessageRow>,
    text: &Rc<RowText>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let palette = shared.palette.get();
    let seq = row.seq;
    let selected = shared
        .selection
        .get()
        .and_then(|selection| selection.range_in(row))
        .map(|range| text.map.range_to_drawn(range));
    let emoji: Vec<Option<MediaState>> = text
        .emoji_ids
        .iter()
        .map(|id| {
            id.as_ref().map(|emoji_id| {
                let media: MediaRef = shared.media.source.emoji(emoji_id);
                shared.media.resolve(media, CacheKind::Small, window, cx)
            })
        })
        .collect();
    let record_shared = shared.clone();
    let record_map = text.clone();
    let paint_shared = shared.clone();
    let list = ListText {
        selected,
        selection: palette.selection,
        record: Rc::new(move |start, len, layout, bounds| {
            let map = &record_map.map;
            let display = map.to_display(start as u32)..map.to_display((start + len) as u32);
            record_shared.visible.borrow_mut().insert(
                (seq, display.start),
                BlockGeom {
                    layout,
                    bounds,
                    selectable: display.end - display.start,
                    display_start: display.start,
                    drawn_start: start,
                    text: record_map.clone(),
                },
            );
        }),
        paint_emoji: Rc::new(move |index, rect, window, cx| {
            let palette = paint_shared.palette.get();
            match emoji.get(index).cloned().flatten() {
                Some(MediaState::Ready(image)) => {
                    let frame = paint_shared.frame_of(&image, rect, window, cx);
                    let fitted = contain(rect, image.size(frame));
                    window
                        .paint_image(fitted, fitted, Corners::default(), image, frame, false)
                        .ok();
                }
                _ => window.paint_quad(fill(rect, palette.skeleton).corner_radii(px(4.))),
            }
        }),
    };
    let link_shared = shared.clone();
    let mention_shared = shared.clone();
    MessageText::new(("message-text", seq as u64), text.segments.clone())
        .list(list)
        .on_link(move |href, _, cx| {
            link_shared.emit(
                MessageListEvent::OpenLink {
                    url: href.to_owned(),
                },
                cx,
            );
        })
        .on_mention(move |mention, _, cx| {
            if mention.kind == crate::kit::chat::MentionKind::User
                && let Some(user_id) = &mention.id
            {
                mention_shared.emit(
                    MessageListEvent::OpenProfile {
                        user_id: user_id.to_string(),
                    },
                    cx,
                );
            }
        })
        .into_any_element()
}

/// A block of a row's words as painted in the last frame, for turning a pointer position into a
/// `Pos` and back.
pub(crate) struct BlockGeom {
    pub layout: TextLayout,
    pub bounds: Bounds<Pixels>,
    /// How many display bytes the block covers.
    pub selectable: u32,
    display_start: u32,
    /// Where the block starts in the words as drawn.
    drawn_start: usize,
    text: Rc<RowText>,
}

impl BlockGeom {
    fn map(&self) -> &DrawnMap {
        &self.text.map
    }

    /// The display byte for an index into this block's layout.
    pub fn display_of(&self, index: usize) -> u32 {
        self.map()
            .to_display((self.drawn_start + index) as u32)
            .clamp(self.display_start, self.display_start + self.selectable)
    }

    /// The index into this block's layout for a display byte.
    pub fn index_of(&self, byte: u32) -> usize {
        (self.map().to_drawn(byte) as usize).saturating_sub(self.drawn_start)
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

impl Shared {
    /// The frame to paint now, and a note of when the next one is due. Animations never ask for
    /// the next animation frame: that redraws the window at 60 fps. The view arms one timer for the
    /// soonest deadline instead. An image in the list's overdraw, measured but clipped, asks nothing.
    pub(crate) fn frame_of(
        &self,
        image: &RenderImage,
        bounds: Bounds<Pixels>,
        window: &Window,
        cx: &App,
    ) -> usize {
        if cx.reduce_motion() || image.frame_count() <= 1 {
            return 0;
        }
        let now = cx.background_executor().now();
        let started = match self.animation_started.get() {
            Some(started) => started,
            None => {
                self.animation_started.set(Some(now));
                now
            }
        };
        let Some((frame, wait)) = super::media::animation_frame(image, now.duration_since(started))
        else {
            return 0;
        };
        if bounds.intersect(&window.content_mask().bounds).is_empty() {
            return frame;
        }
        self.animated_paints.set(self.animated_paints.get() + 1);
        let soonest = self
            .next_animation_frame
            .get()
            .map_or(wait, |other| other.min(wait));
        self.next_animation_frame.set(Some(soonest));
        frame
    }
}
