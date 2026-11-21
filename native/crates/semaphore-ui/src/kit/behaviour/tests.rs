//! GPUI tests of the behaviour hosts: the overlay stack's Escape order, presses, `parentClosed`
//! and focus return through real kit pieces under a [`BehaviourRoot`], the kit Popover on
//! gpui-kit's positioner, the list-focus pieces, and the announcer.

use super::{BehaviourRoot, Politeness, announce, screen_escape, screen_focus_target};
use crate::dms::rig::{Rig, rig};
use crate::kit::{
    ANCHOR_GAP, Button, Dialog, Menu, MenuItem, Placement, Popover, PopoverPanel, Sheet,
};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestEventExt as _, TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use std::cell::RefCell;
use std::rc::Rc;

type Log = Rc<RefCell<Vec<String>>>;

/// A screen with an opener, a screen focus target and the overlays a test switches on.
struct Bench {
    log: Log,
    opener: FocusHandle,
    target: FocusHandle,
    field: FocusHandle,
    hosted: bool,
    show_opener: bool,
    dialog: bool,
    sheet: bool,
    menu_in_dialog: bool,
    menu: bool,
    popover: bool,
    refuse: bool,
}

impl EventEmitter<()> for Bench {}

fn push(log: &Log, what: impl Into<String>) {
    log.borrow_mut().push(what.into());
}

impl Bench {
    fn menu(&self, id: &'static str, cx: &mut Context<Self>) -> Menu {
        let view = cx.weak_entity();
        let log = self.log.clone();
        Menu::new(
            "Bench menu",
            [
                MenuItem::new("pin", "Pin", |_, _| {}),
                MenuItem::new("copy", "Copy", |_, _| {}),
            ],
        )
        .id(id)
        .on_close(move |reason, _, cx| {
            push(&log, format!("{id}:{reason:?}"));
            view.update(cx, |bench, cx| {
                if id == "inner-menu" {
                    bench.menu_in_dialog = false;
                } else {
                    bench.menu = false;
                }
                cx.notify();
            })
            .ok();
        })
    }
}

impl Render for Bench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let log = self.log.clone();
        screen_escape(
            "bench-escape",
            10,
            move |_, _| {
                push(&log, "screen");
                true
            },
            window,
            cx,
        );
        screen_focus_target("bench-target", &self.target, window, cx);
        let view = cx.weak_entity();
        let (log, refuse) = (self.log.clone(), self.refuse);
        let field_log = self.log.clone();
        let inner = self.menu_in_dialog.then(|| self.menu("inner-menu", cx));
        let outer = self.menu.then(|| self.menu("outer-menu", cx));
        let dialog = self.dialog.then(|| {
            Dialog::new("bench-dialog", "Bench dialog")
                .body(
                    div()
                        .child(
                            div()
                                .id("field")
                                .test_support()
                                .track_focus(&self.field)
                                .size(px(20.))
                                // A control that uses Escape itself (an open suggestion list).
                                .on_key_down(move |event, _, cx| {
                                    if event.keystroke.key == "escape" {
                                        cx.stop_propagation();
                                        push(&field_log, "field");
                                    }
                                }),
                        )
                        .children(inner),
                )
                .action(Button::new("dialog-ok", "OK"))
                .on_request_close(move |reason, _, cx| {
                    push(&log, format!("dialog:{reason:?}"));
                    if !refuse {
                        view.update(cx, |bench, cx| {
                            bench.dialog = false;
                            cx.notify();
                        })
                        .ok();
                    }
                })
        });
        let sheet_view = cx.weak_entity();
        let sheet_log = self.log.clone();
        let sheet = self.sheet.then(|| {
            Sheet::new("bench-sheet", "Bench sheet")
                .body(div().child("Sheet body"))
                .on_request_close(move |reason, _, cx| {
                    push(&sheet_log, format!("sheet:{reason:?}"));
                    sheet_view
                        .update(cx, |bench, cx| {
                            bench.sheet = false;
                            cx.notify();
                        })
                        .ok();
                })
        });
        let pop_log = self.log.clone();
        let popover = self.popover.then(|| {
            Popover::new("bench-popover")
                .placement(Placement::BottomStart)
                .default_open(true)
                .trigger_element(Button::new("pop-trigger", "Colour"))
                .on_open_change(move |open, _, _| push(&pop_log, format!("popover:{open}")))
                .content(|_, _| PopoverPanel::new("Colours").child(Button::new("swatch", "Purple")))
        });
        let body = div()
            .size_full()
            .child(
                div()
                    .id("target")
                    .test_support()
                    .track_focus(&self.target)
                    .size(px(10.)),
            )
            .when(self.show_opener, |page| {
                page.child(
                    div()
                        .id("opener")
                        .test_support()
                        .track_focus(&self.opener)
                        .size(px(40.)),
                )
            })
            .child(div().id("outside").test_support().size(px(40.)))
            .child(div().pl(px(200.)).children(popover))
            .children(outer.map(|menu| div().absolute().top(px(300.)).left(px(300.)).child(menu)))
            .children(dialog)
            .children(sheet);
        if self.hosted {
            BehaviourRoot::new(body).into_any_element()
        } else {
            body.into_any_element()
        }
    }
}

fn bench(cx: &mut TestAppContext, hosted: bool) -> (Rig<Bench, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, cx| Bench {
        log: shared,
        opener: cx.focus_handle(),
        target: cx.focus_handle(),
        field: cx.focus_handle(),
        hosted,
        show_opener: true,
        dialog: false,
        sheet: false,
        menu_in_dialog: false,
        menu: false,
        popover: false,
        refuse: false,
    });
    (rig, log)
}

fn set(rig: &Rig<Bench, ()>, cx: &mut TestAppContext, f: impl FnOnce(&mut Bench)) {
    rig.with(cx, |view, _, cx| {
        view.update(cx, |bench, cx| {
            f(bench);
            cx.notify();
        })
    });
    // A layer that closed reports it after its frame.
    rig.with(cx, |_, _, _| {});
}

fn press(rig: &Rig<Bench, ()>, cx: &mut TestAppContext, key: &str) {
    rig.with(cx, |_, window, _| window.activate_window());
    rig.with(cx, |_, window, cx| window.press(key, cx));
    rig.with(cx, |_, _, _| {});
}

fn focused(
    rig: &Rig<Bench, ()>,
    cx: &mut TestAppContext,
    pick: fn(&Bench) -> &FocusHandle,
) -> bool {
    rig.with(cx, |view, window, cx| {
        pick(view.read(cx)).is_focused(window)
    })
}

fn focus_opener(rig: &Rig<Bench, ()>, cx: &mut TestAppContext) {
    rig.with(cx, |view, window, cx| {
        let opener = view.read(cx).opener.clone();
        window.focus(&opener, cx);
    });
}

fn log_of(log: &Log) -> Vec<String> {
    log.borrow().clone()
}

#[gpui_kit::test]
fn escape_closes_one_layer_at_a_time_topmost_first_then_reaches_the_screen(
    cx: &mut TestAppContext,
) {
    let (rig, log) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.dialog = true);
    set(&rig, cx, |bench| bench.menu_in_dialog = true);
    assert!(rig.has(cx, "inner-menu"));

    press(&rig, cx, "escape");
    assert_eq!(
        log_of(&log),
        ["inner-menu:Escape"],
        "the menu above the dialog first"
    );
    assert!(rig.has(cx, "dialog-panel"), "one layer per Escape");
    assert!(
        !focused(&rig, cx, |b| &b.opener),
        "focus stays in the dialog"
    );

    press(&rig, cx, "escape");
    assert_eq!(log_of(&log), ["inner-menu:Escape", "dialog:Escape"]);
    assert!(!rig.has(cx, "dialog-panel"));
    assert!(
        focused(&rig, cx, |b| &b.opener),
        "focus went back to what had it when the dialog opened"
    );

    press(&rig, cx, "escape");
    assert_eq!(
        log_of(&log),
        ["inner-menu:Escape", "dialog:Escape", "screen"],
        "with nothing open, the screen's Escape chain"
    );
}

#[gpui_kit::test]
fn a_focused_control_that_uses_escape_has_it_first(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    set(&rig, cx, |bench| bench.dialog = true);
    rig.with(cx, |view, window, cx| {
        let field = view.read(cx).field.clone();
        window.focus(&field, cx);
    });
    press(&rig, cx, "escape");
    assert_eq!(log_of(&log), ["field"]);
    assert!(rig.has(cx, "dialog-panel"), "the stack never saw it");
}

#[gpui_kit::test]
fn a_refused_close_leaves_the_layer_open(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    set(&rig, cx, |bench| {
        bench.refuse = true;
        bench.dialog = true;
    });
    press(&rig, cx, "escape");
    press(&rig, cx, "escape");
    assert_eq!(log_of(&log), ["dialog:Escape", "dialog:Escape"]);
    assert!(rig.has(cx, "dialog-panel"));
}

#[gpui_kit::test]
fn a_layer_closes_with_the_layer_it_was_opened_in(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.dialog = true);
    set(&rig, cx, |bench| bench.menu_in_dialog = true);
    // The owner closes the dialog itself (its own button, a route change).
    set(&rig, cx, |bench| bench.dialog = false);
    assert_eq!(
        log_of(&log),
        ["inner-menu:ParentClosed"],
        "the menu's owner is told, so it renders closed"
    );
    assert!(
        !rig.with(cx, |view, _, cx| view.read(cx).menu_in_dialog),
        "the owner closed the menu"
    );
    assert!(
        focused(&rig, cx, |b| &b.opener),
        "focus back on the dialog's opener"
    );
}

#[gpui_kit::test]
fn focus_goes_to_the_screen_target_when_the_opener_has_gone(cx: &mut TestAppContext) {
    let (rig, _) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.dialog = true);
    set(&rig, cx, |bench| bench.show_opener = false);
    // A frame for the opener's handle to go with the element that drew it.
    rig.with(cx, |_, _, _| {});
    press(&rig, cx, "escape");
    assert!(!rig.has(cx, "dialog-panel"));
    assert!(
        focused(&rig, cx, |b| &b.target),
        "the screen's focus target"
    );
}

#[gpui_kit::test]
fn focus_is_never_restored_beneath_a_dialog_that_is_still_open(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.menu = true);
    // A choice in the menu opens a dialog as the menu closes.
    set(&rig, cx, |bench| {
        bench.menu = false;
        bench.dialog = true;
    });
    assert!(log_of(&log).is_empty());
    assert!(
        !focused(&rig, cx, |b| &b.opener),
        "the menu's opener is under the dialog: focus stays in the dialog"
    );
    press(&rig, cx, "escape");
    assert!(
        focused(&rig, cx, |b| &b.opener),
        "the dialog's own close returns it"
    );
}

fn centre(bounds: Bounds<Pixels>) -> Point<Pixels> {
    bounds.center()
}

fn click_at(rig: &Rig<Bench, ()>, cx: &mut TestAppContext, at: Point<Pixels>) {
    rig.with(cx, |_, window, cx| {
        window.pointer_down(at, MouseButton::Left, cx)
    });
    rig.with(cx, |_, window, cx| {
        window.pointer_up(at, MouseButton::Left, cx)
    });
    rig.with(cx, |_, _, _| {});
}

#[gpui_kit::test]
fn a_press_outside_a_menu_closes_it(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    set(&rig, cx, |bench| bench.menu = true);
    let menu = rig.with(cx, |_, window, _| window.find("outer-menu").bounds());
    // In the menu's padding, between no items.
    click_at(&rig, cx, menu.origin + point(px(2.), px(2.)));
    assert!(log_of(&log).is_empty(), "a press inside is not outside");
    let outside = rig.with(cx, |_, window, _| window.find("outside").bounds());
    click_at(&rig, cx, centre(outside));
    assert_eq!(log_of(&log), ["outer-menu:PressOutside"]);
    assert!(!rig.has(cx, "outer-menu"));
}

#[gpui_kit::test]
fn a_press_on_the_scrim_closes_a_dialog_but_a_drag_out_of_it_does_not(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    set(&rig, cx, |bench| bench.dialog = true);
    let panel = rig.with(cx, |_, window, _| window.find("dialog-panel").bounds());
    let scrim = point(px(4.), px(4.));
    rig.with(cx, |_, window, cx| {
        window.pointer_down(centre(panel), MouseButton::Left, cx)
    });
    rig.with(cx, |_, window, cx| {
        window.pointer_up(scrim, MouseButton::Left, cx)
    });
    rig.with(cx, |_, _, _| {});
    assert!(
        log_of(&log).is_empty(),
        "down in the panel, up on the scrim: no press"
    );
    rig.with(cx, |_, window, cx| {
        window.pointer_down(scrim, MouseButton::Right, cx)
    });
    rig.with(cx, |_, window, cx| {
        window.pointer_up(scrim, MouseButton::Right, cx)
    });
    assert!(log_of(&log).is_empty(), "a right press closes nothing");
    click_at(&rig, cx, scrim);
    assert_eq!(log_of(&log), ["dialog:Scrim"]);
}

#[gpui_kit::test]
fn a_sheet_is_a_layer_too(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.sheet = true);
    press(&rig, cx, "escape");
    assert_eq!(log_of(&log), ["sheet:Escape"]);
    assert!(focused(&rig, cx, |b| &b.opener));
}

#[gpui_kit::test]
fn tab_in_a_menu_on_the_stack_closes_it_and_focus_goes_back(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.menu = true);
    assert!(!focused(&rig, cx, |b| &b.opener), "the menu took focus");
    press(&rig, cx, "tab");
    assert_eq!(log_of(&log), ["outer-menu:Tab"]);
    assert!(
        focused(&rig, cx, |b| &b.opener),
        "back on the opener, not moved on"
    );
}

#[gpui_kit::test]
fn a_menu_choice_returns_focus_through_the_stack(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.menu = true);
    rig.click(cx, "copy");
    rig.with(cx, |_, _, _| {});
    assert_eq!(log_of(&log), ["outer-menu:Selected"]);
    assert!(focused(&rig, cx, |b| &b.opener));
}

#[gpui_kit::test]
fn without_a_host_the_pieces_keep_their_own_handling(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, false);
    set(&rig, cx, |bench| bench.dialog = true);
    press(&rig, cx, "escape");
    assert_eq!(log_of(&log), ["dialog:Escape"]);
    press(&rig, cx, "escape");
    assert_eq!(
        log_of(&log),
        ["dialog:Escape"],
        "no screen chain without a host"
    );
}

// ---------------------------------------------------------------------------------------------
// The kit Popover on gpui-kit's `Popup` positioner. These pin what the kit takes from gpui-kit,
// so a gpui-kit bump that changes it fails here.

#[gpui_kit::test]
fn the_popover_opens_below_its_trigger_one_gap_away_lined_up_at_the_start(cx: &mut TestAppContext) {
    let (rig, _) = bench(cx, true);
    set(&rig, cx, |bench| bench.popover = true);
    let (trigger, panel) = rig.with(cx, |_, window, _| {
        (
            window.find("pop-trigger").bounds(),
            window.find("popover-panel").bounds(),
        )
    });
    assert_eq!(panel.origin.x, trigger.origin.x, "lined up at the start");
    assert_eq!(
        panel.origin.y,
        trigger.bottom() + px(ANCHOR_GAP),
        "one gap below the trigger"
    );
}

#[gpui_kit::test]
fn the_popover_takes_focus_and_closes_on_escape_through_the_stack(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    focus_opener(&rig, cx);
    set(&rig, cx, |bench| bench.popover = true);
    assert!(
        !focused(&rig, cx, |b| &b.opener),
        "focus moved into the popover"
    );
    press(&rig, cx, "escape");
    assert_eq!(log_of(&log), ["popover:false"]);
    assert!(!rig.has(cx, "popover-panel"));
    assert!(focused(&rig, cx, |b| &b.opener), "back on its opener");
}

#[gpui_kit::test]
fn a_press_on_the_popovers_trigger_is_inside_and_toggles_it(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, true);
    set(&rig, cx, |bench| bench.popover = true);
    let trigger = rig.with(cx, |_, window, _| window.find("pop-trigger").bounds());
    click_at(&rig, cx, centre(trigger));
    assert_eq!(
        log_of(&log),
        ["popover:false"],
        "closed once, by the trigger"
    );
    click_at(&rig, cx, centre(trigger));
    assert_eq!(log_of(&log), ["popover:false", "popover:true"]);
    let outside = rig.with(cx, |_, window, _| window.find("outside").bounds());
    click_at(&rig, cx, centre(outside));
    assert_eq!(
        log_of(&log),
        ["popover:false", "popover:true", "popover:false"],
        "a press outside closes it"
    );
}

#[gpui_kit::test]
fn without_a_host_the_popover_closes_on_escape_and_a_press_outside_itself(cx: &mut TestAppContext) {
    let (rig, log) = bench(cx, false);
    set(&rig, cx, |bench| bench.popover = true);
    press(&rig, cx, "escape");
    assert_eq!(log_of(&log), ["popover:false"]);
    let trigger = rig.with(cx, |_, window, _| window.find("pop-trigger").bounds());
    click_at(&rig, cx, centre(trigger));
    let outside = rig.with(cx, |_, window, _| window.find("outside").bounds());
    click_at(&rig, cx, centre(outside));
    assert_eq!(
        log_of(&log),
        ["popover:false", "popover:true", "popover:false"]
    );
}

// ---------------------------------------------------------------------------------------------
// The announcer

struct Speaking {
    hosted: bool,
}

impl EventEmitter<()> for Speaking {}

impl Render for Speaking {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let body =
            div()
                .size_full()
                .child(
                    div()
                        .id("say")
                        .test_support()
                        .size(px(40.))
                        .on_click(|_, window, cx| {
                            announce("Joined Squad Up", Politeness::Polite, window, cx)
                        }),
                );
        if self.hosted {
            BehaviourRoot::new(body).into_any_element()
        } else {
            body.into_any_element()
        }
    }
}

#[gpui_kit::test]
fn an_announcement_is_a_new_live_node_each_time_even_with_the_same_text(cx: &mut TestAppContext) {
    let rig: Rig<Speaking, ()> = rig(cx, 600., |_, _| Speaking { hosted: true });
    let statuses = |rig: &Rig<Speaking, ()>, cx: &mut TestAppContext| {
        rig.with(cx, |_, window, _| {
            window
                .find_all_by_role(Role::Status)
                .iter()
                .map(|node| {
                    (
                        node.path().last().cloned(),
                        node.label().map(str::to_owned),
                        node.value().map(str::to_owned),
                    )
                })
                .collect::<Vec<_>>()
        })
    };
    assert!(
        statuses(&rig, cx).is_empty(),
        "nothing before the first announcement"
    );
    rig.click(cx, "say");
    let first = statuses(&rig, cx);
    assert_eq!(first.len(), 1);
    assert_eq!(
        first[0].1.as_deref(),
        Some("Joined Squad Up"),
        "the name AT-SPI and UIA read"
    );
    assert_eq!(
        first[0].2.as_deref(),
        Some("Joined Squad Up"),
        "the value macOS reads"
    );
    rig.click(cx, "say");
    let second = statuses(&rig, cx);
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].0, second[0].0, "a new node, so it is read again");
}

#[gpui_kit::test]
fn without_a_host_an_announcement_does_nothing(cx: &mut TestAppContext) {
    let rig: Rig<Speaking, ()> = rig(cx, 600., |_, _| Speaking { hosted: false });
    rig.click(cx, "say");
    let found = rig.with(cx, |_, window, _| {
        window.find_all_by_role(Role::Status).len()
    });
    assert_eq!(found, 0);
}
