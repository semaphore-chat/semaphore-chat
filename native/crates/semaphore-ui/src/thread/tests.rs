//! The pane's header and states through real clicks.

use super::*;
// `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
use crate::composer::{
    Composer, ComposerConfig, ComposerMode, DraftStore, MentionSource, ReplyTarget,
};
use crate::messages::fixture::{self, Body, NOW_MS};
use crate::messages::{ListData, ListOptions, ListStatus, MessageList, NoMedia, TimeFormat};
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size};
use semaphore_core::model::{Conversation, ErrorView, MentionCandidate};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

struct Slot;

impl Render for Slot {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full()
    }
}

struct Rig {
    window: AnyWindowHandle,
    pane: Entity<ThreadPane>,
    events: Rc<RefCell<Vec<ThreadPaneEvent>>>,
}

fn rig(cx: &mut TestAppContext, info: ThreadInfo, width: f32) -> Rig {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        crate::kit::set_reduced_motion(true, cx);
    });
    let events = Rc::new(RefCell::new(Vec::new()));
    let log = events.clone();
    let (window, pane) = cx.update(|cx| {
        let mut made = None;
        let handle = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(width), px(800.)),
                })),
                ..Default::default()
            },
            cx,
            |_, cx| {
                let slot = |cx: &mut App| -> AnyView { cx.new(|_| Slot).into() };
                let (parent, replies, composer) = (slot(cx), slot(cx), slot(cx));
                let pane = cx.new(|cx| {
                    let mut pane = ThreadPane::new(parent, replies, composer, cx);
                    pane.set_info(info, cx);
                    pane
                });
                cx.subscribe(&pane, move |_, event: &ThreadPaneEvent, _| {
                    log.borrow_mut().push(event.clone());
                })
                .detach();
                made = Some(pane.clone());
                pane
            },
        )
        .expect("window");
        (handle.0, made.expect("built"))
    });
    Rig {
        window,
        pane,
        events,
    }
}

impl Rig {
    fn with<R>(&self, cx: &mut TestAppContext, f: impl FnOnce(&mut Window, &mut App) -> R) -> R {
        let out = cx
            .update_window(self.window, |_, window, cx| {
                window.render_frame(cx);
                let out = f(window, cx);
                window.render_frame(cx);
                out
            })
            .expect("window");
        cx.run_until_parked();
        out
    }

    fn has(&self, cx: &mut TestAppContext, id: &'static str) -> bool {
        self.with(cx, |window, _| window.try_find(id).is_some())
    }
}

fn ready(subscribed: bool, reply_count: u32) -> ThreadInfo {
    ThreadInfo {
        state: LoadState::Ready,
        subscribed,
        reply_count,
        last_reply_at_ms: None,
    }
}

fn failed(code: &str) -> ThreadInfo {
    ThreadInfo {
        state: LoadState::Failed {
            error: ErrorView {
                code: code.into(),
                message: String::new(),
                retryable: true,
                retry_after_ms: None,
            },
        },
        ..ThreadInfo::default()
    }
}

#[gpui_kit::test]
fn the_bell_asks_for_the_opposite_of_now(cx: &mut TestAppContext) {
    let rig = rig(cx, ready(true, 2), 400.);
    rig.with(cx, |window, cx| window.click("thread-subscribe", cx));
    rig.with(cx, |_, cx| {
        rig.pane
            .update(cx, |pane, cx| pane.set_info(ready(false, 2), cx))
    });
    rig.with(cx, |window, cx| window.click("thread-subscribe", cx));
    rig.with(cx, |window, cx| window.click("thread-close", cx));
    assert_eq!(
        rig.events.borrow().as_slice(),
        [
            ThreadPaneEvent::SetSubscribed(false),
            ThreadPaneEvent::SetSubscribed(true),
            ThreadPaneEvent::Close
        ]
    );
}

#[gpui_kit::test]
fn a_failed_thread_offers_try_again_and_hides_the_composer(cx: &mut TestAppContext) {
    let rig = rig(cx, failed("UNAVAILABLE"), 400.);
    assert!(!rig.has(cx, "thread-composer"));
    assert!(
        !rig.has(cx, "thread-subscribe"),
        "no bell until the thread is read"
    );
    rig.with(cx, |window, cx| window.click("thread-retry", cx));
    assert_eq!(rig.events.borrow().as_slice(), [ThreadPaneEvent::Retry]);
}

#[gpui_kit::test]
fn a_deleted_parent_says_so_with_nothing_to_retry(cx: &mut TestAppContext) {
    let rig = rig(cx, failed("NOT_FOUND"), 400.);
    assert!(rig.has(cx, "thread-missing"));
    assert!(!rig.has(cx, "thread-retry"));
    assert!(!rig.has(cx, "thread-original-message"));
}

#[gpui_kit::test]
fn no_replies_shows_the_empty_state_and_the_composer(cx: &mut TestAppContext) {
    let rig = rig(cx, ready(false, 0), 400.);
    assert!(rig.has(cx, "thread-no-replies"));
    assert!(rig.has(cx, "thread-composer"));
    rig.with(cx, |_, cx| {
        rig.pane
            .update(cx, |pane, cx| pane.set_info(ready(false, 1), cx))
    });
    assert!(!rig.has(cx, "thread-no-replies"));
}

#[gpui_kit::test]
fn a_first_reply_on_its_way_shows_before_the_count_moves(cx: &mut TestAppContext) {
    let rig = rig(cx, ready(false, 0), 400.);
    assert!(rig.has(cx, "thread-no-replies"));
    rig.with(cx, |_, cx| {
        rig.pane.update(cx, |pane, cx| pane.set_reply_rows(1, cx))
    });
    assert!(!rig.has(cx, "thread-no-replies"));
}

#[gpui_kit::test]
fn loading_shows_skeletons(cx: &mut TestAppContext) {
    let rig = rig(cx, ThreadInfo::default(), 400.);
    assert!(rig.has(cx, "thread-parent-loading"));
    assert!(rig.has(cx, "thread-replies-loading"));
}

#[gpui_kit::test]
fn a_phone_gets_a_back_arrow_that_closes(cx: &mut TestAppContext) {
    let rig = rig(cx, ready(true, 2), 390.);
    rig.with(cx, |window, cx| window.click("thread-close", cx));
    assert_eq!(rig.events.borrow().as_slice(), [ThreadPaneEvent::Close]);
}

#[test]
fn the_summary_counts_replies_and_dates_the_last() {
    let now = 10 * 60_000;
    let mut info = ready(false, 1);
    assert_eq!(summary(&info, now).as_deref(), Some("1 reply"));
    info.reply_count = 4;
    info.last_reply_at_ms = Some(5 * 60_000);
    assert_eq!(
        summary(&info, now).as_deref(),
        Some("4 replies · last 5 minutes ago")
    );
    info.reply_count = 0;
    assert_eq!(summary(&info, now), None);
    assert_eq!(
        summary(&ThreadInfo::default(), now),
        None,
        "nothing while loading"
    );
}

// ---- Escape: what nothing inside the pane took first closes it ----

/// A thread pane over real children: a message list for the replies, and a composer or a slot.
struct EscapeRig {
    window: AnyWindowHandle,
    list: Entity<MessageList>,
    composer: Option<Entity<Composer>>,
    events: Rc<RefCell<Vec<ThreadPaneEvent>>>,
}

struct NoMentions;

impl MentionSource for NoMentions {
    fn candidates(&self, _: &str) -> Vec<MentionCandidate> {
        Vec::new()
    }
}

fn escape_rig(cx: &mut TestAppContext, with_composer: bool) -> EscapeRig {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::theme::init(cx);
        crate::messages::init(cx);
        crate::kit::set_reduced_motion(true, cx);
    });
    let events = Rc::new(RefCell::new(Vec::new()));
    let log = events.clone();
    let list: Rc<RefCell<Option<Entity<MessageList>>>> = Rc::new(RefCell::new(None));
    let composer: Rc<RefCell<Option<Entity<Composer>>>> = Rc::new(RefCell::new(None));
    let (list_slot, composer_slot) = (list.clone(), composer.clone());
    let (window, _pane) = cx.update(|cx| {
        let mut made = None;
        let handle = gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(600.), px(800.)),
                })),
                ..Default::default()
            },
            cx,
            |window, cx| {
                let parent: AnyView = cx.new(|_| Slot).into();
                let replies = cx.new(|cx| {
                    MessageList::new(
                        ListData {
                            me_id: "me".into(),
                            rows: vec![fixture::message(
                                1,
                                fixture::user("u-ava", "ava", Some("Ava Chen")),
                                NOW_MS,
                                Body::default().text("the first reply"),
                            )],
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
                *list_slot.borrow_mut() = Some(replies.clone());
                let input: AnyView = if with_composer {
                    let made = cx.new(|cx| {
                        Composer::new(
                            ComposerConfig {
                                conversation: Conversation::Thread {
                                    parent_message_id: "p-1".into(),
                                },
                                source: Rc::new(NoMentions),
                                drafts: cx.new(|_| DraftStore::default()),
                                placeholder: "Reply in thread...".into(),
                                max_file_bytes: None,
                                mode: ComposerMode::Thread,
                            },
                            window,
                            cx,
                        )
                    });
                    *composer_slot.borrow_mut() = Some(made.clone());
                    made.into()
                } else {
                    cx.new(|_| Slot).into()
                };
                let pane = cx.new(|cx| {
                    let mut pane = ThreadPane::new(parent, replies.clone().into(), input, cx);
                    pane.set_info(ready(true, 1), cx);
                    pane.set_reply_rows(1, cx);
                    pane
                });
                let log = log.clone();
                cx.subscribe(&pane, move |_, event: &ThreadPaneEvent, _| {
                    log.borrow_mut().push(event.clone());
                })
                .detach();
                made = Some(pane.clone());
                pane
            },
        )
        .expect("window");
        (handle.0, made.expect("built"))
    });
    EscapeRig {
        window,
        list: list.borrow().clone().expect("the replies list"),
        composer: composer.borrow().clone(),
        events,
    }
}

impl EscapeRig {
    fn draw(&self, cx: &mut TestAppContext) {
        cx.update_window(self.window, |_, window, cx| {
            window.render_frame(cx);
        })
        .expect("window");
        cx.run_until_parked();
    }
}

#[gpui_kit::test]
fn escape_in_thread_closes_it_when_nothing_else_is_open(cx: &mut TestAppContext) {
    let rig = escape_rig(cx, false);
    let focus = cx.update(|cx| rig.list.read(cx).focus_handle().clone());
    rig.draw(cx);
    cx.update_window(rig.window, |_, window, cx| window.focus(&focus, cx))
        .expect("window");
    rig.draw(cx);
    cx.simulate_keystrokes(rig.window, "escape");
    rig.draw(cx);
    assert_eq!(rig.events.borrow().as_slice(), [ThreadPaneEvent::Close]);
}

#[gpui_kit::test]
fn escape_in_thread_composer_reply_cancels_reply_first(cx: &mut TestAppContext) {
    let rig = escape_rig(cx, true);
    let composer = rig.composer.clone().expect("a composer");
    rig.draw(cx);
    cx.update_window(rig.window, |_, window, cx| {
        composer.update(cx, |composer, cx| {
            composer.set_reply(
                Some(ReplyTarget {
                    message_id: "p-1".into(),
                    author_name: "Ava Chen".into(),
                    snippet: "the parent".into(),
                }),
                window,
                cx,
            )
        })
    })
    .expect("window");
    rig.draw(cx);

    // The composer's own Escape cancels the reply, and the pane hears nothing of that press. A
    // thread composer draws no reply banner (replies are the channel composer's), so the proof is
    // the pane staying open for it and closing on the next press.
    cx.simulate_keystrokes(rig.window, "escape");
    rig.draw(cx);
    assert!(
        rig.events.borrow().is_empty(),
        "the reply took the Escape, not the pane"
    );
    cx.simulate_keystrokes(rig.window, "escape");
    rig.draw(cx);
    assert_eq!(rig.events.borrow().as_slice(), [ThreadPaneEvent::Close]);
}
