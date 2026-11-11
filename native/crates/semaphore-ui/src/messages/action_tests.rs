//! The list's message actions in-process: hover, the menu, delete and removal, the unread divider.

use super::fixture::{self, Body, NOW_MS};
use super::format::TimeFormat;
use super::media::NoMedia;
use super::selection::Pos;
use super::view::{ListData, ListOptions, ListStatus, MessageList, MessageListEvent, init};
use super::{ListPermissions, MessageAction};
use gpui_kit::*;
use semaphore_core::model::{MessageRow, UnreadMarker};
use std::cell::RefCell;
use std::prelude::v1::test;
use std::rc::Rc;

const MODERATOR: ListPermissions = ListPermissions {
    reply: true,
    react: true,
    threads: true,
    pin: true,
    unpin: true,
    remove_any: true,
};

fn rows() -> Vec<MessageRow> {
    let sam = fixture::user("u-sam", "sam", None);
    let mut mine = fixture::message(
        2,
        fixture::me(),
        NOW_MS - 60_000,
        Body::default().text("mine"),
    );
    mine.mine = true;
    vec![
        fixture::message(
            1,
            sam.clone(),
            NOW_MS - 120_000,
            Body::default().text("theirs"),
        ),
        mine,
        fixture::message(3, sam, NOW_MS - 30_000, Body::default().text("later")),
    ]
}

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|window, cx| window.draw(cx).clear(cx));
    cx.run_until_parked();
}

fn open(
    cx: &mut TestAppContext,
) -> (
    Entity<MessageList>,
    &mut VisualTestContext,
    Rc<RefCell<Vec<MessageListEvent>>>,
) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        init(cx);
    });
    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut list = MessageList::new(
            ListData {
                me_id: fixture::me().id,
                rows: rows(),
                replies: Default::default(),
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
        list.set_permissions(MODERATOR, cx);
        list
    });
    draw(cx);
    let events = Rc::new(RefCell::new(Vec::new()));
    let sink = events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, event: &MessageListEvent, _| {
            sink.borrow_mut().push(event.clone());
        })
        .detach();
    });
    (view, cx, events)
}

fn id(seq: i64) -> String {
    rows()[seq as usize - 1].id.clone().unwrap()
}

#[gpui_kit::test]
fn hovering_a_row_shows_its_toolbar_and_right_click_opens_the_menu(cx: &mut TestAppContext) {
    let (view, cx, events) = open(cx);
    let at = view
        .read_with(cx, |view, _| view.point_of(Pos { seq: 1, byte: 2 }))
        .expect("row 1 is painted");
    cx.simulate_mouse_move(at, None, Modifiers::default());
    draw(cx);
    assert_eq!(view.read_with(cx, |view, _| view.hovered()), Some(1));

    cx.simulate_mouse_down(at, MouseButton::Right, Modifiers::default());
    cx.simulate_mouse_up(at, MouseButton::Right, Modifiers::default());
    draw(cx);
    assert_eq!(view.read_with(cx, |view, _| view.menu_open()), Some(1));
    assert!(
        view.read_with(cx, |view, _| view.selection()).is_none(),
        "a right click doesn't select"
    );

    cx.update(|window, cx| {
        view.update(cx, |list, cx| {
            list.run_action(1, MessageAction::Pin, at, window, cx)
        })
    });
    draw(cx);
    assert_eq!(view.read_with(cx, |view, _| view.menu_open()), None);
    assert!(
        events
            .borrow()
            .contains(&MessageListEvent::Pin { message_id: id(1) })
    );
}

#[gpui_kit::test]
fn the_author_confirms_a_delete_in_the_toolbar(cx: &mut TestAppContext) {
    let (view, cx, events) = open(cx);
    cx.update(|window, cx| {
        view.update(cx, |list, cx| {
            list.run_action(2, MessageAction::Delete, Point::default(), window, cx)
        })
    });
    draw(cx);
    assert_eq!(view.read_with(cx, |view, _| view.staged_delete()), Some(2));
    assert!(
        events
            .borrow()
            .iter()
            .all(|e| !matches!(e, MessageListEvent::Delete { .. }))
    );

    view.update(cx, |list, cx| list.confirm_delete(2, None, cx));
    draw(cx);
    assert_eq!(view.read_with(cx, |view, _| view.staged_delete()), None);
    assert!(events.borrow().contains(&MessageListEvent::Delete {
        message_id: id(2),
        reason: None
    }));
}

#[gpui_kit::test]
fn escape_cancels_a_staged_delete(cx: &mut TestAppContext) {
    let (view, cx, events) = open(cx);
    cx.update(|window, cx| {
        view.update(cx, |list, cx| {
            list.run_action(2, MessageAction::Delete, Point::default(), window, cx);
            window.focus(list.focus_handle(), cx);
        })
    });
    draw(cx);
    cx.simulate_keystrokes("escape");
    draw(cx);
    assert_eq!(view.read_with(cx, |view, _| view.staged_delete()), None);
    assert!(
        events
            .borrow()
            .iter()
            .all(|e| !matches!(e, MessageListEvent::Delete { .. }))
    );
}

#[gpui_kit::test]
fn a_moderator_removes_someone_elses_message_with_a_reason(cx: &mut TestAppContext) {
    let (view, cx, events) = open(cx);
    cx.update(|window, cx| {
        view.update(cx, |list, cx| {
            list.run_action(1, MessageAction::Delete, Point::default(), window, cx)
        })
    });
    draw(cx);
    assert!(view.read_with(cx, |view, _| view.remove_dialog_open()));
    assert_eq!(view.read_with(cx, |view, _| view.staged_delete()), None);

    view.update(cx, |list, cx| {
        list.confirm_delete(1, Some("  spam  ".into()), cx)
    });
    draw(cx);
    assert!(!view.read_with(cx, |view, _| view.remove_dialog_open()));
    assert!(events.borrow().contains(&MessageListEvent::Delete {
        message_id: id(1),
        reason: Some("spam".into())
    }));
}

#[gpui_kit::test]
fn the_unread_divider_waits_for_its_row(cx: &mut TestAppContext) {
    let (view, cx, _) = open(cx);
    let marker = |after_seq| UnreadMarker {
        after_message_id: id(1),
        after_seq,
        unread_count: 2,
        mention_count: 0,
    };
    view.update(cx, |list, cx| {
        list.set_unread_marker(Some(&marker(None)), cx)
    });
    assert_eq!(view.read_with(cx, |view, _| view.unread_divider()), None);
    view.update(cx, |list, cx| {
        list.set_unread_marker(Some(&marker(Some(1))), cx)
    });
    draw(cx);
    let divider = view.read_with(cx, |view, _| view.unread_divider()).unwrap();
    assert_eq!((divider.after_seq, divider.count), (1, 2));
    view.update(cx, |list, cx| list.set_unread_marker(None, cx));
    assert_eq!(view.read_with(cx, |view, _| view.unread_divider()), None);
}

#[gpui_kit::test]
fn hovering_a_reaction_asks_who_reacted_once(cx: &mut TestAppContext) {
    let (view, cx, events) = open(cx);
    // The shared state the chip's hover handler drives.
    let shared = view.read_with(cx, |list, _| list.shared.clone());
    for _ in 0..2 {
        cx.update(|_, cx| shared.hover_reaction(3, Some(&id(3)), "\u{1F44D}", true, cx));
    }
    let asked = events
        .borrow()
        .iter()
        .filter(|e| matches!(e, MessageListEvent::ReactionHovered { .. }))
        .count();
    assert_eq!(asked, 1);
}
