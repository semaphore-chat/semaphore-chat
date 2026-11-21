//! GPUI tests of the toast, confirm and load-state hosts, through a window with a `BehaviourRoot`.

use super::confirm::TIMEOUT_MESSAGE;
use super::{
    BehaviourRoot, ConfirmOptions, LoadStateView, ToastRegion, ToastRequest, Toasts,
    confirm_destructive, use_load_state,
};
use crate::dms::rig::{Rig, rig};
use crate::kit::{Button, Dialog};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

type Log = Rc<RefCell<Vec<String>>>;

/// What a run or a fetch answers, set by the test.
#[derive(Clone)]
enum Answer {
    Ok,
    Fail(&'static str),
    Never,
}

struct Bench {
    log: Log,
    dialog: bool,
    answer: Rc<RefCell<Answer>>,
    subject: String,
    items: Rc<RefCell<Vec<&'static str>>>,
    confirm: bool,
    load: bool,
}

impl EventEmitter<()> for Bench {}

impl Render for Bench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut page = div().size_full().relative();
        if self.dialog {
            page = page.child(Dialog::new("blocker", "A dialog").on_close(|_, _| {}));
        }
        if self.confirm {
            let (answer, log) = (self.answer.clone(), self.log.clone());
            let done = self.log.clone();
            let remove = confirm_destructive(
                "delete-channel",
                ConfirmOptions::new(
                    "Delete #general?",
                    "This removes 214 messages for everyone.",
                    "Delete channel",
                    move |window, cx| {
                        log.borrow_mut().push("run".into());
                        let answer = answer.borrow().clone();
                        window.spawn(cx, async move |cx| match answer {
                            Answer::Ok => Ok(()),
                            Answer::Fail(message) => Err(message.to_owned()),
                            Answer::Never => {
                                cx.background_executor()
                                    .timer(Duration::from_secs(3600))
                                    .await;
                                Ok(())
                            }
                        })
                    },
                )
                .timeout(Duration::from_secs(30))
                .on_done(move |_, _| done.borrow_mut().push("done".into())),
                window,
                cx,
            );
            let request = remove.request.clone();
            page = page
                .child(
                    Button::new("delete", "Delete")
                        .danger()
                        .on_click(move |_, window, cx| request(window, cx)),
                )
                .children(remove.dialog);
        }
        if self.load {
            let (answer, items, log) = (self.answer.clone(), self.items.clone(), self.log.clone());
            let result = use_load_state(
                "members",
                self.subject.clone(),
                move |window, cx| {
                    log.borrow_mut().push("fetch".into());
                    let answer = answer.borrow().clone();
                    let items = items.borrow().clone();
                    window.spawn(cx, async move |_| match answer {
                        Answer::Ok => Ok(items),
                        Answer::Fail(message) => Err(message.to_owned()),
                        Answer::Never => Err(String::new()),
                    })
                },
                |items: &Vec<&'static str>| items.is_empty(),
                window,
                cx,
            );
            self.log
                .borrow_mut()
                .push(format!("face {:?}", result.state));
            let refresh = result.refresh.clone();
            let content = div().children(
                result
                    .data
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|item| div().id(item).test_support().child(item)),
            );
            page = page
                .child(
                    Button::new("refresh", "Refresh")
                        .on_click(move |_, window, cx| refresh(true, window, cx)),
                )
                .child(
                    LoadStateView::new("members-face", &result)
                        .empty("No members yet.")
                        .error_title("Couldn't load members")
                        .content(content),
                );
        }
        BehaviourRoot::new(page.child(ToastRegion::new()))
    }
}

fn bench(cx: &mut TestAppContext, confirm: bool, load: bool) -> (Rig<Bench, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, _| Bench {
        log: shared,
        dialog: false,
        answer: Rc::new(RefCell::new(Answer::Ok)),
        subject: "c-1".into(),
        items: Rc::new(RefCell::new(vec!["ava", "ben"])),
        confirm,
        load,
    });
    rig.with(cx, |_, window, _| window.activate_window());
    (rig, log)
}

fn toasts(rig: &Rig<Bench, ()>, cx: &mut TestAppContext) -> Toasts {
    rig.with(cx, |_, window, cx| Toasts::of(window, cx).expect("toasts"))
}

fn show(rig: &Rig<Bench, ()>, cx: &mut TestAppContext, request: ToastRequest) {
    let toasts = toasts(rig, cx);
    rig.with(cx, move |_, _, cx| {
        toasts.show(request, cx);
    });
}

fn advance(rig: &Rig<Bench, ()>, cx: &mut TestAppContext, ms: u64) {
    cx.executor().advance_clock(Duration::from_millis(ms));
    rig.with(cx, |_, _, _| {});
}

fn showing(rig: &Rig<Bench, ()>, cx: &mut TestAppContext) -> Option<String> {
    let toasts = toasts(rig, cx);
    rig.with(cx, move |_, _, cx| toasts.showing(cx))
}

// ---------------------------------------------------------------------------------------------
// Toasts

#[gpui_kit::test]
fn a_toast_shows_in_the_region_and_leaves_after_its_time(cx: &mut TestAppContext) {
    let (rig, _) = bench(cx, false, false);
    show(
        &rig,
        cx,
        ToastRequest::new("Recording saved").id("replay-toast"),
    );
    assert!(rig.has(cx, "replay-toast"), "its id is its element's");
    advance(&rig, cx, 3_900);
    assert!(rig.has(cx, "replay-toast"));
    advance(&rig, cx, 200);
    assert!(!rig.has(cx, "replay-toast"), "gone after motion.toast");
}

#[gpui_kit::test]
fn the_same_id_replaces_and_others_wait_their_turn(cx: &mut TestAppContext) {
    let (rig, _) = bench(cx, false, false);
    show(&rig, cx, ToastRequest::new("Recording saved").id("replay"));
    show(&rig, cx, ToastRequest::new("Clip shared").id("replay"));
    assert_eq!(showing(&rig, cx).as_deref(), Some("Clip shared"));
    show(&rig, cx, ToastRequest::new("You're offline").id("offline"));
    assert_eq!(
        showing(&rig, cx).as_deref(),
        Some("Clip shared"),
        "one at a time"
    );
    advance(&rig, cx, 4_100);
    assert_eq!(showing(&rig, cx).as_deref(), Some("You're offline"));
}

#[gpui_kit::test]
fn an_open_dialog_holds_the_toast(cx: &mut TestAppContext) {
    let (rig, _) = bench(cx, false, false);
    rig.with(cx, |view, _, cx| {
        view.update(cx, |bench, cx| {
            bench.dialog = true;
            cx.notify()
        })
    });
    show(&rig, cx, ToastRequest::new("Clip shared").id("replay"));
    rig.with(cx, |_, _, _| {});
    advance(&rig, cx, 10_000);
    assert!(
        showing(&rig, cx).is_some(),
        "unreachable under a modal: held"
    );
    rig.with(cx, |view, _, cx| {
        view.update(cx, |bench, cx| {
            bench.dialog = false;
            cx.notify()
        })
    });
    rig.with(cx, |_, _, _| {});
    advance(&rig, cx, 4_100);
    assert!(showing(&rig, cx).is_none(), "resumed once it closed");
}

#[gpui_kit::test]
fn the_action_dismisses_then_runs_and_the_toast_is_announced(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, false, false);
    let ran = log.clone();
    show(
        &rig,
        cx,
        ToastRequest::new("Message deleted")
            .id("deleted")
            .action("Undo", move |_, _| ran.borrow_mut().push("undo".into())),
    );
    let said = rig.with(cx, |_, window, _| {
        window
            .find_all_by_role(Role::Status)
            .iter()
            .filter_map(|node| node.label().map(str::to_owned))
            .collect::<Vec<_>>()
    });
    assert!(
        said.contains(&"Message deleted. Undo".to_owned()),
        "the queue's announce, through the announcer: {said:?}"
    );
    rig.click(cx, "deleted-action");
    assert_eq!(*log.borrow(), ["undo"]);
    assert!(showing(&rig, cx).is_none());
}

#[gpui_kit::test]
fn dismiss_takes_a_toast_away(cx: &mut TestAppContext) {
    let (rig, _) = bench(cx, false, false);
    show(
        &rig,
        cx,
        ToastRequest::new("Couldn't join voice")
            .id("voice-join-failed")
            .danger(),
    );
    rig.click(cx, "voice-join-failed-dismiss");
    assert!(!rig.has(cx, "voice-join-failed"));
    show(
        &rig,
        cx,
        ToastRequest::new("Couldn't join voice").id("voice-join-failed"),
    );
    let toasts = toasts(&rig, cx);
    rig.with(cx, move |_, _, cx| toasts.dismiss("voice-join-failed", cx));
    assert!(!rig.has(cx, "voice-join-failed"));
}

// ---------------------------------------------------------------------------------------------
// Confirm destructive

fn phase_dialog(rig: &Rig<Bench, ()>, cx: &mut TestAppContext) -> bool {
    rig.has(cx, "dialog-panel")
}

fn set_answer(rig: &Rig<Bench, ()>, cx: &mut TestAppContext, answer: Answer) {
    rig.with(cx, move |view, _, cx| {
        *view.read(cx).answer.borrow_mut() = answer
    });
}

#[gpui_kit::test]
fn a_confirmed_action_runs_and_closes_the_dialog(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true, false);
    assert!(!phase_dialog(&rig, cx));
    rig.click(cx, "delete");
    assert!(phase_dialog(&rig, cx), "request opens it");
    rig.click(cx, "confirm-run");
    rig.with(cx, |_, _, _| {});
    assert!(!phase_dialog(&rig, cx));
    assert_eq!(*log.borrow(), ["run", "done"]);
}

#[gpui_kit::test]
fn a_failure_stays_open_with_its_message_and_can_be_retried(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true, false);
    set_answer(&rig, cx, Answer::Fail("You can't delete the last channel."));
    rig.click(cx, "delete");
    rig.click(cx, "confirm-run");
    rig.with(cx, |_, _, _| {});
    assert!(phase_dialog(&rig, cx), "stays open");
    assert!(rig.with(cx, |_, window, _| {
        window
            .try_find_by_label("You can't delete the last channel.")
            .is_some()
    }));
    set_answer(&rig, cx, Answer::Ok);
    rig.click(cx, "confirm-run");
    rig.with(cx, |_, _, _| {});
    assert!(!phase_dialog(&rig, cx));
    assert_eq!(*log.borrow(), ["run", "run", "done"]);
}

#[gpui_kit::test]
fn escape_cancels_but_not_while_the_action_runs_and_a_timeout_fails_it(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true, false);
    rig.click(cx, "delete");
    rig.with(cx, |_, window, cx| window.press("escape", cx));
    rig.with(cx, |_, _, _| {});
    assert!(!phase_dialog(&rig, cx), "Escape cancels before the action");
    set_answer(&rig, cx, Answer::Never);
    rig.click(cx, "delete");
    rig.click(cx, "confirm-run");
    rig.with(cx, |_, window, cx| window.press("escape", cx));
    rig.with(cx, |_, _, _| {});
    assert!(phase_dialog(&rig, cx), "nothing closes it while it runs");
    advance(&rig, cx, 30_100);
    assert!(rig.with(cx, |_, window, _| {
        window.try_find_by_label(TIMEOUT_MESSAGE).is_some()
    }));
    assert_eq!(*log.borrow(), ["run"]);
}

// ---------------------------------------------------------------------------------------------
// Load state

fn faces(log: &Log) -> Vec<String> {
    log.borrow()
        .iter()
        .filter(|line| line.starts_with("face"))
        .cloned()
        .collect()
}

#[gpui_kit::test]
fn a_load_shows_loading_then_its_content(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, false, true);
    rig.with(cx, |_, _, _| {});
    assert_eq!(
        faces(&log).first().map(String::as_str),
        Some("face Loading")
    );
    assert_eq!(faces(&log).last().map(String::as_str), Some("face Ready"));
    assert!(rig.has(cx, "ava"));
}

#[gpui_kit::test]
fn an_empty_answer_shows_the_empty_face_and_an_error_offers_try_again(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, false, true);
    rig.with(cx, |view, _, cx| {
        view.update(cx, |bench, cx| {
            bench.items.borrow_mut().clear();
            bench.subject = "c-2".into();
            cx.notify()
        })
    });
    rig.with(cx, |_, _, _| {});
    assert_eq!(faces(&log).last().map(String::as_str), Some("face Empty"));
    set_answer(&rig, cx, Answer::Fail("network unreachable"));
    rig.with(cx, |view, _, cx| {
        view.update(cx, |bench, cx| {
            bench.subject = "c-3".into();
            cx.notify()
        })
    });
    rig.with(cx, |_, _, _| {});
    assert_eq!(faces(&log).last().map(String::as_str), Some("face Error"));
    set_answer(&rig, cx, Answer::Ok);
    rig.with(cx, |view, _, cx| {
        view.update(cx, |bench, _| bench.items.borrow_mut().push("cleo"))
    });
    rig.click(cx, "members-face-error-action");
    rig.with(cx, |_, _, _| {});
    assert_eq!(faces(&log).last().map(String::as_str), Some("face Ready"));
    assert!(rig.has(cx, "cleo"));
}

#[gpui_kit::test]
fn a_failed_refresh_keeps_the_content_and_tells_through_a_toast(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, false, true);
    rig.with(cx, |_, _, _| {});
    set_answer(&rig, cx, Answer::Fail("Couldn't refresh. Try again."));
    rig.click(cx, "refresh");
    rig.with(cx, |_, _, _| {});
    assert_eq!(faces(&log).last().map(String::as_str), Some("face Ready"));
    assert!(rig.has(cx, "ava"), "the content stays");
    assert_eq!(
        showing(&rig, cx).as_deref(),
        Some("Couldn't refresh. Try again."),
        "the reducer's notify"
    );
}
