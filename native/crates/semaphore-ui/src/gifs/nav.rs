//! Arrow movement over the picker's two-column grid, as the emoji picker's `grid` does over its
//! sections. The results are one grid, so there is nowhere to run off to: a key that would leave it
//! stays put.

/// `gridTemplateColumns: "repeat(2, 1fr)"` in the web's `GifPickerContent`.
pub(crate) const COLUMNS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NavKey {
    Up,
    Down,
    Left,
    Right,
}

impl NavKey {
    /// GPUI's key name, for keys that reach the picker itself rather than the search field.
    pub fn from_key(key: &str) -> Option<Self> {
        Some(match key {
            "up" => Self::Up,
            "down" => Self::Down,
            "left" => Self::Left,
            "right" => Self::Right,
            _ => return None,
        })
    }
}

/// Where `key` moves from `current` over `count` results, with the emoji grid's rules for the ends
/// of a row and of the grid.
pub(crate) fn next(key: NavKey, current: usize, count: usize) -> usize {
    if count == 0 {
        return 0;
    }
    let current = current.min(count - 1);
    match key {
        NavKey::Right if current + 1 < count => current + 1,
        NavKey::Left if current > 0 => current - 1,
        NavKey::Down if current + COLUMNS < count => current + COLUMNS,
        NavKey::Up if current >= COLUMNS => current - COLUMNS,
        _ => current,
    }
}
