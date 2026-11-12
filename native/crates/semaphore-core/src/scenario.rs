//! Exported Ladle scenarios as view models, for stories. Behind the `fixtures` feature.
//! Unit U3 owns this file; see `native/docs/slice-units/U3-scenarios.md`.
//!
//! The JSON comes from `scripts/gen-scenarios.sh`, which exports the web client's story fixtures
//! at the commit in `contract/PIN` and validates every entity against `contract/openapi.json`.
//! Parsing is deliberately by `serde_json::Value`: the scenarios carry fields core doesn't need,
//! and a story must still render when a newer export adds another one.

use crate::model::{
    AttachmentKind, AttachmentView, ChannelKind, ChannelPreset, ChannelRow, CommunityRow,
    Conversation, LinkPreviewView, MessageRow, ReactionView, ReplyToView, SendState, TextStyle,
    UserView, VoiceView, WebhookView,
};
use crate::platform::CoreError;
use crate::text::{SpanInput, layout_spans};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Everything a story can render, already in view-model form.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScenarioViews {
    pub me: UserView,
    pub communities: Vec<CommunityRow>,
    /// All communities' channels, in display order.
    pub channels: Vec<ChannelRow>,
    /// Oldest first in each conversation.
    pub messages: Vec<(Conversation, Vec<MessageRow>)>,
    pub voice: VoiceView,
}

/// A default for absent fields. `&Value::Null` can't be promoted to `'static` (a `Value` needs
/// drop), so the null lives here.
static NULL: Value = Value::Null;

fn get<'a>(value: &'a Value, key: &str) -> &'a Value {
    value.get(key).unwrap_or(&NULL)
}

fn string(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned)
}

fn flag(value: &Value) -> bool {
    value.as_bool().unwrap_or(false)
}

fn list(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn entries(value: &Value) -> impl Iterator<Item = (&String, &Value)> {
    value.as_object().into_iter().flatten()
}

fn integer(value: &Value) -> i64 {
    value.as_i64().unwrap_or(0)
}

fn time_ms(value: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|at| at.timestamp_millis())
}

fn reply_to_view(value: &Value, authors: &HashMap<String, UserView>) -> Option<ReplyToView> {
    let message_id = string(get(value, "id"))?;
    let author_id = string(get(value, "authorId")).unwrap_or_default();
    let deleted = !get(value, "deletedAt").is_null();
    Some(ReplyToView {
        message_id,
        author: authors
            .get(&author_id)
            .cloned()
            .unwrap_or_else(|| UserView {
                username: author_id.clone(),
                id: author_id,
                ..UserView::default()
            }),
        text: if deleted {
            String::new()
        } else {
            list(get(value, "spans"))
                .iter()
                .filter_map(|span| get(span, "text").as_str())
                .collect()
        },
        deleted,
    })
}

fn link_preview_view(value: &Value) -> LinkPreviewView {
    LinkPreviewView {
        url: string(get(value, "url")).unwrap_or_default(),
        title: string(get(value, "title")),
        description: string(get(value, "description")),
        image_url: string(get(value, "imageUrl")),
        site_name: string(get(value, "siteName")),
        favicon_url: string(get(value, "faviconUrl")),
        author_name: string(get(value, "authorName")),
    }
}

fn webhook_view(value: &Value) -> Option<WebhookView> {
    Some(WebhookView {
        id: string(get(value, "id"))?,
        name: string(get(value, "name")).unwrap_or_default(),
        avatar_url: string(get(value, "avatarUrl")),
    })
}

fn user_view(value: &Value) -> UserView {
    let id = string(get(value, "id")).unwrap_or_default();
    UserView {
        username: string(get(value, "username"))
            .filter(|username| !username.is_empty())
            .unwrap_or_else(|| id.clone()),
        id,
        display_name: string(get(value, "displayName")),
        avatar_file_id: string(get(value, "avatarUrl")),
    }
}

/// `(unread, mentions)`, zero when the context has no entry.
fn unread_counts(unread: &HashMap<String, (u32, u32)>, context_id: &str) -> (u32, u32) {
    unread.get(context_id).copied().unwrap_or((0, 0))
}

fn channel_row(
    community_id: &str,
    value: &Value,
    unread: &HashMap<String, (u32, u32)>,
    voice_users: &HashMap<String, Vec<UserView>>,
) -> ChannelRow {
    let id = string(get(value, "id")).unwrap_or_default();
    let kind = match get(value, "type").as_str() {
        Some("TEXT") => ChannelKind::Text,
        Some("VOICE") => ChannelKind::Voice,
        _ => ChannelKind::Unknown,
    };
    let (unread_count, mention_count) = unread_counts(unread, &id);
    ChannelRow {
        community_id: string(get(value, "communityId")).unwrap_or_else(|| community_id.to_owned()),
        id: id.clone(),
        name: string(get(value, "name")).unwrap_or_default(),
        kind,
        is_private: flag(get(value, "isPrivate")),
        position: get(value, "position").as_i64().unwrap_or(0) as i32,
        unread_count,
        mention_count,
        voice_users: voice_users.get(&id).cloned().unwrap_or_default(),
        slowmode_seconds: integer(get(value, "slowmodeSeconds")).max(0) as u32,
        permissions: None,
        preset: match get(value, "preset").as_str() {
            Some("READ_ONLY") => ChannelPreset::ReadOnly,
            Some("ANNOUNCEMENT") => ChannelPreset::Announcement,
            Some("MODS_ONLY") => ChannelPreset::ModsOnly,
            Some("CUSTOM") => ChannelPreset::Custom,
            _ => ChannelPreset::Normal,
        },
    }
}

fn span_input(span: &Value) -> SpanInput {
    SpanInput {
        kind: string(get(span, "type")).unwrap_or_default(),
        text: string(get(span, "text")),
        user_id: string(get(span, "userId")),
        special_kind: string(get(span, "specialKind")),
        community_id: string(get(span, "communityId")),
        alias_id: string(get(span, "aliasId")),
        channel_id: string(get(span, "channelId")),
        emoji_id: string(get(span, "emojiId")),
        style: TextStyle {
            bold: flag(get(span, "bold")),
            italic: flag(get(span, "italic")),
            strikethrough: flag(get(span, "strikethrough")),
            code: flag(get(span, "code")),
        },
    }
}

fn attachment_view(value: &Value) -> AttachmentView {
    let kind = match get(value, "fileType").as_str() {
        Some("IMAGE") => AttachmentKind::Image,
        Some("VIDEO") => AttachmentKind::Video,
        Some("AUDIO") => AttachmentKind::Audio,
        Some("DOCUMENT") => AttachmentKind::Document,
        _ => AttachmentKind::Other,
    };
    AttachmentView {
        file_id: string(get(value, "id")).unwrap_or_default(),
        filename: string(get(value, "filename")).unwrap_or_default(),
        mime_type: string(get(value, "mimeType")).unwrap_or_default(),
        size_bytes: get(value, "size").as_u64().unwrap_or(0),
        kind,
        has_thumbnail: flag(get(value, "hasThumbnail")),
        // The contract has no pixel dimensions; unit U12 adds them.
        width: None,
        height: None,
    }
}

fn reaction_view(value: &Value, me_id: &str) -> ReactionView {
    let user_ids = list(get(value, "userIds"));
    ReactionView {
        emoji: string(get(value, "emoji")).unwrap_or_default(),
        count: user_ids.len() as u32,
        me: user_ids
            .iter()
            .any(|user_id| user_id.as_str() == Some(me_id)),
        user_ids: user_ids.iter().filter_map(string).collect(),
        custom_emoji_id: string(get(value, "emoji"))
            .as_deref()
            .and_then(crate::store::custom_emoji_id),
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// RFC 3339 in UTC (`2026-09-22T18:00:00.000Z`), as `Date.prototype.toISOString` writes it, to
/// Unix milliseconds. `None` for anything else. Fractions are truncated to milliseconds.
///
/// `chrono` would do this, but the core boundary guard rejects it: in the workspace graph its
/// package reaches `iana-time-zone`, `cc` and `js-sys` through other crates' features.
fn parse_rfc3339_ms(text: &str) -> Option<i64> {
    let body = text.strip_suffix('Z')?;
    let (date_time, fraction) = match body.split_once('.') {
        Some((date_time, fraction)) => (date_time, Some(fraction)),
        None => (body, None),
    };
    let parts: Vec<&str> = date_time.split(['-', 'T', ':']).collect();
    let [year, month, day, hour, minute, second] = parts[..] else {
        return None;
    };
    let year: i64 = year.parse().ok()?;
    let month: i64 = month.parse().ok()?;
    let day: i64 = day.parse().ok()?;
    let hour: i64 = hour.parse().ok()?;
    let minute: i64 = minute.parse().ok()?;
    let second: i64 = second.parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }
    if second > 60 {
        return None;
    }
    let millis = match fraction {
        None => 0,
        Some(fraction) => {
            if fraction.is_empty()
                || fraction.len() > 9
                || !fraction.bytes().all(|b| b.is_ascii_digit())
            {
                return None;
            }
            let mut digits = fraction[..fraction.len().min(3)].to_owned();
            while digits.len() < 3 {
                digits.push('0');
            }
            digits.parse().ok()?
        }
    };
    let seconds = days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
    Some(seconds * 1_000 + millis)
}

fn sent_at_ms(message: &Value) -> Result<i64, CoreError> {
    let sent_at = get(message, "sentAt").as_str().unwrap_or_default();
    parse_rfc3339_ms(sent_at).ok_or_else(|| CoreError::Failed {
        message: format!(
            "scenario message {}: sentAt {sent_at:?} is not an RFC 3339 UTC timestamp",
            get(message, "id").as_str().unwrap_or("(no id)")
        ),
    })
}

fn message_row(
    message: &Value,
    authors: &HashMap<String, UserView>,
    me_id: &str,
) -> Result<MessageRow, CoreError> {
    let author_id = string(get(message, "authorId")).unwrap_or_default();
    let author = authors
        .get(&author_id)
        .cloned()
        .unwrap_or_else(|| UserView {
            // A message from an author the scenario no longer carries still renders.
            username: author_id.clone(),
            id: author_id,
            display_name: None,
            avatar_file_id: None,
        });
    let removed = !get(message, "deletedAt").is_null();
    let (display, segs, attachments, reactions) = if removed {
        (String::new(), Vec::new(), Vec::new(), Vec::new())
    } else {
        let spans: Vec<SpanInput> = list(get(message, "spans")).iter().map(span_input).collect();
        let (display, segs) = layout_spans(&spans);
        (
            display,
            segs,
            list(get(message, "attachments"))
                .iter()
                .map(attachment_view)
                .collect(),
            list(get(message, "reactions"))
                .iter()
                .map(|reaction| reaction_view(reaction, me_id))
                .collect(),
        )
    };
    let mine = !me_id.is_empty() && author.id == me_id;
    Ok(MessageRow {
        seq: 0,
        id: string(get(message, "id")),
        client_nonce: None,
        author,
        sent_at_ms: sent_at_ms(message)?,
        edited: !get(message, "editedAt").is_null(),
        mine,
        edit_pending: false,
        removed,
        removed_by: None,
        removed_reason: None,
        display,
        segs,
        attachments,
        reactions,
        reply_count: integer(get(message, "replyCount")).max(0) as u32,
        last_reply_at_ms: time_ms(get(message, "lastReplyAt")),
        reply_to: if removed {
            None
        } else {
            reply_to_view(get(message, "replyTo"), authors)
        },
        link_previews: if removed {
            Vec::new()
        } else {
            list(get(message, "linkPreviews"))
                .iter()
                .map(link_preview_view)
                .collect()
        },
        gif: None,
        pinned: flag(get(message, "pinned")),
        pinned_by: None,
        pinned_at_ms: time_ms(get(message, "pinnedAt")),
        webhook: webhook_view(get(message, "webhook")),
        send_state: SendState::Sent,
        pending_attachments: 0,
        uploads: Vec::new(),
        revision: 0,
    })
}

/// Oldest first, `seq` assigned from zero in that order. Stable, so equal timestamps keep the
/// export's order.
fn conversation_rows(
    messages: &[Value],
    authors: &HashMap<String, UserView>,
    me_id: &str,
) -> Result<Vec<MessageRow>, CoreError> {
    let mut rows = messages
        .iter()
        .map(|message| message_row(message, authors, me_id))
        .collect::<Result<Vec<_>, _>>()?;
    rows.sort_by_key(|row| row.sent_at_ms);
    for (index, row) in rows.iter_mut().enumerate() {
        row.seq = index as i64;
    }
    Ok(rows)
}

/// The exported `Scenario` as view models: communities, channels and the conversations stories
/// open. `empty-user` has no communities, so the messages its builder made for them are dropped
/// with them, as are threads on messages that are no longer visible.
pub fn from_json(json: &str) -> Result<ScenarioViews, CoreError> {
    let root: Value = serde_json::from_str(json).map_err(|error| CoreError::Failed {
        message: format!("scenario JSON: {error}"),
    })?;

    let me = user_view(get(&root, "me"));
    let me_id = me.id.clone();
    let mut authors: HashMap<String, UserView> = HashMap::new();
    authors.insert(me.id.clone(), me.clone());
    for user in list(get(&root, "users")) {
        let view = user_view(user);
        authors.insert(view.id.clone(), view);
    }

    let mut unread: HashMap<String, (u32, u32)> = HashMap::new();
    for (context_id, counts) in entries(get(&root, "unreadByContextId")) {
        unread.insert(
            context_id.clone(),
            (
                integer(get(counts, "unreadCount")).max(0) as u32,
                integer(get(counts, "mentionCount")).max(0) as u32,
            ),
        );
    }

    let mut voice_users: HashMap<String, Vec<UserView>> = HashMap::new();
    for (channel_id, presence) in entries(get(&root, "voicePresenceByChannel")) {
        voice_users.insert(
            channel_id.clone(),
            list(presence).iter().map(user_view).collect(),
        );
    }

    let mut communities = Vec::new();
    let mut channels = Vec::new();
    for community in list(get(&root, "communities")) {
        let id = string(get(community, "id")).unwrap_or_default();
        let (mut unread_count, mut mention_count) = (0_u32, 0_u32);
        let mut rows = Vec::new();
        for channel in list(get(community, "channels")) {
            let row = channel_row(&id, channel, &unread, &voice_users);
            unread_count = unread_count.saturating_add(row.unread_count);
            mention_count = mention_count.saturating_add(row.mention_count);
            rows.push(row);
        }
        communities.push(CommunityRow {
            id,
            name: string(get(community, "name")).unwrap_or_default(),
            avatar_file_id: string(get(community, "avatar")),
            unread_count,
            mention_count,
        });
        channels.extend(rows);
    }

    let channel_ids: HashSet<&str> = channels.iter().map(|row| row.id.as_str()).collect();
    let mut conversations: Vec<(Conversation, Vec<MessageRow>)> = Vec::new();
    let mut visible_message_ids: HashSet<String> = HashSet::new();
    for (channel_id, messages) in entries(get(&root, "messagesByChannel")) {
        if !channel_ids.contains(channel_id.as_str()) {
            continue;
        }
        let rows = conversation_rows(list(messages), &authors, &me_id)?;
        visible_message_ids.extend(rows.iter().filter_map(|row| row.id.clone()));
        conversations.push((
            Conversation::Channel {
                id: channel_id.clone(),
            },
            rows,
        ));
    }
    for (dm_group_id, messages) in entries(get(&root, "messagesByDmGroup")) {
        conversations.push((
            Conversation::DirectMessage {
                id: dm_group_id.clone(),
            },
            conversation_rows(list(messages), &authors, &me_id)?,
        ));
    }
    for (parent_id, replies) in entries(get(&root, "threadRepliesByParent")) {
        if !visible_message_ids.contains(parent_id) {
            continue;
        }
        conversations.push((
            Conversation::Thread {
                parent_message_id: parent_id.clone(),
            },
            conversation_rows(list(replies), &authors, &me_id)?,
        ));
    }
    conversations.sort_by(|left, right| left.0.cmp(&right.0));

    Ok(ScenarioViews {
        me,
        communities,
        channels,
        messages: conversations,
        voice: VoiceView::default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SegKind;

    fn fixture(name: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/scenarios")
            .join(format!("{name}.json"));
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
    }

    fn scenario_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/scenarios")
    }

    fn rows(views: &ScenarioViews) -> impl Iterator<Item = &MessageRow> {
        views.messages.iter().flat_map(|(_, rows)| rows.iter())
    }

    #[test]
    fn timestamps_parse_to_unix_milliseconds() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_rfc3339_ms("1969-12-31T23:59:59.999Z"), Some(-1));
        assert_eq!(
            parse_rfc3339_ms("2026-09-22T18:00:00.000Z"),
            Some(1_790_100_000_000)
        );
        assert_eq!(
            parse_rfc3339_ms("2026-09-22T18:00:00Z"),
            Some(1_790_100_000_000)
        );
        assert_eq!(parse_rfc3339_ms("2026-09-22 18:00:00Z"), None);
        assert_eq!(parse_rfc3339_ms("2026-09-22T18:00:00+02:00"), None);
    }

    #[test]
    fn every_exported_scenario_parses() {
        let mut names: Vec<String> = std::fs::read_dir(scenario_dir())
            .expect("fixtures/scenarios")
            .filter_map(|entry| {
                let path = entry.ok()?.path();
                (path.extension()? == "json")
                    .then(|| path.file_stem()?.to_str().map(str::to_owned))?
            })
            .collect();
        names.sort();
        assert_eq!(
            names,
            ["big-community", "empty-user", "long-history", "showcase"]
        );
        for name in names {
            let views =
                from_json(&fixture(&name)).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert!(!views.me.id.is_empty(), "{name} has no me");
        }
    }

    #[test]
    fn big_community_matches_the_export() {
        let json = fixture("big-community");
        let value: Value = serde_json::from_str(&json).unwrap();
        let views = from_json(&json).unwrap();

        let expected_communities = list(get(&value, "communities")).len();
        let expected_channels: usize = list(get(&value, "communities"))
            .iter()
            .map(|community| list(get(community, "channels")).len())
            .sum();
        let expected_messages: usize = [
            "messagesByChannel",
            "messagesByDmGroup",
            "threadRepliesByParent",
        ]
        .iter()
        .map(|key| {
            entries(get(&value, key))
                .map(|(_, messages)| messages.as_array().map_or(0, Vec::len))
                .sum::<usize>()
        })
        .sum();

        assert_eq!(views.communities.len(), expected_communities);
        assert_eq!(views.channels.len(), expected_channels);
        assert_eq!(rows(&views).count(), expected_messages);
    }

    #[test]
    fn messages_are_oldest_first_with_increasing_seq() {
        for name in ["big-community", "empty-user", "long-history", "showcase"] {
            let views = from_json(&fixture(name)).unwrap();
            for (conversation, rows) in &views.messages {
                for (index, row) in rows.iter().enumerate() {
                    assert_eq!(row.seq, index as i64, "{name} {conversation:?}");
                    if let Some(previous) = index.checked_sub(1).map(|i| &rows[i]) {
                        assert!(
                            previous.sent_at_ms <= row.sent_at_ms,
                            "{name} {conversation:?}: {} before {}",
                            previous.sent_at_ms,
                            row.sent_at_ms
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn text_segments_are_ordered_and_cover_the_display_string() {
        for name in ["big-community", "empty-user", "long-history", "showcase"] {
            let views = from_json(&fixture(name)).unwrap();
            for row in rows(&views) {
                let mut previous_end = None;
                for seg in &row.segs {
                    let end = seg.end as usize;
                    assert!(
                        row.display.is_char_boundary(end),
                        "{name}: {} is not a char boundary in {:?}",
                        end,
                        row.display
                    );
                    if let Some(previous) = previous_end {
                        assert!(previous < end, "{name}: ends {:?}", end);
                    }
                    previous_end = Some(end);
                }
                if let Some(last) = previous_end {
                    assert_eq!(last, row.display.len(), "{name}: {:?}", row.display);
                }
            }
        }
    }

    #[test]
    fn an_unknown_span_type_still_renders_its_text() {
        let mut value: Value = serde_json::from_str(&fixture("big-community")).unwrap();
        let channel = entries(get(&value, "messagesByChannel"))
            .map(|(_, messages)| messages)
            .find(|messages| messages.as_array().is_some_and(|list| !list.is_empty()))
            .expect("a channel with messages")
            .clone();
        let mut message = channel[0].clone();
        message["spans"] = serde_json::json!([
            { "type": "HOLOGRAM_FROM_THE_FUTURE", "text": "still readable" },
        ]);
        let id = message["id"].as_str().unwrap().to_owned();
        let channel_id = message["channelId"].as_str().unwrap().to_owned();
        value["messagesByChannel"][channel_id.as_str()][0] = message;

        let views = from_json(&serde_json::to_string(&value).unwrap()).unwrap();
        let row = rows(&views)
            .find(|row| row.id.as_deref() == Some(id.as_str()))
            .expect("the edited message");
        assert_eq!(row.display, "still readable");
        assert_eq!(row.segs.len(), 1);
        assert_eq!(row.segs[0].kind, SegKind::Text);
    }

    #[test]
    fn an_empty_user_has_empty_lists() {
        let views = from_json(&fixture("empty-user")).unwrap();
        assert!(views.communities.is_empty());
        assert!(views.channels.is_empty());
        assert!(views.messages.is_empty());
        assert_eq!(views.voice, VoiceView::default());
    }
}
