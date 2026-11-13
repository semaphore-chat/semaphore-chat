//! The Linux tray on a private session bus (`dbus-daemon`, in a temp dir) with a fake
//! StatusNotifierWatcher: nothing reaches the desktop's own bus or panel.
//!
//! One test function, because the session bus address is process-wide. The build image can't start
//! `dbus-daemon` (its uid has no passwd entry), so there the test skips; `scripts/desktop-probe.sh`
//! runs it in the desktop image with `SEMAPHORE_REQUIRE_DBUS=1`, where a skip is a failure.
#![cfg(target_os = "linux")]

use semaphore_core::platform::Tray as _;
use semaphore_platform_desktop::tray::{self, TrayOptions, TrayStatus};
use semaphore_platform_desktop::{DesktopEvent, DesktopEventSink};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};
use zbus::zvariant::{OwnedValue, Value};

const PATIENCE: Duration = Duration::from_secs(10);

struct Bus(Child);

impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn private_bus() -> Option<(Bus, String)> {
    let dir = std::env::temp_dir().join(format!("semaphore-tray-bus-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let mut child = Command::new("dbus-daemon")
        .args(["--session", "--nofork", "--print-address=1"])
        .arg(format!("--address=unix:path={}", dir.join("bus").display()))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let mut address = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut address)
        .ok()?;
    let bus = Bus(child);
    let address = address.trim().to_owned();
    (!address.is_empty()).then_some((bus, address))
}

/// Polls `check` until it holds.
fn until(what: &str, mut check: impl FnMut() -> bool) {
    let deadline = Instant::now() + PATIENCE;
    while !check() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

struct Watcher {
    items: Arc<Mutex<Vec<String>>>,
}

#[zbus::interface(name = "org.kde.StatusNotifierWatcher")]
impl Watcher {
    fn register_status_notifier_item(
        &self,
        service: &str,
        #[zbus(header)] header: zbus::message::Header<'_>,
    ) {
        let sender = header
            .sender()
            .map(|name| name.to_string())
            .unwrap_or_default();
        let name = if service.starts_with('/') {
            sender
        } else {
            service.to_owned()
        };
        self.items.lock().unwrap().push(name);
    }

    fn register_status_notifier_host(&self, _service: &str) {}

    #[zbus(property)]
    fn registered_status_notifier_items(&self) -> Vec<String> {
        self.items.lock().unwrap().clone()
    }

    #[zbus(property)]
    fn is_status_notifier_host_registered(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn protocol_version(&self) -> i32 {
        0
    }
}

fn start_watcher(items: Arc<Mutex<Vec<String>>>) -> zbus::Connection {
    zbus::block_on(async {
        zbus::connection::Builder::session()?
            .name("org.kde.StatusNotifierWatcher")?
            .serve_at("/StatusNotifierWatcher", Watcher { items })?
            .build()
            .await
    })
    .expect("the fake watcher starts")
}

fn get(connection: &zbus::Connection, item: &str, property: &str) -> OwnedValue {
    let reply = zbus::block_on(connection.call_method(
        Some(item),
        "/StatusNotifierItem",
        Some("org.freedesktop.DBus.Properties"),
        "Get",
        &("org.kde.StatusNotifierItem", property),
    ))
    .unwrap();
    let value: OwnedValue = reply.body().deserialize().unwrap();
    value
}

type Pixmaps = Vec<(i32, i32, Vec<u8>)>;

fn pixmaps(connection: &zbus::Connection, item: &str) -> Pixmaps {
    Pixmaps::try_from(get(connection, item, "IconPixmap")).unwrap()
}

fn tooltip_title(connection: &zbus::Connection, item: &str) -> String {
    let (_, _, title, _): (String, Pixmaps, String, String) =
        get(connection, item, "ToolTip").try_into().unwrap();
    title
}

/// The menu's items by label, from dbusmenu's `GetGroupProperties`.
fn menu_ids(connection: &zbus::Connection, item: &str) -> HashMap<String, i32> {
    let reply = zbus::block_on(connection.call_method(
        Some(item),
        "/MenuBar",
        Some("com.canonical.dbusmenu"),
        "GetGroupProperties",
        &(Vec::<i32>::new(), vec!["label"]),
    ))
    .unwrap();
    let groups: Vec<(i32, HashMap<String, OwnedValue>)> = reply.body().deserialize().unwrap();
    groups
        .into_iter()
        .filter_map(|(id, properties)| {
            let label = String::try_from(properties.get("label")?.clone()).ok()?;
            Some((label, id))
        })
        .collect()
}

/// Whether an item can be activated, from dbusmenu's `enabled`.
fn enabled(connection: &zbus::Connection, item: &str, id: i32) -> bool {
    let reply = zbus::block_on(connection.call_method(
        Some(item),
        "/MenuBar",
        Some("com.canonical.dbusmenu"),
        "GetGroupProperties",
        &(vec![id], vec!["enabled"]),
    ))
    .unwrap();
    let groups: Vec<(i32, HashMap<String, OwnedValue>)> = reply.body().deserialize().unwrap();
    // dbusmenu leaves a property out when it has its default, and `enabled` defaults to true.
    groups[0]
        .1
        .get("enabled")
        .map_or(true, |value| bool::try_from(value.clone()).unwrap())
}

/// A check box's `toggle-state`: 1 checked, 0 not.
fn toggle_state(connection: &zbus::Connection, item: &str, id: i32) -> i32 {
    let reply = zbus::block_on(connection.call_method(
        Some(item),
        "/MenuBar",
        Some("com.canonical.dbusmenu"),
        "GetGroupProperties",
        &(vec![id], vec!["toggle-state"]),
    ))
    .unwrap();
    let groups: Vec<(i32, HashMap<String, OwnedValue>)> = reply.body().deserialize().unwrap();
    i32::try_from(groups[0].1["toggle-state"].clone()).unwrap()
}

fn click(connection: &zbus::Connection, item: &str, id: i32) {
    zbus::block_on(connection.call_method(
        Some(item),
        "/MenuBar",
        Some("com.canonical.dbusmenu"),
        "Event",
        &(id, "clicked", Value::from(0i32), 0u32),
    ))
    .unwrap();
}

/// The tray's log lines on stderr, shown when the test fails.
struct StderrLog;

impl log::Log for StderrLog {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        if record.target().starts_with("semaphore") {
            eprintln!("{} {}: {}", record.level(), record.target(), record.args());
        }
    }
    fn flush(&self) {}
}

#[test]
fn the_tray_registers_shows_unread_and_sends_its_menu() {
    let _ = log::set_logger(&StderrLog);
    log::set_max_level(log::LevelFilter::Debug);
    let Some((_bus, address)) = private_bus() else {
        assert!(
            std::env::var_os("SEMAPHORE_REQUIRE_DBUS").is_none(),
            "dbus-daemon didn't start"
        );
        eprintln!("skipped: dbus-daemon can't start here (scripts/desktop-probe.sh runs this)");
        return;
    };
    // SAFETY: before any other thread of this test binary touches the environment or the bus.
    unsafe { std::env::set_var("DBUS_SESSION_BUS_ADDRESS", &address) };

    let (sender, events) = mpsc::channel();
    let sender = Mutex::new(sender);
    let sink: DesktopEventSink = Arc::new(move |event| {
        let _ = sender.lock().unwrap().send(event);
    });

    // No watcher yet: the item waits, and the app mustn't hide.
    let tray = tray::start(
        TrayOptions {
            close_to_tray: true,
            updates_enabled: false,
        },
        sink,
    );
    until("no host", || tray.status() == TrayStatus::NoHost);
    assert!(!tray.available());

    // A panel starts: the item registers with it.
    let items = Arc::new(Mutex::new(Vec::new()));
    let watcher = start_watcher(items.clone());
    until("registration", || !items.lock().unwrap().is_empty());
    until("shown", || tray.available());
    let item = items.lock().unwrap()[0].clone();
    let client = zbus::block_on(zbus::Connection::session()).unwrap();

    let id = String::try_from(get(&client, &item, "Id")).unwrap();
    assert_eq!(id, "app.semaphorechat.semaphore");
    let plain = pixmaps(&client, &item);
    assert_eq!(
        plain.iter().map(|(w, h, _)| (*w, *h)).collect::<Vec<_>>(),
        vec![(22, 22), (32, 32), (64, 64)]
    );
    assert_eq!(tooltip_title(&client, &item), "Semaphore");

    // Unread: the dot, the count in the tooltip, and on the launcher entry.
    let launcher = zbus::block_on(zbus::MessageStream::for_match_rule(
        zbus::MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface("com.canonical.Unity.LauncherEntry")
            .unwrap()
            .member("Update")
            .unwrap()
            .build(),
        &client,
        None,
    ))
    .unwrap();
    tray.set_unread(3).unwrap();
    until("the dot", || pixmaps(&client, &item) != plain);
    assert_eq!(tooltip_title(&client, &item), "Semaphore: 3 unread");
    let dotted = pixmaps(&client, &item);
    let (size, _, argb) = &dotted[1];
    // ARGB, network order: the dot's centre in the 32 px icon's top-right is opaque red.
    let (x, y) = (*size as usize - 9, 8usize);
    let at = &argb[(y * *size as usize + x) * 4..][..4];
    assert_eq!(at, [255, 0xe5, 0x39, 0x35]);

    let update = zbus::block_on(async {
        use futures_util::StreamExt as _;
        let mut launcher = launcher;
        launcher.next().await
    })
    .unwrap()
    .unwrap();
    let (uri, properties): (String, HashMap<String, OwnedValue>) =
        update.body().deserialize().unwrap();
    assert_eq!(uri, "application://app.semaphorechat.semaphore.desktop");
    assert_eq!(i64::try_from(properties["count"].clone()).unwrap(), 3);
    assert!(bool::try_from(properties["count-visible"].clone()).unwrap());

    tray.set_unread(0).unwrap();
    until("the dot gone", || pixmaps(&client, &item) == plain);

    // A click on the icon toggles the window.
    zbus::block_on(client.call_method(
        Some(item.as_str()),
        "/StatusNotifierItem",
        Some("org.kde.StatusNotifierItem"),
        "Activate",
        &(0i32, 0i32),
    ))
    .unwrap();
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        DesktopEvent::ToggleWindow
    );

    // The menu: Show/Hide, Close to Tray (checked, toggles off), Check for Updates (disabled
    // until the updater is), Quit. Nothing else.
    let ids = menu_ids(&client, &item);
    let mut labels: Vec<&str> = ids.keys().map(String::as_str).collect();
    labels.sort_unstable();
    assert_eq!(
        labels,
        vec![
            "Check for Updates",
            "Close to Tray",
            "Quit",
            "Show/Hide Semaphore"
        ]
    );
    assert!(!enabled(&client, &item, ids["Check for Updates"]));
    click(&client, &item, ids["Show/Hide Semaphore"]);
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        DesktopEvent::ToggleWindow
    );
    click(&client, &item, ids["Close to Tray"]);
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        DesktopEvent::SetCloseToTray(false)
    );
    until("the check box off", || {
        toggle_state(&client, &item, ids["Close to Tray"]) == 0
    });
    // The setting changed elsewhere (the app's settings page): the check box follows.
    tray.set_close_to_tray(true);
    until("the check box back on", || {
        toggle_state(&client, &item, ids["Close to Tray"]) == 1
    });
    // The updater started (or a check finished): the item follows the settings button.
    tray.set_updates_enabled(true);
    until("Check for Updates enabled", || {
        enabled(&client, &item, ids["Check for Updates"])
    });
    click(&client, &item, ids["Check for Updates"]);
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        DesktopEvent::CheckForUpdates
    );
    click(&client, &item, ids["Quit"]);
    assert_eq!(events.recv_timeout(PATIENCE).unwrap(), DesktopEvent::Quit);

    // The panel goes away: the app may no longer hide. It comes back: registered again.
    drop(watcher);
    until("no host again", || tray.status() == TrayStatus::NoHost);
    items.lock().unwrap().clear();
    let _watcher = start_watcher(items.clone());
    until("registered again", || !items.lock().unwrap().is_empty());
    until("shown again", || tray.available());

    tray.shutdown();
    until("shut down", || tray.status() == TrayStatus::Failed);
}
