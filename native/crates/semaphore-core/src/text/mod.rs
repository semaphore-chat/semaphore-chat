//! Message text: spans to a display string, a draft to outgoing spans, composer mentions and
//! shortcuts, and auto-linking. Ported from `mentionParser.ts`, `richTextShortcuts.ts` and
//! `MessageSpan.tsx`, and proved against vectors the web client exported to `fixtures/text`
//! (`vectors.rs`). Pure: no UI, no OS.

mod compose;
mod js;
mod link;
mod mention;
mod shortcuts;
#[cfg(test)]
mod vectors;

pub use compose::{
    ChannelNames, FoundKind, MentionMatch, NamedRef, Resolvers, UserRef, code_regions,
    find_mentions, parse_message, spans_to_text,
};
pub use link::{LinkPart, MAX_URLS_PER_MESSAGE, extract_urls, link_parts};
pub use mention::{
    CurrentMention, MentionTarget, Trigger, get_current_mention, insert_mention,
    resolve_mention_text,
};
pub use shortcuts::{WrapResult, marker_for_shortcut, wrap_selection};

use crate::model::{DraftMention, MentionKind, MessageDraft, SegKind, TextSeg, TextStyle};

/// The placeholder an emoji occupies in a display string: one em wide, no glyph.
pub const EMOJI_PLACEHOLDER: char = '\u{2003}';

/// A span, independent of the generated wire type. `kind` is `SpanType` as sent, so a value this
/// build doesn't know still renders its text instead of failing the message.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpanInput {
    pub kind: String,
    pub text: Option<String>,
    pub user_id: Option<String>,
    pub special_kind: Option<String>,
    pub community_id: Option<String>,
    pub alias_id: Option<String>,
    pub channel_id: Option<String>,
    pub emoji_id: Option<String>,
    pub style: TextStyle,
}

/// Spans to `(display, segs)`. Never fails: a span with no text and no known meaning adds nothing.
pub fn layout_spans(spans: &[SpanInput]) -> (String, Vec<TextSeg>) {
    let mut display = String::new();
    let mut segs = Vec::new();
    for span in spans {
        let text = span.text.as_deref().unwrap_or_default();
        if links_text(span) {
            // Plain text auto-links; mentions, emoji and code never do (as in `MessageSpan`).
            for part in link_parts(text) {
                display.push_str(&part.text);
                segs.push(TextSeg {
                    end: display.len() as u32,
                    kind: if part.link {
                        SegKind::Link { url: part.text }
                    } else {
                        SegKind::Text
                    },
                    style: span.style,
                });
            }
            continue;
        }
        let kind = match span.kind.as_str() {
            "USER_MENTION" => span
                .user_id
                .clone()
                .map(|user_id| SegKind::UserMention { user_id }),
            "SPECIAL_MENTION" => span
                .special_kind
                .clone()
                .map(|kind| SegKind::SpecialMention { kind }),
            "COMMUNITY_MENTION" => span
                .community_id
                .clone()
                .map(|community_id| SegKind::CommunityMention { community_id }),
            "ALIAS_MENTION" => span
                .alias_id
                .clone()
                .map(|alias_id| SegKind::AliasMention { alias_id }),
            "CHANNEL_MENTION" => span
                .channel_id
                .clone()
                .map(|channel_id| SegKind::ChannelMention { channel_id }),
            "EMOJI" => span.emoji_id.clone().map(|emoji_id| SegKind::Emoji {
                emoji_id,
                name: text.trim_matches(':').to_owned(),
            }),
            "CODE_BLOCK" => Some(SegKind::CodeBlock),
            _ => None,
        }
        .unwrap_or(SegKind::Text);
        if matches!(kind, SegKind::Emoji { .. }) {
            display.push(EMOJI_PLACEHOLDER);
        } else if text.is_empty() {
            continue;
        } else {
            display.push_str(text);
        }
        segs.push(TextSeg {
            end: display.len() as u32,
            kind,
            style: span.style,
        });
    }
    (display, segs)
}

/// Whether `MessageSpan` auto-links this span: its `PLAINTEXT` and default arm, minus inline code.
fn links_text(span: &SpanInput) -> bool {
    !span.style.code
        && !matches!(
            span.kind.as_str(),
            "USER_MENTION"
                | "SPECIAL_MENTION"
                | "COMMUNITY_MENTION"
                | "ALIAS_MENTION"
                | "CHANNEL_MENTION"
                | "EMOJI"
                | "CODE_BLOCK"
        )
}

/// A draft to outgoing spans. The mentions the composer inserted (by byte range) become mention
/// spans; the text between them is parsed for formatting and code, with no names to resolve. A
/// range that is out of order, overlaps the one before or isn't on a character boundary is
/// ignored, so a stale draft still sends its text.
pub fn draft_to_spans(draft: &MessageDraft) -> Vec<SpanInput> {
    let text = &draft.text;
    let mut mentions: Vec<&DraftMention> = draft.mentions.iter().collect();
    mentions.sort_by_key(|m| m.start);
    let none = Resolvers::default();
    let mut spans = Vec::new();
    let mut last = 0;
    for m in mentions {
        let (start, end) = (m.start as usize, m.end as usize);
        if start < last
            || end <= start
            || !text.is_char_boundary(start)
            || !text.get(..end).is_some()
            || !text.is_char_boundary(end)
        {
            continue;
        }
        spans.extend(parse_message(&text[last..start], &none));
        let id = Some(m.id.clone());
        let label = Some(text[start..end].to_owned());
        let (kind, label) = match m.kind {
            MentionKind::User => ("USER_MENTION", label),
            MentionKind::Special => ("SPECIAL_MENTION", label),
            MentionKind::Alias => ("ALIAS_MENTION", label),
            MentionKind::Channel => ("CHANNEL_MENTION", None),
            MentionKind::Community => ("COMMUNITY_MENTION", label),
            MentionKind::Emoji => ("EMOJI", label),
        };
        spans.push(SpanInput {
            kind: kind.into(),
            text: label,
            user_id: id.clone().filter(|_| m.kind == MentionKind::User),
            special_kind: id.clone().filter(|_| m.kind == MentionKind::Special),
            alias_id: id.clone().filter(|_| m.kind == MentionKind::Alias),
            community_id: id.clone().filter(|_| m.kind == MentionKind::Community),
            emoji_id: id.clone().filter(|_| m.kind == MentionKind::Emoji),
            channel_id: id.filter(|_| m.kind == MentionKind::Channel),
            ..SpanInput::default()
        });
        last = end;
    }
    spans.extend(parse_message(&text[last..], &none));
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(kind: &str, text: &str) -> SpanInput {
        SpanInput {
            kind: kind.into(),
            text: Some(text.into()),
            ..SpanInput::default()
        }
    }

    #[test]
    fn an_unknown_span_type_renders_its_text() {
        let (display, segs) = layout_spans(&[
            text("PLAINTEXT", "hi "),
            text("HOLOGRAM_FROM_THE_FUTURE", "there"),
        ]);
        assert_eq!(display, "hi there");
        assert_eq!(segs[1].kind, SegKind::Text);
        assert_eq!(segs[1].end, 8);
    }

    #[test]
    fn a_mention_with_no_target_falls_back_to_text() {
        let (_, segs) = layout_spans(&[text("USER_MENTION", "@ghost")]);
        assert_eq!(segs[0].kind, SegKind::Text);
    }

    #[test]
    fn plain_text_auto_links_but_code_and_mentions_do_not() {
        let (display, segs) = layout_spans(&[text("PLAINTEXT", "go https://a.b/c. ok")]);
        assert_eq!(display, "go https://a.b/c. ok");
        assert_eq!(segs.iter().map(|s| s.end).collect::<Vec<_>>(), [3, 16, 20]);
        assert_eq!(
            segs[1].kind,
            SegKind::Link {
                url: "https://a.b/c".into()
            }
        );

        let mut code = text("PLAINTEXT", "https://a.b");
        code.style.code = true;
        let (_, segs) = layout_spans(&[code, text("USER_MENTION", "@https://a.b")]);
        assert!(segs.iter().all(|s| s.kind == SegKind::Text));
    }

    #[test]
    fn a_draft_becomes_spans_with_its_mentions() {
        let draft = MessageDraft {
            text: "hi @ava **you** #gen".into(),
            mentions: vec![
                DraftMention {
                    start: 3,
                    end: 7,
                    kind: MentionKind::User,
                    id: "u1".into(),
                },
                DraftMention {
                    start: 16,
                    end: 20,
                    kind: MentionKind::Channel,
                    id: "c1".into(),
                },
                // Overlaps the first: ignored.
                DraftMention {
                    start: 5,
                    end: 9,
                    kind: MentionKind::User,
                    id: "u2".into(),
                },
            ],
            ..MessageDraft::default()
        };
        let spans = draft_to_spans(&draft);
        let kinds: Vec<_> = spans.iter().map(|s| s.kind.as_str()).collect();
        assert_eq!(
            kinds,
            [
                "PLAINTEXT",
                "USER_MENTION",
                "PLAINTEXT",
                "PLAINTEXT",
                "PLAINTEXT",
                "CHANNEL_MENTION"
            ]
        );
        assert_eq!(spans[1].user_id.as_deref(), Some("u1"));
        assert!(spans[3].style.bold);
        assert_eq!(spans[5].channel_id.as_deref(), Some("c1"));
        assert_eq!(spans[5].text, None);
    }

    #[test]
    fn an_emoji_takes_one_placeholder_and_keeps_its_name() {
        let span = SpanInput {
            kind: "EMOJI".into(),
            text: Some(":wave:".into()),
            emoji_id: Some("e1".into()),
            ..SpanInput::default()
        };
        let (display, segs) = layout_spans(&[span]);
        assert_eq!(display, EMOJI_PLACEHOLDER.to_string());
        assert_eq!(
            segs[0].kind,
            SegKind::Emoji {
                emoji_id: "e1".into(),
                name: "wave".into()
            }
        );
    }
}
