//! [`Backend`] over the generated `semaphore-api` client.
//!
//! What lives here, and not in core: the tokens, their single-flight refresh, and their
//! persistence in a [`SecretStore`].
//!
//! - **Client identity.** The pinned contract lacks the client-type headers (README "Known
//!   gaps"), so every request carries `X-Client-Type: desktop-native`, an `X-Device-Id` and a
//!   `User-Agent` by hand. The backend (`backend/src/auth/client-type.util.ts`) answers a
//!   `desktop-native` sign-in or refresh with the refresh token in the body, and refuses one
//!   without the device id and user agent.
//! - **Authorization.** The generated client has no per-request hook, so the reqwest client
//!   behind it carries `Authorization` as a default header, and is rebuilt when the access token
//!   changes. That is at most once per refresh.
//! - **Refresh.** A 401 `UNAUTHENTICATED` on an authenticated call starts one refresh. Callers that
//!   fail meanwhile wait for it and share its result, then each retries once. A rejected refresh
//!   (401 or 403) ends the session here: tokens dropped, stored token deleted.
//! - **Secrets.** Tokens are wrapped in [`Token`], whose `Debug` is redacted, and never logged or
//!   put into an error. The login response core receives has its refresh token removed.

use std::fmt;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard};

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use semaphore_api::{ByteStream, Client, Error, ResponseValue, from_progenitor};
use semaphore_core::backend::{Backend, BackendError, BackendResult};
use semaphore_core::platform::SecretStore;
use semaphore_wire::enums::{ErrorCode, MessagePageDirection};
use semaphore_wire::types as wire;

use crate::http_client_with_headers;

/// What `X-Client-Type` says: a native desktop app, which the backend hands its refresh token in
/// the response body.
pub const CLIENT_TYPE: &str = "desktop-native";

const DEVICE_ID_KEY: &str = "device-id";

/// A token that cannot be printed.
#[derive(Clone, PartialEq)]
struct Token(String);

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

#[derive(Default)]
struct Session {
    server_url: Option<String>,
    /// For calls that carry no access token: login and refresh.
    anon: Option<Arc<Client>>,
    /// Carries the access token, when there is one.
    authed: Option<Arc<Client>>,
    access: Option<Token>,
    refresh: Option<Token>,
    /// Counts finished refreshes, so a caller that started before one can tell it ran.
    epoch: u64,
    last_refresh: Option<Result<Token, BackendError>>,
}

struct Inner {
    secrets: Arc<dyn SecretStore>,
    device_id: String,
    state: Mutex<Session>,
    /// Held across a refresh: callers queue here and share its result.
    refresh_gate: tokio::sync::Mutex<()>,
}

/// Cheap to clone: clones share one session.
#[derive(Clone)]
pub struct HttpBackend {
    inner: Arc<Inner>,
}

impl fmt::Debug for HttpBackend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let state = self.inner.lock();
        f.debug_struct("HttpBackend")
            .field("server_url", &state.server_url)
            .field("signed_in", &state.access.is_some())
            .finish_non_exhaustive()
    }
}

fn failure(message: &str) -> BackendError {
    BackendError {
        status: 0,
        code: ErrorCode::Unknown("UNKNOWN".into()),
        message: message.into(),
        retryable: false,
        retry_after_ms: None,
    }
}

async fn convert(error: Error<()>) -> BackendError {
    let error = from_progenitor(error).await;
    BackendError {
        status: error.status,
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        retry_after_ms: error.retry_after_ms,
    }
}

/// A 401 on an authenticated call: the access token ran out or was revoked. The backend gives
/// the same code for both, and a refresh tells them apart.
fn is_unauthenticated(error: &BackendError) -> bool {
    error.status == 401 && error.code.as_str() == "UNAUTHENTICATED"
}

/// The refresh endpoint refusing the session, as opposed to being unreachable.
fn is_rejection(error: &BackendError) -> bool {
    matches!(error.status, 401 | 403)
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, Session> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn base_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-client-type"),
            HeaderValue::from_static(CLIENT_TYPE),
        );
        if let Ok(value) = HeaderValue::from_str(&self.device_id) {
            headers.insert(HeaderName::from_static("x-device-id"), value);
        }
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(concat!("Semaphore-Native/", env!("CARGO_PKG_VERSION"))),
        );
        headers
    }

    fn build(&self, url: &str, access: Option<&Token>) -> Option<Arc<Client>> {
        let mut headers = self.base_headers();
        if let Some(Token(access)) = access {
            let mut value = HeaderValue::from_str(&format!("Bearer {access}")).ok()?;
            value.set_sensitive(true);
            headers.insert(AUTHORIZATION, value);
        }
        match http_client_with_headers(headers) {
            Ok(http) => Some(Arc::new(Client::new_with_client(url, http))),
            Err(error) => {
                log::error!("cannot build the HTTP client: {error}");
                None
            }
        }
    }

    /// Replaces the held tokens, and the client that carries the access token.
    fn set_tokens(&self, state: &mut Session, access: Token, refresh: Option<Token>) {
        if let Some(url) = state.server_url.clone() {
            state.authed = self.build(&url, Some(&access));
        }
        state.access = Some(access);
        if refresh.is_some() {
            state.refresh = refresh;
        }
    }

    fn secret_key(url: &str) -> String {
        format!("refresh-token:{}", url.trim_end_matches('/'))
    }

    fn persist(&self, url: Option<&str>, token: &Token) {
        let Some(url) = url else { return };
        if let Err(error) = self.secrets.save(Self::secret_key(url), token.0.clone()) {
            log::warn!("the refresh token was not stored, so it is lost on exit: {error}");
        }
    }

    /// Forgets the session, here and in the secret store.
    fn clear(&self, state: &mut Session) {
        state.access = None;
        state.refresh = None;
        state.authed = state.anon.clone();
        if let Some(url) = &state.server_url
            && let Err(error) = self.secrets.delete(Self::secret_key(url))
        {
            log::warn!("the stored refresh token was not deleted: {error}");
        }
    }

    /// The one refresh. Runs on its own task, so a caller that stops waiting cannot lose a
    /// rotated token between the server's answer and our saving it.
    async fn perform_refresh(
        self: Arc<Self>,
        explicit: Option<String>,
    ) -> Result<Token, BackendError> {
        let (anon, held, url) = {
            let state = self.lock();
            (
                state.anon.clone(),
                state.refresh.clone(),
                state.server_url.clone(),
            )
        };
        let result = match (anon, explicit.map(Token).or(held)) {
            (Some(anon), Some(Token(refresh))) => {
                let body = wire::RefreshRequestDto {
                    refresh_token: Some(refresh),
                };
                match anon.auth_controller_refresh(&body).await {
                    Ok(response) => Ok(response.into_inner()),
                    Err(error) => Err(convert(error).await),
                }
            }
            (None, _) => Err(failure("no server URL is set")),
            (_, None) => Err(failure("not signed in")),
        };
        let mut state = self.lock();
        state.epoch += 1;
        let outcome = match result {
            Ok(response) => {
                let access = Token(response.access_token);
                let refresh = response.refresh_token.map(Token);
                if let Some(refresh) = &refresh {
                    self.persist(url.as_deref(), refresh);
                }
                self.set_tokens(&mut state, access.clone(), refresh);
                Ok(access)
            }
            Err(error) => {
                if is_rejection(&error) {
                    self.clear(&mut state);
                }
                Err(error)
            }
        };
        state.last_refresh = Some(outcome.clone());
        outcome
    }
}

impl HttpBackend {
    /// `secrets` keeps the refresh token between runs, keyed per server URL, and this install's
    /// device id. A store that fails costs the session its persistence, not its function.
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        let device_id = match secrets.load(DEVICE_ID_KEY.into()) {
            Ok(Some(id)) if !id.is_empty() => id,
            other => {
                if let Err(error) = other {
                    log::warn!("cannot read the device id, using a new one: {error}");
                }
                let id = uuid::Uuid::new_v4().to_string();
                if let Err(error) = secrets.save(DEVICE_ID_KEY.into(), id.clone()) {
                    log::warn!("the device id was not stored: {error}");
                }
                id
            }
        };
        Self {
            inner: Arc::new(Inner {
                secrets,
                device_id,
                state: Mutex::new(Session::default()),
                refresh_gate: tokio::sync::Mutex::new(()),
            }),
        }
    }

    /// The server requests go to now.
    pub fn server_url(&self) -> Option<String> {
        self.inner.lock().server_url.clone()
    }

    /// The access token held now, for the socket's handshake.
    pub fn access_token(&self) -> Option<String> {
        self.inner
            .lock()
            .access
            .as_ref()
            .map(|token| token.0.clone())
    }

    /// Refreshes the session, or joins the refresh already running, and returns the new access
    /// token. What the socket's reauthentication calls.
    pub async fn refresh_access_token(&self) -> BackendResult<String> {
        let seen = self.inner.lock().epoch;
        self.refresh_shared(seen, None).await.map(|token| token.0)
    }

    /// Runs a refresh unless one finished since `seen`, whose result is then shared.
    async fn refresh_shared(
        &self,
        seen: u64,
        explicit: Option<String>,
    ) -> Result<Token, BackendError> {
        let _gate = self.inner.refresh_gate.lock().await;
        {
            let state = self.inner.lock();
            if state.epoch != seen
                && let Some(shared) = &state.last_refresh
            {
                return shared.clone();
            }
        }
        let inner = self.inner.clone();
        tokio::spawn(inner.perform_refresh(explicit))
            .await
            .unwrap_or_else(|_| Err(failure("the refresh was interrupted")))
    }

    fn snapshot(&self, authed: bool) -> BackendResult<(Arc<Client>, u64)> {
        let state = self.inner.lock();
        let client = if authed { &state.authed } else { &state.anon };
        client
            .clone()
            .map(|client| (client, state.epoch))
            .ok_or_else(|| failure("no server URL is set"))
    }

    /// An authenticated call, retried once after a refresh when the access token was refused.
    async fn call<T, F, Fut>(&self, call: F) -> BackendResult<ResponseValue<T>>
    where
        F: Fn(Arc<Client>) -> Fut,
        Fut: Future<Output = Result<ResponseValue<T>, Error<()>>>,
    {
        let mut retried = false;
        loop {
            let (client, epoch) = self.snapshot(true)?;
            let error = match call(client).await {
                Ok(value) => return Ok(value),
                Err(error) => convert(error).await,
            };
            let can_refresh = self.inner.lock().refresh.is_some();
            if retried || !is_unauthenticated(&error) || !can_refresh {
                return Err(error);
            }
            retried = true;
            self.refresh_shared(epoch, None).await?;
        }
    }

    /// A call that sends no access token.
    async fn call_anon<T, F, Fut>(&self, call: F) -> BackendResult<T>
    where
        F: FnOnce(Arc<Client>) -> Fut,
        Fut: Future<Output = Result<ResponseValue<T>, Error<()>>>,
    {
        let (client, _) = self.snapshot(false)?;
        match call(client).await {
            Ok(value) => Ok(value.into_inner()),
            Err(error) => Err(convert(error).await),
        }
    }
}

async fn bytes(stream: ByteStream) -> BackendResult<Vec<u8>> {
    let mut stream = stream.into_inner();
    let mut out = Vec::new();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(chunk) => out.extend_from_slice(&chunk),
            Err(error) => {
                return Err(BackendError {
                    status: 0,
                    code: ErrorCode::Unknown("UNKNOWN".into()),
                    message: error.to_string(),
                    retryable: true,
                    retry_after_ms: None,
                });
            }
        }
    }
    Ok(out)
}

/// One authenticated call. Arguments are borrowed from the method, so they are `Copy` references
/// and the closure can run twice.
macro_rules! rpc {
    ($self:ident, $c:ident => $call:expr) => {
        $self
            .call(|$c: Arc<Client>| async move { $call.await })
            .await
            .map(ResponseValue::into_inner)
    };
}

#[async_trait]
impl Backend for HttpBackend {
    fn set_server_url(&self, server_url: String) {
        let url = server_url.trim_end_matches('/').to_owned();
        let mut state = self.inner.lock();
        if state.server_url.as_deref() == Some(url.as_str()) {
            return;
        }
        // Tokens belong to one server.
        state.access = None;
        state.refresh = None;
        state.anon = self.inner.build(&url, None);
        state.authed = state.anon.clone();
        state.server_url = Some(url);
    }

    async fn auth_controller_login(
        &self,
        body: wire::LoginRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        let response = self
            .call_anon(|c| async move { c.auth_controller_login(&body).await })
            .await?;
        let access = Token(response.access_token);
        let refresh = response.refresh_token.map(Token);
        {
            let mut state = self.inner.lock();
            match &refresh {
                Some(refresh) => self.inner.persist(state.server_url.as_deref(), refresh),
                None => {
                    log::warn!("the server sent no refresh token; the session cannot be renewed")
                }
            }
            state.refresh = None;
            self.inner.set_tokens(&mut state, access.clone(), refresh);
        }
        Ok(wire::LoginResponseDto {
            access_token: access.0,
            refresh_token: None,
        })
    }

    async fn auth_controller_refresh(
        &self,
        body: wire::RefreshRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        let seen = self.inner.lock().epoch;
        let explicit = body.refresh_token.filter(|token| !token.is_empty());
        let access = self.refresh_shared(seen, explicit).await?;
        Ok(wire::LoginResponseDto {
            access_token: access.0,
            refresh_token: None,
        })
    }

    async fn auth_controller_logout(
        &self,
        body: wire::LogoutRequestDto,
    ) -> BackendResult<wire::LogoutResponseDto> {
        let held = self.inner.lock().refresh.clone();
        let body = wire::LogoutRequestDto {
            refresh_token: body
                .refresh_token
                .filter(|token| !token.is_empty())
                .or(held.map(|token| token.0)),
        };
        // One attempt, whatever it answers: the user asked to leave.
        let result = match self.snapshot(true) {
            Ok((client, _)) => match client.auth_controller_logout(&body).await {
                Ok(value) => Ok(value.into_inner()),
                Err(error) => Err(convert(error).await),
            },
            Err(error) => Err(error),
        };
        self.inner.clear(&mut self.inner.lock());
        result
    }

    async fn user_controller_get_profile(&self) -> BackendResult<wire::UserEntity> {
        rpc!(self, c => c.user_controller_get_profile())
    }

    async fn user_controller_get_user_by_id(&self, id: String) -> BackendResult<wire::UserEntity> {
        let id = id.as_str();
        rpc!(self, c => c.user_controller_get_user_by_id(id))
    }

    async fn community_controller_find_all_mine(
        &self,
    ) -> BackendResult<Vec<wire::CommunityResponseDto>> {
        rpc!(self, c => c.community_controller_find_all_mine())
    }

    async fn channels_controller_find_all_for_community(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.channels_controller_find_all_for_community(community_id))
    }

    async fn channel_permissions_controller_get_my_community_channel_permissions(
        &self,
        community_id: String,
    ) -> BackendResult<wire::CommunityChannelCapabilitiesDto> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.channel_permissions_controller_get_my_community_channel_permissions(community_id))
    }

    async fn read_receipts_controller_get_unread_counts(
        &self,
    ) -> BackendResult<Vec<wire::UnreadCountDto>> {
        rpc!(self, c => c.read_receipts_controller_get_unread_counts())
    }

    async fn messages_controller_find_all_for_channel(
        &self,
        channel_id: String,
        continuation_token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto> {
        let channel_id = channel_id.as_str();
        let token = continuation_token.as_deref();
        let direction = direction.as_ref();
        rpc!(self, c => c.messages_controller_find_all_for_channel(channel_id, token, direction, limit))
    }

    async fn messages_controller_find_around_for_channel(
        &self,
        channel_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto> {
        let channel_id = channel_id.as_str();
        let message_id = message_id.as_str();
        rpc!(self, c => c.messages_controller_find_around_for_channel(channel_id, message_id, limit))
    }

    async fn messages_controller_find_all_for_group(
        &self,
        group_id: String,
        continuation_token: Option<String>,
        direction: Option<MessagePageDirection>,
        limit: Option<i64>,
    ) -> BackendResult<wire::PaginatedMessagesResponseDto> {
        let group_id = group_id.as_str();
        let token = continuation_token.as_deref();
        let direction = direction.as_ref();
        rpc!(self, c => c.messages_controller_find_all_for_group(group_id, token, direction, limit))
    }

    async fn threads_controller_get_replies(
        &self,
        parent_message_id: String,
        continuation_token: Option<String>,
        limit: Option<i64>,
    ) -> BackendResult<wire::ThreadRepliesResponseDto> {
        let parent_message_id = parent_message_id.as_str();
        let token = continuation_token.as_deref();
        rpc!(self, c => c.threads_controller_get_replies(parent_message_id, token, limit))
    }

    async fn messages_controller_create(
        &self,
        body: wire::CreateMessageDto,
    ) -> BackendResult<wire::MessageDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_create(body))
    }

    async fn messages_controller_create_direct_message(
        &self,
        body: wire::CreateMessageDto,
    ) -> BackendResult<wire::MessageDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_create_direct_message(body))
    }

    async fn messages_controller_add_reaction(
        &self,
        body: wire::AddReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_add_reaction(body))
    }

    async fn messages_controller_remove_reaction(
        &self,
        body: wire::RemoveReactionDto,
    ) -> BackendResult<wire::MessageReactionsDto> {
        let body = &body;
        rpc!(self, c => c.messages_controller_remove_reaction(body))
    }

    async fn read_receipts_controller_mark_as_read(
        &self,
        body: wire::MarkAsReadDto,
    ) -> BackendResult<wire::ReadReceiptDto> {
        let body = &body;
        rpc!(self, c => c.read_receipts_controller_mark_as_read(body))
    }

    async fn membership_controller_search_community_members(
        &self,
        community_id: String,
        query: String,
        limit: Option<i64>,
    ) -> BackendResult<Vec<wire::MembershipResponseDto>> {
        let community_id = community_id.as_str();
        let query = query.as_str();
        rpc!(self, c => c.membership_controller_search_community_members(community_id, limit, query))
    }

    async fn channels_controller_get_mentionable_channels(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::ChannelDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.channels_controller_get_mentionable_channels(community_id))
    }

    async fn custom_emoji_controller_list_community_emojis(
        &self,
        community_id: String,
    ) -> BackendResult<Vec<wire::CustomEmojiDto>> {
        let community_id = community_id.as_str();
        rpc!(self, c => c.custom_emoji_controller_list_community_emojis(community_id))
    }

    async fn livekit_controller_get_connection_info(
        &self,
    ) -> BackendResult<wire::ConnectionInfoResponseDto> {
        rpc!(self, c => c.livekit_controller_get_connection_info())
    }

    async fn livekit_controller_generate_token(
        &self,
        body: wire::CreateTokenDto,
    ) -> BackendResult<wire::TokenResponseDto> {
        let body = &body;
        rpc!(self, c => c.livekit_controller_generate_token(body))
    }

    async fn voice_presence_controller_get_channel_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::ChannelVoicePresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_get_channel_presence(channel_id))
    }

    async fn voice_presence_controller_join_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_join_presence(channel_id))
    }

    async fn voice_presence_controller_refresh_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_refresh_presence(channel_id))
    }

    async fn voice_presence_controller_leave_presence(
        &self,
        channel_id: String,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        rpc!(self, c => c.voice_presence_controller_leave_presence(channel_id))
    }

    async fn voice_presence_controller_update_deafen_state(
        &self,
        channel_id: String,
        body: wire::UpdateDeafenStateDto,
    ) -> BackendResult<wire::RefreshPresenceResponseDto> {
        let channel_id = channel_id.as_str();
        let body = &body;
        rpc!(self, c => c.voice_presence_controller_update_deafen_state(channel_id, body))
    }

    async fn file_controller_get_file(&self, id: String) -> BackendResult<Vec<u8>> {
        let id = id.as_str();
        bytes(rpc!(self, c => c.file_controller_get_file(id))?).await
    }

    async fn file_controller_get_file_thumbnail(&self, id: String) -> BackendResult<Vec<u8>> {
        let id = id.as_str();
        bytes(rpc!(self, c => c.file_controller_get_file_thumbnail(id))?).await
    }
}
