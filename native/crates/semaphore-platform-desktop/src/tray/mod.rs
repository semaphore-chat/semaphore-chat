//! The tray icon: show/hide, close to tray, check for updates, quit, and a dot while anything is
//! unread. Electron's `setupTray`.
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
#[cfg(windows)]
mod windows;

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

pub(crate) enum Command {
    Unread(u32),
    CloseToTray(bool),
    /// Whether "Check for Updates" can run: off while the updater is absent or busy, exactly when
    /// the settings button is disabled.
    Updates(bool),
    /// Windows: the app window whose taskbar button carries the dot.
    TaskbarWindow(#[cfg_attr(not(windows), allow(dead_code))] isize),
    Shutdown,
}

pub(crate) struct Shared {
    status: Mutex<TrayStatus>,
    /// Wakes a tray thread that waits on something other than the channel (Windows' message loop).
    waker: std::sync::OnceLock<Box<dyn Fn() + Send + Sync>>,
}

impl Shared {
    #[cfg_attr(not(windows), allow(dead_code))]
    pub(crate) fn set_waker(&self, waker: Box<dyn Fn() + Send + Sync>) {
        let _ = self.waker.set(waker);
    }

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
    /// The "Check for Updates" item's first state (disabled unless the app has an updater it
    /// isn't using).
    pub updates_enabled: bool,
}

pub struct DesktopTray {
    shared: Arc<Shared>,
    commands: Mutex<mpsc::Sender<Command>>,
}

/// The menu's labels, shared by both platforms.
pub(crate) const SHOW_HIDE: &str = "Show/Hide Semaphore";
pub(crate) const CLOSE_TO_TRAY: &str = "Close to Tray";
pub(crate) const CHECK_FOR_UPDATES: &str = "Check for Updates";
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
        waker: std::sync::OnceLock::new(),
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

#[cfg(windows)]
fn run(
    options: TrayOptions,
    sink: DesktopEventSink,
    shared: Arc<Shared>,
    commands: mpsc::Receiver<Command>,
) {
    windows::run(options, sink, shared, commands);
}

#[cfg(not(any(target_os = "linux", windows)))]
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

    /// Enables or disables the menu's "Check for Updates", as the settings button is.
    pub fn set_updates_enabled(&self, enabled: bool) {
        self.send(Command::Updates(enabled));
    }

    /// Windows: the window (an `HWND`) whose taskbar button shows the unread dot. Elsewhere
    /// nothing.
    pub fn set_taskbar_window(&self, hwnd: isize) {
        self.send(Command::TaskbarWindow(hwnd));
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
        drop(commands);
        // Windows' tray thread sleeps in its message loop, not on the channel: wake it, or the
        // command waits there until some unrelated message arrives (it never does).
        if let Some(wake) = self.shared.waker.get() {
            wake();
        }
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
    fn sending_a_command_wakes_the_tray_thread_after_queueing_it() {
        let shared = Arc::new(Shared {
            status: Mutex::new(TrayStatus::Shown),
            waker: std::sync::OnceLock::new(),
        });
        let (sender, receiver) = mpsc::channel();
        let receiver = Arc::new(Mutex::new(receiver));
        let woken = Arc::new(Mutex::new(Vec::new()));
        {
            let (receiver, woken) = (receiver.clone(), woken.clone());
            // Like the Windows thread: on a wake it drains the channel.
            shared.set_waker(Box::new(move || {
                let receiver = receiver.lock().unwrap();
                while let Ok(command) = receiver.try_recv() {
                    woken.lock().unwrap().push(match command {
                        Command::Updates(on) => format!("updates {on}"),
                        Command::Unread(count) => format!("unread {count}"),
                        Command::CloseToTray(on) => format!("close {on}"),
                        Command::TaskbarWindow(_) => "taskbar".into(),
                        Command::Shutdown => "shutdown".into(),
                    });
                }
            }));
        }
        let tray = DesktopTray {
            shared,
            commands: Mutex::new(sender),
        };
        tray.set_updates_enabled(true);
        tray.set_unread(2).unwrap();
        tray.set_close_to_tray(false);
        assert_eq!(
            *woken.lock().unwrap(),
            ["updates true", "unread 2", "close false"]
        );
        drop(tray);
        assert_eq!(woken.lock().unwrap().last().unwrap(), "shutdown");
    }

    #[test]
    fn the_tooltip_carries_the_count() {
        assert_eq!(tooltip(0), "Semaphore");
        assert_eq!(tooltip(3), "Semaphore: 3 unread");
    }
}
