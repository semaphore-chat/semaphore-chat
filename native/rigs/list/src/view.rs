//! The message list view: `gpui::list` rows plus an app-owned selection.

use crate::assets::image_path;
use crate::data::{Kind, Message, Seg, Store};
use crate::lru::LruImageCache;
use crate::selection::{Pos, Selection, copy_text};
use gpui_kit::base::AutoScroll;
use gpui_kit::component::scroll::ScrollableElement as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

actions!(rig_list, [CopySelection]);

pub const SELECTION_COLOR: u32 = 0x3b82f6;
const BODY_FONT: &str = "DejaVu Sans";
const CODE_FONT: &str = "DejaVu Sans Mono";
const OVERDRAW: Pixels = px(400.);
const MAX_IMAGE_W: f32 = 480.;
const MAX_IMAGE_H: f32 = 360.;

pub fn selection_background() -> Hsla {
    rgba((SELECTION_COLOR << 8) | 0x60).into()
}

struct RowGeom {
    layout: TextLayout,
    bounds: Bounds<Pixels>,
}

/// State the row elements read while painting.
pub struct Shared {
    pub store: RefCell<Store>,
    visible: RefCell<BTreeMap<i64, RowGeom>>,
    /// Top of each row painted in the last frame, by message id.
    pub row_tops: RefCell<BTreeMap<i64, f32>>,
    pub selection: Cell<Option<Selection>>,
    pub emoji: Vec<Arc<RenderImage>>,
    pub started: Instant,
    pub image_dir: PathBuf,
    /// Images that have "not arrived yet", to reproduce a late load on demand.
    pub pending_images: RefCell<HashSet<i64>>,
    /// Whether a pending image's box already has its final size (the message carries w and h).
    pub reserve_images: Cell<bool>,
    pub probe: Cell<bool>,
    pub animated_rows_painted: Cell<u32>,
    /// Draw every image as its reserved box, to see what images cost.
    pub images_off: Cell<bool>,
}

impl Shared {
    pub fn new(store: Store, emoji: Vec<Arc<RenderImage>>, image_dir: PathBuf) -> Rc<Self> {
        Rc::new(Shared {
            store: RefCell::new(store),
            visible: RefCell::default(),
            row_tops: RefCell::default(),
            selection: Cell::new(None),
            emoji,
            started: Instant::now(),
            image_dir,
            pending_images: RefCell::default(),
            reserve_images: Cell::new(true),
            probe: Cell::new(false),
            animated_rows_painted: Cell::new(0),
            images_off: Cell::new(false),
        })
    }
}

/// A message's text: `StyledText` plus the things it can't do itself, namely the selection
/// background, the inline emoji images and recording the laid-out text for hit testing.
struct MessageText {
    id: i64,
    styled: StyledText,
    shared: Rc<Shared>,
}

impl IntoElement for MessageText {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

fn selection_quads(
    start: Point<Pixels>,
    end: Point<Pixels>,
    bounds: Bounds<Pixels>,
    line: Pixels,
) -> Vec<Bounds<Pixels>> {
    if start.y == end.y {
        return vec![Bounds::from_corners(start, point(end.x, end.y + line))];
    }
    let mut quads = vec![Bounds::from_corners(
        start,
        point(bounds.right(), start.y + line),
    )];
    if end.y > start.y + line {
        quads.push(Bounds::from_corners(
            point(bounds.left(), start.y + line),
            point(bounds.right(), end.y),
        ));
    }
    quads.push(Bounds::from_corners(
        point(bounds.left(), end.y),
        point(end.x, end.y + line),
    ));
    quads
}

impl Element for MessageText {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        self.styled.request_layout(id, inspector, window, cx)
    }
    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.styled
            .prepaint(id, inspector, bounds, &mut (), window, cx);
    }
    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        inspector: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled.layout().clone();
        let line = layout.line_height();
        let store = self.shared.store.borrow();
        let message = store.get_id(self.id);

        if let (Some(selection), Some(message)) = (self.shared.selection.get(), message)
            && let Some(range) = selection.range_in(message)
            && let (Some(start), Some(end)) = (
                layout.position_for_index(range.start as usize),
                layout.position_for_index(range.end as usize),
            )
        {
            for quad in selection_quads(start, end, bounds, line) {
                window.paint_quad(fill(quad, selection_background()));
            }
        }
        self.styled
            .paint(id, inspector, bounds, &mut (), &mut (), window, cx);

        if let Some(message) = message {
            let mut start = 0u32;
            let mut any_animated = false;
            for seg in &message.segs {
                if let Seg::Emoji { emoji, .. } = seg
                    && let Some(position) = layout.position_for_index(start as usize)
                {
                    let image = self.shared.emoji[*emoji as usize].clone();
                    let frames = image.frame_count();
                    let frame = if frames > 1 {
                        any_animated = true;
                        (self.shared.started.elapsed().as_millis() / 80) as usize % frames
                    } else {
                        0
                    };
                    let size = line - px(4.);
                    let rect = Bounds::new(
                        point(position.x, position.y + px(2.)),
                        Size {
                            width: size,
                            height: size,
                        },
                    );
                    let _ = window.paint_image(rect, rect, Corners::default(), image, frame, false);
                }
                start = seg.end();
            }
            if any_animated {
                self.shared
                    .animated_rows_painted
                    .set(self.shared.animated_rows_painted.get() + 1);
                window.request_animation_frame();
            }
        }
        self.shared
            .visible
            .borrow_mut()
            .insert(self.id, RowGeom { layout, bounds });
    }
}

fn author_color(author: u16) -> Hsla {
    hsla((author as f32 * 0.618_034) % 1.0, 0.55, 0.62, 1.0)
}

fn body_runs(message: &Message, base: &Font) -> Vec<TextRun> {
    let color = rgb(0xdcddde).into();
    let link: Hsla = rgb(0x4aa8ff).into();
    let mut runs = Vec::with_capacity(message.segs.len());
    let mut start = 0;
    for seg in &message.segs {
        let len = (seg.end() - start) as usize;
        start = seg.end();
        let mut run = TextRun {
            len,
            font: base.clone(),
            color,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        match seg {
            Seg::Bold { .. } => run.font.weight = FontWeight::BOLD,
            Seg::Link { .. } => {
                run.color = link;
                run.underline = Some(UnderlineStyle {
                    thickness: px(1.),
                    color: Some(link),
                    wavy: false,
                });
            }
            _ => {}
        }
        runs.push(run);
    }
    runs
}

/// A coloured token every other word: enough runs to cost what real highlighting costs.
fn code_runs(text: &str, base: &Font) -> Vec<TextRun> {
    let colors: [Hsla; 3] = [
        rgb(0xc8d3f5).into(),
        rgb(0x82aaff).into(),
        rgb(0xc3e88d).into(),
    ];
    let mut runs = Vec::new();
    for (token, piece) in text.split_inclusive([' ', '\n']).enumerate() {
        runs.push(TextRun {
            len: piece.len(),
            font: base.clone(),
            color: colors[token % colors.len()],
            background_color: None,
            underline: None,
            strikethrough: None,
        });
    }
    runs
}

fn render_row(
    shared: &Rc<Shared>,
    images: Option<&Entity<LruImageCache>>,
    ix: usize,
) -> AnyElement {
    let store = shared.store.borrow();
    let Some(message) = store.messages.get(ix) else {
        return div().into_any_element();
    };
    let id = message.id;
    let display = message.display.clone();
    let base_font = font(BODY_FONT);

    let mut body = div().flex().flex_col().flex_1().min_w_0().gap_1().child(
        div()
            .flex()
            .gap_2()
            .items_baseline()
            .child(
                div()
                    .text_color(author_color(message.author))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(format!("user{}", message.author)),
            )
            .child(div().text_xs().text_color(rgb(0x72767d)).child(format!(
                "{:02}:{:02}",
                message.minute / 60 % 24,
                message.minute % 60
            ))),
    );
    match &message.kind {
        Kind::Code => {
            let code_font = font(CODE_FONT);
            let runs = code_runs(&display, &code_font);
            body = body.child(
                div()
                    .bg(rgb(0x2b2d31))
                    .border_1()
                    .border_color(rgb(0x1e1f22))
                    .rounded_md()
                    .p_2()
                    .font_family(CODE_FONT)
                    .text_sm()
                    .child(MessageText {
                        id,
                        styled: StyledText::new(display.clone()).with_runs(runs),
                        shared: shared.clone(),
                    }),
            );
        }
        Kind::Text => {
            let runs = body_runs(message, &base_font);
            body = body.child(MessageText {
                id,
                styled: StyledText::new(display.clone()).with_runs(runs),
                shared: shared.clone(),
            });
        }
        Kind::Image { file, w, h } => {
            if !display.is_empty() {
                let runs = body_runs(message, &base_font);
                body = body.child(MessageText {
                    id,
                    styled: StyledText::new(display.clone()).with_runs(runs),
                    shared: shared.clone(),
                });
            }
            let scale = (MAX_IMAGE_W / *w as f32)
                .min(MAX_IMAGE_H / *h as f32)
                .min(1.0);
            let (dw, dh) = (*w as f32 * scale, *h as f32 * scale);
            if shared.images_off.get() || shared.pending_images.borrow().contains(&id) {
                let height = if shared.reserve_images.get() { dh } else { 0. };
                body = body.child(div().w(px(dw)).h(px(height)).rounded_md().bg(rgb(0x313338)));
            } else {
                let source = ImageSource::Resource(Resource::Path(
                    image_path(&shared.image_dir, *file).into(),
                ));
                let mut image = img(source)
                    .w(px(dw))
                    .h(px(dh))
                    .rounded_md()
                    .with_loading(|| div().size_full().bg(rgb(0x313338)).into_any_element());
                if let Some(cache) = images {
                    image = image.image_cache(cache);
                }
                body = body.child(image);
            }
        }
    }

    let initial = (b'A' + (message.author % 26) as u8) as char;
    let row = div()
        .w_full()
        .relative()
        .flex()
        .gap_3()
        .px_4()
        .pb_3()
        .child(
            div()
                .flex_none()
                .size(px(36.))
                .rounded_full()
                .bg(author_color(message.author))
                .flex()
                .items_center()
                .justify_center()
                .text_color(rgb(0x111111))
                .child(initial.to_string()),
        )
        .child(body);
    if shared.probe.get() {
        let shared = shared.clone();
        row.child(
            canvas(
                move |bounds, _, _| {
                    shared
                        .row_tops
                        .borrow_mut()
                        .insert(id, f32::from(bounds.top()));
                },
                |_, _, _, _| {},
            )
            .absolute()
            .top_0()
            .left_0()
            .w(px(1.))
            .h(px(1.)),
        )
        .into_any_element()
    } else {
        row.into_any_element()
    }
}

type FrameHook = Rc<dyn Fn(&mut App)>;

pub struct MessageListView {
    pub shared: Rc<Shared>,
    pub list: ListState,
    focus: FocusHandle,
    images: Option<Entity<LruImageCache>>,
    auto: AutoScroll,
    dragging: bool,
    moved: bool,
    pressed_link: Option<String>,
    pointer: Point<Pixels>,
    pub link_clicks: Vec<String>,
    /// Run after each presented frame.
    pub after_present: Option<FrameHook>,
    /// Run at the start of each render.
    pub on_render: Option<FrameHook>,
}

impl MessageListView {
    pub fn new(
        shared: Rc<Shared>,
        images: Option<Entity<LruImageCache>>,
        cx: &mut Context<Self>,
    ) -> Self {
        let count = shared.store.borrow().len();
        let list = ListState::new(count, ListAlignment::Top, OVERDRAW);
        list.set_follow_mode(FollowMode::Tail);
        let weak = cx.weak_entity();
        list.set_scroll_handler(move |_, _, cx| {
            let weak = weak.clone();
            cx.defer(move |cx| {
                let _ = weak.update(cx, |_, cx| cx.notify());
            });
        });
        Self {
            shared,
            list,
            focus: cx.focus_handle(),
            images,
            auto: AutoScroll::default(),
            dragging: false,
            moved: false,
            pressed_link: None,
            pointer: Point::default(),
            link_clicks: Vec::new(),
            after_present: None,
            on_render: None,
        }
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    pub fn scroll_to_id(&self, id: i64, offset: f32) {
        if let Some(ix) = self.shared.store.borrow().index_of(id) {
            self.list.set_follow_mode(FollowMode::Normal);
            self.list.scroll_to(ListOffset {
                item_ix: ix,
                offset_in_item: px(offset),
            });
        }
    }

    /// Prepends older messages. The list keeps its anchor on the same row.
    pub fn prepend(&mut self, count: usize, cx: &mut Context<Self>) {
        self.shared.store.borrow_mut().prepend(count);
        self.list.splice(0..0, count);
        cx.notify();
    }

    /// Marks one image as arrived.
    pub fn image_arrived(&mut self, id: i64, cx: &mut Context<Self>) {
        self.shared.pending_images.borrow_mut().remove(&id);
        if let Some(ix) = self.shared.store.borrow().index_of(id) {
            self.list.remeasure_items(ix..ix + 1);
        }
        cx.notify();
    }

    pub fn selected_text(&self) -> String {
        self.shared
            .selection
            .get()
            .map_or_else(String::new, |selection| {
                copy_text(&self.shared.store.borrow(), selection)
            })
    }

    pub fn copy(&mut self, cx: &mut Context<Self>) {
        cx.write_to_clipboard(ClipboardItem::new_string(self.selected_text()));
    }

    /// The text position for a window point: the painted row at that height or the nearest one.
    pub fn hit(&self, position: Point<Pixels>) -> Option<Pos> {
        let visible = self.shared.visible.borrow();
        let mut best: Option<(&i64, &RowGeom, Pixels)> = None;
        for (id, row) in visible.iter() {
            let distance = if position.y < row.bounds.top() {
                row.bounds.top() - position.y
            } else if position.y >= row.bounds.bottom() {
                position.y - row.bounds.bottom()
            } else {
                px(0.)
            };
            if best.as_ref().is_none_or(|(_, _, d)| distance < *d) {
                best = Some((id, row, distance));
            }
        }
        let (id, row, _) = best?;
        let byte = if position.y < row.bounds.top() {
            0
        } else if position.y >= row.bounds.bottom() {
            row.layout.len()
        } else {
            row.layout
                .index_for_position(position)
                .unwrap_or_else(|closest| closest)
        };
        Some(Pos {
            id: *id,
            byte: byte as u32,
        })
    }

    /// Rows painted in the last frame, in order, with their text bounds.
    pub fn painted_rows(&self) -> Vec<(i64, Bounds<Pixels>)> {
        self.shared
            .visible
            .borrow()
            .iter()
            .map(|(id, row)| (*id, row.bounds))
            .collect()
    }

    /// Where a byte of a painted row is, plus half a line so the point lands on the glyphs.
    pub fn point_of(&self, id: i64, byte: u32) -> Option<Point<Pixels>> {
        let visible = self.shared.visible.borrow();
        let row = visible.get(&id)?;
        let position = row.layout.position_for_index(byte as usize)?;
        Some(point(
            position.x + px(1.),
            position.y + row.layout.line_height() / 2.,
        ))
    }

    fn link_at(&self, position: Pos) -> Option<String> {
        let store = self.shared.store.borrow();
        let message = store.get_id(position.id)?;
        let mut start = 0;
        for seg in &message.segs {
            if let Seg::Link { end, url } = seg
                && (start..*end).contains(&position.byte)
            {
                return Some(url.to_string());
            }
            start = seg.end();
        }
        None
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

    fn update_cursor(&mut self) {
        if let (Some(hit), Some(selection)) = (
            self.hit(self.clamped_pointer()),
            self.shared.selection.get(),
        ) {
            self.shared.selection.set(Some(Selection {
                anchor: selection.anchor,
                cursor: hit,
            }));
        }
    }

    fn on_press(&mut self, event: &MouseDownEvent, cx: &mut Context<Self>) {
        self.pointer = event.position;
        self.moved = false;
        let Some(hit) = self.hit(event.position) else {
            self.shared.selection.set(None);
            cx.notify();
            return;
        };
        let anchor = match self.shared.selection.get() {
            Some(selection) if event.modifiers.shift => selection.anchor,
            _ => hit,
        };
        self.pressed_link = self.link_at(hit);
        self.shared.selection.set(Some(Selection {
            anchor,
            cursor: hit,
        }));
        self.dragging = true;
        cx.notify();
    }

    fn on_drag(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        if !self.dragging {
            return;
        }
        self.moved |= event.position != self.pointer;
        self.pointer = event.position;
        self.update_cursor();
        let delta = AutoScroll::compute_delta(event.position.y, self.list.viewport_bounds());
        self.auto.set(delta, cx, |delta, view: &mut Self, cx| {
            view.list.scroll_by(delta);
            view.update_cursor();
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
        if self.moved {
            self.update_cursor();
        } else if let Some(url) = self.pressed_link.take() {
            self.link_clicks.push(url);
        }
        self.pressed_link = None;
        if self
            .shared
            .selection
            .get()
            .is_some_and(|selection| selection.is_empty())
        {
            self.shared.selection.set(None);
        }
        cx.notify();
    }
}

impl Render for MessageListView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.shared.visible.borrow_mut().clear();
        self.shared.row_tops.borrow_mut().clear();
        if let Some(hook) = self.on_render.clone() {
            hook(cx);
        }
        // Effects flush when the frame callback's `update` ends, which is after `present`.
        if let Some(hook) = self.after_present.clone() {
            cx.defer(move |cx| hook(cx));
        }

        let shared = self.shared.clone();
        let images = self.images.clone();
        let rows = list(self.list.clone(), move |ix, _window, _cx| {
            render_row(&shared, images.as_ref(), ix)
        })
        .size_full();

        let entity = cx.entity();
        div()
            .id("message-list")
            .key_context("MessageList")
            .track_focus(&self.focus)
            .on_action(cx.listener(|view, _: &CopySelection, _, cx| view.copy(cx)))
            .size_full()
            .relative()
            .bg(rgb(0x1e1f22))
            .text_color(rgb(0xdcddde))
            .font_family(BODY_FONT)
            .text_size(px(15.))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|view, event: &MouseDownEvent, _, cx| view.on_press(event, cx)),
            )
            .child(rows)
            // Window-level, because a drag has to keep working outside the list's bounds.
            .child(
                canvas(
                    |_, _, _| {},
                    move |_, _, window, _| {
                        let on_move = entity.clone();
                        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                            if phase.bubble() {
                                on_move.update(cx, |view, cx| view.on_drag(event, cx));
                            }
                        });
                        let on_up = entity.clone();
                        window.on_mouse_event(move |event: &MouseUpEvent, phase, _, cx| {
                            if phase.bubble() {
                                on_up.update(cx, |view, cx| view.on_release(event, cx));
                            }
                        });
                    },
                )
                .absolute()
                .size_0(),
            )
            .vertical_scrollbar(&self.list)
    }
}
