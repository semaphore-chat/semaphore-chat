//! UK: the keyboard shortcut sheet (Mod+/), the web's list from
//! `docs-site/docs/keyboard-shortcuts.md` and `components/Shortcuts/`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `ShortcutSheetEvent`) is what the app
//! wiring lane builds against while UK draws the screen; change it only with the coordinator.

#[cfg(feature = "stories")]
pub mod stories;
#[cfg(test)]
mod tests;

use crate::kit::{Button, Dialog, Variant, spacing, text};
use crate::theme::{Sem, SemTheme};
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

#[derive(Debug, Clone, PartialEq)]
pub enum ShortcutSheetEvent {
    Close,
}

/// One key of a shortcut's combo, as the web's `ComboKey`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutKey {
    /// Ctrl on Linux and Windows, Cmd on macOS.
    Mod,
    Alt,
    Shift,
    Up,
    Down,
    Escape,
    Slash,
}

impl ShortcutKey {
    /// The key cap's label: `['Ctrl', '/']` with `mac` off, `['⌘', '/']` with it on.
    pub fn label(self, mac: bool) -> &'static str {
        match self {
            // Never shown on Linux or Windows; kept for a later macOS build.
            ShortcutKey::Mod if mac => "⌘",
            ShortcutKey::Mod => "Ctrl",
            ShortcutKey::Alt if mac => "⌥",
            ShortcutKey::Alt => "Alt",
            ShortcutKey::Shift if mac => "⇧",
            ShortcutKey::Shift => "Shift",
            ShortcutKey::Up => "↑",
            ShortcutKey::Down => "↓",
            ShortcutKey::Escape => "Esc",
            ShortcutKey::Slash => "/",
        }
    }

    /// The word a screen reader says, as the web's `shortcutSpokenLabel`: "Control", "Up arrow".
    fn spoken(self, mac: bool) -> &'static str {
        match self {
            ShortcutKey::Mod if mac => "Command",
            ShortcutKey::Mod => "Control",
            ShortcutKey::Alt if mac => "Option",
            ShortcutKey::Alt => "Alt",
            ShortcutKey::Shift => "Shift",
            ShortcutKey::Up => "Up arrow",
            ShortcutKey::Down => "Down arrow",
            ShortcutKey::Escape => "Escape",
            ShortcutKey::Slash => "Slash",
        }
    }
}

/// One global shortcut, from the web's `SHORTCUTS`: its group, what it does, and its keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shortcut {
    pub group: &'static str,
    pub description: &'static str,
    pub keys: &'static [ShortcutKey],
}

impl Shortcut {
    /// The visible key caps, e.g. `['Ctrl', '/']` or `['Alt', 'Shift', '↑']`.
    pub fn labels(&self, mac: bool) -> Vec<&'static str> {
        self.keys.iter().map(|key| key.label(mac)).collect()
    }

    /// The screen reader's label for the combo, e.g. "Alt plus Down arrow".
    pub fn spoken_label(&self, mac: bool) -> String {
        self.keys
            .iter()
            .map(|key| key.spoken(mac))
            .collect::<Vec<_>>()
            .join(" plus ")
    }
}

/// The web's `SHORTCUTS`, in its order.
pub const SHORTCUTS: &[Shortcut] = &[
    Shortcut {
        group: "Navigation",
        description: "Previous channel or conversation",
        keys: &[ShortcutKey::Alt, ShortcutKey::Up],
    },
    Shortcut {
        group: "Navigation",
        description: "Next channel or conversation",
        keys: &[ShortcutKey::Alt, ShortcutKey::Down],
    },
    Shortcut {
        group: "Navigation",
        description: "Previous unread channel or conversation",
        keys: &[ShortcutKey::Alt, ShortcutKey::Shift, ShortcutKey::Up],
    },
    Shortcut {
        group: "Navigation",
        description: "Next unread channel or conversation",
        keys: &[ShortcutKey::Alt, ShortcutKey::Shift, ShortcutKey::Down],
    },
    Shortcut {
        group: "Messages",
        description: "Close the side panel, or mark the conversation read",
        keys: &[ShortcutKey::Escape],
    },
    Shortcut {
        group: "Messages",
        description: "Edit your last message (in an empty message box)",
        keys: &[ShortcutKey::Up],
    },
    Shortcut {
        group: "Help",
        description: "Show keyboard shortcuts",
        keys: &[ShortcutKey::Mod, ShortcutKey::Slash],
    },
];

/// The groups in the web's order, each with its shortcuts: the app lane binds exactly these.
pub fn shortcut_groups() -> Vec<(&'static str, Vec<Shortcut>)> {
    let mut groups: Vec<(&'static str, Vec<Shortcut>)> = Vec::new();
    for shortcut in SHORTCUTS {
        match groups
            .iter_mut()
            .find(|(group, _)| *group == shortcut.group)
        {
            Some((_, shortcuts)) => shortcuts.push(*shortcut),
            None => groups.push((shortcut.group, vec![*shortcut])),
        }
    }
    groups
}

pub struct ShortcutSheet {
    mac: bool,
    /// Tracked by a hidden node in the dialog's body: the dialog closes on Escape only while
    /// the focus is inside it, so the sheet takes the focus when it first draws.
    focus: FocusHandle,
    took_focus: bool,
}

impl EventEmitter<ShortcutSheetEvent> for ShortcutSheet {}

impl ShortcutSheet {
    pub fn new(_window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            mac: false,
            focus: cx.focus_handle(),
            took_focus: false,
        }
    }

    /// Show Cmd instead of Ctrl (never on Linux or Windows; kept for a later macOS build).
    pub fn set_mac(&mut self, mac: bool, cx: &mut Context<Self>) {
        self.mac = mac;
        cx.notify();
    }
}

/// One key cap: MUI's `<kbd>`, 24px tall with a 2px bottom border.
fn key_cap(label: &'static str, sem: &Sem) -> Div {
    div()
        .flex()
        .items_center()
        .justify_center()
        .min_w(px(24.))
        .h(px(24.))
        .px(px(6.))
        .rounded(px(4.))
        .border_1()
        .border_b_2()
        .border_color(sem.divider)
        .bg(sem.action_hover)
        .child(
            text(Variant::Caption, label)
                .font_weight(FontWeight(600.))
                .line_height(px(12.))
                .text_color(sem.text_primary),
        )
}

/// One shortcut of a group: what it does at the left, its key caps at the right, a divider between.
fn shortcut_row(
    id: SharedString,
    shortcut: &Shortcut,
    last: bool,
    mac: bool,
    sem: &Sem,
) -> impl IntoElement {
    let keys_id = SharedString::from(format!("{id}-keys"));
    div()
        .id(id)
        .test_support()
        .flex()
        .items_center()
        .justify_between()
        .gap(spacing(2.))
        .py(px(6.))
        .when(!last, |row| row.border_b_1().border_color(sem.divider))
        .child(
            text(Variant::Body2, shortcut.description)
                .flex_1()
                .min_w_0()
                .text_color(sem.text_primary),
        )
        .child(
            div()
                .id(keys_id)
                .test_support()
                .flex()
                .flex_shrink_0()
                .items_center()
                .gap(px(4.))
                .role(Role::Definition)
                .aria_label(shortcut.spoken_label(mac))
                .children(shortcut.keys.iter().map(|key| key_cap(key.label(mac), sem))),
        )
}

/// One group of the sheet: the web's overline heading over its rows.
fn shortcut_section(
    index: usize,
    group: &'static str,
    shortcuts: &[Shortcut],
    mac: bool,
    sem: &Sem,
) -> impl IntoElement {
    let rows = shortcuts.iter().enumerate().map(|(row, shortcut)| {
        shortcut_row(
            SharedString::from(format!("shortcuts-row-{index}-{row}")),
            shortcut,
            row + 1 == shortcuts.len(),
            mac,
            sem,
        )
    });
    div()
        .id(SharedString::from(format!("shortcuts-group-{index}")))
        .test_support()
        .role(Role::Section)
        .aria_label(group)
        .flex()
        .flex_col()
        .when(index > 0, |section| section.mt(spacing(2.5)))
        .child(
            text(Variant::Overline, group)
                .mb(px(4.))
                .text_color(sem.text_secondary),
        )
        .child(
            div()
                .id(SharedString::from(format!("shortcuts-list-{index}")))
                .test_support()
                .role(Role::DescriptionList)
                .aria_label(group)
                .flex()
                .flex_col()
                .children(rows),
        )
}

impl Render for ShortcutSheet {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.took_focus {
            self.took_focus = true;
            window.focus(&self.focus, cx);
        }
        let sem = cx.sem();
        let mac = self.mac;
        let groups = shortcut_groups();
        let body = div()
            .id("shortcuts-body")
            .test_support()
            .relative()
            .max_h(px(540.))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .child(div().absolute().size_0().track_focus(&self.focus))
            .children(
                groups
                    .iter()
                    .enumerate()
                    .map(|(index, (group, shortcuts))| {
                        shortcut_section(index, group, shortcuts, mac, sem)
                    }),
            );
        let close_button = cx.weak_entity();
        let close_dialog = cx.weak_entity();
        Dialog::new("Keyboard shortcuts")
            .width(600.)
            .body(body)
            .action(
                Button::new("shortcuts-close", "Close").on_click(move |_, _, cx| {
                    close_button
                        .update(cx, |_, cx| cx.emit(ShortcutSheetEvent::Close))
                        .ok();
                }),
            )
            .on_close(move |_, cx| {
                close_dialog
                    .update(cx, |_, cx| cx.emit(ShortcutSheetEvent::Close))
                    .ok();
            })
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
