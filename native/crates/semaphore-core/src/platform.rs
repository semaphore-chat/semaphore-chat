//! Everything core needs from outside itself, as traits. Desktop implementations live in
//! `semaphore-platform-desktop` and `semaphore-media-livekit`. A mobile app would supply
//! its own over a binding layer (likely LiveKit's Swift and Kotlin SDKs for media), which
//! is why no LiveKit or OS type appears here.

use crate::cache::QueryKey;
use crate::lifecycle::ConnectionState;
use async_trait::async_trait;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CoreError {
    #[error("not available on this platform: {what}")]
    Unavailable { what: String },
    #[error("{message}")]
    Failed { message: String },
}

/// Pushed out of core to whatever UI is attached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreEvent {
    ConnectionChanged { state: ConnectionState },
    QueriesInvalidated { keys: Vec<QueryKey> },
}

pub trait EventSink: Send + Sync {
    fn on_event(&self, event: CoreEvent);
}

/// Wall clock in Unix milliseconds. Monotonic clocks can stop across a suspend.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

pub trait SecretStore: Send + Sync {
    fn load(&self, key: String) -> Result<Option<String>, CoreError>;
    fn save(&self, key: String, value: String) -> Result<(), CoreError>;
    fn delete(&self, key: String) -> Result<(), CoreError>;
}

pub trait Notifier: Send + Sync {
    fn notify(&self, title: String, body: String) -> Result<(), CoreError>;
}

/// Desktop only in practice; mobile has no tray and simply never implements it.
pub trait Tray: Send + Sync {
    fn set_unread(&self, count: u32) -> Result<(), CoreError>;
}

pub trait AppPaths: Send + Sync {
    fn data_dir(&self) -> String;
    fn cache_dir(&self) -> String;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSource {
    pub id: String,
    pub name: String,
}

pub trait ScreenCapture: Send + Sync {
    fn sources(&self) -> Result<Vec<CaptureSource>, CoreError>;
}

/// A voice/video session. Frames and audio devices stay behind the implementation.
#[async_trait]
pub trait MediaEngine: Send + Sync {
    async fn connect(&self, url: String, token: String) -> Result<(), CoreError>;
    async fn disconnect(&self);
}
