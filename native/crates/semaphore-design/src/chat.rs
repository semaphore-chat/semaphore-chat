//! The chat pieces' pure rules, ports of the web kit's `frontend/src/kit/chat/*.ts`: which
//! mention addresses stay in the app, the text a reaction count, the typing line and the "Jump to
//! latest" control draw, and the box an image attachment gets before it loads.
//!
//! No GPUI and no dependencies, as the rest of this crate, so the Android kit can share them.
//! The web-link check (`checkLink`) needs a URL parser and lives in
//! `semaphore_core::links::check_link`.

use crate::lounge::SPACE_2XL;

// ---------------------------------------------------------------------------------------------
// Segments (`messageSegments.ts`)

/// Bidi controls: embeddings, overrides, isolates and marks. They reorder what is drawn.
fn is_bidi_control(c: char) -> bool {
    matches!(c, '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

/// `text` without bidi control characters (`stripBidi`).
pub fn strip_bidi(text: &str) -> String {
    text.chars().filter(|c| !is_bidi_control(*c)).collect()
}

/// A C0 control character (tab, line break, ...) or DEL: what the web's `hasControl` looks for.
fn has_control(text: &str) -> bool {
    text.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f)
}

/// A `.` or `..` path segment, also percent-encoded (`%2e`, `%2E%2e`).
fn is_dot_segment(segment: &str) -> bool {
    let mut rest = segment;
    let mut dots = 0;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('.') {
            rest = after;
        } else if let Some(after) = rest
            .get(..3)
            .filter(|head| head.eq_ignore_ascii_case("%2e"))
            .and_then(|_| rest.get(3..))
        {
            rest = after;
        } else {
            return false;
        }
        dots += 1;
    }
    (1..=2).contains(&dots)
}

/// A mention's address, if it stays inside the app (`internalHref`): a hash route (`#/...`) or a
/// path with a single leading slash (`/...`). `//host`, `/\host`, a control character the URL
/// parser would drop to make `//`, a `//` or a `.`/`..` segment anywhere in the path, and any
/// scheme are refused (`None`).
pub fn internal_href(href: &str) -> Option<&str> {
    let hash_route = href.starts_with("#/");
    let path_route = href.starts_with('/') && !href.starts_with("//");
    if !hash_route && !path_route {
        return None;
    }
    if has_control(href) || href.contains('\\') {
        return None;
    }
    let route = href.strip_prefix('#').unwrap_or(href);
    let path = route.split(['?', '#']).next().unwrap_or_default();
    if path.contains("//") || path.split('/').any(is_dot_segment) {
        return None;
    }
    Some(href)
}

// ---------------------------------------------------------------------------------------------
// Reaction counts (`reactionCount.ts`)

/// Up to this many a count is drawn in full; above it in a compact form ("1.2K").
pub const FULL_COUNT_MAX: u64 = 999;

/// A count as a whole, non-negative number: what the web's `Math.max(0, Math.floor(count))` gives,
/// with NaN and infinities as 0.
pub fn whole_count(count: f64) -> u64 {
    if count.is_finite() && count > 0. {
        count.floor() as u64
    } else {
        0
    }
}

/// English compact notation with at most one decimal, as `Intl.NumberFormat('en', { notation:
/// 'compact', maximumFractionDigits: 1 })` writes it: 1250 is "1.3K", 48213 "48.2K", 999999 "1M".
pub fn compact_count(count: u64) -> String {
    const UNITS: [(u64, &str); 4] = [
        (1_000_000_000_000, "T"),
        (1_000_000_000, "B"),
        (1_000_000, "M"),
        (1_000, "K"),
    ];
    if count < 1_000 {
        return count.to_string();
    }
    // The largest unit the count reaches, then one up when rounding carries it to 1000 of it.
    let mut index = UNITS
        .iter()
        .position(|(unit, _)| count >= *unit)
        .unwrap_or(UNITS.len() - 1);
    loop {
        let (unit, suffix) = UNITS[index];
        // Tenths of the unit, rounded half up (Intl's default `halfExpand`).
        let tenths = (u128::from(count) * 10 + u128::from(unit) / 2) / u128::from(unit);
        if tenths >= 10_000 && index > 0 {
            index -= 1;
            continue;
        }
        let (whole, tenth) = (tenths / 10, tenths % 10);
        return if tenth == 0 {
            format!("{whole}{suffix}")
        } else {
            format!("{whole}.{tenth}{suffix}")
        };
    }
}

/// The count as a reaction chip draws it (`drawnReactionCount`): in full up to
/// [`FULL_COUNT_MAX`], compact above it. The chip's name keeps the exact count.
pub fn drawn_reaction_count(count: u64) -> String {
    if count > FULL_COUNT_MAX {
        compact_count(count)
    } else {
        count.to_string()
    }
}

/// A reaction chip's accessible name: "Laugh reaction, 4".
pub fn reaction_name(label: &str, count: u64) -> String {
    format!("{label} reaction, {count}")
}

// ---------------------------------------------------------------------------------------------
// Typing (`typingText.ts`)

/// The typing line's height: the room the message list keeps under its last row for it.
pub const TYPING_LINE_HEIGHT: f32 = SPACE_2XL;

/// Who is typing, in words: one name, two names, or the first name and how many others.
pub fn typing_text<S: AsRef<str>>(names: &[S]) -> String {
    match names {
        [] => String::new(),
        [one] => format!("{} is typing…", one.as_ref()),
        [one, two] => format!("{} and {} are typing…", one.as_ref(), two.as_ref()),
        [first, rest @ ..] => format!("{} and {} others are typing…", first.as_ref(), rest.len()),
    }
}

// ---------------------------------------------------------------------------------------------
// Jump to latest (`JumpToLatest.tsx`)

/// Above this, a count of new messages reads "99+", as a Badge does.
pub const JUMP_MAX_COUNT: u64 = 99;

/// What "Jump to latest" shows and is named, for `new_count` messages that arrived meanwhile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JumpText {
    /// The visible words: "Jump to latest", "3 new", "99+ new".
    pub text: String,
    /// The accessible name: "Jump to latest, 3 new messages".
    pub name: String,
    /// Whether there is a count: the control is drawn in the accent.
    pub counted: bool,
}

/// The words and the name of the jump control.
pub fn jump_text(new_count: u64) -> JumpText {
    if new_count == 0 {
        return JumpText {
            text: "Jump to latest".into(),
            name: "Jump to latest".into(),
            counted: false,
        };
    }
    let drawn = if new_count > JUMP_MAX_COUNT {
        format!("{JUMP_MAX_COUNT}+")
    } else {
        new_count.to_string()
    };
    let noun = if new_count == 1 {
        "message"
    } else {
        "messages"
    };
    JumpText {
        text: format!("{drawn} new"),
        name: format!("Jump to latest, {drawn} new {noun}"),
        counted: true,
    }
}

// ---------------------------------------------------------------------------------------------
// Attachment boxes (`attachmentBox.ts`)

/// The size of a box an image is drawn in, in pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoxSize {
    pub width: f32,
    pub height: f32,
}

/// The largest box an image is drawn in; a smaller image keeps its own size.
pub const IMAGE_MAX: BoxSize = BoxSize {
    width: 320.,
    height: 240.,
};
/// No side of an image box is smaller than this: an extreme shape is letterboxed inside it.
pub const IMAGE_MIN_SIDE: f32 = 48.;
/// The box of an image whose size is not known.
pub const IMAGE_FALLBACK: BoxSize = BoxSize {
    width: 240.,
    height: 160.,
};

/// JavaScript's `Math.round`: halves go up, also below zero.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// The box an image is drawn in (`imageBox`): its own size, shrunk to fit [`IMAGE_MAX`], never a
/// side under [`IMAGE_MIN_SIDE`] (a 4000×10 strip gets a 320×48 box, the picture letterboxed in
/// it), or [`IMAGE_FALLBACK`] when the size is unknown or not a size.
pub fn image_box(width: Option<f64>, height: Option<f64>) -> BoxSize {
    let (Some(width), Some(height)) = (width, height) else {
        return IMAGE_FALLBACK;
    };
    if !(width.is_finite() && height.is_finite() && width > 0. && height > 0.) {
        return IMAGE_FALLBACK;
    }
    let max_w = f64::from(IMAGE_MAX.width);
    let max_h = f64::from(IMAGE_MAX.height);
    let scale = 1f64.min(max_w / width).min(max_h / height);
    let clamp = |side: f64, max: f64| js_round(side).max(f64::from(IMAGE_MIN_SIDE)).min(max) as f32;
    BoxSize {
        width: clamp(width * scale, max_w),
        height: clamp(height * scale, max_h),
    }
}

// ---------------------------------------------------------------------------------------------
// Composer (`Composer.tsx`) and its suggestions (`SuggestionList.tsx`)

/// How tall a composer's field may grow before it scrolls (`ComposerCap`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ComposerCap {
    /// The on-screen keyboard is up: 2 lines.
    Keyboard,
    /// A phone: 4 lines.
    Phone,
    /// A wide screen: 10 lines.
    #[default]
    Desktop,
}

/// The lines a field grows to under `cap` (`CAP_ROWS`), then it scrolls.
pub fn cap_rows(cap: ComposerCap) -> usize {
    match cap {
        ComposerCap::Keyboard => 2,
        ComposerCap::Phone => 4,
        ComposerCap::Desktop => 10,
    }
}

/// What a composer's trailing button does (`ComposerMode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ComposerMode {
    /// Send a new message: "Send message".
    #[default]
    Send,
    /// Save an edit to one: "Save changes".
    Save,
}

/// The trailing button's name in `mode` (`SUBMIT`).
pub fn submit_label(mode: ComposerMode) -> &'static str {
    match mode {
        ComposerMode::Send => "Send message",
        ComposerMode::Save => "Save changes",
    }
}

/// Whether there is something to send (`canSend` when the screen gives none): the text is not
/// blank.
pub fn has_text_to_send(text: &str) -> bool {
    !text.trim().is_empty()
}

/// A suggestion list shows this many rows, then it scrolls (`MAX_SHOWN`).
pub const SUGGESTIONS_SHOWN: usize = 6;

/// The Remove button of a queued or uploading file: "Remove notes.txt".
pub fn remove_name(file: &str) -> String {
    format!("Remove {file}")
}

/// The upload bar of a file on its way: "Uploading notes.txt".
pub fn uploading_name(file: &str) -> String {
    format!("Uploading {file}")
}

/// The Retry button of a failed upload: "Retry uploading notes.txt".
pub fn retry_name(file: &str) -> String {
    format!("Retry uploading {file}")
}
