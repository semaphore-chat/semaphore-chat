//! Everything core needs from outside itself, as traits. Desktop implementations live in
//! `semaphore-platform-desktop` and `semaphore-media-livekit`. A mobile app would supply
//! its own over a binding layer (likely LiveKit's Swift and Kotlin SDKs for media), which
//! is why no LiveKit or OS type appears here.

use crate::cache::QueryKey;
use crate::lifecycle::ConnectionState;
use crate::model::{
    Conversation, ListOp, OsNotification, ScreenShareRequest, VideoDemand, ViewKey,
};
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
    /// Raise this OS notification: core has decided it should show (W2's `notify::decide`). The
    /// app hands it to `Notifier::show`. A newer one with the same `tag` replaces the older.
    Notify {
        notification: OsNotification,
    },
    /// The conversation behind this tag was read: take its notifications down
    /// (`Notifier::withdraw`).
    WithdrawNotifications {
        tag: String,
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

/// OS notifications. Every method may be called from any thread and must not block: hand the work
/// to the platform's notification service and return.
pub trait Notifier: Send + Sync {
    fn notify(&self, title: String, body: String) -> Result<(), CoreError>;

    /// Shows a notification core decided on (`CoreEvent::Notify`), replacing any shown with the same
    /// `tag`. A click should open `link` (and `parent_message_id`'s thread when set). The default
    /// shows the text alone, with no click route or sound.
    fn show(&self, notification: OsNotification) -> Result<(), CoreError> {
        self.notify(notification.title, notification.body)
    }

    /// Takes down what is shown under this tag (`CoreEvent::WithdrawNotifications`). Nothing to do
    /// by default.
    fn withdraw(&self, _tag: &str) {}
}

/// Desktop only in practice; mobile has no tray and simply never implements it.
pub trait Tray: Send + Sync {
    fn set_unread(&self, count: u32) -> Result<(), CoreError>;
}

pub trait AppPaths: Send + Sync {
    fn data_dir(&self) -> String;
    fn cache_dir(&self) -> String;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureKind {
    Screen,
    Window,
}

/// A small picture of a source, for a picker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Thumbnail {
    pub width: u32,
    pub height: u32,
    /// `width * height * 4` bytes, B, G, R, A, rows top to bottom.
    pub bgra: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSource {
    pub id: String,
    pub name: String,
    pub kind: CaptureKind,
    pub thumbnail: Option<Thumbnail>,
}

/// Who picks what to share.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickerKind {
    /// The platform's own dialog, when the share starts: the xdg portal on Wayland, the system
    /// pickers on macOS and phones. `ScreenShareRequest::source_id` is `None`.
    System,
    /// Ours, from `ScreenCapture::sources`: X11 and Windows.
    Listed,
}

pub trait ScreenCapture: Send + Sync {
    fn picker(&self) -> PickerKind;
    /// Screens and windows to offer, with thumbnails that fit `thumbnail_px` on their long side (0:
    /// none). Empty with `PickerKind::System`.
    fn sources(&self, thumbnail_px: u32) -> Result<Vec<CaptureSource>, CoreError>;
}

/// A screen share that started.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenShareStarted {
    /// Its system audio: `None` when not asked for, otherwise whether it started. The screen is
    /// shared either way.
    pub audio: Option<Result<(), String>>,
}

/// A voice/video session. Frames and audio devices stay behind the implementation.
///
/// An implementation reports what it sees by handing a `VoiceView` to `Core::ingest_media`, with the
/// number of the `connect` it belongs to, whenever it changes, as a transport hands events to `Core::ingest`. Rejoining a dropped call is its job
/// too, so the host gives it `Core::voice_token` for the fresh token that takes.
///
/// The setters are called from a UI's thread, so they must not block. What they ask for outlives any
/// one connection: a rejoin puts it all back, and setting one before `connect` applies at `connect`.
/// The camera and the screen share last one call: `disconnect` stops both.
///
/// A report's `local` carries what is actually being sent (`On` or `Off` for the camera and the
/// screen), and `may_camera` and `may_share` from the room's permissions. Core keeps the rest:
/// `Starting` while a start runs, and `Failed` with why.
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

    /// Sends the camera, or stops it. Returns once it's published (or stopped). Only during a call:
    /// unlike the setters above, it isn't remembered for the next one. A rejoin republishes it.
    async fn set_camera(&self, _on: bool) -> Result<(), CoreError> {
        Err(CoreError::Unavailable {
            what: "camera".into(),
        })
    }

    /// Starts sharing a screen or window, replacing any share. Returns once it's published, which
    /// with `PickerKind::System` is after the user has chosen; a cancelled picker is an error. A
    /// rejoin republishes it. While it runs, the engine's reports carry `local.screen = On`; a share
    /// that ends on its own (the window closed, the system's "stop sharing") reports `Off`.
    async fn start_screen_share(
        &self,
        _request: ScreenShareRequest,
    ) -> Result<ScreenShareStarted, CoreError> {
        Err(CoreError::Unavailable {
            what: "screen share".into(),
        })
    }

    /// Stops the screen share and its audio, if one runs.
    async fn stop_screen_share(&self) {}
}
