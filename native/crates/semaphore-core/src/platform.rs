//! Everything core needs from outside itself, as traits. Desktop implementations live in
//! `semaphore-platform-desktop` and `semaphore-media-livekit`. A mobile app would supply
//! its own over a binding layer (likely LiveKit's Swift and Kotlin SDKs for media), which
//! is why no LiveKit or OS type appears here.

use crate::cache::QueryKey;
use crate::lifecycle::ConnectionState;
use crate::model::{Conversation, ListOp, VideoDemand, ViewKey};
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
    ConnectionChanged {
        state: ConnectionState,
    },
    QueriesInvalidated {
        keys: Vec<QueryKey>,
    },
    /// Read this part of the UI again from core.
    ViewChanged {
        view: ViewKey,
    },
    /// Apply these to the conversation's list, in order.
    MessagesChanged {
        conversation: Conversation,
        ops: Vec<ListOp>,
    },
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
///
/// An implementation reports what it sees by handing a `VoiceView` to `Core::ingest_media`, with the
/// number of the `connect` it belongs to, whenever it changes, as a transport hands events to `Core::ingest`. Rejoining a dropped call is its job
/// too, so the host gives it `Core::voice_token` for the fresh token that takes.
///
/// The setters are called from a UI's thread, so they must not block. What they ask for outlives any
/// one connection: a rejoin puts it all back, and setting one before `connect` applies at `connect`.
#[async_trait]
pub trait MediaEngine: Send + Sync {
    /// `call` numbers this join. Every report the engine makes from here until the next `connect`
    /// carries it, so core can tell this call's end from an earlier call's.
    async fn connect(&self, url: String, token: String, call: u64) -> Result<(), CoreError>;
    async fn disconnect(&self);
    fn set_muted(&self, muted: bool);
    /// Deafening mutes the mic too. Undeafening restores what the mic was.
    fn set_deafened(&self, deafened: bool);
    /// Replaces what's on screen. An implementation whose SDK chooses layers by itself can use this
    /// for pausing alone.
    fn set_video_demands(&self, demands: Vec<VideoDemand>);
}
