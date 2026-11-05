//! Composer rich-text shortcuts (Ctrl/Cmd+B and Ctrl/Cmd+I), from `richTextShortcuts.ts`.
//! Pure functions of the text and the selection. Offsets are bytes into `text`.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WrapResult {
    pub new_text: String,
    pub selection_start: usize,
    pub selection_end: usize,
}

/// Wrap the selection in `marker`, or unwrap it when it is already wrapped. An empty selection
/// gets an empty pair with the caret between the markers.
pub fn wrap_selection(text: &str, start: usize, end: usize, marker: &str) -> WrapResult {
    let start = floor_boundary(text, start);
    let end = floor_boundary(text, end).max(start);
    let selected = &text[start..end];
    let before = &text[..start];
    let after = &text[end..];

    // Toggle off: the markers sit just outside the selection.
    if before.ends_with(marker) && after.starts_with(marker) {
        let new_text = format!(
            "{}{}{}",
            &before[..before.len() - marker.len()],
            selected,
            &after[marker.len()..]
        );
        let s = start - marker.len();
        return WrapResult {
            new_text,
            selection_start: s,
            selection_end: s + selected.len(),
        };
    }

    // Toggle off: the markers are inside the selection.
    if selected.starts_with(marker)
        && selected.ends_with(marker)
        && selected.len() >= marker.len() * 2
    {
        let inner = &selected[marker.len()..selected.len() - marker.len()];
        return WrapResult {
            new_text: format!("{before}{inner}{after}"),
            selection_start: start,
            selection_end: start + inner.len(),
        };
    }

    let s = start + marker.len();
    WrapResult {
        new_text: format!("{before}{marker}{selected}{marker}{after}"),
        selection_start: s,
        selection_end: s + selected.len(),
    }
}

/// The marker a shortcut key applies, or `None`.
pub fn marker_for_shortcut(key: &str) -> Option<&'static str> {
    match key.to_lowercase().as_str() {
        "b" => Some("**"),
        "i" => Some("_"),
        _ => None,
    }
}

/// `at` clamped into `text` and moved back onto a character boundary.
pub(crate) fn floor_boundary(text: &str, at: usize) -> usize {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    at
}
