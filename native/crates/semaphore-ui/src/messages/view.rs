//! The message list: `gpui::list` over `Arc<MessageRow>`, plus a selection the app owns.

use super::format::TimeFormat;
use super::media::{Media, MediaSource};
use super::palette::{Fonts, Palette};
use super::row::{Decor, ReplyPreview, Shared, render_empty, render_row, render_skeleton};
use super::selection::{self, Motion, Pos, Selection, Unit, UnitDrag};
use super::store::{RowChange, RowStore};
use super::text;
use gpui_kit::base::AutoScroll;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_core::model::{ListOp, MessageRow, SendState};
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
    /// Few rows left above the viewport: `Core::load_older`.
    LoadOlder,
    /// `Core::hold_rows`: core keeps this span loaded while a selection needs it.
    HoldRows(Option<(i64, i64)>),
    OpenLink {
        url: String,
    },
    OpenAttachment {
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
    /// Off for stories: the kit's scrollbar fades on a real clock, so with it two renders of the
    /// same frame differ, and T10 needs them identical.
    pub scrollbar: bool,
}

impl Default for ListOptions {
    fn default() -> Self {
        Self {
            time: TimeFormat::default(),
            palette: Palette::dark(),
            scrollbar: true,
        }
    }
}

pub struct MessageList {
    pub(crate) shared: Rc<Shared>,
    pub(crate) list: ListState,
    focus: FocusHandle,
    status: ListStatus,
    scrollbar: bool,
    auto: AutoScroll,
    dragging: bool,
    moved: bool,
    drag: Option<UnitDrag>,
    pressed_at: Point<Pixels>,
    pressed_link: Option<String>,
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
}

impl EventEmitter<MessageListEvent> for MessageList {}

impl MessageList {
    pub fn new(
        data: ListData,
        media: Rc<dyn MediaSource>,
        options: ListOptions,
        cx: &mut Context<Self>,
    ) -> Self {
        let shared = Rc::new(Shared {
            rows: RefCell::new(RowStore::new(data.rows)),
            prepared: RefCell::default(),
            visible: RefCell::new(BTreeMap::new()),
            selection: Cell::new(None),
            hovered_link: Cell::new(None),
            palette: options.palette,
            fonts: Fonts::pick(cx),
            me_id: data.me_id,
            time: options.time,
            media: Media::new(media, cx),
            replies: RefCell::new(data.replies),
            frozen_decor: RefCell::default(),
            animation_started: Cell::new(None),
            next_animation_frame: Cell::new(None),
            animated_paints: Cell::new(0),
            view: RefCell::new(cx.weak_entity()),
        });
        let count = shared.rows.borrow().len();
        let list = ListState::new(count, ListAlignment::Top, OVERDRAW);
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
            focus: cx.focus_handle(),
            status: data.status,
            scrollbar: options.scrollbar,
            auto: AutoScroll::default(),
            dragging: false,
            moved: false,
            drag: None,
            pressed_at: Point::default(),
            pressed_link: None,
            pointer: Point::default(),
            caret: None,
            goal_x: None,
            held: None,
            asked_older: false,
            detached: false,
            asked_newer: false,
            animation_timer: None,
        }
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
        match change {
            RowChange::Reset { count } => {
                self.shared.prepared.borrow_mut().clear();
                self.shared.frozen_decor.borrow_mut().clear();
                // Seqs aren't stable across a reset, so a held selection now means nothing.
                self.set_selection(None, cx);
                self.caret = None;
                self.list.reset(count);
                self.list.set_follow_mode(FollowMode::Tail);
            }
            RowChange::Splice { old, count } => {
                self.list.splice(old.clone(), count);
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
        cx.notify();
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
        self.shared.selection.set(selection);
        let held = selection.map(|selection| selection.seq_range());
        if held != self.held {
            self.held = held;
            cx.emit(MessageListEvent::HoldRows(held));
        }
        cx.notify();
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
            0
        } else if position.y >= block.bounds.bottom() {
            block.selectable as usize
        } else {
            block
                .layout
                .index_for_position(position)
                .unwrap_or_else(|closest| closest)
        };
        Some(Pos {
            seq,
            byte: base + (byte as u32).min(block.selectable),
        })
    }

    /// The link under the pointer, exactly, and the block holding it.
    fn link_under(&self, position: Point<Pixels>) -> Option<(i64, u32, String)> {
        let visible = self.shared.visible.borrow();
        let (&(seq, base), block) = visible
            .iter()
            .find(|(_, block)| block.bounds.contains(&position))?;
        let byte = block.layout.index_for_position(position).ok()? as u32;
        let rows = self.shared.rows.borrow();
        let url = text::link_at(rows.by_seq(seq)?, base + byte)?.to_owned();
        Some((seq, base, url))
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
        let ((_, base), block) = visible
            .range((pos.seq, 0)..=(pos.seq, pos.byte))
            .next_back()?;
        let position = block
            .layout
            .position_for_index((pos.byte - base) as usize)?;
        Some(point(
            position.x + px(1.),
            position.y + block.layout.line_height() / 2.,
        ))
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
        window.focus(&self.focus, cx);
        self.pointer = event.position;
        self.pressed_at = event.position;
        self.moved = false;
        self.goal_x = None;
        self.pressed_link = None;
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
        if drag.unit == Unit::Char && !event.modifiers.shift {
            self.pressed_link = text::link_at(&row, hit.byte).map(str::to_owned);
        }
        self.set_selection(Some(selection), cx);
        self.dragging = true;
    }

    fn on_move(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if !self.dragging {
            let hovered = self
                .link_under(event.position)
                .map(|(seq, base, _)| (seq, base));
            if self.shared.hovered_link.replace(hovered) != hovered {
                cx.notify();
            }
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
        let link = self.pressed_link.take();
        if self.moved {
            self.update_drag(cx);
        } else if let Some(url) = link.filter(|url| text::is_openable_url(url)) {
            cx.emit(MessageListEvent::OpenLink { url });
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
        let local = (cursor.byte - key.1).min(block.selectable) as usize;
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
                .unwrap_or_else(|closest| closest) as u32;
            return Some(Pos {
                seq: cursor.seq,
                byte: key.1 + index.min(block.selectable),
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
            .unwrap_or_else(|closest| closest) as u32;
        Some(Pos {
            seq: next_key.0,
            byte: next_key.1 + index.min(next_block.selectable),
        })
    }

    /// What's decided by what the last frame showed.
    fn after_paint(&mut self, cx: &mut Context<Self>) {
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
                || self.list.item_is_below_viewport(count.saturating_sub(LOAD_OLDER_WITHIN))
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
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.shared.visible.borrow_mut().clear();
        self.release_frozen_decor();
        let palette = self.shared.palette;

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

        let shared = self.shared.clone();
        let rows = list(self.list.clone(), move |ix, window, cx| {
            render_row(&shared, ix, window, cx)
        })
        .pb(px(8.))
        .size_full();
        let entity = cx.entity();
        root.on_action(cx.listener(|view, _: &CopySelection, _, cx| view.copy(cx)))
            .on_action(cx.listener(|view, _: &SelectAll, _, cx| view.select_all(cx)))
            .on_action(cx.listener(|view, _: &ClearSelection, _, cx| view.set_selection(None, cx)))
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
                    },
                )
                .absolute()
                .size_0(),
            )
            .when(self.scrollbar, |root| root.vertical_scrollbar(&self.list))
            .when(self.detached, |root| root.child(render_jump_to_present(&palette, cx)))
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
