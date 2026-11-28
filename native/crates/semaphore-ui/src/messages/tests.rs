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
    ListData, ListOptions, ListStatus, MessageList, MessageListEvent, init, with_list_frame_policy,
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
        crate::theme::init(cx);
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

    // Through the real keystroke and the clipboard, with the focus the press left (the pressed
    // row is long out of the drawn range).
    cx.update(|_, cx| cx.write_to_clipboard(ClipboardItem::new_string("SENTINEL".into())));
    cx.simulate_keystrokes("ctrl-c");
    cx.run_until_parked();
    let clipboard = cx
        .update(|_, cx| cx.read_from_clipboard().and_then(|item| item.text()))
        .unwrap();
    assert_eq!(clipboard, expected, "clipboard");

    // Inline emoji and links are in there, both as what they read as in the source.
    let emoji: usize = (0..24u16)
        .map(|e| expected.matches(&format!(":{}:", emoji_name(e))).count())
        .sum();
    let links = expected.matches("https://example.com/issues/").count();
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
            .link("https://example.com/docs", "https://example.com/docs")
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
        Body::default().link("javascript:alert(1)", "javascript:alert(1)"),
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

/// Every link in a row is drawn by its checked label and opens its checked address: a lookalike
/// host as punycode. `javascript:` and an address with a user name or password are plain text,
/// and a press on them opens nothing.
#[gpui_kit::test]
fn links_draw_and_open_as_checked_and_refused_ones_open_nothing(cx: &mut TestAppContext) {
    let lookalike = "https://\u{0430}pple.com/login";
    let rows = vec![
        fixture::message(
            1,
            fixture::me(),
            NOW_MS - 3,
            Body::default().text("go ").link(lookalike, lookalike),
        ),
        fixture::message(
            2,
            fixture::me(),
            NOW_MS - 2,
            Body::default().link("javascript:alert(1)", "javascript:alert(1)"),
        ),
        fixture::message(
            3,
            fixture::me(),
            NOW_MS - 1,
            Body::default().link(
                "https://user:pw@example.com/",
                "https://user:pw@example.com/",
            ),
        ),
    ];
    let (view, cx) = open_list(cx, rows, Rc::new(NoMedia));
    let events = record_events(&view, cx);
    let press = |seq: i64, byte: u32, cx: &mut VisualTestContext| {
        let at = view
            .read_with(cx, |view, _| view.point_of(Pos { seq, byte }))
            .expect("painted");
        cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
        cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
        draw(cx);
    };
    // The lookalike: the press lands on its label, which is drawn longer than it was written.
    let label = "https://xn--pple-43d.com/login";
    let painted = view.read_with(cx, |view, _| {
        view.point_of(Pos { seq: 1, byte: 3 })
            .zip(view.point_of(Pos {
                seq: 1,
                byte: 3 + lookalike.len() as u32,
            }))
    });
    let (start, end) = painted.expect("painted");
    let at = point((start.x + end.x) / 2., start.y);
    cx.simulate_mouse_down(at, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_up(at, MouseButton::Left, Modifiers::default());
    draw(cx);
    let opened: Vec<String> = events
        .borrow()
        .iter()
        .filter_map(|event| match event {
            MessageListEvent::OpenLink { url } => Some(url.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(opened, [label.to_owned()]);
    // What is drawn: the link's own node is named by the label, and the laid-out words hold the
    // label (in its isolate), never the lookalike.
    cx.update(|window, _| {
        use gpui_kit::test::TestQueryExt as _;
        window.find_by_label(label);
    });
    let laid_out: String = view.read_with(cx, |view, _| {
        let row = view.shared.rows.borrow().by_seq(1).cloned().unwrap();
        view.shared
            .prepared_for(&row)
            .text
            .plan
            .blocks
            .iter()
            .map(|block| match block {
                crate::kit::chat::text::Block::Inline { text, .. } => text.clone(),
                crate::kit::chat::text::Block::Code(code) => code.clone(),
            })
            .collect()
    });
    assert_eq!(laid_out, format!("go \u{2066}{label}\u{2069}"));
    // What is drawn and copied is the label, never the lookalike.
    view.update(cx, |view, cx| view.select_all(cx));
    let copied = selected(&view, cx);
    assert!(copied.contains(&format!("go {label}")), "{copied:?}");
    assert!(!copied.contains('\u{0430}'), "{copied:?}");
    assert!(copied.contains("javascript:alert(1)"));
    assert!(copied.contains("https://user:pw@example.com/"));
    view.update(cx, |view, cx| view.set_selection(None, cx));

    // The refused ones: plain text, and a press opens nothing.
    press(2, 4, cx);
    press(3, 10, cx);
    let opens = events
        .borrow()
        .iter()
        .filter(|event| matches!(event, MessageListEvent::OpenLink { .. }))
        .count();
    assert_eq!(opens, 1, "refused addresses must not reach the app");
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

/// Focuses the list, as a pointer press in it does, so bindings reach it.
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
        crate::theme::init(cx);
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
        crate::theme::init(cx);
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

// ---- Screen-reader announcements (`announce.rs`), through the list. ----

use gpui_kit::test::TestWindowExt as _;

fn message(seq: i64, author: semaphore_core::model::UserView, text: &str) -> MessageRow {
    fixture::message(seq, author, NOW_MS, Body::default().text(text))
}

/// One of this reader's own rows, as core marks it.
fn own(seq: i64, text: &str) -> MessageRow {
    let mut row = message(seq, fixture::me(), text);
    row.mine = true;
    row
}

fn insert_at_end(view: &Entity<MessageList>, cx: &mut VisualTestContext, rows: Vec<MessageRow>) {
    let len = view.read_with(cx, |view, _| view.row_count());
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: len as u32,
                rows,
            },
            cx,
        );
    });
    draw(cx);
}

#[gpui_kit::test]
fn a_message_away_from_the_bottom_is_announced_after_the_window(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 1, 40);
    scroll_to(&view, 2, 0., cx);
    assert!(!view.read_with(cx, |view, _| view.is_following_tail()));

    insert_at_end(
        &view,
        cx,
        vec![message(
            41,
            fixture::user("u-ava", "ava", Some("Ava Chen")),
            "hello",
        )],
    );
    assert!(
        view.read_with(cx, |view, _| view.announcement().cloned())
            .is_none(),
        "nothing before the window closes"
    );

    cx.executor().advance_clock(Duration::from_millis(2_000));
    draw(cx);
    let said = view
        .read_with(cx, |view, _| view.announcement().cloned())
        .expect("an announcement");
    assert_eq!(said.text, "Ava Chen: hello");

    let (role, label) = cx.update(|window, _| {
        let node = window.find(("message-announcement", said.seq));
        (node.role(), node.label().map(str::to_owned))
    });
    assert_eq!(role, Some(Role::Status));
    assert_eq!(label.as_deref(), Some("Ava Chen: hello"));
}

#[gpui_kit::test]
fn nothing_is_announced_while_following_the_bottom_or_for_ones_own_message(
    cx: &mut TestAppContext,
) {
    let (view, cx) = setup(cx, 1, 40);
    insert_at_end(&view, cx, vec![own(41, "mine")]);
    cx.executor().advance_clock(Duration::from_millis(2_000));
    draw(cx);
    assert!(
        view.read_with(cx, |view, _| view.announcement().cloned())
            .is_none()
    );

    // Away from the bottom, but only this user's own row: still nothing.
    scroll_to(&view, 2, 0., cx);
    insert_at_end(&view, cx, vec![own(42, "also mine")]);
    cx.executor().advance_clock(Duration::from_millis(2_000));
    draw(cx);
    assert!(
        view.read_with(cx, |view, _| view.announcement().cloned())
            .is_none()
    );
}

#[gpui_kit::test]
fn several_messages_in_one_window_are_counted_once(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 1, 40);
    scroll_to(&view, 2, 0., cx);
    let ava = fixture::user("u-ava", "ava", Some("Ava Chen"));
    insert_at_end(&view, cx, vec![message(41, ava.clone(), "one")]);
    insert_at_end(&view, cx, vec![message(42, ava.clone(), "two")]);
    insert_at_end(&view, cx, vec![message(43, ava, "three")]);
    cx.executor().advance_clock(Duration::from_millis(2_000));
    draw(cx);
    assert_eq!(
        view.read_with(cx, |view, _| view
            .announcement()
            .map(|said| said.text.clone())),
        Some("3 new messages".to_owned())
    );
}

#[gpui_kit::test]
fn a_channel_switch_drops_the_pending_batch(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 1, 40);
    scroll_to(&view, 2, 0., cx);
    insert_at_end(
        &view,
        cx,
        vec![message(
            41,
            fixture::user("u-ava", "ava", Some("Ava Chen")),
            "hello",
        )],
    );
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Reset {
                rows: (1..=40)
                    .map(|seq| message(seq, fixture::user("u-ben", "ben", None), "elsewhere"))
                    .collect(),
            },
            cx,
        );
    });
    draw(cx);
    cx.executor().advance_clock(Duration::from_millis(2_000));
    draw(cx);
    assert!(
        view.read_with(cx, |view, _| view.announcement().cloned())
            .is_none()
    );
}

/// The slice rig's `click-text`: a drag that ends where it began, on a link to this server.
#[gpui_kit::test]
fn a_rig_click_on_an_in_app_link_opens_it(cx: &mut TestAppContext) {
    let url = "http://127.0.0.1:3999/#/community/c1/channel/ch2?highlight=m3";
    let text = format!("the lfg post: {url}");
    let row = fixture::message(
        1,
        fixture::user("u-priya", "priya", None),
        NOW_MS,
        Body::default().text("the lfg post: ").link(url, url),
    );
    let (view, cx) = open_list(cx, vec![row], Rc::new(NoMedia));
    let events = record_events(&view, cx);
    let byte = text.find("/#/community").unwrap() as u32 + 3;
    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte }))
        .expect("painted");
    cx.update(|window, cx| window.drag(at, at, cx));
    draw(cx);
    assert!(
        events
            .borrow()
            .contains(&MessageListEvent::OpenLink { url: url.into() }),
        "{:?}",
        events.borrow()
    );
}

// ---- Review fixes (#909) ----

fn opened_links(events: &Rc<RefCell<Vec<MessageListEvent>>>) -> usize {
    events
        .borrow()
        .iter()
        .filter(|event| matches!(event, MessageListEvent::OpenLink { .. }))
        .count()
}

/// `https://example.com:443/é` is drawn `https://example.com/%C3%A9`: the same length, other
/// bytes. A triple-click on its last glyph selects the line without slicing into the `é`.
#[gpui_kit::test]
fn a_triple_click_on_a_same_length_relabelled_link_selects_the_line(cx: &mut TestAppContext) {
    let url = "https://example.com:443/\u{e9}";
    let row = fixture::message(
        1,
        fixture::me(),
        NOW_MS,
        Body::default().text("see ").link(url, url),
    );
    let (view, cx) = open_list(cx, vec![row], Rc::new(NoMedia));
    let at = view
        .read_with(cx, |view, _| {
            view.point_of(Pos {
                seq: 1,
                byte: 4 + 25,
            })
        })
        .expect("painted");
    let hit = view.read_with(cx, |view, _| view.hit(at)).unwrap();
    let display = format!("see {url}");
    assert!(display.is_char_boundary(hit.byte as usize), "{hit:?}");
    click(at, 3, cx);
    assert_eq!(selected(&view, cx), "see https://example.com/%C3%A9");
}

#[gpui_kit::test]
fn shift_end_after_a_click_on_a_same_length_relabelled_link_selects_to_the_end(
    cx: &mut TestAppContext,
) {
    let url = "https://example.com:443/\u{e9}";
    let row = fixture::message(
        1,
        fixture::me(),
        NOW_MS,
        Body::default().text("see ").link(url, url).text(" ok"),
    );
    let (view, cx) = open_list(cx, vec![row], Rc::new(NoMedia));
    let events = record_events(&view, cx);
    let (start, end) = view
        .read_with(cx, |view, _| {
            view.point_of(Pos { seq: 1, byte: 4 })
                .zip(view.point_of(Pos {
                    seq: 1,
                    byte: 4 + url.len() as u32,
                }))
        })
        .expect("painted");
    let at = point(start.x + (end.x - start.x) * 0.9, start.y);
    click(at, 1, cx);
    assert_eq!(opened_links(&events), 1, "a plain click follows the link");
    cx.simulate_keystrokes("shift-end");
    draw(cx);
    // The caret was inside the link: the selection takes it whole, then runs to the end.
    assert_eq!(selected(&view, cx), "https://example.com/%C3%A9 ok");
}

/// Main opened a link only on a plain single click. A double click selects a word, a triple
/// click a line, and Shift extends a selection: none of them opens anything.
#[gpui_kit::test]
fn only_a_plain_single_click_opens_a_link(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, vec![link_row(1)], Rc::new(NoMedia));
    let events = record_events(&view, cx);
    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 6 }))
        .expect("painted");
    click(at, 1, cx);
    assert_eq!(opened_links(&events), 1);
    click(at, 2, cx);
    assert_eq!(
        opened_links(&events),
        1,
        "a double click opens nothing more"
    );
    assert!(!selected(&view, cx).is_empty(), "it selects a word");
    click(at, 3, cx);
    assert_eq!(opened_links(&events), 1, "nor a triple click");
    assert!(
        selected(&view, cx).starts_with("see "),
        "it selects the line"
    );

    // Shift+click extends a selection and opens nothing.
    view.update(cx, |view, cx| view.set_selection(None, cx));
    let from = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 0 }))
        .unwrap();
    // A short drag selects "se", then Shift+click inside the link extends it.
    let drag_end = from + point(px(15.), px(0.));
    cx.simulate_mouse_down(from, MouseButton::Left, Modifiers::default());
    cx.simulate_mouse_move(drag_end, Some(MouseButton::Left), Modifiers::default());
    cx.simulate_mouse_up(drag_end, MouseButton::Left, Modifiers::default());
    draw(cx);
    let to = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 10 }))
        .unwrap();
    let modified_click = |modifiers: Modifiers, cx: &mut VisualTestContext| {
        cx.simulate_event(MouseDownEvent {
            button: MouseButton::Left,
            position: to,
            modifiers,
            click_count: 1,
            first_mouse: false,
        });
        cx.simulate_event(MouseUpEvent {
            button: MouseButton::Left,
            position: to,
            modifiers,
            click_count: 1,
        });
        draw(cx);
    };
    modified_click(Modifiers::shift(), cx);
    assert_eq!(selected(&view, cx), "see https:", "Shift+click extends");
    assert_eq!(opened_links(&events), 1, "and opens nothing");
    for modifiers in [Modifiers::command(), Modifiers::alt(), Modifiers::control()] {
        modified_click(modifiers, cx);
    }
    assert_eq!(opened_links(&events), 1, "a modified click opens nothing");
}

fn bare_origin_row() -> MessageRow {
    let url = "https://example.com";
    fixture::message(
        1,
        fixture::me(),
        NOW_MS,
        Body::default().text("see ").link(url, url).text(" now ok"),
    )
}

/// `https://example.com` is drawn `https://example.com/`: relabelled, so one unit for selection.
#[gpui_kit::test]
fn selection_takes_a_relabelled_link_whole(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, vec![bare_origin_row()], Rc::new(NoMedia));
    let link_end = 4 + "https://example.com".len() as u32;
    let (start, end) = view
        .read_with(cx, |view, _| {
            view.point_of(Pos { seq: 1, byte: 4 })
                .zip(view.point_of(Pos {
                    seq: 1,
                    byte: link_end,
                }))
        })
        .expect("painted");
    let mid = point((start.x + end.x) / 2., start.y);

    // A double click in the middle selects the link.
    click(mid, 2, cx);
    assert_eq!(selected(&view, cx), "https://example.com/");

    // A drag from the middle to the right takes the link and what follows.
    view.update(cx, |view, cx| view.set_selection(None, cx));
    let row_end = view
        .read_with(cx, |view, _| {
            view.point_of(Pos {
                seq: 1,
                byte: link_end + 6,
            })
        })
        .unwrap();
    cx.simulate_mouse_down(mid, MouseButton::Left, Modifiers::default());
    draw(cx);
    cx.simulate_mouse_move(row_end, Some(MouseButton::Left), Modifiers::default());
    draw(cx);
    cx.simulate_mouse_up(row_end, MouseButton::Left, Modifiers::default());
    draw(cx);
    assert_eq!(selected(&view, cx), "https://example.com/ now o");

    // From after " now", Shift+Left into the link crosses it in one step: the highlight and the
    // copy move together.
    let focus = view.read_with(cx, |view, _| view.focus_handle().clone());
    cx.update(|window, cx| window.focus(&focus, cx));
    view.update(cx, |view, cx| {
        view.set_selection(
            Some(Selection {
                anchor: Pos {
                    seq: 1,
                    byte: link_end + 4,
                },
                cursor: Pos {
                    seq: 1,
                    byte: link_end,
                },
            }),
            cx,
        )
    });
    draw(cx);
    cx.simulate_keystrokes("shift-left");
    draw(cx);
    let (cursor, highlighted, copied) = view.read_with(cx, |view, _| {
        let selection = view.selection().unwrap();
        let row = view.shared.rows.borrow().by_seq(1).cloned().unwrap();
        let text = view.shared.prepared_for(&row).text.clone();
        let range = selection.range_in(&row).unwrap();
        let drawn: String = text
            .plan
            .blocks
            .iter()
            .map(|block| match block {
                crate::kit::chat::text::Block::Inline { text, .. } => text.clone(),
                crate::kit::chat::text::Block::Code(code) => code.clone(),
            })
            .collect();
        let lit = drawn[text.map.range_to_drawn(range)].replace(['\u{2066}', '\u{2069}'], "");
        (selection.cursor, lit, view.selected_text())
    });
    assert_eq!(cursor, Pos { seq: 1, byte: 4 }, "one step crosses the link");
    assert_eq!(highlighted, "https://example.com/ now");
    assert_eq!(copied, highlighted);
}

/// In a ChatPane the typing line floats over the list's foot; the list keeps its height free,
/// so it never covers the last row.
#[gpui_kit::test]
fn the_typing_line_never_covers_the_last_row(cx: &mut TestAppContext) {
    struct Pane {
        list: Entity<MessageList>,
    }
    impl Render for Pane {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().child(
                crate::kit::ChatPane::new("chat")
                    .typing(crate::kit::TypingLine::new(["ava"]))
                    .composer(div().h(px(60.)))
                    .list(self.list.clone()),
            )
        }
    }
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        init(cx);
    });
    let rows = (1..=40)
        .map(|seq| {
            fixture::message(
                seq,
                fixture::me(),
                NOW_MS - 400_000 + seq * 1000,
                Body::default().text("a plain line of words"),
            )
        })
        .collect::<Vec<_>>();
    let (pane, cx) = cx.add_window_view(move |_, cx| {
        let list = cx.new(|cx| {
            let mut list = MessageList::new(
                ListData {
                    me_id: "me".into(),
                    rows,
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
            );
            // As ConversationPane does.
            list.set_bottom_room(px(crate::kit::TypingLine::HEIGHT), cx);
            list
        });
        Pane { list }
    });
    draw(cx);
    draw(cx);
    let list = pane.read_with(cx, |pane, _| pane.list.clone());
    let (_, last) = *list
        .read_with(cx, |list, _| list.painted_blocks())
        .last()
        .expect("rows painted");
    let typing = cx.update(|window, _| window.find("typing-line").bounds());
    assert!(
        last.bottom() <= typing.top(),
        "last row {last:?} under the typing line {typing:?}"
    );
}

/// Tab, as the window's focus traversal does it.
fn tab(cx: &mut VisualTestContext) {
    cx.update(|window, cx| window.focus_next(cx));
    draw(cx);
}

/// Whether the row `seq` (or a control in it) has focus.
fn row_has_focus(view: &Entity<MessageList>, seq: i64, cx: &mut VisualTestContext) -> bool {
    let handle = view.read_with(cx, |view, _| {
        view.shared.row_focus.borrow().get(&seq).cloned()
    });
    let Some(handle) = handle else {
        return false;
    };
    cx.update(|window, cx| handle.contains_focused(window, cx))
}

/// Whether the row `seq` itself (not a control in it) has focus.
fn row_is_focused(view: &Entity<MessageList>, seq: i64, cx: &mut VisualTestContext) -> bool {
    let handle = view.read_with(cx, |view, _| {
        view.shared.row_focus.borrow().get(&seq).cloned()
    });
    handle.is_some_and(|handle| cx.update(|window, _| handle.is_focused(window)))
}

/// The row whose own handle has focus.
fn focused_row_seq(view: &Entity<MessageList>, cx: &mut VisualTestContext) -> Option<i64> {
    let handles: Vec<(i64, FocusHandle)> = view.read_with(cx, |view, _| {
        view.shared
            .row_focus
            .borrow()
            .iter()
            .map(|(seq, handle)| (*seq, handle.clone()))
            .collect()
    });
    cx.update(|window, _| {
        handles
            .into_iter()
            .find(|(_, handle)| handle.is_focused(window))
            .map(|(seq, _)| seq)
    })
}

/// Whether the list's own handle (not a row) has focus.
fn list_is_focused(view: &Entity<MessageList>, cx: &mut VisualTestContext) -> bool {
    let list = view.read_with(cx, |view, _| view.focus_handle().clone());
    cx.update(|window, _| list.is_focused(window))
}

/// One wheel step over the list: `dy` px towards the newest (negative) or the oldest.
fn wheel(view: &Entity<MessageList>, dy: f32, cx: &mut VisualTestContext) {
    let at = view.read_with(cx, |view, _| view.list.viewport_bounds().center());
    cx.simulate_event(ScrollEvent {
        position: at,
        delta: ScrollDelta::Pixels(point(px(0.), px(dy))),
        ..Default::default()
    });
    draw(cx);
}

/// Whether the row `seq` is on screen: one of its blocks painted inside the viewport.
fn on_screen(view: &Entity<MessageList>, seq: i64, cx: &mut VisualTestContext) -> bool {
    view.read_with(cx, |view, _| {
        let viewport = view.list.viewport_bounds();
        view.painted_blocks()
            .iter()
            .any(|(painted, bounds)| *painted == seq && bounds.intersects(&viewport))
    })
}

#[gpui_kit::test]
fn rows_take_the_lists_roving_focus_with_the_arrow_keys(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 200), Rc::new(NoMedia));
    settle(cx);
    assert!(view.read_with(cx, |view, _| view.is_following_tail()));
    // The newest row is the list's one Tab stop.
    assert_eq!(view.read_with(cx, |view, _| view.focused_row()), Some(199));
    tab(cx);
    assert!(row_is_focused(&view, 199, cx));
    // Up past the top of the screen: each row it lands on is scrolled to, drawn and focused.
    for step in 1..=60 {
        cx.simulate_keystrokes("up");
        draw(cx);
        let seq = 199 - step;
        assert!(row_is_focused(&view, seq, cx), "up {step} lands on {seq}");
        assert!(on_screen(&view, seq, cx), "up {step}: {seq} is on screen");
        assert_eq!(view.read_with(cx, |view, _| view.focused_row()), Some(seq));
    }
    for (keys, seq) in [("home", 0), ("down", 1), ("end", 199), ("home", 0)] {
        cx.simulate_keystrokes(keys);
        draw(cx);
        assert!(row_is_focused(&view, seq, cx), "{keys} lands on {seq}");
        assert!(on_screen(&view, seq, cx), "{keys}: {seq} is on screen");
    }
    // Keys keep working after Home from the tail.
    cx.simulate_keystrokes("down");
    draw(cx);
    assert!(row_is_focused(&view, 1, cx) && on_screen(&view, 1, cx));
    // Shift+Down extends a selection rather than moving the focus.
    cx.simulate_keystrokes("shift-down");
    draw(cx);
    assert!(row_is_focused(&view, 1, cx));
}

#[gpui_kit::test]
fn tab_walks_the_focused_rows_links_and_never_another_rows(cx: &mut TestAppContext) {
    let rows = (0..3).map(link_row).collect();
    let (view, cx) = open_list(cx, rows, Rc::new(NoMedia));
    settle(cx);
    tab(cx);
    assert!(row_is_focused(&view, 2, cx));
    // The next Tab stop is the row's link, inside the row.
    tab(cx);
    assert!(
        row_has_focus(&view, 2, cx) && !row_is_focused(&view, 2, cx),
        "the link in the focused row"
    );
    for _ in 0..4 {
        tab(cx);
        assert!(!row_has_focus(&view, 0, cx) && !row_has_focus(&view, 1, cx));
    }
}

#[gpui_kit::test]
fn the_tab_stop_follows_the_drawn_rows_after_arrivals_and_a_reset(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 5), Rc::new(NoMedia));
    settle(cx);
    tab(cx);
    assert!(row_is_focused(&view, 4, cx));
    cx.update(|window, cx| window.blur(cx));
    draw(cx);
    // 120 messages arrive while the list follows: row 4 goes far off screen, so a row on screen
    // is the Tab stop.
    assert!(view.read_with(cx, |view, _| view.is_following_tail()));
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Insert {
                index: 5,
                rows: one_author(5, 120),
            },
            cx,
        );
    });
    settle(cx);
    assert!(!on_screen(&view, 4, cx), "row 4 is off screen");
    let stop = view.read_with(cx, |view, _| view.focused_row()).unwrap();
    assert!(
        on_screen(&view, stop, cx),
        "the Tab stop {stop} is on screen"
    );
    tab(cx);
    let focused = focused_row_seq(&view, cx).expect("Tab reaches a row");
    assert!(on_screen(&view, focused, cx));
}

#[gpui_kit::test]
fn a_reset_clears_the_roving_row_and_takes_focus_from_a_row(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 5), Rc::new(NoMedia));
    settle(cx);
    tab(cx);
    cx.simulate_keystrokes("up");
    draw(cx);
    assert!(row_is_focused(&view, 3, cx));
    // The same seqs come back in a reset (another conversation's first page uses them too).
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Reset {
                rows: one_author(0, 5),
            },
            cx,
        );
    });
    settle(cx);
    assert!(
        list_is_focused(&view, cx),
        "the list takes focus from the row"
    );
    assert_eq!(
        view.read_with(cx, |view, _| view.focused_row()),
        Some(4),
        "the newest row is the Tab stop again"
    );
    cx.update(|window, cx| window.blur(cx));
    tab(cx);
    assert!(row_is_focused(&view, 4, cx));
}

#[gpui_kit::test]
fn after_a_jump_and_wheel_steps_tab_reaches_a_row_on_screen(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 400), Rc::new(NoMedia));
    settle(cx);
    view.update(cx, |view, cx| {
        view.scroll_to_seq(100, 0.);
        cx.notify();
    });
    // One frame, and Tab straight after it: the stop was picked from where the list is now
    // scrolled, not from the tail's rows the frame before showed.
    cx.update(|window, cx| window.draw(cx).clear(cx));
    let stop = view.read_with(cx, |view, _| view.focused_row()).unwrap();
    assert!(
        on_screen(&view, stop, cx),
        "the Tab stop {stop} is on screen"
    );
    cx.update(|window, cx| window.focus_next(cx));
    let focused = focused_row_seq(&view, cx).expect("Tab after the jump reaches a row");
    assert!(on_screen(&view, focused, cx), "{focused} is on screen");
    for step in 0..6 {
        cx.update(|window, cx| window.blur(cx));
        wheel(&view, -150., cx);
        tab(cx);
        let focused = focused_row_seq(&view, cx).expect("Tab after a wheel step reaches a row");
        assert!(
            on_screen(&view, focused, cx),
            "step {step}: {focused} on screen"
        );
    }
}

#[gpui_kit::test]
fn a_focused_row_scrolled_away_keeps_the_keys_and_is_not_drawn_in_view(cx: &mut TestAppContext) {
    let (view, cx) = open_list(cx, one_author(0, 200), Rc::new(NoMedia));
    view.update(cx, |view, cx| view.set_bottom_room(px(24.), cx));
    settle(cx);
    tab(cx);
    for _ in 0..60 {
        cx.simulate_keystrokes("up");
    }
    draw(cx);
    assert!(row_is_focused(&view, 139, cx));
    // Back to the newest: the focused row is far above, kept drawn (the list holds its handle)
    // but out of sight: nothing of it is painted where the newest rows and their room are.
    view.update(cx, |view, cx| {
        view.scroll_to_latest();
        cx.notify();
    });
    settle(cx);
    assert!(on_screen(&view, 199, cx));
    assert!(
        view.read_with(cx, |view, _| view.painted_blocks())
            .iter()
            .all(|(seq, _)| *seq != 139),
        "row 139 is not painted under the newest message"
    );
    assert!(row_is_focused(&view, 139, cx));
    // And the keys still reach it.
    cx.simulate_keystrokes("up");
    draw(cx);
    assert!(row_is_focused(&view, 138, cx) && on_screen(&view, 138, cx));
}

#[gpui_kit::test]
fn down_from_a_message_taller_than_the_view_shows_the_next(cx: &mut TestAppContext) {
    let mut rows = one_author(0, 60);
    let long = (0..120)
        .map(|line| format!("line {line} of a long paste"))
        .collect::<Vec<_>>()
        .join("\n");
    rows[50] = fixture::message(
        50,
        fixture::me(),
        NOW_MS + 50 * 60_000,
        Body::default().text(&long),
    );
    let (view, cx) = open_list(cx, rows, Rc::new(NoMedia));
    settle(cx);
    tab(cx);
    cx.simulate_keystrokes("home");
    draw(cx);
    for _ in 0..50 {
        cx.simulate_keystrokes("down");
        draw(cx);
    }
    assert!(row_is_focused(&view, 50, cx));
    cx.simulate_keystrokes("down");
    draw(cx);
    assert!(row_is_focused(&view, 51, cx));
    assert!(on_screen(&view, 51, cx), "row 51 is shown");
}

#[gpui_kit::test]
fn deleting_a_focused_row_or_one_with_a_focused_link_gives_the_list_focus(cx: &mut TestAppContext) {
    let rows = (0..5).map(link_row).collect();
    let (view, cx) = open_list(cx, rows, Rc::new(NoMedia));
    settle(cx);
    tab(cx);
    assert!(row_is_focused(&view, 4, cx));
    view.update(cx, |view, cx| {
        view.apply(ListOp::Remove { index: 4, count: 1 }, cx)
    });
    settle(cx);
    assert!(list_is_focused(&view, cx), "the row");
    // Now the link in the newest row.
    cx.update(|window, cx| window.blur(cx));
    tab(cx);
    tab(cx);
    assert!(row_has_focus(&view, 3, cx) && !row_is_focused(&view, 3, cx));
    view.update(cx, |view, cx| {
        view.apply(ListOp::Remove { index: 3, count: 1 }, cx)
    });
    settle(cx);
    assert!(list_is_focused(&view, cx), "a link in the row");
    cx.simulate_keystrokes("ctrl-a");
    draw(cx);
    assert!(!selected(&view, cx).is_empty());
}

#[gpui_kit::test]
fn a_reaction_taken_back_from_the_keyboard_leaves_focus_on_its_row(cx: &mut TestAppContext) {
    let mut rows = one_author(0, 3);
    rows[2].id = Some("m-2".into());
    rows[2].reactions = vec![semaphore_core::model::ReactionView {
        emoji: "\u{1F44D}".into(),
        count: 1,
        me: true,
        user_ids: vec!["me".into()],
        custom_emoji_id: None,
    }];
    let (view, cx) = open_list(cx, rows.clone(), Rc::new(NoMedia));
    settle(cx);
    tab(cx);
    tab(cx);
    assert!(
        row_has_focus(&view, 2, cx) && !row_is_focused(&view, 2, cx),
        "the chip"
    );
    let mut gone = rows[2].clone();
    gone.reactions.clear();
    gone.revision += 1;
    view.update(cx, |view, cx| {
        view.apply(
            ListOp::Replace {
                index: 2,
                rows: vec![gone],
            },
            cx,
        )
    });
    settle(cx);
    settle(cx);
    assert!(
        row_is_focused(&view, 2, cx),
        "the row takes the chip's focus"
    );
    cx.simulate_keystrokes("up");
    draw(cx);
    assert!(row_is_focused(&view, 1, cx));
}

#[gpui_kit::test]
fn a_press_focuses_the_list_so_its_shortcuts_work_wherever_the_row_goes(cx: &mut TestAppContext) {
    let (view, cx) = setup(cx, 0, 3_000);
    scroll_to(&view, 1_000, 0., cx);
    let (_, bounds) = first_full_block(&view, cx);
    click(bounds.origin + point(px(10.), px(6.)), 1, cx);
    assert!(list_is_focused(&view, cx), "the list itself, not the row");
    scroll_to(&view, 2_900, 0., cx);
    cx.simulate_keystrokes("ctrl-a");
    draw(cx);
    assert!(
        !selected(&view, cx).is_empty(),
        "Ctrl+A after scrolling away"
    );
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert_eq!(selected(&view, cx), "", "Escape");
    // Tab from the list goes into it, to its Tab stop row.
    tab(cx);
    let stop = view.read_with(cx, |view, _| view.focused_row()).unwrap();
    assert!(row_is_focused(&view, stop, cx));
}

#[gpui_kit::test]
fn enter_on_a_focused_row_opens_no_menu_the_keyboard_cannot_use(cx: &mut TestAppContext) {
    let mut rows = one_author(0, 3);
    for row in &mut rows {
        row.id = Some(format!("m-{}", row.seq));
    }
    let (view, cx) = open_list(cx, rows, Rc::new(NoMedia));
    settle(cx);
    tab(cx);
    cx.simulate_keystrokes("up");
    draw(cx);
    assert!(row_is_focused(&view, 1, cx));
    for keys in ["enter", "shift-f10"] {
        cx.simulate_keystrokes(keys);
        draw(cx);
        assert_eq!(
            view.read_with(cx, |view, _| view.menu_open()),
            None,
            "{keys}"
        );
    }
    assert!(row_is_focused(&view, 1, cx));
}

#[gpui_kit::test]
fn a_mentions_pads_are_drawn_but_never_selected_or_copied(cx: &mut TestAppContext) {
    let rows = vec![fixture::message(
        1,
        fixture::user("u-ava", "ava", Some("Ava")),
        NOW_MS - 60_000,
        Body::default()
            .text("ask ")
            .mention("@alexk", "u-alex")
            .text(" about it"),
    )];
    let (view, cx) = open_list(cx, rows, Rc::new(NoMedia));
    settle(cx);
    // What is drawn: the name between its pads, inside its isolate.
    let (drawn, highlighted) = view.read_with(cx, |view, _| {
        let row = view.shared.rows.borrow().by_seq(1).cloned().unwrap();
        let text = view.shared.prepared_for(&row).text.clone();
        let drawn: String = text
            .segments
            .iter()
            .map(|segment| crate::kit::chat::shown(segment, true))
            .collect();
        // The mention in the display string is bytes 4..10: "alex" inside it is 5..9.
        let range = text.map.to_drawn(5) as usize..text.map.to_drawn(9) as usize;
        (drawn.clone(), drawn[range].to_owned())
    });
    assert_eq!(
        drawn, "ask \u{2066}\u{200A}@alexk\u{200A}\u{2069} about it",
        "the pads are drawn"
    );
    assert_eq!(
        highlighted, "alex",
        "a selection inside the name maps past the marks and pads"
    );
    focus_list(&view, cx);
    cx.simulate_keystrokes("ctrl-a");
    draw(cx);
    assert_eq!(selected(&view, cx), "ask @alexk about it");
}
