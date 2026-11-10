//! Building core and its transports, off the main thread.
//!
//! `HttpBackend::new` blocks until the secret store has read this install's device id, which on a
//! locked keyring means until its unlock prompt is answered. So the window opens first, on a splash,
//! and everything here is built on a thread of its own, then handed to the main thread.

use crate::runtime::{Activity, Exec, net_runtime};
use semaphore_core::platform::{Clock, SecretStore};
use semaphore_core::realtime::Realtime as _;
use semaphore_core::{Core, CoreEvent, EventSink, Services as CoreServices};
use semaphore_net::socket::SocketConfig;
use semaphore_net::{HttpBackend, SocketRealtime};
use std::sync::Arc;
use std::time::Duration;

/// Core's events, on their way to the main thread. Never blocks: whatever thread changed core
/// state, possibly the main thread itself, only queues here.
struct ChannelSink {
    sender: async_channel::Sender<CoreEvent>,
    activity: Arc<Activity>,
}

impl EventSink for ChannelSink {
    fn on_event(&self, event: CoreEvent) {
        let _ = self.sender.try_send(event);
        self.activity.bump();
    }
}

pub struct Services {
    pub core: Arc<Core>,
    pub exec: Exec,
    realtime: Arc<SocketRealtime>,
    runtime: Option<tokio::runtime::Runtime>,
}

impl Services {
    /// Ends the socket and core's driver, and gives the runtime a moment to finish. A sign-out is
    /// not implied: the stored session stays for the next start.
    pub fn shutdown(&mut self) {
        self.core.shutdown();
        let realtime = self.realtime.clone();
        if let Some(runtime) = self.runtime.take() {
            // `disconnect` may spawn, so it runs inside the runtime.
            runtime.block_on(async move { realtime.disconnect() });
            runtime.shutdown_timeout(Duration::from_secs(2));
        }
    }
}

impl Drop for Services {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

pub struct Started {
    pub services: async_channel::Receiver<Services>,
    pub events: async_channel::Receiver<CoreEvent>,
}

/// Starts building on a thread of its own. The events channel exists at once, so nothing core says
/// while starting is lost.
pub fn start(
    secrets: Arc<dyn SecretStore>,
    clock: Arc<dyn Clock>,
    activity: Arc<Activity>,
) -> Started {
    let (events_sender, events) = async_channel::unbounded();
    let (services_sender, services) = async_channel::bounded(1);
    std::thread::Builder::new()
        .name("semaphore-start".into())
        .spawn(move || {
            semaphore_net::install_crypto_provider();
            let runtime = net_runtime();
            let backend = HttpBackend::new(secrets);
            let realtime = SocketRealtime::new(SocketConfig::new("unused"), backend.clone());
            let sink = Arc::new(ChannelSink {
                sender: events_sender,
                activity: activity.clone(),
            });
            let core = Arc::new(Core::with_services(
                clock,
                sink,
                CoreServices {
                    backend: Arc::new(backend),
                    realtime: realtime.clone(),
                    // Voice is phase 2.
                    media: None,
                },
            ));
            realtime.attach((*core).clone());
            let driver = core.clone();
            runtime.spawn(async move { driver.drive().await });
            let services = Services {
                core,
                exec: Exec::new(runtime.handle().clone(), activity.clone()),
                realtime,
                runtime: Some(runtime),
            };
            if services_sender.send_blocking(services).is_err() {
                log::warn!("the app went away while it was starting");
            }
            activity.bump();
        })
        .expect("the OS starts a thread");
    Started { services, events }
}
