//! `Core`: the facade a UI or binding layer holds, and the one place state changes.
//!
//! **Single writer.** Every change runs through [`Core::write`], under one lock, and no lock is
//! held across an `await` or while calling out. A change leaves events in an outbox. One caller at
//! a time delivers them, in order, outside the lock, so a sink can call straight back into core
//! and still sees events in the order state changed.
//!
//! **Coalescing.** Changes made in one `write` become one set of events: list changes as the
//! smallest ops between what the UI has and what's there now, views once each.
//!
//! **Background work.** A command can't wait on what an event sets off, and core owns no runtime,
//! so work queues up as [`Effect`]s for [`Core::drive`], which a host runs on its own executor.

use crate::backend::Backend;
use crate::cache::{QueryCache, QueryKey, keys};
use crate::lifecycle::{ConnectionState, NetworkState, ResyncPlan};
use crate::model::{
    Conversation, ErrorView, SessionState, SignOutReason, UserView, ViewKey, VoiceView,
};
use crate::platform::{Clock, CoreEvent, EventSink, MediaEngine};
use crate::realtime::Realtime;
use crate::send::PendingSend;
use crate::store::{Window, project};
use std::collections::{HashMap, VecDeque};
use std::future::{Future, poll_fn};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Poll, Waker};

/// The server sends `tokenExpiring` this long before expiry. While suspended we can miss
/// that event, so on the way back we compare against the wall clock using the same margin.
pub(crate) const TOKEN_REFRESH_MARGIN_MS: u64 = 120_000;

/// Conversations kept loaded, besides those on screen, held or still sending.
const KEPT_WINDOWS: usize = 8;

/// What a working core talks to. Without these, commands fail with `CoreError::Unavailable`.
#[derive(Clone)]
pub struct Services {
    pub backend: Arc<dyn Backend>,
    pub realtime: Arc<dyn Realtime>,
    /// Voice is optional: without it, `join_voice` is unavailable.
    pub media: Option<Arc<dyn MediaEngine>>,
}

/// Background work for [`Core::drive`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Effect {
    FetchQuery(QueryKey),
    ResyncWindow(Conversation),
    ResetWindow(Conversation),
    Send(String),
    RefreshToken,
    /// The media engine ended the call, so the server should hear this client has left it.
    LeavePresence(String),
    /// The session ended under a live call: the engine leaves the room. No presence call, because
    /// the session that would make it is gone.
    EndCall,
}

pub(crate) struct State {
    pub cache: QueryCache,
    /// True while a fetch for this key runs and the answer is already out of date.
    pub fetching: HashMap<QueryKey, bool>,
    /// Queries whose last fetch failed. Not fetched again until a retry or a new connection, so a UI
    /// that reads on every frame can't turn one failure into a stream of requests.
    pub failed_queries: HashMap<QueryKey, ErrorView>,
    /// Why the last session ended. Cleared by the next sign-in.
    pub sign_out_reason: Option<SignOutReason>,
    pub windows: HashMap<Conversation, Window>,
    pub main_conversation: Option<Conversation>,
    pub thread_conversation: Option<Conversation>,
    pub use_counter: u64,
    pub focused: bool,
    pub sends: HashMap<String, PendingSend>,
    pub typing: HashMap<Conversation, Vec<(String, u64)>>,
    /// Unread mention notifications, so one being read can take its count back off.
    pub mention_notifications: HashMap<String, Conversation>,
    pub session: SessionState,
    pub me: Option<UserView>,
    pub voice: VoiceView,
    /// What the media engine last reported about the call in `voice`.
    pub media: Option<VoiceView>,
    /// The number of the last `join_voice`: reports carrying another are from some other call.
    pub call: u64,
    /// The engine said this call ended before `join_voice` had finished, with why.
    pub call_ended_early: Option<Option<String>>,
    pub connection: ConnectionState,
    pub network: NetworkState,
    /// A connection has been up, so the next one follows a gap: the web's `hasConnectedRef`.
    pub had_connection: bool,
    pub token_expires_at_ms: Option<u64>,
    pub effects: VecDeque<Effect>,
    pub driver: Option<Waker>,
    pub shutdown: bool,
    invalidated: Vec<QueryKey>,
    views: Vec<ViewKey>,
    outbox: Vec<CoreEvent>,
    delivering: bool,
    has_services: bool,
}

impl State {
    fn new(has_services: bool) -> Self {
        Self {
            cache: QueryCache::default(),
            fetching: HashMap::new(),
            failed_queries: HashMap::new(),
            sign_out_reason: None,
            windows: HashMap::new(),
            main_conversation: None,
            thread_conversation: None,
            use_counter: 0,
            focused: true,
            sends: HashMap::new(),
            typing: HashMap::new(),
            mention_notifications: HashMap::new(),
            session: SessionState::SignedOut,
            me: None,
            voice: VoiceView::default(),
            media: None,
            call: 0,
            call_ended_early: None,
            connection: ConnectionState::Disconnected,
            network: NetworkState::Available,
            had_connection: false,
            token_expires_at_ms: None,
            effects: VecDeque::new(),
            driver: None,
            shutdown: false,
            invalidated: Vec::new(),
            views: Vec::new(),
            outbox: Vec::new(),
            delivering: false,
            has_services,
        }
    }

    pub fn me_id(&self) -> &str {
        self.me.as_ref().map_or("", |me| me.id.as_str())
    }

    pub fn set_connection(&mut self, connection: ConnectionState) {
        if self.connection != connection {
            self.connection = connection;
            self.outbox
                .push(CoreEvent::ConnectionChanged { state: connection });
        }
    }

    pub fn view_changed(&mut self, view: ViewKey) {
        if !self.views.contains(&view) {
            self.views.push(view);
        }
    }

    pub fn note_invalidated(&mut self, keys: Vec<QueryKey>) {
        for key in keys {
            if !self.invalidated.contains(&key) {
                self.invalidated.push(key);
            }
        }
    }

    pub fn push_effect(&mut self, effect: Effect) {
        if !self.effects.contains(&effect) {
            self.effects.push_back(effect);
        }
    }

    /// Fetches a query that's missing or stale, unless a fetch is already running. A read asks for
    /// what it needs, as `useQuery` does on mount.
    pub fn ensure_query(&mut self, key: QueryKey) {
        if !self.has_services || self.me.is_none() {
            return;
        }
        let fresh = self.cache.get(&key).is_some_and(|entry| !entry.stale);
        if !fresh && !self.fetching.contains_key(&key) && !self.failed_queries.contains_key(&key) {
            self.fetching.insert(key.clone(), false);
            self.push_effect(Effect::FetchQuery(key));
        }
    }

    /// Marks matching queries and windows stale and refetches those in use. Keeps the data, so a
    /// UI can show it meanwhile.
    pub fn invalidate(&mut self, prefix: &QueryKey) -> Vec<QueryKey> {
        let mut marked = self.cache.invalidate_prefix(prefix);
        for key in &marked {
            match self.fetching.get_mut(key) {
                Some(dirty) => *dirty = true,
                None if self.has_services && self.me.is_some() => {
                    self.fetching.insert(key.clone(), false);
                    self.effects.push_back(Effect::FetchQuery(key.clone()));
                }
                None => {}
            }
        }
        let conversations: Vec<Conversation> = self
            .windows
            .keys()
            .filter(|conversation| window_key(conversation).starts_with(prefix))
            .cloned()
            .collect();
        for conversation in conversations {
            marked.push(window_key(&conversation));
            self.mark_window_stale(&conversation);
        }
        self.note_invalidated(marked.clone());
        marked
    }

    /// A direct update to a query being fetched: the answer on its way is already old.
    pub fn note_direct_update(&mut self, key: &QueryKey) {
        if let Some(dirty) = self.fetching.get_mut(key) {
            *dirty = true;
        }
    }

    pub fn is_on_screen(&self, conversation: &Conversation) -> bool {
        self.main_conversation.as_ref() == Some(conversation)
            || self.thread_conversation.as_ref() == Some(conversation)
    }

    /// Forgets the conversations least recently used that nothing depends on.
    pub fn trim_windows(&mut self) {
        let mut idle: Vec<(u64, Conversation)> = self
            .windows
            .iter()
            .filter(|(conversation, window)| {
                !self.is_on_screen(conversation)
                    && !window.is_held()
                    && !window.has_unsettled_rows()
            })
            .map(|(conversation, window)| (window.last_used, conversation.clone()))
            .collect();
        if idle.len() <= KEPT_WINDOWS {
            return;
        }
        idle.sort_by_key(|(used, _)| *used);
        let excess = idle.len() - KEPT_WINDOWS;
        for (_, conversation) in idle.into_iter().take(excess) {
            self.windows.remove(&conversation);
        }
    }

    /// Turns what this change did into events.
    fn collect_events(&mut self) {
        if !self.invalidated.is_empty() {
            self.outbox.push(CoreEvent::QueriesInvalidated {
                keys: std::mem::take(&mut self.invalidated),
            });
        }
        for view in std::mem::take(&mut self.views) {
            self.outbox.push(CoreEvent::ViewChanged { view });
        }

        let me_id = self.me_id().to_owned();
        let me = self.me.clone();
        let mut missing_authors = Vec::new();
        let cache = &self.cache;
        let mut author = |id: &str| -> Option<UserView> {
            if id == me_id {
                return me.clone();
            }
            let view = cache.user(&keys::scoped(keys::USER, id)).map(user_view);
            if view.is_none() {
                missing_authors.push(id.to_owned());
            }
            view
        };
        let mut changes = Vec::new();
        for (conversation, window) in &mut self.windows {
            let ops = window.take_ops(|row| project(row, &me_id, &mut author));
            if !ops.is_empty() {
                changes.push(CoreEvent::MessagesChanged {
                    conversation: conversation.clone(),
                    ops,
                });
            }
        }
        // More than one conversation can change in a batch. Order them the same way every time.
        changes.sort_by(|a, b| match (a, b) {
            (
                CoreEvent::MessagesChanged {
                    conversation: a, ..
                },
                CoreEvent::MessagesChanged {
                    conversation: b, ..
                },
            ) => a.cmp(b),
            _ => std::cmp::Ordering::Equal,
        });
        self.outbox.append(&mut changes);
        for id in missing_authors {
            self.ensure_query(keys::scoped(keys::USER, &id));
        }
    }
}

/// The query key a window answers to.
pub(crate) fn window_key(conversation: &Conversation) -> QueryKey {
    match conversation {
        Conversation::Channel { id } => keys::scoped(keys::CHANNEL_MESSAGES, id),
        Conversation::DirectMessage { id } => keys::scoped(keys::DM_MESSAGES, id),
        Conversation::Thread { parent_message_id } => {
            keys::scoped(keys::THREAD_REPLIES, parent_message_id)
        }
    }
}

pub(crate) fn user_view(user: &semaphore_wire::types::UserEntity) -> UserView {
    UserView {
        id: user.id.clone(),
        username: user.username.clone(),
        display_name: user.display_name.clone(),
        avatar_file_id: user.avatar_url.clone(),
    }
}

struct Inner {
    state: Mutex<State>,
    clock: Arc<dyn Clock>,
    events: Arc<dyn EventSink>,
    services: Option<Services>,
}

/// Cheap to clone: clones share one core.
#[derive(Clone)]
pub struct Core {
    inner: Arc<Inner>,
}

type Task = Pin<Box<dyn Future<Output = ()> + Send>>;

impl Core {
    /// A core with nothing to talk to: state and lifecycle only. Stories use this.
    pub fn new(clock: Arc<dyn Clock>, events: Arc<dyn EventSink>) -> Self {
        Self::build(clock, events, None)
    }

    pub fn with_services(
        clock: Arc<dyn Clock>,
        events: Arc<dyn EventSink>,
        services: Services,
    ) -> Self {
        Self::build(clock, events, Some(services))
    }

    fn build(
        clock: Arc<dyn Clock>,
        events: Arc<dyn EventSink>,
        services: Option<Services>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State::new(services.is_some())),
                clock,
                events,
                services,
            }),
        }
    }

    pub(crate) fn services(&self) -> Option<&Services> {
        self.inner.services.as_ref()
    }

    pub(crate) fn now_ms(&self) -> u64 {
        self.inner.clock.now_ms()
    }

    /// The only way state changes. See the module docs.
    pub(crate) fn write<R>(&self, change: impl FnOnce(&mut State, u64) -> R) -> R {
        let now = self.now_ms();
        let (result, batch) = {
            let mut state = self.lock();
            let result = change(&mut state, now);
            state.collect_events();
            if !state.effects.is_empty()
                && let Some(waker) = &state.driver
            {
                waker.wake_by_ref();
            }
            if state.delivering || state.outbox.is_empty() {
                return result;
            }
            state.delivering = true;
            (result, std::mem::take(&mut state.outbox))
        };
        self.deliver(batch);
        result
    }

    fn deliver(&self, mut batch: Vec<CoreEvent>) {
        loop {
            for event in batch {
                self.inner.events.on_event(event);
            }
            let mut state = self.lock();
            if state.outbox.is_empty() {
                state.delivering = false;
                return;
            }
            batch = std::mem::take(&mut state.outbox);
        }
    }

    /// Reads state. For a read that also starts a fetch, use [`Core::write`].
    pub(crate) fn read<R>(&self, read: impl FnOnce(&State) -> R) -> R {
        read(&self.lock())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.state.lock().expect("core state lock poisoned")
    }

    /// Runs background work until [`Core::shutdown`]. A host runs exactly one of these on its
    /// executor, for as long as the core lives. Sends, refetches and resyncs wait for it.
    pub async fn drive(&self) {
        self.run_tasks(false).await;
    }

    /// Runs background work until none is left. For tests, and for a host about to suspend.
    pub async fn run_until_idle(&self) {
        self.run_tasks(true).await;
    }

    /// Ends [`Core::drive`].
    pub fn shutdown(&self) {
        self.write(|state, _| {
            state.shutdown = true;
            if let Some(waker) = &state.driver {
                waker.wake_by_ref();
            }
        });
    }

    async fn run_tasks(&self, until_idle: bool) {
        // In the order queued, so two sends reach the transport in the order they were made.
        let mut tasks: Vec<Task> = Vec::new();
        poll_fn(|context| {
            loop {
                let (new, shutdown) = {
                    let mut state = self.lock();
                    state.driver = Some(context.waker().clone());
                    (state.effects.drain(..).collect::<Vec<_>>(), state.shutdown)
                };
                if shutdown {
                    return Poll::Ready(());
                }
                let had_new = !new.is_empty();
                for effect in new {
                    let core = self.clone();
                    tasks.push(Box::pin(async move { core.run_effect(effect).await }));
                }
                let before = tasks.len();
                tasks.retain_mut(|task| task.as_mut().poll(context).is_pending());
                if !had_new && before == tasks.len() {
                    break;
                }
            }
            let queue_empty = self.lock().effects.is_empty();
            if until_idle && tasks.is_empty() && queue_empty {
                Poll::Ready(())
            } else {
                Poll::Pending
            }
        })
        .await;
    }

    async fn run_effect(&self, effect: Effect) {
        match effect {
            Effect::FetchQuery(key) => self.fetch_query(key).await,
            Effect::ResyncWindow(conversation) => self.resync_window(conversation).await,
            Effect::ResetWindow(conversation) => self.reset_window(conversation).await,
            Effect::Send(nonce) => self.run_send(nonce).await,
            Effect::RefreshToken => self.refresh_token().await,
            Effect::LeavePresence(channel_id) => self.leave_presence(channel_id).await,
            Effect::EndCall => {
                if let Some(media) = self.services().and_then(|services| services.media.clone()) {
                    media.disconnect().await;
                }
            }
        }
    }

    pub fn connection(&self) -> ConnectionState {
        self.read(|state| state.connection)
    }

    pub fn set_token_expiry(&self, expires_at_ms: u64) {
        self.write(|state, _| state.token_expires_at_ms = Some(expires_at_ms));
    }

    /// Whether the app window has focus. A message arriving in the conversation on screen doesn't
    /// count as unread while it does.
    pub fn set_focused(&self, focused: bool) {
        self.write(|state, _| state.focused = focused);
    }

    /// Whether a query is cached, and stale. For tests and diagnostics: a UI reads view models.
    pub fn query_state(&self, key: &QueryKey) -> Option<bool> {
        self.read(|state| state.cache.get(key).map(|entry| entry.stale))
    }

    /// Marks matching queries stale and refetches them.
    pub fn invalidate(&self, prefix: &QueryKey) -> Vec<QueryKey> {
        self.write(|state, _| state.invalidate(prefix))
    }

    /// The OS is about to suspend us. Safe to call twice.
    pub fn suspend(&self) {
        self.write(|state, _| state.set_connection(ConnectionState::Suspended));
        if let Some(services) = self.services() {
            services.realtime.suspend();
        }
    }

    /// The OS woke us. Timers did not run, so the token is rechecked by wall clock. Whether events
    /// were missed isn't known yet: the transport asks its socket, then reports `Resumed` (no gap,
    /// no resync) or a new `Connected` (a gap, so the resync runs then). If the network went away
    /// meanwhile, the socket is left for `network_changed(Available)`.
    ///
    /// With a `Realtime` attached core has already told it; the plan says what was decided.
    pub fn resume(&self) -> ResyncPlan {
        let plan = self.write(|state, now| {
            if state.connection != ConnectionState::Suspended {
                return ResyncPlan::default();
            }
            let reconnect_socket = match state.network {
                NetworkState::Available => {
                    state.set_connection(ConnectionState::Disconnected);
                    true
                }
                NetworkState::Unavailable => {
                    state.set_connection(ConnectionState::Offline);
                    state.fail_parked_sends(now);
                    false
                }
            };
            ResyncPlan {
                reconnect_socket,
                refresh_token: token_needs_refresh(state, now),
                stale_queries: Vec::new(),
            }
        });
        self.tell_transport(&plan);
        plan
    }

    /// The OS reports a connectivity change. While suspended this is only recorded:
    /// `resume()` acts on it.
    pub fn network_changed(&self, network: NetworkState) -> ResyncPlan {
        let mut restart = false;
        let mut nudge = false;
        let plan = self.write(|state, now| {
            state.network = network;
            match (state.connection, network) {
                (ConnectionState::Suspended, _)
                | (ConnectionState::Offline, NetworkState::Unavailable) => ResyncPlan::default(),
                (_, NetworkState::Unavailable) => {
                    state.set_connection(ConnectionState::Offline);
                    state.fail_parked_sends(now);
                    ResyncPlan::default()
                }
                (ConnectionState::Offline, NetworkState::Available) => {
                    state.set_connection(ConnectionState::Disconnected);
                    ResyncPlan {
                        reconnect_socket: true,
                        refresh_token: token_needs_refresh(state, now),
                        stale_queries: Vec::new(),
                    }
                }
                // Wi-Fi to cellular: the old socket may be dead with nothing to say so until a
                // ping times out. Replace it; the new `Connected` runs the resync.
                (ConnectionState::Connected, NetworkState::Available) => {
                    restart = true;
                    ResyncPlan::default()
                }
                // Reconnecting already: skip what's left of the backoff.
                (ConnectionState::Disconnected, NetworkState::Available) => {
                    nudge = true;
                    ResyncPlan::default()
                }
            }
        });
        self.tell_transport(&plan);
        if let Some(services) = self.services() {
            if restart {
                services.realtime.restart_transport();
            }
            if nudge {
                services.realtime.resume(false);
            }
        }
        plan
    }

    fn tell_transport(&self, plan: &ResyncPlan) {
        if plan.reconnect_socket
            && let Some(services) = self.services()
        {
            services.realtime.resume(plan.refresh_token);
        }
    }
}

pub(crate) fn token_needs_refresh(state: &State, now: u64) -> bool {
    state
        .token_expires_at_ms
        .is_some_and(|expiry| expiry <= now.saturating_add(TOKEN_REFRESH_MARGIN_MS))
}
