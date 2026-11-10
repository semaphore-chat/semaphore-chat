//! The desktop client, as a library so the headless rig (`rigs/slice`) drives the same code the
//! binary runs.
//!
//! - `runtime`: the Tokio runtime commands run on, and how results return to GPUI's thread.
//! - `services`: building core and its transports off the main thread.
//! - `root`: splash, sign-in or shell, following core's session.
//! - `conversation`: the message list and composer over core.

pub mod conversation;
pub mod root;
pub mod runtime;
pub mod services;

use gpui_kit::component::Root;
use gpui_kit::*;
use semaphore_core::platform::{Clock, SecretStore};
use semaphore_ui::messages::TimeFormat;
use std::sync::Arc;

pub use root::AppRoot;

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
