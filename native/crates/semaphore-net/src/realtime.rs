//! [`Realtime`] over the Socket.IO session in [`crate::socket`].
//!
//! The session is started on `connect()`, against the server [`HttpBackend`] holds then, because
//! core sets the server URL at sign-in and the socket config fixes a base URL when it starts.
//! Its events go to [`Core::ingest`] once [`SocketRealtime::attach`] has given it the core, which
//! can't exist before the services it is built from.
//!
//! Tokens come from the backend, so the socket's reauthentication and a REST call that finds the
//! access token expired share one refresh.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use async_trait::async_trait;
use semaphore_core::Core;
use semaphore_core::realtime::{Realtime, RealtimeError, RealtimeEvent};
use serde_json::Value;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::backend::HttpBackend;
use crate::socket::{EmitError, Refresh, SocketClient, SocketConfig, SocketEvent, TokenSource};

struct BackendTokens(HttpBackend);

#[async_trait]
impl TokenSource for BackendTokens {
    async fn access_token(&self) -> Option<String> {
        self.0.access_token()
    }

    async fn refresh(&self) -> Refresh {
        match self.0.refresh_access_token().await {
            Ok(token) => Refresh::Refreshed(token),
            // The same words as the rig: the server refused the session.
            Err(error) if matches!(error.status, 401 | 403) => Refresh::Rejected,
            Err(_) => Refresh::Unavailable,
        }
    }
}

struct Live {
    base_url: String,
    client: SocketClient,
}

#[derive(Default)]
struct State {
    core: Option<Core>,
    live: Option<Live>,
}

pub struct SocketRealtime {
    config: SocketConfig,
    backend: HttpBackend,
    state: Mutex<State>,
}

impl SocketRealtime {
    /// `config` supplies the timings; its `base_url` is replaced with the backend's server URL
    /// at each `connect()`.
    pub fn new(config: SocketConfig, backend: HttpBackend) -> Arc<Self> {
        Arc::new(Self {
            config,
            backend,
            state: Mutex::new(State::default()),
        })
    }

    /// Where socket events go. Call once, after building the core with this as its realtime.
    pub fn attach(&self, core: Core) {
        self.lock().core = Some(core);
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn client(&self) -> Option<SocketClient> {
        self.lock().live.as_ref().map(|live| live.client.clone())
    }
}

fn forward(core: Core, mut events: UnboundedReceiver<SocketEvent>) {
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            core.ingest(match event {
                SocketEvent::Connected { sid } => RealtimeEvent::Connected { sid },
                SocketEvent::Disconnected { reason } => RealtimeEvent::Disconnected { reason },
                SocketEvent::ConnectError { message } => RealtimeEvent::ConnectError { message },
                SocketEvent::Event { name, payload } => RealtimeEvent::Event { name, payload },
                SocketEvent::Resumed => RealtimeEvent::Resumed,
                SocketEvent::Reauthenticated { result } => {
                    RealtimeEvent::Reauthenticated { result }
                }
                SocketEvent::AuthLost { reason } => RealtimeEvent::AuthLost { reason },
            });
        }
    });
}

#[async_trait]
impl Realtime for SocketRealtime {
    fn connect(&self) {
        let Some(base_url) = self.backend.server_url() else {
            log::warn!("realtime connect with no server URL set");
            return;
        };
        let mut state = self.lock();
        if let Some(live) = &state.live {
            if live.base_url == base_url {
                live.client.connect();
                return;
            }
            // Another server: the old session ends with its client.
            live.client.disconnect();
        }
        let Some(core) = state.core.clone() else {
            log::warn!("realtime connect before attach: no core to send events to");
            return;
        };
        let mut config = self.config.clone();
        config.base_url = base_url.clone();
        let (client, events) =
            SocketClient::start(config, Arc::new(BackendTokens(self.backend.clone())));
        forward(core, events);
        client.connect();
        state.live = Some(Live { base_url, client });
    }

    fn disconnect(&self) {
        if let Some(client) = self.client() {
            client.disconnect();
        }
    }

    fn restart_transport(&self) {
        if let Some(client) = self.client() {
            client.restart_transport();
        }
    }

    fn suspend(&self) {
        if let Some(client) = self.client() {
            client.suspend();
        }
    }

    fn resume(&self, refresh: bool) {
        if let Some(client) = self.client() {
            client.resume(refresh);
        }
    }

    async fn emit(&self, event: String, payload: Value) -> Result<(), RealtimeError> {
        let client = self.client().ok_or(RealtimeError::NotConnected)?;
        client.emit(&event, payload).await.map_err(map_error)
    }

    async fn emit_with_ack(
        &self,
        event: String,
        payload: Value,
        wait_ms: u64,
    ) -> Result<Vec<Value>, RealtimeError> {
        let client = self.client().ok_or(RealtimeError::NotConnected)?;
        client
            .emit_with_ack(&event, payload, Duration::from_millis(wait_ms))
            .await
            .map_err(map_error)
    }
}

/// `ConnectionLost` means the server may have acted, so it must not read as `NotConnected`, which
/// core treats as safe to send again unchanged.
fn map_error(error: EmitError) -> RealtimeError {
    match error {
        EmitError::NotConnected => RealtimeError::NotConnected,
        EmitError::ConnectionLost | EmitError::Timeout => RealtimeError::AckTimedOut,
        EmitError::Closed => RealtimeError::Closed,
    }
}
