//! What a UI can ask core to do and read back. The signatures are frozen by U0.
//!
//! Commands return once core has accepted them. Their results arrive as `CoreEvent`s. A load the UI
//! is waiting on returns its failure, because no event says so. Reads return what's cached at once,
//! and fetch what's missing or stale, as `useQuery` does: `CoreEvent::ViewChanged` says when to read
//! again.

use crate::cache::{CacheValue, QueryKey, keys};
use crate::client::{Core, Effect, State, user_view};
use crate::model::{
    ChannelKind, ChannelRow, CommunityRow, Conversation, MentionCandidate, MentionKind,
    MessageDraft, ParticipantView, SessionState, UserView, ViewKey, VoiceStatus, VoiceView,
};
use crate::platform::CoreError;
use crate::realtime::RealtimeEvent;
use crate::resync::{failed, unavailable};
use crate::send::is_optimistic_id;
use semaphore_wire::enums::ChannelType;
use semaphore_wire::events::{MARK_AS_READ, REAUTHENTICATE};
use semaphore_wire::types as wire;
use serde_json::json;

/// How many members a mention search asks for.
const MENTION_SEARCH_LIMIT: i64 = 10;
/// Special mentions, from the web's `useMentionAutocomplete`.
const SPECIAL_MENTIONS: [&str; 2] = ["here", "channel"];
const REAUTHENTICATE_TIMEOUT_MS: u64 = 10_000;

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

impl State {
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
                }
                self.view_changed(ViewKey::Session);
            }
            keys::USER => {
                for window in self.windows.values_mut() {
                    window.touch_author(&id);
                }
                self.view_changed(ViewKey::Voice);
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
            keys::UNREAD => {
                self.view_changed(ViewKey::Communities);
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
            keys::MEMBER_SEARCH | keys::MENTIONABLE | keys::EMOJIS => {
                self.view_changed(ViewKey::Mentionables { community_id: id });
            }
            _ => {}
        }
    }

    /// `(on screen, still needs its first page)` after opening a conversation.
    fn open(&mut self, conversation: &Conversation) -> bool {
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

impl Core {
    pub(crate) async fn fetch_query(&self, key: QueryKey) {
        let result = self.fetch_value(&key).await;
        self.write(|state, now| {
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
                    state.cache.set(key.clone(), value, now);
                    state.query_changed(&key);
                    if dirty {
                        // It changed while this was in flight, so this answer may be old.
                        state.invalidate(&key);
                    }
                }
                Err(error) => log::warn!("fetching {key:?} failed: {error}"),
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
                    .map_err(failed)?,
            ),
            keys::USER => CacheValue::User(
                backend
                    .user_controller_get_user_by_id(id)
                    .await
                    .map_err(failed)?,
            ),
            keys::COMMUNITIES => CacheValue::Communities(
                backend
                    .community_controller_find_all_mine()
                    .await
                    .map_err(failed)?,
            ),
            keys::CHANNELS => CacheValue::Channels(
                backend
                    .channels_controller_find_all_for_community(id)
                    .await
                    .map_err(failed)?,
            ),
            keys::CAPABILITIES => CacheValue::Capabilities(
                backend
                    .channel_permissions_controller_get_my_community_channel_permissions(id)
                    .await
                    .map_err(failed)?,
            ),
            keys::UNREAD => CacheValue::UnreadCounts(
                backend
                    .read_receipts_controller_get_unread_counts()
                    .await
                    .map_err(failed)?,
            ),
            keys::VOICE_PRESENCE => CacheValue::VoicePresence(
                backend
                    .voice_presence_controller_get_channel_presence(id)
                    .await
                    .map_err(failed)?,
            ),
            keys::MEMBER_SEARCH => CacheValue::MemberSearch(
                backend
                    .membership_controller_search_community_members(
                        id,
                        key.segments.get(2).cloned().unwrap_or_default(),
                        Some(MENTION_SEARCH_LIMIT),
                    )
                    .await
                    .map_err(failed)?,
            ),
            keys::MENTIONABLE => CacheValue::MentionableChannels(
                backend
                    .channels_controller_get_mentionable_channels(id)
                    .await
                    .map_err(failed)?,
            ),
            keys::EMOJIS => CacheValue::Emojis(
                backend
                    .custom_emoji_controller_list_community_emojis(id)
                    .await
                    .map_err(failed)?,
            ),
            op => {
                return Err(CoreError::Failed {
                    message: format!("no fetch for {op}"),
                });
            }
        };
        Ok(value)
    }

    /// `tokenExpiring`: a new token, then give it to the live socket so it outlives the old one.
    /// Failing is left to the expiry: the server ends the session, and the transport recovers.
    pub(crate) async fn refresh_token(&self) {
        let Some(services) = self.services() else {
            return;
        };
        let body = wire::RefreshRequestDto {
            refresh_token: None,
        };
        let token = match services.backend.auth_controller_refresh(body).await {
            Ok(response) => response.access_token,
            Err(error) => {
                log::warn!("token refresh failed: {error}");
                return;
            }
        };
        if let Some(expiry) = jwt_expiry_ms(&token) {
            self.set_token_expiry(expiry);
        }
        let payload = json!({ "token": format!("Bearer {token}") });
        let result = services
            .realtime
            .emit_with_ack(
                REAUTHENTICATE.to_owned(),
                payload,
                REAUTHENTICATE_TIMEOUT_MS,
            )
            .await;
        match result {
            Ok(args) => {
                if let Some(result) = args.into_iter().next() {
                    self.ingest(RealtimeEvent::Reauthenticated { result });
                }
            }
            Err(error) => log::warn!("reauthenticating the socket failed: {error}"),
        }
    }

    pub async fn sign_in(
        &self,
        server_url: String,
        username: String,
        password: String,
    ) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("signing in"))?
            .clone();
        self.write(|state, _| {
            state.session = SessionState::SigningIn;
            state.view_changed(ViewKey::Session);
        });
        services.backend.set_server_url(server_url);
        let body = wire::LoginRequestDto { password, username };
        let signed_in = async {
            let login = services.backend.auth_controller_login(body).await?;
            let profile = services.backend.user_controller_get_profile().await?;
            Ok::<_, crate::backend::BackendError>((login, profile))
        }
        .await;
        match signed_in {
            Ok((login, profile)) => {
                self.write(|state, now| {
                    let me = user_view(&profile);
                    state.me = Some(me.clone());
                    state.session = SessionState::SignedIn { me };
                    state.token_expires_at_ms = jwt_expiry_ms(&login.access_token);
                    state
                        .cache
                        .set(keys::op(keys::PROFILE), CacheValue::Profile(profile), now);
                    state.view_changed(ViewKey::Session);
                    state.ensure_query(keys::op(keys::COMMUNITIES));
                    state.ensure_query(keys::op(keys::UNREAD));
                });
                services.realtime.connect();
            }
            Err(error) => self.write(|state, _| {
                state.session = SessionState::SignInFailed {
                    error: error.view(),
                };
                state.view_changed(ViewKey::Session);
            }),
        }
        Ok(())
    }

    /// Ends the session and forgets everything from it.
    pub async fn sign_out(&self) -> Result<(), CoreError> {
        let services = self
            .services()
            .ok_or_else(|| unavailable("signing out"))?
            .clone();
        services.realtime.disconnect();
        let body = wire::LogoutRequestDto {
            refresh_token: None,
        };
        if let Err(error) = services.backend.auth_controller_logout(body).await {
            log::warn!("logout failed, signing out here anyway: {error}");
        }
        self.write(|state, _| {
            state.cache.clear();
            state.fetching.clear();
            state.windows.clear();
            state.sends.clear();
            state.typing.clear();
            state.mention_notifications.clear();
            state.effects.clear();
            state.main_conversation = None;
            state.thread_conversation = None;
            state.me = None;
            state.session = SessionState::SignedOut;
            state.voice = VoiceView::default();
            state.had_connection = false;
            state.token_expires_at_ms = None;
            state.view_changed(ViewKey::Session);
        });
        Ok(())
    }

    /// Makes this the conversation on screen, and sends its rows as `ListOp::Reset`. A thread opens
    /// beside the channel it's in. Returns once a first page has loaded, or failed to.
    pub async fn open_conversation(&self, conversation: Conversation) -> Result<(), CoreError> {
        let needs_first_page = self.write(|state, _| {
            let needs = state.open(&conversation);
            let window = state.windows.get_mut(&conversation);
            match window {
                Some(window) if needs && !window.loading_first => {
                    window.loading_first = true;
                    true
                }
                _ => false,
            }
        });
        if !needs_first_page {
            return Ok(());
        }
        let result = self.load_live_edge(&conversation).await;
        self.write(|state, _| {
            if let Some(window) = state.windows.get_mut(&conversation) {
                window.loading_first = false;
            }
        });
        result
    }

    /// Loads older rows, sent as `ListOp::Insert { index: 0, .. }`. A no-op at the start.
    pub async fn load_older(&self, conversation: Conversation) -> Result<(), CoreError> {
        let begun = self.write(|state, _| {
            let window = state.windows.get_mut(&conversation)?;
            if window.loading_older {
                return None;
            }
            let cursor = window.older_cursor()?;
            window.loading_older = true;
            Some((window.begin_fetch(), cursor))
        });
        let Some((epoch, cursor)) = begun else {
            return Ok(());
        };
        let page = self.fetch_page(&conversation, cursor).await;
        self.write(|state, _| {
            if let Some(window) = state.windows.get_mut(&conversation) {
                if let Ok((rows, token)) = &page
                    && window.epoch == epoch
                {
                    window.apply_older_page(rows.clone(), token.clone());
                }
                window.loading_older = false;
                window.end_fetch();
            }
        });
        page.map(|_| ())
    }

    /// While a selection is held, core keeps that span of rows loaded. `None` releases it, and a
    /// reset that was waiting on it then runs.
    pub fn hold_rows(&self, conversation: Conversation, seq_range: Option<(i64, i64)>) {
        self.write(|state, _| {
            let Some(window) = state.windows.get_mut(&conversation) else {
                return;
            };
            window.hold(seq_range);
            if seq_range.is_none() && window.reset_deferred {
                window.reset_deferred = false;
                state.request_reset(&conversation);
            }
        });
    }

    /// Adds a pending row at once and returns its client nonce.
    pub async fn send_message(
        &self,
        conversation: Conversation,
        draft: MessageDraft,
    ) -> Result<String, CoreError> {
        self.begin_send(conversation, draft)
    }

    /// Retries with the same nonce, so the server can't create a second message.
    pub async fn retry_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.services().ok_or_else(|| unavailable("sending"))?;
        self.begin_retry(&client_nonce);
        Ok(())
    }

    /// Adds my reaction, or removes it if it's there. The contract types this request's id as a
    /// UUID, so unlike a send it can't carry a scenario's readable id.
    pub async fn toggle_reaction(
        &self,
        message_id: String,
        emoji: String,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("reactions"))?;
        let parsed = message_id.parse().map_err(|error| CoreError::Failed {
            message: format!("message id {message_id}: {error}"),
        })?;
        let mine = self.read(|state| {
            state
                .windows
                .values()
                .find_map(|window| window.find(&message_id))
                .is_some_and(|message| {
                    message.dto.reactions.iter().any(|reaction| {
                        reaction.emoji == emoji
                            && reaction.user_ids.iter().any(|id| id == state.me_id())
                    })
                })
        });
        // Its event updates the row: this client's own reaction comes back like anyone's.
        if mine {
            let body = wire::RemoveReactionDto {
                emoji,
                message_id: parsed,
            };
            services
                .backend
                .messages_controller_remove_reaction(body)
                .await
                .map_err(failed)?;
        } else {
            let body = wire::AddReactionDto {
                emoji,
                message_id: parsed,
            };
            services
                .backend
                .messages_controller_add_reaction(body)
                .await
                .map_err(failed)?;
        }
        Ok(())
    }

    /// Over the socket, as the web's visible-range marks are, because the REST path types the id
    /// as a UUID. A pending row's id means nothing to the server, so it's never sent.
    pub async fn mark_read(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("read marks"))?;
        if is_optimistic_id(&message_id) {
            return Ok(());
        }
        let payload = match &conversation {
            Conversation::Channel { id } => {
                json!({ "lastReadMessageId": message_id, "channelId": id })
            }
            Conversation::DirectMessage { id } => {
                json!({ "lastReadMessageId": message_id, "directMessageGroupId": id })
            }
            // Read state is per channel: a thread has none of its own.
            Conversation::Thread { .. } => return Ok(()),
        };
        services
            .realtime
            .emit(MARK_AS_READ.to_owned(), payload)
            .await
            .map_err(|error| CoreError::Failed {
                message: error.to_string(),
            })
    }

    pub async fn join_voice(&self, channel_id: String) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("voice"))?.clone();
        let media = services.media.clone().ok_or_else(|| unavailable("voice"))?;
        let me = self
            .read(|state| state.me.clone())
            .ok_or_else(|| unavailable("voice while signed out"))?;
        self.write(|state, _| {
            state.voice.status = VoiceStatus::Connecting;
            state.voice.channel_id = Some(channel_id.clone());
            state.view_changed(ViewKey::Voice);
            state.ensure_query(keys::scoped(keys::VOICE_PRESENCE, &channel_id));
        });
        let joined = async {
            let info = services
                .backend
                .livekit_controller_get_connection_info()
                .await
                .map_err(failed)?;
            let body = wire::CreateTokenDto {
                identity: me.id.clone(),
                name: Some(me.username.clone()),
                room_id: channel_id.clone(),
                ttl: None,
            };
            let token = services
                .backend
                .livekit_controller_generate_token(body)
                .await
                .map_err(failed)?;
            let url = token.url.or(info.url).ok_or_else(|| CoreError::Failed {
                message: "the server gave no LiveKit address".into(),
            })?;
            media.connect(url, token.token).await?;
            services
                .backend
                .voice_presence_controller_join_presence(channel_id.clone())
                .await
                .map_err(failed)?;
            Ok::<_, CoreError>(())
        }
        .await;
        self.write(|state, _| {
            if joined.is_ok() {
                state.voice.status = VoiceStatus::Connected;
            } else {
                state.voice = VoiceView::default();
            }
            state.view_changed(ViewKey::Voice);
        });
        joined
    }

    pub async fn leave_voice(&self) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("voice"))?.clone();
        let channel_id = self.write(|state, _| {
            let channel_id = state.voice.channel_id.take();
            state.voice = VoiceView::default();
            state.view_changed(ViewKey::Voice);
            channel_id
        });
        if let Some(media) = &services.media {
            media.disconnect().await;
        }
        if let Some(channel_id) = channel_id {
            services
                .backend
                .voice_presence_controller_leave_presence(channel_id)
                .await
                .map_err(failed)?;
        }
        Ok(())
    }

    pub async fn set_muted(&self, muted: bool) -> Result<(), CoreError> {
        self.write(|state, _| {
            state.voice.muted = muted;
            state.view_changed(ViewKey::Voice);
        });
        Ok(())
    }

    pub async fn set_deafened(&self, deafened: bool) -> Result<(), CoreError> {
        let channel_id = self.write(|state, _| {
            state.voice.deafened = deafened;
            state.view_changed(ViewKey::Voice);
            state.voice.channel_id.clone()
        });
        if let (Some(channel_id), Some(services)) = (channel_id, self.services()) {
            let body = wire::UpdateDeafenStateDto {
                is_deafened: deafened,
            };
            services
                .backend
                .voice_presence_controller_update_deafen_state(channel_id, body)
                .await
                .map_err(failed)?;
        }
        Ok(())
    }

    /// The transport hands every event here. Not part of a UI's surface.
    pub fn ingest(&self, event: RealtimeEvent) {
        self.ingest_batch(vec![event]);
    }

    pub fn session(&self) -> SessionState {
        self.read(|state| state.session.clone())
    }

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
                    ChannelRow {
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

    /// Who's in the room comes from voice presence. Who's speaking, and tracks, are the media
    /// crate's to report, and have no way in yet.
    pub fn voice(&self) -> VoiceView {
        self.read(|state| {
            let mut voice = state.voice.clone();
            if let Some(channel_id) = &voice.channel_id {
                let key = keys::scoped(keys::VOICE_PRESENCE, channel_id);
                let users = state
                    .cache
                    .voice_presence(&key)
                    .map(|presence| presence.users.as_slice());
                voice.participants = users
                    .unwrap_or_default()
                    .iter()
                    .map(|user| ParticipantView {
                        identity: user.id.clone(),
                        user: UserView {
                            id: user.id.clone(),
                            username: user.username.clone(),
                            display_name: user.display_name.clone(),
                            avatar_file_id: user.avatar_url.clone(),
                        },
                        is_self: user.id == state.me_id(),
                        speaking: false,
                        muted: user.is_server_muted,
                        deafened: user.is_deafened,
                        camera: None,
                        screen_share: None,
                    })
                    .collect();
            }
            voice
        })
    }
}
