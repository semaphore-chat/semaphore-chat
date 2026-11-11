//! The desktop client, as a library so the headless rig (`rigs/slice`) drives the same code the
//! binary runs.
//!
//! - `runtime`: the Tokio runtime commands run on, and how results return to GPUI's thread.
//! - `services`: building core and its transports off the main thread.
//! - `root`: splash, sign-in or shell, following core's session.
//! - `conversation`: the message list and composer over core.
//! - `voice`: the LiveKit engine wired to core, the stage's controls, video frames.
//! - `desktop`: the window on the desktop: placement, close to tray, the tray, links from the OS.

pub mod conversation;
pub mod desktop;
pub mod files;
pub mod notifier;
pub mod root;
pub mod runtime;
pub mod services;
pub mod settings;
pub mod sounds;
pub mod voice;

use gpui_kit::component::Root;
use gpui_kit::*;
use semaphore_core::platform::{Clock, SecretStore};
use semaphore_ui::messages::TimeFormat;
use std::path::PathBuf;
use std::sync::Arc;

pub use root::AppRoot;
pub use semaphore_platform_desktop::lifecycle::OsEvent;

pub struct AppConfig {
    /// Where the refresh token and device id live: the OS keyring in the app.
    pub secrets: Arc<dyn SecretStore>,
    /// Core's wall clock: the system's in the app. A pending row shows its time.
    pub clock: Arc<dyn Clock>,
    /// Fills in the sign-in screen's server field.
    pub server_url: Option<String>,
    /// How rows show times. The rig fixes the clock so screenshots compare.
    pub time: TimeFormat,
    /// The list's scrollbar fades on a real clock, so the rig turns it off.
    pub scrollbar: bool,
    /// Where the app keeps what isn't secret: the server signed in to last.
    pub data_dir: PathBuf,
    /// Listen to the OS for sleep and network changes. The rig sends its own.
    pub watch_os: bool,
    /// The call's audio: `None` for the real devices, or the rig's virtual ones.
    pub audio: Option<Arc<dyn semaphore_media_livekit::audio::AudioIo>>,
    /// Cameras and screens: `None` for the platform's, or the rig's fakes.
    pub video_sources: Option<Arc<dyn semaphore_media_livekit::VideoSources>>,
    /// What our screen picker lists: `None` for the platform's (the portal on Wayland).
    pub screen_capture: Option<Arc<dyn semaphore_core::platform::ScreenCapture>>,
    /// How often voice presence is refreshed: `voice::HEARTBEAT`, or less in the rig.
    pub heartbeat: std::time::Duration,
    /// The local settings, loaded once at start (`SettingsStore::load(&data_dir)`). Only
    /// `link_preview_images` is read so far: it decides whether link previews load their images
    /// from the sites they're on.
    pub settings: settings::SettingsStore,
    /// OS notifications for what core raises: the desktop's (`DesktopServices::notifier`) in the
    /// app, a recorder in the rig, `None` for none.
    pub notifier: Option<Arc<dyn semaphore_core::platform::Notifier>>,
}

/// Once per process, before the first window.
pub fn init(cx: &mut App) {
    gpui_kit::init(cx);
    semaphore_ui::theme::init(cx);
    semaphore_ui::messages::init(cx);
}

/// What every window that shows the app needs: lists and video are read in unfocused windows, so
/// neither may be throttled for it.
pub fn window_options(options: WindowOptions) -> WindowOptions {
    semaphore_ui::voice::video_window_options(semaphore_ui::messages::with_list_frame_policy(
        options,
    ))
}

/// The window's root: the kit's `Root`, for its overlays, around the app.
pub fn build_root(
    config: AppConfig,
    window: &mut Window,
    cx: &mut App,
) -> (Entity<Root>, Entity<AppRoot>) {
    let app = cx.new(|cx| AppRoot::new(config, window, cx));
    let root = cx.new(|cx| Root::new(app.clone(), window, cx));
    (root, app)
}
