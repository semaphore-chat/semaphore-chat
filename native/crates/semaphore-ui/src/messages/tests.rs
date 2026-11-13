//! The list in-process, with real hit testing and a virtual clock. The first group is T3's arm C,
//! ported from `rigs/list/tests/t3.rs` onto the real row type; `synth::truth` regenerates what copy
//! must return without going through the display string.

use super::fixture::{self, Body, NOW_MS};
use super::format::TimeFormat;
use super::media::{MediaRef, NoMedia};
use super::row::accessible_label;
use super::selection::{Pos, Selection};
use super::synth::{self, SynthMedia, emoji_name, row, truth};
use super::text::copy_range;
use super::view::{
    CopySelection, ListData, ListOptions, ListStatus, MessageList, MessageListEvent, init,
    with_list_frame_policy,
};
use super::{MediaSource, ReplyPreview};
use gpui_kit::*;
use semaphore_core::model::{
    AttachmentKind, AttachmentView, ListOp, MessageRow, ReplyToView, SegKind, SendState, TextStyle,
};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;
use std::sync::Arc;
// `gpui_kit::*` exports the `test` attribute, and the macro's own `#[test]` would resolve to it.
use std::prelude::v1::test;
use std::time::Duration;

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
    cx.run_until_parked();
}

fn tick(cx: &mut VisualTestContext) {
    cx.executor().advance_clock(Duration::from_millis(16));
    draw(cx);
}

fn open_list(
    cx: &mut TestAppContext,
    rows: Vec<MessageRow>,
    media: Rc<dyn MediaSource>,
) -> (Entity<MessageList>, &mut VisualTestContext) {
    open_with_replies(cx, rows, HashMap::new(), media)
}

fn open_with_replies(
    cx: &mut TestAppContext,
    rows: Vec<MessageRow>,
    replies: HashMap<i64, ReplyPreview>,
    media: Rc<dyn MediaSource>,
) -> (Entity<MessageList>, &mut VisualTestContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        init(cx);
    });
    let (view, cx) = cx.add_window_view(move |_, cx| {
        MessageList::new(
            ListData {
                me_id: "me".into(),
                rows,
                replies,
                status: ListStatus::Ready,
            },
            media,
            ListOptions {
                time: TimeFormat::fixed(NOW_MS),
                // Its fade runs on its own timer, which would count as a wake in the idle tests.
                scrollbar: false,
                ..ListOptions::default()
            },
            cx,
        )
    });
    draw(cx);
    (view, cx)
}

fn setup(
    cx: &mut TestAppContext,
    first: i64,
    count: usize,
) -> (Entity<MessageList>, &mut VisualTestContext) {
    open_list(
        cx,
        synth::rows(first, count),
        Rc::new(SynthMedia::new(None)),
    )
}

/// Records what the list asks of the app.
fn record_events(
    view: &Entity<MessageList>,
    cx: &mut VisualTestContext,
) -> Rc<RefCell<Vec<MessageListEvent>>> {
    let events = Rc::new(RefCell::new(Vec::new()));
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(view, move |_, event: &MessageListEvent, _| {
            sink.borrow_mut().push(event.clone());
        })
        .detach();
    });
    events
}

fn scroll_to(view: &Entity<MessageList>, seq: i64, offset: f32, cx: &mut VisualTestContext) {
    view.update(cx, |view, cx| {
        view.scroll_to_seq(seq, offset);
        cx.notify();
    });
    draw(cx);
    draw(cx);
}

/// The first painted block whose text starts inside the viewport.
fn first_full_block(
    view: &Entity<MessageList>,
    cx: &mut VisualTestContext,
) -> (i64, Bounds<Pixels>) {
    view.read_with(cx, |view, _| {
        let top = view.list.viewport_bounds().top();
        view.painted_blocks()
            .into_iter()
            .find(|(_, bounds)| bounds.top() >= top && bounds.size.height > px(0.))
            .expect("a block on screen")
    })
}

fn selection_of(view: &Entity<MessageList>, cx: &mut VisualTestContext) -> Selection {
    view.read_with(cx, |view, _| view.selection())
        .expect("a selection")
}

fn selected(view: &Entity<MessageList>, cx: &mut VisualTestContext) -> String {
    view.read_with(cx, |view, _| view.selected_text())
}

fn painted_highlights(view: &Entity<MessageList>, cx: &mut VisualTestContext) -> usize {
    let color = view.read_with(cx, |view, _| view.shared.palette.get().selection);
    cx.update(|window, _| {
        let background: Background = color.into();
        window
            .painted_quads()
            .into_iter()
            .filter(|quad| quad.background == background)
            .count()
    })
}

/// The exact text a selection must copy, from the generator except for the two partial ends.
fn expected_text(selection: Selection) -> String {
    let (start, end) = selection.ordered();
    let mut parts = Vec::new();
    for seq in start.seq..=end.seq {
        let message = row(seq);
        let whole = truth(seq);
        let part = if seq == start.seq && seq == end.seq {
            copy_range(&message, start.byte..end.byte)
        } else if seq == start.seq {
            let part = copy_range(&message, start.byte..message.display.len() as u32);
            assert!(whole.ends_with(&part), "partial start of {seq}");
            part
        } else if seq == end.seq {
            let part = copy_range(&message, 0..end.byte);
            assert!(whole.starts_with(&part), "partial end of {seq}");
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

/// Drags from a row off the bottom edge until `rows` rows are selected, then moves back into the
/// viewport and releases.
fn drag_down_with_autoscroll(
    view: &Entity<MessageList>,
    start_seq: i64,
    rows: i64,
    cx: &mut VisualTestContext,
) -> (Selection, usize, usize) {
    scroll_to(view, start_seq, 0., cx);
    let (seq, bounds) = first_full_block(view, cx);
    let start = bounds.origin + point(px(30.), px(6.));
    let screen = view.read_with(cx, |view, _| view.painted_blocks().len());
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());

    cx.simulate_mouse_down(start, MouseButton::Left, Modifiers::default());
    draw(cx);
    let below = point(viewport.center().x, viewport.bottom() + px(60.));
    cx.simulate_mouse_move(below, Some(MouseButton::Left), Modifiers::default());
    draw(cx);

    let mut ticks = 0;
    while selection_of(view, cx).cursor.seq < seq + rows {
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
    let (view, cx) = setup(cx, 0, 100_000);
    let (selection, screen, ticks) = drag_down_with_autoscroll(&view, 50_000, 400, cx);
    let (start, end) = selection.ordered();
    let spanned = (end.seq - start.seq) as usize;
    assert_eq!(selection.anchor, start, "dragged downwards");
    assert!(
        spanned > screen * 3,
        "must span several screens: {spanned} rows, {screen} on screen"
    );

    let copied = selected(&view, cx);
    let expected = expected_text(selection);
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
    let emoji: usize = (0..24u16)
        .map(|e| expected.matches(&format!(":{}:", emoji_name(e))).count())
        .sum();
    let links = expected.matches("issue ").count();
    assert!(emoji > 10 && links > 5, "emoji {emoji}, links {links}");

    // Scroll far away. Every selected row is unmounted, and nothing about the selection changes.
    scroll_to(&view, 90_000, 0., cx);
    let painted = view.read_with(cx, |view, _| view.painted_blocks());
    assert!(
        painted.iter().all(|(seq, _)| *seq > end.seq),
        "selected rows must be unmounted"
    );
    assert_eq!(painted_highlights(&view, cx), 0);
    assert_eq!(selected(&view, cx), expected, "while unmounted");

    // And back: the same rows paint their highlight again.
    scroll_to(&view, start.seq, 0., cx);
    let highlights_back = painted_highlights(&view, cx);
    assert!(highlights_back > 0, "highlight must return when remounted");
    assert_eq!(selected(&view, cx), expected, "after remount");

    // Older rows arrive while it is held: seqs don't change, so neither does anything else.
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 0,
                rows: synth::rows(-5_000, 5_000),
            },
            cx,
        );
    });
    draw(cx);
    assert_eq!(selected(&view, cx), expected, "after prepend");
    assert!(painted_highlights(&view, cx) > 0, "highlight after prepend");

    println!(
        "T3 arm C on MessageRow: {} rows over {:.1} screens, {} bytes, {emoji} emoji, {links} links, {ticks} auto-scroll ticks, {highlights_back} highlight quads after remount",
        spanned + 1,
        spanned as f32 / screen as f32,
        copied.len(),
    );
}

#[gpui_kit::test]
fn c_upward_drag_copies_in_document_order(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 0, 20_000);
    scroll_to(&view, 10_000, 0., cx);
    let (seq, bounds) = first_full_block(&view, cx);
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());
    // Start low on the screen so the anchor has to scroll off the bottom while going up.
    let low = view.read_with(cx, |view, _| {
        view.painted_blocks()
            .iter()
            .rev()
            .find(|(_, b)| b.bottom() < viewport.bottom() && b.size.height > px(0.))
            .map_or(bounds, |block| block.1)
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
    while selection_of(&view, cx).cursor.seq > seq - 200 {
        tick(cx);
        ticks += 1;
        assert!(ticks < 100_000, "stalled at {:?}", selection_of(&view, cx));
    }
    cx.simulate_mouse_up(viewport.center(), MouseButton::Left, Modifiers::default());
    draw(cx);
    let selection = selection_of(&view, cx);
    assert!(selection.cursor < selection.anchor, "dragged upwards");
    assert_eq!(selected(&view, cx), expected_text(selection));
}

#[gpui_kit::test]
fn c_turning_back_past_the_anchor_mid_drag_shrinks_then_inverts(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 0, 20_000);
    scroll_to(&view, 10_000, 0., cx);
    let (_, bounds) = first_full_block(&view, cx);
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
    while selection_of(&view, cx).cursor.seq < anchor.seq + 60 {
        tick(cx);
    }
    cx.simulate_mouse_move(
        point(viewport.center().x, viewport.top() - px(60.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    draw(cx);
    let mut ticks = 0;
    while selection_of(&view, cx).cursor.seq > anchor.seq - 60 {
        tick(cx);
        ticks += 1;
        assert!(ticks < 100_000, "stalled");
    }
    cx.simulate_mouse_up(viewport.center(), MouseButton::Left, Modifiers::default());
    draw(cx);
    let selection = selection_of(&view, cx);
    assert_eq!(selection.anchor, anchor, "the anchor does not move");
    assert_eq!(selected(&view, cx), expected_text(selection));
}

fn link_row(seq: i64) -> MessageRow {
    fixture::message(
        seq,
        fixture::me(),
        NOW_MS - 60_000 + seq,
        Body::default()
            .text("see ")
            .link("the docs page", "https://example.com/docs")
            .text(" for more about this"),
    )
}

#[gpui_kit::test]
fn c_click_on_a_link_opens_it_and_a_drag_from_it_selects(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, vec![link_row(1)], Rc::new(NoMedia));
    let events = record_events(&view, cx);
    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 6 }))
        .expect("the link is painted");
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    let opened = |events: &Rc<RefCell<Vec<MessageListEvent>>>| {
        events
            .borrow()
            .iter()
            .filter(|event| matches!(event, MessageListEvent::OpenLink { .. }))
            .count()
    };
    assert!(events.borrow().contains(&MessageListEvent::OpenLink {
        url: "https://example.com/docs".into()
    }));
    assert_eq!(selected(&view, cx), "");

    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    let to = at + point(px(60.), px(0.));
    cx.simulate_mouse_move(to, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(opened(&events), 1, "a drag is not a click");
    assert!(!selected(&view, cx).is_empty());
}

#[gpui_kit::test]
fn a_shaky_click_still_opens_and_an_unsafe_link_never_does(cx: &mut TestAppContext) {
    let unsafe_row = fixture::message(
        2,
        fixture::me(),
        NOW_MS,
        Body::default().link("click me", "javascript:alert(1)"),
    );
    let (view, cx) = open_list(cx, vec![link_row(1), unsafe_row], Rc::new(NoMedia));
    let events = record_events(&view, cx);

    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 6 }))
        .unwrap();
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(
        at + point(px(1.), px(1.)),
        Some(MouseButton::Left),
        Modifiers::default(),
    );
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    let opens = |events: &Rc<RefCell<Vec<MessageListEvent>>>| {
        events
            .borrow()
            .iter()
            .filter(|event| matches!(event, MessageListEvent::OpenLink { .. }))
            .count()
    };
    assert_eq!(opens(&events), 1);

    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 2, byte: 2 }))
        .unwrap();
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(opens(&events), 1, "javascript: must not reach the app");
}

// ------------------------------------------------------------------ multi-click and keyboard

fn click(at: Point<Pixels>, count: usize, cx: &mut VisualTestContext) {
    cx.simulate_event(MouseDownEvent {
        button: MouseButton::Left,
        position: at,
        modifiers: Modifiers::default(),
        click_count: count,
        first_mouse: false,
    });
    cx.simulate_event(MouseUpEvent {
        button: MouseButton::Left,
        position: at,
        modifiers: Modifiers::default(),
        click_count: count,
    });
    draw(cx);
}

fn two_paragraphs() -> Vec<MessageRow> {
    vec![
        fixture::message(
            1,
            fixture::me(),
            NOW_MS - 90_000,
            Body::default().text("alpha beta gamma\nsecond line here"),
        ),
        fixture::message(
            2,
            fixture::me(),
            NOW_MS - 80_000,
            Body::default().text("delta epsilon"),
        ),
        fixture::message(
            3,
            fixture::me(),
            NOW_MS - 70_000,
            Body::default().text("zeta eta theta"),
        ),
    ]
}

#[gpui_kit::test]
fn double_and_triple_click_take_a_word_and_a_line(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, two_paragraphs(), Rc::new(NoMedia));
    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 7 }))
        .unwrap();
    click(at, 2, cx);
    assert_eq!(selected(&view, cx), "beta");
    click(at, 3, cx);
    assert_eq!(selected(&view, cx), "alpha beta gamma");
    click(at, 1, cx);
    assert_eq!(selected(&view, cx), "", "a single click clears it");
}

#[gpui_kit::test]
fn a_double_click_drag_extends_by_whole_words_across_rows(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, two_paragraphs(), Rc::new(NoMedia));
    let from = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 7 }))
        .unwrap();
    let to = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 3, byte: 6 }))
        .unwrap();
    cx.simulate_event(MouseDownEvent {
        button: MouseButton::Left,
        position: from,
        modifiers: Modifiers::default(),
        click_count: 2,
        first_mouse: false,
    });
    draw(cx);
    cx.simulate_mouse_move(to, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(to, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(
        selected(&view, cx),
        "beta gamma\nsecond line here\ndelta epsilon\nzeta eta"
    );
}

#[gpui_kit::test]
fn shift_click_extends_from_the_anchor(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, two_paragraphs(), Rc::new(NoMedia));
    let from = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 6 }))
        .unwrap();
    let to = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 2, byte: 5 }))
        .unwrap();
    let drag_end = from + point(px(40.), px(0.));
    cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(drag_end, Some(MouseButton::Left), Modifiers::default());
    cx.simulate_mouse_up(drag_end, MouseButton::Left, Modifiers::default());
    draw(cx);
    let anchor = selection_of(&view, cx).anchor;
    cx.simulate_mouse_down(to, MouseButton::Left, Modifiers::shift());
    cx.simulate_mouse_up(to, MouseButton::Left, Modifiers::shift());
    draw(cx);
    assert_eq!(selection_of(&view, cx).anchor, anchor);
    assert_eq!(selected(&view, cx), "beta gamma\nsecond line here\ndelta");
}

/// Focuses the list, the way a press does, so bindings reach it.
fn focus_list(view: &Entity<MessageList>, cx: &mut VisualTestContext) {
    let focus = view.read_with(cx, |view, _| view.focus_handle().clone());
    cx.update(|window, cx| window.focus(&focus, cx));
    draw(cx);
}

#[gpui_kit::test]
fn select_all_and_copy_work_from_real_keystrokes(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, two_paragraphs(), Rc::new(NoMedia));
    focus_list(&view, cx);
    cx.simulate_keystrokes("ctrl-a");
    draw(cx);
    let everything = "alpha beta gamma\nsecond line here\ndelta epsilon\nzeta eta theta";
    assert_eq!(selected(&view, cx), everything);
    cx.simulate_keystrokes("ctrl-c");
    cx.run_until_parked();
    let clipboard = cx.update(|_, cx| cx.read_from_clipboard().and_then(|item| item.text()));
    assert_eq!(clipboard.as_deref(), Some(everything));
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert_eq!(selected(&view, cx), "");
}

#[gpui_kit::test]
fn select_all_copies_exact_bytes_from_rows_never_mounted(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 0, 2_000);
    focus_list(&view, cx);
    cx.simulate_keystrokes("ctrl-a");
    draw(cx);
    let expected: Vec<String> = (0..2_000).map(truth).filter(|t| !t.is_empty()).collect();
    assert_eq!(selected(&view, cx), expected.join("\n"));
}

#[gpui_kit::test]
fn the_keyboard_extends_by_char_word_line_and_row(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, two_paragraphs(), Rc::new(NoMedia));
    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 6 }))
        .unwrap();
    click(at, 1, cx);
    let caret = view.read_with(cx, |view, _| view.hit(at)).unwrap();
    assert_eq!(caret.seq, 1);

    cx.simulate_keystrokes("shift-right");
    draw(cx);
    let one = selected(&view, cx);
    assert_eq!(one.chars().count(), 1, "one step: {one:?}");

    cx.simulate_keystrokes("ctrl-shift-right");
    draw(cx);
    assert!(selected(&view, cx).ends_with("beta") || selected(&view, cx).ends_with("eta"));

    cx.simulate_keystrokes("shift-end");
    draw(cx);
    assert!(
        selected(&view, cx).ends_with("gamma"),
        "{:?}",
        selected(&view, cx)
    );

    // Down a line lands inside the second line of the same row, by painted layout.
    cx.simulate_keystrokes("shift-down");
    draw(cx);
    assert_eq!(selection_of(&view, cx).cursor.seq, 1);
    assert!(selected(&view, cx).contains('\n'));

    // Down again leaves the row.
    cx.simulate_keystrokes("shift-down");
    draw(cx);
    assert_eq!(selection_of(&view, cx).cursor.seq, 2);

    // To the end of everything, then back to the anchor, which empties it.
    cx.simulate_keystrokes("ctrl-shift-end");
    draw(cx);
    assert!(selected(&view, cx).ends_with("theta"));
    cx.simulate_keystrokes("ctrl-shift-home");
    draw(cx);
    assert!(selected(&view, cx).starts_with("alpha"));
}

#[gpui_kit::test]
fn keyboard_extension_with_nothing_pressed_starts_from_the_last_text(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, two_paragraphs(), Rc::new(NoMedia));
    focus_list(&view, cx);
    cx.simulate_keystrokes("shift-left");
    draw(cx);
    assert_eq!(selected(&view, cx), "a", "the last char of the last row");
}

#[gpui_kit::test]
fn selection_is_held_by_seq_when_an_ack_replaces_a_pending_row(cx: &mut TestAppContext) {
    let mut pending = fixture::message(
        2,
        fixture::me(),
        NOW_MS,
        Body::default().text("sent while selected"),
    );
    pending.id = None;
    pending.client_nonce = Some("n1".into());
    pending.send_state = SendState::Pending;
    let first = fixture::message(
        1,
        fixture::me(),
        NOW_MS - 1_000,
        Body::default().text("first"),
    );
    let (view, cx) = open_list(cx, vec![first, pending.clone()], Rc::new(NoMedia));
    let events = record_events(&view, cx);
    let selection = Selection {
        anchor: Pos { seq: 1, byte: 0 },
        cursor: Pos { seq: 2, byte: 4 },
    };
    view.update(cx, |view, cx| view.set_selection(Some(selection), cx));
    draw(cx);
    assert_eq!(selected(&view, cx), "first\nsent");
    assert!(
        events
            .borrow()
            .contains(&MessageListEvent::HoldRows(Some((1, 2)))),
        "core keeps the span loaded"
    );

    let mut acked = pending;
    acked.id = Some("0190a0d4-9999-7000-8000-00000000abcd".into());
    acked.send_state = SendState::Sent;
    acked.revision = 1;
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Replace {
                index: 1,
                rows: vec![acked],
            },
            cx,
        );
    });
    draw(cx);
    assert_eq!(selected(&view, cx), "first\nsent");
    assert_eq!(
        view.read_with(cx, |view, _| view.selection()),
        Some(selection)
    );

    // A reset changes what seqs mean, so it clears the selection and releases the hold.
    view.update(cx, |view, cx| {
        view.apply(ListOp::Reset { rows: Vec::new() }, cx);
    });
    draw(cx);
    assert_eq!(selected(&view, cx), "");
    assert_eq!(
        events.borrow().last(),
        Some(&MessageListEvent::HoldRows(None))
    );
}

// ------------------------------------------------------------------ the list itself

/// Top of each row on screen, by seq, in window coordinates.
fn row_tops(view: &Entity<MessageList>, cx: &mut VisualTestContext) -> BTreeMap<i64, f32> {
    view.read_with(cx, |view, _| {
        let viewport = view.list.viewport_bounds();
        let rows = view.shared.rows.borrow();
        let top = view.list.logical_scroll_top().item_ix;
        let mut tops = BTreeMap::new();
        for ix in top..rows.len() {
            let Some(bounds) = view.list.bounds_for_item(ix) else {
                break;
            };
            if bounds.top() > viewport.bottom() {
                break;
            }
            tops.insert(rows.get(ix).unwrap().seq, f32::from(bounds.top()));
        }
        tops
    })
}

fn max_shift(before: &BTreeMap<i64, f32>, after: &BTreeMap<i64, f32>) -> (usize, f32) {
    let mut compared = 0;
    let mut worst = 0f32;
    for (seq, top) in before {
        if let Some(now) = after.get(seq) {
            compared += 1;
            worst = worst.max((now - top).abs());
        }
    }
    (compared, worst)
}

fn settle(cx: &mut VisualTestContext) {
    draw(cx);
    draw(cx);
}

#[gpui_kit::test]
fn prepending_mid_history_moves_nothing_on_screen(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 0, 20_000);
    scroll_to(&view, 10_000, 37., cx);
    settle(cx);
    let before = row_tops(&view, cx);
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 0,
                rows: synth::rows(-5_000, 5_000),
            },
            cx,
        );
    });
    settle(cx);
    let (compared, worst) = max_shift(&before, &row_tops(&view, cx));
    assert!(compared > 2, "compared {compared}");
    assert_eq!(worst, 0., "max shift over {compared} rows");
}

#[gpui_kit::test]
fn prepending_during_a_live_scroll_moves_rows_by_the_wheel_alone(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 0, 20_000);
    scroll_to(&view, 10_000, 0., cx);
    settle(cx);
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());
    let wheel = 40f32;
    let mut first = -500;
    let mut compared = 0;
    let mut worst = 0f32;
    for frame in 0..120 {
        let before = row_tops(&view, cx);
        cx.simulate_event(ScrollEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(px(0.), px(wheel))),
            ..Default::default()
        });
        if frame % 20 == 10 {
            view.update(cx, |view, cx| {
                view.apply(
                    ListOp::Insert {
                        index: 0,
                        rows: synth::rows(first, 500),
                    },
                    cx,
                );
            });
            first -= 500;
        }
        draw(cx);
        for (seq, top) in row_tops(&view, cx) {
            if let Some(was) = before.get(&seq) {
                compared += 1;
                worst = worst.max((top - was - wheel).abs());
            }
        }
    }
    assert!(compared > 100, "compared {compared}");
    assert_eq!(worst, 0., "max error over {compared} row-frames");
}

/// All from one author, a minute apart, so a prepended neighbour turns the first row into a
/// continuation: its header and its day separator would both go.
fn one_author(first: i64, count: usize) -> Vec<MessageRow> {
    (first..first + count as i64)
        .map(|seq| {
            fixture::message(
                seq,
                fixture::me(),
                NOW_MS + seq * 60_000,
                Body::default().text(&format!("row {seq}")),
            )
        })
        .collect()
}

#[gpui_kit::test]
fn prepending_at_the_top_row_does_not_jump_even_when_its_header_goes(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 200), Rc::new(NoMedia));
    scroll_to(&view, 0, 0., cx);
    settle(cx);
    let before = row_tops(&view, cx);
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 0,
                rows: one_author(-50, 50),
            },
            cx,
        );
    });
    settle(cx);
    let after = row_tops(&view, cx);
    let (compared, worst) = max_shift(&before, &after);
    assert!(compared > 2, "compared {compared}");
    assert_eq!(worst, 0., "max shift over {compared} rows");

    // Once the row is out of view it stops being special, with nothing moving where anyone can see.
    view.update(cx, |view, cx| {
        assert!(!view.shared.frozen_decor.borrow().is_empty());
        view.scroll_to_seq(120, 0.);
        cx.notify();
    });
    settle(cx);
    settle(cx);
    view.read_with(cx, |view, _| {
        assert!(view.shared.frozen_decor.borrow().is_empty());
        let rows = view.shared.rows.borrow();
        let ix = rows.index_of(0).unwrap();
        let decor = view.shared.decor_at(&rows, ix);
        assert!(decor.grouped, "row 0 now continues the run above it");
        assert!(decor.day.is_none());
    });
}

fn image_row(seq: i64, width: Option<u32>, height: Option<u32>) -> MessageRow {
    let mut row = fixture::message(
        seq,
        fixture::me(),
        NOW_MS + seq * 600_000,
        Body::default().text("an image"),
    );
    row.attachments = vec![AttachmentView {
        file_id: format!("late-{seq}"),
        filename: "late.png".into(),
        mime_type: "image/png".into(),
        size_bytes: 1,
        kind: AttachmentKind::Image,
        has_thumbnail: false,
        width,
        height,
    }];
    row
}

/// Images that are "still loading" until told otherwise.
#[derive(Default)]
struct LateMedia {
    arrived: RefCell<HashMap<String, Arc<RenderImage>>>,
}

impl MediaSource for LateMedia {
    fn attachment(&self, attachment: &AttachmentView) -> MediaRef {
        self.arrived
            .borrow()
            .get(&attachment.file_id)
            .map_or(MediaRef::Pending, |image| MediaRef::Ready(image.clone()))
    }
    fn emoji(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
    fn avatar(&self, _: &str) -> MediaRef {
        MediaRef::Missing
    }
}

fn late_load_shift(
    cx: &mut TestAppContext,
    width: Option<u32>,
    height: Option<u32>,
) -> (usize, f32) {
    let media = Rc::new(LateMedia::default());
    let rows: Vec<MessageRow> = (0..30).map(|seq| image_row(seq, width, height)).collect();
    let (view, cx) = open_list(cx, rows, media.clone());
    scroll_to(&view, 2, 12., cx);
    settle(cx);
    let before = row_tops(&view, cx);
    for seq in 0..30 {
        media.arrived.borrow_mut().insert(
            format!("late-{seq}"),
            Arc::new(RenderImage::new(vec![image::Frame::new(
                image::RgbaImage::new(1600, 900),
            )])),
        );
    }
    view.update(cx, |_, cx| cx.notify());
    settle(cx);
    max_shift(&before, &row_tops(&view, cx))
}

#[gpui_kit::test]
fn a_late_image_with_a_known_size_moves_nothing(cx: &mut TestAppContext) {
    let (compared, worst) = late_load_shift(cx, Some(1600), Some(900));
    assert!(compared > 1, "compared {compared}");
    assert_eq!(worst, 0., "max shift over {compared} rows");
}

#[gpui_kit::test]
fn a_late_image_with_no_size_keeps_its_fixed_box(cx: &mut TestAppContext) {
    let (compared, worst) = late_load_shift(cx, None, None);
    assert!(compared > 1, "compared {compared}");
    assert_eq!(worst, 0., "T2 measured 360 px here with no reserved box");
}

#[gpui_kit::test]
fn the_list_follows_the_tail_only_while_at_it(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 100), Rc::new(NoMedia));
    settle(cx);
    assert!(view.read_with(cx, |view, _| view.is_following_tail()));
    let append = |seq: i64| ListOp::Insert {
        index: (seq) as u32,
        rows: one_author(seq, 1),
    };
    view.update(cx, |view, cx| view.apply(append(100), cx));
    settle(cx);
    let last_visible = |view: &Entity<MessageList>, cx: &mut VisualTestContext| {
        view.read_with(cx, |view, _| {
            view.painted_blocks().last().map(|(seq, _)| *seq)
        })
    };
    assert_eq!(last_visible(&view, cx), Some(100), "at the tail: follows");

    // Scrolled up, new rows arrive without moving anything.
    scroll_to(&view, 50, 0., cx);
    settle(cx);
    let before = row_tops(&view, cx);
    view.update(cx, |view, cx| view.apply(append(101), cx));
    settle(cx);
    let (compared, worst) = max_shift(&before, &row_tops(&view, cx));
    assert!(compared > 2);
    assert_eq!(worst, 0.);

    // Your own send takes you back down.
    let mut own = one_author(102, 1);
    own[0].send_state = SendState::Pending;
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 102,
                rows: own,
            },
            cx,
        );
    });
    settle(cx);
    assert_eq!(last_visible(&view, cx), Some(102));
}

#[gpui_kit::test]
fn nearing_the_top_asks_for_older_rows_once(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 300), Rc::new(NoMedia));
    settle(cx);
    let events = record_events(&view, cx);
    let older = |events: &Rc<RefCell<Vec<MessageListEvent>>>| {
        events
            .borrow()
            .iter()
            .filter(|event| **event == MessageListEvent::LoadOlder)
            .count()
    };
    assert_eq!(older(&events), 0, "at the tail of 300 rows");
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());
    // Rows above the measured ones have no height yet, so each wheel event gets a screen or so.
    for _ in 0..200 {
        cx.simulate_event(ScrollEvent {
            position: viewport.center(),
            delta: ScrollDelta::Pixels(point(px(0.), px(100_000.))),
            ..Default::default()
        });
        draw(cx);
    }
    let top = view.read_with(cx, |view, _| view.list.logical_scroll_top().item_ix);
    assert_eq!(top, 0);
    assert_eq!(older(&events), 1, "once, until an answer or a scroll away");

    // An answer: the rows arrive, and the reader is no longer near the top.
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 0,
                rows: one_author(-100, 100),
            },
            cx,
        );
    });
    settle(cx);
    assert_eq!(older(&events), 1);

    // A jump that isn't the wheel asks too.
    scroll_to(&view, -95, 0., cx);
    assert_eq!(older(&events), 2);
}

#[gpui_kit::test]
fn edits_and_removals_reach_the_screen_and_the_text(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, two_paragraphs(), Rc::new(NoMedia));
    let mut edited = fixture::message(
        2,
        fixture::me(),
        NOW_MS - 80_000,
        Body::default().text("delta edited"),
    );
    edited.edited = true;
    edited.revision = 1;
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Replace {
                index: 1,
                rows: vec![edited],
            },
            cx,
        );
        view.select_all(cx);
    });
    draw(cx);
    assert!(selected(&view, cx).contains("delta edited"));

    let mut removed = fixture::message(3, fixture::me(), NOW_MS - 70_000, Body::default());
    removed.removed = true;
    removed.revision = 1;
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Replace {
                index: 2,
                rows: vec![removed],
            },
            cx,
        );
    });
    draw(cx);
    assert!(
        !selected(&view, cx).contains("theta"),
        "a removed row has no text"
    );
    let painted = view.read_with(cx, |view, _| view.painted_blocks());
    assert!(painted.iter().all(|(seq, _)| *seq != 3));
}

#[gpui_kit::test]
fn a_malformed_row_renders_instead_of_panicking(cx: &mut TestAppContext) {
    let mut bad = fixture::message(1, fixture::me(), NOW_MS, Body::default().text("héllo"));
    bad.segs[0].end = 2; // inside 'é'
    let mut worse = fixture::message(2, fixture::me(), NOW_MS, Body::default().text("ok"));
    worse.segs[0].end = 9_999;
    let mut nothing = fixture::message(3, fixture::me(), NOW_MS, Body::default());
    nothing.segs = vec![semaphore_core::model::TextSeg {
        end: 50,
        kind: SegKind::Text,
        style: TextStyle::default(),
    }];
    let (view, cx) = open_list(cx, vec![bad, worse, nothing], Rc::new(NoMedia));
    view.update(cx, |view, cx| view.select_all(cx));
    draw(cx);
    assert_eq!(selected(&view, cx), "héllo\nok");
}

// ------------------------------------------------------------------ animation and windows

fn animated_row(seq: i64) -> MessageRow {
    fixture::message(
        seq,
        fixture::me(),
        NOW_MS + seq * 60_000,
        Body::default()
            .text("look ")
            // `synth`'s animated emoji run at 80 ms a frame.
            .emoji("emoji-16", "cat_vibe")
            .text(" here"),
    )
}

/// Runs `millis` of virtual time, drawing only when the view asks to, which is what the platform's
/// frame callback does. Returns how often it asked, and how many animated images painted.
fn run_idle(view: &Entity<MessageList>, millis: u64, cx: &mut VisualTestContext) -> (u32, u64) {
    let notifies = Rc::new(std::cell::Cell::new(0u32));
    let counter = notifies.clone();
    let observed = cx.update(|_, cx| cx.observe(view, move |_, _| counter.set(counter.get() + 1)));
    let before = view.read_with(cx, |view, _| view.animated_paints());
    let mut drawn = 0;
    let mut left = millis;
    while left > 0 {
        let step = left.min(10);
        cx.executor().advance_clock(Duration::from_millis(step));
        cx.run_until_parked();
        if notifies.get() != drawn {
            drawn = notifies.get();
            cx.update(|window, cx| window.draw(cx).clear(cx));
            cx.run_until_parked();
        }
        left -= step;
    }
    drop(observed);
    (
        notifies.get(),
        view.read_with(cx, |view, _| view.animated_paints()) - before,
    )
}

#[gpui_kit::test]
fn an_animated_emoji_redraws_at_its_own_rate_and_never_at_sixty(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, vec![animated_row(1)], Rc::new(SynthMedia::new(None)));
    settle(cx);
    let (notifies, paints) = run_idle(&view, 2_000, cx);
    // Eight frames at 80 ms is 12.5 changes a second, so 25 in two seconds, with slack.
    assert!(
        (20..=30).contains(&notifies),
        "{notifies} notifies in 2 s: the rate should follow the GIF, 12.5 fps"
    );
    assert!(paints >= 20, "{paints} paints of the emoji");
}

#[gpui_kit::test]
fn with_no_animated_emoji_on_screen_nothing_wakes(cx: &mut TestAppContext) {
    // A still emoji in view.
    let still = fixture::message(
        1,
        fixture::me(),
        NOW_MS,
        Body::default().text("still ").emoji("emoji-1", "party"),
    );
    let (view, cx) = open_list(cx, vec![still], Rc::new(SynthMedia::new(None)));
    settle(cx);
    let (notifies, paints) = run_idle(&view, 2_000, cx);
    assert_eq!((notifies, paints), (0, 0));
}

#[gpui_kit::test]
fn scrolling_an_animated_emoji_away_stops_the_timer(cx: &mut TestAppContext) {
    let mut rows = vec![animated_row(0)];
    rows.extend(one_author(1, 300));
    let (view, cx) = open_list(cx, rows, Rc::new(SynthMedia::new(None)));
    scroll_to(&view, 0, 0., cx);
    settle(cx);
    let (moving, _) = run_idle(&view, 1_000, cx);
    assert!(moving > 5, "animating while in view: {moving}");
    scroll_to(&view, 200, 0., cx);
    settle(cx);
    let (notifies, paints) = run_idle(&view, 2_000, cx);
    assert_eq!((notifies, paints), (0, 0), "idle once out of view");
}

#[gpui_kit::test]
fn reduced_motion_stops_animation(cx: &mut TestAppContext) {
    cx.update(|cx| cx.set_reduce_motion(true));
    let (view, cx) = open_list(cx, vec![animated_row(1)], Rc::new(SynthMedia::new(None)));
    settle(cx);
    let (notifies, _) = run_idle(&view, 1_000, cx);
    assert_eq!(notifies, 0);
}

#[test]
fn every_list_window_drops_the_inactive_frame_limit() {
    assert!(WindowOptions::default().inactive_frame_interval.is_some());
    assert_eq!(
        with_list_frame_policy(WindowOptions::default()).inactive_frame_interval,
        None
    );
}

#[gpui_kit::test]
fn loading_and_empty_show_their_own_states(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, Vec::new(), Rc::new(NoMedia));
    draw(cx);
    assert!(view.read_with(cx, |view, _| view.painted_blocks().is_empty()));
    view.update(cx, |view, cx| view.set_status(ListStatus::Loading, cx));
    draw(cx);
    // Rows that arrive replace both.
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Reset {
                rows: two_paragraphs(),
            },
            cx,
        );
        view.set_status(ListStatus::Ready, cx);
    });
    draw(cx);
    assert!(!view.read_with(cx, |view, _| view.painted_blocks().is_empty()));
}

#[test]
fn a_row_reads_out_who_when_and_what() {
    let mut message = fixture::message(
        1,
        fixture::me(),
        NOW_MS,
        Body::default().text("hi ").emoji("e", "wave"),
    );
    message.edited = true;
    message.attachments = vec![image_row(1, None, None).attachments.remove(0)];
    assert_eq!(
        accessible_label(&message, "Mike", "4:12 PM", None),
        "Mike, 4:12 PM, edited: hi :wave:. Attachment: late.png"
    );
    let reply = ReplyPreview {
        author: "Ava".into(),
        text: String::new(),
        deleted: false,
    };
    message.send_state = SendState::Pending;
    message.attachments.clear();
    assert_eq!(
        accessible_label(&message, "Mike", "4:12 PM", Some(&reply)),
        "Mike, 4:12 PM, replying to Ava, edited, sending: hi :wave:"
    );
    message.removed = true;
    message.display.clear();
    assert_eq!(
        accessible_label(&message, "Mike", "4:12 PM", None),
        "Mike, 4:12 PM, edited, sending: message deleted"
    );
}

#[gpui_kit::test]
fn a_press_on_the_scrollbar_does_not_start_a_selection(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        init(cx);
    });
    let (view, cx) = cx.add_window_view(move |_, cx| {
        MessageList::new(
            ListData {
                me_id: "me".into(),
                rows: one_author(0, 300),
                replies: HashMap::new(),
                status: ListStatus::Ready,
            },
            Rc::new(NoMedia),
            ListOptions::default(),
            cx,
        )
    });
    draw(cx);
    let viewport = view.read_with(cx, |view, _| view.list.viewport_bounds());
    let on_scrollbar = point(viewport.right() - px(4.), viewport.center().y);
    let elsewhere = point(viewport.right() - px(4.), viewport.top() + px(20.));
    // Hovering first, because the kit's bar only takes presses while it's showing.
    cx.simulate_mouse_move(on_scrollbar, None, Modifiers::default());
    draw(cx);
    cx.simulate_mouse_down(on_scrollbar, MouseButton::Left, Modifiers::default());
    draw(cx);
    cx.simulate_mouse_move(elsewhere, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(elsewhere, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(selected(&view, cx), "", "dragging the bar selects nothing");
}

fn has_label(label: &str, cx: &mut VisualTestContext) -> bool {
    use gpui_kit::test::TestQueryExt as _;
    cx.update(|window, _| !window.find_all_by_label(label).is_empty())
}

fn click_id(id: impl Into<ElementId>, cx: &mut VisualTestContext) {
    use gpui_kit::test::TestWindowExt as _;
    let id = id.into();
    cx.update(|window, cx| window.click(id, cx));
    draw(cx);
}

#[gpui_kit::test]
fn a_detached_list_asks_for_newer_rows_and_offers_the_present(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 300), Rc::new(NoMedia));
    let events = record_events(&view, cx);
    let count = |events: &Rc<RefCell<Vec<MessageListEvent>>>, wanted: &MessageListEvent| {
        events
            .borrow()
            .iter()
            .filter(|event| *event == wanted)
            .count()
    };
    // At the live edge, the end of the rows is the end: nothing to ask for, no button.
    settle(cx);
    assert_eq!(count(&events, &MessageListEvent::LoadNewer), 0);
    assert!(!has_label("Jump to present", cx));

    view.update(cx, |view, cx| view.set_detached(true, cx));
    settle(cx);
    assert_eq!(count(&events, &MessageListEvent::LoadNewer), 1);
    settle(cx);
    assert_eq!(
        count(&events, &MessageListEvent::LoadNewer),
        1,
        "once until rows arrive"
    );

    assert!(has_label("Jump to present", cx));
    click_id("jump-to-present", cx);
    assert_eq!(count(&events, &MessageListEvent::JumpToPresent), 1);

    // Newer rows arriving at the end let it ask again.
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 300,
                rows: one_author(300, 5),
            },
            cx,
        );
    });
    settle(cx);
    assert_eq!(count(&events, &MessageListEvent::LoadNewer), 2);

    view.update(cx, |view, cx| view.set_detached(false, cx));
    settle(cx);
    assert!(!has_label("Jump to present", cx));
}

#[gpui_kit::test]
fn clicking_a_quote_opens_the_message_it_answers(cx: &mut TestAppContext) {
    let mut rows = one_author(0, 3);
    rows[2].reply_to = Some(ReplyToView {
        message_id: "m-answered".into(),
        author: rows[0].author.clone(),
        text: "the question".into(),
        deleted: false,
    });
    let replies = HashMap::from([(
        2,
        ReplyPreview {
            author: "Ava".into(),
            text: "the question".into(),
            deleted: false,
        },
    )]);
    let (view, cx) = open_with_replies(cx, rows, replies, Rc::new(NoMedia));
    let events = record_events(&view, cx);
    settle(cx);
    click_id(("reply", 2u64), cx);
    assert_eq!(
        events.borrow().as_slice(),
        [MessageListEvent::OpenReply {
            message_id: "m-answered".into()
        }]
    );
}

/// A view around the list that counts the Escape keys that reach it: what a pane's own Escape
/// would see, under the list's focus and key context.
struct EscapeWatcher {
    list: Entity<MessageList>,
    seen: Rc<std::cell::Cell<usize>>,
}

impl Render for EscapeWatcher {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let seen = self.seen.clone();
        div()
            .size_full()
            .on_key_down(cx.listener(move |_, event: &KeyDownEvent, _, _| {
                if event.keystroke.key == "escape" {
                    seen.set(seen.get() + 1);
                }
            }))
            .child(self.list.clone())
    }
}

#[gpui_kit::test]
fn escape_with_nothing_to_do_propagates(cx: &mut TestAppContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        init(cx);
    });
    let seen = Rc::new(std::cell::Cell::new(0usize));
    let watcher = {
        let seen = seen.clone();
        cx.add_window_view(move |_, cx| {
            let list = cx.new(|cx| {
                MessageList::new(
                    ListData {
                        me_id: "me".into(),
                        rows: two_paragraphs(),
                        replies: HashMap::new(),
                        status: ListStatus::Ready,
                    },
                    Rc::new(NoMedia),
                    ListOptions {
                        time: TimeFormat::fixed(NOW_MS),
                        scrollbar: false,
                        ..ListOptions::default()
                    },
                    cx,
                )
            });
            EscapeWatcher { list, seen }
        })
    };
    let (watcher, cx) = watcher;
    let list = watcher.read_with(cx, |watcher, _| watcher.list.clone());
    focus_list(&list, cx);

    // Nothing open, nothing staged, nothing selected: the list leaves the key to its owner.
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert_eq!(seen.get(), 1, "the key went on");

    // A selection is the list's to clear, and the key stops there.
    cx.simulate_keystrokes("ctrl-a");
    draw(cx);
    assert!(!selected(&list, cx).is_empty());
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert_eq!(selected(&list, cx), "", "the selection is gone");
    assert_eq!(seen.get(), 1, "clearing the selection took the Escape");
}
