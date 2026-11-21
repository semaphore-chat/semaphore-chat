//! ListRow, Table, Menu, Popover, Dialog and Tooltip: their paint from the roles, their naming
//! rule, and the events they report.

use super::lists::{LineTone, RowPaint, line_tone, row_name};
use super::overlays::{MenuKey, menu_key, state_over};
use super::{
    Button, Dialog, DialogCloseReason, ListRow, Menu, MenuCloseReason, MenuEntry, MenuItem,
    Placement, Popover, PopoverExt, PopoverPadding, PopoverPanel, Table, TableColumn, TableRow,
    with_tip,
};
use crate::dms::rig::{Rig, rig};
use crate::theme::color::hsla_of;
use crate::theme::{Sem, ThemeInput};
use core::prelude::v1::test;
use gpui_kit::prelude::*;
use gpui_kit::test::{TestQueryExt as _, TestWindowExt as _};
use gpui_kit::*;
use semaphore_design::behaviour::list_focus::Event as ListEvent;
use semaphore_design::lounge::{STATE_HOVER, STATE_HOVER_ON_FILL};
use semaphore_design::{Intensity, Mode};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

fn sems() -> Vec<Sem> {
    let mut all = Vec::new();
    for base in [0x8e75ffffu32, 0x0d9488ff, 0xff0000ff, 0x808080ff] {
        for mode in Mode::ALL {
            for intensity in Intensity::ALL {
                all.push(Sem::new(ThemeInput::new(
                    semaphore_design::Rgba(base),
                    mode,
                    intensity,
                )));
            }
        }
    }
    all
}

#[test]
fn a_rows_name_is_its_lines_with_the_state_after_the_primary() {
    assert_eq!(
        row_name("clips", None, None, true, Some("2 mentions")),
        ("clips, unread, 2 mentions".into(), None)
    );
    assert_eq!(
        row_name(
            "Samira",
            Some("keeping the server warm"),
            None,
            false,
            Some("admin")
        ),
        ("Samira, admin, keeping the server warm".into(), None)
    );
    assert_eq!(
        row_name("general", None, None, false, None),
        ("general".into(), None)
    );
}

#[test]
fn a_label_replaces_the_lines_and_the_secondary_describes() {
    assert_eq!(
        row_name(
            "Squad Up",
            Some("Muted"),
            Some("Open call view, Squad Up"),
            false,
            None
        ),
        ("Open call view, Squad Up".into(), Some("Muted".to_owned()))
    );
    assert_eq!(
        row_name("x", None, Some("Open x"), true, Some("3 mentions")),
        ("Open x, unread, 3 mentions".into(), None)
    );
}

#[test]
fn selected_keeps_the_on_accent_ink_whatever_else_is_set() {
    assert_eq!(line_tone(true, true, true), LineTone::Row);
    assert_eq!(line_tone(false, true, true), LineTone::Dim);
    assert_eq!(line_tone(false, false, true), LineTone::Strong);
    assert_eq!(line_tone(false, false, false), LineTone::Row);
}

#[test]
fn a_row_paints_from_the_roles() {
    for sem in sems() {
        let plain = RowPaint::of(&sem, false, false, false);
        assert_eq!(plain.background, None);
        assert_eq!(plain.ink, sem.role.text_secondary);
        assert_eq!(plain.primary, sem.role.text_secondary);
        assert_eq!(plain.ring, sem.role.focus);
        assert_eq!(
            plain.hover,
            state_over(&sem, sem.roles.surface, STATE_HOVER)
        );

        let unread = RowPaint::of(&sem, false, true, false);
        assert_eq!(unread.primary, sem.role.text);
        assert_eq!(unread.secondary, sem.role.text_secondary);

        let muted = RowPaint::of(&sem, false, true, true);
        assert_eq!(muted.primary, sem.role.text_dim);
        assert_eq!(muted.secondary, sem.role.text_dim);

        let selected = RowPaint::of(&sem, true, true, true);
        assert_eq!(selected.background, Some(sem.role.accent));
        assert_eq!(selected.primary, sem.role.on_accent);
        assert_eq!(selected.secondary, sem.role.on_accent);
        // A ring in the focus colour would vanish into the accent.
        assert_eq!(selected.ring, sem.role.on_accent);
        assert_eq!(
            selected.hover,
            state_over(&sem, sem.roles.accent, STATE_HOVER_ON_FILL)
        );
        // Opaque: a state colour is a mix, not a translucent tint.
        assert_eq!(selected.hover.a, 1.);
        assert_eq!(plain.pressed.a, 1.);
    }
}

#[test]
fn the_state_mix_is_the_text_role_over_what_is_under() {
    let sem = Sem::default();
    assert_eq!(
        state_over(&sem, sem.roles.surface, 0.),
        hsla_of(sem.roles.surface)
    );
    assert_eq!(
        state_over(&sem, sem.roles.surface, 1.),
        hsla_of(sem.roles.text)
    );
}

fn key(text: &'static str) -> Keystroke {
    Keystroke::parse(text).expect("keystroke")
}

#[test]
fn the_menu_key_map_is_the_webs() {
    assert_eq!(
        menu_key(&key("escape"), false),
        Some(MenuKey::Close(MenuCloseReason::Escape))
    );
    // Tab is the menu's key binding, ahead of the window's focus move (see the drawn tests).
    assert_eq!(menu_key(&key("tab"), false), None);
    assert_eq!(
        menu_key(&key("up"), false),
        Some(MenuKey::Move(ListEvent::Up))
    );
    assert_eq!(
        menu_key(&key("down"), false),
        Some(MenuKey::Move(ListEvent::Down))
    );
    assert_eq!(
        menu_key(&key("home"), false),
        Some(MenuKey::Move(ListEvent::Home))
    );
    assert_eq!(
        menu_key(&key("end"), false),
        Some(MenuKey::Move(ListEvent::End))
    );
    assert_eq!(
        menu_key(&key("d"), false),
        Some(MenuKey::Move(ListEvent::Type { char: 'd' }))
    );
    // Space chooses (the item's own button) unless a prefix is being typed.
    assert_eq!(menu_key(&key("space"), false), None);
    assert_eq!(
        menu_key(&key("space"), true),
        Some(MenuKey::Move(ListEvent::Type { char: ' ' }))
    );
    // Enter is the item's; shortcuts with modifiers are the app's.
    assert_eq!(menu_key(&key("enter"), false), None);
    assert_eq!(menu_key(&key("ctrl-d"), false), None);
}

#[test]
fn placements_meet_the_anchor_at_the_matching_corner() {
    assert_eq!(Placement::default(), Placement::BottomStart);
    assert_eq!(Placement::BottomStart.anchor(), Anchor::TopLeft);
    assert_eq!(Placement::BottomEnd.anchor(), Anchor::TopRight);
    assert_eq!(Placement::TopStart.anchor(), Anchor::BottomLeft);
    assert_eq!(Placement::TopEnd.anchor(), Anchor::BottomRight);
    assert_eq!(PopoverPadding::None.px(), 0.);
    assert_eq!(PopoverPadding::Md.px(), 12.);
    assert_eq!(PopoverPadding::Lg.px(), 16.);
}

// ---------------------------------------------------------------------------------------------
// Drawn

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

fn host(
    cx: &mut TestAppContext,
    body: impl Fn(&Log) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    host_in(cx, move |log, _, _| body(log))
}

/// A host whose body also gets the window, for focus handles and element state.
fn host_in(
    cx: &mut TestAppContext,
    body: impl Fn(&Log, &mut Window, &mut App) -> AnyElement + 'static,
) -> (Rig<Host, ()>, Log) {
    let log: Log = Rc::default();
    let shared = log.clone();
    let rig = rig(cx, 900., move |_, _| Host {
        body: Box::new(body),
        log: shared,
    });
    (rig, log)
}

fn record(log: &Log, what: impl Into<String>) -> impl Fn(&mut Window, &mut App) + 'static {
    let log = log.clone();
    let what = what.into();
    move |_, _| log.borrow_mut().push(what.clone())
}

fn press(rig: &Rig<Host, ()>, cx: &mut TestAppContext, key: &str) {
    rig.with(cx, |_, window, _| window.activate_window());
    rig.with(cx, |_, window, cx| window.press(key, cx));
}

fn menu(log: &Log) -> AnyElement {
    let close = log.clone();
    let entries: Vec<MenuEntry> = vec![
        MenuItem::new("reply", "Reply", record(log, "reply"))
            .shortcut(["R"])
            .into(),
        MenuItem::new("pin", "Pin message", record(log, "pin"))
            .disabled(true)
            .into(),
        MenuItem::new("copy", "Copy link", record(log, "copy")).into(),
        MenuEntry::divider("d1"),
        MenuItem::new("delete", "Delete message", record(log, "delete"))
            .destructive()
            .into(),
    ];
    Menu::new("Message options", entries)
        .on_close(move |reason, _, _| close.borrow_mut().push(format!("close {reason:?}")))
        .into_any_element()
}

#[gpui_kit::test]
fn a_menu_focuses_its_first_item_and_enter_chooses_it(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu);
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["reply", "close Selected"]);
}

#[gpui_kit::test]
fn down_skips_a_disabled_item_and_wraps(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu);
    press(&rig, cx, "down");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["copy", "close Selected"]);
    log.borrow_mut().clear();
    press(&rig, cx, "down");
    press(&rig, cx, "down");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["reply", "close Selected"], "wrapped round");
}

#[gpui_kit::test]
fn up_from_the_first_item_wraps_to_the_last_and_home_goes_back(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu);
    press(&rig, cx, "up");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["delete", "close Selected"]);
    log.borrow_mut().clear();
    press(&rig, cx, "end");
    press(&rig, cx, "home");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["reply", "close Selected"]);
}

#[gpui_kit::test]
fn typing_jumps_to_the_item_that_starts_with_it(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu);
    press(&rig, cx, "d");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["delete", "close Selected"]);
}

#[gpui_kit::test]
fn escape_and_tab_ask_to_close_without_choosing(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu);
    press(&rig, cx, "escape");
    press(&rig, cx, "tab");
    assert_eq!(*log.borrow(), ["close Escape", "close Tab"]);
}

#[gpui_kit::test]
fn a_press_on_a_disabled_item_does_nothing(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu);
    rig.click(cx, "pin");
    assert!(log.borrow().is_empty());
    rig.click(cx, "copy");
    assert_eq!(*log.borrow(), ["copy", "close Selected"]);
}

#[gpui_kit::test]
fn a_menu_is_named_and_has_the_menu_role(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, menu);
    rig.with(cx, |_, window, _| {
        assert!(window.try_find("menu").is_some());
        assert!(window.try_find_by_label("Message options").is_some());
    });
}

fn dialog(log: &Log) -> AnyElement {
    let close = log.clone();
    Dialog::new("Delete #memes?")
        .description("This removes the channel for everyone.")
        .action(Button::new("dialog-cancel", "Cancel").on_click({
            let log = log.clone();
            move |_, _, _| log.borrow_mut().push("cancel".into())
        }))
        .action(Button::new("dialog-delete", "Delete channel").on_click({
            let log = log.clone();
            move |_, _, _| log.borrow_mut().push("delete".into())
        }))
        .on_request_close(move |reason, _, _| close.borrow_mut().push(format!("{reason:?}")))
        .into_any_element()
}

#[gpui_kit::test]
fn a_dialog_starts_on_its_first_action(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, dialog);
    press(&rig, cx, "enter");
    assert_eq!(
        *log.borrow(),
        ["cancel"],
        "a stray Enter does the safe thing"
    );
}

#[gpui_kit::test]
fn escape_asks_a_dialog_to_close_and_says_why(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, dialog);
    press(&rig, cx, "escape");
    assert_eq!(*log.borrow(), [format!("{:?}", DialogCloseReason::Escape)]);
}

#[gpui_kit::test]
fn a_dialog_is_named_by_its_title(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, dialog);
    rig.with(cx, |_, window, _| {
        assert!(window.try_find("dialog-panel").is_some());
        assert!(window.try_find_by_label("Delete #memes?").is_some());
    });
}

fn rows(log: &Log) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .child(ListRow::new("general", "general").on_click(record(log, "general")))
        .child(
            ListRow::new("staff", "staff")
                .disabled(true)
                .on_click(record(log, "staff")),
        )
        .child(
            ListRow::new("lfg", "lfg")
                .busy(true)
                .on_click(record(log, "lfg")),
        )
        .child(
            ListRow::new("clips", "clips")
                .unread(true)
                .trailing_label("2 mentions")
                .on_click(record(log, "clips")),
        )
        .child(ListRow::new("plain", "Plain content"))
        .into_any_element()
}

#[gpui_kit::test]
fn a_row_with_on_click_is_a_button_and_disabled_or_busy_ignore_presses(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, rows);
    for id in ["general", "staff", "lfg", "clips"] {
        rig.click(cx, id);
    }
    assert_eq!(*log.borrow(), ["general", "clips"]);
}

#[gpui_kit::test]
fn a_row_says_its_state_in_its_name(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, rows);
    rig.with(cx, |_, window, _| {
        assert!(
            window
                .try_find_by_label("clips, unread, 2 mentions")
                .is_some()
        );
        assert!(window.try_find_by_label("Plain content").is_some());
    });
}

fn table(rows: bool) -> impl Fn(&Log) -> AnyElement {
    move |_| {
        let columns = vec![
            TableColumn::new("member", "Member"),
            TableColumn::new("joined", "Joined").align(super::Align::End),
        ];
        let body = if rows {
            vec![
                TableRow::new("aiko")
                    .text("member", "aiko")
                    .text("joined", "2026-01-12"),
            ]
        } else {
            Vec::new()
        };
        Table::new("Members", columns, body)
            .empty("No members match that search")
            .into_any_element()
    }
}

#[gpui_kit::test]
fn a_table_is_named_and_shows_its_cells(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, table(true));
    rig.with(cx, |_, window, _| {
        assert!(window.try_find("table").is_some());
        assert!(window.try_find_by_label("Members").is_some());
        assert!(window.try_find("table-empty").is_none());
        assert!(window.try_find_by_label("aiko").is_some(), "a text cell");
        assert!(
            window.try_find_by_label("2026-01-12").is_some(),
            "an end-aligned cell"
        );
    });
}

#[gpui_kit::test]
fn an_empty_table_says_so(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, table(false));
    rig.with(cx, |_, window, _| {
        assert!(window.try_find("table-empty").is_some());
    });
}

// ---------------------------------------------------------------------------------------------
// Overlays together, and the review's cases

/// A dialog holding a menu, as the call bar's "Call options": with `owned`, the menu has an
/// owner that closes the dialog on Escape (and logs every reason).
fn menu_in_dialog(owned: bool) -> impl Fn(&Log) -> AnyElement {
    move |log| {
        let mut menu = Menu::new(
            "Call options",
            vec![
                MenuItem::new("share", "Share screen", record(log, "share")),
                MenuItem::new("settings", "Voice settings", record(log, "settings")),
            ],
        );
        if owned {
            let close = log.clone();
            menu = menu
                .on_close(move |reason, _, _| close.borrow_mut().push(format!("menu {reason:?}")));
        }
        let dialog_log = log.clone();
        Dialog::new("Call options")
            .body(menu)
            .action(Button::new("more-done", "Close").on_click({
                let log = log.clone();
                move |_, _, _| log.borrow_mut().push("close".into())
            }))
            .on_request_close(move |reason, _, _| {
                dialog_log.borrow_mut().push(format!("dialog {reason:?}"))
            })
            .into_any_element()
    }
}

#[gpui_kit::test]
fn a_menu_without_an_owner_leaves_escape_and_tab_to_its_dialog(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu_in_dialog(false));
    press(&rig, cx, "escape");
    assert_eq!(*log.borrow(), ["dialog Escape"], "Escape closes the dialog");
    log.borrow_mut().clear();
    press(&rig, cx, "tab");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["close"], "Tab reaches the dialog's Close");
}

#[gpui_kit::test]
fn an_owned_menu_reports_escape_and_tab_and_tab_still_moves_on(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, menu_in_dialog(true));
    press(&rig, cx, "escape");
    assert_eq!(
        *log.borrow(),
        ["menu Escape"],
        "the menu's owner has Escape"
    );
    log.borrow_mut().clear();
    press(&rig, cx, "tab");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["menu Tab", "close"]);
}

/// A button that opens a menu below it; Escape or a choice closes it.
fn menu_button(log: &Log, window: &mut Window, cx: &mut App) -> AnyElement {
    let open = window.use_keyed_state("menu-open", cx, |_, _| true).clone();
    let opener = window
        .use_keyed_state("opener", cx, |_, cx| cx.focus_handle())
        .read(cx)
        .clone();
    let focused_once = window.use_keyed_state("opener-focused", cx, |_, _| false);
    if !*focused_once.read(cx) {
        focused_once.update(cx, |done, _| *done = true);
        window.focus(&opener, cx);
    }
    let shown = *open.read(cx);
    let close = open.clone();
    div()
        .child(
            gpui_kit::base::Button::new("opener")
                .track_focus(&opener)
                .on_click({
                    let log = log.clone();
                    move |_, _, _| log.borrow_mut().push("opener".into())
                })
                .child("More"),
        )
        .when(shown, |column| {
            column.child(
                Menu::new(
                    "More",
                    vec![MenuItem::new("copy", "Copy link", record(log, "copy"))],
                )
                .on_close(move |_, _, cx| {
                    close.update(cx, |open, cx| {
                        *open = false;
                        cx.notify();
                    })
                }),
            )
        })
        .into_any_element()
}

#[gpui_kit::test]
fn focus_goes_back_to_the_menus_button_on_escape(cx: &mut TestAppContext) {
    let (rig, log) = host_in(cx, menu_button);
    press(&rig, cx, "escape");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["opener"]);
}

#[gpui_kit::test]
fn focus_goes_back_to_the_menus_button_after_a_choice(cx: &mut TestAppContext) {
    let (rig, log) = host_in(cx, menu_button);
    press(&rig, cx, "enter");
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["copy", "opener"]);
}

#[gpui_kit::test]
fn a_press_on_the_scrim_asks_to_close(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, dialog);
    rig.with(cx, |_, window, cx| {
        window.click_at("dialog-scrim", point(px(5.), px(5.)), cx)
    });
    assert_eq!(*log.borrow(), [format!("{:?}", DialogCloseReason::Scrim)]);
}

#[gpui_kit::test]
fn a_press_in_the_panel_or_a_drag_out_of_it_does_not_close(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, dialog);
    rig.with(cx, |_, window, cx| {
        let panel = window.find("dialog-panel").bounds();
        window.click_at("dialog-panel", point(px(8.), px(8.)), cx);
        window.drag(panel.center(), point(px(5.), px(5.)), cx);
    });
    assert!(log.borrow().is_empty(), "{:?}", log.borrow());
}

/// A dialog whose body focuses its own control as it opens, as a screen focuses a field.
fn dialog_with_focused_body(log: &Log, window: &mut Window, cx: &mut App) -> AnyElement {
    let field = window
        .use_keyed_state("field", cx, |_, cx| cx.focus_handle())
        .read(cx)
        .clone();
    let once = window.use_keyed_state("field-focused", cx, |_, _| false);
    if !*once.read(cx) {
        once.update(cx, |done, _| *done = true);
        window.focus(&field, cx);
    }
    Dialog::new("Rename")
        .body(
            gpui_kit::base::Button::new("field")
                .track_focus(&field)
                .on_click({
                    let log = log.clone();
                    move |_, _, _| log.borrow_mut().push("field".into())
                })
                .child("Name"),
        )
        .action(Button::new("cancel", "Cancel").on_click({
            let log = log.clone();
            move |_, _, _| log.borrow_mut().push("cancel".into())
        }))
        .into_any_element()
}

#[gpui_kit::test]
fn a_control_inside_that_took_focus_keeps_it(cx: &mut TestAppContext) {
    let (rig, log) = host_in(cx, dialog_with_focused_body);
    press(&rig, cx, "enter");
    assert_eq!(*log.borrow(), ["field"]);
}

fn popover(log: &Log) -> AnyElement {
    Popover::new("rename-popover")
        .placement(Placement::BottomStart)
        .default_open(true)
        .trigger_element(Button::new("rename-trigger", "Rename channel"))
        .content({
            let log = log.clone();
            move |_, _, _| {
                PopoverPanel::new("Rename panel").child(
                    Button::new("save", "Save")
                        .on_click(move |_, _, _| log.borrow_mut().push("save".into())),
                )
            }
        })
        .into_any_element()
}

#[gpui_kit::test]
fn a_popover_panel_is_named_and_escape_closes_it(cx: &mut TestAppContext) {
    let (rig, log) = host(cx, popover);
    rig.with(cx, |_, window, _| {
        assert!(window.try_find("popover-panel").is_some());
        assert!(window.try_find_by_label("Rename panel").is_some());
    });
    rig.click(cx, "save");
    assert_eq!(*log.borrow(), ["save"], "its controls work");
    press(&rig, cx, "escape");
    assert!(!rig.has(cx, "popover-panel"), "Escape closed it");
}

#[gpui_kit::test]
fn a_tooltip_shows_its_text_on_hover(cx: &mut TestAppContext) {
    let (rig, _) = host(cx, |_| {
        with_tip(
            div().id("tipped").test_support().size(px(40.)),
            "Mute microphone",
        )
        .into_any_element()
    });
    assert!(!rig.has(cx, "tooltip"), "hidden until hovered");
    rig.with(cx, |_, window, cx| window.hover("tipped", cx));
    cx.executor().advance_clock(Duration::from_secs(2));
    rig.with(cx, |_, window, _| {
        assert!(
            window.try_find("tooltip").is_some(),
            "shown after the delay"
        );
        assert!(window.try_find_by_label("Mute microphone").is_some());
    });
}
