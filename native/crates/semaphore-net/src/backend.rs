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
//! - **Sessions.** A signed-in session has a generation, which sign-out, a server change and a new
//!   login each move on. Anything that started under an older generation (a refresh, a login, a
//!   call about to retry) drops its result and gets an error: it never touches the tokens or the
//!   store, so one server's token can't reach another and a sign-out can't be undone.
//! - **Secrets.** Tokens are wrapped in [`Token`], whose `Debug` is redacted, and never logged or
//!   put into an error. The login response core receives has its refresh token removed.
//! - **The store.** A keyring can block on D-Bus or sit at an unlock prompt, so it is only ever
//!   touched on its own thread. Writes are queued in the same critical section that changes the
//!   session, so they reach the store in the order the session changed: a sign-out can't lose a
//!   race to a save. Callers wait [`Timeouts::store_wait`] for their write at most, and it stays
//!   queued after that.

use std::fmt;
use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard, mpsc};

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::header::{AUTHORIZATION, HeaderMap, HeaderName, HeaderValue, USER_AGENT};
use semaphore_api::{ByteStream, Client, Error, ResponseValue, from_progenitor};
use semaphore_core::backend::{Backend, BackendError, BackendResult};
use semaphore_core::platform::SecretStore;
use semaphore_wire::enums::{ErrorCode, MessagePageDirection};
use semaphore_wire::types as wire;
use tokio::sync::oneshot;
use tokio::time::timeout;

use crate::{Timeouts, http_client_with_timeouts};

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
    /// Moves on at a sign-out, a server change and a new login. What started under an older one
    /// has lost its session, and drops its result.
    generation: u64,
    /// Counts finished refreshes, so a caller that started before one can tell it ran.
    epoch: u64,
    last_refresh: Option<Result<Token, BackendError>>,
}

/// Where a caller stood when it started.
#[derive(Clone, Copy)]
struct Seen {
    generation: u64,
    epoch: u64,
}

impl Session {
    fn seen(&self) -> Seen {
        Seen {
            generation: self.generation,
            epoch: self.epoch,
        }
    }

    /// Everything from here on belongs to a new session.
    fn next_generation(&mut self) {
        self.generation += 1;
        self.last_refresh = None;
    }
}

enum StoreOp {
    Save {
        key: String,
        value: String,
    },
    Delete {
        key: String,
    },
    /// Writes nothing: answers once everything queued before it has been written.
    Flush(mpsc::Sender<()>),
}

/// What the store thread reads before anything else, for [`HttpBackend::new`].
struct Startup {
    device_id: String,
    /// The refresh token stored for the server asked about, if there is one.
    stored: Option<Token>,
}

struct StoreJob {
    op: StoreOp,
    done: oneshot::Sender<()>,
}

/// Resolves when a queued store write has finished.
type Stored = Option<oneshot::Receiver<()>>;

/// The one thread that touches the store. Reads the device id first, and the refresh token stored
/// for `server`, for [`HttpBackend::new`].
fn run_store(
    secrets: Arc<dyn SecretStore>,
    server: Option<String>,
    startup: mpsc::Sender<Startup>,
    jobs: mpsc::Receiver<StoreJob>,
) {
    let device_id = load_device_id(secrets.as_ref());
    let stored = server.and_then(|url| match secrets.load(secret_key(&url)) {
        Ok(token) => token.filter(|token| !token.is_empty()).map(Token),
        Err(error) => {
            log::warn!("cannot read the stored session, so this start signs in again: {error}");
            None
        }
    });
    let _ = startup.send(Startup { device_id, stored });
    while let Ok(StoreJob { op, done }) = jobs.recv() {
        match op {
            StoreOp::Flush(flushed) => {
                let _ = flushed.send(());
            }
            StoreOp::Save { key, value } => {
                if let Err(error) = secrets.save(key, value) {
                    log::warn!("the refresh token was not stored, so it is lost on exit: {error}");
                }
            }
            StoreOp::Delete { key } => {
                if let Err(error) = secrets.delete(key) {
                    log::warn!("the stored refresh token was not deleted: {error}");
                }
            }
        }
        let _ = done.send(());
    }
}

fn load_device_id(secrets: &dyn SecretStore) -> String {
    match secrets.load(DEVICE_ID_KEY.into()) {
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
    }
}

struct Inner {
    store: mpsc::Sender<StoreJob>,
    device_id: String,
    timeouts: Timeouts,
    state: Mutex<Session>,
    /// The session stored at the last run: its server and refresh token, until `set_server_url`
    /// takes it up for that server.
    stored: Mutex<Option<(String, Token)>>,
    /// Held across a refresh or a sign-out: callers queue here and share a refresh's result. It
    /// is owned, so the task doing the work holds it, and a caller that stops waiting can't open
    /// it while a token is still being rotated.
    refresh_gate: Arc<tokio::sync::Mutex<()>>,
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

/// The session this call belonged to ended while it ran.
fn session_changed() -> BackendError {
    failure("the session changed while this call was running")
}

/// Took longer than anyone should wait, which says nothing about the session.
fn timed_out(message: &str) -> BackendError {
    BackendError {
        retryable: true,
        ..failure(message)
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

fn secret_key(url: &str) -> String {
    format!("refresh-token:{}", url.trim_end_matches('/'))
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
        match http_client_with_timeouts(headers, self.timeouts) {
            Ok(http) => Some(Arc::new(Client::new_with_client(url, http))),
            Err(error) => {
                log::error!("cannot build the HTTP client: {error}");
                None
            }
        }
    }

    /// Queues a write. Never blocks, so it is safe under the session lock, and it should be called
    /// there: that is what keeps writes in the order the session changed.
    fn store(&self, op: StoreOp) -> Stored {
        let (done, finished) = oneshot::channel();
        match self.store.send(StoreJob { op, done }) {
            Ok(()) => Some(finished),
            Err(_) => {
                log::warn!("the secret store's thread has stopped, so this write is lost");
                None
            }
        }
    }

    /// Waits for a queued write, for as long as is reasonable to keep a caller waiting.
    async fn stored(&self, stored: Stored) {
        let Some(finished) = stored else { return };
        if timeout(self.timeouts.store_wait, finished).await.is_err() {
            log::warn!("the secret store is locked or slow; its write stays queued");
        }
    }

    /// Forgets the tokens, here and in the secret store.
    fn forget_tokens(&self, state: &mut Session) -> Stored {
        state.access = None;
        state.refresh = None;
        state.authed = state.anon.clone();
        let key = secret_key(state.server_url.as_deref()?);
        self.store(StoreOp::Delete { key })
    }

    /// One refresh, on behalf of `generation`. The caller holds the gate, and is a task of its
    /// own, so a caller that stops waiting cannot lose a rotated token between the server's answer
    /// and our keeping it.
    async fn perform_refresh(
        &self,
        generation: u64,
        explicit: Option<String>,
    ) -> (Result<Token, BackendError>, Stored) {
        let (anon, held, url) = {
            let state = self.lock();
            if state.generation != generation {
                return (Err(session_changed()), None);
            }
            (
                state.anon.clone(),
                state.refresh.clone(),
                state.server_url.clone(),
            )
        };
        let exchange = async {
            match (anon, explicit.map(Token).or(held)) {
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
            }
        };
        let result = match timeout(self.timeouts.refresh_total, exchange).await {
            Ok(result) => result,
            Err(_) => Err(timed_out("the token refresh took too long")),
        };
        let authed = match (&result, &url) {
            (Ok(response), Some(url)) => {
                self.build(url, Some(&Token(response.access_token.clone())))
            }
            _ => None,
        };

        let mut state = self.lock();
        if state.generation != generation {
            log::info!("dropping a refresh from a session that has ended");
            return (Err(session_changed()), None);
        }
        state.epoch += 1;
        let (outcome, stored) = match result {
            Ok(response) => {
                let access = Token(response.access_token);
                state.authed = authed;
                state.access = Some(access.clone());
                let stored = match response.refresh_token.map(Token) {
                    Some(refresh) => {
                        let stored = url.as_deref().and_then(|url| {
                            self.store(StoreOp::Save {
                                key: secret_key(url),
                                value: refresh.0.clone(),
                            })
                        });
                        state.refresh = Some(refresh);
                        stored
                    }
                    None => None,
                };
                (Ok(access), stored)
            }
            // The session died by itself, so this is no new generation: a login in flight still
            // counts, and callers queued behind this refresh share the refusal below.
            Err(error) => {
                let stored = if is_rejection(&error) {
                    self.forget_tokens(&mut state)
                } else {
                    None
                };
                (Err(error), stored)
            }
        };
        state.last_refresh = Some(outcome.clone());
        (outcome, stored)
    }

    /// Asks the server to end the session. `POST /auth/logout` is not `@Public()`, so the global
    /// `JwtAuthGuard` refuses a stale access token before the handler can revoke anything, which
    /// is why a refused attempt refreshes and goes again, with the rotated token.
    async fn revoke(
        &self,
        generation: u64,
        explicit: Option<String>,
    ) -> BackendResult<wire::LogoutResponseDto> {
        let (client, held) = {
            let state = self.lock();
            (state.authed.clone(), state.refresh.clone())
        };
        let client = client.ok_or_else(|| failure("no server URL is set"))?;
        let can_refresh = held.is_some();
        let presented = explicit.or(held.map(|token| token.0));
        match send_logout(&client, presented).await {
            Err(error) if is_unauthenticated(&error) && can_refresh => {}
            other => return other,
        }
        // Its save, if any, is queued ahead of the delete that follows.
        let (refreshed, _) = self.perform_refresh(generation, None).await;
        refreshed?;
        let (client, held) = {
            let state = self.lock();
            if state.generation != generation {
                return Err(session_changed());
            }
            (state.authed.clone(), state.refresh.clone())
        };
        let client = client.ok_or_else(|| failure("no server URL is set"))?;
        send_logout(&client, held.map(|token| token.0)).await
    }

    /// Runs on its own task, so a caller that stops waiting can't leave the session half ended.
    async fn logout(
        self: Arc<Self>,
        explicit: Option<String>,
    ) -> BackendResult<wire::LogoutResponseDto> {
        // A refresh in flight finishes first: the token it brings is the one to revoke. Holding
        // the gate from here on means no other refresh starts.
        let gate = self.refresh_gate.clone().lock_owned().await;
        let (generation, url) = {
            let state = self.lock();
            (state.generation, state.server_url.clone())
        };
        // One go, whatever it answers: the user asked to leave.
        let revoked = timeout(
            self.timeouts.refresh_total,
            self.revoke(generation, explicit),
        );
        let result = match revoked.await {
            Ok(result) => result,
            Err(_) => Err(timed_out("the server took too long to sign out")),
        };
        let stored = {
            let mut state = self.lock();
            if state.generation == generation {
                state.next_generation();
                self.forget_tokens(&mut state)
            } else if state.server_url != url {
                // The user moved on to another server meanwhile. That session isn't this one to
                // end, but what's stored for the server being left still goes.
                url.as_deref().and_then(|url| {
                    self.store(StoreOp::Delete {
                        key: secret_key(url),
                    })
                })
            } else {
                // A new login on this server meanwhile: the store and the session are its own.
                None
            }
        };
        drop(gate);
        self.stored(stored).await;
        result
    }
}

async fn send_logout(
    client: &Client,
    refresh_token: Option<String>,
) -> BackendResult<wire::LogoutResponseDto> {
    let body = wire::LogoutRequestDto { refresh_token };
    match client.auth_controller_logout(&body).await {
        Ok(value) => Ok(value.into_inner()),
        Err(error) => Err(convert(error).await),
    }
}

impl HttpBackend {
    /// `secrets` keeps the refresh token between runs, keyed per server URL, and this install's
    /// device id. A store that fails costs the session its persistence, not its function.
    ///
    /// **Blocks until the store has read the device id**, which on a locked keyring means until
    /// its unlock prompt is answered. Don't call this on the UI thread: build the backend during
    /// startup, before the window opens, or on a thread of its own. After this returns, nothing
    /// here waits on the store except for a bounded time ([`Timeouts::store_wait`]).
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        Self::with_timeouts(secrets, Timeouts::default())
    }

    /// [`new`](Self::new), and also reads the refresh token stored for `server`, in the same wait,
    /// so a later `set_server_url(server)` resumes that session: `Backend::has_stored_session`
    /// says so, and the first refresh uses it. The server is the app's to remember; it isn't a
    /// secret.
    pub fn restoring(secrets: Arc<dyn SecretStore>, server: Option<String>) -> Self {
        Self::build(secrets, Timeouts::default(), server)
    }

    /// [`new`](Self::new) with other limits. It blocks the same way.
    pub fn with_timeouts(secrets: Arc<dyn SecretStore>, timeouts: Timeouts) -> Self {
        Self::build(secrets, timeouts, None)
    }

    fn build(secrets: Arc<dyn SecretStore>, timeouts: Timeouts, server: Option<String>) -> Self {
        let server = server.map(|url| url.trim_end_matches('/').to_owned());
        let (store, jobs) = mpsc::channel();
        let (startup_sender, startup) = mpsc::channel();
        let asked = server.clone();
        // A thread rather than the runtime's blocking pool: a store stuck at a prompt must not
        // hold up the runtime shutting down, and this runs before a runtime need exist.
        std::thread::Builder::new()
            .name("semaphore-secrets".into())
            .spawn(move || run_store(secrets, asked, startup_sender, jobs))
            .expect("the OS starts a thread for the secret store");
        let Startup { device_id, stored } = startup.recv().unwrap_or_else(|_| Startup {
            device_id: uuid::Uuid::new_v4().to_string(),
            stored: None,
        });
        Self {
            inner: Arc::new(Inner {
                store,
                device_id,
                timeouts,
                state: Mutex::new(Session::default()),
                stored: Mutex::new(server.zip(stored)),
                refresh_gate: Arc::new(tokio::sync::Mutex::new(())),
            }),
        }
    }

    /// Waits until every write queued so far has reached the secret store, or `limit` passes, and
    /// says which. For shutdown: a refresh token rotated just before exit and not yet written would
    /// be lost, and the next start would present the old one, which the server's reuse detection
    /// treats as theft. Blocks, so not on a Tokio worker.
    pub fn flush(&self, limit: std::time::Duration) -> bool {
        let (flushed, done) = mpsc::channel();
        let (sender, _) = oneshot::channel();
        if self
            .inner
            .store
            .send(StoreJob {
                op: StoreOp::Flush(flushed),
                done: sender,
            })
            .is_err()
        {
            return true;
        }
        done.recv_timeout(limit).is_ok()
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
        let seen = self.inner.lock().seen();
        self.refresh_shared(seen, None).await.map(|token| token.0)
    }

    /// Runs a refresh unless one finished since `seen`, whose result is then shared. An error if
    /// the session it was for has ended, rather than a token from whatever replaced it.
    async fn refresh_shared(
        &self,
        seen: Seen,
        explicit: Option<String>,
    ) -> Result<Token, BackendError> {
        let gate = self.inner.refresh_gate.clone().lock_owned().await;
        {
            let state = self.inner.lock();
            if state.generation != seen.generation {
                return Err(session_changed());
            }
            if state.epoch != seen.epoch
                && let Some(shared) = &state.last_refresh
            {
                return shared.clone();
            }
        }
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let (outcome, stored) = inner.perform_refresh(seen.generation, explicit).await;
            // Callers queued here have what they need, whatever the store is doing.
            drop(gate);
            inner.stored(stored).await;
            outcome
        })
        .await
        .unwrap_or_else(|_| Err(failure("the refresh was interrupted")))
    }

    fn snapshot(&self) -> BackendResult<(Arc<Client>, Seen)> {
        let state = self.inner.lock();
        state
            .authed
            .clone()
            .map(|client| (client, state.seen()))
            .ok_or_else(|| failure("no server URL is set"))
    }

    /// An authenticated call, retried once after a refresh when the access token was refused.
    async fn call<T, F, Fut>(&self, call: F) -> BackendResult<ResponseValue<T>>
    where
        F: Fn(Arc<Client>) -> Fut,
        Fut: Future<Output = Result<ResponseValue<T>, Error<()>>>,
    {
        let (client, seen) = self.snapshot()?;
        let error = match call(client).await {
            Ok(value) => return Ok(value),
            Err(error) => convert(error).await,
        };
        if !is_unauthenticated(&error) {
            return Err(error);
        }
        {
            let state = self.inner.lock();
            // A refusal from before a sign-out or a server change says nothing about the session
            // there is now, and this call must not go on to its server.
            if state.generation != seen.generation {
                return Err(session_changed());
            }
            if state.refresh.is_none() {
                return Err(error);
            }
        }
        self.refresh_shared(seen, None).await?;
        let (client, now) = self.snapshot()?;
        if now.generation != seen.generation {
            return Err(session_changed());
        }
        match call(client).await {
            Ok(value) => Ok(value),
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
        if self.inner.lock().server_url.as_deref() == Some(url.as_str()) {
            return;
        }
        let anon = self.inner.build(&url, None);
        let mut state = self.inner.lock();
        if state.server_url.as_deref() == Some(url.as_str()) {
            return;
        }
        // Tokens belong to one server. Its stored refresh token stays, under its own key.
        state.next_generation();
        state.access = None;
        // The session stored at the last run, if it was this server's.
        state.refresh = {
            let mut stored = self
                .inner
                .stored
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match stored.take() {
                Some((stored_url, token)) if stored_url == url => Some(token),
                other => {
                    *stored = other;
                    None
                }
            }
        };
        state.authed = anon.clone();
        state.anon = anon;
        state.server_url = Some(url);
    }

    fn has_stored_session(&self) -> bool {
        self.inner.lock().refresh.is_some()
    }

    async fn auth_controller_login(
        &self,
        body: wire::LoginRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        let (client, url, generation) = {
            let state = self.inner.lock();
            let client = state
                .anon
                .clone()
                .ok_or_else(|| failure("no server URL is set"))?;
            (client, state.server_url.clone(), state.generation)
        };
        let response = match client.auth_controller_login(&body).await {
            Ok(response) => response.into_inner(),
            Err(error) => return Err(convert(error).await),
        };
        let access = Token(response.access_token);
        let refresh = response.refresh_token.map(Token);
        let authed = url
            .as_deref()
            .and_then(|url| self.inner.build(url, Some(&access)));
        let stored = {
            let mut state = self.inner.lock();
            // Signed out or moved to another server while this ran: it answers for nothing now.
            if state.generation != generation {
                return Err(session_changed());
            }
            // A refresh of the session before this one must not overwrite it.
            state.next_generation();
            state.authed = authed;
            state.access = Some(access.clone());
            let op = url.as_deref().map(|url| {
                let key = secret_key(url);
                match &refresh {
                    Some(refresh) => StoreOp::Save {
                        key,
                        value: refresh.0.clone(),
                    },
                    // What's stored belongs to a session this client no longer holds.
                    None => {
                        log::warn!(
                            "the server sent no refresh token; the session cannot be renewed"
                        );
                        StoreOp::Delete { key }
                    }
                }
            });
            state.refresh = refresh;
            op.and_then(|op| self.inner.store(op))
        };
        self.inner.stored(stored).await;
        Ok(wire::LoginResponseDto {
            access_token: access.0,
            refresh_token: None,
        })
    }

    async fn auth_controller_refresh(
        &self,
        body: wire::RefreshRequestDto,
    ) -> BackendResult<wire::LoginResponseDto> {
        let seen = self.inner.lock().seen();
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
        let explicit = body.refresh_token.filter(|token| !token.is_empty());
        tokio::spawn(self.inner.clone().logout(explicit))
            .await
            .unwrap_or_else(|_| Err(failure("the sign-out was interrupted")))
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

    async fn messages_controller_find_around_for_group(
        &self,
        group_id: String,
        message_id: String,
        limit: Option<i64>,
    ) -> BackendResult<wire::AnchoredMessagesResponseDto> {
        let group_id = group_id.as_str();
        let message_id = message_id.as_str();
        rpc!(self, c => c.messages_controller_find_around_for_group(group_id, message_id, limit))
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

    async fn membership_controller_find_all_for_community(
        &self,
        community_id: String,
        limit: Option<i64>,
        continuation_token: Option<String>,
    ) -> BackendResult<wire::PaginatedMembershipsResponseDto> {
        let community_id = community_id.as_str();
        let token = continuation_token.as_deref();
        rpc!(self, c => c.membership_controller_find_all_for_community(community_id, token, limit))
    }

    async fn presence_controller_get_bulk_presence(
        &self,
    ) -> BackendResult<wire::BulkPresenceResponseDto> {
        rpc!(self, c => c.presence_controller_get_bulk_presence())
    }

    async fn notifications_controller_get_unread_count(
        &self,
    ) -> BackendResult<wire::UnreadCountResponseDto> {
        rpc!(self, c => c.notifications_controller_get_unread_count())
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

    /// Public, so it goes out without a token: it's how a server is tested before signing in.
    async fn instance_controller_get_public_settings(
        &self,
    ) -> BackendResult<wire::PublicSettingsResponseDto> {
        let client = self
            .inner
            .lock()
            .anon
            .clone()
            .ok_or_else(|| failure("no server URL is set"))?;
        match client.instance_controller_get_public_settings().await {
            Ok(response) => Ok(response.into_inner()),
            Err(error) => Err(convert(error).await),
        }
    }
}
