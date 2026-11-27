//! The message list: `gpui::list` over `Arc<MessageRow>`, plus a selection the app owns.

use super::actions::{
    ListPermissions, MessageAction, UnreadDivider, delete_is_removal, render_menu, render_sheet,
};
use super::announce;
use super::format::TimeFormat;
use super::media::{Media, MediaSource};
use super::palette::{Fonts, Palette};
use super::row::{Decor, ReplyPreview, Shared, render_empty, render_row, render_skeleton};
use super::seen;
use super::selection::{self, Motion, Pos, Selection, Unit, UnitDrag};
use super::store::{RowChange, RowStore};
use super::text;
use crate::kit::{Button as KitButton, Dialog, TextField, live_node, text_state};
use gpui_kit::accesskit::Live;
use gpui_kit::base::AutoScroll;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::input::InputState;
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ListOp, MessageRow, ReactionUsers, SendState, UnreadMarker};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::time::Duration;

actions!(
    message_list,
    [
        CopySelection,
        SelectAll,
        ClearSelection,
        ExtendLeft,
        ExtendRight,
        ExtendUp,
        ExtendDown,
        ExtendWordLeft,
        ExtendWordRight,
        ExtendLineStart,
        ExtendLineEnd,
        ExtendToStart,
        ExtendToEnd,
    ]
);

const KEY_CONTEXT: &str = "MessageList";
/// Rows measured past each end of the viewport.
const OVERDRAW: Pixels = px(400.);
/// Ask for older rows when fewer than this many are left above the viewport.
const LOAD_OLDER_WITHIN: usize = 20;
/// A press that moves less than this is still a click, so a shaky hand can open a link.
const DRAG_THRESHOLD: Pixels = px(3.);
/// Never redraw faster than this for animation, whatever a GIF asks for.
const SHORTEST_ANIMATION_WAKE: Duration = Duration::from_millis(40);
const SKELETON_ROWS: usize = 12;

/// Keyboard shortcuts, the allocator setting, and anything else the list needs once per process.
/// The app calls this at startup.
pub fn init(cx: &mut App) {
    super::media::tune_allocator();
    // Rows are the kit's pieces, which read the theme. A host that set none (a rig) gets the
    // default one; the app's own is left alone.
    if !cx.has_global::<crate::theme::Sem>() {
        crate::theme::init(cx);
    }
    let context = Some(KEY_CONTEXT);
    // `KeyBinding::new` parses with no platform in hand, so it rejects GPUI's "secondary".
    macro_rules! chord {
        ($keys:literal) => {
            if cfg!(target_os = "macos") {
                concat!("cmd-", $keys)
            } else {
                concat!("ctrl-", $keys)
            }
        };
    }
    cx.bind_keys([
        KeyBinding::new(chord!("c"), CopySelection, context),
        KeyBinding::new(chord!("a"), SelectAll, context),
        KeyBinding::new("escape", ClearSelection, context),
        KeyBinding::new("shift-left", ExtendLeft, context),
        KeyBinding::new("shift-right", ExtendRight, context),
        KeyBinding::new("shift-up", ExtendUp, context),
        KeyBinding::new("shift-down", ExtendDown, context),
        KeyBinding::new(chord!("shift-left"), ExtendWordLeft, context),
        KeyBinding::new(chord!("shift-right"), ExtendWordRight, context),
        KeyBinding::new("shift-home", ExtendLineStart, context),
        KeyBinding::new("shift-end", ExtendLineEnd, context),
        KeyBinding::new(chord!("shift-home"), ExtendToStart, context),
        KeyBinding::new(chord!("shift-end"), ExtendToEnd, context),
    ]);
}

/// The window settings a message list needs. GPUI holds an unfocused window to about 30 fps by
/// default, and chat is read in unfocused windows. Every window that shows a list goes through this.
pub fn with_list_frame_policy(options: WindowOptions) -> WindowOptions {
    WindowOptions {
        inactive_frame_interval: None,
        ..options
    }
}

/// What the list asks of the app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageListEvent {
    /// U-freeze (UM): a "GIF from <host>: Load" or "Image from <host>: Load" card's Enable:
    /// `Core::set_third_party_media(true)` (the app also saves it and opens the fetcher).
    EnableThirdPartyMedia,
    /// U-freeze (UM): the pointer is over this message's "Seen by" (or left it: `None`); the
    /// owner feeds `set_seen_by` from `Core::seen_by(conversation, message_id)`.
    SeenByHovered {
        message_id: Option<String>,
    },
    /// Few rows left above the viewport: `Core::load_older`.
    LoadOlder,
    /// `Core::hold_rows`: core keeps this span loaded while a selection needs it.
    HoldRows(Option<(i64, i64)>),
    /// A link in a row was followed. `url` is always `check_link`'s address: the words' links come
    /// from `MessageText::on_link`, and a preview card's or a GIF's through `check_link`.
    OpenLink {
        url: String,
    },
    /// An author's name or avatar, or an @mention, was clicked: the owner opens their profile.
    OpenProfile {
        user_id: String,
    },
    OpenAttachment {
        file_id: String,
    },
    /// An inline player can't play this file: hand it to the OS's default app.
    OpenExternally {
        file_id: String,
    },
    OpenThread {
        message_id: String,
    },
    ToggleReaction {
        message_id: String,
        emoji: String,
    },
    RetrySend {
        client_nonce: String,
    },
    /// Throw a failed send away: `Core::discard_failed_send`.
    DiscardFailed {
        client_nonce: String,
    },
    /// Detached from the live edge, and few rows left below the viewport: `Core::load_newer`.
    LoadNewer,
    /// The "jump to present" button: `Core::jump_to_present`.
    JumpToPresent,
    /// A reply's quote was clicked: `Core::open_conversation_at` the message it answers.
    OpenReply {
        message_id: String,
    },
    /// A failed upload's Retry: `Core::retry_upload`.
    RetryUpload {
        client_nonce: String,
        index: u32,
    },
    /// A failed upload's Remove: `Core::remove_upload`.
    RemoveUpload {
        client_nonce: String,
        index: u32,
    },
    /// Reply: the owner puts the message in the composer's reply banner and focuses it.
    Reply {
        message_id: String,
    },
    /// Edit: the owner builds a composer in edit mode and calls `MessageList::set_editing`.
    Edit {
        message_id: String,
    },
    /// A confirmed delete: `Core::delete_message`. `reason` only for a moderator's removal.
    Delete {
        message_id: String,
        reason: Option<String>,
    },
    /// `Core::pin_message`.
    Pin {
        message_id: String,
    },
    /// `Core::unpin_message`.
    Unpin {
        message_id: String,
    },
    /// The react button: show the emoji picker at `anchor` (window coordinates), then
    /// `Core::add_reaction` with what was picked.
    OpenReactionPicker {
        message_id: String,
        anchor: Point<Pixels>,
    },
    /// The pointer is over a reaction: the owner reads `Core::reaction_users` and answers with
    /// `MessageList::set_reaction_users`, again on `ViewChanged { ReactionUsers }`.
    ReactionHovered {
        message_id: String,
        emoji: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ListStatus {
    Loading,
    Ready,
}

/// A list's starting data.
pub struct ListData {
    pub me_id: String,
    pub rows: Vec<MessageRow>,
    pub replies: HashMap<i64, ReplyPreview>,
    pub status: ListStatus,
}

pub struct ListOptions {
    pub time: TimeFormat,
    pub palette: Palette,
    /// Draw in the app's theme as it is at each frame (`crate::theme::Sem`), instead of `palette`.
    pub follow_theme: bool,
    /// Off for stories: the kit's scrollbar fades on a real clock, so with it two renders of the
    /// same frame differ, and T10 needs them identical.
    pub scrollbar: bool,
    /// Audio and video attachments play inline with these; `None` keeps them file rows.
    pub players: Option<crate::player::Players>,
}

impl Default for ListOptions {
    fn default() -> Self {
        Self {
            time: TimeFormat::default(),
            palette: Palette::dark(),
            follow_theme: false,
            scrollbar: true,
            players: None,
        }
    }
}

pub struct MessageList {
    pub(crate) shared: Rc<Shared>,
    pub(crate) list: ListState,
    focus: FocusHandle,
    status: ListStatus,
    scrollbar: bool,
    follow_theme: bool,
    /// Room under the last row (`set_bottom_room`).
    bottom_room: Pixels,
    auto: AutoScroll,
    dragging: bool,
    moved: bool,
    drag: Option<UnitDrag>,
    pressed_at: Point<Pixels>,
    pointer: Point<Pixels>,
    /// Where keyboard extension starts when nothing is selected: the last press.
    caret: Option<Pos>,
    /// The x a run of up and down keeps returning to across short lines.
    goal_x: Option<Pixels>,
    held: Option<(i64, i64)>,
    asked_older: bool,
    /// The rows loaded don't reach the newest: see `Core::at_live_edge`.
    detached: bool,
    asked_newer: bool,
    animation_timer: Option<Task<()>>,
    /// What a screen reader hears about messages that arrive off the live edge (`announce`).
    announce: announce::Announcer,
    /// The batch window's timer, while one is open.
    announce_timer: Option<Task<()>>,
    /// The right-click menu (or the phone sheet): the row and where it was asked for.
    menu: Option<(i64, Point<Pixels>)>,
    /// A moderator removing someone else's message: its seq, and the optional reason.
    remove: Option<(i64, Entity<InputState>)>,
    /// A reset happened: if a row had focus, the list takes it at the next draw.
    refocus_after_reset: bool,
}

/// Under this list width the toolbar is one button and the menu a bottom sheet.
const PHONE_WIDTH: f32 = 600.;

impl EventEmitter<MessageListEvent> for MessageList {}

/// A key that moves the list's roving focus from the row that has it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RowStep {
    Previous,
    Next,
    First,
    Last,
}

impl RowStep {
    /// Up, Down, Home or End, with no modifier.
    pub(crate) fn of(keystroke: &Keystroke) -> Option<Self> {
        let m = keystroke.modifiers;
        if m.shift || m.alt || m.control || m.platform || m.function {
            return None;
        }
        Some(match keystroke.key.as_str() {
            "up" => Self::Previous,
            "down" => Self::Next,
            "home" => Self::First,
            "end" => Self::Last,
            _ => return None,
        })
    }
}

impl MessageList {
    /// Whether third-party pictures (GIFs, link-preview images) may load
    /// (`Core::third_party_media()`). Off (the default) draws "Load" cards and never asks the
    /// media source for such a picture.
    /// Room under the last row. A list in a `ChatPane` keeps the typing line's height
    /// (`semaphore_design::chat::TYPING_LINE_HEIGHT`), which floats there, so it never covers a row.
    pub fn set_bottom_room(&mut self, room: Pixels, cx: &mut Context<Self>) {
        self.bottom_room = room;
        cx.notify();
    }

    pub fn set_third_party_media(&mut self, on: bool, cx: &mut Context<Self>) {
        if self.shared.third_party.replace(on) != on {
            // Cards and pictures differ in height, in rows on screen and off it.
            let count = self.list.item_count();
            self.list.remeasure_items(0..count);
        }
        cx.notify();
    }

    /// "Seen by" for the user's own latest message (`Core::seen_by`). The app feeds it when that
    /// message appears or changes and on `SeenByHovered`. It is kept for the message that was the
    /// own latest when it came, and dropped when another message takes that place.
    pub fn set_seen_by(
        &mut self,
        seen: Option<semaphore_core::model::SeenByView>,
        cx: &mut Context<Self>,
    ) {
        let changed = {
            let mut state = self.shared.seen.borrow_mut();
            let before = state.view.clone();
            state.answer(seen);
            before != state.view
        };
        if changed {
            self.remeasure_seen_target();
        }
        cx.notify();
    }

    /// A DM's read watermarks (`Core::dm_peer_reads`). Kept, but the list draws "Seen by" from
    /// `set_seen_by` alone: core decides who has seen a message.
    pub fn set_dm_peer_reads(
        &mut self,
        reads: Option<semaphore_core::model::DmPeerReadsView>,
        cx: &mut Context<Self>,
    ) {
        *self.shared.dm_peer_reads.borrow_mut() = reads;
        cx.notify();
    }

    /// The message "Seen by" would go under (the own latest sent one), for the app and tests.
    pub fn seen_by_target(&self) -> Option<String> {
        self.shared
            .seen
            .borrow()
            .target
            .as_ref()
            .map(|(_, id)| id.clone())
    }

    fn remeasure_seen_target(&self) {
        let seq = self
            .shared
            .seen
            .borrow()
            .target
            .as_ref()
            .map(|(seq, _)| *seq);
        if let Some(seq) = seq {
            self.remeasure_seq(seq);
        }
    }

    /// The rows changed: the own latest message may be another one now.
    fn retarget_seen(&mut self) {
        let target = seen::own_latest(self.shared.rows.borrow().iter().map(|row| row.as_ref()));
        let old = self
            .shared
            .seen
            .borrow()
            .target
            .as_ref()
            .map(|(seq, _)| *seq);
        if self.shared.seen.borrow_mut().retarget(target) {
            if let Some(old) = old {
                self.remeasure_seq(old);
            }
            self.remeasure_seen_target();
        }
    }

    pub fn new(
        data: ListData,
        media: Rc<dyn MediaSource>,
        options: ListOptions,
        cx: &mut Context<Self>,
    ) -> Self {
        let list_focus = cx.focus_handle();
        let shared = Rc::new(Shared {
            rows: RefCell::new(RowStore::new(data.rows)),
            prepared: RefCell::default(),
            visible: RefCell::new(BTreeMap::new()),
            selection: Cell::new(None),
            palette: Cell::new(options.palette),
            fonts: Fonts::pick(cx),
            stills: RefCell::default(),
            me_id: data.me_id,
            time: options.time,
            media: Media::new(media, cx),
            replies: RefCell::new(data.replies),
            frozen_decor: RefCell::default(),
            animation_started: Cell::new(None),
            next_animation_frame: Cell::new(None),
            animated_paints: Cell::new(0),
            view: RefCell::new(cx.weak_entity()),
            hovered: Cell::new(None),
            permissions: Cell::new(ListPermissions::default()),
            staged_delete: Cell::new(None),
            menu_for: Cell::new(None),
            editing: RefCell::new(None),
            unread: Cell::new(None),
            highlight: Cell::new(None),
            hovered_reaction: RefCell::new(None),
            reaction_users: RefCell::new(HashMap::new()),
            phone: Cell::new(false),
            players: options.players,
            list_players: crate::player::ListPlayers::default(),
            third_party: Cell::new(false),
            seen: RefCell::default(),
            seen_hovered: Cell::new(false),
            dm_peer_reads: RefCell::new(None),
            row_focus: RefCell::new(HashMap::new()),
            roving: Cell::new(None),
            focusable: Cell::new(None),
            drawn: RefCell::new(Vec::new()),
            last_drawn: RefCell::new(Vec::new()),
            viewport: Cell::new(Bounds::default()),
            placed_ix: Cell::new(None),
            used_stop: Cell::new(None),
            focus_row: Cell::new(None),
            list_focus: list_focus.clone(),
        });
        let target = seen::own_latest(shared.rows.borrow().iter().map(|row| row.as_ref()));
        shared.seen.borrow_mut().retarget(target);
        let count = shared.rows.borrow().len();
        let list = ListState::new(count, ListAlignment::Top, OVERDRAW);
        // Each row's focus handle goes to the list, so a row that has focus stays drawn.
        list.splice_focusable(0..count, shared.row_handles(0..count, cx));
        list.set_follow_mode(FollowMode::Tail);
        let weak = cx.weak_entity();
        list.set_scroll_handler(move |_, _, cx| {
            let weak = weak.clone();
            cx.defer(move |cx| {
                weak.update(cx, |_, cx| cx.notify()).ok();
            });
        });
        Self {
            shared,
            list,
            focus: list_focus,
            status: data.status,
            scrollbar: options.scrollbar,
            follow_theme: options.follow_theme,
            bottom_room: px(8.),
            auto: AutoScroll::default(),
            dragging: false,
            moved: false,
            drag: None,
            pressed_at: Point::default(),
            pointer: Point::default(),
            caret: None,
            goal_x: None,
            held: None,
            asked_older: false,
            detached: false,
            asked_newer: false,
            animation_timer: None,
            announce: announce::Announcer::default(),
            announce_timer: None,
            menu: None,
            remove: None,
            refocus_after_reset: false,
        }
    }

    /// What the user may do here; decides every row's toolbar and menu.
    pub fn set_permissions(&mut self, permissions: ListPermissions, cx: &mut Context<Self>) {
        if self.shared.permissions.replace(permissions) != permissions {
            cx.notify();
        }
    }

    /// Shows the toolbar on this row as if the pointer were over it. For stories and rigs.
    pub fn set_hovered(&mut self, seq: Option<i64>, cx: &mut Context<Self>) {
        self.shared.hovered.set(seq);
        cx.notify();
    }

    /// Draws `editor` in place of the row's text (the owner's composer in edit mode), or none.
    pub fn set_editing(&mut self, editing: Option<(i64, AnyView)>, cx: &mut Context<Self>) {
        let old = self.editing_seq();
        *self.shared.editing.borrow_mut() = editing;
        let new = self.editing_seq();
        for seq in [old, new].into_iter().flatten() {
            self.remeasure_seq(seq);
        }
        cx.notify();
    }

    pub fn editing_seq(&self) -> Option<i64> {
        self.shared.editing.borrow().as_ref().map(|(seq, _)| *seq)
    }

    /// `Core::unread_marker`: the divider goes below the row it names, once that row is loaded.
    pub fn set_unread_marker(&mut self, marker: Option<&UnreadMarker>, cx: &mut Context<Self>) {
        let divider = marker.and_then(|marker| {
            marker.after_seq.map(|after_seq| UnreadDivider {
                after_seq,
                count: marker.unread_count,
            })
        });
        let old = self.shared.unread.replace(divider);
        if old != divider {
            // The row the divider follows grows by it, and the one after it may lose its grouping.
            for seq in [old, divider].into_iter().flatten().map(|d| d.after_seq) {
                let ix = self.shared.rows.borrow().index_of(seq);
                if let Some(ix) = ix {
                    self.shared.frozen_decor.borrow_mut().remove(&seq);
                    let next = self.shared.rows.borrow().get(ix + 1).map(|row| row.seq);
                    if let Some(next) = next {
                        self.shared.frozen_decor.borrow_mut().remove(&next);
                    }
                    let end = (ix + 2).min(self.shared.rows.borrow().len());
                    self.list.remeasure_items(ix..end);
                }
            }
            cx.notify();
        }
    }

    pub fn unread_divider(&self) -> Option<UnreadDivider> {
        self.shared.unread.get()
    }

    /// Tints a row the user jumped to. The owner clears it after a moment.
    pub fn set_highlight(&mut self, seq: Option<i64>, cx: &mut Context<Self>) {
        if self.shared.highlight.replace(seq) != seq {
            cx.notify();
        }
    }

    /// Who reacted with `emoji`, for the tooltip.
    pub fn set_reaction_users(
        &mut self,
        message_id: String,
        emoji: String,
        users: ReactionUsers,
        cx: &mut Context<Self>,
    ) {
        self.shared
            .reaction_users
            .borrow_mut()
            .insert((message_id, emoji), users);
        cx.notify();
    }

    /// Shows the tooltip of a reaction as if the pointer were over it. For stories and rigs.
    pub fn set_hovered_reaction(&mut self, hovered: Option<(i64, String)>, cx: &mut Context<Self>) {
        *self.shared.hovered_reaction.borrow_mut() = hovered;
        cx.notify();
    }

    fn remeasure_seq(&self, seq: i64) {
        if let Some(ix) = self.shared.rows.borrow().index_of(seq) {
            self.list.remeasure_items(ix..ix + 1);
        }
    }

    fn message_id(&self, seq: i64) -> Option<String> {
        self.shared
            .rows
            .borrow()
            .by_seq(seq)
            .and_then(|row| row.id.clone())
    }

    /// Opens the actions menu for a row at `position` (a sheet at a phone's width). Nothing if the
    /// row offers no actions.
    pub fn open_menu(&mut self, seq: i64, position: Point<Pixels>, cx: &mut Context<Self>) {
        let has_actions = self.shared.rows.borrow().by_seq(seq).is_some_and(|row| {
            !super::actions::message_actions(row, self.shared.permissions.get()).is_empty()
        });
        if !has_actions {
            return;
        }
        self.menu = Some((seq, position));
        self.shared.menu_for.set(Some(seq));
        cx.notify();
    }

    pub fn close_menu(&mut self, cx: &mut Context<Self>) {
        if self.menu.take().is_some() {
            self.shared.menu_for.set(None);
            cx.notify();
        }
    }

    pub fn menu_open(&self) -> Option<i64> {
        self.menu.map(|(seq, _)| seq)
    }

    /// What a toolbar button, menu item or sheet item does.
    pub fn run_action(
        &mut self,
        seq: i64,
        action: MessageAction,
        anchor: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_menu(cx);
        let Some(message_id) = self.message_id(seq) else {
            return;
        };
        match action {
            MessageAction::React => {
                cx.emit(MessageListEvent::OpenReactionPicker { message_id, anchor })
            }
            MessageAction::Reply => cx.emit(MessageListEvent::Reply { message_id }),
            MessageAction::Thread => cx.emit(MessageListEvent::OpenThread { message_id }),
            MessageAction::Edit => cx.emit(MessageListEvent::Edit { message_id }),
            MessageAction::Pin => cx.emit(MessageListEvent::Pin { message_id }),
            MessageAction::Unpin => cx.emit(MessageListEvent::Unpin { message_id }),
            MessageAction::Copy => {
                let text = self
                    .shared
                    .rows
                    .borrow()
                    .by_seq(seq)
                    .map(|row| text::plain_text(row))
                    .unwrap_or_default();
                if !text.is_empty() {
                    cx.write_to_clipboard(ClipboardItem::new_string(text));
                }
            }
            MessageAction::Delete => {
                let removal = self
                    .shared
                    .rows
                    .borrow()
                    .by_seq(seq)
                    .is_some_and(|row| delete_is_removal(row, self.shared.permissions.get()));
                if removal {
                    let reason = text_state(window, cx, false);
                    self.remove = Some((seq, reason));
                } else {
                    self.shared.staged_delete.set(Some(seq));
                }
                cx.notify();
            }
        }
    }

    /// Opens the moderator's removal dialog for a row. For stories and rigs; a click on Delete does
    /// the same.
    pub fn open_remove_dialog(&mut self, seq: i64, window: &mut Window, cx: &mut Context<Self>) {
        let reason = text_state(window, cx, false);
        self.remove = Some((seq, reason));
        cx.notify();
    }

    pub fn hovered(&self) -> Option<i64> {
        self.shared.hovered.get()
    }

    pub fn remove_dialog_open(&self) -> bool {
        self.remove.is_some()
    }

    pub fn staged_delete(&self) -> Option<i64> {
        self.shared.staged_delete.get()
    }

    /// The staged delete's confirm, or the removal dialog's Remove.
    pub fn confirm_delete(&mut self, seq: i64, reason: Option<String>, cx: &mut Context<Self>) {
        self.shared.staged_delete.set(None);
        self.remove = None;
        if let Some(message_id) = self.message_id(seq) {
            let reason = reason
                .map(|reason| reason.trim().to_owned())
                .filter(|reason| !reason.is_empty());
            cx.emit(MessageListEvent::Delete { message_id, reason });
        }
        cx.notify();
    }

    pub fn cancel_delete(&mut self, cx: &mut Context<Self>) {
        self.shared.staged_delete.set(None);
        self.remove = None;
        cx.notify();
    }

    /// A quick reaction from the phone sheet: toggles it, as a chip does.
    pub fn quick_react(&mut self, seq: i64, emoji: String, cx: &mut Context<Self>) {
        self.close_menu(cx);
        if let Some(message_id) = self.message_id(seq) {
            cx.emit(MessageListEvent::ToggleReaction { message_id, emoji });
        }
    }

    /// Escape: closes whatever is open, else clears the selection. With nothing open, nothing
    /// staged and nothing selected the list has nothing to do, and the key goes on: the pane's
    /// own Escape closes its side panel or marks the conversation read.
    fn escape(&mut self, cx: &mut Context<Self>) {
        if self.menu.is_some() {
            self.close_menu(cx);
        } else if self.remove.is_some() || self.shared.staged_delete.get().is_some() {
            self.cancel_delete(cx);
        } else if self.shared.selection.get().is_some() {
            self.set_selection(None, cx);
        } else {
            cx.propagate();
        }
    }

    fn render_remove_dialog(&self, cx: &mut Context<Self>) -> Option<impl IntoElement + use<>> {
        let (seq, reason) = self.remove.clone()?;
        let confirm_reason = reason.clone();
        Some(
            Dialog::new("remove-message-dialog", "Remove message")
                .width(400.)
                .on_close({
                    let view = cx.weak_entity();
                    move |_, cx| {
                        view.update(cx, |list, cx| list.cancel_delete(cx)).ok();
                    }
                })
                .body(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(16.))
                        .child("Remove this message for everyone? Moderators will still see it.")
                        .child(
                            TextField::new("remove-reason", &reason, "Reason (optional)")
                                .placeholder("Shown to moderators"),
                        ),
                )
                .action(KitButton::new("remove-cancel", "Cancel").ghost().on_click({
                    let view = cx.weak_entity();
                    move |_, _, cx| {
                        view.update(cx, |list, cx| list.cancel_delete(cx)).ok();
                    }
                }))
                .action(
                    KitButton::new("remove-confirm", "Remove")
                        .danger()
                        .on_click({
                            let view = cx.weak_entity();
                            move |_, _, cx| {
                                let reason = confirm_reason.read(cx).value().to_string();
                                view.update(cx, |list, cx| {
                                    list.confirm_delete(seq, Some(reason), cx)
                                })
                                .ok();
                            }
                        }),
                ),
        )
    }

    /// Moves the roving focus from the row `from` by `step`: the row it lands on is scrolled into
    /// view, becomes the list's Tab stop and takes focus.
    pub(crate) fn move_row_focus(
        &mut self,
        from: i64,
        step: RowStep,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target = {
            let rows = self.shared.rows.borrow();
            let Some(ix) = rows.index_of(from) else {
                return;
            };
            let last = rows.len().saturating_sub(1);
            let to = match step {
                RowStep::Previous => ix.saturating_sub(1),
                RowStep::Next => (ix + 1).min(last),
                RowStep::First => 0,
                RowStep::Last => last,
            };
            rows.get(to).map(|row| (to, row.seq))
        };
        let Some((ix, seq)) = target else {
            return;
        };
        let last = self.shared.rows.borrow().len().saturating_sub(1);
        if ix == last {
            self.list.set_follow_mode(FollowMode::Tail);
        } else {
            // Following the tail would snap the list back to the end at the next layout.
            self.list.set_follow_mode(FollowMode::Normal);
        }
        self.list.scroll_to_reveal_item(ix);
        self.shared.roving.set(Some(seq));
        self.sync_focusable_row(cx);
        let handle = self.shared.row_focus(seq, cx).handle;
        window.focus(&handle, cx);
        cx.notify();
    }

    /// Hands the list the roving row's focus handle (and takes the last one's back), so the row
    /// with focus stays drawn when it scrolls out of view.
    fn sync_focusable_row(&mut self, cx: &mut Context<Self>) {
        let wanted = self.shared.roving.get();
        let held = self.shared.focusable.get();
        if wanted == held {
            return;
        }
        let index_of =
            |seq: Option<i64>| seq.and_then(|seq| self.shared.rows.borrow().index_of(seq));
        let (old, new) = (index_of(held), index_of(wanted));
        self.shared.focusable.set(wanted);
        // A splice puts the list back at the top of the row it is scrolled to, and the follow
        // state with it: keep both.
        let top = self.list.logical_scroll_top();
        let following = self.list.is_following_tail();
        for ix in [old, new].into_iter().flatten() {
            let handles = self.shared.row_handles(ix..ix + 1, cx);
            self.list.splice_focusable(ix..ix + 1, handles);
        }
        if following {
            self.list.set_follow_mode(FollowMode::Tail);
        } else if self.list.logical_scroll_top() != top {
            self.list.scroll_to(top);
        }
    }

    /// After a draw: if focus was in a row and the window now has none, the row (or the list, if
    /// the row is gone) takes it. If focus is elsewhere, the list forgets the row.
    fn recover_focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(seq) = self.shared.focus_row.get() else {
            return;
        };
        if window.focused(cx).is_some() {
            if !self.focus.contains_focused(window, cx) {
                self.shared.focus_row.set(None);
            }
            return;
        }
        let present = self.shared.rows.borrow().by_seq(seq).is_some();
        if present {
            let handle = self.shared.row_focus(seq, cx).handle;
            window.focus(&handle, cx);
        } else {
            window.focus(&self.focus, cx);
        }
        cx.notify();
    }

    /// The row holding the list's roving focus (its one Tab stop).
    pub fn focused_row(&self) -> Option<i64> {
        self.shared.tab_stop_seq()
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    pub fn set_status(&mut self, status: ListStatus, cx: &mut Context<Self>) {
        self.status = status;
        cx.notify();
    }

    /// Whether the rows here stop short of the newest. The owner reads `Core::at_live_edge` after
    /// each change. While detached the list asks for newer rows near its end, offers a way back to the
    /// present, and doesn't follow the tail.
    pub fn set_detached(&mut self, detached: bool, cx: &mut Context<Self>) {
        if detached != self.detached {
            self.detached = detached;
            self.asked_newer = false;
            cx.notify();
        }
    }

    pub fn is_detached(&self) -> bool {
        self.detached
    }

    pub fn set_replies(&mut self, replies: HashMap<i64, ReplyPreview>, cx: &mut Context<Self>) {
        *self.shared.replies.borrow_mut() = replies;
        self.list.remeasure();
        cx.notify();
    }

    /// Takes one change from core. The list keeps its anchor through it, and follows the tail if
    /// it was at the end.
    pub fn apply(&mut self, op: ListOp, cx: &mut Context<Self>) {
        // Before the change: the web's "scrolled away" rule is the state the reader was in when
        // the message arrived, and a detached window's newer pages are history, not arrivals.
        let len_before = self.shared.rows.borrow().len();
        let away = !self.detached && !self.list.is_following_tail();
        let loading = self.status == ListStatus::Loading;
        let announce = self.announce.observe(&op, len_before, away, loading);
        let own_send_at_end = match &op {
            ListOp::Insert { index, rows } => {
                *index as usize >= self.shared.rows.borrow().len()
                    && rows
                        .iter()
                        .any(|row| matches!(row.send_state, SendState::Pending))
            }
            _ => false,
        };
        let inserted_at_front = matches!(&op, ListOp::Insert { index: 0, .. });
        let replaced_seqs: Vec<i64> = match &op {
            ListOp::Replace { rows, .. } => rows.iter().map(|row| row.seq).collect(),
            _ => Vec::new(),
        };
        // A row's header and separator depend on the row before it, so a change above the row the
        // reader is anchored on could resize that row. Decide that while the old neighbours are here.
        if let ListOp::Insert { index, .. } = &op {
            self.freeze_anchor_decor(*index as usize);
        } else if let ListOp::Remove { index, count } = &op {
            self.freeze_anchor_decor(index.saturating_add(*count) as usize);
        }
        let change = self.shared.rows.borrow_mut().apply(op);
        self.shared.prune_row_focus();
        // A deleted or removed message's player goes with it, and stops.
        self.shared
            .list_players
            .retain_rows(self.shared.rows.borrow().iter().map(|row| row.as_ref()));
        match change {
            RowChange::Reset { count } => {
                self.shared.prepared.borrow_mut().clear();
                self.shared.frozen_decor.borrow_mut().clear();
                // Seqs aren't stable across a reset, so a held selection now means nothing.
                self.set_selection(None, cx);
                self.caret = None;
                // Another conversation, or the same one anew: the newest row is the Tab stop,
                // and a row that had focus gives it to the list (`render`), even if a new row
                // has its seq.
                self.shared.roving.set(None);
                self.shared.focusable.set(None);
                self.shared.focus_row.set(None);
                self.refocus_after_reset = true;
                self.list.reset(count);
                self.list
                    .splice_focusable(0..count, self.shared.row_handles(0..count, cx));
                self.list.set_follow_mode(FollowMode::Tail);
            }
            RowChange::Splice { old, count } => {
                self.list.splice_focusable(
                    old.clone(),
                    self.shared.row_handles(old.start..old.start + count, cx),
                );
                let after = old.start + count;
                if after < self.list.item_count() {
                    self.list.remeasure_items(after..after + 1);
                }
            }
            RowChange::Replaced { range } => {
                {
                    let mut prepared = self.shared.prepared.borrow_mut();
                    for seq in replaced_seqs {
                        prepared.remove(&seq);
                    }
                }
                let end = (range.end + 1).min(self.list.item_count());
                self.list.remeasure_items(range.start..end);
            }
            RowChange::Nothing => {}
        }
        if inserted_at_front {
            self.asked_older = false;
        } else {
            // Rows arrived at the end, or the list changed shape: whatever was asked has answered.
            self.asked_newer = false;
        }
        if own_send_at_end {
            self.scroll_to_latest();
        }
        self.retarget_seen();
        if announce {
            self.arm_announcement(cx);
        }
        cx.notify();
    }

    /// Opens the announcement batch's window: two seconds after the first message that arrived off
    /// the live edge, the batch is read out.
    fn arm_announcement(&mut self, cx: &mut Context<Self>) {
        let epoch = self.announce.epoch();
        let timer = cx.background_executor().timer(announce::BATCH_WINDOW);
        self.announce_timer = Some(cx.spawn(async move |this, cx| {
            timer.await;
            this.update(cx, |list, cx| {
                if list.announce.flush(epoch).is_some() {
                    cx.notify();
                }
            })
            .ok();
        }));
    }

    /// What the announcement region last said (`None` before the first announcement), for tests
    /// and rigs.
    pub fn announcement(&self) -> Option<&crate::kit::Said> {
        self.announce.last()
    }

    /// When rows change above index `following`, and that row is the one the list is anchored on,
    /// keeps its current header and separator for now. Its neighbour may now say it continues a run,
    /// and removing a header from the row at the top of the viewport would move everything below it.
    /// `render` lets go once the row is out of view, when its height no longer matters.
    fn freeze_anchor_decor(&mut self, following: usize) {
        if self.list.logical_scroll_top().item_ix != following {
            return;
        }
        let rows = self.shared.rows.borrow();
        if let Some(row) = rows.get(following) {
            let decor: Decor = self.shared.decor_at(&rows, following);
            self.shared.frozen_decor.borrow_mut().insert(row.seq, decor);
        }
    }

    fn release_frozen_decor(&mut self) {
        let mut frozen = self.shared.frozen_decor.borrow_mut();
        if frozen.is_empty() {
            return;
        }
        let rows = self.shared.rows.borrow();
        frozen.retain(|seq, _| {
            let Some(ix) = rows.index_of(*seq) else {
                return false;
            };
            let out_of_view = self.list.item_is_above_viewport(ix) == Some(true)
                || self.list.item_is_below_viewport(ix) == Some(true);
            if out_of_view {
                self.list.remeasure_items(ix..ix + 1);
            }
            !out_of_view
        });
    }

    /// The inline players this list holds, drawn or not.
    pub fn players(&self) -> Vec<crate::player::AttachmentPlayer> {
        self.shared.list_players.players()
    }

    pub fn row_count(&self) -> usize {
        self.shared.rows.borrow().len()
    }

    /// Scrolls so `seq`'s row is at the top, `offset` pixels into it.
    pub fn scroll_to_seq(&self, seq: i64, offset: f32) {
        if let Some(ix) = self.shared.rows.borrow().index_of(seq) {
            self.list.set_follow_mode(FollowMode::Normal);
            self.list.scroll_to(ListOffset {
                item_ix: ix,
                offset_in_item: px(offset),
            });
        }
    }

    pub fn scroll_to_latest(&self) {
        self.list.set_follow_mode(FollowMode::Tail);
    }

    pub fn is_following_tail(&self) -> bool {
        self.list.is_following_tail()
    }

    pub fn selection(&self) -> Option<Selection> {
        self.shared.selection.get()
    }

    pub fn set_selection(&mut self, selection: Option<Selection>, cx: &mut Context<Self>) {
        let selection = selection.map(|selection| self.widen_out_of_links(selection));
        self.shared.selection.set(selection);
        let held = selection.map(|selection| selection.seq_range());
        if held != self.held {
            self.held = held;
            cx.emit(MessageListEvent::HoldRows(held));
        }
        cx.notify();
    }

    /// A selection end inside a relabelled link (drawn by a label other than its written text)
    /// widens to the link's end away from the other end, so the link is one unit: a drag from
    /// inside it takes it all, and a key step into it crosses it. Highlight and copy then agree.
    fn widen_out_of_links(&self, selection: Selection) -> Selection {
        let rows = self.shared.rows.borrow();
        let widen = |pos: Pos, to_end: bool| {
            let Some(row) = rows.by_seq(pos.seq).cloned() else {
                return pos;
            };
            match self.shared.prepared_for(&row).text.map.atomic_at(pos.byte) {
                Some(link) => Pos {
                    seq: pos.seq,
                    byte: if to_end { link.end } else { link.start },
                },
                None => pos,
            }
        };
        if selection.is_empty() {
            let at = widen(selection.cursor, false);
            return Selection {
                anchor: at,
                cursor: at,
            };
        }
        let forward = selection.anchor <= selection.cursor;
        Selection {
            anchor: widen(selection.anchor, !forward),
            cursor: widen(selection.cursor, forward),
        }
    }

    pub fn selected_text(&self) -> String {
        self.shared
            .selection
            .get()
            .map_or_else(String::new, |selection| {
                selection::copy_text(&self.shared.rows.borrow(), selection)
            })
    }

    pub fn copy(&mut self, cx: &mut Context<Self>) {
        let text = self.selected_text();
        if !text.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    pub fn select_all(&mut self, cx: &mut Context<Self>) {
        let selection = selection::select_all(&self.shared.rows.borrow());
        self.set_selection(selection, cx);
    }

    /// The text position for a window point: the painted block at that height, or the nearest.
    pub fn hit(&self, position: Point<Pixels>) -> Option<Pos> {
        let visible = self.shared.visible.borrow();
        let mut best = None;
        let mut best_distance = Pixels::MAX;
        for (key, block) in visible.iter() {
            let distance = if position.y < block.bounds.top() {
                block.bounds.top() - position.y
            } else if position.y >= block.bounds.bottom() {
                position.y - block.bounds.bottom()
            } else {
                px(0.)
            };
            if distance < best_distance {
                best = Some((key, block));
                best_distance = distance;
            }
        }
        let (&(seq, base), block) = best?;
        let byte = if position.y < block.bounds.top() {
            base
        } else if position.y >= block.bounds.bottom() {
            base + block.selectable
        } else {
            block.display_of(
                block
                    .layout
                    .index_for_position(position)
                    .unwrap_or_else(|closest| closest),
            )
        };
        Some(Pos { seq, byte })
    }

    /// Text blocks painted in the last frame, in order, with their bounds.
    pub fn painted_blocks(&self) -> Vec<(i64, Bounds<Pixels>)> {
        self.shared
            .visible
            .borrow()
            .iter()
            .map(|((seq, _), block)| (*seq, block.bounds))
            .collect()
    }

    /// Where a byte of a painted row is, plus half a line, so the point lands on the glyphs.
    pub fn point_of(&self, pos: Pos) -> Option<Point<Pixels>> {
        let visible = self.shared.visible.borrow();
        let (_, block) = visible
            .range((pos.seq, 0)..=(pos.seq, pos.byte))
            .next_back()?;
        let index = block.index_of(pos.byte);
        let line = block.layout.line_height();
        let mut position = block.layout.position_for_index(index)?;
        // At a soft wrap the index is drawn at the start of the next line, not past the end of
        // this one, where nothing is under the point.
        let on_glyph = |at: Point<Pixels>| {
            block
                .layout
                .index_for_position(point(at.x + px(1.), at.y + line / 2.))
                .ok()
        };
        if on_glyph(position) != Some(index) {
            let next = point(block.bounds.left(), position.y + line);
            if on_glyph(next) == Some(index) {
                position = next;
            }
        }
        Some(point(position.x + px(1.), position.y + line / 2.))
    }

    /// How many animated images have painted since the list opened. The rigs use this.
    pub fn animated_paints(&self) -> u64 {
        self.shared.animated_paints.get()
    }

    /// Bytes each image cache holds, and how many images the larger one has evicted.
    pub fn image_cache_stats(&self, cx: &App) -> (usize, usize, usize) {
        let images = self.shared.media.images.read(cx);
        (
            images.bytes(),
            self.shared.media.small.read(cx).bytes(),
            images.evicted,
        )
    }

    fn clamped_pointer(&self) -> Point<Pixels> {
        let viewport = self.list.viewport_bounds();
        point(
            self.pointer.x,
            self.pointer
                .y
                .clamp(viewport.top(), viewport.bottom() - px(1.)),
        )
    }

    fn update_drag(&mut self, cx: &mut Context<Self>) {
        let Some(hit) = self.hit(self.clamped_pointer()) else {
            return;
        };
        let (Some(drag), Some(row)) = (
            self.drag,
            self.shared.rows.borrow().by_seq(hit.seq).cloned(),
        ) else {
            return;
        };
        self.set_selection(Some(drag.to(&row, hit)), cx);
        self.caret = Some(hit);
    }

    fn on_press(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        // A pointer press focuses the list, as it always did, so its shortcuts work wherever the
        // pressed row scrolls to. Rows take focus from the keyboard.
        window.focus(&self.focus, cx);
        self.pointer = event.position;
        self.pressed_at = event.position;
        self.moved = false;
        self.goal_x = None;
        let Some(hit) = self.hit(event.position) else {
            self.set_selection(None, cx);
            return;
        };
        let Some(row) = self.shared.rows.borrow().by_seq(hit.seq).cloned() else {
            return;
        };
        let existing = self.shared.selection.get();
        let drag = match existing {
            Some(selection) if event.modifiers.shift => UnitDrag {
                unit: Unit::Char,
                first: (selection.anchor, selection.anchor),
            },
            _ => UnitDrag::start(Unit::from_click_count(event.click_count), &row, hit.byte),
        };
        self.drag = Some(drag);
        self.caret = Some(hit);
        let selection = if event.modifiers.shift {
            drag.to(&row, hit)
        } else {
            Selection {
                anchor: drag.first.0,
                cursor: drag.first.1,
            }
        };
        self.set_selection(Some(selection), cx);
        self.dragging = true;
    }

    fn on_move(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if !self.dragging {
            return;
        }
        let offset = event.position - self.pressed_at;
        self.moved |= offset.x.abs() > DRAG_THRESHOLD || offset.y.abs() > DRAG_THRESHOLD;
        self.pointer = event.position;
        if !self.moved {
            return;
        }
        self.update_drag(cx);
        let delta = AutoScroll::compute_delta(event.position.y, self.list.viewport_bounds());
        self.auto.set(delta, cx, |delta, view: &mut Self, cx| {
            view.list.scroll_by(delta);
            view.update_drag(cx);
            cx.notify();
        });
        cx.notify();
    }

    fn on_release(&mut self, event: &MouseUpEvent, cx: &mut Context<Self>) {
        if !self.dragging {
            return;
        }
        self.dragging = false;
        self.pointer = event.position;
        self.auto.stop();
        // A click on a link or a mention is the words' own (`MessageText`'s `on_link`).
        if self.moved {
            self.update_drag(cx);
        }
        if self
            .shared
            .selection
            .get()
            .is_some_and(|selection| selection.is_empty())
        {
            self.set_selection(None, cx);
        }
        cx.notify();
    }

    /// Where keyboard extension starts: the selection's moving end, else the last press, else the
    /// last text on screen.
    fn keyboard_cursor(&self) -> Option<Pos> {
        if let Some(selection) = self.shared.selection.get() {
            return Some(selection.cursor);
        }
        if self.caret.is_some() {
            return self.caret;
        }
        let visible = self.shared.visible.borrow();
        let ((seq, base), block) = visible.iter().next_back()?;
        Some(Pos {
            seq: *seq,
            byte: base + block.selectable,
        })
    }

    fn extend_to(&mut self, target: Pos, cx: &mut Context<Self>) {
        let anchor = self
            .shared
            .selection
            .get()
            .map_or_else(|| self.keyboard_cursor().unwrap_or(target), |s| s.anchor);
        self.caret = Some(target);
        let selection = Selection {
            anchor,
            cursor: target,
        };
        self.set_selection((!selection.is_empty()).then_some(selection), cx);
        if let Some(ix) = self.shared.rows.borrow().index_of(target.seq) {
            self.list.scroll_to_reveal_item(ix);
        }
    }

    fn extend(&mut self, motion: Motion, cx: &mut Context<Self>) {
        let Some(cursor) = self.keyboard_cursor() else {
            return;
        };
        self.goal_x = None;
        let target = selection::step(&self.shared.rows.borrow(), cursor, motion);
        self.extend_to(target, cx);
    }

    /// One wrapped line up or down, using the painted layout. A row that isn't painted has no lines
    /// to go by, so the step falls back to its logical line.
    fn extend_vertically(&mut self, down: bool, cx: &mut Context<Self>) {
        let Some(cursor) = self.keyboard_cursor() else {
            return;
        };
        let target = self.vertical_target(cursor, down).unwrap_or_else(|| {
            let rows = self.shared.rows.borrow();
            let edge = if down {
                Motion::LineEnd
            } else {
                Motion::LineStart
            };
            let at_edge = selection::step(&rows, cursor, edge);
            let across = if down {
                Motion::NextChar
            } else {
                Motion::PreviousChar
            };
            selection::step(&rows, at_edge, across)
        });
        self.extend_to(target, cx);
    }

    fn vertical_target(&mut self, cursor: Pos, down: bool) -> Option<Pos> {
        let visible = self.shared.visible.borrow();
        let (&key, block) = visible
            .range((cursor.seq, 0)..=(cursor.seq, cursor.byte))
            .next_back()?;
        let local = block.index_of(cursor.byte);
        let at = block.layout.position_for_index(local)?;
        let line = block.layout.line_height();
        let goal = self.goal_x.get_or_insert(at.x);
        let goal_x = *goal;
        let y = if down {
            at.y + line * 1.5
        } else {
            at.y - line * 0.5
        };
        if y >= block.bounds.top() && y < block.bounds.bottom() {
            let index = block
                .layout
                .index_for_position(point(goal_x, y))
                .unwrap_or_else(|closest| closest);
            return Some(Pos {
                seq: cursor.seq,
                byte: block.display_of(index),
            });
        }
        let next = if down {
            visible
                .range((std::ops::Bound::Excluded(key), std::ops::Bound::Unbounded))
                .find(|(_, block)| block.selectable > 0)
        } else {
            visible
                .range(..key)
                .rev()
                .find(|(_, block)| block.selectable > 0)
        };
        let (&next_key, next_block) = next?;
        let y = if down {
            next_block.bounds.top() + line * 0.5
        } else {
            next_block.bounds.bottom() - line * 0.5
        };
        let index = next_block
            .layout
            .index_for_position(point(goal_x, y))
            .unwrap_or_else(|closest| closest);
        Some(Pos {
            seq: next_key.0,
            byte: next_block.display_of(index),
        })
    }

    /// What's decided by what the last frame showed.
    fn after_paint(&mut self, cx: &mut Context<Self>) {
        // The Tab stop was picked from last frame's rows: if this frame placed others (a jump, a
        // scroll into rows not measured yet), draw again so the stop is a row on screen.
        if self.shared.tab_stop_is_stale() {
            cx.notify();
        }
        // The width is known only once laid out: a first frame at a phone's width redraws as one.
        let width = f32::from(self.list.viewport_bounds().size.width);
        if (width > 0. && width < PHONE_WIDTH) != self.shared.phone.get() {
            cx.notify();
        }
        // Here rather than in the scroll handler, which only hears the wheel: not a scrollbar drag,
        // a drag's auto-scroll or `scroll_to`.
        if self.list.logical_scroll_top().item_ix >= LOAD_OLDER_WITHIN {
            self.asked_older = false;
        } else if !self.asked_older {
            self.asked_older = true;
            cx.emit(MessageListEvent::LoadOlder);
        }
        if self.detached && !self.asked_newer {
            let count = self.list.item_count();
            let near_end = count == 0
                || self
                    .list
                    .item_is_below_viewport(count.saturating_sub(LOAD_OLDER_WITHIN))
                    == Some(false);
            if near_end {
                self.asked_newer = true;
                cx.emit(MessageListEvent::LoadNewer);
            }
        }
        self.arm_animation(cx);
    }

    /// Arms one timer for the next frame any animated image needs, replacing the last. With nothing
    /// animated in view, nothing runs and the list stays idle.
    fn arm_animation(&mut self, cx: &mut Context<Self>) {
        let Some(wait) = self.shared.next_animation_frame.take() else {
            self.animation_timer = None;
            return;
        };
        let wait = wait.max(SHORTEST_ANIMATION_WAKE);
        let timer = cx.background_executor().timer(wait);
        self.animation_timer = Some(cx.spawn(async move |this, cx| {
            timer.await;
            this.update(cx, |_, cx| cx.notify()).ok();
        }));
    }
}

impl Render for MessageList {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.shared.visible.borrow_mut().clear();
        {
            let drawn = std::mem::take(&mut *self.shared.drawn.borrow_mut());
            *self.shared.last_drawn.borrow_mut() = drawn;
        }
        self.shared.placed_ix.set(None);
        // A row the keyboard focused, or a control in it, that is gone (deleted, or a reset): the
        // list takes focus, so its shortcuts still work. Last frame's tree still has the row.
        let reset = std::mem::take(&mut self.refocus_after_reset);
        let focused_row_gone = {
            let rows = self.shared.rows.borrow();
            self.shared.row_focus.borrow().iter().any(|(seq, handle)| {
                (reset || rows.by_seq(*seq).is_none()) && handle.contains_focused(window, cx)
            })
        };
        if focused_row_gone {
            window.focus(&self.focus, cx);
        }
        self.sync_focusable_row(cx);
        self.shared.list_players.next_frame();
        self.release_frozen_decor();
        if self.follow_theme
            && let Some(sem) = cx.try_global::<crate::theme::Sem>()
        {
            let palette = Palette::from_sem(sem);
            let old = self.shared.palette.get();
            if (old.text, old.background, old.primary)
                != (palette.text, palette.background, palette.primary)
            {
                // The rows' text was shaped in the old colours.
                self.shared.palette.set(palette);
                self.shared.prepared.borrow_mut().clear();
                self.list.remeasure();
            }
        }
        let palette = self.shared.palette.get();

        let root = div()
            .id("message-list")
            .role(Role::List)
            .aria_label("Messages")
            .key_context(KEY_CONTEXT)
            .track_focus(&self.focus)
            .size_full()
            .relative()
            .bg(palette.background)
            .text_color(palette.text)
            .font_family(self.shared.fonts.body.clone());

        if self.status == ListStatus::Loading {
            return root
                .pt(px(16.))
                .overflow_hidden()
                .children((0..SKELETON_ROWS).map(|_| render_skeleton(&palette)));
        }
        if self.shared.rows.borrow().is_empty() {
            return root.child(render_empty(&palette));
        }

        let width = f32::from(self.list.viewport_bounds().size.width);
        self.shared.phone.set(width > 0. && width < PHONE_WIDTH);
        // The editor grows as it's typed in; its row is measured afresh each frame.
        if let Some(seq) = self.editing_seq() {
            self.remeasure_seq(seq);
        }
        let menu_row = self
            .menu
            .and_then(|(seq, at)| Some((self.shared.rows.borrow().by_seq(seq)?.clone(), at)));
        let menu = menu_row.map(|(row, at)| {
            if self.shared.phone.get() {
                render_sheet(&self.shared, &row, cx).into_any_element()
            } else {
                render_menu(&self.shared, &row, at, cx).into_any_element()
            }
        });
        let remove_dialog = self.render_remove_dialog(cx);
        let shared = self.shared.clone();
        let rows = list(self.list.clone(), move |ix, window, cx| {
            render_row(&shared, ix, window, cx)
        })
        .pb(self.bottom_room)
        .size_full();
        let entity = cx.entity();
        root.on_action(cx.listener(|view, _: &CopySelection, _, cx| view.copy(cx)))
            .on_action(cx.listener(|view, _: &SelectAll, _, cx| view.select_all(cx)))
            .on_action(cx.listener(|view, _: &ClearSelection, _, cx| view.escape(cx)))
            .on_action(
                cx.listener(|view, _: &ExtendLeft, _, cx| view.extend(Motion::PreviousChar, cx)),
            )
            .on_action(
                cx.listener(|view, _: &ExtendRight, _, cx| view.extend(Motion::NextChar, cx)),
            )
            .on_action(
                cx.listener(|view, _: &ExtendWordLeft, _, cx| {
                    view.extend(Motion::PreviousWord, cx)
                }),
            )
            .on_action(
                cx.listener(|view, _: &ExtendWordRight, _, cx| view.extend(Motion::NextWord, cx)),
            )
            .on_action(
                cx.listener(|view, _: &ExtendLineStart, _, cx| view.extend(Motion::LineStart, cx)),
            )
            .on_action(
                cx.listener(|view, _: &ExtendLineEnd, _, cx| view.extend(Motion::LineEnd, cx)),
            )
            .on_action(
                cx.listener(|view, _: &ExtendToStart, _, cx| view.extend(Motion::FirstRow, cx)),
            )
            .on_action(cx.listener(|view, _: &ExtendToEnd, _, cx| view.extend(Motion::LastRow, cx)))
            .on_action(cx.listener(|view, _: &ExtendUp, _, cx| view.extend_vertically(false, cx)))
            .on_action(cx.listener(|view, _: &ExtendDown, _, cx| view.extend_vertically(true, cx)))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|view, event: &MouseDownEvent, window, cx| {
                    view.on_press(event, window, cx);
                }),
            )
            .child(rows)
            // Window-level, because a drag has to keep working outside the list's bounds. Painted
            // after the rows, so `after_paint` sees what they asked of the animation clock.
            .child(
                canvas(
                    |_, _, _| {},
                    move |_, _, window, cx| {
                        let on_move = entity.clone();
                        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                            if phase.bubble() {
                                on_move.update(cx, |view, cx| view.on_move(event, cx));
                            }
                        });
                        let on_up = entity.clone();
                        window.on_mouse_event(move |event: &MouseUpEvent, phase, _, cx| {
                            if phase.bubble() {
                                on_up.update(cx, |view, cx| view.on_release(event, cx));
                            }
                        });
                        let after = entity.clone();
                        cx.defer(move |cx| after.update(cx, |view, cx| view.after_paint(cx)));
                        // A control in a row that had focus and went (a reaction taken back, a
                        // Load card): once its handle is dropped the window has no focus. Give it
                        // to that row, or to the list.
                        let lost = entity.clone();
                        window.defer(cx, move |window, cx| {
                            lost.update(cx, |view, cx| view.recover_focus(window, cx));
                        });
                    },
                )
                .absolute()
                .size_0(),
            )
            .when(self.scrollbar, |root| root.vertical_scrollbar(&self.list))
            .when(self.detached, |root| {
                root.child(render_jump_to_present(&palette, cx))
            })
            .children(menu)
            .children(remove_dialog)
            // The polite region new messages are read from. A fresh node per announcement (the
            // sequence number), so the same words twice are read twice.
            .children(self.announce.last().map(|said| {
                live_node(
                    ("message-announcement", said.seq),
                    said.text.clone(),
                    Live::Polite,
                )
            }))
    }
}

/// The web's "You're viewing older messages" bar, reduced to its button.
fn render_jump_to_present(palette: &Palette, cx: &mut Context<MessageList>) -> impl IntoElement {
    div()
        .absolute()
        .bottom(px(12.))
        .left_0()
        .right_0()
        .flex()
        .justify_center()
        .child(
            div()
                .id("jump-to-present")
                .test_support()
                .role(Role::Button)
                .aria_label("Jump to present")
                .cursor_pointer()
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .px(px(14.))
                .py(px(6.))
                .rounded(px(16.))
                .bg(palette.primary)
                .text_color(palette.background)
                .text_size(px(13.))
                .font_weight(FontWeight::SEMIBOLD)
                .child("Jump to present")
                .on_click(cx.listener(|_, _, _, cx| cx.emit(MessageListEvent::JumpToPresent))),
        )
}
