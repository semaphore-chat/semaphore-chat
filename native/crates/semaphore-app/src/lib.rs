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
pub mod player;
pub mod root;
pub mod runtime;
pub mod services;
pub mod settings;
pub mod sounds;
pub mod update;
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
    /// How rows show times, and the one clock every relative age is measured from ("5m ago",
    /// "Today", a notification's age). Real time unless the rig pins it, so screenshots compare.
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
    /// `third_party_media` is read so far: it decides whether link previews and GIFs load their images
    /// from the sites they're on.
    pub settings: settings::SettingsStore,
    /// OS notifications for what core raises: the desktop's (`DesktopServices::notifier`) in the
    /// app, a recorder in the rig, `None` for none.
    pub notifier: Option<Arc<dyn semaphore_core::platform::Notifier>>,
    /// Opens a web address in the system's browser (browser sign-in): `cx.open_url` when `None`,
    /// a recorder in the rig.
    pub open_url: Option<OpenUrl>,
    /// The system's file picker (the portal's on Linux, the common dialog on Windows) when `None`;
    /// the rig answers from a queue.
    pub pick_files: Option<PickFiles>,
    /// Where a download goes: the system's save dialog when `None`; the rig answers from a queue.
    pub save_path: Option<SavePath>,
    /// Who opens `semaphore://` links, and registering for them: the desktop's
    /// (`desktop::DesktopLinks`) in the app, a fake in the rig, `None` for "can't tell".
    pub links: Option<Arc<dyn desktop::LinkRegistrar>>,
    /// W13: whether this build and install check for updates, and what it needs to.
    pub update: update::UpdateStart,
    /// W13: starts the app again once an AppImage update is in place. The app starts the new
    /// build and quits (or returns why it couldn't, and keeps running); a rig records that it was
    /// asked.
    pub restart: Option<RestartApp>,
    /// W4: holds off system sleep during a call (`Core::set_keep_awake`): the desktop's
    /// (`DesktopKeepAwake`) in the app, a recorder in the rig, `None` for none. Never the
    /// desktop's in tests or rigs.
    pub keep_awake: Option<Arc<dyn semaphore_core::platform::KeepAwake>>,
}

/// `AppConfig::open_url`.
pub type OpenUrl = std::rc::Rc<dyn Fn(&str, &mut App)>;

/// What a file pick is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PickRequest {
    pub multiple: bool,
    /// The dialog's button: "Attach", "Choose".
    pub prompt: &'static str,
}

/// `AppConfig::pick_files`: the paths picked, or `None` when cancelled.
pub type PickFiles = std::rc::Rc<dyn Fn(PickRequest, &mut App) -> Task<Option<Vec<PathBuf>>>>;

/// `AppConfig::restart`: starts the updated build and quits, or says why it couldn't (the app then
/// keeps running).
pub type RestartApp = std::rc::Rc<dyn Fn(&mut App) -> Result<(), String>>;

/// `AppConfig::save_path`: given the suggested file name, where to save it, or `None` when
/// cancelled.
pub type SavePath = std::rc::Rc<dyn Fn(&str, &mut App) -> Task<Option<PathBuf>>>;

/// The process's file picker, save dialog and browser, from the config: `AppRoot::new` installs
/// them.
pub struct Seams {
    pub pick_files: PickFiles,
    pub save_path: SavePath,
    pub open_url: OpenUrl,
}

impl Global for Seams {}

/// Opens the file picker the config chose.
pub fn pick_files(request: PickRequest, cx: &mut App) -> Task<Option<Vec<PathBuf>>> {
    let pick = cx
        .try_global::<Seams>()
        .map(|seams| seams.pick_files.clone())
        .unwrap_or_else(system_pick_files);
    pick(request, cx)
}

/// Asks where to save a download called `name` (made safe first), with the save dialog the
/// config chose.
pub fn ask_save_path(name: &str, cx: &mut App) -> Task<Option<PathBuf>> {
    let save = cx
        .try_global::<Seams>()
        .map(|seams| seams.save_path.clone())
        .unwrap_or_else(system_save_path);
    save(&files::safe_file_name(name), cx)
}

/// The system's save dialog, through GPUI, from the home folder.
pub fn system_save_path() -> SavePath {
    std::rc::Rc::new(|name: &str, cx: &mut App| {
        let directory = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let chosen = cx.prompt_for_new_path(&directory, Some(name));
        cx.spawn(async move |_| chosen.await.ok().and_then(Result::ok).flatten())
    })
}

/// Opens `url` in the browser the config chose.
pub fn open_url(url: &str, cx: &mut App) {
    match cx.try_global::<Seams>().map(|seams| seams.open_url.clone()) {
        Some(open) => open(url, cx),
        None => cx.open_url(url),
    }
}

/// The system's file picker, through GPUI.
pub fn system_pick_files() -> PickFiles {
    std::rc::Rc::new(|request: PickRequest, cx: &mut App| {
        let picked = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: request.multiple,
            prompt: Some(request.prompt.into()),
        });
        cx.spawn(async move |_| match picked.await {
            Ok(Ok(paths)) => paths,
            _ => None,
        })
    })
}

/// Once per process, before the first window.
pub fn init(cx: &mut App) {
    gpui_kit::init(cx);
    semaphore_ui::theme::init(cx);
    semaphore_ui::messages::init(cx);
    root::calls::init(cx);
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
