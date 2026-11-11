//! Fetching queries into the cache, and what a UI reads about their load state.

use super::{
    MAX_MEMBERS, MEMBER_PAGE_SIZE, MENTION_SEARCH_LIMIT, core_error_view, key_for, view_for,
};
use crate::cache::{CacheValue, MemberPages, QueryKey, keys};
use crate::client::Core;
use crate::model::{LoadState, SessionState, SignOutReason, ViewKey};
use crate::platform::CoreError;
use crate::realtime::RealtimeEvent;
use crate::resync::{failed, unavailable};

impl Core {
    pub(crate) async fn fetch_query(&self, key: QueryKey) {
        let epoch = self.read(|state| state.session_epoch);
        let result = self.fetch_value(&key).await;
        self.write(|state, now| {
            // A session has ended since: this answer, and the `fetching` mark, aren't the next one's.
            if state.session_epoch != epoch {
                return;
            }
            // Gone means the session it belonged to is over: sign-out clears these.
            let Some(dirty) = state.fetching.remove(&key) else {
                return;
            };
            match result {
                Ok(value) => {
                    if let CacheValue::MemberSearch(members) = &value {
                        // Members carry their user, so authors need no request of their own.
                        for user in members.iter().filter_map(|member| member.user.as_ref()) {
                            let user_key = keys::scoped(keys::USER, &user.id);
                            state
                                .cache
                                .set(user_key.clone(), CacheValue::User(user.clone()), now);
                            state.query_changed(&user_key);
                        }
                    }
                    if let CacheValue::Members(pages) = &value {
                        state.seed_users_from_members(pages, now);
                    }
                    state.cache.set(key.clone(), value, now);
                    state.failed_queries.remove(&key);
                    // W4: an answer that was out when its data changed is from before the change.
                    state.w4.answer_dirty = dirty;
                    state.query_changed(&key);
                    state.w4.answer_dirty = false;
                    if dirty {
                        // It changed while this was in flight, so this answer may be old.
                        state.invalidate(&key);
                    }
                }
                Err(error) => {
                    log::warn!("fetching {key:?} failed: {error}");
                    if let Some(view) = view_for(&key) {
                        state
                            .failed_queries
                            .insert(key.clone(), core_error_view(&error));
                        state.view_changed(view);
                    }
                }
            }
        });
    }

    async fn fetch_value(&self, key: &QueryKey) -> Result<CacheValue, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        let id = key.segments.get(1).cloned().unwrap_or_default();
        let value = match key.op() {
            keys::PROFILE => CacheValue::Profile(
                backend
                    .user_controller_get_profile()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::USER => CacheValue::User(
                backend
                    .user_controller_get_user_by_id(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::COMMUNITIES => CacheValue::Communities(
                backend
                    .community_controller_find_all_mine()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::CHANNELS => CacheValue::Channels(
                backend
                    .channels_controller_find_all_for_community(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::CAPABILITIES => CacheValue::Capabilities(
                backend
                    .channel_permissions_controller_get_my_community_channel_permissions(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::UNREAD => CacheValue::UnreadCounts(
                backend
                    .read_receipts_controller_get_unread_counts()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::VOICE_PRESENCE => CacheValue::VoicePresence(
                backend
                    .voice_presence_controller_get_channel_presence(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::MEMBER_SEARCH => CacheValue::MemberSearch(
                backend
                    .membership_controller_search_community_members(
                        id,
                        key.segments.get(2).cloned().unwrap_or_default(),
                        Some(MENTION_SEARCH_LIMIT),
                    )
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::MENTIONABLE => CacheValue::MentionableChannels(
                backend
                    .channels_controller_get_mentionable_channels(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::MEMBERS => CacheValue::Members(self.fetch_members(id).await?),
            keys::PRESENCE => CacheValue::Presence(
                backend
                    .presence_controller_get_bulk_presence()
                    .await
                    .map_err(|error| self.backend_failed(error))?
                    .presence,
            ),
            keys::NOTIFICATION_COUNT => CacheValue::NotificationCount(
                backend
                    .notifications_controller_get_unread_count()
                    .await
                    .map_err(|error| self.backend_failed(error))?
                    .count,
            ),
            keys::EMOJIS => CacheValue::Emojis(
                backend
                    .custom_emoji_controller_list_community_emojis(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::PINS => CacheValue::Pins(
                backend
                    .moderation_controller_get_pinned_messages(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::THREAD_META => CacheValue::ThreadMeta(
                backend
                    .threads_controller_get_metadata(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::CHANNEL_ROLES => CacheValue::ChannelRoles(
                backend
                    .roles_controller_get_my_roles_for_channel(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::DMS => self.fetch_dms().await?,
            keys::FRIENDS => self.fetch_friends().await?,
            keys::NOTIFICATIONS => self.fetch_notifications().await?,
            keys::NOTIFY_SETTINGS => self.fetch_notify_settings().await?,
            keys::CHANNEL_LEVEL => self.fetch_channel_level(id).await?,
            keys::SESSIONS => CacheValue::Sessions(
                backend
                    .auth_controller_get_sessions()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::INSTANCE_ROLES => CacheValue::InstanceRoles(
                backend
                    .roles_controller_get_my_instance_roles()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::APPEARANCE => CacheValue::Appearance(
                backend
                    .appearance_settings_controller_get_settings()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::DM_VOICE_PRESENCE => CacheValue::DmVoicePresence(
                backend
                    .dm_voice_presence_controller_get_dm_presence(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::SOUNDBOARD => CacheValue::Soundboard(
                backend
                    .soundboard_controller_list_community_sounds(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::CLIPS => CacheValue::Clips(
                backend
                    .livekit_controller_get_my_clips()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::USER_CLIPS => CacheValue::Clips(
                backend
                    .livekit_controller_get_user_public_clips(id)
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            keys::REPLAY_SESSION => CacheValue::ReplaySession(
                backend
                    .livekit_controller_get_session_info()
                    .await
                    .map_err(|error| self.backend_failed(error))?,
            ),
            // W5: each lane fetches its own queries.
            op => {
                if let Some(value) = self.w5a_fetch(key).await {
                    return value;
                }
                if let Some(value) = self.w5b_fetch(key).await {
                    return value;
                }
                return Err(CoreError::Failed {
                    message: format!("no fetch for {op}"),
                });
            }
        };
        Ok(value)
    }

    /// A community's members, a page at a time, up to [`MAX_MEMBERS`]. A failed page fails the read,
    /// so what's cached stays until one succeeds, rather than a list that silently shrank.
    async fn fetch_members(&self, community_id: String) -> Result<MemberPages, CoreError> {
        let backend = &self
            .services()
            .ok_or_else(|| unavailable("the backend"))?
            .backend;
        let mut members = Vec::new();
        let mut token = None;
        loop {
            let left = MAX_MEMBERS - members.len();
            let page = backend
                .membership_controller_find_all_for_community(
                    community_id.clone(),
                    Some(MEMBER_PAGE_SIZE.min(left as i64)),
                    token,
                )
                .await
                .map_err(|error| self.backend_failed(error))?;
            // A page that adds nothing can't be followed: a server that keeps saying more follow
            // would otherwise be asked forever. What was read stands, marked as not all of it.
            let added = page.members.len();
            members.extend(page.members);
            token = page.continuation_token.filter(|token| !token.is_empty());
            if token.is_none() || added == 0 || members.len() >= MAX_MEMBERS {
                let truncated = token.is_some();
                members.truncate(MAX_MEMBERS);
                return Ok(MemberPages { members, truncated });
            }
        }
    }

    /// The transport hands every event here. Not part of a UI's surface.
    pub fn ingest(&self, event: RealtimeEvent) {
        self.ingest_batch(vec![event]);
    }

    /// A failed REST call. A 401 here comes after the backend has already tried a refresh and been
    /// refused (`HttpBackend` refreshes on the first 401 and retries once), so the session is over:
    /// it ends as `AuthLost` would, rather than leaving a signed-in UI whose every call fails.
    pub(crate) fn backend_failed(&self, error: crate::backend::BackendError) -> CoreError {
        if error.status == 401 {
            let lost = self.write(|state, _| {
                if !matches!(state.session, SessionState::SignedIn { .. }) {
                    return false;
                }
                log::warn!("the server refused the session: {error}");
                state.reset_signed_out();
                state.sign_out_reason = Some(SignOutReason::Expired);
                true
            });
            if lost && let Some(services) = self.services() {
                services.realtime.disconnect();
            }
        }
        failed(error)
    }

    /// Whether a list has arrived. For `Communities`, `Channels` and `Members`; anything else reads
    /// as `Ready`.
    pub fn load_state(&self, view: ViewKey) -> LoadState {
        let Some(key) = key_for(&view) else {
            return LoadState::Ready;
        };
        self.read(|state| {
            if let Some(error) = state.failed_queries.get(&key) {
                return LoadState::Failed {
                    error: error.clone(),
                };
            }
            if state.cache.get(&key).is_some() {
                LoadState::Ready
            } else {
                LoadState::Loading
            }
        })
    }

    /// Fetches again whatever failed. A new connection does this by itself.
    pub fn retry_failed(&self) {
        self.write(|state, _| {
            state.retry_failed_queries();
            state.retry_failed_invites();
        });
    }
}
