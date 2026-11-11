//! Scenario loading and the mutable state the fake answers from.
//!
//! The files are the ones the web client's Ladle stories use; see
//! `native/docs/slice-units/U3-scenarios.md`. Every field is decoded through
//! `semaphore-wire`'s generated types, so a scenario that drifts from the
//! contract fails to load instead of being served as something else.

use chrono::{DateTime, NaiveDate, Utc};
use semaphore_wire::types::{
    ChannelDto, ChannelNotificationOverrideDto, DmGroupResponseDto, FriendshipWithUsersDto,
    MembershipResponseDto, MessageDto, NotificationDto, UserEntity, UserNotificationSettingsDto,
    VoicePresenceUserDto,
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

/// The scenarios (by their `seed`) whose message, user and community ids are served as UUIDs. The
/// real backend only issues UUIDs, and the contract types some of them as one (a reaction's
/// message id, a mention's user id), so the scenario the app is driven against end to end gets
/// them; the others keep the readable ids their tests name. By seed, not file name: the binary
/// hands its scenario over as JSON.
const UUID_MESSAGE_IDS: &[&str] = &["showcase"];

/// The UUID a readable message id (`sc-cc-pit-caption`) is served as: the same on every run and
/// every machine, so a script or test can name it (`message_uuid("sc-cc-pit-caption")`).
pub fn message_uuid(readable: &str) -> String {
    const NAMESPACE: uuid::Uuid = uuid::Uuid::from_u128(0x5e3a_9b0e_0000_4000_8000_6d65_7373_6167);
    uuid::Uuid::new_v5(&NAMESPACE, readable.as_bytes()).to_string()
}

/// The UUID a readable user, community or custom emoji id (`u-priya`, `c-couch`, `me`) is served
/// as, in a scenario whose message ids are UUIDs: the contract types those ids as UUIDs in a
/// message's spans, as the real backend issues them. The same on every run, so a script can name
/// one (`$ID(u-priya)` in the slice rig).
pub fn entity_uuid(readable: &str) -> String {
    const NAMESPACE: uuid::Uuid = uuid::Uuid::from_u128(0x5e3a_9b0e_0000_4000_8000_656e_7469_7479);
    uuid::Uuid::new_v5(&NAMESPACE, readable.as_bytes()).to_string()
}

/// Fields that hold words, never an id: a span's `text` can be "me".
const FREE_TEXT: &[&str] = &[
    "text",
    "content",
    "name",
    "displayName",
    "username",
    "bio",
    "title",
    "description",
];

/// Every user and community id in the scenario's JSON, as a value or as a map's key, through
/// `entity_uuid`. A walk over the JSON rather than over the decoded types, because user ids sit in
/// a dozen places (authors, members, owners, mentions, reactions, voice presence, DMs).
fn uuid_entity_ids(root: &mut serde_json::Value) {
    use serde_json::Value;
    let mut ids = BTreeSet::new();
    if let Some(id) = root["me"]["id"].as_str() {
        ids.insert(id.to_owned());
    }
    // Communities and users, then the rows of the W2 areas (DMs, friendships, notifications,
    // their settings and overrides) and the members of each DM: every one an id the backend
    // issues as a UUID. DM groups and friendships are named in paths, which the backend types as
    // UUIDs. Channel ids stay readable (the slice scripts and tests name them).
    for list in [
        "users",
        "communities",
        "dmGroups",
        "friendships",
        "notifications",
        "channelOverrides",
    ] {
        for entry in root[list].as_array().into_iter().flatten() {
            if let Some(id) = entry["id"].as_str() {
                ids.insert(id.to_owned());
            }
        }
    }
    for group in root["dmGroups"].as_array().into_iter().flatten() {
        for member in group["members"].as_array().into_iter().flatten() {
            if let Some(id) = member["id"].as_str() {
                ids.insert(id.to_owned());
            }
        }
    }
    if let Some(id) = root["notificationSettings"]["id"].as_str() {
        ids.insert(id.to_owned());
    }
    /// `keyed`: the object is a map by id (`membershipsByCommunity`), not a record with fields.
    fn walk(value: &mut Value, ids: &BTreeSet<String>, keyed: bool) {
        match value {
            Value::String(text) if ids.contains(text.as_str()) => *text = entity_uuid(text),
            Value::Array(items) => items.iter_mut().for_each(|item| walk(item, ids, false)),
            Value::Object(fields) => {
                let entries = std::mem::take(fields);
                for (key, mut field) in entries {
                    if !(FREE_TEXT.contains(&key.as_str()) && field.is_string()) {
                        walk(&mut field, ids, key.contains("By"));
                    }
                    let key = if keyed && ids.contains(&key) {
                        entity_uuid(&key)
                    } else {
                        key
                    };
                    fields.insert(key, field);
                }
            }
            _ => {}
        }
    }
    walk(root, &ids, false);
}

/// Every message id, and every reference to one, through `message_uuid`.
fn uuid_message_ids(
    channel_messages: &mut BTreeMap<String, Vec<MessageDto>>,
    dm_messages: &mut BTreeMap<String, Vec<MessageDto>>,
    threads: &mut BTreeMap<String, Vec<MessageDto>>,
) {
    let map = |id: &mut String| *id = message_uuid(id);
    *threads = std::mem::take(threads)
        .into_iter()
        .map(|(parent, replies)| (message_uuid(&parent), replies))
        .collect();
    for message in channel_messages
        .values_mut()
        .chain(dm_messages.values_mut())
        .chain(threads.values_mut())
        .flatten()
    {
        map(&mut message.id);
        message.parent_message_id.as_mut().map(map);
        message.reply_to_id.as_mut().map(map);
        if let Some(reply_to) = message.reply_to.as_mut() {
            map(&mut reply_to.id);
        }
    }
}

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
    dm_groups: Vec<DmGroupResponseDto>,
    #[serde(default)]
    friendships: Vec<FriendshipWithUsersDto>,
    #[serde(default)]
    notifications: Vec<NotificationDto>,
    /// The signed-in user's settings, when the scenario sets them; otherwise the defaults.
    #[serde(rename = "notificationSettings", default)]
    notification_settings: Option<UserNotificationSettingsDto>,
    #[serde(rename = "channelOverrides", default)]
    channel_overrides: Vec<ChannelNotificationOverrideDto>,
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
    /// The scenario's DMs, as the backend would list them for their members.
    pub dm_groups: Vec<DmGroupResponseDto>,
    pub friendships: Vec<FriendshipWithUsersDto>,
    pub notifications: Vec<NotificationDto>,
    pub notification_settings: Option<UserNotificationSettingsDto>,
    pub channel_overrides: Vec<ChannelNotificationOverrideDto>,
    pub unread_notifications: i64,
    pub epoch: DateTime<Utc>,
    /// Its message ids are UUIDs (`message_uuid`), and new messages get UUIDs too.
    pub uuid_message_ids: bool,
}

impl Scenario {
    pub fn load(source: &ScenarioSource) -> Result<Self, ScenarioError> {
        let json = source.load()?;
        let mut value: serde_json::Value = serde_json::from_str(&json)
            .map_err(|error| ScenarioError(format!("scenario is not JSON: {error}")))?;
        let uuid_ids = value["seed"]
            .as_str()
            .is_some_and(|seed| UUID_MESSAGE_IDS.contains(&seed));
        if uuid_ids {
            uuid_entity_ids(&mut value);
        }
        let raw: RawScenario = serde_json::from_value(value).map_err(|error| {
            ScenarioError(format!("scenario does not match the contract: {error}"))
        })?;

        let mut channel_messages = raw.messages_by_channel;
        let mut dm_messages = raw.messages_by_dm_group;
        let mut threads = raw.thread_replies_by_parent;
        if uuid_ids {
            uuid_message_ids(&mut channel_messages, &mut dm_messages, &mut threads);
        }
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

        let mut dm_groups = raw.dm_groups;
        let mut notifications = raw.notifications;
        if uuid_ids {
            // Message ids are `message_uuid` of the readable one, wherever a DM or a
            // notification names a message.
            let map = |id: &mut String| *id = message_uuid(id);
            for last in dm_groups
                .iter_mut()
                .filter_map(|group| group.last_message.as_mut())
            {
                map(&mut last.id);
            }
            for notification in &mut notifications {
                notification.message_id.as_mut().map(map);
                notification.parent_message_id.as_mut().map(map);
                if let Some(message) = notification.message.as_mut() {
                    map(&mut message.id);
                }
            }
        }

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
            dm_ids: dm_groups.iter().map(|group| group.id.clone()).collect(),
            unread_notifications: notifications
                .iter()
                .filter(|notification| !notification.read)
                .count() as i64,
            dm_groups,
            friendships: raw.friendships,
            notifications,
            notification_settings: raw.notification_settings,
            channel_overrides: raw.channel_overrides,
            epoch,
            uuid_message_ids: uuid_ids,
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
