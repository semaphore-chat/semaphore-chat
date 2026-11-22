//! MessageRow, ChatPane and RowTabScope: names, states, the toolbar's reveal, how the actions are
//! asked for, roving focus and how a row shares Tab, and the pane's regions, cover and drop zone.

use super::row::{asks_for_actions, row_name};
use super::*;
use crate::dms::rig::{Rig, rig};
use crate::kit::{Button, IconButton, Surface, SurfaceScope};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_design::Icon as I;
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

type Log = Rc<RefCell<Vec<String>>>;
type Body = Box<dyn Fn(&Log, &[FocusHandle], &mut Window, &mut App) -> AnyElement>;

struct Host {
    body: Body,
    log: Log,
    handles: Vec<FocusHandle>,
}

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().flex().flex_col().child(SurfaceScope::new(
            Surface::Surface,
            (self.body)(&self.log, &self.handles, window, cx),
        ))
    }
}

fn host(
    cx: &mut TestAppContext,
    body: impl Fn(&Log, &[FocusHandle], &mut Window, &mut App) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, cx| Host {
        body: Box::new(body),
        log: shared,
        handles: (0..4).map(|_| cx.focus_handle()).collect(),
    });
    rig.with(cx, |_, window, _| window.activate_window());
    (rig, log)
}

fn note(log: &Log, line: &str) -> impl Fn(&mut Window, &mut App) + 'static {
    let log = log.clone();
    let line = line.to_owned();
    move |_, _| log.borrow_mut().push(line.clone())
}

fn logged(log: &Log) -> Vec<String> {
    log.borrow().clone()
}

fn focus(rig: &Rig<Host, ()>, cx: &mut TestAppContext, index: usize) {
    rig.with(cx, move |view, window, cx| {
        let handle = view.read(cx).handles[index].clone();
        window.focus(&handle, cx);
    });
}

fn press(rig: &Rig<Host, ()>, cx: &mut TestAppContext, key: &str) {
    let key = key.to_owned();
    rig.with(cx, move |_, window, cx| window.press(&key, cx));
}

fn tab(rig: &Rig<Host, ()>, cx: &mut TestAppContext) {
    rig.with(cx, |_, window, cx| window.focus_next(cx));
}

/// The label of the focused node, if a labelled node has focus.
fn focused_label(rig: &Rig<Host, ()>, cx: &mut TestAppContext, labels: &[&str]) -> Option<String> {
    let labels: Vec<String> = labels.iter().map(|l| (*l).to_owned()).collect();
    rig.with(cx, move |_, window, _| {
        labels
            .iter()
            .find(|label| {
                window
                    .try_find_by_label(label)
                    .and_then(|node| node.focused())
                    == Some(true)
            })
            .cloned()
    })
}

fn words(id: &'static str, text: &'static str) -> MessageText {
    MessageText::new(id, vec![MessageSegment::text(text)])
}

// ---------------------------------------------------------------------------------------------
// Names and states

#[test]
fn a_row_is_named_by_its_author_and_time() {
    assert_eq!(row_name("aiko", "8:19 PM", None), "aiko, 8:19 PM");
    assert_eq!(
        row_name("aiko", "8:19 PM", Some("Monday 16 November 2026, 8:19 PM")),
        "aiko, 8:19 PM, Monday 16 November 2026, 8:19 PM"
    );
}

#[gpui_kit::test]
fn every_row_is_an_article_named_by_who_and_when_continued_too(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _, _| {
        div()
            .w(px(640.))
            .child(
                MessageRow::new("first", "aiko", "8:19 PM")
                    .time_label("Monday 16 November 2026, 8:19 PM")
                    .body(words("b1", "hello")),
            )
            .child(
                MessageRow::new("next", "aiko", "8:20 PM")
                    .continued(true)
                    .body(words("b2", "again")),
            )
            .child(
                MessageRow::new("pending", "alexk", "8:24 PM")
                    .state(MessageState::Pending)
                    .body(words("b3", "on its way")),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let first = window.find("first");
        assert_eq!(first.role(), Some(Role::Article));
        assert_eq!(
            first.label(),
            Some("aiko, 8:19 PM, Monday 16 November 2026, 8:19 PM")
        );
        assert_eq!(window.find("next").label(), Some("aiko, 8:20 PM"));
        assert_eq!(window.find("pending").description(), Some("busy"));
        assert_ne!(window.find("first").description(), Some("busy"));
    });
}

#[gpui_kit::test]
fn a_continued_row_is_shorter_than_a_first_one(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _, _| {
        div()
            .w(px(640.))
            .child(MessageRow::new("first", "aiko", "8:19 PM").body(words("b1", "hello")))
            .child(
                MessageRow::new("next", "aiko", "8:20 PM")
                    .continued(true)
                    .body(words("b2", "hello")),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let first = window.find("first").bounds().size.height;
        let next = window.find("next").bounds().size.height;
        assert!(next < first, "continued {next:?} vs first {first:?}");
    });
}

#[gpui_kit::test]
fn a_failed_row_says_why_and_offers_retry_and_delete(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _, _| {
        div()
            .w(px(640.))
            .child(
                MessageRow::new("plain", "alexk", "8:24 PM")
                    .state(MessageState::Failed)
                    .on_retry(note(log, "retry plain"))
                    .on_delete(note(log, "delete plain"))
                    .body(words("b1", "did not make it")),
            )
            .child(
                MessageRow::new("busy", "alexk", "8:25 PM")
                    .continued(true)
                    .state(MessageState::Failed)
                    .failed_reason("Timed out until 8:40 PM")
                    .retrying(true)
                    .on_retry(note(log, "retry busy"))
                    .body(words("b2", "again")),
            )
            .child(
                MessageRow::new("bare", "alexk", "8:26 PM")
                    .continued(true)
                    .state(MessageState::Failed)
                    .body(words("b3", "no buttons")),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find_all_by_label("Not sent").len(), 2);
        assert_eq!(
            window.find_by_label("Timed out until 8:40 PM").role(),
            Some(Role::Alert)
        );
        assert_eq!(window.find_all_by_label("Retry").len(), 2);
        assert_eq!(
            window.find_all_by_label("Delete").len(),
            1,
            "only where given"
        );
    });
    for label in ["Retry", "Delete"] {
        rig.with(cx, move |_, window, cx| {
            let target = window.find_all_by_label(label)[0].path().to_vec();
            let id = target.last().cloned().expect("an id");
            window.click(id, cx);
        });
    }
    // The busy Retry ignores presses.
    rig.with(cx, |_, window, cx| {
        let busy = window.find_all_by_label("Retry")[1].clone();
        assert_eq!(busy.description(), Some("busy"));
        window.click(busy.path().last().cloned().unwrap(), cx);
    });
    assert_eq!(logged(&log), ["retry plain", "delete plain"]);
}

#[gpui_kit::test]
fn the_name_and_the_avatar_open_the_author(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _, _| {
        div()
            .w(px(640.))
            .child(
                MessageRow::new("row", "aiko", "8:19 PM")
                    .on_open_author(note(log, "author"))
                    .body(words("b1", "hello")),
            )
            .child(MessageRow::new("plain", "gracie", "8:20 PM").body(words("b2", "hi")))
            .into_any_element()
    });
    rig.with(cx, |_, window, cx| {
        assert_eq!(window.find_by_label("aiko").role(), Some(Role::Button));
        assert!(
            window.try_find_by_label("gracie").is_none(),
            "plain text without a handler"
        );
        let name = window.find_by_label("aiko").path().last().cloned().unwrap();
        window.click(name, cx);
    });
    let avatar = ElementId::NamedChild(std::sync::Arc::new("row".into()), "avatar".into());
    rig.with(cx, move |_, window, cx| window.click(avatar, cx));
    assert_eq!(logged(&log), ["author", "author"]);
}

// ---------------------------------------------------------------------------------------------
// The toolbar

fn toolbar(log: &Log, prefix: &str) -> Vec<AnyElement> {
    ["Add reaction", "Reply", "More actions"]
        .into_iter()
        .map(|label| {
            let line = format!("{prefix} {label}");
            let log = log.clone();
            IconButton::new(
                SharedString::from(format!("{prefix}-{label}")),
                I::MoreHoriz,
                label,
            )
            .small()
            .on_click(move |_, _, _| log.borrow_mut().push(line.clone()))
            .into_any_element()
        })
        .collect()
}

fn toolbar_rows(log: &Log, handles: &[FocusHandle], tab_stop: usize) -> AnyElement {
    let mut column = div().w(px(640.)).flex().flex_col().pt(px(40.));
    for (index, name) in ["first", "second", "third"].into_iter().enumerate() {
        let log_actions = log.clone();
        column = column.child(
            MessageRow::new(name, "gracie", "8:20 PM")
                .continued(index > 0)
                .focus(RowFocus {
                    handle: handles[index].clone(),
                    tab_stop: index == tab_stop,
                })
                .on_open_actions(move |request, _, _| {
                    let how = match request {
                        OpenActionsRequest::Pointer { .. } => "pointer",
                        OpenActionsRequest::Keyboard => "keyboard",
                        OpenActionsRequest::Touch { .. } => "touch",
                    };
                    log_actions.borrow_mut().push(format!("{name} {how}"));
                })
                .actions(toolbar(log, name))
                .body(words(
                    match index {
                        0 => "w0",
                        1 => "w1",
                        _ => "w2",
                    },
                    "words",
                )),
        );
    }
    column
        .child(Button::new("after", "After the list").soft())
        .into_any_element()
}

#[gpui_kit::test]
fn the_toolbar_is_not_there_at_rest(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |log, handles, _, _| toolbar_rows(log, handles, 0));
    rig.with(cx, |_, window, _| {
        assert!(window.find_all_by_label("Add reaction").is_empty());
        assert!(window.find_all_by_role(Role::Toolbar).is_empty());
    });
}

#[gpui_kit::test]
fn the_toolbar_shows_while_focus_is_in_the_row(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |log, handles, _, _| toolbar_rows(log, handles, 0));
    focus(&rig, cx, 1);
    rig.with(cx, |_, window, _| {
        let bars = window.find_all_by_role(Role::Toolbar);
        assert_eq!(bars.len(), 1, "only the focused row's");
        assert_eq!(bars[0].label(), Some("Actions for gracie's message"));
        assert_eq!(window.find_all_by_label("Add reaction").len(), 1);
    });
}

#[gpui_kit::test]
fn the_toolbar_shows_on_hover(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |log, handles, _, _| toolbar_rows(log, handles, 0));
    rig.with(cx, |_, window, cx| window.hover("third", cx));
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find_all_by_role(Role::Toolbar).len(), 1);
        let bar = window.find_all_by_role(Role::Toolbar)[0].bounds();
        let third = window.find("third").bounds();
        assert!(
            bar.top() < third.top() && bar.bottom() > third.top(),
            "it sits on the row's top edge"
        );
    });
}

#[gpui_kit::test]
fn tab_from_the_row_walks_its_toolbar_then_leaves_the_list(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, handles, _, _| toolbar_rows(log, handles, 0));
    tab(&rig, cx);
    let labels = ["Add reaction", "Reply", "More actions", "After the list"];
    assert_eq!(
        rig.with(cx, |_, window, _| window.find("first").focused()),
        Some(true)
    );
    for expected in ["Add reaction", "Reply", "More actions", "After the list"] {
        tab(&rig, cx);
        assert_eq!(focused_label(&rig, cx, &labels).as_deref(), Some(expected));
    }
    assert!(logged(&log).is_empty());
}

#[gpui_kit::test]
fn tab_reaches_only_the_rows_tab_stop(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |log, handles, _, _| toolbar_rows(log, handles, 1));
    tab(&rig, cx);
    rig.with(cx, |_, window, _| {
        assert_eq!(window.find("second").focused(), Some(true));
        assert_ne!(window.find("first").focused(), Some(true));
    });
}

#[gpui_kit::test]
fn right_click_and_the_keys_on_the_row_ask_for_its_actions(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, handles, _, _| toolbar_rows(log, handles, 0));
    rig.with(cx, |_, window, cx| window.right_click("second", cx));
    focus(&rig, cx, 0);
    for key in [
        "enter",
        "menu",
        "shift-f10",
        "shift-enter",
        "ctrl-enter",
        "space",
    ] {
        press(&rig, cx, key);
    }
    assert_eq!(
        logged(&log),
        [
            "second pointer",
            "first keyboard",
            "first keyboard",
            "first keyboard"
        ]
    );
}

#[gpui_kit::test]
fn enter_on_a_control_in_the_row_is_that_controls(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, handles, _, _| toolbar_rows(log, handles, 0));
    focus(&rig, cx, 0);
    tab(&rig, cx);
    press(&rig, cx, "enter");
    assert_eq!(logged(&log), ["first Add reaction"]);
}

#[test]
fn which_keys_ask_for_the_actions() {
    let down = |key: &'static str, held: bool| KeyDownEvent {
        keystroke: Keystroke::parse(key).unwrap(),
        is_held: held,
        prefer_character_input: false,
    };
    assert!(asks_for_actions(&down("enter", false)));
    assert!(
        !asks_for_actions(&down("enter", true)),
        "a held Enter repeats nothing"
    );
    assert!(asks_for_actions(&down("menu", false)));
    assert!(asks_for_actions(&down("shift-f10", false)));
    for key in [
        "shift-enter",
        "alt-enter",
        "ctrl-enter",
        "f10",
        "space",
        "escape",
    ] {
        assert!(!asks_for_actions(&down(key, false)), "{key}");
    }
}

// ---------------------------------------------------------------------------------------------
// RowTabScope

#[gpui_kit::test]
fn controls_in_a_row_that_is_not_the_tab_stop_are_skipped(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, handles, _, _| {
        let row = |name: &'static str, index: usize, stop: bool| {
            MessageRow::new(name, name, "8:20 PM")
                .focus(RowFocus {
                    handle: handles[index].clone(),
                    tab_stop: stop,
                })
                .on_open_author(|_, _| {})
                .body(
                    MessageText::new(
                        SharedString::from(format!("{name}-words")),
                        vec![
                            MessageSegment::text("see "),
                            MessageSegment::link(format!("https://example.com/{name}")),
                        ],
                    )
                    .on_link(|_, _, _| {}),
                )
                .reactions([ReactionChip::new(
                    SharedString::from(format!("{name}-chip")),
                    "🔥",
                    SharedString::from(format!("{name} fire")),
                    1,
                )
                .on_toggle(|_, _| {})])
                .footer(
                    Button::new(SharedString::from(format!("{name}-replies")), "Replies")
                        .text()
                        .accessibility_label(SharedString::from(format!("{name} replies"))),
                )
        };
        div()
            .w(px(640.))
            .child(row("aiko", 0, true))
            .child(row("gracie", 1, false))
            .child(Button::new("after", "After the list").soft())
            .into_any_element()
    });
    // A row reads as focused while focus is inside it, so the rows come last.
    let labels = [
        "aiko",
        "https://example.com/aiko",
        "aiko fire reaction, 1",
        "aiko replies",
        "gracie",
        "https://example.com/gracie",
        "gracie fire reaction, 1",
        "After the list",
        "aiko, 8:20 PM",
        "gracie, 8:20 PM",
    ];
    let mut walked = Vec::new();
    for _ in 0..6 {
        tab(&rig, cx);
        walked.push(focused_label(&rig, cx, &labels).unwrap_or_default());
    }
    assert_eq!(
        walked,
        [
            "aiko, 8:20 PM",
            "aiko",
            "https://example.com/aiko",
            "aiko fire reaction, 1",
            "aiko replies",
            "After the list",
        ]
    );
    // Focus moved into the other row (the list's arrows): its controls are Tab stops now.
    focus(&rig, cx, 1);
    let mut walked = Vec::new();
    for _ in 0..2 {
        tab(&rig, cx);
        walked.push(focused_label(&rig, cx, &labels).unwrap_or_default());
    }
    assert_eq!(walked, ["gracie", "https://example.com/gracie"]);
}

#[gpui_kit::test]
fn outside_a_row_every_control_is_a_tab_stop(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _, cx| {
        assert!(RowTabScope::active(cx));
        div()
            .child(Button::new("a", "A"))
            .child(RowTabScope::new(
                false,
                div()
                    .child(Button::new("b", "B"))
                    .child(IconButton::new("c", I::MoreHoriz, "C")),
            ))
            .child(IconButton::new("d", I::MoreHoriz, "D"))
            .into_any_element()
    });
    let mut walked = Vec::new();
    for _ in 0..2 {
        tab(&rig, cx);
        walked.push(focused_label(&rig, cx, &["A", "B", "C", "D"]).unwrap_or_default());
    }
    assert_eq!(walked, ["A", "D"]);
    rig.with(cx, |_, window, _| {
        // Skipped by Tab, still there and pressable.
        assert!(window.try_find_by_label("B").is_some());
        assert!(window.try_find_by_label("C").is_some());
    });
}

// ---------------------------------------------------------------------------------------------
// ChatPane

fn pane_frame(pane: ChatPane) -> AnyElement {
    div().w(px(390.)).h(px(640.)).child(pane).into_any_element()
}

#[gpui_kit::test]
fn the_list_fills_between_the_header_and_the_composer(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _, _| {
        pane_frame(
            ChatPane::new("pane")
                .header(div().id("head").test_support().h(px(40.)))
                .list(div().id("list").test_support().flex_1().min_h_0())
                .composer(div().id("composer").test_support().h(px(60.)))
                .typing(div().id("typing").test_support().h(px(32.)))
                .jump(JumpToLatest::new("jump", |_, _| {})),
        )
    });
    rig.with(cx, |_, window, _| {
        let pane = window.find("pane").bounds();
        let head = window.find("head").bounds();
        let list = window.find("list").bounds();
        let composer = window.find("composer").bounds();
        let typing = window.find("typing").bounds();
        let jump = window.find("jump").bounds();
        assert!(head.bottom() <= list.top());
        assert_eq!(list.bottom(), composer.top());
        assert_eq!(composer.bottom(), pane.bottom());
        assert_eq!(
            typing.bottom(),
            list.bottom(),
            "the typing line floats at the list's foot"
        );
        assert!(jump.bottom() < list.bottom() && jump.top() > list.top());
    });
}

#[gpui_kit::test]
fn a_state_takes_the_lists_place(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_, _, _, _| {
        pane_frame(
            ChatPane::new("pane")
                .list(div().id("list").test_support())
                .state(div().id("empty").test_support().child("Nothing here yet")),
        )
    });
    rig.with(cx, |_, window, _| {
        assert!(window.try_find("list").is_none());
        assert!(window.try_find("empty").is_some());
    });
}

#[gpui_kit::test]
fn the_announcement_is_a_polite_status_and_silent_under_a_cover(cx: &mut TestAppContext) {
    let covered = Rc::new(std::cell::Cell::new(false));
    let flag = covered.clone();
    let (rig, _) = host(cx, move |_, _, _, _| {
        let mut pane = ChatPane::new("pane").announcement("3 new messages");
        if flag.get() {
            pane = pane.cover(div().id("thread").test_support().size_full());
        }
        pane_frame(pane)
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(
            window.find_by_label("3 new messages").role(),
            Some(Role::Status)
        );
    });
    covered.set(true);
    rig.with(cx, |view, _, cx| view.update(cx, |_, cx| cx.notify()));
    rig.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("3 new messages").is_none());
    });
}

#[gpui_kit::test]
fn a_covered_conversation_is_kept_but_cannot_be_reached(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _, _| {
        pane_frame(
            ChatPane::new("pane")
                .header(Button::new("channel-button", "Members").on_click({
                    let log = log.clone();
                    move |_, _, _| log.borrow_mut().push("members".into())
                }))
                .list(div().flex_1())
                .cover(
                    ChatPane::new("thread")
                        .header(Button::new("thread-back", "Back to #lobby"))
                        .list(div().flex_1()),
                ),
        )
    });
    rig.with(cx, |_, window, _| {
        assert!(
            window.try_find_by_label("Members").is_none(),
            "not in the tree"
        );
        assert!(window.try_find_by_label("Back to #lobby").is_some());
        assert_eq!(
            window.find("pane").bounds(),
            window.find("thread").bounds(),
            "the cover fills it"
        );
    });
    tab(&rig, cx);
    assert_eq!(
        focused_label(&rig, cx, &["Members", "Back to #lobby"]).as_deref(),
        Some("Back to #lobby")
    );
    tab(&rig, cx);
    assert_ne!(
        focused_label(&rig, cx, &["Members", "Back to #lobby"]).as_deref(),
        Some("Members")
    );
    assert!(logged(&log).is_empty());
}

#[gpui_kit::test]
fn files_dropped_on_the_conversation_reach_the_screen(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log, _, _, _| {
        let (drop_log, over_log) = (log.clone(), log.clone());
        pane_frame(
            ChatPane::new("pane")
                .list(div().flex_1())
                .on_drop_files(move |paths, _, _| {
                    drop_log.borrow_mut().push(format!("drop {}", paths.len()))
                })
                .on_files_over(move |over, _, _| {
                    over_log.borrow_mut().push(format!("over {over}"))
                }),
        )
    });
    let window = rig.window;
    let paths =
        ExternalPaths(vec![PathBuf::from("/tmp/a.png"), PathBuf::from("/tmp/b.txt")].into());
    let inside = point(px(100.), px(100.));
    let mut cx = VisualTestContext::from_window(window, cx);
    cx.simulate_event(FileDropEvent::Entered {
        position: inside,
        paths,
    });
    cx.simulate_event(FileDropEvent::Pending { position: inside });
    cx.simulate_event(FileDropEvent::Submit { position: inside });
    cx.run_until_parked();
    let lines = logged(&log);
    assert!(lines.contains(&"drop 2".to_owned()), "{lines:?}");
    assert_eq!(
        lines.first().map(String::as_str),
        Some("over true"),
        "{lines:?}"
    );
}
