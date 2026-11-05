//! The few JavaScript regex classes the web rules depend on. `\w` is ASCII-only in JavaScript, and
//! `\s` and `trim()` use a whitespace set that differs from Rust's at U+0085 and U+FEFF.

/// JavaScript `\s`, which is also what `String.prototype.trim` strips.
pub(crate) fn is_space(c: char) -> bool {
    match c {
        '\u{85}' => false,
        '\u{FEFF}' => true,
        c => c.is_whitespace(),
    }
}

/// JavaScript `\w`.
pub(crate) fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// A character of a mention name: `[\w\-_]`.
pub(crate) fn is_name(c: char) -> bool {
    is_word(c) || c == '-'
}

pub(crate) fn trim(s: &str) -> &str {
    s.trim_matches(is_space)
}

/// The character that ends at byte offset `at`.
pub(crate) fn char_before(s: &str, at: usize) -> Option<char> {
    s.get(..at)?.chars().next_back()
}

/// `s.indexOf(needle, from)`, as a byte offset.
pub(crate) fn find_from(s: &str, needle: &str, from: usize) -> Option<usize> {
    s.get(from..)?.find(needle).map(|i| i + from)
}
