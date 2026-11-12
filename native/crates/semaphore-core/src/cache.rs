//! Query cache: the TanStack Query analog. It lives here rather than on GPUI entities so a future
//! mobile UI reads the same state; a UI only holds a projection of it.
//!
//! Entries are typed wire responses, so a direct update changes a field instead of reparsing JSON.
//! Message rows don't live here at all, but in [`crate::store`]. A UI never reads this type: it
//! reads the view models in [`crate::model`] through `Core`.

use semaphore_wire::types as wire;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// Hierarchical key, like a TanStack Query key. The first segment is the web client's query `_id`,
/// the camelCase `operationId`, so the rules in [`crate::events`] read like its handlers: a key
/// for one operation is its prefix, the way `[{ _id }]` matches on the web.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct QueryKey {
    pub segments: Vec<String>,
}

impl QueryKey {
    pub fn new(segments: &[&str]) -> Self {
        Self {
            segments: segments.iter().map(|s| (*s).to_owned()).collect(),
        }
    }

    pub fn starts_with(&self, prefix: &QueryKey) -> bool {
        self.segments.starts_with(&prefix.segments)
    }

    /// The operation this key caches: its first segment.
    pub fn op(&self) -> &str {
        self.segments.first().map_or("", String::as_str)
    }
}

/// The query `_id`s core caches, and their keys.
pub mod keys {
    use super::QueryKey;

    pub const PROFILE: &str = "userControllerGetProfile";
    pub const USER: &str = "userControllerGetUserById";
    pub const COMMUNITIES: &str = "communityControllerFindAllMine";
    pub const CHANNELS: &str = "channelsControllerFindAllForCommunity";
    pub const CAPABILITIES: &str = "channelPermissionsControllerGetMyCommunityChannelPermissions";
    pub const UNREAD: &str = "readReceiptsControllerGetUnreadCounts";
    /// Who has read a DM up to when, other than this user, keyed by DM group ("seen by").
    pub const DM_PEER_READS: &str = "readReceiptsControllerGetDmPeerReads";
    /// Who has read one message, keyed by message and its channel or DM ("seen by" in a channel).
    pub const MESSAGE_READERS: &str = "readReceiptsControllerGetMessageReaders";
    pub const VOICE_PRESENCE: &str = "voicePresenceControllerGetChannelPresence";
    pub const MEMBER_SEARCH: &str = "membershipControllerSearchCommunityMembers";
    pub const MENTIONABLE: &str = "channelsControllerGetMentionableChannels";
    pub const EMOJIS: &str = "customEmojiControllerListCommunityEmojis";
    pub const MEMBERS: &str = "membershipControllerFindAllForCommunity";
    pub const PRESENCE: &str = "presenceControllerGetBulkPresence";
    pub const NOTIFICATION_COUNT: &str = "notificationsControllerGetUnreadCount";
    pub const CHANNEL_MESSAGES: &str = "messagesControllerFindAllForChannel";
    pub const DM_MESSAGES: &str = "messagesControllerFindAllForGroup";
    pub const THREAD_REPLIES: &str = "threadsControllerGetReplies";
    pub const PINS: &str = "moderationControllerGetPinnedMessages";
    pub const THREAD_META: &str = "threadsControllerGetMetadata";
    pub const CHANNEL_ROLES: &str = "rolesControllerGetMyRolesForChannel";
    /// Message search, one key per scope, id and query (`commands::reading`): the three routes
    /// are separate operations and are cached apart.
    pub const SEARCH_CHANNEL: &str = "messagesControllerSearchChannelMessages";
    pub const SEARCH_DM: &str = "messagesControllerSearchDirectMessages";
    pub const SEARCH_COMMUNITY: &str = "messagesControllerSearchCommunityMessages";
    // W2.
    pub const DMS: &str = "directMessagesControllerFindUserDmGroups";
    /// Friends and pending requests, read together: `friendsControllerGetFriends` and
    /// `friendsControllerGetPendingRequests`.
    pub const FRIENDS: &str = "friendsControllerGetFriends";
    pub const NOTIFICATIONS: &str = "notificationsControllerGetNotifications";
    pub const NOTIFY_SETTINGS: &str = "notificationsControllerGetSettings";
    pub const CHANNEL_LEVEL: &str = "notificationsControllerGetChannelOverride";
    // W3
    pub const SESSIONS: &str = "authControllerGetSessions";
    pub const APPEARANCE: &str = "appearanceSettingsControllerGetSettings";
    pub const INSTANCE_ROLES: &str = "rolesControllerGetMyInstanceRoles";
    // W4
    pub const DM_VOICE_PRESENCE: &str = "dmVoicePresenceControllerGetDmPresence";
    pub const SOUNDBOARD: &str = "soundboardControllerListCommunitySounds";
    pub const CLIPS: &str = "livekitControllerGetMyClips";
    pub const USER_CLIPS: &str = "livekitControllerGetUserPublicClips";
    pub const REPLAY_SESSION: &str = "livekitControllerGetSessionInfo";

    pub fn scoped(op: &str, id: &str) -> QueryKey {
        QueryKey::new(&[op, id])
    }

    pub fn op(op: &str) -> QueryKey {
        QueryKey::new(&[op])
    }
}

/// A cached response.
#[derive(Debug, Clone)]
pub enum CacheValue {
    Profile(wire::UserEntity),
    User(wire::UserEntity),
    Communities(Vec<wire::CommunityResponseDto>),
    Channels(Vec<wire::ChannelDto>),
    Capabilities(wire::CommunityChannelCapabilitiesDto),
    UnreadCounts(Vec<wire::UnreadCountDto>),
    /// Watermarks of the other members of one DM, keyed by DM group.
    DmPeerReads(Vec<wire::DmPeerReadDto>),
    /// The readers of one message, keyed by the message and its conversation.
    MessageReaders(Vec<wire::MessageReaderDto>),
    VoicePresence(wire::ChannelVoicePresenceResponseDto),
    MemberSearch(Vec<wire::MembershipResponseDto>),
    MentionableChannels(Vec<wire::ChannelDto>),
    Emojis(Vec<wire::CustomEmojiDto>),
    Members(MemberPages),
    Presence(HashMap<String, bool>),
    NotificationCount(i64),
    /// A channel's pins, keyed by channel.
    Pins(Vec<wire::PinnedMessageDto>),
    /// Keyed by parent message.
    ThreadMeta(wire::ThreadMetadataDto),
    /// This user's roles in a channel, keyed by channel: their actions decide pin and remove.
    ChannelRoles(wire::UserRolesResponseDto),
    /// A search's loaded pages, newest first, and the cursor for the next.
    Search(SearchPages),
    /// W2: this user's DMs and groups, newest activity first.
    DmGroups(Vec<wire::DmGroupResponseDto>),
    Friends(FriendsData),
    Notifications(NotificationPages),
    NotifySettings(wire::UserNotificationSettingsDto),
    /// A channel's own level, keyed by channel. `None`: it has none.
    ChannelLevel(Option<wire::ChannelNotificationOverrideDto>),
    /// W3: this account's sessions.
    Sessions(Vec<wire::SessionInfoDto>),
    /// W3: the theme the server keeps.
    Appearance(wire::AppearanceSettingsResponseDto),
    /// W3: this user's instance roles.
    InstanceRoles(wire::UserRolesResponseDto),
    /// W4: who's in a DM's call, keyed by DM group.
    DmVoicePresence(wire::DmVoicePresenceResponseDto),
    /// W4: a community's soundboard, keyed by community.
    Soundboard(Vec<wire::SoundboardSoundDto>),
    /// W4: my clips, or (keyed by user) another user's public ones.
    Clips(Vec<wire::ClipResponseDto>),
    /// W4: my replay buffer.
    ReplaySession(wire::SessionInfoResponseDto),
    /// W5-A's queries (`commands::community_admin::W5aValue`): its own variants, so the lane adds
    /// none here.
    W5a(crate::commands::community_admin::W5aValue),
    /// W5-B's queries (`commands::moderation::W5bValue`).
    W5b(crate::commands::moderation::W5bValue),
    /// W6's queries (`commands::instance_admin::W6Value`, one variant per lane).
    W6(crate::commands::instance_admin::W6Value),
    /// W7-A's queries (`commands::gifs::GifsValue`).
    W7(crate::commands::gifs::GifsValue),
}

/// Friends and pending requests, from two calls read as one.
#[derive(Debug, Clone)]
pub struct FriendsData {
    pub friends: Vec<wire::FriendListItemDto>,
    pub requests: wire::PendingRequestsDto,
}

/// As many pages of notifications as were read, as the server sent them (dismissed rows too).
#[derive(Debug, Clone)]
pub struct NotificationPages {
    pub rows: Vec<wire::NotificationDto>,
    /// The last page read was full, so more may follow. The server's `total` is the size of the
    /// page it sent, not of the list, so it can't say.
    pub has_more: bool,
}

/// A search's loaded pages, newest first, and the cursor for the page after them. The key names
/// the scope, the id searched and the query, so a search is its own entry.
#[derive(Debug, Clone)]
pub struct SearchPages {
    pub hits: Vec<crate::model::SearchHit>,
    pub next: Option<String>,
}

/// As many pages of a community's members as core reads.
#[derive(Debug, Clone)]
pub struct MemberPages {
    pub members: Vec<wire::MembershipResponseDto>,
    /// The server had more when core stopped reading.
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct CacheEntry {
    pub value: CacheValue,
    pub fetched_at_ms: u64,
    pub stale: bool,
    /// When it was last set or read through [`QueryCache::touch`], in the cache's own ticks.
    used: u64,
}

#[derive(Debug, Default)]
pub struct QueryCache {
    entries: BTreeMap<QueryKey, CacheEntry>,
    /// A counter, not a clock: recency only needs an order, and two reads in one millisecond
    /// still have one.
    tick: u64,
}

/// One typed read, for one variant.
macro_rules! typed_read {
    ($name:ident, $name_mut:ident, $variant:ident, $ty:ty) => {
        pub fn $name(&self, key: &QueryKey) -> Option<&$ty> {
            match self.entries.get(key).map(|entry| &entry.value) {
                Some(CacheValue::$variant(value)) => Some(value),
                _ => None,
            }
        }

        pub fn $name_mut(&mut self, key: &QueryKey) -> Option<&mut $ty> {
            match self.entries.get_mut(key).map(|entry| &mut entry.value) {
                Some(CacheValue::$variant(value)) => Some(value),
                _ => None,
            }
        }
    };
}

impl QueryCache {
    typed_read!(pins, pins_mut, Pins, Vec<wire::PinnedMessageDto>);
    typed_read!(search, search_mut, Search, SearchPages);
    typed_read!(
        thread_meta,
        thread_meta_mut,
        ThreadMeta,
        wire::ThreadMetadataDto
    );
    typed_read!(
        channel_roles,
        channel_roles_mut,
        ChannelRoles,
        wire::UserRolesResponseDto
    );
    typed_read!(user, user_mut, User, wire::UserEntity);
    typed_read!(
        dm_groups,
        dm_groups_mut,
        DmGroups,
        Vec<wire::DmGroupResponseDto>
    );
    typed_read!(friends, friends_mut, Friends, FriendsData);
    typed_read!(
        notifications,
        notifications_mut,
        Notifications,
        NotificationPages
    );
    typed_read!(
        notify_settings,
        notify_settings_mut,
        NotifySettings,
        wire::UserNotificationSettingsDto
    );
    typed_read!(
        channel_level,
        channel_level_mut,
        ChannelLevel,
        Option<wire::ChannelNotificationOverrideDto>
    );
    typed_read!(profile, profile_mut, Profile, wire::UserEntity);
    typed_read!(
        instance_roles,
        instance_roles_mut,
        InstanceRoles,
        wire::UserRolesResponseDto
    );
    typed_read!(sessions, sessions_mut, Sessions, Vec<wire::SessionInfoDto>);
    typed_read!(
        dm_voice_presence,
        dm_voice_presence_mut,
        DmVoicePresence,
        wire::DmVoicePresenceResponseDto
    );
    typed_read!(
        soundboard,
        soundboard_mut,
        Soundboard,
        Vec<wire::SoundboardSoundDto>
    );
    typed_read!(clips, clips_mut, Clips, Vec<wire::ClipResponseDto>);
    typed_read!(
        replay_session,
        replay_session_mut,
        ReplaySession,
        wire::SessionInfoResponseDto
    );
    typed_read!(
        appearance,
        appearance_mut,
        Appearance,
        wire::AppearanceSettingsResponseDto
    );
    typed_read!(
        communities,
        communities_mut,
        Communities,
        Vec<wire::CommunityResponseDto>
    );
    typed_read!(channels, channels_mut, Channels, Vec<wire::ChannelDto>);
    typed_read!(
        unread_counts,
        unread_counts_mut,
        UnreadCounts,
        Vec<wire::UnreadCountDto>
    );
    typed_read!(
        dm_peer_reads,
        dm_peer_reads_mut,
        DmPeerReads,
        Vec<wire::DmPeerReadDto>
    );
    typed_read!(
        message_readers,
        message_readers_mut,
        MessageReaders,
        Vec<wire::MessageReaderDto>
    );
    typed_read!(
        voice_presence,
        voice_presence_mut,
        VoicePresence,
        wire::ChannelVoicePresenceResponseDto
    );
    typed_read!(
        member_search,
        member_search_mut,
        MemberSearch,
        Vec<wire::MembershipResponseDto>
    );
    typed_read!(
        capabilities,
        capabilities_mut,
        Capabilities,
        wire::CommunityChannelCapabilitiesDto
    );
    typed_read!(emojis, emojis_mut, Emojis, Vec<wire::CustomEmojiDto>);
    typed_read!(members, members_mut, Members, MemberPages);
    typed_read!(presence, presence_mut, Presence, HashMap<String, bool>);
    typed_read!(
        notification_count,
        notification_count_mut,
        NotificationCount,
        i64
    );
    typed_read!(
        mentionable_channels,
        mentionable_channels_mut,
        MentionableChannels,
        Vec<wire::ChannelDto>
    );

    pub fn set(&mut self, key: QueryKey, value: CacheValue, fetched_at_ms: u64) {
        self.tick += 1;
        let entry = CacheEntry {
            value,
            fetched_at_ms,
            stale: false,
            used: self.tick,
        };
        self.entries.insert(key, entry);
    }

    /// Notes a read of `key`, for [`evict_least_used`](Self::evict_least_used).
    pub fn touch(&mut self, key: &QueryKey) {
        self.tick += 1;
        if let Some(entry) = self.entries.get_mut(key) {
            entry.used = self.tick;
        }
    }

    /// Keeps the `keep` entries of `op` used most recently and drops the rest. Returns the dropped
    /// keys. For keys made per keystroke, which would otherwise pile up for the whole session.
    pub fn evict_least_used(&mut self, op: &str, keep: usize) -> Vec<QueryKey> {
        let mut of_op: Vec<(u64, QueryKey)> = self
            .entries
            .iter()
            .filter(|(key, _)| key.op() == op)
            .map(|(key, entry)| (entry.used, key.clone()))
            .collect();
        if of_op.len() <= keep {
            return Vec::new();
        }
        of_op.sort_unstable_by_key(|(used, _)| std::cmp::Reverse(*used));
        let dropped: Vec<QueryKey> = of_op
            .split_off(keep)
            .into_iter()
            .map(|(_, key)| key)
            .collect();
        for key in &dropped {
            self.entries.remove(key);
        }
        dropped
    }

    pub fn get(&self, key: &QueryKey) -> Option<&CacheEntry> {
        self.entries.get(key)
    }

    /// W5: a direct update to an entry whose variant the lanes own (`CacheValue::W5a`/`W5b`).
    pub fn get_mut(&mut self, key: &QueryKey) -> Option<&mut CacheEntry> {
        self.entries.get_mut(key)
    }

    /// Marks matching entries stale, keeping their data so a UI can show it while a
    /// refetch runs. Returns the keys it marked.
    pub fn invalidate_prefix(&mut self, prefix: &QueryKey) -> Vec<QueryKey> {
        let mut marked = Vec::new();
        for (key, entry) in &mut self.entries {
            if key.starts_with(prefix) {
                entry.stale = true;
                marked.push(key.clone());
            }
        }
        marked
    }

    pub fn invalidate_all(&mut self) -> Vec<QueryKey> {
        self.invalidate_prefix(&QueryKey { segments: vec![] })
    }

    /// Drops matching entries.
    pub fn remove_prefix(&mut self, prefix: &QueryKey) {
        self.entries.retain(|key, _| !key.starts_with(prefix));
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn stale_keys(&self) -> Vec<QueryKey> {
        self.entries
            .iter()
            .filter(|(_, entry)| entry.stale)
            .map(|(key, _)| key.clone())
            .collect()
    }

    pub fn keys_with_op(&self, op: &str) -> Vec<QueryKey> {
        self.entries
            .keys()
            .filter(|key| key.op() == op)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unread(count: i64) -> CacheValue {
        CacheValue::UnreadCounts(vec![wire::UnreadCountDto {
            channel_id: Some("a".into()),
            direct_message_group_id: None,
            last_read_at: None,
            last_read_message_id: None,
            mention_count: 0,
            unread_count: count,
        }])
    }

    #[test]
    fn invalidating_a_prefix_keeps_data_and_leaves_other_keys_fresh() {
        let mut cache = QueryCache::default();
        let messages = QueryKey::new(&["channels", "a", "messages"]);
        let other = QueryKey::new(&["channels", "b", "messages"]);
        cache.set(messages.clone(), unread(1), 10);
        cache.set(other.clone(), unread(2), 10);

        let marked = cache.invalidate_prefix(&QueryKey::new(&["channels", "a"]));

        assert_eq!(marked, vec![messages.clone()]);
        assert!(cache.get(&messages).unwrap().stale);
        assert_eq!(cache.unread_counts(&messages).unwrap()[0].unread_count, 1);
        assert!(!cache.get(&other).unwrap().stale);
    }

    #[test]
    fn a_prefix_matches_whole_segments_only() {
        let key = QueryKey::new(&["channels", "ab"]);
        assert!(!key.starts_with(&QueryKey::new(&["channels", "a"])));
        assert!(key.starts_with(&QueryKey::new(&["channels"])));
    }

    #[test]
    fn a_fresh_set_clears_stale() {
        let mut cache = QueryCache::default();
        let key = QueryKey::new(&["me"]);
        cache.set(key.clone(), unread(1), 1);
        assert_eq!(cache.invalidate_all(), vec![key.clone()]);
        cache.set(key.clone(), unread(2), 2);
        assert!(cache.stale_keys().is_empty());
    }

    #[test]
    fn eviction_keeps_the_most_recently_used_of_one_op_only() {
        let mut cache = QueryCache::default();
        let search = |needle: &str| QueryKey::new(&["search", "c", needle]);
        for needle in ["a", "b", "c", "d"] {
            cache.set(search(needle), unread(1), 1);
        }
        cache.set(QueryKey::new(&["other"]), unread(1), 1);
        cache.touch(&search("a"));

        let mut dropped = cache.evict_least_used("search", 2);
        dropped.sort();

        assert_eq!(dropped, vec![search("b"), search("c")]);
        assert!(cache.get(&search("a")).is_some(), "used lately");
        assert!(cache.get(&search("d")).is_some(), "set last");
        assert!(
            cache.get(&QueryKey::new(&["other"])).is_some(),
            "another op"
        );
        assert!(cache.evict_least_used("search", 2).is_empty());
        // A touch of a key not cached does nothing.
        cache.touch(&search("zzz"));
        assert!(cache.get(&search("zzz")).is_none());
    }

    #[test]
    fn invalidating_nothing_marks_nothing_and_clear_forgets_everything() {
        let mut cache = QueryCache::default();
        cache.set(QueryKey::new(&["a", "1"]), unread(1), 1);
        assert!(cache.invalidate_prefix(&QueryKey::new(&["b"])).is_empty());
        assert!(
            cache
                .invalidate_prefix(&QueryKey::new(&["a", "1", "deeper"]))
                .is_empty()
        );
        cache.remove_prefix(&QueryKey::new(&["a"]));
        assert!(cache.get(&QueryKey::new(&["a", "1"])).is_none());
        cache.set(QueryKey::new(&["a", "1"]), unread(1), 1);
        cache.clear();
        assert!(cache.keys_with_op("a").is_empty());
        assert_eq!(QueryKey::new(&[]).op(), "");
    }

    #[test]
    fn a_direct_update_changes_the_typed_value_in_place() {
        let mut cache = QueryCache::default();
        let key = keys::op(keys::UNREAD);
        cache.set(key.clone(), unread(1), 1);
        cache.unread_counts_mut(&key).unwrap()[0].unread_count += 1;
        assert_eq!(cache.unread_counts(&key).unwrap()[0].unread_count, 2);
        // Asking for the wrong type of a key finds nothing rather than panicking.
        assert!(cache.channels(&key).is_none());
    }
}
