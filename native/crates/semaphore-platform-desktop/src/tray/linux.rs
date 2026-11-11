//! The StatusNotifierItem, through `ksni` on async-io.
//!
//! `assume_sni_available` keeps the item running with no watcher on the bus, so a panel that starts
//! after the app (or restarts) still gets the icon: ksni re-registers when the watcher comes back,
//! and `watcher_online`/`watcher_offline` keep [`TrayStatus`] in step.

use super::{CLOSE_TO_TRAY, Command, QUIT, SHOW_HIDE, Shared, TrayOptions, TrayStatus, tooltip};
use crate::icon::{Rgba, app_icon, with_dot};
use crate::links::APP_ID;
use crate::{DesktopEvent, DesktopEventSink};
use ksni::blocking::TrayMethods as _;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, OnceLock};

/// What panels ask for: 22-24 px at 1x, more on HiDPI. The host picks the closest.
const SIZES: [u32; 3] = [22, 32, 64];

/// The Unity launcher API: a count on the dock or task manager entry.
pub(crate) const LAUNCHER_PATH: &str = "/app/semaphorechat/semaphore/launcher";
pub(crate) const LAUNCHER_INTERFACE: &str = "com.canonical.Unity.LauncherEntry";

struct Icons {
    plain: Vec<ksni::Icon>,
    dotted: Vec<ksni::Icon>,
}

fn sni_icon(icon: &Rgba) -> ksni::Icon {
    ksni::Icon {
        width: icon.size as i32,
        height: icon.size as i32,
        data: icon.to_argb_be(),
    }
}

fn icons() -> &'static Icons {
    static ICONS: OnceLock<Icons> = OnceLock::new();
    ICONS.get_or_init(|| {
        let plain: Vec<Rgba> = SIZES.iter().map(|&size| app_icon(size)).collect();
        Icons {
            dotted: plain.iter().map(|icon| sni_icon(&with_dot(icon))).collect(),
            plain: plain.iter().map(sni_icon).collect(),
        }
    })
}

struct Item {
    sink: DesktopEventSink,
    shared: Arc<Shared>,
    unread: u32,
    close_to_tray: bool,
}

impl ksni::Tray for Item {
    fn id(&self) -> String {
        APP_ID.into()
    }

    fn title(&self) -> String {
        "Semaphore".into()
    }

    fn category(&self) -> ksni::Category {
        ksni::Category::Communications
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        if self.unread > 0 {
            icons().dotted.clone()
        } else {
            icons().plain.clone()
        }
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        ksni::ToolTip {
            title: tooltip(self.unread),
            ..Default::default()
        }
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        (self.sink)(DesktopEvent::ToggleWindow);
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        use ksni::menu::{CheckmarkItem, StandardItem};
        vec![
            StandardItem {
                label: SHOW_HIDE.into(),
                activate: Box::new(|item: &mut Self| (item.sink)(DesktopEvent::ToggleWindow)),
                ..Default::default()
            }
            .into(),
            ksni::MenuItem::Separator,
            CheckmarkItem {
                label: CLOSE_TO_TRAY.into(),
                checked: self.close_to_tray,
                activate: Box::new(|item: &mut Self| {
                    item.close_to_tray = !item.close_to_tray;
                    (item.sink)(DesktopEvent::SetCloseToTray(item.close_to_tray));
                }),
                ..Default::default()
            }
            .into(),
            ksni::MenuItem::Separator,
            StandardItem {
                label: QUIT.into(),
                activate: Box::new(|item: &mut Self| (item.sink)(DesktopEvent::Quit)),
                ..Default::default()
            }
            .into(),
        ]
    }

    fn watcher_online(&self) {
        self.shared.set_status(TrayStatus::Shown);
    }

    fn watcher_offline(&self, reason: ksni::OfflineReason) -> bool {
        log::info!("tray: no StatusNotifier watcher ({reason:?})");
        self.shared.set_status(TrayStatus::NoHost);
        // Keep the item: the watcher may come (back) later.
        true
    }
}

/// Sends the launcher count on a connection of our own; ksni's isn't reachable.
fn send_launcher_count(connection: &zbus::Connection, count: u32) {
    let properties: HashMap<&str, zbus::zvariant::Value<'_>> = HashMap::from([
        ("count", zbus::zvariant::Value::from(i64::from(count))),
        ("count-visible", zbus::zvariant::Value::from(count > 0)),
    ]);
    let app_uri = format!("application://{APP_ID}.desktop");
    let sent = zbus::block_on(connection.emit_signal(
        None::<()>,
        LAUNCHER_PATH,
        LAUNCHER_INTERFACE,
        "Update",
        &(app_uri, properties),
    ));
    if let Err(error) = sent {
        log::debug!("tray: launcher count not sent: {error}");
    }
}

pub(super) fn run(
    options: TrayOptions,
    sink: DesktopEventSink,
    shared: Arc<Shared>,
    commands: mpsc::Receiver<Command>,
) {
    let item = Item {
        sink,
        shared: shared.clone(),
        unread: 0,
        close_to_tray: options.close_to_tray,
    };
    // Optimistic: a watcher that isn't there calls `watcher_offline` before `spawn` returns.
    shared.set_status(TrayStatus::Shown);
    let handle = match item.assume_sni_available(true).spawn() {
        Ok(handle) => handle,
        Err(error) => {
            log::warn!("tray: no StatusNotifierItem: {error}");
            shared.set_status(TrayStatus::Failed);
            return;
        }
    };
    let launcher = zbus::block_on(zbus::Connection::session())
        .inspect_err(|error| log::debug!("tray: no launcher count: {error}"))
        .ok();
    let mut unread = 0;
    for command in commands {
        match command {
            Command::Unread(count) => {
                if count == unread {
                    continue;
                }
                unread = count;
                handle.update(|item| item.unread = count);
                if let Some(connection) = &launcher {
                    send_launcher_count(connection, count);
                }
            }
            Command::CloseToTray(on) => {
                handle.update(|item| item.close_to_tray = on);
            }
            // The taskbar overlay is Windows'; the launcher count above is Linux's equivalent.
            Command::TaskbarWindow(_) => {}
            Command::Shutdown => break,
        }
    }
    handle.shutdown().wait();
    shared.set_status(TrayStatus::Failed);
}
