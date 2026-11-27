//! One row of the list, following `frontend/src/components/Message/`: `MessageComponent` and its
//! styles, `MessageSpan`, `QuotePreview`, `MessageReactions`, `MessageAttachments`, `DaySeparator`,
//! `OptimisticMessageActions` and `ThreadReplyBadge`, with `messageGrouping.ts` for the grouping.

use super::actions::{
    ListPermissions, UnreadDivider, reaction_tooltip_lines, toolbar_buttons, unread_label,
};
use super::format::TimeFormat;
use super::media::{CacheKind, Media, MediaRef, MediaState, contain};
use super::palette::{AVATAR, Fonts, NAME_SIZE, Palette};
use super::seen::{self, SeenState};
use super::segments::{DrawnMap, RowText, row_text};
use super::selection::Selection;
use super::store::RowStore;
use super::text;
use super::third_party::{self, ThirdParty};
use super::view::{MessageList, MessageListEvent};
use crate::format::file_size;
use crate::kit::chat::{
    AttachmentKind as TileKind, AttachmentTile, LinkCard, ListText, MessageQuote,
    MessageRow as KitRow, MessageState, MessageText, OpenActionsRequest, ReactionChip, RowFocus,
    one_line,
};
use crate::kit::overlays::type_text;
use crate::kit::surface::{Surface, stand_out_fill, tint_base_token};
use crate::kit::{Button as KitButton, ControlSize, Icon, ListSeparator};
use crate::theme::SemTheme;
use crate::theme::color::{blend, hsla_of};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::links::check_link;
use semaphore_core::model::{
    AttachmentKind, AttachmentView, GifEmbed, LinkPreviewView, MessageRow, ReactionUsers, SendState,
};
use semaphore_design::chat::{IMAGE_MAX, image_box, strip_bidi};
use semaphore_design::lounge::{
    CONTROL_SM, ICON_MD, ICON_SM, ICON_XS, RADIUS_MD, RADIUS_SM, SPACE_2XS, SPACE_MD, SPACE_SM,
    SPACE_XS, STATE_HOVER, TEXT_BODY, TEXT_BODY_STRONG, TEXT_SMALL,
};
use semaphore_design::{Icon as IconName, LoungeIcon};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

const GROUP_WINDOW_MS: i64 = 5 * 60 * 1000;
/// Prepared rows held for repainting. About three screens' worth.
const PREPARED_LIMIT: usize = 512;
/// Animated avatars kept as still copies (`Shared::still`), before the copies are dropped.
const STILLS_LIMIT: usize = 64;
/// Row focus handles kept before the ones of rows no longer loaded are dropped.
const ROW_FOCUS_LIMIT: usize = 1024;

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
    /// Each row's focus handle, by seq, for the list's roving focus.
    pub row_focus: RefCell<HashMap<i64, FocusHandle>>,
    /// The row that holds the roving focus (the list's one Tab stop); the newest when unset.
    pub roving: Cell<Option<i64>>,
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

    pub(crate) fn prepared_for(&self, row: &Arc<MessageRow>) -> Rc<Prepared> {
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

    /// A row's focus handle, made the first time the row is drawn.
    pub(crate) fn row_focus(&self, seq: i64, cx: &mut App) -> RowFocus {
        let mut handles = self.row_focus.borrow_mut();
        if !handles.contains_key(&seq) && handles.len() >= ROW_FOCUS_LIMIT {
            // Keep the rows still in the list; a gone row's handle goes with it.
            let rows = self.rows.borrow();
            handles.retain(|seq, _| rows.by_seq(*seq).is_some());
        }
        let handle = handles
            .entry(seq)
            .or_insert_with(|| cx.focus_handle())
            .clone();
        RowFocus {
            handle,
            tab_stop: false,
        }
    }

    /// The row that is the list's Tab stop: the one the roving focus last held, else the newest.
    pub(crate) fn tab_stop_seq(&self) -> Option<i64> {
        let rows = self.rows.borrow();
        self.roving
            .get()
            .filter(|seq| rows.by_seq(*seq).is_some())
            .or_else(|| {
                rows.len()
                    .checked_sub(1)
                    .and_then(|ix| rows.get(ix))
                    .map(|row| row.seq)
            })
    }

    /// Where a menu asked for from the keyboard opens: under the start of the row's words.
    pub(crate) fn row_anchor(&self, seq: i64) -> Option<Point<Pixels>> {
        let visible = self.visible.borrow();
        let (_, block) = visible.range((seq, 0)..(seq + 1, 0)).next()?;
        Some(block.bounds.origin + point(px(0.), block.layout.line_height()))
    }

    /// Opens an address that is already `check_link`'s (`MessageText`'s and `LinkCard`'s
    /// `on_link` hand over only that).
    fn open_href(&self, href: &str, cx: &mut App) {
        self.emit(
            MessageListEvent::OpenLink {
                url: href.to_owned(),
            },
            cx,
        );
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

/// A row's part a press on which is its own: it starts no text selection.
fn unselectable(content: impl IntoElement) -> Div {
    own_presses().child(content)
}

/// A box of a row's parts that keep their presses (`unselectable`).
fn own_presses() -> Div {
    div()
        .min_w_0()
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
}

/// The key of a row's part that comes once per attachment, reaction or preview.
fn part_key(seq: i64, index: usize) -> u64 {
    (seq as u64) << 8 | index as u64
}

/// The tooltip's look for the list's own tips (who reacted, "Seen by"), as the kit's `Tip`.
fn tip_box(id: &'static str, label: impl Into<SharedString>, cx: &App) -> Stateful<Div> {
    let sem = cx.sem();
    div()
        .id(id)
        .role(Role::Tooltip)
        .aria_label(label.into())
        .flex()
        .flex_col()
        .gap(px(SPACE_2XS))
        .max_w(px(TIP_MAX_WIDTH))
        .px(px(SPACE_SM))
        .py(px(SPACE_XS))
        .rounded(px(RADIUS_SM))
        .bg(sem.tooltip_bg)
        .text_color(sem.tooltip_text)
        .font_family(TEXT_SMALL.family)
        .text_size(px(TEXT_SMALL.size))
        .line_height(px(TEXT_SMALL.line_height))
}

const TIP_MAX_WIDTH: f32 = 260.;

/// The message a reply answers: the kit's `MessageQuote`. A press jumps to it, unless it's gone.
fn render_quote(shared: &Rc<Shared>, row: &MessageRow, reply: &ReplyPreview) -> AnyElement {
    let line: SharedString = if reply.text.is_empty() {
        "Message".into()
    } else {
        // Without bidi controls, as the panels' previews.
        strip_bidi(&reply.text).replace('\n', " ").into()
    };
    let quote = MessageQuote::new(("reply", row.seq as u64), reply.author.clone(), line)
        .deleted(reply.deleted);
    let target = row
        .reply_to
        .as_ref()
        .filter(|reply_to| !reply_to.deleted && !reply_to.message_id.is_empty())
        .map(|reply_to| reply_to.message_id.clone());
    match target {
        Some(message_id) => {
            let event_shared = shared.clone();
            quote
                .on_open(move |_, cx| {
                    event_shared.emit(
                        MessageListEvent::OpenReply {
                            message_id: message_id.clone(),
                        },
                        cx,
                    );
                })
                .into_any_element()
        }
        None => quote.into_any_element(),
    }
}

/// A removed message's words, and who removed it and why: only moderators are sent those.
fn render_removed(row: &MessageRow, cx: &App) -> impl IntoElement {
    let role = &cx.sem().role;
    let by = row.removed_by.as_ref().map(|user| {
        user.display_name
            .clone()
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| user.username.clone())
    });
    let label = match (by, row.removed_reason.as_deref().filter(|r| !r.is_empty())) {
        (None, None) => None,
        (Some(by), None) => Some(format!("Removed by {by}")),
        (None, Some(reason)) => Some(format!("Removed: {reason}")),
        (Some(by), Some(reason)) => Some(format!("Removed by {by}: {reason}")),
    };
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .child(
            type_text(TEXT_BODY, "[Message deleted]")
                .italic()
                .text_color(role.text_dim),
        )
        .children(label.map(|label| {
            type_text(TEXT_SMALL, label)
                .id(("removed-by", row.seq as u64))
                .text_color(role.danger)
        }))
}

/// Opens (downloads) an attachment through the app.
fn open_attachment(shared: &Rc<Shared>, file_id: &str) -> impl Fn(&mut Window, &mut App) + 'static {
    let shared = shared.clone();
    let file_id = file_id.to_owned();
    move |_, cx| {
        shared.emit(
            MessageListEvent::OpenAttachment {
                file_id: file_id.clone(),
            },
            cx,
        );
    }
}

/// A file to download: the kit tile's file row, with its size.
fn file_tile(
    shared: &Rc<Shared>,
    seq: i64,
    index: usize,
    attachment: &AttachmentView,
) -> AnyElement {
    AttachmentTile::new(
        ("attachment", part_key(seq, index)),
        TileKind::File,
        attachment.filename.clone(),
    )
    .detail(file_size(attachment.size_bytes))
    .on_open(open_attachment(shared, &attachment.file_id))
    .into_any_element()
}

/// An image attachment: the kit tile, its box sized before the picture arrives, the picture
/// painted on the list's animation clock. Opens the viewer. One that can't be drawn is a file.
fn render_image(
    shared: &Rc<Shared>,
    seq: i64,
    index: usize,
    attachment: &AttachmentView,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let media = shared.media.source.attachment(attachment);
    let state = shared.media.resolve(media, CacheKind::Images, window, cx);
    let mut tile = AttachmentTile::new(
        ("image", part_key(seq, index)),
        TileKind::Image,
        attachment.filename.clone(),
    )
    .detail(file_size(attachment.size_bytes))
    .on_open(open_attachment(shared, &attachment.file_id));
    if let (Some(width), Some(height)) = (attachment.width, attachment.height) {
        tile = tile.size(f64::from(width), f64::from(height));
    }
    match state {
        MediaState::Ready(image) => tile
            .picture(image_canvas(shared, image, px(0.)))
            .into_any_element(),
        MediaState::Loading => tile.into_any_element(),
        // Unavailable, or refused as too big to decode: the file itself is still there to save.
        MediaState::Failed => file_tile(shared, seq, index, attachment),
    }
}

/// This client's uploads to the message, and what the server still waits for from others.
fn render_uploads(shared: &Rc<Shared>, row: &MessageRow, cx: &App) -> Vec<AnyElement> {
    let others = (row.pending_attachments as usize).saturating_sub(row.uploads.len());
    let mut items = Vec::new();
    for (index, upload) in row.uploads.iter().enumerate() {
        let mut tile = AttachmentTile::new(
            ("upload", part_key(row.seq, index)),
            TileKind::File,
            upload.name.clone(),
        )
        .detail(file_size(upload.size_bytes));
        match (&upload.failed, &row.client_nonce) {
            (Some(error), Some(nonce)) => {
                let (retry_shared, remove_shared) = (shared.clone(), shared.clone());
                let (retry_nonce, remove_nonce) = (nonce.clone(), nonce.clone());
                let index = index as u32;
                tile = tile
                    .error(error.message.clone())
                    .on_retry(move |_, cx| {
                        retry_shared.emit(
                            MessageListEvent::RetryUpload {
                                client_nonce: retry_nonce.clone(),
                                index,
                            },
                            cx,
                        );
                    })
                    .on_remove(move |_, cx| {
                        remove_shared.emit(
                            MessageListEvent::RemoveUpload {
                                client_nonce: remove_nonce.clone(),
                                index,
                            },
                            cx,
                        );
                    });
            }
            _ => {
                let fraction = if upload.size_bytes == 0 {
                    1.
                } else {
                    upload.sent_bytes as f32 / upload.size_bytes as f32
                };
                tile = tile.progress((fraction * 100.).clamp(0., 100.));
            }
        }
        items.push(tile.into_any_element());
    }
    if others > 0 {
        items.push(
            type_text(
                TEXT_SMALL,
                if others == 1 {
                    "1 file still uploading".to_owned()
                } else {
                    format!("{others} files still uploading")
                },
            )
            .text_color(cx.sem().role.text_secondary)
            .into_any_element(),
        );
    }
    items
}

/// The site a preview names: its own name, else the address's host.
fn preview_site(preview: &LinkPreviewView) -> String {
    if let Some(site) = preview.site_name.as_deref().filter(|site| !site.is_empty()) {
        return strip_bidi(site);
    }
    let label = link_label(&preview.url);
    let rest = label
        .split_once("://")
        .map_or(label.as_str(), |(_, rest)| rest);
    rest.split(['/', '?', '#'])
        .next()
        .unwrap_or(rest)
        .to_owned()
}

/// The link previews: the kit's `LinkCard`, opened through its checked address. The picture only
/// where the source allows third-party images; while they are off, "Image from <host>" and Load.
fn render_link_previews(
    shared: &Rc<Shared>,
    row: &MessageRow,
    window: &mut Window,
    cx: &mut App,
) -> Vec<AnyElement> {
    if row.removed {
        return Vec::new();
    }
    let mut items = Vec::new();
    for (index, preview) in row.link_previews.iter().enumerate() {
        let link_shared = shared.clone();
        let mut card = LinkCard::new(
            ("preview", part_key(row.seq, index)),
            preview.url.clone(),
            preview_site(preview),
        )
        .title(
            preview
                .title
                .clone()
                .unwrap_or_else(|| link_label(&preview.url)),
        )
        .on_link(move |href, _, cx| link_shared.open_href(href, cx));
        if let Some(description) = &preview.description {
            card = card.description(description.clone());
        }
        let mut blocked = None;
        match third_party::link_image(
            shared.third_party.get(),
            shared.media.source.as_ref(),
            preview,
        ) {
            None | Some(ThirdParty::Allowed(MediaRef::Missing)) => {}
            Some(ThirdParty::Blocked { host }) => {
                blocked = Some(render_image_strip(shared, row.seq, index, &host, cx));
            }
            Some(ThirdParty::Allowed(media)) => {
                if let MediaState::Ready(image) =
                    shared.media.resolve(media, CacheKind::Images, window, cx)
                {
                    card = card.image(ImageSource::Render(shared.still(image, window, cx)));
                }
            }
        }
        items.push(
            div()
                .flex()
                .flex_col()
                .gap(px(SPACE_XS))
                .w_full()
                .min_w_0()
                .child(card)
                .children(blocked)
                .into_any_element(),
        );
    }
    items
}

/// A "Load" button inside a row: it turns third-party pictures on for everything.
fn load_button(shared: &Rc<Shared>, id: String) -> impl IntoElement {
    let event_shared = shared.clone();
    KitButton::new(SharedString::from(id), "Load")
        .soft()
        .size(ControlSize::Sm)
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            event_shared.emit(MessageListEvent::EnableThirdPartyMedia, cx);
        })
}

/// The quiet box third-party pictures wait in while they are off.
fn blocked_look(el: Stateful<Div>, cx: &App) -> Stateful<Div> {
    let sem = cx.sem();
    el.role(Role::Group)
        .flex()
        .min_w_0()
        .max_w(px(IMAGE_MAX.width))
        .rounded(px(RADIUS_MD))
        .bg(stand_out_fill(sem, Surface::or_current(None, cx)))
        .text_color(sem.role.text_secondary)
}

/// A link preview's picture while third-party pictures are off: "Image from <host>" and Load.
fn render_image_strip(
    shared: &Rc<Shared>,
    seq: i64,
    index: usize,
    host: &SharedString,
    cx: &App,
) -> AnyElement {
    let title = SharedString::from(third_party::image_title(host));
    let secondary = cx.sem().role.text_secondary;
    blocked_look(
        div().id(SharedString::from(format!(
            "message-preview-blocked-{seq}-{index}"
        ))),
        cx,
    )
    .test_support()
    .aria_label(title.clone())
    .items_center()
    .gap(px(SPACE_SM))
    .w_full()
    .px(px(SPACE_MD))
    .py(px(SPACE_XS))
    .child(
        Icon::lounge(LoungeIcon::Image)
            .size(ICON_SM)
            .color(secondary),
    )
    .child(one_line(TEXT_SMALL, title).flex_1())
    .child(load_button(
        shared,
        format!("message-preview-load-{seq}-{index}"),
    ))
    .into_any_element()
}

/// A GIF message while third-party pictures are off: "GIF from <host>", what Load does, and Load.
fn render_gif_card(shared: &Rc<Shared>, seq: i64, host: &SharedString, cx: &App) -> AnyElement {
    let sem = cx.sem();
    let title = SharedString::from(third_party::gif_title(host));
    blocked_look(
        div().id(SharedString::from(format!("message-gif-blocked-{seq}"))),
        cx,
    )
    .test_support()
    .aria_label(title.clone())
    .items_start()
    .gap(px(SPACE_MD))
    .p(px(SPACE_MD))
    .child(
        div().flex_none().pt(px(SPACE_2XS)).child(
            Icon::lounge(LoungeIcon::ImagePlay)
                .size(ICON_MD)
                .color(sem.role.text_secondary),
        ),
    )
    .child(
        div()
            .flex()
            .flex_col()
            .gap(px(SPACE_2XS))
            .flex_1()
            .min_w_0()
            .child(one_line(TEXT_BODY_STRONG, title).text_color(sem.role.text))
            .child(type_text(TEXT_SMALL, third_party::GIF_NOTE))
            // Under the text, so a phone keeps the host and the note readable.
            .child(
                div()
                    .mt(px(SPACE_XS))
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
    let media = match third_party::gif(
        shared.third_party.get(),
        shared.media.source.as_ref(),
        embed,
    ) {
        ThirdParty::Blocked { host } => return Some(render_gif_card(shared, row.seq, &host, cx)),
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
    let sem = cx.sem();
    let fill = stand_out_fill(sem, Surface::or_current(None, cx));
    let frame = fitted_frame(width, height)
        .rounded(px(RADIUS_MD))
        .overflow_hidden();
    Some(match image {
        None => frame.bg(fill).into_any_element(),
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
                .child(image_canvas(shared, image, px(RADIUS_MD)))
                .into_any_element()
        }
    })
}

/// "Seen by" under the own latest message: an eye, two names and "+N", the full list on hover.
fn render_seen(shared: &Rc<Shared>, row: &MessageRow, cx: &App) -> Option<AnyElement> {
    let seen_state = shared.seen.borrow();
    let view = seen_state.for_row(row.seq)?;
    let line = seen::seen_line(view)?;
    let sem = cx.sem();
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
                    .snap_to_window_with_margin(px(SPACE_SM))
                    .child(div().pb(px(SPACE_XS)).child(render_seen_tooltip(tip, cx))),
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
            .flex()
            .items_center()
            .gap(px(SPACE_XS))
            .max_w(px(IMAGE_MAX.width))
            .min_w_0()
            .text_color(sem.role.text_secondary)
            .on_hover(move |hovered, _, cx| hover_shared.hover_seen(*hovered, cx))
            .child(
                Icon::lounge(LoungeIcon::Eye)
                    .size(ICON_XS)
                    .color(sem.role.text_secondary),
            )
            .child(one_line(TEXT_SMALL, line.names))
            .children(
                line.more
                    .map(|more| type_text(TEXT_SMALL, more).flex_none()),
            )
            .children(tooltip)
            .into_any_element(),
    )
}

/// Who has seen it: a header, the names, and "+N more".
fn render_seen_tooltip(tip: seen::SeenTooltip, cx: &App) -> impl IntoElement {
    tip_box("message-seen-tooltip", tip.header.clone(), cx)
        .test_support()
        .min_w(px(150.))
        .child(
            div()
                .font_weight(FontWeight(TEXT_BODY_STRONG.weight as f32))
                .truncate()
                .child(tip.header),
        )
        .when(tip.names.len() > 1 || tip.more.is_some(), |card| {
            card.children(
                tip.names
                    .into_iter()
                    .map(|name| div().truncate().child(name)),
            )
        })
        .children(tip.more.map(|more| div().italic().child(more)))
}

/// An audio or video attachment with its inline player, which outlives the row's element, in the
/// kit tile's player slot.
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
                    // The tile shows the name and size; the player only its controls.
                    view.update(cx, |view, _| view.set_in_tile(true));
                    cx.subscribe(view, move |_, event, cx| on_event(event, cx))
                }
                crate::player::AttachmentPlayer::Video(view) => {
                    let size = image_box(
                        attachment.width.map(f64::from),
                        attachment.height.map(f64::from),
                    );
                    view.update(cx, |view, _| view.set_size((size.width, size.height)));
                    cx.subscribe(view, move |_, event, cx| on_event(event, cx))
                }
            }
        },
        cx,
    );
    let kind = match player {
        crate::player::AttachmentPlayer::Audio(_) => TileKind::Audio,
        crate::player::AttachmentPlayer::Video(_) => TileKind::Video,
    };
    let key = part_key(row.seq, index);
    let mut tile = AttachmentTile::new(("attachment", key), kind, attachment.filename.clone())
        .detail(file_size(attachment.size_bytes))
        .on_open(open_attachment(shared, &attachment.file_id));
    if let (Some(width), Some(height)) = (attachment.width, attachment.height) {
        tile = tile.size(f64::from(width), f64::from(height));
    }
    tile.player(move |_slot| {
        div()
            .id(("attachment-player", key))
            .test_support()
            .size_full()
            .min_w_0()
            .flex()
            .items_center()
            .justify_center()
            // Presses on the controls are the player's, not the start of a text selection.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(player.into_any_element())
            .into_any_element()
    })
    .into_any_element()
}

/// The files: the kit's `AttachmentTile` each, a player in the tile for what plays.
fn render_attachments(
    shared: &Rc<Shared>,
    row: &MessageRow,
    window: &mut Window,
    cx: &mut App,
) -> Vec<AnyElement> {
    let mut items = Vec::with_capacity(row.attachments.len());
    for (index, attachment) in row.attachments.iter().enumerate() {
        let element = match attachment.kind {
            AttachmentKind::Image => render_image(shared, row.seq, index, attachment, window, cx),
            AttachmentKind::Video | AttachmentKind::Audio
                if let Some(players) = shared
                    .players
                    .as_ref()
                    // A removed message's files (a moderator sees them) don't play.
                    .filter(|_| !row.removed && crate::player::Players::plays(attachment)) =>
            {
                render_player(shared, players, row, index, attachment, cx)
            }
            AttachmentKind::Video
            | AttachmentKind::Audio
            | AttachmentKind::Document
            | AttachmentKind::Other => file_tile(shared, row.seq, index, attachment),
        };
        items.push(element);
    }
    items
}

/// The reactions: the kit's `ReactionChip` each, with who reacted above it on hover.
fn render_reactions(
    shared: &Rc<Shared>,
    row: &MessageRow,
    window: &mut Window,
    cx: &mut App,
) -> Vec<AnyElement> {
    let react = shared.permissions.get().react;
    let mut chips = Vec::with_capacity(row.reactions.len());
    for (index, reaction) in row.reactions.iter().enumerate() {
        let key = part_key(row.seq, index);
        let seq = row.seq;
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
                        .bottom(px(CONTROL_SM + SPACE_XS))
                        .child(render_reaction_tooltip(users.as_ref(), cx)),
                )
            });
        let (label, emoji_text, src): (String, String, Option<ImageSource>) = match reaction
            .emoji
            .strip_prefix("custom:")
        {
            Some(emoji_id) => {
                let media = shared.media.source.emoji(emoji_id);
                let state = shared.media.resolve(media, CacheKind::Small, window, cx);
                match state {
                    MediaState::Ready(image) => (
                        "Custom emoji".to_owned(),
                        "\u{2753}".to_owned(),
                        Some(ImageSource::Render(shared.still(image, window, cx))),
                    ),
                    // Its room, until the picture comes.
                    MediaState::Loading => ("Custom emoji".to_owned(), "\u{2003}".to_owned(), None),
                    // Unknown or deleted, as `CustomReactionLabel` shows it.
                    MediaState::Failed => ("Custom emoji".to_owned(), "\u{2753}".to_owned(), None),
                }
            }
            None => (
                crate::emoji::data::label(&reaction.emoji),
                reaction.emoji.clone(),
                None,
            ),
        };
        let toggle_shared = shared.clone();
        let people_shared = shared.clone();
        let (message_id, emoji) = (row.id.clone(), reaction.emoji.clone());
        let (people_id, people_emoji) = (row.id.clone(), reaction.emoji.clone());
        let mut chip = ReactionChip::new(
            ("reaction", key),
            emoji_text,
            label,
            u64::from(reaction.count),
        )
        .mine(reaction.me)
        .unavailable(!react)
        .on_toggle(move |_, cx| {
            if let Some(message_id) = message_id.clone() {
                toggle_shared.emit(
                    MessageListEvent::ToggleReaction {
                        message_id,
                        emoji: emoji.clone(),
                    },
                    cx,
                );
            }
        })
        .on_show_people(move |_, cx| {
            people_shared.hover_reaction(seq, people_id.as_deref(), &people_emoji, true, cx);
        });
        if let Some(src) = src {
            chip = chip.src(src);
        }
        let hover_shared = shared.clone();
        let (hover_id, hover_emoji) = (row.id.clone(), reaction.emoji.clone());
        chips.push(
            div()
                .id(("reaction-hover", key))
                .relative()
                .flex()
                .on_hover(move |hovered, _, cx| {
                    hover_shared.hover_reaction(
                        seq,
                        hover_id.as_deref(),
                        &hover_emoji,
                        *hovered,
                        cx,
                    );
                })
                .child(chip)
                .children(tooltip)
                .into_any_element(),
        );
    }
    chips
}

/// Who reacted: `+N more`, or `Loading...` until core has names.
fn render_reaction_tooltip(users: Option<&ReactionUsers>, cx: &App) -> impl IntoElement {
    let (names, more) = reaction_tooltip_lines(users);
    tip_box("reaction-tooltip", names.clone(), cx)
        .test_support()
        .whitespace_nowrap()
        .child(names)
        .when_some(more, |tip, more| tip.child(div().italic().child(more)))
}

/// The thread footer: "3 replies", a button that opens the thread.
fn render_thread_footer(shared: &Rc<Shared>, row: &MessageRow) -> Option<AnyElement> {
    if row.reply_count == 0 {
        return None;
    }
    let label = if row.reply_count == 1 {
        "1 reply".to_owned()
    } else {
        format!("{} replies", row.reply_count)
    };
    let event_shared = shared.clone();
    let message_id = row.id.clone();
    Some(
        KitButton::new(("thread", row.seq as u64), label.clone())
            .text()
            .size(ControlSize::Sm)
            .start_icon(IconName::Forum)
            .accessibility_label(format!("{label}, open the thread"))
            .on_click(move |_, _, cx| {
                if let Some(message_id) = message_id.clone() {
                    event_shared.emit(MessageListEvent::OpenThread { message_id }, cx);
                }
            })
            .into_any_element(),
    )
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
    let prepared = shared.prepared_for(&row);
    let pending = matches!(row.send_state, SendState::Pending) || row.edit_pending;
    let selected = shared
        .selection
        .get()
        .is_some_and(|selection| selection.covers(row.seq));
    let seq = row.seq;

    let reply = shared.replies.borrow().get(&row.seq).cloned();
    let quote = reply
        .as_ref()
        .map(|reply| unselectable(render_quote(shared, &row, reply)).max_w_full());

    let editor = shared
        .editing
        .borrow()
        .as_ref()
        .filter(|(seq, _)| *seq == row.seq)
        .map(|(_, editor)| editor.clone());
    let is_editing = editor.is_some();
    let mut body: Option<AnyElement> = None;
    let mut extras: Vec<AnyElement> = Vec::new();
    if row.removed {
        body = Some(render_removed(&row, cx).into_any_element());
    }
    if let Some(editor) = editor {
        body = Some(
            div()
                .id("message-editor")
                .w_full()
                .min_w_0()
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .child(editor)
                .into_any_element(),
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
            let words = render_words(shared, &row, &prepared.text, window, cx);
            // A moderator is sent a removed message's words: they go under "[Message deleted]".
            body = Some(match body.take() {
                Some(removed) => div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .min_w_0()
                    .child(removed)
                    .child(words)
                    .into_any_element(),
                None => words,
            });
        }
        extras.extend(gif);
        extras.extend(render_attachments(shared, &row, window, cx));
        extras.extend(render_uploads(shared, &row, cx));
        if !has_gif {
            extras.extend(render_link_previews(shared, &row, window, cx));
        }
    }
    // The own latest message's "Seen by" goes under the thread footer.
    let footer: Vec<AnyElement> = render_thread_footer(shared, &row)
        .into_iter()
        .chain(render_seen(shared, &row, cx))
        .collect();

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
    let focus = shared.row_focus(seq, cx);
    let focus_within = focus.handle.contains_focused(window, cx);
    if focus_within {
        shared.roving.set(Some(seq));
    }
    let tab_stop = shared.tab_stop_seq() == Some(seq);
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
    .focus(RowFocus {
        handle: focus.handle.clone(),
        tab_stop,
    })
    .reactions(
        render_reactions(shared, &row, window, cx)
            .into_iter()
            .map(unselectable),
    );
    if let Some(body) = body {
        kit_row = kit_row.body(body);
    }
    if !extras.is_empty() {
        kit_row = kit_row.attachments(
            own_presses()
                .flex()
                .flex_col()
                .items_start()
                .gap(px(SPACE_SM))
                .w_full()
                .min_w_0()
                .children(extras),
        );
    }
    if !footer.is_empty() {
        kit_row = kit_row.footer(own_presses().flex().flex_col().min_w_0().children(footer));
    }
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
    if !is_editing {
        let menu_shared = shared.clone();
        kit_row = kit_row.on_open_actions(move |request, window, cx| {
            let position = match request {
                OpenActionsRequest::Pointer { position }
                | OpenActionsRequest::Touch { position } => position,
                // Anchored to the row: the start of its words as last painted.
                OpenActionsRequest::Keyboard => menu_shared
                    .row_anchor(seq)
                    .unwrap_or_else(|| window.mouse_position()),
            };
            let view = menu_shared.view.borrow().clone();
            view.update(cx, |list, cx| list.open_menu(seq, position, cx))
                .ok();
        });
    }

    let staged = shared.staged_delete.get() == Some(row.seq);
    // One row's toolbar at a time: the list's hovered row (or the one whose menu is open or that
    // asks "Delete?"), and the row the keyboard brought focus into. Rows left out get no actions
    // at all, so a hover the kit row has not heard end yet, or a toolbar button pressed with the
    // pointer that kept focus, can't show a second toolbar.
    let toolbar_held =
        staged || shared.menu_for.get() == Some(row.seq) || shared.hovered.get() == Some(row.seq);
    if !is_editing && (toolbar_held || (focus_within && window.last_input_was_keyboard())) {
        let actions = toolbar_buttons(shared, &row, staged, shared.phone.get());
        if !actions.is_empty() {
            kit_row = kit_row.actions(actions).actions_shown(toolbar_held);
        }
    }
    let hover_shared = shared.clone();
    kit_row = kit_row.on_hover(move |hovered, _, cx| hover_shared.hover_row(seq, hovered, cx));
    let keys_shared = shared.clone();
    let keys_handle = focus.handle.clone();
    let mut container = div()
        .id(("message-item", row.seq as u64))
        .relative()
        .w_full()
        .px(px(SPACE_LIST_GUTTER))
        .role(Role::ListItem)
        .aria_selected(selected)
        .aria_position_in_set(ix + 1)
        .aria_size_of_set(total)
        // The list's roving focus: Up and Down, Home and End on the row itself.
        .on_key_down(move |event, window, cx| {
            if !keys_handle.is_focused(window) {
                return;
            }
            if let Some(step) = super::view::RowStep::of(&event.keystroke) {
                cx.stop_propagation();
                let view = keys_shared.view.borrow().clone();
                view.update(cx, |list, cx| list.move_row_focus(seq, step, window, cx))
                    .ok();
            }
        });
    if window.is_a11y_active() {
        container = container.aria_label(accessible_label(
            &row,
            &prepared.author,
            &prepared.clock,
            reply.as_ref(),
        ));
    }
    if staged {
        let p = cx.sem().roles;
        let under = tint_base_token(&p, Surface::or_current(None, cx));
        container = container.bg(hsla_of(blend(p.danger, under, STATE_HOVER)));
    }
    let container = container.child(kit_row);
    let divider = shared
        .unread
        .get()
        .filter(|divider| divider.after_seq == row.seq && ix + 1 < total)
        .map(|divider| ListSeparator::unread("unread-divider", unread_label(divider.count)));

    match (decor.day, divider) {
        (None, None) => container.into_any_element(),
        (day, divider) => div()
            .w_full()
            .children(day.map(|label| ListSeparator::day(("day", row.seq as u64), label)))
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
        plan: text.plan.clone(),
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
    MessageText::shared(("message-text", seq as u64), text.segments.clone())
        .list(list)
        .on_link(move |href, _, cx| link_shared.open_href(href, cx))
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
                .child(
                    Icon::lounge(LoungeIcon::MessageSquare)
                        .size(64.)
                        .color(palette.tint(palette.primary_light, 0.7)),
                ),
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
