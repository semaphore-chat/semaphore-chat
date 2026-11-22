//! A row's words as the kit's `MessageText` segments, and the map between the row's display
//! string (where selection lives, in core's coordinates) and the words as drawn.
//!
//! The two differ where a link or a mention is drawn in a left-to-right isolate (two zero-width
//! marks around it), where words lose an unpaired bidi control, and where a link is drawn by its
//! checked label (`check_link`) rather than as written: a lookalike host as punycode, a bare origin
//! with its `/`. A relabelled link is one unit for selection, like an emoji: nothing maps inside it,
//! and a selection end that falls in it widens to its ends (`atomic_at`, `range_to_drawn`).

use super::text;
use crate::kit::chat::{
    LRI, MentionKind, MentionSegment, MessageSegment, PDI, Planned, SegmentStyle, planned, shown,
    unpaired_bidi,
};
use semaphore_core::model::{MessageRow, SegKind};
use std::ops::Range;
use std::rc::Rc;

/// How a segment's drawn bytes follow its written ones.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Fit {
    /// The same bytes, after `inner` drawn bytes of isolate mark.
    Same { inner: u32 },
    /// The written bytes without these 3-byte bidi controls (offsets in the written text).
    Deleted(Vec<u32>),
    /// Drawn differently (a relabelled link): one unit. `inside` is the first display byte past
    /// its first character, the one position a hit inside it maps to.
    Atomic { inside: u32 },
}

/// One segment's bytes in the display string and in the words as drawn.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Part {
    display: Range<u32>,
    drawn: Range<u32>,
    fit: Fit,
}

/// The bidi controls `unpaired_bidi` takes out are all three bytes long in UTF-8.
const CONTROL_LEN: u32 = 3;

/// Display bytes to drawn bytes and back.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DrawnMap {
    parts: Vec<Part>,
}

impl DrawnMap {
    fn part_for_display(&self, byte: u32) -> Option<&Part> {
        self.parts
            .iter()
            .find(|part| byte < part.display.end)
            .or(self.parts.last())
    }

    /// The drawn byte for a display byte. Inside an atomic link: its nearer end.
    pub fn to_drawn(&self, byte: u32) -> u32 {
        let Some(part) = self.part_for_display(byte) else {
            return 0;
        };
        if byte <= part.display.start {
            return part.drawn.start;
        }
        if byte >= part.display.end {
            return part.drawn.end;
        }
        let local = byte - part.display.start;
        match &part.fit {
            Fit::Same { inner } => part.drawn.start + inner + local,
            Fit::Deleted(removed) => {
                let before = removed.iter().filter(|at| **at < local).count() as u32;
                part.drawn.start + local - before * CONTROL_LEN
            }
            Fit::Atomic { .. } => {
                if local * 2 < part.display.end - part.display.start {
                    part.drawn.start
                } else {
                    part.drawn.end
                }
            }
        }
    }

    /// The display byte for a drawn byte. Inside an atomic link: a position inside it, which a
    /// selection then widens to the link's ends (`atomic_at`).
    pub fn to_display(&self, byte: u32) -> u32 {
        let Some(part) = self
            .parts
            .iter()
            .find(|part| byte < part.drawn.end)
            .or(self.parts.last())
        else {
            return 0;
        };
        if byte <= part.drawn.start {
            return part.display.start;
        }
        if byte >= part.drawn.end {
            return part.display.end;
        }
        let local = byte - part.drawn.start;
        let len = part.display.end - part.display.start;
        match &part.fit {
            Fit::Same { inner } => part.display.start + local.saturating_sub(*inner).min(len),
            Fit::Deleted(removed) => {
                let mut skipped = 0;
                for at in removed {
                    if at - skipped * CONTROL_LEN <= local {
                        skipped += 1;
                    } else {
                        break;
                    }
                }
                part.display.start + (local + skipped * CONTROL_LEN).min(len)
            }
            Fit::Atomic { inside } => *inside,
        }
    }

    /// A display range as drawn: an end inside an atomic link widens to the link's end, so the
    /// highlight covers what copy gives (the whole label).
    pub fn range_to_drawn(&self, range: Range<u32>) -> Range<usize> {
        let start = match self.atomic_at(range.start) {
            Some(link) => self.to_drawn(link.start),
            None => self.to_drawn(range.start),
        };
        let end = match self.atomic_at(range.end) {
            Some(link) => self.to_drawn(link.end),
            None => self.to_drawn(range.end),
        };
        start as usize..end as usize
    }

    /// The display range of the atomic link `byte` is strictly inside, if any.
    pub fn atomic_at(&self, byte: u32) -> Option<Range<u32>> {
        self.parts
            .iter()
            .find(|part| {
                matches!(part.fit, Fit::Atomic { .. })
                    && part.display.start < byte
                    && byte < part.display.end
            })
            .map(|part| part.display.clone())
    }
}

/// How `drawn` follows `written` for one segment.
fn fit(segment: &MessageSegment, written: &str, drawn: &str, start: u32) -> Fit {
    if drawn == written {
        return Fit::Same { inner: 0 };
    }
    let isolated = drawn
        .strip_prefix(LRI)
        .and_then(|rest| rest.strip_suffix(PDI));
    if isolated == Some(written) {
        return Fit::Same {
            inner: LRI.len_utf8() as u32,
        };
    }
    if matches!(
        segment,
        MessageSegment::Text { .. } | MessageSegment::Code(_) | MessageSegment::CodeBlock(_)
    ) {
        let removed = unpaired_bidi(written);
        if !removed.is_empty() {
            return Fit::Deleted(removed.into_iter().map(|at| at as u32).collect());
        }
    }
    let first = written.chars().next().map_or(0, char::len_utf8) as u32;
    let len = written.len() as u32;
    Fit::Atomic {
        inside: start + if first < len { first } else { len },
    }
}

fn style_of(style: semaphore_core::model::TextStyle) -> SegmentStyle {
    SegmentStyle {
        bold: style.bold,
        italic: style.italic,
        strike: style.strikethrough,
    }
}

/// The row's words as segments, and where each sits in the display string and as drawn. Emoji
/// are placeholders the list paints (`ListText::paint_emoji`); `emoji_segments` lists their
/// emoji ids by segment index for it.
pub(crate) struct RowText {
    pub segments: Rc<[MessageSegment]>,
    /// The segments planned once (emoji as placeholders), for `MessageText` in list mode.
    pub plan: Rc<Planned>,
    pub map: DrawnMap,
    /// For each segment, its emoji id when it is an emoji.
    pub emoji_ids: Vec<Option<String>>,
}

pub(crate) fn row_text(row: &MessageRow, me_id: &str) -> RowText {
    let display = row.display.as_str();
    let mut segments = Vec::new();
    let mut parts = Vec::new();
    let mut emoji_ids = Vec::new();
    let mut drawn = 0u32;
    for span in text::spans(row) {
        let words = &display[span.range.start as usize..span.range.end as usize];
        let segment = match span.kind {
            SegKind::Text if span.style.code => MessageSegment::code(words.to_owned()),
            SegKind::Text => MessageSegment::styled(words.to_owned(), style_of(span.style)),
            SegKind::Link { url } => MessageSegment::styled_link(url.clone(), style_of(span.style)),
            SegKind::UserMention { user_id } => {
                let mention =
                    MentionSegment::new(MentionKind::User, words.to_owned()).id(user_id.clone());
                MessageSegment::mention(if user_id == me_id {
                    mention.me()
                } else {
                    mention
                })
            }
            SegKind::SpecialMention { .. } | SegKind::CommunityMention { .. } => {
                MessageSegment::mention(MentionSegment::new(
                    MentionKind::Everyone,
                    words.to_owned(),
                ))
            }
            SegKind::AliasMention { alias_id } => MessageSegment::mention(
                MentionSegment::new(MentionKind::Role, words.to_owned()).id(alias_id.clone()),
            ),
            SegKind::ChannelMention { channel_id } => MessageSegment::mention(
                MentionSegment::new(MentionKind::Channel, words.to_owned()).id(channel_id.clone()),
            ),
            SegKind::Emoji { name, .. } => MessageSegment::emoji(name.clone(), None),
            SegKind::CodeBlock => MessageSegment::code_block(words.to_owned()),
        };
        emoji_ids.push(match span.kind {
            SegKind::Emoji { emoji_id, .. } => Some(emoji_id.clone()),
            _ => None,
        });
        let shown = shown(&segment, true);
        let len = shown.len() as u32;
        parts.push(Part {
            display: span.range.clone(),
            drawn: drawn..drawn + len,
            fit: fit(&segment, words, &shown, span.range.start),
        });
        drawn += len;
        segments.push(segment);
    }
    RowText {
        plan: Rc::new(planned(&segments, true)),
        segments: segments.into(),
        map: DrawnMap { parts },
        emoji_ids,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::{TextSeg, TextStyle};
    use semaphore_core::text::EMOJI_PLACEHOLDER;
    use std::prelude::rust_2024::test;

    const ISO: u32 = 3; // LRI or PDI, in UTF-8

    fn row_styled(display: &str, segs: Vec<(u32, SegKind, TextStyle)>) -> MessageRow {
        MessageRow {
            display: display.into(),
            segs: segs
                .into_iter()
                .map(|(end, kind, style)| TextSeg { end, kind, style })
                .collect(),
            ..MessageRow::default()
        }
    }

    fn row(display: &str, segs: Vec<(u32, SegKind)>) -> MessageRow {
        row_styled(
            display,
            segs.into_iter()
                .map(|(end, kind)| (end, kind, TextStyle::default()))
                .collect(),
        )
    }

    /// The words as drawn, all blocks run together.
    fn drawn(text: &RowText) -> String {
        text.plan
            .blocks
            .iter()
            .map(|block| match block {
                crate::kit::chat::text::Block::Inline { text, .. } => text.clone(),
                crate::kit::chat::text::Block::Code(code) => code.clone(),
            })
            .collect()
    }

    #[test]
    fn plain_text_maps_one_to_one() {
        let row = row("hello there", vec![(11, SegKind::Text)]);
        let text = row_text(&row, "me");
        for byte in 0..=11 {
            assert_eq!(text.map.to_drawn(byte), byte);
            assert_eq!(text.map.to_display(byte), byte);
        }
    }

    #[test]
    fn a_link_drawn_as_written_maps_inside_its_isolate() {
        let url = "https://example.com/a";
        let display = format!("see {url} ok");
        let end = 4 + url.len() as u32;
        let row = row(
            &display,
            vec![
                (4, SegKind::Text),
                (end, SegKind::Link { url: url.into() }),
                (display.len() as u32, SegKind::Text),
            ],
        );
        let text = row_text(&row, "me");
        assert_eq!(drawn(&text), format!("see \u{2066}{url}\u{2069} ok"));
        assert_eq!(
            text.map.atomic_at(10),
            None,
            "drawn as written: not one unit"
        );
        assert_eq!(text.map.to_drawn(4), 4);
        assert_eq!(text.map.to_drawn(10), 10 + ISO);
        assert_eq!(text.map.to_drawn(end), end + 2 * ISO);
        assert_eq!(text.map.to_display(10 + ISO), 10);
        assert_eq!(text.map.to_display(end + 2 * ISO + 1), end + 1);
    }

    #[test]
    fn a_lookalike_link_is_one_unit() {
        let url = "https://\u{0430}pple.com/";
        let display = format!("see {url} ok");
        let link_end = 4 + url.len() as u32;
        let row = row(
            &display,
            vec![
                (4, SegKind::Text),
                (link_end, SegKind::Link { url: url.into() }),
                (display.len() as u32, SegKind::Text),
            ],
        );
        let text = row_text(&row, "me");
        let label = "https://xn--pple-43d.com/";
        assert_eq!(drawn(&text), format!("see \u{2066}{label}\u{2069} ok"));
        let drawn_end = 4 + label.len() as u32 + 2 * ISO;
        assert_eq!(text.map.atomic_at(6), Some(4..link_end));
        assert_eq!(text.map.atomic_at(4), None, "its ends are not inside it");
        assert_eq!(text.map.to_drawn(5), 4, "near the start: the start");
        assert_eq!(
            text.map.to_drawn(link_end - 1),
            drawn_end,
            "near the end: the end"
        );
        assert_eq!(
            text.map.range_to_drawn(6..link_end + 2),
            4..drawn_end as usize + 2
        );
        // A drawn byte inside the label maps inside the link, for the selection to widen.
        assert_eq!(text.map.to_display(10), 5);
        assert_eq!(text.map.to_display(drawn_end + 2), link_end + 2);
        assert_eq!(text.map.to_drawn(display.len() as u32), drawn_end + 3);
    }

    /// Same length, different bytes: never mapped byte for byte, which would land inside a
    /// multi-byte character of the display string.
    #[test]
    fn a_same_length_relabelled_link_is_one_unit() {
        let url = "https://example.com:443/\u{e9}";
        let label = semaphore_core::links::check_link(url).unwrap().label;
        assert_eq!(url.len(), label.len());
        assert_ne!(url, label);
        let display = format!("see {url}");
        let row = row(
            &display,
            vec![
                (4, SegKind::Text),
                (display.len() as u32, SegKind::Link { url: url.into() }),
            ],
        );
        let text = row_text(&row, "me");
        let end = display.len() as u32;
        for drawn_byte in 0..=(4 + label.len() as u32 + 2 * ISO) {
            let back = text.map.to_display(drawn_byte);
            assert!(
                display.is_char_boundary(back as usize),
                "{drawn_byte} -> {back}"
            );
        }
        assert_eq!(text.map.atomic_at(end - 1), Some(4..end));
    }

    #[test]
    fn mentions_emoji_inline_code_and_code_blocks_keep_their_bytes() {
        let display = format!("@sam {EMOJI_PLACEHOLDER} let x;fn main() {{}}");
        let emoji_end = 5 + EMOJI_PLACEHOLDER.len_utf8() as u32;
        let code_end = emoji_end + " let x;".len() as u32;
        let code = TextStyle {
            code: true,
            ..TextStyle::default()
        };
        let row = row_styled(
            &display,
            vec![
                (
                    4,
                    SegKind::UserMention {
                        user_id: "u-sam".into(),
                    },
                    TextStyle::default(),
                ),
                (5, SegKind::Text, TextStyle::default()),
                (
                    emoji_end,
                    SegKind::Emoji {
                        emoji_id: "e1".into(),
                        name: "party".into(),
                    },
                    TextStyle::default(),
                ),
                (code_end, SegKind::Text, code),
                (
                    display.len() as u32,
                    SegKind::CodeBlock,
                    TextStyle::default(),
                ),
            ],
        );
        let text = row_text(&row, "u-sam");
        assert!(matches!(&text.segments[3], MessageSegment::Code(_)));
        assert!(matches!(&text.segments[4], MessageSegment::CodeBlock(_)));
        assert_eq!(text.emoji_ids[2].as_deref(), Some("e1"));
        assert!(matches!(
            &text.segments[0],
            MessageSegment::Mention(mention) if mention.me
        ));
        // The mention is isolated: everything after it sits two marks later.
        assert_eq!(text.map.to_drawn(2), 2 + ISO);
        for byte in 4..=display.len() as u32 {
            assert_eq!(text.map.to_drawn(byte), byte + 2 * ISO, "{byte}");
            assert_eq!(text.map.to_display(byte + 2 * ISO), byte, "{byte}");
        }
        assert_eq!(text.plan.starts, [0, (code_end + 2 * ISO) as usize]);
    }

    /// An unpaired override or embedding in the words is not drawn, so it can't reorder the link
    /// after it; the link's label is in a left-to-right isolate besides.
    #[test]
    fn link_labels_draw_in_a_left_to_right_isolate() {
        let url = "https://evil.example/moc.knab//:sptth";
        let display = format!("pay at \u{202E}{url}");
        let text_end = "pay at \u{202E}".len() as u32;
        let message = row(
            &display,
            vec![
                (text_end, SegKind::Text),
                (display.len() as u32, SegKind::Link { url: url.into() }),
            ],
        );
        let text = row_text(&message, "me");
        assert_eq!(drawn(&text), format!("pay at \u{2066}{url}\u{2069}"));
        // The removed override: the bytes after it sit three earlier as drawn.
        assert_eq!(text.map.to_drawn(7), 7);
        assert_eq!(text.map.to_drawn(text_end), 7);
        assert_eq!(text.map.to_display(7), text_end);
        assert_eq!(text.map.to_display(3), 3);
        // A paired embedding is drawn as written.
        let paired = "a\u{202B}b\u{202C}c";
        let plain = row(paired, vec![(paired.len() as u32, SegKind::Text)]);
        assert_eq!(drawn(&row_text(&plain, "me")), paired);
    }
}
