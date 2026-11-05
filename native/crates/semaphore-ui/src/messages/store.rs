//! The rows on screen: `Arc<MessageRow>` in `seq` order, changed only by core's `ListOp`s.

use semaphore_core::model::{ListOp, MessageRow};
use std::collections::VecDeque;
use std::ops::Range;
use std::sync::Arc;

/// What an op did to the list's indices, for `ListState`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RowChange {
    Reset {
        count: usize,
    },
    /// `old` was replaced by `count` rows.
    Splice {
        old: Range<usize>,
        count: usize,
    },
    /// Same rows, new values.
    Replaced {
        range: Range<usize>,
    },
    Nothing,
}

#[derive(Default)]
pub struct RowStore {
    rows: VecDeque<Arc<MessageRow>>,
}

impl RowStore {
    pub fn new(rows: Vec<MessageRow>) -> Self {
        Self {
            rows: rows.into_iter().map(Arc::new).collect(),
        }
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    pub fn get(&self, ix: usize) -> Option<&Arc<MessageRow>> {
        self.rows.get(ix)
    }

    /// Seqs increase along the list, so this is a binary search.
    pub fn index_of(&self, seq: i64) -> Option<usize> {
        let ix = self.rows.partition_point(|row| row.seq < seq);
        self.rows.get(ix).filter(|row| row.seq == seq).map(|_| ix)
    }

    pub fn by_seq(&self, seq: i64) -> Option<&Arc<MessageRow>> {
        self.index_of(seq).and_then(|ix| self.rows.get(ix))
    }

    /// The rows from `first` to `last` inclusive, skipping seqs no longer in the list.
    pub fn in_seq_range(&self, first: i64, last: i64) -> impl Iterator<Item = &Arc<MessageRow>> {
        let start = self.rows.partition_point(|row| row.seq < first);
        let end = self.rows.partition_point(|row| row.seq <= last);
        self.rows.range(start..end)
    }

    pub fn iter(&self) -> impl DoubleEndedIterator<Item = &Arc<MessageRow>> {
        self.rows.iter()
    }

    /// The nearest row with text after `seq`, for keyboard selection to step into.
    pub fn next_with_text(&self, seq: i64) -> Option<&Arc<MessageRow>> {
        let start = self.rows.partition_point(|row| row.seq <= seq);
        self.rows.range(start..).find(|row| !row.display.is_empty())
    }

    /// The nearest row with text before `seq`.
    pub fn previous_with_text(&self, seq: i64) -> Option<&Arc<MessageRow>> {
        let end = self.rows.partition_point(|row| row.seq < seq);
        self.rows
            .range(..end)
            .rev()
            .find(|row| !row.display.is_empty())
    }

    /// Applies one op. An index past the end is clamped: a late op must not take the UI down.
    pub fn apply(&mut self, op: ListOp) -> RowChange {
        match op {
            ListOp::Reset { rows } => {
                self.rows = rows.into_iter().map(Arc::new).collect();
                RowChange::Reset {
                    count: self.rows.len(),
                }
            }
            ListOp::Insert { index, rows } => {
                let at = (index as usize).min(self.rows.len());
                let count = rows.len();
                if count == 0 {
                    return RowChange::Nothing;
                }
                if at == 0 {
                    for row in rows.into_iter().rev() {
                        self.rows.push_front(Arc::new(row));
                    }
                } else {
                    let tail = self.rows.split_off(at);
                    self.rows.extend(rows.into_iter().map(Arc::new));
                    self.rows.extend(tail);
                }
                RowChange::Splice { old: at..at, count }
            }
            ListOp::Remove { index, count } => {
                let start = (index as usize).min(self.rows.len());
                let end = start.saturating_add(count as usize).min(self.rows.len());
                if start == end {
                    return RowChange::Nothing;
                }
                self.rows.drain(start..end);
                RowChange::Splice {
                    old: start..end,
                    count: 0,
                }
            }
            ListOp::Replace { index, rows } => {
                let start = (index as usize).min(self.rows.len());
                let end = start.saturating_add(rows.len()).min(self.rows.len());
                for (slot, row) in self.rows.range_mut(start..end).zip(rows) {
                    *slot = Arc::new(row);
                }
                if start == end {
                    RowChange::Nothing
                } else {
                    RowChange::Replaced { range: start..end }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(seq: i64) -> MessageRow {
        MessageRow {
            seq,
            display: format!("m{seq}"),
            ..MessageRow::default()
        }
    }

    fn seqs(store: &RowStore) -> Vec<i64> {
        store.iter().map(|row| row.seq).collect()
    }

    #[test]
    fn ops_keep_order_and_report_their_splice() {
        let mut store = RowStore::new(vec![row(10), row(20)]);
        assert_eq!(
            store.apply(ListOp::Insert {
                index: 0,
                rows: vec![row(1), row(2)],
            }),
            RowChange::Splice {
                old: 0..0,
                count: 2
            }
        );
        assert_eq!(seqs(&store), [1, 2, 10, 20]);
        assert_eq!(store.index_of(10), Some(2));
        assert_eq!(store.index_of(11), None);

        store.apply(ListOp::Insert {
            index: 3,
            rows: vec![row(15)],
        });
        assert_eq!(seqs(&store), [1, 2, 10, 15, 20]);

        assert_eq!(
            store.apply(ListOp::Remove { index: 1, count: 2 }),
            RowChange::Splice {
                old: 1..3,
                count: 0
            }
        );
        assert_eq!(seqs(&store), [1, 15, 20]);
    }

    #[test]
    fn an_op_past_the_end_is_clamped() {
        let mut store = RowStore::new(vec![row(1)]);
        assert_eq!(
            store.apply(ListOp::Remove { index: 9, count: 1 }),
            RowChange::Nothing
        );
        assert_eq!(
            store.apply(ListOp::Replace {
                index: 9,
                rows: vec![row(2)],
            }),
            RowChange::Nothing
        );
        assert_eq!(
            store.apply(ListOp::Insert {
                index: 9,
                rows: vec![row(2)],
            }),
            RowChange::Splice {
                old: 1..1,
                count: 1
            }
        );
    }

    #[test]
    fn text_steps_skip_rows_with_none() {
        let mut empty = row(2);
        empty.display.clear();
        let store = RowStore::new(vec![row(1), empty, row(3)]);
        assert_eq!(store.next_with_text(1).map(|r| r.seq), Some(3));
        assert_eq!(store.previous_with_text(3).map(|r| r.seq), Some(1));
        assert!(store.next_with_text(3).is_none());
        assert_eq!(
            store.in_seq_range(2, 3).map(|r| r.seq).collect::<Vec<_>>(),
            [2, 3]
        );
    }
}
