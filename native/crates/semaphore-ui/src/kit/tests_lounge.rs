//! The surface context, Island, Card, Dock and Sheet: the layer each piece hands its children,
//! the GPUI render order the context relies on, the naming rules, the dock's scroll arithmetic
//! and keyboard, and the sheet's focus, close reasons and two layouts.

use super::{
    Button, Card, CountMeaning, Dialog, Dock, DockDivider, DockEntry, DockItem, IconButton, Island,
    ListRow, PopoverPanel, Sheet, SheetCloseReason, Surface, SurfaceScope, Toast, card_name,
    dock_fades, dock_item_name, reveal_scroll, sheet_is_bottom,
};
use crate::dms::rig::{Rig, rig, rig_sized};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_design::Icon as I;
use std::cell::RefCell;
use std::rc::Rc;

type Log = Rc<RefCell<Vec<String>>>;
type Body = Box<dyn Fn(&Log, &mut Window, &mut App) -> AnyElement>;

struct Host {
    body: Body,
    log: Log,
}

impl EventEmitter<()> for Host {}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().size_full().child((self.body)(&self.log, window, cx))
    }
}

fn host_sized(
    cx: &mut TestAppContext,
    width: f32,
    height: f32,
    body: impl Fn(&Log, &mut Window, &mut App) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig_sized(cx, width, height, move |_, _| Host {
        body: Box::new(body),
        log: shared,
    });
    (rig, log)
}

fn host(
    cx: &mut TestAppContext,
    body: impl Fn(&Log) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, _| Host {
        body: Box::new(move |log, _, _| body(log)),
        log: shared,
    });
    (rig, log)
}

fn press(rig: &Rig<Host, ()>, cx: &mut TestAppContext, key: &str) {
    rig.with(cx, |_, window, _| window.activate_window());
    rig.with(cx, |_, window, cx| window.press(key, cx));
}

/// Records the layer it renders on, under its name; once per name, so re-renders don't repeat.
#[derive(IntoElement)]
struct Probe {
    name: &'static str,
    log: Log,
}

fn probe(name: &'static str, log: &Log) -> Probe {
    Probe {
        name,
        log: log.clone(),
    }
}

impl RenderOnce for Probe {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let line = format!("{} {:?}", self.name, Surface::current(cx));
        let mut log = self.log.borrow_mut();
        if !log
            .iter()
            .any(|known| known.starts_with(&format!("{} ", self.name)))
        {
            log.push(line);
        }
        div().w(px(4.)).h(px(4.))
    }
}

/// A probe that is an entity view (`Render`), not a component.
struct ProbeView {
    log: Log,
}

impl Render for ProbeView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        probe("view", &self.log)
    }
}

fn logged(log: &Log, name: &str) -> String {
    log.borrow()
        .iter()
        .find(|line| line.starts_with(&format!("{name} ")))
        .cloned()
        .unwrap_or_else(|| format!("{name} not rendered"))
}

// ---------------------------------------------------------------------------------------------
// The context

/// Pins the GPUI behaviour the context is built on: a component, an entity view and a deferred
/// (anchored) child all render while their ancestor's scope is pushed, nested scopes override,
/// and the stack is empty once the frame is drawn.
#[gpui_kit::test]
fn children_render_inside_their_scope_during_request_layout(cx: &mut TestAppContext) {
    let view: Rc<RefCell<Option<Entity<ProbeView>>>> = Rc::default();
    let slot = view.clone();
    let (rig, log) = host_sized(cx, 600., 400., move |log, _, cx| {
        let view = slot
            .borrow_mut()
            .get_or_insert_with(|| cx.new(|_| ProbeView { log: log.clone() }))
            .clone();
        div()
            .child(probe("outside", log))
            .child(SurfaceScope::new(
                Surface::Fill,
                div()
                    .child(probe("component", log))
                    .child(div().child(div().child(probe("nested-div", log))))
                    .child(view)
                    .child(deferred(anchored().child(probe("deferred", log))))
                    .child(SurfaceScope::new(Surface::Accent, probe("inner", log)))
                    .child(probe("after-inner", log)),
            ))
            .child(probe("after", log))
            .into_any_element()
    });
    rig.with(cx, |_, _, _| {});
    for (name, layer) in [
        ("outside", "Ground"),
        ("component", "Fill"),
        ("nested-div", "Fill"),
        ("view", "Fill"),
        ("deferred", "Fill"),
        ("inner", "Accent"),
        ("after-inner", "Fill"),
        ("after", "Ground"),
    ] {
        assert_eq!(logged(&log, name), format!("{name} {layer}"));
    }
    cx.update(|cx| {
        assert_eq!(
            Surface::current(cx),
            Surface::Ground,
            "the stack is empty after the frame"
        )
    });
}

#[gpui_kit::test]
fn each_piece_hands_its_children_the_right_layer(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log| {
        div()
            .child(
                Island::new("island")
                    .child(probe("island", log))
                    .child(
                        Card::new("card")
                            .child(probe("card", log))
                            .child(Card::new("card-in-card").child(probe("card-in-card", log))),
                    )
                    .child(
                        ListRow::new("row", "general")
                            .selected(true)
                            .trailing(probe("selected-row", log)),
                    )
                    .child(ListRow::new("row-2", "random").trailing(probe("row", log))),
            )
            .child(Card::new("ground-card").child(probe("ground-card", log)))
            .child(
                Card::new("popover-card")
                    .child(PopoverPanel::new("Options").child(probe("popover", log))),
            )
            .child(
                Card::new("toast-card")
                    .child(Toast::new("toast", "Saved").action("Undo", |_, _| {})),
            )
            .child(
                Dock::new("dock", "Communities")
                    .item(DockItem::new("a", "Alpha"))
                    .end(DockEntry::button(
                        "all",
                        IconButton::new("all", I::Settings, "All"),
                    )),
            )
            .into_any_element()
    });
    rig.with(cx, |_, _, _| {});
    for (name, layer) in [
        ("island", "Surface"),
        ("card", "Fill"),
        ("card-in-card", "Surface"),
        ("selected-row", "Accent"),
        ("row", "Surface"),
        ("ground-card", "Fill"),
        ("popover", "Surface"),
    ] {
        assert_eq!(logged(&log, name), format!("{name} {layer}"));
    }
}

#[gpui_kit::test]
fn a_dialog_opened_from_a_card_resets_to_the_surface(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log| {
        Card::new("card")
            .child(probe("card", log))
            .child(Dialog::new("from-card", "Leave?").body(probe("dialog", log)))
            .into_any_element()
    });
    rig.with(cx, |_, _, _| {});
    assert_eq!(logged(&log, "card"), "card Fill");
    assert_eq!(logged(&log, "dialog"), "dialog Surface");
}

#[gpui_kit::test]
fn a_pieces_own_layer_wins_over_the_scope(cx: &mut TestAppContext) {
    cx.update(|cx| {
        assert_eq!(
            Surface::or_current(Some(Surface::Accent), cx),
            Surface::Accent
        );
        assert_eq!(Surface::or_current(None, cx), Surface::Ground);
    });
    assert_eq!(Surface::Fill.inside_fill(), Surface::Surface);
    for on in [Surface::Ground, Surface::Surface, Surface::Accent] {
        assert_eq!(on.inside_fill(), Surface::Fill);
    }
}

// ---------------------------------------------------------------------------------------------
// Island and Card

#[gpui_kit::test]
fn an_island_is_the_landmark_it_is_given_and_named(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_| {
        div()
            .child(Island::new("nav").nav("Channels"))
            .child(Island::new("aside").aside("Members"))
            .child(Island::new("main").main(None))
            .child(Island::new("region").region("Pinned"))
            .child(Island::new("plain"))
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert_eq!(
            window.find_by_label("Channels").role(),
            Some(Role::Navigation)
        );
        assert_eq!(
            window.find_by_label("Members").role(),
            Some(Role::Complementary)
        );
        assert_eq!(window.find_by_label("Pinned").role(), Some(Role::Region));
        assert_eq!(window.find_all_by_role(Role::Main).len(), 1);
        assert_eq!(window.find("plain").role(), None);
    });
}

#[gpui_kit::test]
fn an_island_footer_stays_put_while_the_body_scrolls(cx: &mut TestAppContext) {
    let (rig, _) = host_sized(cx, 400., 300., |_, _, _| {
        div()
            .h(px(300.))
            .child(
                Island::new("island")
                    .scroll(true)
                    .footer(Some(
                        div()
                            .id("foot")
                            .test_support()
                            .h(px(40.))
                            .into_any_element(),
                    ))
                    .children((0..30).map(|n| div().h(px(40.)).child(format!("row {n}")))),
            )
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        let island = window.find("island").bounds();
        let foot = window.find("foot").bounds();
        assert!(
            island.size.height <= px(300.),
            "the island fits its parent: {island:?}"
        );
        assert!(
            foot.bottom() <= island.bottom(),
            "the foot is inside the island"
        );
        assert!(
            foot.top() > island.top() + px(100.),
            "the foot is at the island's foot"
        );
    });
}

#[test]
fn a_cards_name_says_current_when_selected() {
    assert_eq!(
        card_name(Some("Squad Up"), true).as_deref(),
        Some("Squad Up, current")
    );
    assert_eq!(
        card_name(Some("Squad Up"), false).as_deref(),
        Some("Squad Up")
    );
    assert_eq!(card_name(None, true).as_deref(), Some("current"));
    assert_eq!(card_name(None, false), None);
}

#[gpui_kit::test]
fn a_clickable_card_is_one_named_button(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log| {
        let log = log.clone();
        Card::new("lobby")
            .label("Lobby")
            .selected(true)
            .on_click(move |_, _| log.borrow_mut().push("lobby".into()))
            .child("Lobby")
            .into_any_element()
    });
    rig.with(cx, |_, window, _| {
        assert!(window.try_find_by_label("Lobby, current").is_some());
    });
    rig.click(cx, "lobby");
    assert_eq!(*log.borrow(), ["lobby"]);
}

// ---------------------------------------------------------------------------------------------
// Dock

#[test]
fn a_dock_items_name_says_everything_the_picture_shows() {
    let u = CountMeaning::Unread;
    let m = CountMeaning::Mentions;
    let cases = [
        (("Couch Co-op", false, 0, u, false, false), "Couch Co-op"),
        (
            ("Couch Co-op", true, 0, u, false, false),
            "Couch Co-op, current",
        ),
        (
            ("Couch Co-op", false, 3, u, false, false),
            "Couch Co-op, 3 unread",
        ),
        (
            ("Couch Co-op", false, 1, m, false, false),
            "Couch Co-op, 1 mention",
        ),
        (
            ("Couch Co-op", false, 2, m, false, false),
            "Couch Co-op, 2 mentions",
        ),
        (
            ("Couch Co-op", false, 0, u, true, false),
            "Couch Co-op, new messages",
        ),
        // The count wins over the dot.
        (
            ("Couch Co-op", false, 4, u, true, false),
            "Couch Co-op, 4 unread",
        ),
        (
            ("Couch Co-op", false, 0, u, false, true),
            "Couch Co-op, reconnecting",
        ),
        (
            ("Couch Co-op", true, 2, m, true, true),
            "Couch Co-op, current, 2 mentions, reconnecting",
        ),
    ];
    for ((name, current, unread, meaning, new, reconnecting), want) in cases {
        assert_eq!(
            dock_item_name(name, current, unread, meaning, new, reconnecting),
            want
        );
    }
}

#[test]
fn reveal_scrolls_only_as_far_as_it_must_with_room_for_the_fade() {
    let fade = 24.;
    // In view already, with room: nothing.
    assert_eq!(reveal_scroll(100., 144., 0., 400., 1000., fade), None);
    // Past the end: its end plus the fade meets the view's end.
    assert_eq!(reveal_scroll(500., 544., 0., 400., 1000., fade), Some(168.));
    // Before the start: its start less the fade meets the view's start.
    assert_eq!(
        reveal_scroll(300., 344., 400., 400., 1000., fade),
        Some(276.)
    );
    // Never before 0 nor past the largest scroll.
    assert_eq!(reveal_scroll(10., 54., 200., 400., 1000., fade), Some(0.));
    assert_eq!(
        reveal_scroll(1390., 1434., 0., 400., 1000., fade),
        Some(1000.)
    );
    // Within the fade at an edge counts as not in view.
    assert_eq!(reveal_scroll(370., 390., 0., 400., 1000., fade), Some(14.));
}

#[test]
fn an_edge_fades_only_when_there_is_more_beyond_it() {
    assert_eq!(dock_fades(0., 0.), (false, false));
    assert_eq!(dock_fades(0., 300.), (false, true));
    assert_eq!(dock_fades(150., 300.), (true, true));
    assert_eq!(dock_fades(300., 300.), (true, false));
}

fn dock(current: usize, log: &Log) -> AnyElement {
    let item = |n: usize| {
        let log = log.clone();
        DockItem::new(format!("c{n}"), format!("Community {n}"))
            .current(n == current)
            .on_click(move |_, _| log.borrow_mut().push(format!("c{n}")))
    };
    div()
        .w(px(480.))
        .child(
            Dock::new("dock", "Communities")
                .start(DockEntry::button(
                    "inbox",
                    IconButton::new("inbox", I::Notifications, "Inbox").on_click({
                        let log = log.clone();
                        move |_, _, _| log.borrow_mut().push("inbox".into())
                    }),
                ))
                .start(DockDivider)
                .items((0..30).map(item))
                .end(DockEntry::button(
                    "all",
                    IconButton::new("all", I::GridView, "All"),
                )),
        )
        .into_any_element()
}

#[gpui_kit::test]
fn a_dock_brings_the_current_item_into_view(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |log| dock(25, log));
    for _ in 0..3 {
        rig.with(cx, |_, _, _| {});
    }
    rig.with(cx, |_, window, _| {
        let view = window.find("dock-scroll").bounds();
        let item = window.find("dock-item-c25").bounds();
        assert!(
            item.left() >= view.left() && item.right() <= view.right(),
            "{item:?} in {view:?}"
        );
        assert!(window.try_find_by_label("Community 25, current").is_some());
    });
}

#[gpui_kit::test]
fn a_dock_is_one_tab_stop_moved_through_with_the_arrows(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log| {
        div()
            .child(dock(2, log))
            .child(Button::new("after", "After").on_click({
                let log = log.clone();
                move |_, _, _| log.borrow_mut().push("after".into())
            }))
            .into_any_element()
    });
    rig.click(cx, "dock-item-c2");
    assert_eq!(*log.borrow(), ["c2"]);
    press(&rig, cx, "right");
    press(&rig, cx, "enter");
    press(&rig, cx, "home");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["c2", "c3", "inbox"]);
    press(&rig, cx, "end");
    press(&rig, cx, "left");
    press(&rig, cx, "enter");
    assert_eq!(log.borrow().last().map(String::as_str), Some("c29"));
    // Tab leaves the bar: no other entry of it is a stop.
    press(&rig, cx, "tab");
    press(&rig, cx, "enter");
    assert_eq!(log.borrow().last().map(String::as_str), Some("after"));
}

// ---------------------------------------------------------------------------------------------
// Sheet

fn sheet(actions: bool, log: &Log) -> AnyElement {
    let close = log.clone();
    let mut sheet = Sheet::new("all-communities", "All communities")
        .body(div().child("Couch Co-op"))
        .on_request_close(move |reason, _, _| close.borrow_mut().push(format!("{reason:?}")));
    if actions {
        sheet = sheet
            .action(Button::new("sheet-cancel", "Cancel").ghost().on_click({
                let log = log.clone();
                move |_, _, _| log.borrow_mut().push("cancel".into())
            }))
            .action(Button::new("sheet-join", "Join").primary());
    }
    sheet.into_any_element()
}

#[gpui_kit::test]
fn a_sheet_without_actions_starts_on_close(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log| sheet(false, log));
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), [format!("{:?}", SheetCloseReason::Button)]);
}

#[gpui_kit::test]
fn a_sheet_with_actions_starts_on_the_first(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log| sheet(true, log));
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["cancel"]);
}

#[gpui_kit::test]
fn escape_and_the_scrim_ask_a_sheet_to_close(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, |log| sheet(true, log));
    press(&rig, cx, "escape");
    rig.with(cx, |_, window, cx| {
        window.click_at("dialog-scrim", point(px(5.), px(5.)), cx)
    });
    assert_eq!(
        *log.borrow(),
        [
            format!("{:?}", SheetCloseReason::Escape),
            format!("{:?}", SheetCloseReason::Scrim)
        ]
    );
}

#[gpui_kit::test]
fn a_sheet_is_centred_when_wide_and_a_bottom_sheet_when_narrow(cx: &mut TestAppContext) {
    assert!(sheet_is_bottom(px(390.)));
    assert!(!sheet_is_bottom(px(1280.)));
    let (wide, _) = host_sized(cx, 1280., 720., |log, _, _| sheet(true, log));
    wide.with(cx, |_, window, _| {
        let panel = window.find("sheet-panel").bounds();
        assert_eq!(panel.size.width, px(560.));
        assert!(
            panel.bottom() < px(720.),
            "centred, not at the edge: {panel:?}"
        );
        assert!(window.try_find_by_label("All communities").is_some());
    });
    let (narrow, _) = host_sized(cx, 390., 844., |log, _, _| sheet(true, log));
    narrow.with(cx, |_, window, _| {
        let panel = window.find("sheet-panel").bounds();
        assert_eq!(panel.size.width, px(390.));
        assert_eq!(panel.bottom(), px(844.));
        assert_eq!(panel.left(), px(0.));
    });
}
