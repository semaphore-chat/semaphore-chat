//! The behaviour hosts, one story per host: the overlay stack (a menu over a dialog over the
//! page, and a popover in a dialog), the list-focus pieces together, and the announcer. The story
//! harness mounts a `BehaviourRoot`, so in the story viewer Escape, presses and Tab go through the
//! window's stack exactly as in the app: Escape closes the menu, then the dialog, then reopens
//! nothing (the screen chain logs it).

use super::{
    ConfirmOptions, LoadResult, LoadState, LoadStateView, Politeness, ToastRegion, ToastRequest,
    Toasts, announce, confirm_destructive, screen_escape,
};
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
use std::rc::Rc;

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

/// Shows `requests` once, after the first frame (never while rendering), and draws the window's
/// toast area over `body`.
struct ShowOnce(bool);

fn with_toasts(
    key: &'static str,
    requests: Vec<ToastRequest>,
    body: AnyElement,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let shown = window.use_keyed_state(key, cx, |_, _| ShowOnce(false));
    if !shown.read(cx).0 {
        shown.update(cx, |shown, _| shown.0 = true);
        let toasts = Toasts::for_window(window.window_handle());
        window.defer(cx, move |_, cx| {
            for request in requests {
                toasts.show(request, cx);
            }
        });
    }
    div()
        .size_full()
        .relative()
        .child(body)
        .child(ToastRegion::new())
        .into_any_element()
}

fn toast_page(cx: &App) -> AnyElement {
    let secondary = cx.sem().role.text_secondary;
    div()
        .flex()
        .flex_col()
        .gap(px(SPACE_SM))
        .child(type_text(t::TEXT_BODY_STRONG, "general"))
        .child(type_text(t::TEXT_BODY, "Couch Co-op is on tonight at nine.").text_color(secondary))
        .into_any_element()
}

fn toast_neutral(window: &mut Window, cx: &mut App) -> AnyElement {
    let page = toast_page(cx);
    with_toasts(
        "toast-neutral",
        vec![ToastRequest::new("Recording saved").id("replay-toast")],
        page,
        window,
        cx,
    )
}

fn toast_action(window: &mut Window, cx: &mut App) -> AnyElement {
    let page = toast_page(cx);
    with_toasts(
        "toast-action",
        vec![
            ToastRequest::new("Message deleted")
                .id("deleted")
                .action("Undo", |_, _| {}),
            // Waits its turn behind the one showing.
            ToastRequest::new("Clip shared")
                .id("replay-toast")
                .positive(),
        ],
        page,
        window,
        cx,
    )
}

fn toast_danger(window: &mut Window, cx: &mut App) -> AnyElement {
    let page = toast_page(cx);
    with_toasts(
        "toast-danger",
        vec![
            ToastRequest::new(
                "Couldn't join voice: the server didn't answer in time. Check your connection and try again.",
            )
            .id("voice-join-failed")
            .danger(),
        ],
        page,
        window,
        cx,
    )
}

/// A confirmation opened on its first frame; `fail` makes its action fail at once.
fn confirm(fail: bool, window: &mut Window, cx: &mut App) -> AnyElement {
    let key = if fail {
        "confirm-failed"
    } else {
        "confirm-open"
    };
    let remove = confirm_destructive(
        key,
        ConfirmOptions::new(
            "Delete #general?",
            "This removes 214 messages for everyone. It can't be undone.",
            "Delete channel",
            move |window, cx| {
                window.spawn(cx, async move |_| {
                    if fail {
                        Err("You can't delete the last text channel.".into())
                    } else {
                        Ok(())
                    }
                })
            },
        ),
        window,
        cx,
    );
    let opened = window.use_keyed_state(
        ElementId::NamedChild(std::sync::Arc::new(key.into()), "opened".into()),
        cx,
        |_, _| ShowOnce(false),
    );
    if !opened.read(cx).0 {
        opened.update(cx, |opened, _| opened.0 = true);
        let (request, confirm) = (remove.request.clone(), remove.confirm.clone());
        window.defer(cx, move |window, cx| {
            request(window, cx);
            // Confirm at once, so the shot shows the failure in the dialog.
            if fail {
                confirm(window, cx);
            }
        });
    }
    let request = remove.request.clone();
    div()
        .size_full()
        .child(
            Button::new("confirm-delete", "Delete channel")
                .danger()
                .on_click(move |_, window, cx| request(window, cx)),
        )
        .children(remove.dialog)
        .into_any_element()
}

fn confirm_open(window: &mut Window, cx: &mut App) -> AnyElement {
    confirm(false, window, cx)
}

fn confirm_failed(window: &mut Window, cx: &mut App) -> AnyElement {
    confirm(true, window, cx)
}

/// The five faces of a load, side by side.
fn load_faces(_: &mut Window, cx: &mut App) -> AnyElement {
    let face = |state: LoadState, error: Option<&str>| {
        let result: LoadResult<()> = LoadResult {
            state,
            error: error.map(str::to_owned),
            data: None,
            refresh_by_user: false,
            retry: Rc::new(|_, _| {}),
            refresh: Rc::new(|_, _, _| {}),
        };
        let content = div()
            .flex()
            .flex_col()
            .gap(px(SPACE_SM))
            .child(type_text(t::TEXT_BODY, "Ava"))
            .child(type_text(t::TEXT_BODY, "Ben"));
        LoadStateView::new(format!("face-{state:?}"), &result)
            .empty("No members yet.")
            .error_title("Couldn't load members")
            .content(content)
    };
    let secondary = cx.sem().role.text_secondary;
    let labelled = |label: &'static str, face: LoadStateView| {
        div()
            .w(px(280.))
            .flex()
            .flex_col()
            .gap(px(SPACE_SM))
            .child(type_text(t::TEXT_META, label).text_color(secondary))
            .child(face)
    };
    div()
        .flex()
        .flex_wrap()
        .gap(px(SPACE_LG))
        .child(labelled("Loading", face(LoadState::Loading, None)))
        .child(labelled("Empty", face(LoadState::Empty, None)))
        .child(labelled(
            "Error",
            face(LoadState::Error, Some("network unreachable")),
        ))
        .child(labelled("Ready", face(LoadState::Ready, None)))
        .child(labelled("Refreshing", face(LoadState::Refreshing, None)))
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
        story!("kit-behaviour-toast", Mode::Dark, toast_neutral),
        story!("kit-behaviour-toast-light", Mode::Light, toast_neutral),
        story!("kit-behaviour-toast-action", Mode::Dark, toast_action),
        story!("kit-behaviour-toast-danger", Mode::Dark, toast_danger),
        story!("kit-behaviour-confirm", Mode::Dark, confirm_open),
        story!("kit-behaviour-confirm-light", Mode::Light, confirm_open),
        story!("kit-behaviour-confirm-failed", Mode::Dark, confirm_failed),
        story!("kit-behaviour-load-faces", Mode::Dark, load_faces),
        story!("kit-behaviour-load-faces-light", Mode::Light, load_faces),
    ]
}
