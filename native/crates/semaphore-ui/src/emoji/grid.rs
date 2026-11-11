//! Keyboard movement over the picker's grid, as `utils/emojiGridNavigation.ts`: the sections are
//! fixed-column grids of uneven length stacked one after another, and running off one moves into
//! the next, keeping the column where the row allows.

/// `EMOJI_GRID_COLUMNS`.
pub(crate) const COLUMNS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NavKey {
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
}

impl NavKey {
    /// GPUI's key name, for keys that reach the picker itself rather than the search field.
    pub fn from_key(key: &str) -> Option<Self> {
        Some(match key {
            "up" => Self::Up,
            "down" => Self::Down,
            "left" => Self::Left,
            "right" => Self::Right,
            "home" => Self::Home,
            "end" => Self::End,
            "pageup" => Self::PageUp,
            "pagedown" => Self::PageDown,
            _ => return None,
        })
    }
}

/// A cell: which section, and where in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Pos {
    pub section: usize,
    pub index: usize,
}

/// Where `key` moves from `current`, over sections holding `counts` cells each. Unchanged when the
/// key goes nowhere (Left on the very first cell). Empty sections must not be passed.
pub(crate) fn next(key: NavKey, current: Pos, counts: &[usize], columns: usize) -> Pos {
    let Some(&count) = counts.get(current.section) else {
        return current;
    };
    let Pos { section, index } = current;
    let at = |section: usize, index: usize| Pos { section, index };
    let clamp = |section: usize, index: usize| at(section, index.min(counts[section] - 1));
    match key {
        NavKey::Right if index + 1 < count => at(section, index + 1),
        NavKey::Right if section + 1 < counts.len() => at(section + 1, 0),
        NavKey::Left if index > 0 => at(section, index - 1),
        NavKey::Left if section > 0 => at(section - 1, counts[section - 1] - 1),
        NavKey::Down if index + columns < count => at(section, index + columns),
        NavKey::Down if section + 1 < counts.len() => clamp(section + 1, index % columns),
        NavKey::Up if index >= columns => at(section, index - columns),
        NavKey::Up if section > 0 => {
            let previous = counts[section - 1];
            let last_row_start = (previous - 1) / columns * columns;
            clamp(section - 1, last_row_start + index % columns)
        }
        NavKey::Home => at(section, index / columns * columns),
        NavKey::End => at(
            section,
            (index / columns * columns + columns - 1).min(count - 1),
        ),
        NavKey::PageDown if section + 1 < counts.len() => at(section + 1, 0),
        NavKey::PageUp if section > 0 => at(section - 1, 0),
        NavKey::PageUp => at(section, 0),
        _ => current,
    }
}

/// How many rows a section of `count` cells takes.
pub(crate) fn rows(count: usize, columns: usize) -> usize {
    count.div_ceil(columns)
}
