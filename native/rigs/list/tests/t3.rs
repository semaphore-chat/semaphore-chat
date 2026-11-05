//! T3: drag selection across virtualized rows, in-process with real hit testing and a virtual
//! clock. The arms measure what happens and write it down; only the prototype asserts the bar.
//!
//!   Arm A: one kit `SelectableText` per row in a `gpui::list`.
//!   Arm B: the transcript as one kit `TextView::scrollable(true)` document.
//!   Arm C: the rig's `MessageListView`, with the selection held in message coordinates.

use gpui_kit::base::text::{TextView, TextViewState};
use gpui_kit::base::{SelectableText, TextSelection, TextSelectionHandle, TextSelectionLayer};
use gpui_kit::prelude::*;
use gpui_kit::*;
use rig_list::assets::build_emoji;
use rig_list::data::{Message, Seg, Store, copy_range, emoji_name, generate, truth};
use rig_list::selection::Selection;
use rig_list::textdoc::{EmojiPlugin, message_markdown};
use rig_list::view::{CopySelection, MessageListView, Shared, selection_background};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write as _;
use std::path::PathBuf;
// `gpui_kit::*` exports the `test` attribute, and the macro's own `#[test]` would resolve to it.
use std::prelude::v1::test;
use std::time::Duration;

/// Appends one finding to `$T3_OBS` and echoes it, whatever the outcome.
fn observe(arm: &str, value: serde_json::Value) {
    let line = serde_json::json!({ "arm": arm, "observed": value }).to_string();
    println!("T3OBS {line}");
    if let Ok(path) = std::env::var("T3_OBS") {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        writeln!(file, "{line}").unwrap();
    }
}

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
    cx.run_until_parked();
}

fn tick(cx: &mut VisualTestContext) {
    cx.executor().advance_clock(Duration::from_millis(16));
    draw(cx);
}

fn wheel(cx: &mut VisualTestContext, at: Point<Pixels>, dy: f32) {
    cx.simulate_event(ScrollEvent {
        position: at,
        delta: ScrollDelta::Pixels(point(px(0.), px(dy))),
        ..Default::default()
    });
    draw(cx);
}

fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ------------------------------------------------------------------ arm C: the prototype

fn setup_c(
    cx: &mut TestAppContext,
    count: usize,
) -> (Entity<MessageListView>, &mut VisualTestContext) {
    cx.update(gpui_kit::init);
    let shared = Shared::new(
        Store::new(0, count),
        build_emoji(),
        PathBuf::from("/nonexistent"),
    );
    let (view, cx) = cx.add_window_view(move |_, cx| MessageListView::new(shared, None, cx));
    draw(cx);
    (view, cx)
}

/// The first painted row whose text starts inside the viewport.
fn first_full_row(
    view: &Entity<MessageListView>,
    cx: &mut VisualTestContext,
) -> (i64, Bounds<Pixels>) {
    view.read_with(cx, |view, _| {
        let top = view.list.viewport_bounds().top();
        view.painted_rows()
            .into_iter()
            .find(|(_, bounds)| bounds.top() >= top && bounds.size.height > px(0.))
            .unwrap()
    })
}

fn selection_of(view: &Entity<MessageListView>, cx: &mut VisualTestContext) -> Selection {
    view.read_with(cx, |view, _| view.shared.selection.get())
        .expect("a selection")
}

fn selected_c(view: &Entity<MessageListView>, cx: &mut VisualTestContext) -> String {
    view.read_with(cx, |view, _| view.selected_text())
}

fn painted_highlights(cx: &mut VisualTestContext) -> usize {
    cx.update(|window, _| {
        let background: Background = selection_background().into();
        window
            .painted_quads()
            .into_iter()
            .filter(|quad| quad.background == background)
            .count()
    })
}

/// The exact text a selection must copy, from the generator except for the two partial ends.
fn expected_text(store_messages: impl Fn(i64) -> Message, selection: Selection) -> String {
    let (start, end) = selection.ordered();
    let mut parts = Vec::new();
    for id in start.id..=end.id {
        let message = store_messages(id);
        let whole = truth(id);
        let part = if id == start.id && id == end.id {
            copy_range(&message, start.byte..end.byte)
        } else if id == start.id {
            let part = copy_range(&message, start.byte..message.display.len() as u32);
            assert!(whole.ends_with(&part), "partial start of {id}");
            part
        } else if id == end.id {
            let part = copy_range(&message, 0..end.byte);
            assert!(whole.starts_with(&part), "partial end of {id}");
            part
        } else {
            whole
        };
        if !part.is_empty() {
            parts.push(part);
        }
    }
    parts.join("\n")
}

/// Drags from a row off the bottom edge until `rows` messages are selected, then moves back
/// into the viewport and releases.
fn drag_down_with_autoscroll(
    view: &Entity<MessageListView>,
    start_id: i64,
    rows: i64,
    cx: &mut VisualTestContext,
) -> (Selection, usize, usize) {
    view.update(cx, |view, _| view.scroll_to_id(start_id, 0.));
    draw(cx);
    draw(cx);
    let (id, bounds) = first_full_row(view, cx);
    let start = bounds.origin + point(px(30.), px(6.));
    let screen = view.read_with(cx, |view, _| view.painted_rows().len());
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());

    cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::default());
    draw(cx);
    let below = point(viewport.center().x, viewport.bottom() + px(60.));
    cx.simulate_mouse_move(below, Some(MouseButton::Left), Modifiers::default());
    draw(cx);

    let mut ticks = 0;
    while selection_of(view, cx).cursor.id < id + rows {
        tick(cx);
        ticks += 1;
        assert!(
            ticks < 200_000,
            "auto-scroll stalled at {:?}",
            selection_of(view, cx)
        );
    }
    let inside = viewport.center();
    cx.simulate_mouse_move(inside, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(inside, MouseButton::Left, Modifiers::default());
    draw(cx);
    (selection_of(view, cx), screen, ticks)
}

#[gpui_kit::test]
fn c_selection_survives_unmount_and_copies_everything_in_order(cx: &mut TestAppContext) {
    let (view, cx) = setup_c(cx, 100_000);
    let (selection, screen, ticks) = drag_down_with_autoscroll(&view, 50_000, 400, cx);
    let (start, end) = selection.ordered();
    let spanned = (end.id - start.id) as usize;
    assert_eq!(selection.anchor, start, "dragged downwards");
    assert!(
        spanned > screen * 3,
        "must span several screens: {spanned} rows, {screen} on screen"
    );

    let copied = selected_c(&view, cx);
    let expected = expected_text(generate, selection);
    assert_eq!(copied, expected);

    // Through the real Copy action and the clipboard.
    let focus = view.read_with(cx, |view, _| view.focus_handle().clone());
    cx.update(|window, cx| {
        window.focus(&focus, cx);
        cx.write_to_clipboard(ClipboardItem::new_string("SENTINEL".into()));
    });
    draw(cx);
    cx.update(|window, cx| window.dispatch_action(Box::new(CopySelection), cx));
    cx.run_until_parked();
    let clipboard = cx
        .update(|_, cx| cx.read_from_clipboard().and_then(|item| item.text()))
        .unwrap();
    assert_eq!(clipboard, expected, "clipboard");

    // Inline emoji and links are in there, both as what they read as in the source.
    let emoji = expected.matches(":party:").count()
        + (0..24u16)
            .map(|e| expected.matches(&format!(":{}:", emoji_name(e))).count())
            .sum::<usize>();
    let links = expected.matches("issue ").count();
    assert!(emoji > 10 && links > 5, "emoji {emoji}, links {links}");

    // Scroll far away. Every selected row is unmounted, and nothing about the selection changes.
    view.update(cx, |view, _| view.scroll_to_id(90_000, 0.));
    draw(cx);
    draw(cx);
    let painted = view.read_with(cx, |view, _| view.painted_rows());
    assert!(
        painted.iter().all(|(id, _)| *id > end.id),
        "selected rows must be unmounted"
    );
    assert_eq!(painted_highlights(cx), 0);
    assert_eq!(selected_c(&view, cx), expected, "while unmounted");

    // And back: the same rows paint their highlight again.
    view.update(cx, |view, _| view.scroll_to_id(start.id, 0.));
    draw(cx);
    draw(cx);
    let highlights_back = painted_highlights(cx);
    assert!(highlights_back > 0, "highlight must return when remounted");
    assert_eq!(selected_c(&view, cx), expected, "after remount");

    // Older messages arrive while it is held: ids don't change, so neither does anything else.
    view.update(cx, |view, cx| view.prepend(5_000, cx));
    draw(cx);
    assert_eq!(selected_c(&view, cx), expected, "after prepend");
    assert!(painted_highlights(cx) > 0, "highlight after prepend");

    observe(
        "C",
        serde_json::json!({
            "scenario": "drag with auto-scroll, unmount, remount, prepend",
            "messages_selected": spanned + 1,
            "rows_on_screen": screen,
            "screens_spanned": (spanned as f32 / screen as f32 * 10.).round() / 10.,
            "autoscroll_ticks": ticks,
            "copied_bytes": copied.len(),
            "text_exact_match": copied == expected,
            "clipboard_exact_match": clipboard == expected,
            "inline_emoji_in_text": emoji,
            "links_in_text": links,
            "highlight_quads_after_remount": highlights_back,
            "survives_unmount": true,
        }),
    );
}

#[gpui_kit::test]
fn c_upward_drag_copies_in_document_order(cx: &mut TestAppContext) {
    let (view, cx) = setup_c(cx, 20_000);
    view.update(cx, |view, _| view.scroll_to_id(10_000, 0.));
    draw(cx);
    draw(cx);
    let (id, bounds) = first_full_row(&view, cx);
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());
    // Start low on the screen so the anchor has to scroll off the bottom while going up.
    let low = view.read_with(cx, |view, _| {
        let rows = view.painted_rows();
        rows.iter()
            .rev()
            .find(|(_, b)| b.bottom() < viewport.bottom() && b.size.height > px(0.))
            .map_or(bounds, |r| r.1)
    });
    cx.simulate_mouse_down(
        low.origin + point(px(30.), px(6.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    draw(cx);
    cx.simulate_mouse_move(
        point(viewport.center().x, viewport.top() - px(60.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    let mut ticks = 0;
    while selection_of(&view, cx).cursor.id > id - 200 {
        tick(cx);
        ticks += 1;
        assert!(ticks < 100_000, "stalled at {:?}", selection_of(&view, cx));
    }
    cx.simulate_mouse_up(viewport.center(), MouseButton::Left, Modifiers::default());
    draw(cx);
    let selection = selection_of(&view, cx);
    assert!(selection.cursor < selection.anchor, "dragged upwards");
    assert_eq!(selected_c(&view, cx), expected_text(generate, selection));
    observe(
        "C",
        serde_json::json!({ "scenario": "upward drag past the anchor", "messages_selected": selection.anchor.id - selection.cursor.id + 1, "text_exact_match": true }),
    );
}

#[gpui_kit::test]
fn c_turning_back_past_the_anchor_mid_drag_shrinks_then_inverts(cx: &mut TestAppContext) {
    let (view, cx) = setup_c(cx, 20_000);
    view.update(cx, |view, _| view.scroll_to_id(10_000, 0.));
    draw(cx);
    draw(cx);
    let (_, bounds) = first_full_row(&view, cx);
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());
    cx.simulate_mouse_down(
        bounds.origin + point(px(30.), px(6.)),
        MouseButton::Left,
        Modifiers::default(),
    );
    draw(cx);
    cx.simulate_mouse_move(
        point(viewport.center().x, viewport.bottom() + px(60.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    let anchor = selection_of(&view, cx).anchor;
    while selection_of(&view, cx).cursor.id < anchor.id + 60 {
        tick(cx);
    }
    cx.simulate_mouse_move(
        point(viewport.center().x, viewport.top() - px(60.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    let mut ticks = 0;
    while selection_of(&view, cx).cursor.id > anchor.id - 60 {
        tick(cx);
        ticks += 1;
        assert!(ticks < 100_000, "stalled");
    }
    cx.simulate_mouse_up(viewport.center(), MouseButton::Left, Modifiers::default());
    draw(cx);
    let selection = selection_of(&view, cx);
    assert_eq!(selection.anchor, anchor, "the anchor does not move");
    assert_eq!(selected_c(&view, cx), expected_text(generate, selection));
    observe(
        "C",
        serde_json::json!({ "scenario": "drag down, back up past the anchor", "anchor_stable": true, "text_exact_match": true }),
    );
}

#[gpui_kit::test]
fn c_click_on_a_link_opens_it_and_a_drag_from_it_selects(cx: &mut TestAppContext) {
    let (view, cx) = setup_c(cx, 20_000);
    view.update(cx, |view, _| view.scroll_to_id(10_000, 0.));
    draw(cx);
    draw(cx);
    let (id, byte, url) = view.read_with(cx, |view, _| {
        let store = view.shared.store.borrow();
        view.painted_rows()
            .iter()
            .find_map(|(id, _)| {
                let message = store.get_id(*id)?;
                let mut start = 0;
                for seg in &message.segs {
                    if let Seg::Link { url, .. } = seg {
                        return Some((*id, start + 2, url.to_string()));
                    }
                    start = seg.end();
                }
                None
            })
            .expect("a link on screen")
    });
    let at = view
        .read_with(cx, |view, _| view.point_of(id, byte))
        .unwrap();
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(
        view.read_with(cx, |view, _| view.link_clicks.clone()),
        vec![url]
    );
    assert_eq!(selected_c(&view, cx), "");

    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    let to = at + point(px(60.), px(0.));
    cx.simulate_mouse_move(to, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(
        view.read_with(cx, |view, _| view.link_clicks.len()),
        1,
        "a drag is not a click"
    );
    assert!(!selected_c(&view, cx).is_empty());
    observe(
        "C",
        serde_json::json!({ "scenario": "link click vs drag from a link", "click_opens": true, "drag_selects_without_opening": true }),
    );
}

// ------------------------------------------------------------------ arm A: a SelectableText per row

struct KitRows {
    list: ListState,
    handles: RefCell<HashMap<usize, TextSelectionHandle>>,
}

impl Render for KitRows {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let weak = cx.weak_entity();
        div().size_full().child(TextSelectionLayer).child(
            list(self.list.clone(), move |ix, _, cx| {
                // The handle is retained for the life of the view, so an unmounted row keeps it.
                let handle = weak
                    .read_with(cx, |view: &KitRows, _| {
                        view.handles.borrow().get(&ix).cloned()
                    })
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| {
                        let handle = TextSelectionHandle::new(truth(ix as i64), cx);
                        let _ = weak.read_with(cx, |view: &KitRows, _| {
                            view.handles.borrow_mut().insert(ix, handle.clone())
                        });
                        handle
                    });
                div()
                    .w_full()
                    .pb_2()
                    .child(
                        SelectableText::with_handle(
                            ("row", ix),
                            handle,
                            truth(ix as i64).replace('\n', " "),
                        )
                        .document_order(ix as u64),
                    )
                    .into_any_element()
            })
            .size_full(),
        )
    }
}

fn setup_a(cx: &mut TestAppContext) -> (Entity<KitRows>, &mut VisualTestContext) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(|_, _| KitRows {
        list: ListState::new(100_000, ListAlignment::Top, px(400.)),
        handles: RefCell::default(),
    });
    draw(cx);
    (view, cx)
}

fn selected_kit(cx: &mut VisualTestContext) -> (bool, String) {
    cx.update(|window, cx| {
        (
            TextSelection::has_selection(window, cx),
            TextSelection::selected_text(window, cx),
        )
    })
}

#[gpui_kit::test]
fn a_kit_per_row_selection(cx: &mut TestAppContext) {
    let (view, cx) = setup_a(cx);
    let list = view.read_with(cx, |view, _| view.list.clone());
    list.scroll_to(ListOffset {
        item_ix: 50_000,
        offset_in_item: px(0.),
    });
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    draw(cx);
    let viewport = list.viewport_bounds();
    let from = viewport.origin + point(px(4.), px(6.));

    // 1. Within one screen.
    let to = point(viewport.right() - px(4.), viewport.bottom() - px(100.));
    cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    draw(cx);
    cx.simulate_mouse_move(to, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
    draw(cx);
    let (has_on_screen, text_on_screen) = selected_kit(cx);
    let lines_on_screen = text_on_screen.lines().count();

    // 2. Finish that selection, then wheel its rows out of the overdraw and back.
    let mut unmount = Vec::new();
    wheel(cx, viewport.center(), -20_000.);
    let (has, text) = selected_kit(cx);
    unmount.push(serde_json::json!({ "stage": "scrolled away", "has_selection": has, "lines": text.lines().count() }));
    list.scroll_to(ListOffset {
        item_ix: 50_000,
        offset_in_item: px(0.),
    });
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    draw(cx);
    let (has, text) = selected_kit(cx);
    unmount.push(serde_json::json!({ "stage": "scrolled back", "has_selection": has, "lines": text.lines().count(), "same_text": text == text_on_screen }));

    // 3. A drag held past the bottom edge, so the kit's own auto-scroll drives the list.
    list.scroll_to(ListOffset {
        item_ix: 60_000,
        offset_in_item: px(0.),
    });
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    draw(cx);
    // Anchored on the third row, so it takes a while to leave the screen.
    let anchor_item = 60_002;
    let anchor_at = list
        .bounds_for_item(anchor_item)
        .expect("third row on screen")
        .origin
        + point(px(4.), px(6.));
    cx.simulate_mouse_down(anchor_at, MouseButton::Left, Modifiers::default());
    draw(cx);
    let below = point(viewport.center().x, viewport.bottom() + px(60.));
    cx.simulate_mouse_move(below, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    let mut trace = Vec::new();
    let mut cleared_at = None;
    for t in 0..2_000 {
        tick(cx);
        let (has, text) = selected_kit(cx);
        if t % 25 == 0 || !has {
            trace.push(serde_json::json!({ "tick": t, "top_item": list.logical_scroll_top().item_ix, "has_selection": has, "lines": text.lines().count() }));
        }
        if !has && cleared_at.is_none() {
            cleared_at = Some((t, list.logical_scroll_top().item_ix));
            break;
        }
    }
    let during = selected_kit(cx);
    cx.simulate_mouse_move(
        viewport.center(),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    cx.simulate_mouse_up(viewport.center(), MouseButton::Left, Modifiers::default());
    draw(cx);
    let (has_after, text_after) = selected_kit(cx);
    observe(
        "A",
        serde_json::json!({
            "scenario": "one SelectableText per row, retained handles",
            "on_screen_drag": { "has_selection": has_on_screen, "lines": lines_on_screen },
            "unmount_and_back": unmount,
            "autoscroll_trace": trace,
            "cleared_during_autoscroll_at": cleared_at.map(|(tick, item)| serde_json::json!({ "tick": tick, "top_item": item })),
            "during_end": { "has_selection": during.0, "lines": during.1.lines().count() },
            "after_release": { "has_selection": has_after, "lines": text_after.lines().count() },
            "anchor_item": anchor_item,
            "top_item_at_end": list.logical_scroll_top().item_ix,
        }),
    );
}

// ------------------------------------------------------------------ arm B: one TextView document

struct KitDocument {
    state: Entity<TextViewState>,
}

impl Render for KitDocument {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child(TextSelectionLayer).child(
            div().h(px(600.)).w(px(800.)).overflow_hidden().child(
                TextView::new(&self.state)
                    .selectable(true)
                    .scrollable(true)
                    .plugin(EmojiPlugin),
            ),
        )
    }
}

#[gpui_kit::test]
fn b_kit_single_textview_document(cx: &mut TestAppContext) {
    const BLOCKS: i64 = 3_000;
    let source = (0..BLOCKS)
        .map(|id| message_markdown(&generate(id)))
        .collect::<Vec<_>>()
        .join("\n\n");
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(move |_, cx| KitDocument {
        state: cx.new(|cx| TextViewState::markdown(&source, cx)),
    });
    draw(cx);
    draw(cx);
    let state = view.read_with(cx, |view, _| view.state.clone());
    let list = state.read_with(cx, |state, _| state.list_state().clone());
    let block_count = list.item_count();
    list.scroll_to(ListOffset {
        item_ix: 1_000,
        offset_in_item: px(0.),
    });
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    draw(cx);
    let bounds = state.read_with(cx, |state, _| state.bounds());
    let from = bounds.origin + point(px(4.), px(6.));
    cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    draw(cx);
    cx.simulate_mouse_move(
        point(bounds.center().x, bounds.bottom() + px(60.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    let top_before = list.logical_scroll_top().item_ix;
    let mut ticks = 0;
    while list.logical_scroll_top().item_ix < top_before + 300 && ticks < 40_000 {
        tick(cx);
        ticks += 1;
    }
    let top_after = list.logical_scroll_top().item_ix;
    cx.simulate_mouse_move(
        bounds.center(),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    cx.simulate_mouse_up(bounds.center(), MouseButton::Left, Modifiers::default());
    draw(cx);
    let (has, text) = selected_kit(cx);
    let normalized = normalize(&text);

    // Every whole message between the two ends must appear, in order.
    let mut missing = Vec::new();
    let mut last = 0usize;
    let mut out_of_order = 0;
    let mut checked = 0;
    let mut first_found: Option<i64> = None;
    for id in 1_000..1_000 + (top_after - top_before) as i64 {
        let expect = normalize(&truth(id));
        if expect.is_empty() || expect.len() < 12 {
            continue;
        }
        checked += 1;
        match normalized[last.min(normalized.len())..].find(&expect) {
            Some(offset) => {
                last += offset + expect.len();
                first_found.get_or_insert(id);
            }
            None => match normalized.find(&expect) {
                Some(_) => out_of_order += 1,
                None => missing.push(id),
            },
        }
    }
    let emoji_in_text = normalized.matches(":grin:").count()
        + normalized.matches(":party:").count()
        + normalized.matches(":fire:").count();

    // Scroll far away and back.
    wheel(cx, bounds.center(), -100_000.);
    let (has_away, text_away) = selected_kit(cx);
    list.scroll_to(ListOffset {
        item_ix: 1_000,
        offset_in_item: px(0.),
    });
    view.update(cx, |_, cx| cx.notify());
    draw(cx);
    draw(cx);
    let (has_back, text_back) = selected_kit(cx);

    // Older messages arriving: the only API for text before the end is set_text.
    let before_prepend = list.logical_scroll_top();
    let older = (BLOCKS..BLOCKS + 200)
        .map(|id| message_markdown(&generate(id)))
        .collect::<Vec<_>>()
        .join("\n\n");
    let whole = format!(
        "{older}\n\n{}",
        (0..BLOCKS)
            .map(|id| message_markdown(&generate(id)))
            .collect::<Vec<_>>()
            .join("\n\n")
    );
    state.update(cx, |state, cx| state.set_text(&whole, cx));
    draw(cx);
    draw(cx);
    let (has_prepend, _) = selected_kit(cx);
    let after_prepend = state.read_with(cx, |state, _| state.list_state().logical_scroll_top());

    observe(
        "B",
        serde_json::json!({
            "prepend_via_set_text": {
                "has_selection_after": has_prepend,
                "top_item_before": before_prepend.item_ix,
                "top_item_after": after_prepend.item_ix,
                "anchor_kept": after_prepend.item_ix == before_prepend.item_ix + 200,
            },
            "scenario": "transcript as one TextView::scrollable document",
            "messages": BLOCKS,
            "blocks": block_count,
            "autoscroll_ticks": ticks,
            "blocks_scrolled": top_after - top_before,
            "has_selection": has,
            "selected_bytes": text.len(),
            "whole_messages_checked": checked,
            "missing": missing.len(),
            "missing_sample": missing.iter().take(5).collect::<Vec<_>>(),
            "out_of_order": out_of_order,
            "inline_emoji_seen": emoji_in_text,
            "scrolled_away": { "has_selection": has_away, "same_text": text_away == text },
            "scrolled_back": { "has_selection": has_back, "same_text": text_back == text },
        }),
    );
}
