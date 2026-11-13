//! UK: the keyboard shortcut sheet (Mod+/), the web's list from
//! `docs-site/docs/keyboard-shortcuts.md` and `components/Shortcuts/`.
//!
//! Frozen by the UI freeze: the public API below (`new`, the setters and `ShortcutSheetEvent`) is what the app
//! wiring lane builds against while UK draws the screen; change it only with the coordinator.
//! Until UK lands, it draws a placeholder.

#![allow(dead_code)]

use crate::kit::{Variant, text};
use gpui_kit::prelude::*;
use gpui_kit::*;

#[derive(Debug, Clone, PartialEq)]
pub enum ShortcutSheetEvent {
    Close,
}

pub struct ShortcutSheet {
    mac: bool,
}

impl EventEmitter<ShortcutSheetEvent> for ShortcutSheet {}

impl ShortcutSheet {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self { mac: false }
    }

    /// Show Cmd instead of Ctrl (never on Linux or Windows; kept for a later macOS build).
    pub fn set_mac(&mut self, mac: bool, cx: &mut Context<Self>) {
        self.mac = mac;
        cx.notify();
    }
}

impl Render for ShortcutSheet {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("shortcutsheet-placeholder")
            .p_4()
            .child(text(Variant::Body2, "This screen isn't built yet."))
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    Vec::new()
}
