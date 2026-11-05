//! The mention being typed in the composer, and inserting a picked one. From `mentionParser.ts`
//! (`getCurrentMention`, `insertMention`, `resolveMentionText`). Offsets are bytes into the text.

use super::SpanInput;
use super::compose::UserRef;
use super::js::{char_before, is_name};
use super::shortcuts::floor_boundary;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    User,
    Special,
    Channel,
}

/// A `@query` or `#query` the cursor is at the end of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentMention {
    pub kind: Trigger,
    pub query: String,
    /// Includes the `@` or `#`.
    pub start: usize,
    pub end: usize,
}

/// The mention being typed at `cursor`, if any.
pub fn get_current_mention(text: &str, cursor: usize) -> Option<CurrentMention> {
    text.get(..cursor)?;
    let mut start = cursor;
    while start > 0 {
        let c = char_before(text, start)?;
        match c {
            '@' | '#' => {
                let query = &text[start..cursor];
                let kind = match c {
                    '#' => Trigger::Channel,
                    _ if query == "here" || query == "channel" => Trigger::Special,
                    _ => Trigger::User,
                };
                return Some(CurrentMention {
                    kind,
                    query: query.to_owned(),
                    start: start - 1,
                    end: cursor,
                });
            }
            c if is_name(c) => start -= c.len_utf8(),
            _ => break,
        }
    }
    None
}

/// What the picker inserted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MentionTarget {
    User(String),
    Special(String),
    Channel(String),
    Alias(String),
}

impl MentionTarget {
    fn insert_text(&self) -> String {
        match self {
            Self::User(name) | Self::Special(name) | Self::Alias(name) => format!("@{name} "),
            Self::Channel(name) => format!("#{name} "),
        }
    }
}

/// Replace the mention being typed with `target` and a trailing space, or insert at the cursor.
/// Returns the new text and the cursor after the inserted mention.
pub fn insert_mention(text: &str, cursor: usize, target: &MentionTarget) -> (String, usize) {
    let cursor = floor_boundary(text, cursor);
    let insert = target.insert_text();
    let (from, to) = get_current_mention(text, cursor)
        .map_or((cursor, cursor), |current| (current.start, current.end));
    (
        format!("{}{}{}", &text[..from], insert, &text[to..]),
        from + insert.len(),
    )
}

/// A mention's text for display (`resolveMentionText`): a user shows their display name.
pub fn resolve_mention_text(span: &SpanInput, users: &[UserRef]) -> String {
    let text = span.text.clone().unwrap_or_default();
    match span.kind.as_str() {
        "USER_MENTION" => {
            let user = span
                .user_id
                .as_deref()
                .and_then(|id| users.iter().find(|u| u.id == id));
            match user {
                Some(u) => format!(
                    "@{}",
                    u.display_name
                        .as_deref()
                        .filter(|d| !d.is_empty())
                        .unwrap_or(&u.username)
                ),
                None if text.is_empty() => "@unknown".into(),
                None => text,
            }
        }
        "SPECIAL_MENTION" if text.is_empty() => {
            format!("@{}", span.special_kind.as_deref().unwrap_or_default())
        }
        _ => text,
    }
}
