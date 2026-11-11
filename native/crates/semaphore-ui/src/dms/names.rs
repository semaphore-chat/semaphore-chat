//! What a DM row says, with no GPUI in it: its name (`getCompactDmName`, `getDmDisplayName`), its
//! preview, its time (`formatLastMessageTime`) and its unread badge (`DmListItem`).

use semaphore_core::model::{DmRow, UserView};

/// Show every name up to this many; beyond it, the first `COLLAPSED_NAMES` and "+ N".
const MAX_FULL_NAMES: usize = 3;
const COLLAPSED_NAMES: usize = 2;

/// A DM's one-line name: `names` may be cut with an ellipsis, `+ extra` never is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactName {
    /// "Ava, Ben", or the whole name when nothing is folded.
    pub names: String,
    /// How many members "+ N" stands for; 0 when none.
    pub extra: usize,
    /// Every name, for the accessible label and the header.
    pub full: String,
}

/// A user's name as the web shows it: the display name, else the username.
pub fn user_name(user: &UserView) -> String {
    user.display_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| user.username.clone())
}

/// `getDmDisplayName`: a group's own name, the other person in a 1:1, or the members' names.
pub fn dm_title(row: &DmRow) -> String {
    dm_name(row).full
}

/// `getCompactDmName`. `DmRow::members` already leaves this user out.
pub fn dm_name(row: &DmRow) -> CompactName {
    let whole = |name: String| CompactName {
        names: name.clone(),
        extra: 0,
        full: name,
    };
    if let Some(name) = row.name.clone().filter(|name| !name.trim().is_empty()) {
        return whole(name);
    }
    let names: Vec<String> = row.members.iter().map(user_name).collect();
    if !row.is_group {
        return whole(
            names
                .into_iter()
                .next()
                .unwrap_or_else(|| "Unknown User".to_owned()),
        );
    }
    if names.is_empty() {
        return whole("Group Chat".to_owned());
    }
    let full = names.join(", ");
    if names.len() <= MAX_FULL_NAMES {
        return whole(full);
    }
    CompactName {
        names: names[..COLLAPSED_NAMES].join(", "),
        extra: names.len() - COLLAPSED_NAMES,
        full,
    }
}

/// The row's second line: the newest message's text, "Message" for one with no text (only an
/// attachment), or "No messages yet".
pub fn dm_preview(row: &DmRow) -> String {
    match &row.last_message {
        None => "No messages yet".to_owned(),
        Some(last) => {
            let text = last.text.split_whitespace().collect::<Vec<_>>().join(" ");
            if text.is_empty() {
                "Message".to_owned()
            } else {
                text
            }
        }
    }
}

/// `formatLastMessageTime`: "Just now", "5m ago", "3h ago", "2d ago".
pub fn last_message_time(now_ms: i64, sent_at_ms: i64) -> String {
    let diff = (now_ms - sent_at_ms).max(0);
    let hours = diff / 3_600_000;
    let days = hours / 24;
    if days > 0 {
        format!("{days}d ago")
    } else if hours > 0 {
        format!("{hours}h ago")
    } else {
        let minutes = diff / 60_000;
        if minutes > 0 {
            format!("{minutes}m ago")
        } else {
            "Just now".to_owned()
        }
    }
}

/// `DmListItem`'s single unread mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnreadMark {
    /// One unread message.
    Dot,
    /// More: drawn capped at "99+".
    Count(u32),
}

/// The larger of the two counts, none on the open conversation.
pub fn unread_mark(unread: u32, mentions: u32, selected: bool) -> Option<UnreadMark> {
    let count = unread.max(mentions);
    match count {
        _ if selected => None,
        0 => None,
        1 => Some(UnreadMark::Dot),
        count => Some(UnreadMark::Count(count)),
    }
}

/// The accessible name of a row, which carries what the badge shows.
pub fn row_label(row: &DmRow, selected: bool) -> String {
    let mut label = dm_name(row).full;
    if let Some(mark) = unread_mark(row.unread, row.mentions, selected) {
        let count = match mark {
            UnreadMark::Dot => 1,
            UnreadMark::Count(count) => count,
        };
        label.push_str(&format!(", {count} unread"));
    }
    label
}
