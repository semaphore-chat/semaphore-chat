//! Selection held in message coordinates, so it doesn't depend on which rows are mounted.
//!
//! An endpoint is a core `seq` and a byte in the row's display string. Message ids are UUIDs and
//! give no order; a pending row has none at all, and its seq doesn't change when the ack arrives.
//! Nothing here refers to an element, a pixel or a list index, so rows may unmount, remount, change
//! height or move when older ones are prepended. Copying reads the store, never what's painted.

use super::store::RowStore;
use super::text;
use semaphore_core::model::MessageRow;
use std::ops::Range;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Pos {
    pub seq: i64,
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

    /// First and last seq, for `Core::hold_rows`.
    pub fn seq_range(&self) -> (i64, i64) {
        let (start, end) = self.ordered();
        (start.seq, end.seq)
    }

    pub fn covers(&self, seq: i64) -> bool {
        let (first, last) = self.seq_range();
        (first..=last).contains(&seq)
    }

    /// The selected display bytes of one row, if any. An endpoint past the row's end (an edit can
    /// shorten a row under a held selection) counts as its end.
    pub fn range_in(&self, row: &MessageRow) -> Option<Range<u32>> {
        let (start, end) = self.ordered();
        if row.seq < start.seq || row.seq > end.seq {
            return None;
        }
        let len = row.display.len() as u32;
        let from = if row.seq == start.seq {
            start.byte.min(len)
        } else {
            0
        };
        let to = if row.seq == end.seq {
            end.byte.min(len)
        } else {
            len
        };
        (from < to).then_some(from..to)
    }
}

/// The selected text in row order, one line per row that contributes any.
pub fn copy_text(rows: &RowStore, selection: Selection) -> String {
    let (first, last) = selection.seq_range();
    let mut out = String::new();
    for row in rows.in_seq_range(first, last) {
        let Some(range) = selection.range_in(row) else {
            continue;
        };
        let text = text::copy_range(row, range);
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

/// Everything loaded. `None` if no row has text.
pub fn select_all(rows: &RowStore) -> Option<Selection> {
    let first = rows.iter().find(|row| !row.display.is_empty())?;
    let last = rows.iter().rev().find(|row| !row.display.is_empty())?;
    Some(Selection {
        anchor: Pos {
            seq: first.seq,
            byte: 0,
        },
        cursor: Pos {
            seq: last.seq,
            byte: last.display.len() as u32,
        },
    })
}

/// What a press selects and a drag extends by: one, two or three clicks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unit {
    Char,
    Word,
    Line,
}

impl Unit {
    pub fn from_click_count(count: usize) -> Self {
        match count {
            0 | 1 => Unit::Char,
            2 => Unit::Word,
            _ => Unit::Line,
        }
    }

    /// The bytes this unit covers at `byte` in `row`.
    pub fn range(self, row: &MessageRow, byte: u32) -> Range<u32> {
        match self {
            Unit::Char => byte..byte,
            Unit::Word => text::word_range(row, byte),
            Unit::Line => text::line_range(row, byte),
        }
    }
}

/// A selection grown by mouse from a first unit: the word or line under the first press stays
/// selected whichever way the drag goes, and the far end moves a whole unit at a time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UnitDrag {
    pub unit: Unit,
    /// Start and end of the first unit.
    pub first: (Pos, Pos),
}

impl UnitDrag {
    pub fn start(unit: Unit, row: &MessageRow, byte: u32) -> Self {
        let range = unit.range(row, byte);
        Self {
            unit,
            first: (
                Pos {
                    seq: row.seq,
                    byte: range.start,
                },
                Pos {
                    seq: row.seq,
                    byte: range.end,
                },
            ),
        }
    }

    /// The selection with the pointer at `hit`.
    pub fn to(&self, row: &MessageRow, hit: Pos) -> Selection {
        let range = self.unit.range(row, hit.byte);
        if hit < self.first.0 {
            Selection {
                anchor: self.first.1,
                cursor: Pos {
                    seq: hit.seq,
                    byte: range.start,
                },
            }
        } else if hit > self.first.1 {
            Selection {
                anchor: self.first.0,
                cursor: Pos {
                    seq: hit.seq,
                    byte: range.end,
                },
            }
        } else {
            Selection {
                anchor: self.first.0,
                cursor: self.first.1,
            }
        }
    }
}

/// A keyboard step that doesn't need layout. Up and down do, and live in the view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motion {
    PreviousChar,
    NextChar,
    PreviousWord,
    NextWord,
    LineStart,
    LineEnd,
    FirstRow,
    LastRow,
}

/// Where `motion` takes `pos`. Stepping off either end of a row lands in the nearest row with text;
/// off the end of the list stays put.
pub fn step(rows: &RowStore, pos: Pos, motion: Motion) -> Pos {
    let Some(row) = rows.by_seq(pos.seq) else {
        return pos;
    };
    let display = row.display.as_str();
    let into_previous = || {
        rows.previous_with_text(pos.seq).map_or(pos, |row| Pos {
            seq: row.seq,
            byte: row.display.len() as u32,
        })
    };
    let into_next = || {
        rows.next_with_text(pos.seq).map_or(pos, |row| Pos {
            seq: row.seq,
            byte: 0,
        })
    };
    let at = |byte| Pos { seq: pos.seq, byte };
    match motion {
        Motion::PreviousChar => {
            text::previous_char(display, pos.byte).map_or_else(into_previous, at)
        }
        Motion::NextChar => text::next_char(display, pos.byte).map_or_else(into_next, at),
        Motion::PreviousWord => {
            text::previous_word(display, pos.byte).map_or_else(into_previous, at)
        }
        Motion::NextWord => text::next_word(display, pos.byte).map_or_else(into_next, at),
        Motion::LineStart => at(text::line_range(row, pos.byte).start),
        Motion::LineEnd => at(text::line_range(row, pos.byte).end),
        Motion::FirstRow => rows
            .iter()
            .find(|row| !row.display.is_empty())
            .map_or(pos, |row| Pos {
                seq: row.seq,
                byte: 0,
            }),
        Motion::LastRow => rows
            .iter()
            .rev()
            .find(|row| !row.display.is_empty())
            .map_or(pos, |row| Pos {
                seq: row.seq,
                byte: row.display.len() as u32,
            }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::{ListOp, SegKind, TextSeg, TextStyle};
    use semaphore_core::text::EMOJI_PLACEHOLDER;

    fn row(seq: i64, display: &str) -> MessageRow {
        MessageRow {
            seq,
            // Real ids are UUIDs: nothing here may read them as numbers or order by them.
            id: Some(format!("0190a0d4-{seq:04x}-7000-8000-00000000fffe")),
            display: display.into(),
            segs: vec![TextSeg {
                end: display.len() as u32,
                kind: SegKind::Text,
                style: TextStyle::default(),
            }],
            ..MessageRow::default()
        }
    }

    fn store() -> RowStore {
        RowStore::new(vec![
            row(1, "alpha beta"),
            row(2, ""),
            row(5, "gamma"),
            row(9, "delta\nepsilon"),
        ])
    }

    fn pos(seq: i64, byte: u32) -> Pos {
        Pos { seq, byte }
    }

    #[test]
    fn copy_is_the_same_whichever_way_the_drag_went() {
        let store = store();
        let forward = Selection {
            anchor: pos(1, 6),
            cursor: pos(9, 5),
        };
        let backward = Selection {
            anchor: forward.cursor,
            cursor: forward.anchor,
        };
        assert_eq!(copy_text(&store, forward), "beta\ngamma\ndelta");
        assert_eq!(copy_text(&store, backward), "beta\ngamma\ndelta");
    }

    #[test]
    fn a_selection_survives_rows_arriving_and_leaving() {
        let mut store = store();
        let selection = Selection {
            anchor: pos(5, 0),
            cursor: pos(9, 5),
        };
        assert_eq!(copy_text(&store, selection), "gamma\ndelta");
        store.apply(ListOp::Insert {
            index: 0,
            rows: vec![row(-3, "older")],
        });
        assert_eq!(copy_text(&store, selection), "gamma\ndelta");
        // The row holding the anchor is deleted: what's left of the range still copies.
        store.apply(ListOp::Remove { index: 3, count: 1 });
        assert_eq!(copy_text(&store, selection), "delta");
    }

    #[test]
    fn an_edit_that_shortens_a_row_clamps_the_endpoint() {
        let mut store = RowStore::new(vec![row(1, "a long message")]);
        let selection = Selection {
            anchor: pos(1, 2),
            cursor: pos(1, 14),
        };
        store.apply(ListOp::Replace {
            index: 0,
            rows: vec![row(1, "a é")],
        });
        // Byte 2 now starts 'é' and the end is past the row.
        assert_eq!(copy_text(&store, selection), "é");
    }

    #[test]
    fn select_all_skips_rows_with_no_text() {
        let store = RowStore::new(vec![row(1, ""), row(2, "x"), row(3, "yz"), row(4, "")]);
        assert_eq!(
            select_all(&store),
            Some(Selection {
                anchor: pos(2, 0),
                cursor: pos(3, 2),
            })
        );
        assert_eq!(select_all(&RowStore::new(vec![row(1, "")])), None);
    }

    #[test]
    fn stepping_crosses_rows_with_text_and_stops_at_the_ends() {
        let store = store();
        assert_eq!(step(&store, pos(1, 10), Motion::NextChar), pos(5, 0));
        assert_eq!(step(&store, pos(5, 0), Motion::PreviousChar), pos(1, 10));
        assert_eq!(step(&store, pos(1, 0), Motion::PreviousChar), pos(1, 0));
        assert_eq!(step(&store, pos(9, 13), Motion::NextChar), pos(9, 13));
        assert_eq!(step(&store, pos(9, 8), Motion::LineStart), pos(9, 6));
        assert_eq!(step(&store, pos(9, 2), Motion::LineEnd), pos(9, 5));
        assert_eq!(step(&store, pos(5, 2), Motion::FirstRow), pos(1, 0));
        assert_eq!(step(&store, pos(5, 2), Motion::LastRow), pos(9, 13));
        assert_eq!(step(&store, pos(1, 0), Motion::NextWord), pos(1, 5));
        assert_eq!(step(&store, pos(1, 10), Motion::NextWord), pos(5, 0));
        assert_eq!(step(&store, pos(5, 0), Motion::PreviousWord), pos(1, 10));
    }

    #[test]
    fn a_char_drag_keeps_its_anchor_and_a_word_drag_its_first_word() {
        let store = RowStore::new(vec![row(1, "one two three"), row(2, "four five")]);
        let first = store.by_seq(1).unwrap().clone();
        let second = store.by_seq(2).unwrap().clone();

        let chars = UnitDrag::start(Unit::Char, &first, 5);
        assert_eq!(
            chars.to(&second, pos(2, 2)),
            Selection {
                anchor: pos(1, 5),
                cursor: pos(2, 2)
            }
        );

        // Double-click on "two", drag forward into "five": whole words on both ends.
        let words = UnitDrag::start(Unit::Word, &first, 5);
        assert_eq!(
            words.to(&second, pos(2, 6)),
            Selection {
                anchor: pos(1, 4),
                cursor: pos(2, 9)
            }
        );
        // And back past the first word: "two" stays selected, and the far end is "one"'s start.
        assert_eq!(
            words.to(&first, pos(1, 1)),
            Selection {
                anchor: pos(1, 7),
                cursor: pos(1, 0)
            }
        );
        // Still inside the first word: just the word.
        assert_eq!(
            words.to(&first, pos(1, 6)),
            Selection {
                anchor: pos(1, 4),
                cursor: pos(1, 7)
            }
        );
    }

    #[test]
    fn an_inline_emoji_stays_whole_through_every_way_of_selecting() {
        let display = format!("hi {EMOJI_PLACEHOLDER} you");
        let emoji_end = 3 + EMOJI_PLACEHOLDER.len_utf8();
        let mut row = row(1, &display);
        row.segs = vec![
            TextSeg {
                end: 3,
                kind: SegKind::Text,
                style: TextStyle::default(),
            },
            TextSeg {
                end: emoji_end as u32,
                kind: SegKind::Emoji {
                    emoji_id: "e".into(),
                    name: "wave".into(),
                },
                style: TextStyle::default(),
            },
            TextSeg {
                end: display.len() as u32,
                kind: SegKind::Text,
                style: TextStyle::default(),
            },
        ];
        let store = RowStore::new(vec![row]);
        let word = UnitDrag::start(Unit::Word, store.by_seq(1).unwrap(), 4);
        let selection = Selection {
            anchor: word.first.0,
            cursor: word.first.1,
        };
        assert_eq!(copy_text(&store, selection), ":wave:");
        // One keyboard step takes the whole placeholder.
        assert_eq!(
            step(&store, pos(1, 3), Motion::NextChar),
            pos(1, emoji_end as u32)
        );
    }
}
