//! Editing a sent message (`MessageEditForm`): turning core's draft back into what the composer
//! types with, and the edited text back into a draft.

use super::rules::resolve_mentions;
use semaphore_core::model::{DraftMention, MentionCandidate, MentionKind, MessageDraft};

/// A custom emoji kept from the message being edited: its `:name:` text and its id. The composer
/// offers no emoji candidates, so these are found again by their text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeptEmoji {
    pub text: String,
    pub id: String,
}

/// The message's mentions as if they'd been picked from the dropdown, and its custom emoji.
pub fn picked_from_draft(draft: &MessageDraft) -> (Vec<MentionCandidate>, Vec<KeptEmoji>) {
    let mut picked = Vec::new();
    let mut emoji = Vec::new();
    for mention in &draft.mentions {
        let Some(text) = draft
            .text
            .get(mention.start as usize..mention.end as usize)
            .filter(|text| !text.is_empty())
        else {
            continue;
        };
        if mention.kind == MentionKind::Emoji {
            emoji.push(KeptEmoji {
                text: text.to_owned(),
                id: mention.id.clone(),
            });
        } else {
            picked.push(MentionCandidate {
                kind: mention.kind,
                id: mention.id.clone(),
                label: text.trim_start_matches(['@', '#']).to_owned(),
                insert_text: text.to_owned(),
                avatar_file_id: None,
            });
        }
    }
    (picked, emoji)
}

/// The edited text's mentions: those still spelled as picked (or typed), plus each kept emoji
/// wherever its `:name:` still appears. In order, never overlapping.
pub fn edit_mentions(
    text: &str,
    picked: &[MentionCandidate],
    emoji: &[KeptEmoji],
    lookup: impl Fn(&str) -> Option<MentionCandidate>,
) -> Vec<DraftMention> {
    let mut found = resolve_mentions(text, picked, lookup);
    for kept in emoji {
        for (at, _) in text.match_indices(kept.text.as_str()) {
            let (start, end) = (at as u32, (at + kept.text.len()) as u32);
            let overlaps = found
                .iter()
                .any(|mention| start < mention.end && mention.start < end);
            if !overlaps {
                found.push(DraftMention {
                    start,
                    end,
                    kind: MentionKind::Emoji,
                    id: kept.id.clone(),
                });
            }
        }
    }
    found.sort_by_key(|mention| mention.start);
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::v1::test;

    fn draft() -> MessageDraft {
        // "hi @ava :party: see #general"
        let text = "hi @ava :party: see #general".to_owned();
        MessageDraft {
            mentions: vec![
                DraftMention {
                    start: 3,
                    end: 7,
                    kind: MentionKind::User,
                    id: "u-ava".into(),
                },
                DraftMention {
                    start: 8,
                    end: 15,
                    kind: MentionKind::Emoji,
                    id: "e-party".into(),
                },
                DraftMention {
                    start: 20,
                    end: 28,
                    kind: MentionKind::Channel,
                    id: "c-general".into(),
                },
            ],
            text,
            ..MessageDraft::default()
        }
    }

    #[test]
    fn an_unchanged_edit_keeps_every_mention_and_emoji() {
        let draft = draft();
        let (picked, emoji) = picked_from_draft(&draft);
        assert_eq!(picked.len(), 2);
        assert_eq!(
            emoji,
            vec![KeptEmoji {
                text: ":party:".into(),
                id: "e-party".into()
            }]
        );
        assert_eq!(
            edit_mentions(&draft.text, &picked, &emoji, |_| None),
            draft.mentions
        );
    }

    #[test]
    fn edited_text_moves_the_ranges_and_drops_what_was_changed() {
        let (picked, emoji) = picked_from_draft(&draft());
        let text = "well :party: hi @avb, see #general :party:";
        let found = edit_mentions(text, &picked, &emoji, |_| None);
        let kinds: Vec<(u32, MentionKind)> = found.iter().map(|m| (m.start, m.kind)).collect();
        assert_eq!(
            kinds,
            vec![
                (5, MentionKind::Emoji),
                (26, MentionKind::Channel),
                (35, MentionKind::Emoji),
            ]
        );
    }
}
