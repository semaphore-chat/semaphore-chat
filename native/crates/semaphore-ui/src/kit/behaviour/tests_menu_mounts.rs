//! A menu item whose action mounts a view and moves focus into it (the header's More opening
//! the search or pins panel): the menu's layer closes as the view appears, and focus stays where
//! the action put it, with no frame forced between the two.
use super::BehaviourRoot;
use crate::dms::rig::{Rig, rig};
use crate::kit::{Menu, MenuItem};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestEventExt as _, TestWindowExt as _};
use gpui_kit::*;

/// The view the item mounts: a panel with a control that takes focus.
struct Mounted {
    focus: FocusHandle,
}

impl Render for Mounted {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().id("mounted").child(
            div()
                .id("mounted-field")
                .test_support()
                .track_focus(&self.focus)
                .size(px(20.)),
        )
    }
}

#[derive(Clone)]
enum PageEvent {
    Open,
}

struct Page {
    opener: FocusHandle,
    menu: bool,
    mounted: Option<Entity<Mounted>>,
    _subscription: Option<Subscription>,
}

impl EventEmitter<PageEvent> for Page {}

impl Render for Page {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (open, close) = (cx.weak_entity(), cx.weak_entity());
        let menu = self.menu.then(|| {
            Menu::new(
                "More",
                [MenuItem::new("open", "Open", move |_, cx| {
                    // As the shell's More does: the menu closes and the owner is asked, by an
                    // event, for the view.
                    open.update(cx, |page, cx| {
                        page.menu = false;
                        cx.emit(PageEvent::Open);
                        cx.notify();
                    })
                    .ok();
                })],
            )
            .id("more")
            .on_close(move |_, _, cx| {
                close
                    .update(cx, |page, cx| {
                        page.menu = false;
                        cx.notify();
                    })
                    .ok();
            })
        });
        BehaviourRoot::new(
            div()
                .id("page")
                .size_full()
                .child(
                    div()
                        .id("opener")
                        .test_support()
                        .track_focus(&self.opener)
                        .size(px(40.)),
                )
                .child(div().relative().children(menu.map(|menu| {
                    // As the shell draws More's menu: deferred, anchored to its button.
                    deferred(anchored().child(div().occlude().child(menu))).with_priority(1)
                })))
                .children(self.mounted.clone()),
        )
    }
}

fn page(cx: &mut TestAppContext) -> Rig<Page, PageEvent> {
    let rig = rig(cx, 900., |window, cx| {
        let subscription = cx.subscribe_in(
            &cx.entity(),
            window,
            |page: &mut Page, _, event: &PageEvent, window, cx| match event {
                PageEvent::Open => {
                    let mounted = cx.new(|cx| Mounted {
                        focus: cx.focus_handle(),
                    });
                    let focus = mounted.read(cx).focus.clone();
                    page.mounted = Some(mounted);
                    window.focus(&focus, cx);
                    cx.notify();
                }
            },
        );
        Page {
            opener: cx.focus_handle(),
            menu: false,
            mounted: None,
            _subscription: Some(subscription),
        }
    });
    rig.with(cx, |_, window, _| window.activate_window());
    rig
}

fn update(
    rig: &Rig<Page, PageEvent>,
    cx: &mut TestAppContext,
    f: impl FnOnce(&mut Page, &mut Window),
) {
    cx.update_window(rig.window, |_, window, cx| {
        rig.view.update(cx, |page, cx| {
            f(page, window);
            cx.notify();
        })
    })
    .unwrap();
    cx.run_until_parked();
}

fn raw_key(rig: &Rig<Page, PageEvent>, cx: &mut TestAppContext, key: &'static str) {
    let keystroke = Keystroke::parse(key).unwrap();
    cx.update_window(rig.window, |_, window, cx| {
        window.dispatch_event(
            KeyDownEvent {
                keystroke: keystroke.clone(),
                is_held: false,
                prefer_character_input: false,
            }
            .to_platform_input(),
            cx,
        );
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(rig.window, |_, window, cx| {
        window.dispatch_event(KeyUpEvent { keystroke }.to_platform_input(), cx);
    })
    .unwrap();
    cx.run_until_parked();
}

fn mounted_focused(rig: &Rig<Page, PageEvent>, cx: &mut TestAppContext) -> bool {
    cx.update_window(rig.window, |_, window, cx| {
        rig.view
            .read(cx)
            .mounted
            .as_ref()
            .is_some_and(|mounted| mounted.read(cx).focus.is_focused(window))
    })
    .unwrap()
}

fn opener_focused(rig: &Rig<Page, PageEvent>, cx: &mut TestAppContext) -> bool {
    cx.update_window(rig.window, |_, window, cx| {
        rig.view.read(cx).opener.is_focused(window)
    })
    .unwrap()
}

#[gpui_kit::test]
fn a_menu_item_that_mounts_a_view_and_focuses_it_keeps_that_focus(cx: &mut TestAppContext) {
    let rig = page(cx);
    cx.update_window(rig.window, |_, window, cx| {
        let opener = rig.view.read(cx).opener.clone();
        window.focus(&opener, cx);
    })
    .unwrap();
    cx.run_until_parked();
    // The first Menu of an app binds its keys, which redraws the window: open it once first.
    update(&rig, cx, |page, _| page.menu = true);
    raw_key(&rig, cx, "escape");
    assert!(opener_focused(&rig, cx), "Escape: back on the opener");

    update(&rig, cx, |page, _| page.menu = true);
    raw_key(&rig, cx, "enter");
    assert!(rig.view.read_with(cx, |page, _| page.mounted.is_some()));
    assert!(
        mounted_focused(&rig, cx),
        "focus stays in the view the item mounted, not back on the opener"
    );
    // And it stays there through frames that have nothing to do with it.
    for _ in 0..4 {
        update(&rig, cx, |_, _| {});
    }
    assert!(mounted_focused(&rig, cx), "still there after later frames");
}

fn raw_click(rig: &Rig<Page, PageEvent>, cx: &mut TestAppContext, id: &'static str) {
    let at = cx
        .update_window(rig.window, |_, window, _| window.find(id).bounds().center())
        .unwrap();
    cx.update_window(rig.window, |_, window, cx| {
        window.pointer_down(at, MouseButton::Left, cx)
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(rig.window, |_, window, cx| {
        window.pointer_up(at, MouseButton::Left, cx)
    })
    .unwrap();
    cx.run_until_parked();
}

#[gpui_kit::test]
fn a_clicked_menu_item_that_mounts_a_view_and_focuses_it_keeps_that_focus(cx: &mut TestAppContext) {
    let rig = page(cx);
    cx.update_window(rig.window, |_, window, cx| {
        let opener = rig.view.read(cx).opener.clone();
        window.focus(&opener, cx);
    })
    .unwrap();
    cx.run_until_parked();
    update(&rig, cx, |page, _| page.menu = true);
    raw_key(&rig, cx, "escape");
    update(&rig, cx, |page, _| page.menu = true);
    raw_click(&rig, cx, "open");
    assert!(rig.view.read_with(cx, |page, _| page.mounted.is_some()));
    assert!(
        mounted_focused(&rig, cx),
        "focus stays in the view the item mounted, not back on the opener"
    );
    for _ in 0..4 {
        update(&rig, cx, |_, _| {});
    }
    assert!(mounted_focused(&rig, cx), "still there after later frames");
}
