//! Everything core needs from outside itself, as traits. Desktop implementations live in
//! `semaphore-platform-desktop` and `semaphore-media-livekit`. A mobile app would supply
//! its own over a binding layer (likely LiveKit's Swift and Kotlin SDKs for media), which
//! is why no LiveKit or OS type appears here.

use crate::cache::QueryKey;
use crate::lifecycle::ConnectionState;
use crate::model::{
    Conversation, ListOp, MediaDiagnostics, OsNotification, RemovalCause, ScreenShareRequest,
    SoundCue, VideoDemand, ViewKey,
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
    /// A desktop app signed in to this account through a browser approval (`desktopSignIn`): warn,
    /// as the web does, "If this wasn't you, change your password". `ip_address` is the new
    /// session's, when the server knew it.
    DesktopSignedIn {
        ip_address: Option<String>,
        at_ms: i64,
    },
    /// W4: play this sound. `IncomingRingStart` loops until `IncomingRingStop`.
    Sound {
        cue: SoundCue,
    },
    /// W5: this user lost a community: kicked, banned, or it was deleted. Sent once per loss; core
    /// has already dropped it and left its call. Show "You were removed from {name}" / "You were
    /// banned from {name}" once, with the reason (and, for a temporary ban, until when), then go
    /// home.
    CommunityRemoved {
        community_id: String,
        /// Its name as last known, or empty.
        name: String,
        cause: RemovalCause,
    },
    /// W5: a channel went away for this user (deleted, or they can no longer see it). Leave it if
    /// it's open.
    ChannelRemoved {
        community_id: String,
        channel_id: String,
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

    /// W4: plays a soundboard sound into the call, on a track of its own named `soundboard` (as the
    /// web does, so the mic's mute and push to talk don't hold it back), and on our own speakers.
    /// `bytes` is the sound's file as uploaded (MP3, WAV, OGG, WebM or AAC, at most 1 MiB); the
    /// engine decodes it and may keep it by `sound_id`. A sound playing already stops. Returns once
    /// it has started. Only during a call.
    async fn play_soundboard(&self, _sound_id: String, _bytes: Vec<u8>) -> Result<(), CoreError> {
        Err(CoreError::Unavailable {
            what: "soundboard".into(),
        })
    }

    /// W4: stops the soundboard sound playing, if any.
    fn stop_soundboard(&self) {}

    /// W4: how loud this participant plays here, 0 to 200 percent (100 is as sent). Remembered
    /// across calls, like the other setters.
    fn set_participant_volume(&self, _identity: String, _percent: u32) {}

    /// W4: the same for the audio of their screen share, which the web keeps apart from the mic's.
    fn set_screen_share_volume(&self, _identity: String, _percent: u32) {}

    /// W4: what the engine measures about the call now, for the debug panel. `None` outside a call
    /// or when it can't tell.
    async fn diagnostics(&self) -> Option<MediaDiagnostics> {
        None
    }
}

/// W4: keeps the system from sleeping during a call (not the display), as Electron's
/// `prevent-app-suspension`. Core turns it on when a call starts connecting and off when it ends,
/// never twice in a row the same way. Desktop: `semaphore-platform-desktop`'s `keep_awake` (a logind
/// inhibitor; `SetThreadExecutionState` on a thread of its own on Windows). Set with
/// `Core::set_keep_awake`.
pub trait KeepAwake: Send + Sync {
    fn set(&self, on: bool) -> Result<(), CoreError>;
}

/// Sign in with browser's one-shot HTTP listener on the loopback interface (RFC 8252 section 7.3).
/// The listener only moves bytes: core decides what each request gets (`Core::start_browser_sign_in`
/// checks the method, Host, path, `state` and the code). Desktop: `semaphore-platform-desktop`'s
/// `loopback`. Set with `Core::set_loopback`.
#[async_trait]
pub trait Loopback: Send + Sync {
    /// Starts listening on `127.0.0.1`, on a port the OS picks. Never `localhost` (some resolve it
    /// to `::1` first) and never another interface.
    async fn bind(&self) -> Result<std::sync::Arc<dyn LoopbackListener>, CoreError>;
}

/// One bound listener, for one attempt.
#[async_trait]
pub trait LoopbackListener: Send + Sync {
    fn port(&self) -> u16;

    /// The next request's head, once one has fully arrived. `None` once `timeout_ms` has passed or
    /// `close` was called. A connection that is slow to send its head, or sends more than a few KiB
    /// of it, gets `LoopbackPage::BadRequest` from the listener itself and never shows up here, so
    /// it can't hold up the real callback.
    async fn next(&self, timeout_ms: u64) -> Option<LoopbackRequest>;

    /// Answers request `id` with `page` and closes its connection. Nothing else is ever served: no
    /// files, no other paths.
    fn reply(&self, id: u64, page: LoopbackPage);

    /// Stops listening. A waiting `next` returns `None`; requests not yet answered get
    /// `LoopbackPage::BadRequest`.
    fn close(&self);
}

/// A request's head, as it came. `target` holds the code and `state`, so `Debug` shows only its
/// path, and nothing may log it.
#[derive(Clone, PartialEq, Eq)]
pub struct LoopbackRequest {
    /// For `LoopbackListener::reply`.
    pub id: u64,
    pub method: String,
    /// The `Host` header, if there was exactly one.
    pub host: Option<String>,
    /// The request target, such as `/callback?code=...&state=...`.
    pub target: String,
}

/// A request target without its query or fragment: `/callback?code=...` is `/callback`.
pub fn request_path(target: &str) -> &str {
    target.split(['?', '#']).next().unwrap_or("")
}

impl std::fmt::Debug for LoopbackRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let path = request_path(&self.target);
        f.debug_struct("LoopbackRequest")
            .field("id", &self.id)
            .field("method", &self.method)
            .field("host", &self.host)
            .field("path", &path)
            .finish_non_exhaustive()
    }
}

/// The fixed pages the listener writes. None of them carries the code, `state` or a token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LoopbackPage {
    /// 200 "You're signed in. You can close this tab."
    SignedIn,
    /// 200 "Sign-in cancelled."
    Denied,
    /// 400 "This link doesn't work. Start again from the app."
    BadRequest,
}
