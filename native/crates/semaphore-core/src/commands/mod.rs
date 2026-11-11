//! What a UI can ask core to do and read back. The signatures are frozen by U0.
//!
//! Commands return once core has accepted them. Their results arrive as `CoreEvent`s. A load the UI
//! is waiting on returns its failure, because no event says so. Reads return what's cached at once,
//! and fetch what's missing or stale, as `useQuery` does: `CoreEvent::ViewChanged` says when to read
//! again.

pub mod account;
pub(crate) mod actions;
pub mod browser_sign_in;
pub mod calls;
mod communities;
pub(crate) mod community_admin;
mod community_assets;
mod diagnostics;
mod dms;
mod messages;
pub(crate) mod moderation;
pub(crate) mod notify;
pub mod onboarding;
mod permissions;
mod profile;
mod queries;
pub(crate) mod reading;
mod replay;
mod roles;
/// W5-B: the channel preset port (`shared/src/permissions/channel-presets.ts`).
pub use roles::presets;
mod session;
pub mod social;
mod soundboard;
mod voice;

use crate::cache::{CacheValue, MemberPages, QueryKey, keys};
use crate::client::{Effect, State, user_view};
use crate::model::{Conversation, ErrorView, SessionState, UserView, ViewKey, VoiceView};
use crate::platform::CoreError;
use semaphore_wire::types as wire;

/// How many members a mention search asks for.
const MENTION_SEARCH_LIMIT: i64 = 10;
/// Special mentions, from the web's `useMentionAutocomplete`.
const SPECIAL_MENTIONS: [&str; 2] = ["here", "channel"];
const REAUTHENTICATE_TIMEOUT_MS: u64 = 10_000;
/// A page of members, and the most rows read. `MemberList::truncated` says when that wasn't all.
const MEMBER_PAGE_SIZE: i64 = 100;
const MAX_MEMBERS: usize = 1000;
/// How many messages to ask for around an anchor: half on each side.
const AROUND_LIMIT: i64 = 50;

/// The `exp` claim of a JWT, in Unix milliseconds. Core doesn't verify it, only schedules by it.
fn jwt_expiry_ms(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    let mut bytes = Vec::with_capacity(payload.len() * 3 / 4);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for byte in payload.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => continue,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("exp")?.as_u64()?.checked_mul(1000)
}

/// The view that shows a query's data, for the queries a UI shows a loading or failed state for.
fn view_for(key: &QueryKey) -> Option<ViewKey> {
    let id = || key.segments.get(1).cloned().unwrap_or_default();
    match key.op() {
        keys::COMMUNITIES => Some(ViewKey::Communities),
        keys::CHANNELS => Some(ViewKey::Channels { community_id: id() }),
        keys::MEMBERS => Some(ViewKey::Members { community_id: id() }),
        keys::PINS => Some(ViewKey::Pins { channel_id: id() }),
        keys::CHANNEL_ROLES => Some(ViewKey::ChannelModeration { channel_id: id() }),
        // W1 part B: so a missing thread fails once, not on every read.
        keys::THREAD_META => Some(ViewKey::Thread {
            parent_message_id: id(),
        }),
        keys::DMS => Some(ViewKey::DirectMessages),
        keys::FRIENDS => Some(ViewKey::Friends),
        keys::NOTIFICATIONS => Some(ViewKey::Notifications),
        keys::NOTIFY_SETTINGS => Some(ViewKey::NotificationSettings),
        keys::CHANNEL_LEVEL => Some(ViewKey::ChannelNotifyLevel { channel_id: id() }),
        keys::SESSIONS => Some(ViewKey::Sessions),
        keys::APPEARANCE => Some(ViewKey::Appearance),
        keys::INSTANCE_ROLES => Some(ViewKey::InstancePermissions),
        keys::SOUNDBOARD => Some(ViewKey::Soundboard { community_id: id() }),
        keys::CLIPS => Some(ViewKey::Clips),
        keys::USER_CLIPS => Some(ViewKey::UserClips { user_id: id() }),
        keys::REPLAY_SESSION => Some(ViewKey::ReplaySession),
        keys::USER => Some(ViewKey::Profile { user_id: id() }),
        // W5: each lane maps its own queries.
        _ => community_admin::view_for(key).or_else(|| moderation::view_for(key)),
    }
}

/// The query behind a view's list, the reverse of [`view_for`].
fn key_for(view: &ViewKey) -> Option<QueryKey> {
    match view {
        ViewKey::Communities => Some(keys::op(keys::COMMUNITIES)),
        ViewKey::Channels { community_id } => Some(keys::scoped(keys::CHANNELS, community_id)),
        ViewKey::Members { community_id } => Some(keys::scoped(keys::MEMBERS, community_id)),
        ViewKey::Pins { channel_id } => Some(keys::scoped(keys::PINS, channel_id)),
        ViewKey::ChannelModeration { channel_id } => {
            Some(keys::scoped(keys::CHANNEL_ROLES, channel_id))
        }
        ViewKey::DirectMessages => Some(keys::op(keys::DMS)),
        ViewKey::Friends => Some(keys::op(keys::FRIENDS)),
        ViewKey::Notifications => Some(keys::op(keys::NOTIFICATIONS)),
        ViewKey::NotificationSettings => Some(keys::op(keys::NOTIFY_SETTINGS)),
        ViewKey::ChannelNotifyLevel { channel_id } => {
            Some(keys::scoped(keys::CHANNEL_LEVEL, channel_id))
        }
        ViewKey::Sessions => Some(keys::op(keys::SESSIONS)),
        ViewKey::Appearance => Some(keys::op(keys::APPEARANCE)),
        ViewKey::InstancePermissions => Some(keys::op(keys::INSTANCE_ROLES)),
        ViewKey::Soundboard { community_id } => Some(keys::scoped(keys::SOUNDBOARD, community_id)),
        ViewKey::Clips => Some(keys::op(keys::CLIPS)),
        ViewKey::UserClips { user_id } => Some(keys::scoped(keys::USER_CLIPS, user_id)),
        ViewKey::ReplaySession => Some(keys::op(keys::REPLAY_SESSION)),
        // W5: each lane maps its own views.
        _ => community_admin::key_for(view).or_else(|| moderation::key_for(view)),
    }
}

fn core_error_view(error: &CoreError) -> ErrorView {
    match error {
        CoreError::Unavailable { what } => ErrorView {
            code: "UNAVAILABLE".into(),
            message: format!("not available: {what}"),
            retryable: false,
            retry_after_ms: None,
        },
        CoreError::Failed { message } => ErrorView {
            code: "FAILED".into(),
            message: message.clone(),
            retryable: true,
            retry_after_ms: None,
        },
    }
}

impl State {
    /// Everything a session leaves behind, forgotten. Sign-out and a lost session both end here.
    pub(crate) fn reset_signed_out(&mut self) {
        let call_live = self.voice.channel_id.is_some() || self.voice.room.is_some();
        self.w4_signed_out();
        self.cache.clear();
        self.fetching.clear();
        self.failed_queries.clear();
        self.windows.clear();
        self.sends.clear();
        self.typing.clear();
        self.mention_notifications.clear();
        self.actions = Default::default();
        self.reading = Default::default();
        self.w2 = Default::default();
        self.w3 = Default::default();
        self.w4 = Default::default();
        self.w5a = Default::default();
        self.w5b = Default::default();
        self.session_epoch += 1;
        // The sleep inhibitor isn't the session's: a change to it queued just now still runs.
        self.effects
            .retain(|effect| matches!(effect, Effect::KeepAwake { .. }));
        self.main_conversation = None;
        self.thread_conversation = None;
        self.me = None;
        self.session = SessionState::SignedOut;
        self.voice = VoiceView::default();
        self.media = None;
        self.call_ended_early = None;
        self.had_connection = false;
        self.token_expires_at_ms = None;
        self.view_changed(ViewKey::Session);
        self.view_changed(ViewKey::Voice);
        self.view_changed(ViewKey::Badge);
        // After the queue was cleared above: a call mustn't outlive the session.
        if call_live {
            self.push_effect(Effect::EndCall);
        }
    }

    /// Forgets which queries failed and fetches again the ones a view is showing.
    pub(crate) fn retry_failed_queries(&mut self) {
        let keys: Vec<QueryKey> = self.failed_queries.drain().map(|(key, _)| key).collect();
        for key in keys {
            if let Some(view) = view_for(&key) {
                self.view_changed(view);
            }
            self.ensure_query(key);
        }
    }

    pub(crate) fn user_or_stub(&self, id: &str) -> UserView {
        if self.me_id() == id
            && let Some(me) = &self.me
        {
            return me.clone();
        }
        self.cache
            .user(&keys::scoped(keys::USER, id))
            .map(user_view)
            .unwrap_or_else(|| UserView {
                id: id.to_owned(),
                ..UserView::default()
            })
    }

    fn unread_for(&self, context_id: &str) -> (u32, u32) {
        self.cache
            .unread_counts(&keys::op(keys::UNREAD))
            .and_then(|counts| {
                counts.iter().find(|count| {
                    count.channel_id.as_deref() == Some(context_id)
                        || count.direct_message_group_id.as_deref() == Some(context_id)
                })
            })
            .map_or((0, 0), |count| {
                (
                    count.unread_count.max(0) as u32,
                    count.mention_count.max(0) as u32,
                )
            })
    }

    /// A query arrived. What reads it should read again.
    fn query_changed(&mut self, key: &QueryKey) {
        let id = key.segments.get(1).cloned().unwrap_or_default();
        match key.op() {
            keys::PROFILE => {
                if let Some(profile) = self.cache.profile(key) {
                    self.me = Some(user_view(profile));
                    self.session = SessionState::SignedIn {
                        me: user_view(profile),
                    };
                    let user_id = profile.id.clone();
                    self.w2_signed_in();
                    self.view_changed(ViewKey::Profile { user_id });
                    self.view_changed(ViewKey::InstancePermissions);
                }
                self.view_changed(ViewKey::Session);
            }
            keys::USER => {
                self.view_changed(ViewKey::Profile {
                    user_id: id.clone(),
                });
                for window in self.windows.values_mut() {
                    window.touch_author(&id);
                }
                self.reaction_users_changed(None);
                self.view_changed(ViewKey::Voice);
                self.members_changed(Some(&id));
            }
            keys::COMMUNITIES => {
                self.view_changed(ViewKey::Communities);
                // A community's badge needs its channels, to know which counts belong to it.
                let communities: Vec<String> = self
                    .cache
                    .communities(key)
                    .map(|list| list.iter().map(|community| community.id.clone()).collect())
                    .unwrap_or_default();
                for community_id in communities {
                    self.ensure_query(keys::scoped(keys::CHANNELS, &community_id));
                }
            }
            keys::CHANNELS => {
                self.view_changed(ViewKey::Communities);
                self.view_changed(ViewKey::Channels { community_id: id });
            }
            keys::CAPABILITIES => {
                self.view_changed(ViewKey::Channels { community_id: id });
            }
            keys::MEMBERS => {
                self.view_changed(ViewKey::Members { community_id: id });
            }
            keys::PRESENCE => {
                self.members_changed(None);
                self.w2_presence_changed();
            }
            keys::NOTIFICATION_COUNT => self.badge_changed(),
            keys::DMS => {
                self.view_changed(ViewKey::DirectMessages);
                self.w4_dms_arrived();
            }
            keys::FRIENDS => self.view_changed(ViewKey::Friends),
            keys::NOTIFICATIONS => self.view_changed(ViewKey::Notifications),
            keys::NOTIFY_SETTINGS => {
                self.view_changed(ViewKey::NotificationSettings);
                for key in self.cache.keys_with_op(keys::CHANNEL_LEVEL) {
                    if let Some(channel_id) = key.segments.get(1).cloned() {
                        self.view_changed(ViewKey::ChannelNotifyLevel { channel_id });
                    }
                }
            }
            keys::CHANNEL_LEVEL => {
                self.view_changed(ViewKey::ChannelNotifyLevel { channel_id: id })
            }
            keys::SESSIONS => self.view_changed(ViewKey::Sessions),
            keys::APPEARANCE => self.view_changed(ViewKey::Appearance),
            keys::INSTANCE_ROLES => self.view_changed(ViewKey::InstancePermissions),
            keys::DM_VOICE_PRESENCE => {
                self.view_changed(ViewKey::Voice);
                self.w4_ring_presence(&id);
            }
            keys::SOUNDBOARD => self.view_changed(ViewKey::Soundboard { community_id: id }),
            keys::CLIPS => self.view_changed(ViewKey::Clips),
            keys::USER_CLIPS => self.view_changed(ViewKey::UserClips { user_id: id }),
            keys::REPLAY_SESSION => self.view_changed(ViewKey::ReplaySession),
            keys::THREAD_META => self.reading_meta_arrived(id),
            keys::UNREAD => {
                self.reading_counts_arrived();
                self.w2_dms_touched();
                self.view_changed(ViewKey::Communities);
                self.view_changed(ViewKey::Rail);
                for channels_key in self.cache.keys_with_op(keys::CHANNELS) {
                    if let Some(community_id) = channels_key.segments.get(1).cloned() {
                        self.view_changed(ViewKey::Channels { community_id });
                    }
                }
            }
            keys::VOICE_PRESENCE => {
                let community = self
                    .cache
                    .keys_with_op(keys::CHANNELS)
                    .iter()
                    .find_map(|key| {
                        let channels = self.cache.channels(key)?;
                        channels
                            .iter()
                            .find(|channel| channel.id == id)
                            .map(|channel| channel.community_id.clone())
                    });
                if let Some(community_id) = community {
                    self.view_changed(ViewKey::Channels { community_id });
                }
                self.view_changed(ViewKey::Voice);
            }
            keys::PINS => self.view_changed(ViewKey::Pins { channel_id: id }),
            keys::CHANNEL_ROLES => {
                self.view_changed(ViewKey::ChannelModeration { channel_id: id });
            }
            keys::MEMBER_SEARCH | keys::MENTIONABLE | keys::EMOJIS => {
                self.view_changed(ViewKey::Mentionables { community_id: id });
            }
            // W5: each lane says what its own queries change.
            _ => {
                if !self.w5a_query_changed(key) {
                    self.w5b_query_changed(key);
                }
            }
        }
    }

    /// A member list that shows this user, or any if `None`, should read again.
    pub(crate) fn members_changed(&mut self, user_id: Option<&str>) {
        for key in self.cache.keys_with_op(keys::MEMBERS) {
            let listed = user_id.is_none_or(|user_id| {
                self.cache.members(&key).is_some_and(|pages| {
                    pages.members.iter().any(|member| member.user_id == user_id)
                })
            });
            if listed && let Some(community_id) = key.segments.get(1).cloned() {
                self.view_changed(ViewKey::Members { community_id });
            }
        }
    }

    /// `(on screen, still needs its first page)` after opening a conversation.
    fn open(&mut self, conversation: &Conversation) -> bool {
        self.reading_opened(conversation);
        match conversation {
            Conversation::Thread { .. } => {
                let previous = self.thread_conversation.replace(conversation.clone());
                self.hide_if_replaced(previous, conversation);
            }
            _ => {
                let previous = self.main_conversation.replace(conversation.clone());
                self.hide_if_replaced(previous, conversation);
            }
        }
        self.use_counter += 1;
        let used = self.use_counter;
        let window = self.windows.entry(conversation.clone()).or_default();
        window.last_used = used;
        window.show();
        let loaded = window.is_loaded();
        let (stale, detached) = (window.stale, window.is_detached_from_live_edge());
        if loaded && stale {
            if detached {
                self.request_reset(conversation);
            } else {
                self.push_effect(Effect::ResyncWindow(conversation.clone()));
            }
        }
        self.trim_windows();
        !loaded
    }

    fn hide_if_replaced(&mut self, previous: Option<Conversation>, next: &Conversation) {
        if let Some(previous) = previous
            && previous != *next
            && let Some(window) = self.windows.get_mut(&previous)
        {
            window.hide();
        }
    }
}

impl State {
    /// A members page carries each user, so nothing needs a request of its own. A user already cached
    /// is told about only if they changed, because telling redraws every row they wrote, and a big
    /// community would do that a thousand times over.
    fn seed_users_from_members(&mut self, pages: &MemberPages, now: u64) {
        let same = |a: &wire::UserEntity, b: &wire::UserEntity| {
            a.username == b.username
                && a.display_name == b.display_name
                && a.avatar_url == b.avatar_url
                && a.status == b.status
        };
        for user in pages
            .members
            .iter()
            .filter_map(|member| member.user.as_ref())
        {
            let key = keys::scoped(keys::USER, &user.id);
            let known = self.cache.user(&key).map(|known| same(known, user));
            self.cache
                .set(key.clone(), CacheValue::User(user.clone()), now);
            if known == Some(false) {
                self.query_changed(&key);
            }
        }
    }
}
