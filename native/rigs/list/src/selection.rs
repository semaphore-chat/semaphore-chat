//! Selection held in message coordinates, so it does not depend on which rows are mounted.
//!
//! An endpoint is a message id and a byte in its display string. Nothing here refers to an
//! element, a pixel or a list index, so rows may unmount, remount, change height or move when
//! older messages are prepended, and the selection and its copy text stay the same. Copying
//! reads the store and never looks at what is painted.

use crate::data::{Message, Store, copy_range};
use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Pos {
    pub id: i64,
    pub byte: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Selection {
    pub anchor: Pos,
    pub cursor: Pos,
}

impl Selection {
    pub fn ordered(&self) -> (Pos, Pos) {
        if self.anchor <= self.cursor {
            (self.anchor, self.cursor)
        } else {
            (self.cursor, self.anchor)
        }
    }

    pub fn is_empty(&self) -> bool {
        self.anchor == self.cursor
    }

    /// The selected display bytes of one message, if any.
    pub fn range_in(&self, message: &Message) -> Option<Range<u32>> {
        let (start, end) = self.ordered();
        if message.id < start.id || message.id > end.id {
            return None;
        }
        let from = if message.id == start.id {
            start.byte
        } else {
            0
        };
        let to = if message.id == end.id {
            end.byte
        } else {
            message.display.len() as u32
        };
        (from < to).then_some(from..to)
    }
}

/// The selected text in message order, one line per message that contributes any.
pub fn copy_text(store: &Store, selection: Selection) -> String {
    let (start, end) = selection.ordered();
    let mut out = String::new();
    for id in start.id..=end.id {
        let Some(message) = store.get_id(id) else {
            continue;
        };
        let Some(range) = selection.range_in(message) else {
            continue;
        };
        let text = copy_range(message, range);
        if text.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&text);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::truth;

    #[test]
    fn copy_is_the_same_whichever_way_the_drag_went_and_covers_the_ends_exactly() {
        let store = Store::new(1000, 400);
        let first = store.get_id(1010).unwrap();
        let byte = first
            .display
            .char_indices()
            .nth(5)
            .map_or(0, |(i, _)| i as u32);
        let forward = Selection {
            anchor: Pos { id: 1010, byte },
            cursor: Pos { id: 1300, byte: 3 },
        };
        let backward = Selection {
            anchor: forward.cursor,
            cursor: forward.anchor,
        };
        assert_eq!(copy_text(&store, forward), copy_text(&store, backward));

        let whole = Selection {
            anchor: Pos { id: 1000, byte: 0 },
            cursor: Pos {
                id: 1399,
                byte: store.get_id(1399).unwrap().display.len() as u32,
            },
        };
        let expected: Vec<String> = (1000..1400).map(truth).filter(|t| !t.is_empty()).collect();
        assert_eq!(copy_text(&store, whole), expected.join("\n"));
    }
}
