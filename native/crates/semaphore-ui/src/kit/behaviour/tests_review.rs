//! Regression tests from the reviews of #889: the reviewers' probes, turned into assertions, and
//! the cases they found uncovered (focus without a forced frame, typeahead timers, an ancestor
//! Escape binding, presses across two layers, a controlled popover that refuses).
use super::{BehaviourRoot, screen_focus_target};
use crate::dms::rig::{Rig, rig};
use crate::kit::{Button, Dialog, Menu, MenuItem, Placement, Popover, PopoverPanel, Sheet};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestEventExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_design::lounge::MOTION_TYPEAHEAD_MS;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

type Log = Rc<RefCell<Vec<String>>>;
actions!(probe_review, [ProbeEscape]);

struct Probe {
    log: Log,
    opener: FocusHandle,
    target: FocusHandle,
    sink: FocusHandle,
    inner: FocusHandle,
    use_sink: bool,
    sheet: bool,
    dialog: bool,
    menu: bool,
    free_menu: bool,
    flat_dialog: bool,
    pops: bool,
    controlled: bool,
    ctx: bool,
}
impl EventEmitter<()> for Probe {}

fn push(log: &Log, what: impl Into<String>) {
    log.borrow_mut().push(what.into());
}

impl Render for Probe {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        screen_focus_target("probe-target", &self.target, window, cx);
        let view = cx.weak_entity();
        let mk_menu = |id: &'static str, log: Log, view: WeakEntity<Probe>| {
            Menu::new(
                "m",
                [
                    MenuItem::new("copy", "Copy", |_, _| {}),
                    MenuItem::new("cut", "Cut", |_, _| {}),
                    MenuItem::new("pin", "Pin", |_, _| {}),
                ],
            )
            .id(id)
            .on_close(move |reason, _, cx| {
                push(&log, format!("{id}:{reason:?}"));
                view.update(cx, |p, cx| {
                    p.menu = false;
                    p.free_menu = false;
                    cx.notify();
                })
                .ok();
            })
        };
        let nested_menu = self
            .menu
            .then(|| mk_menu("nm", self.log.clone(), view.clone()));
        let (dlog, dview) = (self.log.clone(), view.clone());
        let nested_dialog = self.dialog.then(|| {
            Dialog::new("nd", "Nested dialog")
                .body(div().children(nested_menu))
                .action(Button::new("nd-ok", "OK"))
                .on_request_close(move |reason, _, cx| {
                    push(&dlog, format!("dialog:{reason:?}"));
                    dview
                        .update(cx, |p, cx| {
                            p.dialog = false;
                            cx.notify();
                        })
                        .ok();
                })
        });
        let (slog, sview) = (self.log.clone(), view.clone());
        let sheet = self.sheet.then(|| {
            Sheet::new("ns", "Sheet")
                .body(div().child("body").children(nested_dialog))
                .on_request_close(move |reason, _, cx| {
                    push(&slog, format!("sheet:{reason:?}"));
                    sview
                        .update(cx, |p, cx| {
                            p.sheet = false;
                            cx.notify();
                        })
                        .ok();
                })
        });
        let (flog, fview) = (self.log.clone(), view.clone());
        let flat_dialog = self.flat_dialog.then(|| {
            Dialog::new("fd", "Flat dialog")
                .action(Button::new("fd-ok", "OK"))
                .on_request_close(move |reason, _, cx| {
                    push(&flog, format!("flat:{reason:?}"));
                    fview
                        .update(cx, |p, cx| {
                            p.flat_dialog = false;
                            cx.notify();
                        })
                        .ok();
                })
        });
        let free_menu = self
            .free_menu
            .then(|| mk_menu("fm", self.log.clone(), view.clone()));
        let (alog, blog, clog, ulog) = (
            self.log.clone(),
            self.log.clone(),
            self.log.clone(),
            self.log.clone(),
        );
        let pops = self.pops.then(|| {
            div()
                .flex()
                .gap(px(300.))
                .child(
                    Popover::new("pa")
                        .placement(Placement::BottomStart)
                        .trigger_element(Button::new("pa-trigger", "A"))
                        .on_open_change(move |open, _, _| push(&alog, format!("a:{open}")))
                        .content(|_, _| PopoverPanel::new("A").child(Button::new("a-in", "a"))),
                )
                .child(
                    Popover::new("pb")
                        .placement(Placement::BottomStart)
                        .default_open(true)
                        .trigger_element(Button::new("pb-trigger", "B"))
                        .on_open_change(move |open, _, _| push(&blog, format!("b:{open}")))
                        .content(|_, _| PopoverPanel::new("B").child(Button::new("b-in", "b"))),
                )
        });
        let inner = self.inner.clone();
        let controlled = self.controlled.then(|| {
            Popover::new("pc")
                .placement(Placement::BottomStart)
                .open(true)
                .trigger_element(Button::new("pc-trigger", "C"))
                // The owner refuses: it never changes `open`.
                .on_open_change(move |open, _, _| push(&clog, format!("c:{open}")))
                .content(move |_, _| {
                    PopoverPanel::new("C").child(
                        div()
                            .id("inner")
                            .test_support()
                            .track_focus(&inner)
                            .size(px(20.)),
                    )
                })
        });
        let klog = self.log.clone();
        let body = div()
            .id("probe-page")
            .size_full()
            .when(self.ctx, |page| {
                page.key_context("ProbeCtx")
                    .on_action(move |_: &ProbeEscape, _, _| push(&klog, "ancestor-binding"))
            })
            .when(self.use_sink, |page| page.track_focus(&self.sink))
            .child(
                div()
                    .id("target")
                    .test_support()
                    .track_focus(&self.target)
                    .size(px(10.)),
            )
            .child(
                div()
                    .id("opener")
                    .test_support()
                    .track_focus(&self.opener)
                    .size(px(40.)),
            )
            .child(
                div()
                    .id("under")
                    .test_support()
                    .size(px(40.))
                    .on_click(move |_, _, _| push(&ulog, "under-clicked")),
            )
            .child(div().pl(px(100.)).children(pops))
            .child(div().pl(px(100.)).children(controlled))
            .children(free_menu.map(|m| div().absolute().top(px(300.)).left(px(300.)).child(m)))
            .children(flat_dialog)
            .children(sheet);
        if self.use_sink {
            BehaviourRoot::new(body)
                .focus_sink(&self.sink)
                .into_any_element()
        } else {
            BehaviourRoot::new(body).into_any_element()
        }
    }
}

fn probe(cx: &mut TestAppContext) -> (Rig<Probe, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, cx| Probe {
        log: shared,
        opener: cx.focus_handle(),
        target: cx.focus_handle(),
        sink: cx.focus_handle(),
        inner: cx.focus_handle(),
        use_sink: false,
        sheet: false,
        dialog: false,
        menu: false,
        free_menu: false,
        flat_dialog: false,
        pops: false,
        controlled: false,
        ctx: false,
    });
    (rig, log)
}

fn set(rig: &Rig<Probe, ()>, cx: &mut TestAppContext, f: impl FnOnce(&mut Probe)) {
    rig.with(cx, |view, _, cx| {
        view.update(cx, |p, cx| {
            f(p);
            cx.notify();
        })
    });
    rig.with(cx, |_, _, _| {});
}
fn key(rig: &Rig<Probe, ()>, cx: &mut TestAppContext, k: &str) {
    rig.with(cx, |_, window, _| window.activate_window());
    rig.with(cx, |_, window, cx| window.press(k, cx));
    rig.with(cx, |_, _, _| {});
}
fn click_at(rig: &Rig<Probe, ()>, cx: &mut TestAppContext, at: Point<Pixels>) {
    rig.with(cx, |_, window, cx| {
        window.pointer_down(at, MouseButton::Left, cx)
    });
    rig.with(cx, |_, window, cx| {
        window.pointer_up(at, MouseButton::Left, cx)
    });
    rig.with(cx, |_, _, _| {});
}
fn now_focused(rig: &Rig<Probe, ()>, cx: &mut TestAppContext) -> Option<FocusHandle> {
    rig.with(cx, |_, window, cx| window.focused(cx))
}
fn logs(log: &Log) -> Vec<String> {
    log.borrow().clone()
}

fn focus_opener(rig: &Rig<Probe, ()>, cx: &mut TestAppContext) {
    rig.with(cx, |v, window, cx| {
        let h = v.read(cx).opener.clone();
        window.focus(&h, cx);
    });
}

fn opener_focused(rig: &Rig<Probe, ()>, cx: &mut TestAppContext) -> bool {
    rig.with(cx, |v, window, cx| v.read(cx).opener.is_focused(window))
}

#[gpui_kit::test]
fn escape_closes_menu_dialog_sheet_in_order_and_focus_walks_back(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    focus_opener(&rig, cx);
    set(&rig, cx, |p| p.sheet = true);
    let in_sheet = now_focused(&rig, cx);
    set(&rig, cx, |p| p.dialog = true);
    let in_dialog = now_focused(&rig, cx);
    set(&rig, cx, |p| p.menu = true);
    key(&rig, cx, "escape");
    assert_eq!(logs(&log), ["nm:Escape"]);
    assert_eq!(now_focused(&rig, cx), in_dialog);
    key(&rig, cx, "escape");
    assert_eq!(now_focused(&rig, cx), in_sheet);
    key(&rig, cx, "escape");
    assert_eq!(logs(&log), ["nm:Escape", "dialog:Escape", "sheet:Escape"]);
    assert!(opener_focused(&rig, cx));
}

#[gpui_kit::test]
fn closing_the_sheet_closes_what_it_holds_and_focus_goes_to_its_opener(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    focus_opener(&rig, cx);
    set(&rig, cx, |p| p.sheet = true);
    set(&rig, cx, |p| p.dialog = true);
    set(&rig, cx, |p| p.menu = true);
    set(&rig, cx, |p| p.sheet = false);
    assert_eq!(logs(&log), ["nm:ParentClosed", "dialog:ParentClosed"]);
    assert!(opener_focused(&rig, cx));
}

#[gpui_kit::test]
fn a_press_outside_a_menu_does_not_reach_the_control_under_it(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    set(&rig, cx, |p| p.free_menu = true);
    let under = rig.with(cx, |_, window, _| window.find("under").bounds());
    click_at(&rig, cx, under.center());
    assert_eq!(
        logs(&log),
        ["fm:PressOutside"],
        "rule 8: it goes no further"
    );
    click_at(&rig, cx, under.center());
    assert_eq!(
        logs(&log),
        ["fm:PressOutside", "under-clicked"],
        "with the menu gone, it does"
    );
}

#[gpui_kit::test]
fn a_press_on_another_popovers_trigger_closes_the_open_one(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    set(&rig, cx, |p| p.pops = true);
    let a = rig.with(cx, |_, window, _| window.find("pa-trigger").bounds());
    click_at(&rig, cx, a.center());
    assert_eq!(
        logs(&log),
        ["b:false", "a:true"],
        "rule 7: B closes, A opens"
    );
    assert!(!rig.has(cx, "b-in"));
    assert!(rig.has(cx, "a-in"));
}

#[gpui_kit::test]
fn a_controlled_popover_that_refuses_keeps_focus_where_it_is(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    set(&rig, cx, |p| p.controlled = true);
    rig.with(cx, |v, window, cx| {
        let h = v.read(cx).inner.clone();
        window.focus(&h, cx);
    });
    rig.with(cx, |_, _, _| {});
    key(&rig, cx, "escape");
    assert_eq!(logs(&log), ["c:false"], "asked");
    assert!(rig.has(cx, "inner"), "refused: still open");
    assert!(
        rig.with(cx, |v, window, cx| v.read(cx).inner.is_focused(window)),
        "focus stays in the field"
    );
}

#[gpui_kit::test]
fn focus_parked_on_the_sink_is_no_opener(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    set(&rig, cx, |p| p.use_sink = true);
    rig.with(cx, |v, window, cx| {
        let h = v.read(cx).sink.clone();
        window.focus(&h, cx);
    });
    set(&rig, cx, |p| p.flat_dialog = true);
    key(&rig, cx, "escape");
    assert_eq!(logs(&log), ["flat:Escape"]);
    assert!(
        rig.with(cx, |v, window, cx| v.read(cx).target.is_focused(window)),
        "restoreFocus{{to: null}}: the screen's focus target"
    );
}

#[gpui_kit::test]
fn a_press_on_empty_page_returns_focus_to_the_opener(cx: &mut TestAppContext) {
    for sink in [false, true] {
        for which in ["popover", "menu"] {
            let (rig, log) = probe(cx);
            set(&rig, cx, |p| p.use_sink = sink);
            focus_opener(&rig, cx);
            if which == "popover" {
                set(&rig, cx, |p| p.pops = true);
            } else {
                set(&rig, cx, |p| p.free_menu = true);
            }
            assert!(!opener_focused(&rig, cx), "{which}: focus moved in");
            click_at(&rig, cx, point(px(850.), px(550.)));
            assert_eq!(
                logs(&log).len(),
                1,
                "{which}: closed once: {:?}",
                logs(&log)
            );
            assert!(
                opener_focused(&rig, cx),
                "{which} (sink {sink}): focus back on the opener"
            );
        }
    }
}

#[gpui_kit::test]
fn an_ancestor_escape_binding_does_not_take_the_key_from_an_open_layer(cx: &mut TestAppContext) {
    cx.update(|cx| cx.bind_keys([KeyBinding::new("escape", ProbeEscape, Some("ProbeCtx"))]));
    for which in ["popover", "menu", "dialog"] {
        let (rig, log) = probe(cx);
        set(&rig, cx, |p| p.ctx = true);
        focus_opener(&rig, cx);
        match which {
            "popover" => set(&rig, cx, |p| p.pops = true),
            "menu" => set(&rig, cx, |p| p.free_menu = true),
            _ => set(&rig, cx, |p| p.flat_dialog = true),
        }
        key(&rig, cx, "escape");
        let expected = match which {
            "popover" => "b:false",
            "menu" => "fm:Escape",
            _ => "flat:Escape",
        };
        assert_eq!(logs(&log), [expected], "{which}");
        key(&rig, cx, "escape");
        assert_eq!(
            logs(&log),
            [expected, "ancestor-binding"],
            "{which}: with the layer gone, the ancestor's binding has it"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// No forced frame: keys dispatched straight to the window, as the platform does.

fn raw_key(rig: &Rig<Probe, ()>, cx: &mut TestAppContext, key: &'static str) {
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
        window.dispatch_event(KeyUpEvent { keystroke }.to_platform_input(), cx);
    })
    .unwrap();
    cx.run_until_parked();
}

fn raw_set(rig: &Rig<Probe, ()>, cx: &mut TestAppContext, f: impl FnOnce(&mut Probe)) {
    cx.update_window(rig.window, |_, _, cx| {
        rig.view.update(cx, |p, cx| {
            f(p);
            cx.notify();
        })
    })
    .unwrap();
    cx.run_until_parked();
}

fn raw_opener_focused(rig: &Rig<Probe, ()>, cx: &mut TestAppContext) -> bool {
    cx.update_window(rig.window, |_, window, cx| {
        rig.view.read(cx).opener.is_focused(window)
    })
    .unwrap()
}

#[gpui_kit::test]
fn a_menu_opened_again_returns_focus_on_escape_with_no_forced_frame(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    rig.with(cx, |_, window, _| window.activate_window());
    focus_opener(&rig, cx);
    // The first Menu of an app binds its keys, which redraws the window: open it once first.
    raw_set(&rig, cx, |p| p.free_menu = true);
    raw_key(&rig, cx, "escape");
    assert!(raw_opener_focused(&rig, cx));
    raw_set(&rig, cx, |p| p.free_menu = true);
    raw_key(&rig, cx, "escape");
    assert_eq!(logs(&log), ["fm:Escape", "fm:Escape"]);
    assert!(raw_opener_focused(&rig, cx), "back on the opener");
}

#[gpui_kit::test]
fn a_menu_opened_again_returns_focus_on_a_choice_with_no_forced_frame(cx: &mut TestAppContext) {
    let (rig, log) = probe(cx);
    rig.with(cx, |_, window, _| window.activate_window());
    focus_opener(&rig, cx);
    raw_set(&rig, cx, |p| p.free_menu = true);
    raw_key(&rig, cx, "escape");
    raw_set(&rig, cx, |p| p.free_menu = true);
    raw_key(&rig, cx, "enter");
    assert_eq!(logs(&log), ["fm:Escape", "fm:Selected"]);
    assert!(raw_opener_focused(&rig, cx), "back on the opener");
}

// ---------------------------------------------------------------------------------------------
// Typeahead timers

fn item_focused(rig: &Rig<Probe, ()>, cx: &mut TestAppContext, id: &'static str) -> bool {
    rig.with(cx, move |_, window, _| {
        window.find(id).focused() == Some(true)
    })
}

#[gpui_kit::test]
fn the_typeahead_prefix_clears_after_its_time(cx: &mut TestAppContext) {
    let (rig, _) = probe(cx);
    set(&rig, cx, |p| p.free_menu = true);
    key(&rig, cx, "p");
    assert!(item_focused(&rig, cx, "pin"));
    cx.executor()
        .advance_clock(Duration::from_millis(u64::from(MOTION_TYPEAHEAD_MS) + 50));
    key(&rig, cx, "c");
    assert!(
        item_focused(&rig, cx, "copy"),
        "a new prefix once the timer fired (\"pc\" would match nothing)"
    );
}

#[gpui_kit::test]
fn letters_typed_inside_the_time_make_one_prefix(cx: &mut TestAppContext) {
    let (rig, _) = probe(cx);
    set(&rig, cx, |p| p.free_menu = true);
    // Focus starts on Copy: "c" goes on to the next item that starts with it.
    key(&rig, cx, "c");
    assert!(item_focused(&rig, cx, "cut"));
    cx.executor().advance_clock(Duration::from_millis(100));
    key(&rig, cx, "o");
    assert!(
        item_focused(&rig, cx, "copy"),
        "\"co\": one prefix (\"o\" alone would match nothing)"
    );
}
