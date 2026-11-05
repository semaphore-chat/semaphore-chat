//! `Core`: the facade a UI or binding layer holds.

use crate::cache::{QueryCache, QueryKey};
use crate::lifecycle::{ConnectionState, NetworkState, ResyncPlan};
use crate::platform::{Clock, CoreEvent, EventSink};
use std::sync::{Arc, Mutex};

/// The server sends `tokenExpiring` this long before expiry. While suspended we can miss
/// that event, so on the way back we compare against the wall clock using the same margin.
const TOKEN_REFRESH_MARGIN_MS: u64 = 120_000;

struct State {
    cache: QueryCache,
    connection: ConnectionState,
    network: NetworkState,
    token_expires_at_ms: Option<u64>,
}

pub struct Core {
    state: Mutex<State>,
    clock: Arc<dyn Clock>,
    events: Arc<dyn EventSink>,
}

impl Core {
    pub fn new(clock: Arc<dyn Clock>, events: Arc<dyn EventSink>) -> Self {
        Self {
            state: Mutex::new(State {
                cache: QueryCache::default(),
                connection: ConnectionState::Disconnected,
                network: NetworkState::Available,
                token_expires_at_ms: None,
            }),
            clock,
            events,
        }
    }

    pub fn connection(&self) -> ConnectionState {
        self.lock().connection
    }

    pub fn set_token_expiry(&self, expires_at_ms: u64) {
        self.lock().token_expires_at_ms = Some(expires_at_ms);
    }

    /// Stores a response in the query cache, stamped with the current time.
    pub fn cache_set(&self, key: QueryKey, json: String) {
        let now = self.clock.now_ms();
        self.lock().cache.set(key, json, now);
    }

    /// Returns the cached JSON and whether it is stale.
    pub fn cache_get(&self, key: &QueryKey) -> Option<(String, bool)> {
        let state = self.lock();
        let entry = state.cache.get(key)?;
        Some((entry.json.clone(), entry.stale))
    }

    pub fn invalidate(&self, prefix: &QueryKey) -> Vec<QueryKey> {
        let keys = self.lock().cache.invalidate_prefix(prefix);
        self.events
            .on_event(CoreEvent::QueriesInvalidated { keys: keys.clone() });
        keys
    }

    /// The transport reports the socket came up.
    pub fn socket_connected(&self) {
        self.set_connection(ConnectionState::Connected);
    }

    /// The transport reports the socket dropped. Offline and suspended win, because they
    /// explain the drop and carry their own way back.
    pub fn socket_disconnected(&self) -> ResyncPlan {
        let connection = self.lock().connection;
        if connection != ConnectionState::Connected {
            return ResyncPlan::default();
        }
        self.set_connection(ConnectionState::Disconnected);
        self.resync_plan(true)
    }

    /// The OS is about to suspend us. Safe to call twice.
    pub fn suspend(&self) {
        self.set_connection(ConnectionState::Suspended);
    }

    /// The OS woke us. Timers did not run and events were missed, so everything cached is
    /// stale and the token is rechecked by wall clock. If the network went away meanwhile,
    /// the socket is left for `network_changed(Available)`.
    pub fn resume(&self) -> ResyncPlan {
        let (connection, network) = {
            let state = self.lock();
            (state.connection, state.network)
        };
        if connection != ConnectionState::Suspended {
            return ResyncPlan::default();
        }
        match network {
            NetworkState::Available => {
                self.set_connection(ConnectionState::Disconnected);
                self.resync_plan(true)
            }
            NetworkState::Unavailable => {
                self.set_connection(ConnectionState::Offline);
                self.resync_plan(false)
            }
        }
    }

    /// The OS reports a connectivity change. While suspended this is only recorded:
    /// `resume()` acts on it.
    pub fn network_changed(&self, network: NetworkState) -> ResyncPlan {
        let connection = {
            let mut state = self.lock();
            state.network = network;
            state.connection
        };
        match (connection, network) {
            (ConnectionState::Suspended, _) => ResyncPlan::default(),
            (ConnectionState::Offline, NetworkState::Unavailable) => ResyncPlan::default(),
            (_, NetworkState::Unavailable) => {
                self.set_connection(ConnectionState::Offline);
                ResyncPlan::default()
            }
            (ConnectionState::Offline, NetworkState::Available) => {
                self.set_connection(ConnectionState::Disconnected);
                self.resync_plan(true)
            }
            // Wi-Fi to cellular: the old socket may be dead, but the transport finds that
            // out and reports it through socket_disconnected().
            (_, NetworkState::Available) => ResyncPlan::default(),
        }
    }

    fn resync_plan(&self, reconnect_socket: bool) -> ResyncPlan {
        let now = self.clock.now_ms();
        let (stale_queries, refresh_token) = {
            let mut state = self.lock();
            let refresh_token = state
                .token_expires_at_ms
                .is_some_and(|expiry| expiry <= now.saturating_add(TOKEN_REFRESH_MARGIN_MS));
            (state.cache.invalidate_all(), refresh_token)
        };
        self.events.on_event(CoreEvent::QueriesInvalidated {
            keys: stale_queries.clone(),
        });
        ResyncPlan {
            reconnect_socket,
            refresh_token,
            stale_queries,
        }
    }

    fn set_connection(&self, connection: ConnectionState) {
        {
            let mut state = self.lock();
            if state.connection == connection {
                return;
            }
            state.connection = connection;
        }
        // Outside the lock: a sink may call straight back into Core.
        self.events
            .on_event(CoreEvent::ConnectionChanged { state: connection });
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().expect("core state lock poisoned")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct FakeClock(AtomicU64);
    impl Clock for FakeClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    #[derive(Default)]
    struct Recorder(Mutex<Vec<CoreEvent>>);
    impl EventSink for Recorder {
        fn on_event(&self, event: CoreEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    fn core() -> (Core, Arc<FakeClock>, Arc<Recorder>) {
        let clock = Arc::new(FakeClock(AtomicU64::new(1_000_000)));
        let recorder = Arc::new(Recorder::default());
        (Core::new(clock.clone(), recorder.clone()), clock, recorder)
    }

    #[test]
    fn resume_marks_the_cache_stale_and_asks_for_a_reconnect() {
        let (core, _, _) = core();
        let key = QueryKey::new(&["channels"]);
        core.cache_set(key.clone(), "[]".into());
        core.socket_connected();

        core.suspend();
        assert_eq!(core.connection(), ConnectionState::Suspended);
        let plan = core.resume();

        assert!(plan.reconnect_socket);
        assert_eq!(plan.stale_queries, vec![key.clone()]);
        assert_eq!(core.cache_get(&key), Some(("[]".into(), true)));
        assert_eq!(core.connection(), ConnectionState::Disconnected);
    }

    #[test]
    fn resume_finds_a_token_that_expired_while_suspended() {
        let (core, clock, _) = core();
        core.set_token_expiry(1_000_000 + 3_600_000);
        core.suspend();
        // Nothing ran for two hours, so no tokenExpiring event was ever seen.
        clock.0.store(1_000_000 + 7_200_000, Ordering::SeqCst);
        assert!(core.resume().refresh_token);
    }

    #[test]
    fn resume_leaves_a_token_with_time_left_alone() {
        let (core, _, _) = core();
        core.set_token_expiry(1_000_000 + 3_600_000);
        core.suspend();
        assert!(!core.resume().refresh_token);
    }

    #[test]
    fn resume_without_suspend_does_nothing() {
        let (core, _, _) = core();
        core.socket_connected();
        assert_eq!(core.resume(), ResyncPlan::default());
        assert_eq!(core.connection(), ConnectionState::Connected);
    }

    #[test]
    fn a_second_resume_does_not_resync_again() {
        let (core, _, _) = core();
        core.suspend();
        assert!(core.resume().reconnect_socket);
        assert_eq!(core.resume(), ResyncPlan::default());
    }

    #[test]
    fn network_lost_while_suspended_waits_for_the_network_before_reconnecting() {
        let (core, _, _) = core();
        core.suspend();
        assert_eq!(
            core.network_changed(NetworkState::Unavailable),
            ResyncPlan::default()
        );
        assert_eq!(core.connection(), ConnectionState::Suspended);

        assert!(!core.resume().reconnect_socket);
        assert_eq!(core.connection(), ConnectionState::Offline);

        assert!(
            core.network_changed(NetworkState::Available)
                .reconnect_socket
        );
        assert_eq!(core.connection(), ConnectionState::Disconnected);
    }

    #[test]
    fn network_back_while_suspended_lets_resume_reconnect() {
        let (core, _, _) = core();
        core.network_changed(NetworkState::Unavailable);
        core.suspend();
        core.network_changed(NetworkState::Available);
        assert!(core.resume().reconnect_socket);
    }

    #[test]
    fn a_socket_drop_caused_by_suspend_or_offline_adds_no_resync() {
        let (core, _, _) = core();
        core.socket_connected();
        core.suspend();
        assert_eq!(core.socket_disconnected(), ResyncPlan::default());
        assert_eq!(core.connection(), ConnectionState::Suspended);
    }

    #[test]
    fn a_plain_socket_drop_resyncs() {
        let (core, _, _) = core();
        core.socket_connected();
        assert!(core.socket_disconnected().reconnect_socket);
    }

    #[test]
    fn connection_events_fire_once_per_change() {
        let (core, _, recorder) = core();
        core.suspend();
        core.suspend();
        let changes = recorder
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|event| matches!(event, CoreEvent::ConnectionChanged { .. }))
            .count();
        assert_eq!(changes, 1);
    }
}
