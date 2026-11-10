//! What a UI can ask core to do and read back. The signatures are frozen by U0.
//!
//! Commands return once core has accepted them. Their results arrive as `CoreEvent`s. A load the UI
//! is waiting on returns its failure, because no event says so. Reads return what's cached at once,
//! and fetch what's missing or stale, as `useQuery` does: `CoreEvent::ViewChanged` says when to read
//! again.

use crate::cache::{CacheValue, MemberPages, QueryKey, keys};
use crate::client::{Core, Effect, State, user_view};
use crate::model::{
    ChannelKind, ChannelPermissions, ChannelRow, CommunityRow, Conversation, DisplayRole,
    EmojiView, ErrorView, LoadState, MemberList, MemberView, MentionCandidate, MentionKind,
    MessageDraft, ParticipantView, RailCounts, ServerInfo, SessionState, SignOutReason, UserView,
    VideoDemand, ViewKey, VoiceStatus, VoiceView,
};
use crate::platform::CoreError;
use crate::realtime::RealtimeEvent;
use crate::resync::{failed, unavailable};
use crate::send::is_optimistic_id;
use crate::store::SendStatus;
use semaphore_wire::enums::{ChannelType, MessagePageDirection};
use semaphore_wire::events::{MARK_AS_READ, REAUTHENTICATE, TYPING_START, TYPING_STOP};
use semaphore_wire::types as wire;
use serde_json::json;

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
        _ => None,
    }
}

/// The query behind a view's list, the reverse of [`view_for`].
fn key_for(view: &ViewKey) -> Option<QueryKey> {
    match view {
        ViewKey::Communities => Some(keys::op(keys::COMMUNITIES)),
        ViewKey::Channels { community_id } => Some(keys::scoped(keys::CHANNELS, community_id)),
        ViewKey::Members { community_id } => Some(keys::scoped(keys::MEMBERS, community_id)),
        _ => None,
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
        self.cache.clear();
        self.fetching.clear();
        self.failed_queries.clear();
        self.windows.clear();
        self.sends.clear();
        self.typing.clear();
        self.mention_notifications.clear();
        self.effects.clear();
        self.main_conversation = None;
        self.thread_conversation = None;
        self.me = None;
        self.session = SessionState::SignedOut;
        self.voice = VoiceView::default();
        self.media = None;
        self.had_connection = false;
        self.token_expires_at_ms = None;
        self.view_changed(ViewKey::Session);
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
                }
                self.view_changed(ViewKey::Session);
            }
            keys::USER => {
                for window in self.windows.values_mut() {
                    window.touch_author(&id);
                }
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
            keys::PRESENCE => self.members_changed(None),
            keys::NOTIFICATION_COUNT => self.view_changed(ViewKey::Rail),
            keys::UNREAD => {
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
            keys::MEMBER_SEARCH | keys::MENTIONABLE | keys::EMOJIS => {
                self.view_changed(ViewKey::Mentionables { community_id: id });
            }
            _ => {}
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

fn voice_token_request(me: &UserView, channel_id: &str) -> wire::CreateTokenDto {
    wire::CreateTokenDto {
        identity: me.id.clone(),
        name: Some(me.username.clone()),
        room_id: channel_id.to_owned(),
        ttl: None,
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
                    if let CacheValue::Members(pages) = &value {
                        state.seed_users_from_members(pages, now);
                    }
                    state.cache.set(key.clone(), value, now);
                    state.failed_queries.remove(&key);
                    state.query_changed(&key);
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
            op => {
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
            members.extend(page.members);
            token = page.continuation_token.filter(|token| !token.is_empty());
            if token.is_none() || members.len() >= MAX_MEMBERS {
                let truncated = token.is_some();
                members.truncate(MAX_MEMBERS);
                return Ok(MemberPages { members, truncated });
            }
        }
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
                    state.sign_out_reason = None;
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
        // Before the session goes: leaving tells the server, and a call mustn't outlive a sign-out.
        if self.read(|state| state.voice.channel_id.is_some())
            && let Err(error) = self.leave_voice().await
        {
            log::warn!("leaving voice on sign-out: {error}");
        }
        services.realtime.disconnect();
        let body = wire::LogoutRequestDto {
            refresh_token: None,
        };
        if let Err(error) = services.backend.auth_controller_logout(body).await {
            log::warn!("logout failed, signing out here anyway: {error}");
        }
        self.write(|state, _| {
            state.reset_signed_out();
            state.sign_out_reason = Some(SignOutReason::SignedOut);
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

    /// Loads newer rows into a window that has moved away from the live edge, sent as a `ListOp::Insert`
    /// at the end. A no-op at the live edge. [`Core::at_live_edge`] turns true with the last page.
    pub async fn load_newer(&self, conversation: Conversation) -> Result<(), CoreError> {
        let begun = self.write(|state, _| {
            let window = state.windows.get_mut(&conversation)?;
            if window.loading_newer || !window.is_detached_from_live_edge() {
                return None;
            }
            let Some(cursor) = window.newer_cursor() else {
                // Nothing the server knows about to start from.
                state.request_reset(&conversation);
                return None;
            };
            window.loading_newer = true;
            Some((window.begin_fetch(), cursor))
        });
        let Some((epoch, cursor)) = begun else {
            return Ok(());
        };
        let page = self
            .fetch_page_toward(
                &conversation,
                Some(cursor),
                Some(MessagePageDirection::Newer),
            )
            .await;
        self.write(|state, _| {
            let mut out_of_room = false;
            if let Some(window) = state.windows.get_mut(&conversation) {
                if let Ok((rows, token)) = &page
                    && window.epoch == epoch
                {
                    out_of_room = !window.apply_newer_page(rows.clone(), token.is_some());
                }
                window.loading_newer = false;
                window.end_fetch();
                window.evict_oldest();
            }
            if out_of_room {
                state.request_reset(&conversation);
            }
        });
        page.map(|_| ())
    }

    /// Whether the newest rows loaded are the newest there are. If not, nothing new lands in this list
    /// until [`Core::load_newer`] reaches the edge or [`Core::jump_to_present`] returns to it. Read it
    /// again after `CoreEvent::MessagesChanged`.
    pub fn at_live_edge(&self, conversation: Conversation) -> bool {
        self.read(|state| {
            state
                .windows
                .get(&conversation)
                .is_none_or(|window| !window.is_detached_from_live_edge())
        })
    }

    /// Replaces a detached window's rows with the live edge, as `ListOp::Reset`. If a selection holds
    /// the rows, that happens when it lets go. A no-op at the live edge.
    pub async fn jump_to_present(&self, conversation: Conversation) -> Result<(), CoreError> {
        if self.at_live_edge(conversation.clone()) {
            return Ok(());
        }
        self.load_live_edge(&conversation).await
    }

    /// Makes this the conversation on screen with a message's rows loaded, for a reply or a pin to jump
    /// to. If they're loaded already nothing is fetched, and the UI scrolls to the row. Otherwise rows
    /// come as `ListOp::Reset`, and if they don't reach the live edge the window is detached: see
    /// [`Core::at_live_edge`]. Fails if a selection holds the rows it would replace: release it first.
    /// A thread reads to its end, so it only opens.
    pub async fn open_conversation_at(
        &self,
        conversation: Conversation,
        message_id: String,
    ) -> Result<(), CoreError> {
        if matches!(conversation, Conversation::Thread { .. }) {
            return self.open_conversation(conversation).await;
        }
        let services = self.services().ok_or_else(|| unavailable("the backend"))?;
        let begun = self.write(|state, _| {
            state.open(&conversation);
            let window = state.windows.get_mut(&conversation)?;
            if window.holds_id(&message_id) {
                return Some(Ok(None));
            }
            if window.is_held() {
                return Some(Err(CoreError::Failed {
                    message: "a selection holds the rows".into(),
                }));
            }
            // Whatever is on its way for the rows these replace no longer matters.
            window.epoch += 1;
            Some(Ok(Some(window.begin_fetch())))
        });
        let epoch = match begun {
            Some(Ok(Some(epoch))) => epoch,
            Some(Err(error)) => return Err(error),
            _ => return Ok(()),
        };
        let page = match &conversation {
            Conversation::Channel { id } => {
                services
                    .backend
                    .messages_controller_find_around_for_channel(
                        id.clone(),
                        message_id,
                        Some(AROUND_LIMIT),
                    )
                    .await
            }
            Conversation::DirectMessage { id } => {
                services
                    .backend
                    .messages_controller_find_around_for_group(
                        id.clone(),
                        message_id,
                        Some(AROUND_LIMIT),
                    )
                    .await
            }
            Conversation::Thread { .. } => unreachable!("a thread returned above"),
        }
        .map_err(|error| self.backend_failed(error));
        self.write(|state, _| {
            let Some(window) = state.windows.get_mut(&conversation) else {
                return;
            };
            if let Ok(page) = &page
                && window.epoch == epoch
            {
                let present = |token: &Option<String>| {
                    token.as_ref().filter(|token| !token.is_empty()).cloned()
                };
                window.apply_around_page(
                    page.messages.clone(),
                    present(&page.older_continuation_token),
                    present(&page.newer_continuation_token).is_some(),
                );
            }
            window.end_fetch();
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

    /// Throws a failed send away: its row goes, as a `ListOp::Remove`, and it can't be retried. A send
    /// still pending, or one that has settled, is left alone. If the failed send had really reached
    /// the server, its message still arrives as anyone's would.
    pub async fn discard_failed_send(&self, client_nonce: String) -> Result<(), CoreError> {
        self.write(|state, _| {
            let Some(send) = state.sends.get(&client_nonce) else {
                return;
            };
            if send.in_flight || send.parked_since.is_some() {
                return;
            }
            let (conversation, client_id) = (send.conversation.clone(), send.client_id.clone());
            let window = state.windows.get_mut(&conversation);
            let row = window.as_deref().and_then(|window| window.find(&client_id));
            // Pending with no attempt running: a retry has been queued.
            if row.is_some_and(|row| !matches!(row.send, SendStatus::Failed(_))) {
                return;
            }
            if let Some(window) = window {
                window.remove_optimistic(&client_id);
            }
            state.sends.remove(&client_nonce);
        });
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
                .map_err(|error| self.backend_failed(error))?;
        } else {
            let body = wire::AddReactionDto {
                emoji,
                message_id: parsed,
            };
            services
                .backend
                .messages_controller_add_reaction(body)
                .await
                .map_err(|error| self.backend_failed(error))?;
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
        let (muted, deafened) = self.write(|state, _| {
            state.voice.status = VoiceStatus::Connecting;
            state.voice.channel_id = Some(channel_id.clone());
            state.voice.reconnect_attempt = None;
            state.voice.error = None;
            state.media = None;
            state.view_changed(ViewKey::Voice);
            state.ensure_query(keys::scoped(keys::VOICE_PRESENCE, &channel_id));
            (state.voice.muted, state.voice.deafened)
        });
        // The engine remembers these across calls, and what this call starts with is what's shown.
        // Deafen first: undeafening restores a mute this then overrides.
        media.set_deafened(deafened);
        media.set_muted(muted);
        let joined = async {
            let info = services
                .backend
                .livekit_controller_get_connection_info()
                .await
                .map_err(|error| self.backend_failed(error))?;
            let token = services
                .backend
                .livekit_controller_generate_token(voice_token_request(&me, &channel_id))
                .await
                .map_err(|error| self.backend_failed(error))?;
            let url = token.url.or(info.url).ok_or_else(|| CoreError::Failed {
                message: "the server gave no LiveKit address".into(),
            })?;
            media.connect(url, token.token).await?;
            services
                .backend
                .voice_presence_controller_join_presence(channel_id.clone())
                .await
                .map_err(|error| self.backend_failed(error))?;
            Ok::<_, CoreError>(())
        }
        .await;
        self.write(|state, _| {
            if joined.is_ok() {
                state.voice.status = VoiceStatus::Connected;
            } else {
                state.voice = VoiceView::default();
                state.media = None;
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
            state.media = None;
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
                .map_err(|error| self.backend_failed(error))?;
        }
        Ok(())
    }

    pub async fn set_muted(&self, muted: bool) -> Result<(), CoreError> {
        self.write(|state, _| {
            state.voice.muted = muted;
            // Shown now, not when the engine's report comes back.
            if let Some(media) = &mut state.media {
                media.muted = muted;
            }
            state.view_changed(ViewKey::Voice);
        });
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.set_muted(muted);
        }
        Ok(())
    }

    pub async fn set_deafened(&self, deafened: bool) -> Result<(), CoreError> {
        let channel_id = self.write(|state, _| {
            state.voice.deafened = deafened;
            if let Some(media) = &mut state.media {
                media.deafened = deafened;
            }
            state.view_changed(ViewKey::Voice);
            state.voice.channel_id.clone()
        });
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.set_deafened(deafened);
        }
        if let (Some(channel_id), Some(services)) = (channel_id, self.services()) {
            let body = wire::UpdateDeafenStateDto {
                is_deafened: deafened,
            };
            services
                .backend
                .voice_presence_controller_update_deafen_state(channel_id, body)
                .await
                .map_err(|error| self.backend_failed(error))?;
        }
        Ok(())
    }

    /// Which video tiles are on screen. Goes straight to the media engine, which chooses layers.
    pub fn set_video_demands(&self, demands: Vec<VideoDemand>) {
        if let Some(media) = self.services().and_then(|services| services.media.as_ref()) {
            media.set_video_demands(demands);
        }
    }

    /// A new token for the call in progress, for the engine to rejoin with. The one it connected with
    /// may have expired by then.
    pub async fn voice_token(&self) -> Result<String, CoreError> {
        let services = self.services().ok_or_else(|| unavailable("voice"))?;
        let (me, channel_id) =
            self.read(|state| (state.me.clone(), state.voice.channel_id.clone()));
        let (Some(me), Some(channel_id)) = (me, channel_id) else {
            return Err(unavailable("a voice token outside a call"));
        };
        let token = services
            .backend
            .livekit_controller_generate_token(voice_token_request(&me, &channel_id))
            .await
            .map_err(|error| self.backend_failed(error))?;
        Ok(token.token)
    }

    /// Keeps this client on the channel's roster. The server forgets it 90 s after the last one, so a
    /// host calls this about every 30 s, as the web's heartbeat does. Does nothing unless connected:
    /// a dead room must not keep claiming to be there. A failure is logged, for the next to retry, and
    /// a refresh after expiry re-registers, so nothing else is needed after a rejoin.
    pub async fn refresh_voice_presence(&self) {
        let channel_id = self.read(|state| {
            state
                .voice
                .channel_id
                .clone()
                .filter(|_| state.voice.status == VoiceStatus::Connected)
        });
        let (Some(channel_id), Some(services)) = (channel_id, self.services()) else {
            return;
        };
        if let Err(error) = services
            .backend
            .voice_presence_controller_refresh_presence(channel_id)
            .await
        {
            log::warn!("refreshing voice presence failed: {error}");
        }
    }

    /// The media engine hands what it sees here, whenever it changes. Not part of a UI's surface.
    pub fn ingest_media(&self, media: VoiceView) {
        self.write(|state, _| {
            // Too late for a call that's over.
            if state.voice.status == VoiceStatus::Disconnected
                || state.media.as_ref() == Some(&media)
            {
                return;
            }
            let was_live = state.media.as_ref().is_some_and(|last| {
                matches!(
                    last.status,
                    VoiceStatus::Connected | VoiceStatus::Reconnecting
                )
            });
            let in_call = matches!(
                state.voice.status,
                VoiceStatus::Connected | VoiceStatus::Reconnecting
            );
            match media.status {
                // Only after the engine has said it was in the call. A report from before it joined
                // can arrive after `connect` returned, and says nothing about this call.
                VoiceStatus::Disconnected if in_call && was_live => {
                    let channel_id = state.voice.channel_id.take();
                    state.voice = VoiceView {
                        error: media.error,
                        ..VoiceView::default()
                    };
                    state.media = None;
                    if let Some(channel_id) = channel_id {
                        state.push_effect(Effect::LeavePresence(channel_id));
                    }
                    state.view_changed(ViewKey::Voice);
                    return;
                }
                VoiceStatus::Connected | VoiceStatus::Reconnecting if in_call => {
                    state.voice.status = media.status;
                }
                _ => {}
            }
            state.media = Some(media);
            state.view_changed(ViewKey::Voice);
        });
    }

    pub(crate) async fn leave_presence(&self, channel_id: String) {
        let Some(services) = self.services() else {
            return;
        };
        if let Err(error) = services
            .backend
            .voice_presence_controller_leave_presence(channel_id)
            .await
        {
            log::warn!("leaving voice presence failed: {error}");
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
        self.write(|state, _| state.retry_failed_queries());
    }

    /// Why the last session ended, while signed out. `None` before any session has.
    pub fn last_sign_out(&self) -> Option<SignOutReason> {
        self.read(|state| state.sign_out_reason)
    }

    /// Asks a server about itself before signing in: whether it answers at all, and its name. Points
    /// the backend at `server_url`, as `sign_in` does.
    pub async fn probe_server(&self, server_url: String) -> Result<ServerInfo, CoreError> {
        let services = self.services().ok_or_else(|| unavailable("the backend"))?;
        let url = server_url.trim().trim_end_matches('/').to_owned();
        services.backend.set_server_url(url.clone());
        let settings = services
            .backend
            .instance_controller_get_public_settings()
            .await
            .map_err(failed)?;
        Ok(ServerInfo {
            url,
            name: Some(settings.name).filter(|name| !name.trim().is_empty()),
            max_file_bytes: u64::try_from(settings.max_file_size_bytes)
                .ok()
                .filter(|bytes| *bytes > 0),
            password_reset: settings.password_reset_enabled,
        })
    }

    /// The user is typing here (`started`), or stopped. The owner debounces: the web sends a start at
    /// most every few seconds while keys arrive, and a stop when the draft is sent or cleared. Over
    /// the socket; nothing happens while it's down, because typing is worthless late.
    pub async fn send_typing(
        &self,
        conversation: Conversation,
        started: bool,
    ) -> Result<(), CoreError> {
        let services = self.services().ok_or_else(|| unavailable("typing"))?;
        let payload = match &conversation {
            Conversation::Channel { id } => json!({ "channelId": id }),
            Conversation::DirectMessage { id } => json!({ "directMessageGroupId": id }),
            Conversation::Thread { .. } => return Ok(()),
        };
        let name = if started { TYPING_START } else { TYPING_STOP };
        services
            .realtime
            .emit(name.to_owned(), payload)
            .await
            .map_err(|error| CoreError::Failed {
                message: error.to_string(),
            })
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

    /// Who's in the room comes from voice presence, so a name and an avatar are there from the start.
    /// Who's speaking, tracks and quality come from the media engine. Either can say someone is muted
    /// or deafened: presence knows a server mute, the engine a muted track. Someone the engine sees
    /// before presence does is listed too.
    pub fn voice(&self) -> VoiceView {
        self.read(|state| {
            let mut voice = state.voice.clone();
            let Some(channel_id) = &voice.channel_id else {
                return voice;
            };
            let empty = Vec::new();
            let seen = state
                .media
                .as_ref()
                .map_or(&empty, |media| &media.participants);
            let key = keys::scoped(keys::VOICE_PRESENCE, channel_id);
            let users = state
                .cache
                .voice_presence(&key)
                .map(|presence| presence.users.as_slice())
                .unwrap_or_default();
            let mut participants: Vec<ParticipantView> = users
                .iter()
                .map(|user| {
                    let media = seen.iter().find(|media| media.identity == user.id);
                    ParticipantView {
                        identity: user.id.clone(),
                        user: UserView {
                            id: user.id.clone(),
                            username: user.username.clone(),
                            display_name: user.display_name.clone(),
                            avatar_file_id: user.avatar_url.clone(),
                        },
                        is_self: user.id == state.me_id(),
                        speaking: media.is_some_and(|media| media.speaking),
                        muted: user.is_server_muted || media.is_some_and(|media| media.muted),
                        deafened: user.is_deafened || media.is_some_and(|media| media.deafened),
                        camera: media.and_then(|media| media.camera.clone()),
                        screen_share: media.and_then(|media| media.screen_share.clone()),
                        quality: media.map(|media| media.quality).unwrap_or_default(),
                    }
                })
                .collect();
            participants.extend(
                seen.iter()
                    .filter(|media| !users.iter().any(|user| user.id == media.identity))
                    .cloned(),
            );
            voice.participants = participants;
            if let Some(media) = &state.media {
                voice.muted = media.muted;
                voice.deafened = media.deafened;
                voice.reconnect_attempt = media.reconnect_attempt;
                voice.error = media.error.clone();
            }
            voice
        })
    }
}
