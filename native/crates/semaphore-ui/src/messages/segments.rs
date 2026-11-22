//! A row's words as the kit's `MessageText` segments, and the map between the row's display
//! string (where selection lives, in core's coordinates) and the words as drawn.
//!
//! The two differ only where a link is drawn by its checked label (`check_link`) rather than as
//! it was written: a lookalike host as punycode, a refused address without its bidi controls. A
//! position inside such a link snaps to the link's ends.

use super::text;
use crate::kit::chat::{MentionKind, MentionSegment, MessageSegment, SegmentStyle};
use semaphore_core::model::{MessageRow, SegKind};
use std::ops::Range;

/// One segment's bytes in the display string and in the words as drawn.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Part {
    display: Range<u32>,
    drawn: Range<u32>,
}

/// Display bytes to drawn bytes and back.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DrawnMap {
    parts: Vec<Part>,
}

impl DrawnMap {
    /// The drawn byte for a display byte.
    pub fn to_drawn(&self, byte: u32) -> u32 {
        let mut last = 0;
        for part in &self.parts {
            if byte < part.display.end || (byte == part.display.end && part.display.is_empty()) {
                if byte <= part.display.start {
                    return part.drawn.start;
                }
                return if part.display.len() == part.drawn.len() {
                    part.drawn.start + (byte - part.display.start)
                } else {
                    part.drawn.end
                };
            }
            last = part.drawn.end;
        }
        last
    }

    /// The display byte for a drawn byte.
    pub fn to_display(&self, byte: u32) -> u32 {
        let mut last = 0;
        for part in &self.parts {
            if byte < part.drawn.end {
                if byte <= part.drawn.start {
                    return part.display.start;
                }
                return if part.display.len() == part.drawn.len() {
                    part.display.start + (byte - part.drawn.start)
                } else {
                    part.display.end
                };
            }
            last = part.display.end;
        }
        last
    }

    /// A display range as drawn.
    pub fn range_to_drawn(&self, range: Range<u32>) -> Range<usize> {
        self.to_drawn(range.start) as usize..self.to_drawn(range.end) as usize
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
    pub segments: Vec<MessageSegment>,
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
        let len = crate::kit::chat::shown_len(&segment);
        parts.push(Part {
            display: span.range.clone(),
            drawn: drawn..drawn + len as u32,
        });
        drawn += len as u32;
        segments.push(segment);
    }
    RowText {
        segments,
        map: DrawnMap { parts },
        emoji_ids,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_core::model::{TextSeg, TextStyle};
    use std::prelude::rust_2024::test;

    fn row(display: &str, segs: Vec<(u32, SegKind)>) -> MessageRow {
        MessageRow {
            display: display.into(),
            segs: segs
                .into_iter()
                .map(|(end, kind)| TextSeg {
                    end,
                    kind,
                    style: TextStyle::default(),
                })
                .collect(),
            ..MessageRow::default()
        }
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
    fn a_lookalike_link_is_drawn_longer_and_positions_inside_it_snap() {
        // "see " + a Cyrillic-a lookalike host + " ok"
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
        assert_eq!(crate::kit::chat::shown_len(&text.segments[1]), label.len());
        let drawn_end = 4 + label.len() as u32;
        assert_eq!(text.map.to_drawn(4), 4);
        assert_eq!(text.map.to_drawn(6), drawn_end, "inside the link: its end");
        assert_eq!(text.map.to_drawn(link_end), drawn_end);
        assert_eq!(text.map.to_drawn(link_end + 1), drawn_end + 1);
        assert_eq!(text.map.to_display(drawn_end + 3), link_end + 3);
        assert_eq!(text.map.to_display(5), link_end);
        assert_eq!(text.map.to_display(0), 0);
        assert_eq!(text.map.to_drawn(display.len() as u32), drawn_end + 3);
    }

    #[test]
    fn mentions_emoji_and_code_keep_their_bytes() {
        let display = format!("@sam {} `x`", semaphore_core::text::EMOJI_PLACEHOLDER);
        let emoji_end = 5 + semaphore_core::text::EMOJI_PLACEHOLDER.len_utf8() as u32;
        let row = row(
            &display,
            vec![
                (
                    4,
                    SegKind::UserMention {
                        user_id: "u-sam".into(),
                    },
                ),
                (5, SegKind::Text),
                (
                    emoji_end,
                    SegKind::Emoji {
                        emoji_id: "e1".into(),
                        name: "party".into(),
                    },
                ),
                (display.len() as u32, SegKind::Text),
            ],
        );
        let text = row_text(&row, "u-sam");
        assert_eq!(text.emoji_ids[2].as_deref(), Some("e1"));
        for byte in 0..=display.len() as u32 {
            assert_eq!(text.map.to_drawn(byte), byte);
        }
        assert!(matches!(
            &text.segments[0],
            MessageSegment::Mention(mention) if mention.me
        ));
    }
}
