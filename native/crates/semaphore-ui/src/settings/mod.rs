//! W3-ui-settings: the settings shell and its tabs (notifications, voice and video, appearance,
//! sessions, desktop app), from `pages/SettingsPage.tsx` and `components/Settings/`. Reads
//! `NotificationSettingsView`, `AppearanceView`, `SessionsView` and the app's local settings.
//!
//! - `SettingsScreen`: the nav column and the open tab (a list to tap into on a phone). It creates
//!   every tab and hands them out, so the owner feeds each one and listens to it.
//! - `VoiceVideoSettings` (`AudioVideoSettingsPanel.tsx`): input mode and the push-to-talk key,
//!   processing, mic quality, devices, the mic test meter, camera and screen share quality. Every
//!   change goes out at once as the whole new `VoiceVideoState`; there is no Save.
//! - `AppearanceSettings` (the appearance card in `SettingsPage.tsx`): dark or light, the accent,
//!   the intensity, and a live preview.
//! - `SessionsSettings` (`SessionsSettings.tsx`): this account's signed-in devices.
//! - `DesktopAppSettings`: close to tray, the `semaphore://` link handler, link preview images, the
//!   server and the versions.
//!
//! Like every view here they emit what the user asked for; the owner calls core.

mod appearance;
mod desktop;
pub mod key_capture;
mod sessions;
mod shell;
#[cfg(feature = "stories")]
pub(crate) mod stories;
#[cfg(test)]
mod tests;
mod voice;

pub use appearance::{accent_name, theme_choice};
pub use key_capture::{Capture, ptt_key_from, ptt_key_label};
pub use sessions::{session_details, session_device_name};
pub use voice::{mic_quality_label, share_size_label};

use crate::kit::Severity;
use crate::messages::TimeFormat;
use crate::notifications::NotificationSettingsSection;
use crate::panel::PanelClock;
use gpui_kit::component::select::SelectState;
use gpui_kit::component::slider::SliderState;
use gpui_kit::*;
use semaphore_core::model::{
    AppearancePatch, AppearanceView, LoadState, SessionsView, ShareResolution,
};

type Choices = Entity<SelectState<Vec<SharedString>>>;

// ---- The shell. ----

/// The settings tabs, in the order the nav shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum SettingsTab {
    #[default]
    Notifications,
    VoiceVideo,
    Appearance,
    Sessions,
    DesktopApp,
}

impl SettingsTab {
    pub const ALL: [SettingsTab; 5] = [
        Self::Notifications,
        Self::VoiceVideo,
        Self::Appearance,
        Self::Sessions,
        Self::DesktopApp,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Notifications => "Notifications",
            Self::VoiceVideo => "Voice & video",
            Self::Appearance => "Appearance",
            Self::Sessions => "Sessions",
            Self::DesktopApp => "Desktop app",
        }
    }

    /// The nav row's id is `settings-tab-<key>`.
    pub fn key(self) -> &'static str {
        match self {
            Self::Notifications => "notifications",
            Self::VoiceVideo => "voice",
            Self::Appearance => "appearance",
            Self::Sessions => "sessions",
            Self::DesktopApp => "desktop",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsShellEvent {
    /// The user picked a tab: the owner keeps it in the route.
    TabChanged(SettingsTab),
    /// The close button: the owner leaves the route.
    Close,
}

pub struct SettingsScreen {
    tab: SettingsTab,
    /// On a phone: a tab is open, rather than the list of them.
    phone_open: bool,
    notifications: Entity<NotificationSettingsSection>,
    voice: Entity<VoiceVideoSettings>,
    appearance: Entity<AppearanceSettings>,
    sessions: Entity<SessionsSettings>,
    desktop: Entity<DesktopAppSettings>,
}

impl EventEmitter<SettingsShellEvent> for SettingsScreen {}

impl SettingsScreen {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            tab: SettingsTab::Notifications,
            phone_open: false,
            notifications: cx.new(|cx| NotificationSettingsSection::new(window, cx)),
            voice: cx.new(|cx| VoiceVideoSettings::new(window, cx)),
            appearance: cx.new(AppearanceSettings::new),
            sessions: cx.new(SessionsSettings::new),
            desktop: cx.new(DesktopAppSettings::new),
        }
    }

    /// The route's tab. On a phone this opens it, rather than showing the list.
    pub fn set_tab(&mut self, tab: SettingsTab, cx: &mut Context<Self>) {
        self.tab = tab;
        self.phone_open = true;
        cx.notify();
    }

    pub fn tab(&self) -> SettingsTab {
        self.tab
    }

    pub fn notifications(&self) -> Entity<NotificationSettingsSection> {
        self.notifications.clone()
    }

    pub fn voice(&self) -> Entity<VoiceVideoSettings> {
        self.voice.clone()
    }

    pub fn appearance(&self) -> Entity<AppearanceSettings> {
        self.appearance.clone()
    }

    pub fn sessions(&self) -> Entity<SessionsSettings> {
        self.sessions.clone()
    }

    pub fn desktop(&self) -> Entity<DesktopAppSettings> {
        self.desktop.clone()
    }
}

// ---- Voice and video. ----

/// The browser-style processing switches. All on by default, as the web.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Processing {
    pub echo_cancellation: bool,
    pub noise_suppression: bool,
    pub auto_gain: bool,
}

impl Default for Processing {
    fn default() -> Self {
        Self {
            echo_cancellation: true,
            noise_suppression: true,
            auto_gain: true,
        }
    }
}

/// `MIC_QUALITY_OPTIONS` in `utils/voiceQuality.ts`; High is the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum MicQuality {
    Standard,
    #[default]
    High,
    Music,
}

impl MicQuality {
    pub const ALL: [MicQuality; 3] = [Self::Standard, Self::High, Self::Music];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputMode {
    /// The mic is open while unmuted, gated below `threshold` (0..=100; 0 = most sensitive).
    VoiceActivity { threshold: u8 },
    /// The mic is open while the push-to-talk key is held.
    PushToTalk,
}

impl Default for InputMode {
    fn default() -> Self {
        Self::VoiceActivity { threshold: 0 }
    }
}

/// How a screen share is sent: today's voice settings dialog's choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShareQuality {
    pub resolution: ShareResolution,
    /// 15, 30 or 60.
    pub fps: u32,
    /// Share the system's audio too.
    pub audio: bool,
}

impl Default for ShareQuality {
    fn default() -> Self {
        Self {
            resolution: ShareResolution::P1080,
            fps: 30,
            audio: true,
        }
    }
}

/// What the voice and video tab shows and edits. The owner keeps it in the app's local settings
/// and applies it to the media engine.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VoiceVideoState {
    pub processing: Processing,
    pub mic_quality: MicQuality,
    pub input_mode: InputMode,
    /// A GPUI key name such as `"f13"` or `"space"` (see `key_capture`); `None` until one is set.
    pub ptt_key: Option<String>,
    /// A `DeviceOption::id`; `None` = the system default.
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub camera: Option<String>,
    pub share: ShareQuality,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DeviceOption {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// The media engine's devices (`devices()`, `cameras()`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DeviceLists {
    pub state: LoadState,
    pub inputs: Vec<DeviceOption>,
    pub outputs: Vec<DeviceOption>,
    pub cameras: Vec<DeviceOption>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceSettingsEvent {
    /// Any change, at once: the owner saves it and applies it.
    Changed(VoiceVideoState),
    /// "Test": the owner opens the mic and feeds `set_mic_level`.
    StartMicTest,
    /// "Stop": the owner closes it and calls `set_mic_level(None)`.
    StopMicTest,
    PlayTestSound,
    /// The refresh button, or Try again after the device list failed.
    RefreshDevices,
}

/// What this build can't do yet, said in the tab where it would be. `None` = it can.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VoiceLimits {
    /// In place of the mic test's button and meter.
    pub mic_test: Option<SharedString>,
    /// Under the push-to-talk key, while push to talk is chosen.
    pub push_to_talk: Option<SharedString>,
}

pub struct VoiceVideoSettings {
    state: VoiceVideoState,
    limits: VoiceLimits,
    devices: DeviceLists,
    mic_level: Option<f32>,
    /// The voice-activity threshold to go back to after push to talk.
    last_threshold: u8,
    capturing: bool,
    capture_focus: FocusHandle,
    quality: Choices,
    input: Choices,
    output: Choices,
    camera: Choices,
    /// Each device select's rows: the label shown, and the device it stands for (`None` = the
    /// system default).
    input_rows: Vec<voice::DeviceRow>,
    output_rows: Vec<voice::DeviceRow>,
    camera_rows: Vec<voice::DeviceRow>,
    threshold: Entity<SliderState>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<VoiceSettingsEvent> for VoiceVideoSettings {}

// ---- Appearance. ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppearanceEvent {
    /// One pick: `Core::update_appearance(patch)`, which shows it at once.
    Update(AppearancePatch),
    /// The settings failed to load and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct AppearanceSettings {
    view: AppearanceView,
}

impl EventEmitter<AppearanceEvent> for AppearanceSettings {}

impl AppearanceSettings {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            view: AppearanceView::default(),
        }
    }

    /// `Core::appearance`, read again on `ViewChanged { Appearance }`.
    pub fn set_view(&mut self, view: AppearanceView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }
}

// ---- Sessions. ----

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionsEvent {
    /// A row's revoke button: `Core::revoke_session(session_id)`. Never sent for the current one.
    Revoke { session_id: String },
    /// "Sign out all other devices", once confirmed: `Core::revoke_other_sessions`.
    RevokeOthers,
    /// The list failed and the user asked again: `Core::retry_failed`.
    Retry,
}

pub struct SessionsSettings {
    view: SessionsView,
    clock: PanelClock,
    time: TimeFormat,
    notice: Option<(Severity, String)>,
    confirming: bool,
}

impl EventEmitter<SessionsEvent> for SessionsSettings {}

impl SessionsSettings {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            view: SessionsView::default(),
            clock: PanelClock::default(),
            time: TimeFormat::default(),
            notice: None,
            confirming: false,
        }
    }

    /// `Core::sessions`, read again on `ViewChanged { Sessions }`.
    pub fn set_view(&mut self, view: SessionsView, cx: &mut Context<Self>) {
        self.view = view;
        cx.notify();
    }

    /// What "5 minutes ago" is measured from. The real clock unless a story fixes it.
    pub fn set_clock(&mut self, clock: PanelClock, cx: &mut Context<Self>) {
        self.clock = clock;
        cx.notify();
    }

    /// The zone "Signed in …" and "Expires …" are written in: the app's, unless a story fixes it.
    pub fn set_time(&mut self, time: TimeFormat, cx: &mut Context<Self>) {
        self.time = time;
        cx.notify();
    }

    /// A line over the list: "Signed out 3 other devices", or what failed.
    pub fn set_notice(&mut self, notice: Option<(Severity, String)>, cx: &mut Context<Self>) {
        self.notice = notice;
        cx.notify();
    }
}

// ---- Desktop app. ----

/// Who opens `semaphore://` links on this machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LinkHandler {
    /// This app registered itself.
    Registered,
    /// The installed package (.deb, .rpm, the installer) owns the registration.
    PackageOwned,
    NotRegistered,
    /// It couldn't be told.
    #[default]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DesktopAppState {
    pub close_to_tray: bool,
    pub links: LinkHandler,
    pub link_preview_images: bool,
    pub server_url: String,
    pub server_name: Option<String>,
    pub app_version: String,
    pub server_version: Option<String>,
    /// A line under the links button: what registering would do here.
    pub links_note: Option<String>,
    /// Why registering is turned off; the button shows disabled with this under it.
    pub links_blocked: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopAppEvent {
    SetCloseToTray(bool),
    /// "Make Semaphore open semaphore:// links".
    RegisterLinkHandler,
    SetLinkPreviewImages(bool),
    /// "Change server": the owner shows its server picker.
    ChangeServer,
}

pub struct DesktopAppSettings {
    state: DesktopAppState,
}

impl EventEmitter<DesktopAppEvent> for DesktopAppSettings {}

impl DesktopAppSettings {
    pub fn new(_: &mut Context<Self>) -> Self {
        Self {
            state: DesktopAppState::default(),
        }
    }

    pub fn set_state(&mut self, state: DesktopAppState, cx: &mut Context<Self>) {
        self.state = state;
        cx.notify();
    }
}

#[cfg(feature = "stories")]
pub fn stories() -> Vec<crate::stories::Story> {
    stories::stories()
}
