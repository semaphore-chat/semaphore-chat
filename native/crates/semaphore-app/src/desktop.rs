//! The window's life on the desktop: where it opens, what's remembered about it, the tray, close
//! to tray, and what a second launch hands over.
//!
//! - **Close to tray:** closing the window hides it (`Window::set_window_visible`, our GPUI patch)
//!   when the setting is on, a tray icon is on a panel to bring it back, and the platform can hide
//!   a window. Otherwise closing quits, as before. "Quit" in the tray quits.
//! - **Events** ([`DesktopEvent`]) arrive from the tray's and the single instance's threads on a
//!   channel, and are handled here on the UI thread: show/hide, the setting, quit, and links.
//!   Links are parsed with `parse_deep_link` and handed to [`AppRoot::open_link`]; a notification's
//!   click shows the window and goes to [`AppRoot::open_notification`].
//! - **Notifications:** the platform's notifier ([`crate::notifier`]) starts with the tray and
//!   sends its clicks on the same channel.
//! - **Placement:** the size and maximized state from the settings, and the position where the
//!   compositor lets a client choose one (not Wayland). A position no display shows any more (a
//!   monitor unplugged) is dropped and the window centred, as Electron does.
//! - **Saving:** the normal (unmaximized) bounds, half a second after the last change and when the
//!   window closes.

use crate::AppRoot;
use crate::settings::WindowState;
use gpui_kit::*;
use semaphore_core::platform::Notifier;
use semaphore_platform_desktop::tray::{self, DesktopTray, TrayOptions};
use semaphore_platform_desktop::{DesktopEvent, DesktopEventSink};
use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

/// The size of a first start.
pub const DEFAULT_SIZE: (f32, f32) = (1280., 800.);
/// Smaller than this is a window nobody meant.
pub const MIN_SIZE: (f32, f32) = (480., 360.);
/// How much of a saved window must be on a display for its position to be kept: a title bar's
/// worth to grab.
const MIN_VISIBLE: (f32, f32) = (100., 40.);
/// How long the bounds must stay put before they're written.
const SAVE_AFTER: Duration = Duration::from_millis(500);

fn rect(x: f32, y: f32, width: f32, height: f32) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(x), px(y)),
        size: size(px(width), px(height)),
    }
}

fn overlap(a: &Bounds<Pixels>, b: &Bounds<Pixels>) -> (f32, f32) {
    let left = f32::from(a.origin.x).max(f32::from(b.origin.x));
    let top = f32::from(a.origin.y).max(f32::from(b.origin.y));
    let right = f32::from(a.origin.x + a.size.width).min(f32::from(b.origin.x + b.size.width));
    let bottom = f32::from(a.origin.y + a.size.height).min(f32::from(b.origin.y + b.size.height));
    ((right - left).max(0.), (bottom - top).max(0.))
}

/// Where the window opens. `displays` are the displays' bounds, the primary first; `positions` is
/// whether the platform places windows where a client asks (not on Wayland).
pub fn placement(
    saved: Option<&WindowState>,
    displays: &[Bounds<Pixels>],
    positions: bool,
) -> WindowBounds {
    let primary = displays.first().copied();
    let (mut width, mut height) = saved.map_or(DEFAULT_SIZE, |state| {
        (state.width as f32, state.height as f32)
    });
    width = width.max(MIN_SIZE.0);
    height = height.max(MIN_SIZE.1);
    if let Some(display) = primary {
        // Never larger than the display it would open on.
        width = width.min(f32::from(display.size.width).max(MIN_SIZE.0));
        height = height.min(f32::from(display.size.height).max(MIN_SIZE.1));
    }
    let kept = saved.filter(|_| positions).and_then(|state| {
        let wanted = rect(state.x as f32, state.y as f32, width, height);
        displays
            .iter()
            .any(|display| {
                let (w, h) = overlap(&wanted, display);
                w >= MIN_VISIBLE.0 && h >= MIN_VISIBLE.1
            })
            .then_some(wanted)
    });
    let bounds = kept.unwrap_or_else(|| match primary {
        Some(display) => rect(
            f32::from(display.origin.x) + (f32::from(display.size.width) - width) / 2.,
            f32::from(display.origin.y) + (f32::from(display.size.height) - height) / 2.,
            width,
            height,
        ),
        None => rect(0., 0., width, height),
    });
    if saved.is_some_and(|state| state.maximized) {
        WindowBounds::Maximized(bounds)
    } else {
        WindowBounds::Windowed(bounds)
    }
}

/// What to remember of the window: its normal bounds, and whether it's maximized. A fullscreen
/// window remembers the bounds it returns to, as not maximized.
pub fn remembered(bounds: WindowBounds) -> WindowState {
    let (normal, maximized) = match bounds {
        WindowBounds::Windowed(normal) => (normal, false),
        WindowBounds::Maximized(normal) => (normal, true),
        WindowBounds::Fullscreen(normal) => (normal, false),
    };
    WindowState {
        x: f32::from(normal.origin.x).round() as i32,
        y: f32::from(normal.origin.y).round() as i32,
        width: f32::from(normal.size.width).round().max(1.) as u32,
        height: f32::from(normal.size.height).round().max(1.) as u32,
        maximized,
    }
}

/// Whether windows go where the client asks on this platform.
pub fn platform_places_windows(cx: &App) -> bool {
    cx.compositor_name() != "Wayland"
}

/// The window's opening bounds, from the settings.
pub fn opening_bounds(saved: Option<&WindowState>, cx: &App) -> WindowBounds {
    let mut displays: Vec<Bounds<Pixels>> = Vec::new();
    if let Some(primary) = cx.primary_display() {
        displays.push(primary.bounds());
    }
    for display in cx.displays() {
        let bounds = display.bounds();
        if !displays.contains(&bounds) {
            displays.push(bounds);
        }
    }
    placement(saved, &displays, platform_places_windows(cx))
}

/// Saves the window's bounds into the app's settings shortly after they stop changing.
pub fn remember_window(app: &Entity<AppRoot>, window: &mut Window, cx: &mut App) {
    app.update(cx, |_, cx| {
        let pending = std::rc::Rc::new(std::cell::Cell::new(0u64));
        cx.observe_window_bounds(window, move |_, window, cx| {
            let generation = pending.get().wrapping_add(1);
            pending.set(generation);
            let pending = pending.clone();
            cx.spawn_in(window, async move |this, cx| {
                cx.background_executor().timer(SAVE_AFTER).await;
                if pending.get() != generation {
                    return; // A later change will save.
                }
                this.update_in(cx, |root, window, _| root.save_window_state(window))
                    .ok();
            })
            .detach();
        })
        .detach();
    });
}

/// The tray, the notifier and the channel the desktop's events arrive on, made before the window.
pub struct DesktopServices {
    pub sink: DesktopEventSink,
    events: async_channel::Receiver<DesktopEvent>,
    pub tray: Option<Arc<DesktopTray>>,
    pub notifier: Option<Arc<dyn Notifier>>,
}

impl DesktopServices {
    /// The channel, and the tray and the OS notifier when `with_os` (not in rigs and tests, which
    /// must not reach the desktop).
    pub fn start(close_to_tray: bool, with_os: bool, cx: &mut App) -> Self {
        let (sender, events) = async_channel::unbounded();
        let sink: DesktopEventSink = Arc::new(move |event| {
            let _ = sender.try_send(event);
        });
        let tray = with_os.then(|| {
            Arc::new(tray::start(
                TrayOptions {
                    close_to_tray,
                    // Check for Updates is offered once the updater has started.
                    updates_enabled: false,
                },
                sink.clone(),
            ))
        });
        let notifier = with_os.then(|| crate::notifier::start(sink.clone(), cx));
        Self {
            sink,
            events,
            tray,
            notifier,
        }
    }
}

/// The desktop side of the app, as a global: the tray (the app-wiring unit hands it to core for the
/// unread count), the OS notifier (for core's `Notify`) and whether the window is hidden.
pub struct DesktopShell {
    tray: Option<Arc<DesktopTray>>,
    notifier: Option<Arc<dyn Notifier>>,
    window: AnyWindowHandle,
    app: WeakEntity<AppRoot>,
    hidden: Rc<Cell<bool>>,
}

impl Global for DesktopShell {}

impl DesktopShell {
    pub fn tray(&self) -> Option<Arc<DesktopTray>> {
        self.tray.clone()
    }

    pub fn notifier(&self) -> Option<Arc<dyn Notifier>> {
        self.notifier.clone()
    }

    pub fn is_hidden(&self) -> bool {
        self.hidden.get()
    }

    /// Closes the window as the title bar's button does: hides it when close to tray is on (and a
    /// tray can bring it back), otherwise closes it, which quits. The menu's Close Window and its
    /// Ctrl+W use this, so both ways end the same.
    pub fn close_window(cx: &mut App) {
        let Some(shell) = cx.try_global::<DesktopShell>() else {
            return;
        };
        let (window, app, tray, hidden) = (
            shell.window,
            shell.app.clone(),
            shell.tray.clone(),
            shell.hidden.clone(),
        );
        let _ = window.update(cx, |_, window, cx| {
            if close_or_hide(&app, tray.as_deref(), &hidden, window, cx) {
                window.remove_window();
            }
        });
    }
}

/// Whether closing the window should hide it rather than quit.
pub fn hides_on_close(setting: bool, tray_on_a_panel: bool, platform_can_hide: bool) -> bool {
    setting && tray_on_a_panel && platform_can_hide
}

/// Closes the window the way its title bar does: saved bounds, then hide when close to tray is on
/// and a tray can bring it back, otherwise close. Returns true when the window should close; the
/// menu's Close Window calls this and then removes the window itself.
pub fn close_or_hide(
    app: &WeakEntity<AppRoot>,
    tray: Option<&DesktopTray>,
    hidden: &Cell<bool>,
    window: &mut Window,
    cx: &mut App,
) -> bool {
    let setting = app
        .update(cx, |root, _| {
            root.save_window_state(window);
            root.settings().close_to_tray
        })
        .unwrap_or(false);
    let available = tray.is_some_and(|tray| tray.available());
    if hides_on_close(setting, available, window.can_hide_window())
        && window.set_window_visible(false)
    {
        hidden.set(true);
        app.update(cx, |root, cx| root.check_idle(cx)).ok();
        return false;
    }
    true
}

/// Wires the window to the desktop: close to tray, the event channel, the taskbar dot. Call once,
/// with the main window, from inside `open_window`.
pub fn attach(services: DesktopServices, app: &Entity<AppRoot>, window: &mut Window, cx: &mut App) {
    let DesktopServices {
        events,
        tray,
        notifier,
        ..
    } = services;
    let hidden = Rc::new(Cell::new(false));
    #[cfg(windows)]
    if let (Some(tray), Ok(handle)) = (
        &tray,
        raw_window_handle::HasWindowHandle::window_handle(window),
    ) {
        if let raw_window_handle::RawWindowHandle::Win32(handle) = handle.as_raw() {
            tray.set_taskbar_window(handle.hwnd.get());
        }
    }
    cx.set_global(DesktopShell {
        tray: tray.clone(),
        notifier,
        window: window.window_handle(),
        app: app.downgrade(),
        hidden: hidden.clone(),
    });

    let close_app = app.downgrade();
    let close_tray = tray.clone();
    let close_hidden = hidden.clone();
    window.on_window_should_close(cx, move |window, cx| {
        close_or_hide(&close_app, close_tray.as_deref(), &close_hidden, window, cx)
    });

    cx.spawn(async move |cx| {
        while let Ok(event) = events.recv().await {
            cx.update(|cx| handle(event, cx));
        }
    })
    .detach();
}

/// Shows the window if it's hidden, and brings it to the front.
fn show(window: &mut Window, hidden: &Cell<bool>, token: Option<&str>) {
    if hidden.get() && window.set_window_visible(true) {
        hidden.set(false);
    }
    match token {
        Some(token) => window.activate_window_with_token(token),
        None => window.activate_window(),
    }
}

fn handle(event: DesktopEvent, cx: &mut App) {
    let Some(shell) = cx.try_global::<DesktopShell>() else {
        return;
    };
    let (window, app, hidden, tray) = (
        shell.window,
        shell.app.clone(),
        shell.hidden.clone(),
        shell.tray.clone(),
    );
    match event {
        DesktopEvent::ToggleWindow => {
            // As Electron: a visible window hides (when it can come back), a hidden one shows.
            let _ = window.update(cx, |_, window, _| {
                let can_hide =
                    tray.as_ref().is_some_and(|tray| tray.available()) && window.can_hide_window();
                if !hidden.get() && can_hide {
                    if window.set_window_visible(false) {
                        hidden.set(true);
                    }
                } else {
                    show(window, &hidden, None);
                }
            });
        }
        DesktopEvent::SetCloseToTray(on) => {
            let _ = app.update(cx, |root, cx| root.set_close_to_tray(on, cx));
        }
        DesktopEvent::CheckForUpdates => {
            // The settings button's command, from the tray. It no-ops when the button would be
            // disabled (no updater, or one already working).
            let _ = app.update(cx, |root, cx| root.check_for_updates(cx));
        }
        DesktopEvent::Quit => cx.quit(),
        DesktopEvent::Opened {
            urls,
            activation_token,
        } => {
            let _ = window.update(cx, |_, window, _| {
                show(window, &hidden, activation_token.as_deref());
            });
            for url in urls {
                match semaphore_ui::nav::parse_deep_link(&url) {
                    Some(link) => {
                        let _ = app.update(cx, |root, cx| root.open_link(link, cx));
                    }
                    None => log::warn!(
                        "dropped a malformed semaphore:// link: {:?}",
                        url.chars().take(200).collect::<String>()
                    ),
                }
            }
        }
        DesktopEvent::NotificationClicked {
            tag,
            activation_token,
        } => {
            let _ = window.update(cx, |_, window, cx| {
                show(window, &hidden, activation_token.as_deref());
                app.update(cx, |root, cx| root.open_notification(&tag, window, cx))
            });
        }
    }
    // Shown or hidden: whether the user counts as idle may have changed.
    let _ = app.update(cx, |root, cx| root.check_idle(cx));
}

impl AppRoot {
    /// Writes the window's state to the settings, if it changed.
    pub fn save_window_state(&mut self, window: &Window) {
        let state = remembered(window.window_bounds());
        if self.settings().window.as_ref() != Some(&state) {
            self.update_settings(|settings| settings.window = Some(state));
        }
    }
}

// ---- semaphore:// links: who opens them, and registering for them from the settings. ----

/// What the "Open semaphore:// links with this app" setting asks for, given who owns the scheme
/// now. Pure, so the whole table is a test: a start and the switch both go through it.
///
/// - On, and another app (or nothing) owns the scheme: register, as a start always did.
/// - On, and it is already ours (or the installed package's): nothing to do.
/// - Off, and it is ours: take the registration away.
/// - Off otherwise: nothing — another app's or a package's registration isn't ours to remove.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkAction {
    Nothing,
    Register,
    Unregister,
}

pub fn link_action(open_links: bool, current: semaphore_ui::settings::LinkHandler) -> LinkAction {
    use semaphore_ui::settings::LinkHandler;
    match (open_links, current) {
        (true, LinkHandler::Registered | LinkHandler::PackageOwned) => LinkAction::Nothing,
        (true, _) => LinkAction::Register,
        (false, LinkHandler::Registered) => LinkAction::Unregister,
        (false, _) => LinkAction::Nothing,
    }
}

/// Who opens `semaphore://` links, and making it this app. Both touch the OS (files under the
/// user's XDG directories, or the registry), so they run off the UI thread; the rig fakes them.
pub trait LinkRegistrar: Send + Sync {
    fn status(&self) -> semaphore_ui::settings::LinkHandler;
    /// Registers this app for the links. `Err` says why not, in the user's words.
    fn register(&self) -> Result<semaphore_ui::settings::LinkHandler, String>;
    /// Takes this app's registration away, when it is this app's to take.
    fn unregister(&self) -> Result<semaphore_ui::settings::LinkHandler, String>;
    /// Why changing the registration is turned off here, if it is.
    fn blocked(&self) -> Option<String>;
    /// What registering would do that the user should know first.
    fn note(&self) -> Option<String>;
    /// What a start does when the user never chose: a packaged build registers, as it always
    /// has; a development build doesn't, so it can't take links from an installed app.
    fn default_open_links(&self) -> bool;

    /// Does what the setting asks for the current owner, then says who owns the scheme now.
    fn apply(&self, open_links: bool) -> Result<semaphore_ui::settings::LinkHandler, String> {
        let current = self.status();
        match link_action(open_links, current) {
            LinkAction::Nothing => Ok(current),
            LinkAction::Register => self.register(),
            LinkAction::Unregister => self.unregister(),
        }
    }
}

/// The OS's registration, for this executable (`links::RegisterTarget::from_env`).
pub struct DesktopLinks {
    target: Option<semaphore_platform_desktop::links::RegisterTarget>,
    /// Built with `SEMAPHORE_PACKAGED=1`: registers itself on every start unless told not to.
    packaged: bool,
    /// `SEMAPHORE_REGISTER_SCHEME=0`: never register or unregister.
    forbidden: bool,
}

impl DesktopLinks {
    pub fn from_env() -> Self {
        Self {
            target: semaphore_platform_desktop::links::RegisterTarget::from_env(),
            packaged: option_env!("SEMAPHORE_PACKAGED") == Some("1"),
            forbidden: std::env::var("SEMAPHORE_REGISTER_SCHEME").as_deref() == Ok("0"),
        }
    }
}

/// The settings' words for what the OS says.
pub fn link_handler(
    status: Result<
        semaphore_platform_desktop::links::LinkStatus,
        semaphore_core::platform::CoreError,
    >,
) -> semaphore_ui::settings::LinkHandler {
    use semaphore_platform_desktop::links::LinkStatus;
    use semaphore_ui::settings::LinkHandler;
    match status {
        Ok(LinkStatus::Ours) => LinkHandler::Registered,
        Ok(LinkStatus::Packaged(_)) => LinkHandler::PackageOwned,
        Ok(LinkStatus::Another(_)) => LinkHandler::AnotherApp,
        Ok(LinkStatus::NotRegistered) => LinkHandler::NotRegistered,
        Err(error) => {
            log::info!("who opens semaphore:// links: {error}");
            LinkHandler::Unknown
        }
    }
}

impl LinkRegistrar for DesktopLinks {
    fn status(&self) -> semaphore_ui::settings::LinkHandler {
        match &self.target {
            Some(target) => link_handler(semaphore_platform_desktop::links::status(target)),
            None => semaphore_ui::settings::LinkHandler::Unknown,
        }
    }

    fn register(&self) -> Result<semaphore_ui::settings::LinkHandler, String> {
        if let Some(why) = self.blocked() {
            return Err(why);
        }
        let target = self
            .target
            .as_ref()
            .ok_or_else(|| "Couldn't find this program to register it.".to_owned())?;
        semaphore_platform_desktop::links::register(target).map_err(|error| error.to_string())?;
        Ok(self.status())
    }

    fn unregister(&self) -> Result<semaphore_ui::settings::LinkHandler, String> {
        if let Some(why) = self.blocked() {
            return Err(why);
        }
        let target = self
            .target
            .as_ref()
            .ok_or_else(|| "Couldn't find this program to unregister it.".to_owned())?;
        semaphore_platform_desktop::links::unregister(target).map_err(|error| error.to_string())?;
        Ok(self.status())
    }

    fn blocked(&self) -> Option<String> {
        self.forbidden
            .then(|| "Turned off on this computer (SEMAPHORE_REGISTER_SCHEME=0).".to_owned())
    }

    fn note(&self) -> Option<String> {
        (!self.packaged).then(|| {
            "This is a development build: registering takes semaphore:// links away from an \
             installed Semaphore app until it registers again."
                .to_owned()
        })
    }

    fn default_open_links(&self) -> bool {
        self.packaged
    }
}

#[cfg(test)]
mod tests {
    // Not `super::*`: GPUI's glob brings its own `test` attribute.
    use super::{WindowState, hides_on_close, placement, rect, remembered};
    use gpui_kit::{Bounds, Pixels, WindowBounds, px, size};

    fn state(x: i32, y: i32, width: u32, height: u32, maximized: bool) -> WindowState {
        WindowState {
            x,
            y,
            width,
            height,
            maximized,
        }
    }

    const FHD: (f32, f32) = (1920., 1080.);

    fn screens() -> Vec<Bounds<Pixels>> {
        vec![rect(0., 0., FHD.0, FHD.1), rect(1920., 0., 2560., 1440.)]
    }

    #[test]
    fn a_first_start_is_centred_at_the_default_size() {
        assert_eq!(
            placement(None, &screens(), true),
            WindowBounds::Windowed(rect(320., 140., 1280., 800.))
        );
    }

    #[test]
    fn a_saved_window_returns_where_it_was_on_any_display() {
        let saved = state(2100, 200, 1600, 1000, false);
        assert_eq!(
            placement(Some(&saved), &screens(), true),
            WindowBounds::Windowed(rect(2100., 200., 1600., 1000.))
        );
        let maximized = state(10, 20, 1000, 700, true);
        assert_eq!(
            placement(Some(&maximized), &screens(), true),
            WindowBounds::Maximized(rect(10., 20., 1000., 700.))
        );
    }

    #[test]
    fn a_window_on_an_unplugged_display_is_centred() {
        let saved = state(5000, 200, 1000, 700, false);
        assert_eq!(
            placement(Some(&saved), &screens(), true),
            WindowBounds::Windowed(rect(460., 190., 1000., 700.))
        );
        // Only a sliver showing counts as gone too.
        let sliver = state(-990, 100, 1000, 700, false);
        assert!(matches!(
            placement(Some(&sliver), &screens(), true),
            WindowBounds::Windowed(bounds) if bounds.origin.x == px(460.)
        ));
    }

    #[test]
    fn without_client_positions_only_the_size_and_maximized_return() {
        let saved = state(2100, 200, 1600, 1000, true);
        assert_eq!(
            placement(Some(&saved), &screens(), false),
            WindowBounds::Maximized(rect(160., 40., 1600., 1000.))
        );
    }

    #[test]
    fn sizes_are_clamped_to_a_usable_window_on_the_display() {
        let tiny = state(0, 0, 10, 10, false);
        assert!(matches!(
            placement(Some(&tiny), &screens(), true),
            WindowBounds::Windowed(bounds) if bounds.size == size(px(480.), px(360.))
        ));
        let huge = state(0, 0, 9000, 9000, false);
        assert!(matches!(
            placement(Some(&huge), &screens(), true),
            WindowBounds::Windowed(bounds) if bounds.size == size(px(1920.), px(1080.))
        ));
        // No display reported (headless): the saved size at the origin.
        assert_eq!(
            placement(None, &[], true),
            WindowBounds::Windowed(rect(0., 0., 1280., 800.))
        );
    }

    #[test]
    fn the_normal_bounds_are_remembered() {
        assert_eq!(
            remembered(WindowBounds::Maximized(rect(10.4, -20.6, 1000., 700.))),
            state(10, -21, 1000, 700, true)
        );
        assert_eq!(
            remembered(WindowBounds::Fullscreen(rect(0., 0., 800., 600.))),
            state(0, 0, 800, 600, false)
        );
        // What's remembered places the window where it was.
        let back = remembered(WindowBounds::Windowed(rect(300., 200., 900., 640.)));
        assert_eq!(
            placement(Some(&back), &screens(), true),
            WindowBounds::Windowed(rect(300., 200., 900., 640.))
        );
    }

    #[test]
    fn closing_hides_only_when_something_can_bring_it_back() {
        assert!(hides_on_close(true, true, true));
        // The setting off, no panel showing our icon (Hyprland without a bar's tray), or a
        // platform that can't hide: closing quits.
        assert!(!hides_on_close(false, true, true));
        assert!(!hides_on_close(true, false, true));
        assert!(!hides_on_close(true, true, false));
    }

    // ---- semaphore:// links: the setting's decision table, through the seam ----

    mod links {
        use super::super::{LinkAction, LinkRegistrar, link_action};
        use semaphore_ui::settings::LinkHandler;
        use std::sync::Mutex;
        use std::sync::atomic::{AtomicBool, Ordering};

        #[test]
        fn the_action_is_the_setting_and_who_owns_the_scheme_now() {
            use LinkAction::{Nothing, Register, Unregister};
            use LinkHandler::{AnotherApp, NotRegistered, PackageOwned, Registered, Unknown};
            let cases = [
                (true, Registered, Nothing),
                (true, PackageOwned, Nothing),
                (true, AnotherApp, Register),
                (true, NotRegistered, Register),
                (true, Unknown, Register),
                (false, Registered, Unregister),
                (false, PackageOwned, Nothing),
                (false, AnotherApp, Nothing),
                (false, NotRegistered, Nothing),
                (false, Unknown, Nothing),
            ];
            for (open_links, current, expected) in cases {
                assert_eq!(
                    link_action(open_links, current),
                    expected,
                    "open_links={open_links}, owner={current:?}"
                );
            }
        }

        /// The rig's kind of fake: no registry, no mimeapps, just the calls.
        #[derive(Default)]
        struct FakeLinks {
            registered: AtomicBool,
            calls: Mutex<Vec<&'static str>>,
        }

        impl FakeLinks {
            fn calls(&self) -> Vec<&'static str> {
                self.calls.lock().unwrap().clone()
            }
        }

        impl LinkRegistrar for FakeLinks {
            fn status(&self) -> LinkHandler {
                if self.registered.load(Ordering::Relaxed) {
                    LinkHandler::Registered
                } else {
                    LinkHandler::NotRegistered
                }
            }
            fn register(&self) -> Result<LinkHandler, String> {
                self.calls.lock().unwrap().push("register");
                self.registered.store(true, Ordering::Relaxed);
                Ok(self.status())
            }
            fn unregister(&self) -> Result<LinkHandler, String> {
                self.calls.lock().unwrap().push("unregister");
                self.registered.store(false, Ordering::Relaxed);
                Ok(self.status())
            }
            fn blocked(&self) -> Option<String> {
                None
            }
            fn note(&self) -> Option<String> {
                None
            }
            fn default_open_links(&self) -> bool {
                false
            }
        }

        #[test]
        fn the_setting_registers_and_takes_the_registration_back_through_the_seam() {
            let links = FakeLinks::default();
            let owner = links.apply(true).unwrap();
            assert_eq!(owner, LinkHandler::Registered);
            assert_eq!(links.calls(), ["register"]);
            // Already ours: turning it on again writes nothing.
            assert_eq!(links.apply(true).unwrap(), LinkHandler::Registered);
            assert_eq!(links.calls(), ["register"]);
            assert_eq!(links.apply(false).unwrap(), LinkHandler::NotRegistered);
            assert_eq!(links.calls(), ["register", "unregister"]);
            // Nothing of ours to take away.
            assert_eq!(links.apply(false).unwrap(), LinkHandler::NotRegistered);
            assert_eq!(links.calls(), ["register", "unregister"]);
        }
    }
}
