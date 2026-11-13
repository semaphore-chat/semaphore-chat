//! The sheet's list against the web's, its Mac labels, and its two ways to close.

use super::{SHORTCUTS, ShortcutSheet, ShortcutSheetEvent, shortcut_groups};
use crate::dms::rig::{Rig, rig};
use core::prelude::v1::test;
use gpui_kit::*;

/// One web shortcut: what it does, and the key caps a Linux or Windows build shows.
type WebRow = (&'static str, &'static [&'static str]);
/// One group of the web's `SHORTCUTS`: its name and its rows.
type WebGroup = (&'static str, &'static [WebRow]);
/// The same groups as `shortcut_groups()` gives them, ready to compare.
type ListedGroup = (&'static str, Vec<(&'static str, Vec<&'static str>)>);

/// `SHORTCUTS` from `frontend/src/utils/shortcuts.ts`, copied by hand so a changed port shows up
/// here.
const WEB: &[WebGroup] = &[
    (
        "Navigation",
        &[
            ("Previous channel or conversation", &["Alt", "↑"]),
            ("Next channel or conversation", &["Alt", "↓"]),
            (
                "Previous unread channel or conversation",
                &["Alt", "Shift", "↑"],
            ),
            (
                "Next unread channel or conversation",
                &["Alt", "Shift", "↓"],
            ),
        ],
    ),
    (
        "Messages",
        &[
            (
                "Close the side panel, or mark the conversation read",
                &["Esc"],
            ),
            ("Edit your last message (in an empty message box)", &["↑"]),
        ],
    ),
    ("Help", &[("Show keyboard shortcuts", &["Ctrl", "/"])]),
];

fn sheet(cx: &mut TestAppContext) -> Rig<ShortcutSheet, ShortcutSheetEvent> {
    rig(cx, 900., ShortcutSheet::new)
}

#[test]
fn every_web_shortcut_is_listed() {
    let listed: Vec<ListedGroup> = shortcut_groups()
        .iter()
        .map(|(group, shortcuts)| {
            (
                *group,
                shortcuts
                    .iter()
                    .map(|shortcut| (shortcut.description, shortcut.labels(false)))
                    .collect(),
            )
        })
        .collect();
    let expected: Vec<ListedGroup> = WEB
        .iter()
        .map(|(group, rows)| {
            (
                *group,
                rows.iter()
                    .map(|(description, keys)| (*description, keys.to_vec()))
                    .collect(),
            )
        })
        .collect();
    assert_eq!(listed, expected);
}

#[test]
fn mac_shows_command_and_option() {
    let help = SHORTCUTS
        .iter()
        .find(|shortcut| shortcut.group == "Help")
        .expect("the sheet's own shortcut");
    assert_eq!(help.labels(true), ["⌘", "/"]);
    assert_eq!(help.spoken_label(true), "Command plus Slash");
    let previous = &SHORTCUTS[0];
    assert_eq!(previous.labels(true), ["⌥", "↑"]);
    assert_eq!(previous.spoken_label(true), "Option plus Up arrow");
    assert_eq!(previous.spoken_label(false), "Alt plus Up arrow");
}

#[gpui_kit::test]
fn close_emits_close(cx: &mut TestAppContext) {
    let rig = sheet(cx);
    assert!(rig.has(cx, "shortcuts-close"), "the Close button is drawn");
    rig.click(cx, "shortcuts-close");
    assert_eq!(rig.events(), [ShortcutSheetEvent::Close]);
}

#[gpui_kit::test]
fn escape_emits_close(cx: &mut TestAppContext) {
    let rig = sheet(cx);
    rig.with(cx, |_, window, _| window.activate_window());
    cx.simulate_keystrokes(rig.window, "escape");
    assert_eq!(rig.events(), [ShortcutSheetEvent::Close]);
}
