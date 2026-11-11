//! Communities, channels, members, emoji and mention candidates.

use super::SPECIAL_MENTIONS;
use crate::cache::{QueryKey, keys};
use crate::client::{Core, user_view};
use crate::model::{
    ChannelKind, ChannelPermissions, ChannelPreset, ChannelRow, CommunityRow, DisplayRole,
    EmojiView, MemberList, MemberView, MentionCandidate, MentionKind, RailCounts, UserView,
};
use semaphore_wire::enums::ChannelType;
use semaphore_wire::types as wire;

/// W5: the wire preset as the model's.
pub(crate) fn channel_preset(preset: &semaphore_wire::enums::ChannelPreset) -> ChannelPreset {
    use semaphore_wire::enums::ChannelPreset as Wire;
    match preset {
        Wire::Normal => ChannelPreset::Normal,
        Wire::ReadOnly => ChannelPreset::ReadOnly,
        Wire::Announcement => ChannelPreset::Announcement,
        Wire::ModsOnly => ChannelPreset::ModsOnly,
        Wire::Custom => ChannelPreset::Custom,
        Wire::Unknown(_) => ChannelPreset::Unknown,
    }
}

fn channel_permissions(capability: &wire::ChannelCapabilitiesDto) -> ChannelPermissions {
    ChannelPermissions {
        post: capability.post,
        attach: capability.attach,
        react: capability.react,
        thread_reply: capability.thread_reply,
        connect: capability.connect,
        speak: capability.speak,
        video: capability.video,
        share: capability.share,
        manage_permissions: capability.manage_permissions,
        posting_role_names: capability.posting_role_names.clone(),
        timed_out_until_ms: capability.timed_out_until.map(|at| at.timestamp_millis()),
    }
}

impl Core {
    pub fn communities(&self) -> Vec<CommunityRow> {
        self.write(|state, _| {
            let key = keys::op(keys::COMMUNITIES);
            state.ensure_query(key.clone());
            state.ensure_query(keys::op(keys::UNREAD));
            let communities = state.cache.communities(&key).cloned().unwrap_or_default();
            communities
                .into_iter()
                .map(|community| {
                    let (mut unread, mut mention) = (0, 0);
                    let channels = state
                        .cache
                        .channels(&keys::scoped(keys::CHANNELS, &community.id));
                    for channel in channels.into_iter().flatten() {
                        let (channel_unread, channel_mention) = state.unread_for(&channel.id);
                        unread += channel_unread;
                        mention += channel_mention;
                    }
                    CommunityRow {
                        id: community.id,
                        name: community.name,
                        avatar_file_id: community.avatar,
                        unread_count: unread,
                        mention_count: mention,
                    }
                })
                .collect()
        })
    }

    pub fn channels(&self, community_id: String) -> Vec<ChannelRow> {
        self.write(|state, _| {
            let key = keys::scoped(keys::CHANNELS, &community_id);
            state.ensure_query(key.clone());
            state.ensure_query(keys::op(keys::UNREAD));
            let capabilities_key = keys::scoped(keys::CAPABILITIES, &community_id);
            state.ensure_query(capabilities_key.clone());
            let mut channels = state.cache.channels(&key).cloned().unwrap_or_default();
            channels.sort_by_key(|channel| channel.position);
            channels
                .into_iter()
                .map(|channel| {
                    let kind = match channel.type_ {
                        ChannelType::Text => ChannelKind::Text,
                        ChannelType::Voice => ChannelKind::Voice,
                        _ => ChannelKind::Unknown,
                    };
                    if kind == ChannelKind::Voice {
                        state.ensure_query(keys::scoped(keys::VOICE_PRESENCE, &channel.id));
                    }
                    let (unread_count, mention_count) = state.unread_for(&channel.id);
                    let voice_users = Core::presence_users(state, &channel.id);
                    let permissions =
                        state
                            .cache
                            .capabilities(&capabilities_key)
                            .and_then(|capabilities| {
                                capabilities
                                    .channels
                                    .iter()
                                    .find(|capability| capability.channel_id == channel.id)
                                    .map(channel_permissions)
                            });
                    ChannelRow {
                        preset: channel_preset(&channel.preset),
                        slowmode_seconds: channel.slowmode_seconds.max(0) as u32,
                        permissions,
                        community_id: channel.community_id,
                        is_private: channel.is_private,
                        position: channel.position as i32,
                        name: channel.name,
                        id: channel.id,
                        kind,
                        unread_count,
                        mention_count,
                        voice_users,
                    }
                })
                .collect()
        })
    }

    /// `None` until the first page has loaded. `ViewKey::Members` says when to read again.
    pub fn members(&self, community_id: String) -> Option<MemberList> {
        self.write(|state, _| {
            let key = keys::scoped(keys::MEMBERS, &community_id);
            let presence_key = keys::op(keys::PRESENCE);
            state.ensure_query(key.clone());
            state.ensure_query(presence_key.clone());
            let me_id = state.me_id().to_owned();
            let pages = state.cache.members(&key)?;
            let online = state.cache.presence(&presence_key);
            let members = pages
                .members
                .iter()
                .map(|member| {
                    // The user's own entry is what events keep fresh.
                    let user = state
                        .cache
                        .user(&keys::scoped(keys::USER, &member.user_id))
                        .or(member.user.as_ref());
                    let display_role = member
                        .roles
                        .iter()
                        .filter(|role| !role.is_default)
                        .min_by_key(|role| role.position)
                        .map(|role| DisplayRole {
                            name: role.name.clone(),
                            position: role.position as i32,
                        });
                    MemberView {
                        user: user.map(user_view).unwrap_or_else(|| UserView {
                            id: member.user_id.clone(),
                            ..UserView::default()
                        }),
                        status: user.and_then(|user| user.status.clone()),
                        // This client is connected even before the map says so.
                        online: member.user_id == me_id
                            || online
                                .and_then(|online| online.get(&member.user_id))
                                .copied()
                                .unwrap_or(false),
                        display_role,
                    }
                })
                .collect();
            Some(MemberList {
                members,
                truncated: pages.truncated,
            })
        })
    }

    /// The rail's counters. Zero until they load; `ViewKey::Rail` says when to read again.
    pub fn rail_counts(&self) -> RailCounts {
        self.write(|state, _| {
            let unread_key = keys::op(keys::UNREAD);
            let notifications_key = keys::op(keys::NOTIFICATION_COUNT);
            state.ensure_query(unread_key.clone());
            state.ensure_query(notifications_key.clone());
            let dm_unread = state
                .cache
                .unread_counts(&unread_key)
                .into_iter()
                .flatten()
                .filter(|count| count.direct_message_group_id.is_some())
                .map(|count| count.unread_count.max(0) as u32)
                .sum();
            RailCounts {
                dm_unread,
                notifications_unread: state
                    .cache
                    .notification_count(&notifications_key)
                    .map_or(0, |count| (*count).max(0) as u32),
            }
        })
    }

    /// A community's custom emoji. `ViewKey::Mentionables` says when to read again.
    pub fn custom_emojis(&self, community_id: String) -> Vec<EmojiView> {
        self.write(|state, _| {
            let key = keys::scoped(keys::EMOJIS, &community_id);
            state.ensure_query(key.clone());
            state
                .cache
                .emojis(&key)
                .into_iter()
                .flatten()
                .map(|emoji| EmojiView {
                    id: emoji.id.clone(),
                    name: emoji.name.clone(),
                    file_id: emoji.file_id.clone(),
                })
                .collect()
        })
    }

    /// Completions for what's typed after `@` or `#`, with or without its trigger. Mention groups
    /// aren't offered yet: they aren't in `Backend`.
    pub fn mention_candidates(&self, community_id: String, query: String) -> Vec<MentionCandidate> {
        self.write(|state, _| {
            if let Some(channel_query) = query.strip_prefix('#') {
                let key = keys::scoped(keys::MENTIONABLE, &community_id);
                state.ensure_query(key.clone());
                let needle = channel_query.to_lowercase();
                return state
                    .cache
                    .mentionable_channels(&key)
                    .into_iter()
                    .flatten()
                    .filter(|channel| channel.name.to_lowercase().contains(&needle))
                    .map(|channel| MentionCandidate {
                        kind: MentionKind::Channel,
                        id: channel.id.clone(),
                        label: channel.name.clone(),
                        insert_text: format!("#{}", channel.name),
                        avatar_file_id: None,
                    })
                    .collect();
            }
            let needle = query.strip_prefix('@').unwrap_or(&query).to_lowercase();
            let mut candidates: Vec<MentionCandidate> = SPECIAL_MENTIONS
                .iter()
                .filter(|special| special.starts_with(&needle))
                .map(|special| MentionCandidate {
                    kind: MentionKind::Special,
                    id: (*special).to_owned(),
                    label: (*special).to_owned(),
                    insert_text: format!("@{special}"),
                    avatar_file_id: None,
                })
                .collect();
            let key = QueryKey::new(&[keys::MEMBER_SEARCH, &community_id, &needle]);
            state.ensure_query(key.clone());
            state.cache.touch(&key);
            let users = state.cache.member_search(&key).into_iter().flatten();
            candidates.extend(users.filter_map(|member| member.user.as_ref()).map(|user| {
                MentionCandidate {
                    kind: MentionKind::User,
                    id: user.id.clone(),
                    label: user
                        .display_name
                        .clone()
                        .unwrap_or_else(|| user.username.clone()),
                    insert_text: format!("@{}", user.username),
                    avatar_file_id: user.avatar_url.clone(),
                }
            }));
            candidates
        })
    }
}
