//! The composer's text rules. No GPUI, so they are tested as plain functions.
//!
//! `get_current_mention` and `insert_mention` are the names U6 exposes from `core/src/text`. These
//! local versions port `frontend/src/utils/mentionParser.ts` so the composer works until U6 lands;
//! then this part of the file goes and `view.rs` imports U6's instead. Offsets here are bytes, where
//! the web's are UTF-16 units, because the kit's caret is a byte offset.

use semaphore_core::model::{DraftMention, MentionCandidate, MentionKind};
use std::ops::Range;
use std::time::Duration;

/// Which character opened the mention under the caret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MentionTrigger {
    /// `@`: users, aliases and special mentions.
    At,
    /// `#`: channels.
    Hash,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentMention {
    pub trigger: MentionTrigger,
    pub query: String,
    pub start: usize,
    pub end: usize,
}

fn is_mention_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

/// The mention being typed at `cursor`: looks back over word characters for `@` or `#`. As on the
/// web, `\w` is ASCII, so a non-ASCII character ends the search, and an email address matches.
pub fn get_current_mention(text: &str, cursor: usize) -> Option<CurrentMention> {
    let bytes = text.as_bytes();
    let mut start = cursor.min(bytes.len());
    let end = start;
    while start > 0 {
        let byte = bytes[start - 1];
        let trigger = match byte {
            b'@' => Some(MentionTrigger::At),
            b'#' => Some(MentionTrigger::Hash),
            _ => None,
        };
        if let Some(trigger) = trigger {
            return Some(CurrentMention {
                trigger,
                query: text[start..end].to_owned(),
                start: start - 1,
                end,
            });
        }
        if !is_mention_byte(byte) {
            return None;
        }
        start -= 1;
    }
    None
}

/// Replaces the mention being typed, or inserts at the caret if none is. Returns the text and the
/// caret after it. `insert_text` carries its own `@` or `#`; a space follows it, as on the web.
pub fn insert_mention(text: &str, cursor: usize, insert_text: &str) -> (String, usize) {
    let range = get_current_mention(text, cursor)
        .map(|mention| mention.start..mention.end)
        .unwrap_or(cursor..cursor);
    let mut out = String::with_capacity(text.len() + insert_text.len() + 1);
    out.push_str(&text[..range.start]);
    out.push_str(insert_text);
    out.push(' ');
    let caret = out.len();
    out.push_str(&text[range.end..]);
    (out, caret)
}

/// Finds the mentions in outgoing text. `picked` are the ones chosen from the dropdown, whose
/// insert text may hold characters a typed token can't. `lookup` resolves a typed `@name`, which on
/// the web also becomes a mention without going through the dropdown. Text the user changed after
/// picking simply no longer matches, which is why ranges aren't tracked through edits.
pub fn resolve_mentions(
    text: &str,
    picked: &[MentionCandidate],
    lookup: impl Fn(&str) -> Option<MentionCandidate>,
) -> Vec<DraftMention> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let is_start = matches!(bytes[at], b'@' | b'#')
            && (at == 0 || !(is_mention_byte(bytes[at - 1]) || bytes[at - 1] == b'.'));
        if !is_start {
            at += 1;
            continue;
        }
        let rest = &text[at..];
        let pick = picked
            .iter()
            .filter(|candidate| {
                rest.starts_with(candidate.insert_text.as_str())
                    && !rest[candidate.insert_text.len()..]
                        .bytes()
                        .next()
                        .is_some_and(is_mention_byte)
            })
            .max_by_key(|candidate| candidate.insert_text.len())
            .cloned();
        let token_len = 1 + rest[1..]
            .bytes()
            .take_while(|b| is_mention_byte(*b))
            .count();
        let candidate = pick.or_else(|| (token_len > 1).then(|| lookup(&rest[..token_len]))?);
        match candidate {
            Some(candidate) => {
                let end = at + candidate.insert_text.len();
                found.push(DraftMention {
                    start: at as u32,
                    end: end as u32,
                    kind: candidate.kind,
                    id: candidate.id,
                });
                at = end;
            }
            None => at += token_len,
        }
    }
    found
}

/// The dropdown's heading for what it lists, as `MentionDropdown` chooses it.
pub fn menu_heading(candidates: &[MentionCandidate]) -> &'static str {
    let Some(first) = candidates.first() else {
        return "Suggestions";
    };
    if candidates.iter().any(|c| c.kind != first.kind) {
        return "Suggestions";
    }
    match first.kind {
        MentionKind::User => "Members",
        MentionKind::Alias => "Mention Groups",
        MentionKind::Special => "Special Mentions",
        MentionKind::Channel => "Channels",
    }
}

/// What Ctrl/Cmd+B or I does: the text and the selection after it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wrapped {
    pub text: String,
    pub selection: Range<usize>,
}

/// Port of `wrapSelection` in `richTextShortcuts.ts`: wraps the selection in `marker`, or takes the
/// marker off if it is already there, just outside the selection or just inside it.
pub fn wrap_selection(text: &str, selection: Range<usize>, marker: &str) -> Wrapped {
    let before = &text[..selection.start];
    let selected = &text[selection.clone()];
    let after = &text[selection.end..];
    let len = marker.len();
    if before.ends_with(marker) && after.starts_with(marker) {
        let start = selection.start - len;
        return Wrapped {
            text: format!("{}{selected}{}", &before[..start], &after[len..]),
            selection: start..start + selected.len(),
        };
    }
    if selected.starts_with(marker) && selected.ends_with(marker) && selected.len() >= len * 2 {
        let inner = &selected[len..selected.len() - len];
        return Wrapped {
            text: format!("{before}{inner}{after}"),
            selection: selection.start..selection.start + inner.len(),
        };
    }
    let start = selection.start + len;
    Wrapped {
        text: format!("{before}{marker}{selected}{marker}{after}"),
        selection: start..start + selected.len(),
    }
}

/// The marker for a formatting key, as `markerForShortcut`.
pub fn marker_for_shortcut(key: &str) -> Option<&'static str> {
    match key {
        "b" | "B" => Some("**"),
        "i" | "I" => Some("_"),
        _ => None,
    }
}

/// `formatTimeLeft`: "12 min", "2 h 5 min", "42 s". Rounded up, so it never reads "0".
pub fn format_time_left(left: Duration) -> String {
    let seconds = left.as_millis().div_ceil(1000).max(1);
    if seconds < 60 {
        return format!("{seconds} s");
    }
    let minutes = seconds.div_ceil(60);
    if minutes < 60 {
        return format!("{minutes} min");
    }
    match (minutes / 60, minutes % 60) {
        (hours, 0) => format!("{hours} h"),
        (hours, minutes) => format!("{hours} h {minutes} min"),
    }
}

/// `formatRoleList`, for the read-only notice.
pub fn format_role_list(roles: &[String]) -> String {
    match roles {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// `replySnippet`'s whitespace rule, so a multi-line message previews on one line.
pub fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(kind: MentionKind, id: &str, insert: &str) -> MentionCandidate {
        MentionCandidate {
            kind,
            id: id.into(),
            label: insert[1..].into(),
            insert_text: insert.into(),
            avatar_file_id: None,
        }
    }

    #[test]
    fn current_mention_follows_the_web_rules() {
        let at = |text: &str| get_current_mention(text, text.len());
        assert_eq!(at("hi @av").unwrap().query, "av");
        assert_eq!(at("hi @av").unwrap().start, 3);
        assert_eq!(at("hi @").unwrap().query, "");
        assert_eq!(at("see #gen").unwrap().trigger, MentionTrigger::Hash);
        assert_eq!(at("hi @a b"), None);
        assert_eq!(at("plain"), None);
        // Web quirk kept: `\w` runs back to the `@` of an address.
        assert_eq!(at("me@host").unwrap().query, "host");
        // The caret, not the end of the text, decides.
        assert_eq!(get_current_mention("@av more", 3).unwrap().query, "av");
        // A non-ASCII character ends the search, and its bytes must not panic.
        assert_eq!(at("@日本"), None);
    }

    #[test]
    fn insert_mention_replaces_the_query_and_adds_a_space() {
        assert_eq!(
            insert_mention("hi @av there", 6, "@ava"),
            ("hi @ava  there".to_owned(), 8)
        );
        assert_eq!(insert_mention("hi ", 3, "@ava"), ("hi @ava ".to_owned(), 8));
    }

    #[test]
    fn typed_and_picked_mentions_both_resolve_with_byte_ranges() {
        let ava = candidate(MentionKind::User, "u1", "@ava");
        let crew = candidate(MentionKind::Alias, "a1", "@night crew");
        let lookup =
            |token: &str| (token == "@ben").then(|| candidate(MentionKind::User, "u2", "@ben"));
        let mentions = resolve_mentions(
            "日本 @ava, @ben @night crew @nobody a@ava",
            &[ava, crew],
            lookup,
        );
        let got: Vec<_> = mentions
            .iter()
            .map(|m| (m.start, m.end, m.id.as_str()))
            .collect();
        assert_eq!(got, [(7, 11, "u1"), (13, 17, "u2"), (18, 29, "a1")]);
    }

    #[test]
    fn a_picked_mention_the_user_then_edited_is_not_a_mention() {
        let ava = candidate(MentionKind::User, "u1", "@ava");
        assert!(resolve_mentions("@avalon", &[ava], |_| None).is_empty());
    }

    #[test]
    fn heading_names_one_kind_and_mixed_is_suggestions() {
        let user = candidate(MentionKind::User, "u", "@u");
        let alias = candidate(MentionKind::Alias, "a", "@a");
        assert_eq!(menu_heading(std::slice::from_ref(&user)), "Members");
        assert_eq!(menu_heading(std::slice::from_ref(&alias)), "Mention Groups");
        assert_eq!(menu_heading(&[user, alias]), "Suggestions");
    }

    #[test]
    fn wrap_selection_matches_rich_text_shortcuts() {
        assert_eq!(
            wrap_selection("hello", 0..5, "**"),
            Wrapped {
                text: "**hello**".into(),
                selection: 2..7
            }
        );
        assert_eq!(
            wrap_selection("hi", 2..2, "_"),
            Wrapped {
                text: "hi__".into(),
                selection: 3..3
            }
        );
        assert_eq!(
            wrap_selection("**hello**", 2..7, "**"),
            Wrapped {
                text: "hello".into(),
                selection: 0..5
            }
        );
        assert_eq!(
            wrap_selection("**hello**", 0..9, "**"),
            Wrapped {
                text: "hello".into(),
                selection: 0..5
            }
        );
    }

    #[test]
    fn time_left_rounds_up_and_never_reads_zero() {
        let s = Duration::from_secs;
        assert_eq!(format_time_left(Duration::from_millis(1)), "1 s");
        assert_eq!(format_time_left(s(42)), "42 s");
        assert_eq!(format_time_left(s(61)), "2 min");
        assert_eq!(format_time_left(s(3600)), "1 h");
        assert_eq!(format_time_left(s(2 * 3600 + 5 * 60)), "2 h 5 min");
    }

    #[test]
    fn role_lists_read_as_english() {
        let roles = |names: &[&str]| names.iter().map(|n| (*n).to_owned()).collect::<Vec<_>>();
        assert_eq!(format_role_list(&roles(&["Admins"])), "Admins");
        assert_eq!(format_role_list(&roles(&["A", "B"])), "A and B");
        assert_eq!(format_role_list(&roles(&["A", "B", "C"])), "A, B and C");
    }
}
