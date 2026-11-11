//! The push-to-talk key: what a keystroke records, and how a stored key reads.
//!
//! A key is stored as GPUI's key name without modifiers (`"f13"`, `"space"`, `` "`" ``), as the web
//! records `event.code` alone. W3-app's push-to-talk listener matches `Keystroke::key` against the
//! same names, lowercased.

use gpui_kit::Keystroke;

/// What a keystroke does while "Press a key…" shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Capture {
    /// Record this key.
    Key(String),
    /// Escape: stop capturing and keep the old key.
    Cancel,
    /// A modifier on its own: keep waiting.
    Ignore,
}

const MODIFIERS: [&str; 8] = [
    "shift", "control", "ctrl", "alt", "platform", "cmd", "function", "fn",
];

pub fn ptt_key_from(keystroke: &Keystroke) -> Capture {
    let key = keystroke.key.to_lowercase();
    if key == "escape" {
        Capture::Cancel
    } else if key.is_empty() || keystroke.is_modifier_key() || MODIFIERS.contains(&key.as_str()) {
        Capture::Ignore
    } else {
        Capture::Key(key)
    }
}

/// How a stored key reads: `"space"` is "Space", `"f13"` is "F13", `` "`" `` stays as it is.
/// Stored values are lowercased first, so a stored `"F13"` reads the same.
pub fn ptt_key_label(key: &str) -> String {
    let key = key.to_lowercase();
    let named = match key.as_str() {
        "pageup" => Some("Page Up"),
        "pagedown" => Some("Page Down"),
        "capslock" => Some("Caps Lock"),
        "backspace" => Some("Backspace"),
        "up" => Some("Up Arrow"),
        "down" => Some("Down Arrow"),
        "left" => Some("Left Arrow"),
        "right" => Some("Right Arrow"),
        _ => None,
    };
    if let Some(named) = named {
        return named.to_owned();
    }
    let is_function =
        key.len() > 1 && key.starts_with('f') && key[1..].chars().all(|c| c.is_ascii_digit());
    if is_function || key.chars().count() == 1 {
        return key.to_uppercase();
    }
    let mut chars = key.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
