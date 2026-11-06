//! Scenario loading and the mutable state the fake answers from.
//!
//! The files are the ones the web client's Ladle stories use; see
//! `native/docs/slice-units/U3-scenarios.md`. Every field is decoded through
//! `semaphore-wire`'s generated types, so a scenario that drifts from the
//! contract fails to load instead of being served as something else.

use chrono::{DateTime, NaiveDate, Utc};
use semaphore_wire::types::{
    ChannelDto, MembershipResponseDto, MessageDto, UserEntity, VoicePresenceUserDto,
};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::PathBuf;

/// Where a scenario comes from.
#[derive(Clone, Debug)]
pub enum ScenarioSource {
    /// `fixtures/scenarios/<name>.json`, next to this checkout.
    Named(&'static str),
    /// JSON already in memory, in the shape of the web's `Scenario`.
    Json(String),
}

impl ScenarioSource {
    fn load(&self) -> Result<String, ScenarioError> {
        match self {
            ScenarioSource::Named(name) => load_named(name),
            ScenarioSource::Json(json) => Ok(json.clone()),
        }
    }
}

/// Read `fixtures/scenarios/<name>.json` without needing a `'static` name.
pub fn load_named(name: &str) -> Result<String, ScenarioError> {
    let path = fixtures_dir().join(format!("{name}.json"));
    std::fs::read_to_string(&path)
        .map_err(|error| ScenarioError(format!("cannot read {}: {error}", path.display())))
}

/// Why a scenario could not be loaded.
#[derive(Debug)]
pub struct ScenarioError(pub String);

impl fmt::Display for ScenarioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ScenarioError {}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/scenarios")
}

/// The builder's fixed epoch (`frontend/src/stories/fixtures/rng.ts`), used when a
/// scenario has no timestamps at all.
fn builder_epoch() -> DateTime<Utc> {
    NaiveDate::from_ymd_opt(2026, 9, 22)
        .expect("a valid date")
        .and_hms_opt(18, 0, 0)
        .expect("a valid time")
        .and_utc()
}

/// A community as the scenario stores it: the API fields plus the fixture-only
/// `channels`, `memberIds` and `ownerId`.
#[derive(Clone, Debug, Deserialize)]
pub struct Community {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub channels: Vec<ChannelDto>,
}

/// A DM group, decoded only far enough to know its id.
#[derive(Clone, Debug, Deserialize)]
pub struct DmGroup {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
struct RawUnread {
    #[serde(rename = "unreadCount")]
    unread_count: i64,
    #[serde(rename = "mentionCount")]
    mention_count: i64,
}

#[derive(Debug, Deserialize)]
struct RawScenario {
    me: UserEntity,
    #[serde(default)]
    users: Vec<UserEntity>,
    #[serde(default)]
    communities: Vec<Community>,
    #[serde(rename = "messagesByChannel", default)]
    messages_by_channel: BTreeMap<String, Vec<MessageDto>>,
    #[serde(rename = "messagesByDmGroup", default)]
    messages_by_dm_group: BTreeMap<String, Vec<MessageDto>>,
    #[serde(rename = "threadRepliesByParent", default)]
    thread_replies_by_parent: BTreeMap<String, Vec<MessageDto>>,
    #[serde(rename = "voicePresenceByChannel", default)]
    voice_presence_by_channel: BTreeMap<String, Vec<VoicePresenceUserDto>>,
    #[serde(rename = "membershipsByCommunity", default)]
    memberships_by_community: BTreeMap<String, Vec<MembershipResponseDto>>,
    #[serde(rename = "unreadByContextId", default)]
    unread_by_context_id: BTreeMap<String, RawUnread>,
    #[serde(rename = "dmGroups", default)]
    dm_groups: Vec<DmGroup>,
    #[serde(default)]
    notifications: Vec<RawNotification>,
}

#[derive(Clone, Debug, Deserialize)]
struct RawNotification {
    #[serde(default)]
    read: bool,
}

/// The immutable part of a loaded scenario.
#[derive(Debug)]
pub struct Scenario {
    pub me: UserEntity,
    pub users: Vec<UserEntity>,
    pub communities: Vec<Community>,
    pub memberships: BTreeMap<String, Vec<MembershipResponseDto>>,
    pub channel_messages: BTreeMap<String, Vec<MessageDto>>,
    pub dm_messages: BTreeMap<String, Vec<MessageDto>>,
    pub threads: BTreeMap<String, Vec<MessageDto>>,
    pub voice: BTreeMap<String, Vec<VoicePresenceUserDto>>,
    pub unread: BTreeMap<String, (i64, i64)>,
    pub dm_ids: BTreeSet<String>,
    pub unread_notifications: i64,
    pub epoch: DateTime<Utc>,
}

impl Scenario {
    pub fn load(source: &ScenarioSource) -> Result<Self, ScenarioError> {
        let json = source.load()?;
        let raw: RawScenario = serde_json::from_str(&json).map_err(|error| {
            ScenarioError(format!("scenario does not match the contract: {error}"))
        })?;

        let mut channel_messages = raw.messages_by_channel;
        let mut dm_messages = raw.messages_by_dm_group;
        let mut threads = raw.thread_replies_by_parent;
        for messages in channel_messages
            .values_mut()
            .chain(dm_messages.values_mut())
            .chain(threads.values_mut())
        {
            sort_messages(messages);
        }

        let mut epoch = builder_epoch();
        for message in channel_messages
            .values()
            .chain(dm_messages.values())
            .chain(threads.values())
            .flatten()
        {
            epoch = epoch.max(message.sent_at);
        }
        // New messages must land after everything the scenario already has.
        epoch += chrono::Duration::seconds(1);

        let unread = raw
            .unread_by_context_id
            .into_iter()
            .map(|(id, value)| (id, (value.unread_count, value.mention_count)))
            .collect();

        Ok(Self {
            me: raw.me,
            users: raw.users,
            communities: raw.communities,
            memberships: raw.memberships_by_community,
            channel_messages,
            dm_messages,
            threads,
            voice: raw.voice_presence_by_channel,
            unread,
            dm_ids: raw.dm_groups.into_iter().map(|group| group.id).collect(),
            unread_notifications: raw
                .notifications
                .iter()
                .filter(|notification| !notification.read)
                .count() as i64,
            epoch,
        })
    }

    pub fn channel(&self, channel_id: &str) -> Option<&ChannelDto> {
        self.communities
            .iter()
            .flat_map(|community| community.channels.iter())
            .find(|channel| channel.id == channel_id)
    }

    pub fn community(&self, community_id: &str) -> Option<&Community> {
        self.communities
            .iter()
            .find(|community| community.id == community_id)
    }

    /// Every user the scenario knows, `me` first.
    pub fn user(&self, id: &str) -> Option<&UserEntity> {
        if self.me.id == id {
            return Some(&self.me);
        }
        self.users.iter().find(|user| user.id == id)
    }
}

fn sort_messages(messages: &mut [MessageDto]) {
    messages.sort_by(|a, b| (a.sent_at, a.id.as_str()).cmp(&(b.sent_at, b.id.as_str())));
}

/// The scenario's messages, in the server's order: oldest first, `sentAt` then id,
/// so equal timestamps still have one total order.
pub fn sorted(messages: &mut [MessageDto]) {
    sort_messages(messages);
}
