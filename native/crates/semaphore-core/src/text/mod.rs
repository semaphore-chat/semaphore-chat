//! Message text: spans to a display string, a selected range back to copied text, and a draft
//! to outgoing spans. A small working version so stories render; unit U6 owns this file and adds
//! auto-linking and the rules from `mentionParser` and `MessageSpan`, proved by exported vectors.

use crate::model::{MessageDraft, SegKind, TextSeg, TextStyle};

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

/// A draft to outgoing spans. Plain text only so far; mentions arrive with U6.
pub fn draft_to_spans(draft: &MessageDraft) -> Vec<SpanInput> {
    vec![SpanInput {
        kind: "PLAINTEXT".into(),
        text: Some(draft.text.clone()),
        ..SpanInput::default()
    }]
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
