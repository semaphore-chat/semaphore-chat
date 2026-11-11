//! The pane's header and states through real clicks.

use super::*;
// `gpui_kit::*` brings GPUI's `test` attribute in too, and it would win.
use core::prelude::v1::test;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{AnyWindowHandle, Bounds, Point, TestAppContext, WindowBounds, WindowOptions, size};
use semaphore_core::model::ErrorView;
use std::cell::RefCell;
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
