//! "Seen by" under the user's own latest message, after the web's `SeenByTooltip` (up to 15 names
//! and "+N more"). Who has seen it is core's answer (`Core::seen_by`, handed to
//! `MessageList::set_seen_by`); the list only decides which row it belongs to and how it reads.

use semaphore_core::model::{LoadState, MessageRow, SeenByView, SendState, UserView};

/// Names the line spells out before "+N".
pub(crate) const LINE_NAMES: usize = 2;
/// Names the tooltip lists, as the web's `MAX_TOOLTIP_READERS` and core's `SEEN_BY_NAMES`.
pub(crate) const TOOLTIP_NAMES: usize = 15;

/// The row "Seen by" goes under: the newest of my messages the server has, in a state a reader
/// can have seen (sent, not removed). Its seq and message id.
pub(crate) fn own_latest<'a>(
    rows: impl DoubleEndedIterator<Item = &'a MessageRow>,
) -> Option<(i64, String)> {
    rows.rev()
        .filter(|row| row.mine && !row.removed && matches!(row.send_state, SendState::Sent))
        .find_map(|row| row.id.clone().map(|id| (row.seq, id)))
}

pub(crate) fn name_of(user: &UserView) -> &str {
    user.display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(user.username.as_str())
}

/// What the row shows: the names part (which may be cut with an ellipsis) and the "+N" part
/// (which never is). `None` while loading, on an error, or when nobody has seen it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SeenLine {
    pub names: String,
    pub more: Option<String>,
}

/// Everyone who read it, named or not: `count`, but never fewer than the names sent.
fn total(view: &SeenByView) -> usize {
    (view.count as usize).max(view.readers.len() + view.more as usize)
}

pub(crate) fn seen_line(view: &SeenByView) -> Option<SeenLine> {
    if !matches!(view.state, LoadState::Ready) || view.readers.is_empty() {
        return None;
    }
    let named: Vec<&str> = view.readers.iter().take(LINE_NAMES).map(name_of).collect();
    let rest = total(view) - named.len();
    Some(SeenLine {
        names: format!("Seen by {}", named.join(", ")),
        more: (rest > 0).then(|| format!("+{rest}")),
    })
}

/// The tooltip: a header, up to 15 names, then "+N more" for the rest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SeenTooltip {
    pub header: String,
    pub names: Vec<String>,
    pub more: Option<String>,
}

pub(crate) fn seen_tooltip(view: &SeenByView) -> Option<SeenTooltip> {
    seen_line(view)?;
    let names: Vec<String> = view
        .readers
        .iter()
        .take(TOOLTIP_NAMES)
        .map(|user| name_of(user).to_owned())
        .collect();
    let all = total(view);
    let header = if all == 1 {
        format!("Seen by {}", names[0])
    } else {
        format!("Seen by {all}")
    };
    let rest = all - names.len();
    Some(SeenTooltip {
        header,
        names,
        more: (rest > 0).then(|| format!("+{rest} more")),
    })
}

/// What the list holds for "Seen by": the row it is for, and core's answer once it came.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SeenState {
    /// The own latest message (`own_latest`) when the rows last changed.
    pub target: Option<(i64, String)>,
    /// `set_seen_by`'s answer, with the message id it was taken for. Cleared whenever the target
    /// changes, so an answer for an older message can't be drawn under a newer one.
    pub view: Option<(String, SeenByView)>,
}

impl SeenState {
    /// The rows changed: recompute the target, dropping an answer that was for another message.
    /// True when the target moved.
    pub fn retarget(&mut self, target: Option<(i64, String)>) -> bool {
        if self.target == target {
            return false;
        }
        let keep =
            matches!((&self.view, &target), (Some((for_id, _)), Some((_, id))) if for_id == id);
        if !keep {
            self.view = None;
        }
        self.target = target;
        true
    }

    /// Core's answer for the current target. With no target it is dropped, and so is an answer
    /// that names another message (`SeenByView::message_id`, empty when it names none).
    pub fn answer(&mut self, view: Option<SeenByView>) {
        self.view = match (view, &self.target) {
            (Some(view), Some((_, id))) if view.message_id.is_empty() || view.message_id == *id => {
                Some((id.clone(), view))
            }
            _ => None,
        };
    }

    /// The view to draw under the row `seq`, if that row is the target and the answer is its own.
    pub fn for_row(&self, seq: i64) -> Option<&SeenByView> {
        let (target_seq, target_id) = self.target.as_ref()?;
        let (for_id, view) = self.view.as_ref()?;
        (*target_seq == seq && for_id == target_id).then_some(view)
    }
}
