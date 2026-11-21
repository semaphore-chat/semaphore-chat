//! The behaviour hosts, one story per host: the overlay stack (a menu over a dialog over the
//! page, and a popover in a dialog), the list-focus pieces together, and the announcer. The story
//! harness mounts a `BehaviourRoot`, so in the story viewer Escape, presses and Tab go through the
//! window's stack exactly as in the app: Escape closes the menu, then the dialog, then reopens
//! nothing (the screen chain logs it).

use super::{Politeness, announce, screen_escape};
use crate::kit::overlays::type_text;
use crate::kit::stories_lists_overlays::view;
use crate::kit::{
    BehaviourHost, Button, Dialog, Dock, DockItem, Menu, MenuItem, Placement, Popover,
    PopoverPanel, Tabs,
};
use crate::stories::Story;
use crate::theme::SemTheme;
use gpui_kit::prelude::*;
use gpui_kit::*;
use semaphore_design::lounge::{self as t, SPACE_LG, SPACE_MD, SPACE_SM};
use semaphore_design::{Icon as I, Mode};

/// What the nested-overlays story has open, and what the stack asked of it.
struct Nested {
    dialog: bool,
    menu: bool,
    said: Vec<String>,
}

fn nested(window: &mut Window, cx: &mut App) -> AnyElement {
    let state = window.use_keyed_state("behaviour-nested", cx, |_, _| Nested {
        dialog: true,
        menu: true,
        said: Vec::new(),
    });
    let log = state.clone();
    screen_escape(
        "behaviour-nested-escape",
        10,
        move |_, cx| {
            log.update(cx, |state, cx| {
                state.said.push("The screen took Escape".into());
                state.dialog = true;
                state.menu = true;
                cx.notify();
            });
            true
        },
        window,
        cx,
    );
    let (dialog, menu, said) = {
        let state = state.read(cx);
        (state.dialog, state.menu, state.said.clone())
    };
    let secondary = cx.sem().role.text_secondary;
    let close_menu = state.clone();
    let menu = menu.then(|| {
        // Floating, as a screen draws a menu: deferred and anchored below the button, above the
        // dialog (gpui-kit draws dialogs at priority 10, popups at 100).
        deferred(
            anchored().anchor(Anchor::TopLeft).child(
                div().mt(px(crate::kit::ANCHOR_GAP)).child(
                    Menu::new(
                        "Channel actions",
                        [
                            MenuItem::new("nested-rename", "Rename", |_, _| {}).icon(I::Edit),
                            MenuItem::new("nested-mute", "Mute", |_, _| {})
                                .icon(I::NotificationsOff),
                        ],
                    )
                    .id("nested-menu")
                    .on_close(move |reason, _, cx| {
                        close_menu.update(cx, |state, cx| {
                            state.said.push(format!("Menu closed: {reason:?}"));
                            state.menu = false;
                            cx.notify();
                        });
                    }),
                ),
            ),
        )
        .with_priority(gpui_kit::base::POPUP_PRIORITY)
    });
    let open_menu = state.clone();
    let close_dialog = state.clone();
    let dialog = dialog.then(|| {
        Dialog::new("nested-dialog", "Channel settings")
            .description("A menu is open over this dialog: Escape closes it first.")
            .body(
                div()
                    .relative()
                    .child(Button::new("nested-more", "More actions").soft().on_click(
                        move |_, _, cx| {
                            open_menu.update(cx, |state, cx| {
                                state.menu = true;
                                cx.notify();
                            })
                        },
                    ))
                    .children(menu),
            )
            .action(Button::new("nested-done", "Done").primary())
            .on_request_close(move |reason, _, cx| {
                close_dialog.update(cx, |state, cx| {
                    state.said.push(format!("Dialog closed: {reason:?}"));
                    state.dialog = false;
                    state.menu = false;
                    cx.notify();
                });
            })
    });
    div()
        .size_full()
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(SPACE_SM))
                .child(type_text(t::TEXT_BODY_STRONG, "What the stack asked"))
                .children(if said.is_empty() {
                    vec![type_text(t::TEXT_BODY, "Nothing yet").text_color(secondary)]
                } else {
                    said.into_iter()
                        .map(|line| type_text(t::TEXT_BODY, line).text_color(secondary))
                        .collect()
                }),
        )
        .children(dialog)
        .into_any_element()
}

fn popover_in_dialog(_: &mut Window, _: &mut App) -> AnyElement {
    div()
        .size_full()
        .child(
            Dialog::new("stack-popover-dialog", "Edit channel")
                .description("The popover is a layer owned by the dialog.")
                .body(
                    div().flex().child(
                        Popover::new("stack-colour")
                            .placement(Placement::BottomStart)
                            .default_open(true)
                            .trigger_element(Button::new("stack-pick", "Pick colour").soft())
                            .content(|_, _| {
                                PopoverPanel::new("Colours").child(
                                    div()
                                        .flex()
                                        .gap(px(SPACE_SM))
                                        .child(Button::new("stack-purple", "Purple").text())
                                        .child(Button::new("stack-teal", "Teal").text()),
                                )
                            }),
                    ),
                )
                .action(Button::new("stack-cancel", "Cancel").ghost())
                .action(Button::new("stack-save", "Save").primary())
                .on_close(|_, _| {}),
        )
        .into_any_element()
}

fn list_focus(_: &mut Window, _: &mut App) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_LG))
        .child(type_text(
            t::TEXT_BODY,
            "Each is one Tab stop; the arrows, Home and End move inside it.",
        ))
        .child(Tabs::new(
            "focus-tabs",
            vec!["Members".into(), "Roles".into(), "Bans".into()],
            1,
        ))
        .child(Tabs::new("focus-segmented", vec!["Day".into(), "Week".into()], 0).segmented())
        .child(
            Dock::new("focus-dock", "Communities")
                .item(DockItem::new("focus-couch", "Couch Co-op").current(true))
                .item(DockItem::new("focus-raid", "Raid Night"))
                .item(DockItem::new("focus-book", "Book Club")),
        )
        .child(
            div().w(px(240.)).child(
                Menu::new(
                    "Message actions",
                    [
                        MenuItem::new("focus-reply", "Reply", |_, _| {}).shortcut(["R"]),
                        MenuItem::new("focus-pin", "Pin message", |_, _| {}),
                        MenuItem::new("focus-copy", "Copy text", |_, _| {}),
                    ],
                )
                .id("focus-menu"),
            ),
        )
        .into_any_element()
}

/// Says one thing on its first frame, so the shot shows the announcer's last words.
struct Spoken(bool);

fn announcer(window: &mut Window, cx: &mut App) -> AnyElement {
    let spoken = window.use_keyed_state("announcer-spoken", cx, |_, _| Spoken(false));
    if !spoken.read(cx).0 {
        spoken.update(cx, |spoken, _| spoken.0 = true);
        window.defer(cx, |window, cx| {
            announce("Joined Squad Up", Politeness::Polite, window, cx)
        });
    }
    let host = BehaviourHost::of(window, cx);
    let line = |speaker: Option<&crate::kit::Said>| {
        speaker
            .map(|said| format!("{} (#{})", said.text, said.seq))
            .unwrap_or_else(|| "nothing".into())
    };
    let (polite, assertive) = host
        .map(|host| {
            let host = host.read(cx);
            (
                line(host.announcer.polite().last()),
                line(host.announcer.assertive().last()),
            )
        })
        .unwrap_or_else(|| ("no host".into(), "no host".into()));
    let secondary = cx.sem().role.text_secondary;
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_MD))
        .child(type_text(
            t::TEXT_BODY,
            "Screen readers read these; nothing on screen shows them.",
        ))
        .child(
            div()
                .flex()
                .gap(px(SPACE_SM))
                .child(
                    Button::new("announce-polite", "Say politely")
                        .soft()
                        .on_click(|_, window, cx| {
                            announce("Message deleted", Politeness::Polite, window, cx)
                        }),
                )
                .child(
                    Button::new("announce-assertive", "Interrupt")
                        .danger()
                        .on_click(|_, window, cx| {
                            announce("Connection lost", Politeness::Assertive, window, cx)
                        }),
                ),
        )
        .child(type_text(t::TEXT_BODY, format!("Polite: {polite}")).text_color(secondary))
        .child(type_text(t::TEXT_BODY, format!("Assertive: {assertive}")).text_color(secondary))
        .into_any_element()
}

pub(crate) fn stories() -> Vec<Story> {
    macro_rules! story {
        ($name:literal, $mode:expr, $body:expr) => {
            Story::new($name, |_, _, cx| {
                view($mode, cx, |window, cx| $body(window, cx))
            })
        };
    }
    vec![
        story!("kit-behaviour-nested-overlays", Mode::Dark, nested),
        story!("kit-behaviour-nested-overlays-light", Mode::Light, nested),
        story!(
            "kit-behaviour-popover-in-dialog",
            Mode::Dark,
            popover_in_dialog
        ),
        story!("kit-behaviour-list-focus", Mode::Dark, list_focus),
        story!("kit-behaviour-list-focus-light", Mode::Light, list_focus),
        story!("kit-behaviour-announcer", Mode::Dark, announcer),
    ]
}
