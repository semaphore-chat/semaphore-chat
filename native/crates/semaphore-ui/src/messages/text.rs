//! What a row's display string means, with no GPUI: runs, blocks, copy text and the word and line
//! ranges multi-click selects. Coordinates are bytes in `MessageRow::display`.

use semaphore_core::model::{MessageRow, SegKind, TextStyle};
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation as _;

/// One run of the display string, with its end safe to slice at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span<'a> {
    pub range: Range<u32>,
    pub kind: &'a SegKind,
    pub style: TextStyle,
}

static PLAIN: SegKind = SegKind::Text;

/// The row's runs, contiguous and covering the whole display string whatever core sent. `segs` come
/// from the server's spans through core, and a bad boundary must not panic text layout, which
/// asserts on it. Anything uncovered at the end is plain text.
pub fn spans(row: &MessageRow) -> Vec<Span<'_>> {
    let display = row.display.as_str();
    let mut out = Vec::with_capacity(row.segs.len() + 1);
    let mut start = 0u32;
    for seg in &row.segs {
        let end = (seg.end as usize).min(display.len());
        let end = display.floor_char_boundary(end) as u32;
        if end > start {
            out.push(Span {
                range: start..end,
                kind: &seg.kind,
                style: seg.style,
            });
            start = end;
        }
    }
    if (start as usize) < display.len() {
        out.push(Span {
            range: start..display.len() as u32,
            kind: &PLAIN,
            style: TextStyle::default(),
        });
    }
    out
}

/// `SegKind::CodeBlock` runs are laid out as blocks of their own; everything between them is one
/// inline paragraph. Selection still sees one byte range across all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    Inline,
    Code,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub range: Range<u32>,
    pub kind: BlockKind,
}

pub fn blocks(row: &MessageRow) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    for span in spans(row) {
        let kind = if matches!(span.kind, SegKind::CodeBlock) {
            BlockKind::Code
        } else {
            BlockKind::Inline
        };
        match out.last_mut() {
            Some(last) if last.kind == kind && kind == BlockKind::Inline => {
                last.range.end = span.range.end;
            }
            _ => out.push(Block {
                range: span.range,
                kind,
            }),
        }
    }
    out
}

/// The source text for a byte range: an inline emoji copies as its `:name:`, whole or not at all,
/// and a link as its text. Blocks are separated by one newline, as they read on screen.
pub fn copy_range(row: &MessageRow, range: Range<u32>) -> String {
    let display = row.display.as_str();
    // Outward, so a range inside a placeholder or a character still means that whole thing.
    let start = display.floor_char_boundary((range.start as usize).min(display.len())) as u32;
    let end = display.ceil_char_boundary((range.end as usize).min(display.len())) as u32;
    let mut out = String::new();
    let mut previous_kind = None;
    for span in spans(row) {
        let from = span.range.start.max(start);
        let to = span.range.end.min(end);
        if from >= to {
            continue;
        }
        let is_code = matches!(span.kind, SegKind::CodeBlock);
        if previous_kind.is_some_and(|was_code| was_code || is_code) && !out.ends_with('\n') {
            out.push('\n');
        }
        previous_kind = Some(is_code);
        match span.kind {
            SegKind::Emoji { name, .. } => {
                out.push(':');
                out.push_str(name);
                out.push(':');
            }
            _ => out.push_str(&display[from as usize..to as usize]),
        }
    }
    out
}

/// The whole message as text. What copy gives, and what a screen reader hears.
pub fn plain_text(row: &MessageRow) -> String {
    copy_range(row, 0..row.display.len() as u32)
}

pub fn link_at(row: &MessageRow, byte: u32) -> Option<&str> {
    spans(row).into_iter().find_map(|span| match span.kind {
        SegKind::Link { url } if span.range.contains(&byte) => Some(url.as_str()),
        _ => None,
    })
}

/// The user an @mention at this byte names.
pub fn mention_at(row: &MessageRow, byte: u32) -> Option<&str> {
    spans(row).into_iter().find_map(|span| match span.kind {
        SegKind::UserMention { user_id } if span.range.contains(&byte) => Some(user_id.as_str()),
        _ => None,
    })
}

/// Whether a link may leave the app. The web client only ever links `http(s)` URLs, and a span's
/// target comes from another user.
pub fn is_openable_url(url: &str) -> bool {
    semaphore_core::links::is_web_url(url)
}

/// Whether the row addresses this user, which highlights it. Alias mentions are left out: whether
/// the user is in the alias isn't in the row. Core could tell us; see the unit's report.
pub fn mentions_user(row: &MessageRow, user_id: &str) -> bool {
    !user_id.is_empty()
        && row.segs.iter().any(|seg| match &seg.kind {
            SegKind::UserMention { user_id: id } => id == user_id,
            SegKind::SpecialMention { kind } => {
                matches!(kind.as_str(), "here" | "channel" | "everyone")
            }
            _ => false,
        })
}

fn block_at(row: &MessageRow, byte: u32) -> Range<u32> {
    let all = blocks(row);
    all.iter()
        .find(|block| block.range.contains(&byte))
        .or(all.last())
        .map_or(0..0, |block| block.range.clone())
}

/// What a double-click selects: the word, the run of spaces or the emoji at `byte`. Stays in its
/// block, so a word can't run from a paragraph into the code block after it.
pub fn word_range(row: &MessageRow, byte: u32) -> Range<u32> {
    if let Some(span) = spans(row)
        .into_iter()
        .find(|span| matches!(span.kind, SegKind::Emoji { .. }) && span.range.contains(&byte))
    {
        return span.range;
    }
    let block = block_at(row, byte);
    let text = &row.display[block.start as usize..block.end as usize];
    let within = byte.saturating_sub(block.start) as usize;
    let mut last = None;
    for (start, word) in text.split_word_bound_indices() {
        let range = start as u32 + block.start..(start + word.len()) as u32 + block.start;
        if within < start + word.len() {
            return range;
        }
        last = Some(range);
    }
    last.unwrap_or(block.start..block.start)
}

/// What a triple-click selects: the line of text at `byte`, however it wraps, without its newline.
pub fn line_range(row: &MessageRow, byte: u32) -> Range<u32> {
    let block = block_at(row, byte);
    let text = &row.display[block.start as usize..block.end as usize];
    let within = (byte.saturating_sub(block.start) as usize).min(text.len());
    let start = text[..within].rfind('\n').map_or(0, |at| at + 1);
    let end = text[within..]
        .find('\n')
        .map_or(text.len(), |at| within + at);
    start as u32 + block.start..end as u32 + block.start
}

/// The grapheme boundary before `byte`, or `None` at the start.
pub fn previous_char(display: &str, byte: u32) -> Option<u32> {
    let byte = display.floor_char_boundary((byte as usize).min(display.len()));
    display[..byte]
        .grapheme_indices(true)
        .next_back()
        .map(|(at, _)| at as u32)
}

/// The grapheme boundary after `byte`, or `None` at the end.
pub fn next_char(display: &str, byte: u32) -> Option<u32> {
    let byte = display.floor_char_boundary((byte as usize).min(display.len()));
    display[byte..]
        .graphemes(true)
        .next()
        .map(|grapheme| (byte + grapheme.len()) as u32)
}

/// The start of the word before `byte`, skipping spaces, or `None` at the start of the text.
pub fn previous_word(display: &str, byte: u32) -> Option<u32> {
    let byte = display.floor_char_boundary((byte as usize).min(display.len()));
    if byte == 0 {
        return None;
    }
    let mut found = 0;
    for (start, word) in display[..byte].split_word_bound_indices() {
        if !word.trim().is_empty() {
            found = start;
        }
    }
    Some(found as u32)
}

/// The end of the word after `byte`, skipping spaces, or `None` at the end of the text.
pub fn next_word(display: &str, byte: u32) -> Option<u32> {
    let byte = display.floor_char_boundary((byte as usize).min(display.len()));
    if byte == display.len() {
        return None;
    }
    for (start, word) in display[byte..].split_word_bound_indices() {
        if !word.trim().is_empty() {
            return Some((byte + start + word.len()) as u32);
        }
    }
    Some(display.len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::TextSeg;
    use semaphore_core::text::EMOJI_PLACEHOLDER;

    fn seg(end: usize, kind: SegKind) -> TextSeg {
        TextSeg {
            end: end as u32,
            kind,
            style: TextStyle::default(),
        }
    }

    fn row(display: &str, segs: Vec<TextSeg>) -> MessageRow {
        MessageRow {
            display: display.into(),
            segs,
            ..MessageRow::default()
        }
    }

    fn slice(row: &MessageRow, range: Range<u32>) -> &str {
        &row.display[range.start as usize..range.end as usize]
    }

    fn emoji(name: &str) -> SegKind {
        SegKind::Emoji {
            emoji_id: "e".into(),
            name: name.into(),
        }
    }

    #[test]
    fn a_bad_segment_boundary_is_clamped_instead_of_panicking_layout() {
        // 'é' is two bytes, and the first end falls inside it. The second is past the end.
        let row = row("héllo", vec![seg(2, SegKind::Text), seg(99, SegKind::Text)]);
        let spans = spans(&row);
        assert_eq!(spans.first().map(|s| s.range.clone()), Some(0..1));
        assert_eq!(spans.last().map(|s| s.range.end), Some(6));
        for span in spans {
            assert!(row.display.is_char_boundary(span.range.end as usize));
        }
    }

    #[test]
    fn text_with_no_segments_is_one_plain_run() {
        let row = row("plain", vec![]);
        assert_eq!(plain_text(&row), "plain");
        assert_eq!(blocks(&row).len(), 1);
    }

    #[test]
    fn an_emoji_copies_as_its_name_whole_or_not_at_all() {
        let display = format!("hi {EMOJI_PLACEHOLDER} there");
        let emoji_end = 3 + EMOJI_PLACEHOLDER.len_utf8();
        let row = row(
            &display,
            vec![
                seg(3, SegKind::Text),
                seg(emoji_end, emoji("wave")),
                seg(display.len(), SegKind::Text),
            ],
        );
        assert_eq!(plain_text(&row), "hi :wave: there");
        assert_eq!(copy_range(&row, 0..3), "hi ");
        // A range that touches any byte of the placeholder takes the whole name.
        assert_eq!(copy_range(&row, 4..5), ":wave:");
        assert_eq!(
            copy_range(&row, emoji_end as u32..display.len() as u32),
            " there"
        );
    }

    #[test]
    fn a_link_copies_as_its_text_and_is_found_by_byte() {
        let url = "https://example.com/1";
        let row = row(
            "see issue 1",
            vec![
                seg(4, SegKind::Text),
                seg(11, SegKind::Link { url: url.into() }),
            ],
        );
        assert_eq!(plain_text(&row), "see issue 1");
        assert_eq!(link_at(&row, 5), Some(url));
        assert_eq!(link_at(&row, 1), None);
    }

    #[test]
    fn only_web_links_may_open() {
        assert!(is_openable_url("https://example.com"));
        assert!(is_openable_url("HTTP://example.com"));
        assert!(!is_openable_url("javascript:alert(1)"));
        assert!(!is_openable_url("file:///etc/passwd"));
        assert!(!is_openable_url(""));
    }

    #[test]
    fn code_blocks_are_blocks_and_copy_on_their_own_lines() {
        let row = row(
            "look:fn main() {}done",
            vec![
                seg(5, SegKind::Text),
                seg(17, SegKind::CodeBlock),
                seg(21, SegKind::Text),
            ],
        );
        let blocks = blocks(&row);
        assert_eq!(
            blocks.iter().map(|b| b.kind).collect::<Vec<_>>(),
            [BlockKind::Inline, BlockKind::Code, BlockKind::Inline]
        );
        assert_eq!(plain_text(&row), "look:\nfn main() {}\ndone");
    }

    #[test]
    fn styled_inline_runs_stay_one_block_and_copy_with_no_breaks() {
        let row = row(
            "one two",
            vec![
                seg(4, SegKind::Text),
                TextSeg {
                    end: 7,
                    kind: SegKind::Text,
                    style: TextStyle {
                        bold: true,
                        ..TextStyle::default()
                    },
                },
            ],
        );
        assert_eq!(blocks(&row).len(), 1);
        assert_eq!(plain_text(&row), "one two");
    }

    #[test]
    fn double_click_takes_the_word_the_spaces_or_the_emoji() {
        let display = format!("hello big{EMOJI_PLACEHOLDER}{EMOJI_PLACEHOLDER}world");
        let (a, b) = (9usize, 9 + EMOJI_PLACEHOLDER.len_utf8());
        let c = b + EMOJI_PLACEHOLDER.len_utf8();
        let row = row(
            &display,
            vec![
                seg(a, SegKind::Text),
                seg(b, emoji("one")),
                seg(c, emoji("two")),
                seg(display.len(), SegKind::Text),
            ],
        );
        assert_eq!(slice(&row, word_range(&row, 1)), "hello");
        assert_eq!(slice(&row, word_range(&row, 5)), " ");
        assert_eq!(word_range(&row, a as u32 + 1), a as u32..b as u32);
        assert_eq!(word_range(&row, b as u32), b as u32..c as u32);
        // The end of the text belongs to the last word.
        assert_eq!(slice(&row, word_range(&row, display.len() as u32)), "world");
    }

    #[test]
    fn a_word_does_not_run_across_a_block_boundary() {
        let row = row(
            "wordcode",
            vec![seg(4, SegKind::Text), seg(8, SegKind::CodeBlock)],
        );
        assert_eq!(slice(&row, word_range(&row, 1)), "word");
        assert_eq!(slice(&row, word_range(&row, 5)), "code");
    }

    #[test]
    fn triple_click_takes_the_line_without_its_newline() {
        let row = row("first\nsecond line\nthird", vec![seg(23, SegKind::Text)]);
        assert_eq!(slice(&row, line_range(&row, 8)), "second line");
        assert_eq!(slice(&row, line_range(&row, 0)), "first");
        assert_eq!(slice(&row, line_range(&row, 23)), "third");
    }

    #[test]
    fn keyboard_steps_move_by_grapheme_and_word() {
        let text = "e\u{301}x"; // 'e' with a combining accent, then x
        assert_eq!(next_char(text, 0), Some(3));
        assert_eq!(previous_char(text, 3), Some(0));
        assert_eq!(next_char(text, 4), None);
        assert_eq!(previous_char(text, 0), None);

        let words = "one  two three";
        assert_eq!(next_word(words, 0), Some(3));
        assert_eq!(next_word(words, 3), Some(8));
        assert_eq!(previous_word(words, 14), Some(9));
        assert_eq!(previous_word(words, 9), Some(5));
        assert_eq!(previous_word(words, 0), None);
        assert_eq!(next_word(words, 14), None);
    }

    #[test]
    fn mentions_count_for_the_named_user_and_for_group_mentions() {
        let named = row(
            "@ava hi",
            vec![seg(
                7,
                SegKind::UserMention {
                    user_id: "ava".into(),
                },
            )],
        );
        assert!(mentions_user(&named, "ava"));
        assert!(!mentions_user(&named, "bob"));
        let here = row(
            "@here",
            vec![seg(
                5,
                SegKind::SpecialMention {
                    kind: "here".into(),
                },
            )],
        );
        assert!(mentions_user(&here, "bob"));
        assert!(!mentions_user(&here, ""));
    }
}
