//! The tray icon: show/hide, close to tray, quit, and a dot while anything is unread. Electron's
//! `setupTray`, minus "Check for Updates" until there's an updater.
//!
//! - **Linux:** a StatusNotifierItem with a dbusmenu ([`ksni`], on its own thread, async-io like
//!   every zbus user here). Panels without a StatusNotifier host (a bare Hyprland, GNOME without the
//!   AppIndicator extension) show nothing; [`DesktopTray::available`] then says so and the app
//!   doesn't hide on close, since nothing could bring it back. The unread count also goes to
//!   `com.canonical.Unity.LauncherEntry`, which KDE's task manager and GNOME docks show.
//! - **Windows:** `Shell_NotifyIconW` from a message-only window on its own thread, added again
//!   when Explorer restarts.
//!
//! Every method only queues for the tray's thread, so any thread (core's, the UI's) may call it.

use crate::DesktopEventSink;
use semaphore_core::platform::{CoreError, Tray};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

#[cfg(target_os = "linux")]
mod linux;

/// Where the tray icon is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayStatus {
    /// Connecting to the panel.
    Starting,
    /// On a panel.
    Shown,
    /// Nothing shows tray icons right now (it may come later: a panel that starts after the app).
    NoHost,
    /// No tray on this system, for good: no session bus, or no platform support.
    Failed,
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) enum Command {
    Unread(u32),
    CloseToTray(bool),
    Shutdown,
}

pub(crate) struct Shared {
    status: Mutex<TrayStatus>,
}

impl Shared {
    pub(crate) fn set_status(&self, status: TrayStatus) {
        let mut current = self
            .status
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if *current != status {
            log::info!("tray: {status:?}");
            *current = status;
        }
    }
}

pub struct TrayOptions {
    /// The "Close to tray" check box's first state.
    pub close_to_tray: bool,
}

pub struct DesktopTray {
    shared: Arc<Shared>,
    commands: Mutex<mpsc::Sender<Command>>,
}

/// The menu's labels, shared by both platforms.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) const SHOW_HIDE: &str = "Show/Hide Semaphore";
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) const CLOSE_TO_TRAY: &str = "Close to Tray";
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) const QUIT: &str = "Quit";

/// The tooltip: the app's name, and the count while anything is unread.
pub fn tooltip(unread: u32) -> String {
    match unread {
        0 => "Semaphore".into(),
        count => format!("Semaphore: {count} unread"),
    }
}

/// Starts the tray on a thread of its own. Never fails: see [`DesktopTray::status`].
pub fn start(options: TrayOptions, sink: DesktopEventSink) -> DesktopTray {
    let shared = Arc::new(Shared {
        status: Mutex::new(TrayStatus::Starting),
    });
    let (sender, receiver) = mpsc::channel();
    let thread_shared = shared.clone();
    let spawned = std::thread::Builder::new()
        .name("tray".into())
        .spawn(move || run(options, sink, thread_shared, receiver));
    if let Err(error) = spawned {
        log::warn!("tray: cannot start its thread: {error}");
        shared.set_status(TrayStatus::Failed);
    }
    DesktopTray {
        shared,
        commands: Mutex::new(sender),
    }
}

#[cfg(target_os = "linux")]
fn run(
    options: TrayOptions,
    sink: DesktopEventSink,
    shared: Arc<Shared>,
    commands: mpsc::Receiver<Command>,
) {
    linux::run(options, sink, shared, commands);
}

#[cfg(not(target_os = "linux"))]
fn run(_: TrayOptions, _: DesktopEventSink, shared: Arc<Shared>, _: mpsc::Receiver<Command>) {
    shared.set_status(TrayStatus::Failed);
}

impl DesktopTray {
    pub fn status(&self) -> TrayStatus {
        *self
            .shared
            .status
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Whether the icon is on a panel now, so a hidden window can be brought back.
    pub fn available(&self) -> bool {
        self.status() == TrayStatus::Shown
    }

    /// Sets the menu's "Close to tray" check box (after the setting changed elsewhere).
    pub fn set_close_to_tray(&self, on: bool) {
        self.send(Command::CloseToTray(on));
    }

    /// Takes the icon off the panel. The thread ends.
    pub fn shutdown(&self) {
        self.send(Command::Shutdown);
    }

    fn send(&self, command: Command) {
        let commands = self
            .commands
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let _ = commands.send(command);
    }
}

impl Drop for DesktopTray {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl Tray for DesktopTray {
    fn set_unread(&self, count: u32) -> Result<(), CoreError> {
        self.send(Command::Unread(count));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tooltip_carries_the_count() {
        assert_eq!(tooltip(0), "Semaphore");
        assert_eq!(tooltip(3), "Semaphore: 3 unread");
    }
}
