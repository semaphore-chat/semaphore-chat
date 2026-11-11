//! W5-A's state: what community administration has changed in the fake world. Communities and
//! their channels are copied from the scenario (or W3's created ones) on their first change, and
//! read through [`community`] from then on; a deleted one reads as gone.
//!
//! The scenario's `privateMembersByChannel` (`{ channelId: [userId] }`) seeds private channel
//! members; a private channel with no list is visible to everyone, as the scenarios had it.
//!
//! Permission checks go through `crate::rbac::allows`, which W5-B owns, and are made before this
//! lock is taken: `admin` is never held with `data` or `rbac`.

use crate::scenario::{Community, entity_uuid};
use crate::{Inner, lock};
use axum::response::{IntoResponse, Response};
use semaphore_wire::types::{
    AliasGroupMemberDto, ChannelMembershipResponseDto, CustomEmojiDto, InviteResponseDto,
    MembershipResponseDto, SoundboardSoundDto, WebhookDto,
};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone)]
pub(crate) struct AliasGroup {
    pub id: String,
    pub community_id: String,
    pub name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub members: Vec<String>,
}

#[derive(Debug, Default)]
pub(crate) struct Admin {
    seeded: bool,
    next: u64,
    /// Communities changed here, with their channels.
    pub communities: HashMap<String, Community>,
    pub deleted: HashSet<String>,
    /// Members added over the API, by community.
    pub members: HashMap<String, Vec<MembershipResponseDto>>,
    /// Private channels' members, by channel. A channel without an entry has no list.
    pub private_members: HashMap<String, Vec<ChannelMembershipResponseDto>>,
    pub alias_groups: Vec<AliasGroup>,
    /// Emoji and sounds added here, by community; and the ids deleted (the scenario's too).
    pub emojis: HashMap<String, Vec<CustomEmojiDto>>,
    pub sounds: HashMap<String, Vec<SoundboardSoundDto>>,
    pub removed_assets: HashSet<String>,
    /// Webhooks and the token each was made with.
    pub webhooks: Vec<(WebhookDto, String)>,
    pub invites: Vec<InviteResponseDto>,
}

impl Admin {
    pub fn next_id(&mut self, kind: &str) -> String {
        self.next += 1;
        entity_uuid(&format!("w5a-{kind}-{:06}", self.next))
    }

    /// The scenario's `extra` keys W5-A reads, once.
    pub fn seed(&mut self, inner: &Inner) {
        if std::mem::replace(&mut self.seeded, true) {
            return;
        }
        let Some(Value::Object(channels)) = inner.scenario.extra.get("privateMembersByChannel")
        else {
            return;
        };
        let at = inner.now();
        for (channel, users) in channels {
            let channel = uuid_or(channel);
            let rows = users
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|user| {
                    let user = uuid_or(user);
                    ChannelMembershipResponseDto {
                        added_by: None,
                        channel_id: channel.clone(),
                        id: entity_uuid(&format!("w5a-seed-cm:{channel}:{user}")),
                        joined_at: at,
                        user: inner.user_entity(&user),
                        user_id: user,
                    }
                })
                .collect();
            self.private_members.insert(channel, rows);
        }
    }

    /// The community as it is now, copied here to be changed.
    pub fn community_mut(&mut self, inner: &Inner, id: &str) -> Option<&mut Community> {
        if self.deleted.contains(id) {
            return None;
        }
        if !self.communities.contains_key(id) {
            let community = inner.find_community(id)?;
            self.communities.insert(id.to_owned(), community);
        }
        self.communities.get_mut(id)
    }

    pub fn group(&self, id: &str) -> Option<&AliasGroup> {
        self.alias_groups.iter().find(|group| group.id == id)
    }
}

/// The community as it is now: changed here, deleted, or the scenario's.
pub(crate) fn community(inner: &Inner, id: &str) -> Option<Community> {
    {
        let admin = lock(&inner.admin);
        if admin.deleted.contains(id) {
            return None;
        }
        if let Some(community) = admin.communities.get(id) {
            return Some(community.clone());
        }
    }
    inner.find_community(id)
}

/// The changed copy of a community, for `communities/mine`.
pub(crate) fn changed(inner: &Inner, community: Community) -> Option<Community> {
    let admin = lock(&inner.admin);
    if admin.deleted.contains(&community.id) {
        return None;
    }
    Some(
        admin
            .communities
            .get(&community.id)
            .cloned()
            .unwrap_or(community),
    )
}

/// The community and channel a channel id names.
pub(crate) fn channel_of(
    inner: &Inner,
    channel_id: &str,
) -> Option<(Community, semaphore_wire::types::ChannelDto)> {
    let mut ids: Vec<String> = inner
        .scenario
        .communities
        .iter()
        .map(|community| community.id.clone())
        .collect();
    ids.extend(lock(&inner.admin).communities.keys().cloned());
    ids.extend(
        lock(&inner.accounts)
            .communities
            .iter()
            .map(|created| created.community.id.clone()),
    );
    ids.into_iter().find_map(|id| {
        let community = community(inner, &id)?;
        let channel = community
            .channels
            .iter()
            .find(|channel| channel.id == channel_id)?
            .clone();
        Some((community, channel))
    })
}

/// The community's members now: the scenario's (or a created community's) and those added here.
pub(crate) fn members(inner: &Inner, community_id: &str) -> Vec<MembershipResponseDto> {
    let mut members = inner
        .created_members(community_id)
        .or_else(|| inner.scenario.memberships.get(community_id).cloned())
        .unwrap_or_default();
    if let Some(added) = lock(&inner.admin).members.get(community_id) {
        members.extend(added.iter().cloned());
    }
    members
}

pub(crate) fn member_ids(inner: &Inner, community_id: &str) -> Vec<String> {
    members(inner, community_id)
        .into_iter()
        .map(|member| member.user_id)
        .collect()
}

pub(crate) fn is_member(inner: &Inner, community_id: &str, user_id: &str) -> bool {
    members(inner, community_id)
        .iter()
        .any(|member| member.user_id == user_id)
}

/// Whether `user_id` sees the channel: public, or private with them on its list (or no list).
pub(crate) fn sees(
    inner: &Inner,
    channel: &semaphore_wire::types::ChannelDto,
    user_id: &str,
) -> bool {
    if !channel.is_private {
        return true;
    }
    let mut admin = lock(&inner.admin);
    admin.seed(inner);
    admin
        .private_members
        .get(&channel.id)
        .is_none_or(|members| members.iter().any(|member| member.user_id == user_id))
}

/// Who hears about a channel: its community, or a private channel's members.
pub(crate) fn audience(inner: &Inner, channel: &semaphore_wire::types::ChannelDto) -> Vec<String> {
    let everyone = member_ids(inner, &channel.community_id);
    if !channel.is_private {
        return everyone;
    }
    everyone
        .into_iter()
        .filter(|user| sees(inner, channel, user))
        .collect()
}

/// Custom emoji added and removed here, over those in use (`list` is the scenario's).
pub(crate) fn emojis(inner: &Inner, community_id: &str, list: Vec<Value>) -> Vec<Value> {
    let admin = lock(&inner.admin);
    let mut list: Vec<Value> = list
        .into_iter()
        .filter(|emoji| {
            emoji["id"]
                .as_str()
                .is_none_or(|id| !admin.removed_assets.contains(id))
        })
        .collect();
    for emoji in admin.emojis.get(community_id).into_iter().flatten() {
        list.push(serde_json::to_value(emoji).expect("an emoji serializes"));
    }
    list.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    list
}

/// Sounds added and removed here, over the fixture ones.
pub(crate) fn sounds(
    inner: &Inner,
    community_id: &str,
    list: Vec<SoundboardSoundDto>,
) -> Vec<SoundboardSoundDto> {
    let admin = lock(&inner.admin);
    let mut list: Vec<SoundboardSoundDto> = list
        .into_iter()
        .filter(|sound| !admin.removed_assets.contains(&sound.id))
        .chain(
            admin
                .sounds
                .get(community_id)
                .into_iter()
                .flatten()
                .cloned(),
        )
        .collect();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

pub(crate) fn alias_member(inner: &Inner, user_id: &str) -> AliasGroupMemberDto {
    let user = inner.user_entity(user_id);
    AliasGroupMemberDto {
        avatar_url: user.as_ref().and_then(|user| user.avatar_url.clone()),
        display_name: user.as_ref().and_then(|user| user.display_name.clone()),
        id: user_id.to_owned(),
        username: user.map(|user| user.username).unwrap_or_default(),
    }
}

/// A W5-A control (`POST /__control/{name}`), or `None` when the name isn't W5-A's.
///
/// `w5a_state`: what the fake holds now (counts per kind), for tests.
pub(crate) fn control(inner: &Inner, name: &str, _request: &Value) -> Option<Response> {
    match name {
        "w5a_state" => {
            let admin = lock(&inner.admin);
            let counts: BTreeMap<&str, usize> = [
                ("communitiesChanged", admin.communities.len()),
                ("communitiesDeleted", admin.deleted.len()),
                ("aliasGroups", admin.alias_groups.len()),
                ("webhooks", admin.webhooks.len()),
                ("invites", admin.invites.len()),
            ]
            .into_iter()
            .collect();
            Some(
                (
                    axum::http::StatusCode::OK,
                    axum::Json(serde_json::to_value(counts).expect("counts serialize")),
                )
                    .into_response(),
            )
        }
        _ => None,
    }
}

/// A scenario id: already a UUID once loaded, or a readable one to convert.
fn uuid_or(id: &str) -> String {
    if uuid::Uuid::parse_str(id).is_ok() {
        id.to_owned()
    } else {
        entity_uuid(id)
    }
}
