//! The Linux notifier on a private session bus (`dbus-daemon`, in a temp dir) with a fake
//! `org.freedesktop.Notifications`: nothing reaches the desktop's own bus or notification daemon.
//!
//! One test function, because the session bus address is process-wide. Like `tray_linux.rs`, it
//! skips where `dbus-daemon` can't start (the build image); `scripts/desktop-probe.sh` runs it with
//! `SEMAPHORE_REQUIRE_DBUS=1`, where a skip is a failure.
#![cfg(target_os = "linux")]

use semaphore_core::model::{Conversation, MessageLink, OsNotification};
use semaphore_core::platform::Notifier as _;
use semaphore_platform_desktop::notify::FreedesktopNotifier;
use semaphore_platform_desktop::{DesktopEvent, DesktopEventSink};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};
use zbus::object_server::SignalEmitter;
use zbus::zvariant::OwnedValue;

const PATIENCE: Duration = Duration::from_secs(10);
const PATH: &str = "/org/freedesktop/Notifications";

struct Bus(Child);

impl Drop for Bus {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn private_bus() -> Option<(Bus, String)> {
    let dir = std::env::temp_dir().join(format!("semaphore-notify-bus-{}", std::process::id()));
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

#[derive(Debug, Clone)]
struct Shown {
    app_name: String,
    replaces_id: u32,
    app_icon: String,
    summary: String,
    body: String,
    actions: Vec<String>,
    hints: HashMap<String, OwnedValue>,
    id: u32,
}

#[derive(Default)]
struct Log {
    shown: Vec<Shown>,
    closed: Vec<u32>,
}

struct FakeService {
    log: Arc<Mutex<Log>>,
    live: HashSet<u32>,
    next: u32,
}

#[zbus::interface(name = "org.freedesktop.Notifications")]
impl FakeService {
    fn get_capabilities(&self) -> Vec<String> {
        vec!["actions".into(), "body".into(), "body-markup".into()]
    }

    fn get_server_information(&self) -> (String, String, String, String) {
        ("fake".into(), "semaphore".into(), "1".into(), "1.2".into())
    }

    #[allow(clippy::too_many_arguments)]
    fn notify(
        &mut self,
        app_name: String,
        replaces_id: u32,
        app_icon: String,
        summary: String,
        body: String,
        actions: Vec<String>,
        hints: HashMap<String, OwnedValue>,
        _expire_timeout: i32,
    ) -> u32 {
        let id = if self.live.contains(&replaces_id) {
            replaces_id
        } else {
            self.next += 1;
            self.next
        };
        self.live.insert(id);
        self.log.lock().unwrap().shown.push(Shown {
            app_name,
            replaces_id,
            app_icon,
            summary,
            body,
            actions,
            hints,
            id,
        });
        id
    }

    async fn close_notification(
        &mut self,
        id: u32,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) {
        self.live.remove(&id);
        self.log.lock().unwrap().closed.push(id);
        // 3: closed by a CloseNotification call.
        let _ = Self::notification_closed(&emitter, id, 3).await;
    }

    #[zbus(signal)]
    async fn notification_closed(
        emitter: &SignalEmitter<'_>,
        id: u32,
        reason: u32,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn action_invoked(
        emitter: &SignalEmitter<'_>,
        id: u32,
        action_key: &str,
    ) -> zbus::Result<()>;

    #[zbus(signal)]
    async fn activation_token(
        emitter: &SignalEmitter<'_>,
        id: u32,
        activation_token: &str,
    ) -> zbus::Result<()>;
}

fn start_service(log: Arc<Mutex<Log>>) -> zbus::Connection {
    zbus::block_on(async {
        zbus::connection::Builder::session()?
            .name("org.freedesktop.Notifications")?
            .serve_at(
                PATH,
                FakeService {
                    log,
                    live: HashSet::new(),
                    next: 0,
                },
            )?
            .build()
            .await
    })
    .expect("the fake notification service starts")
}

/// The service's side of a user's actions: a click sends the token, then the action.
fn emit(service: &zbus::Connection, member: &str, id: u32, text: Option<&str>) {
    zbus::block_on(async {
        let emitter = SignalEmitter::new(service, PATH).unwrap();
        match (member, text) {
            ("ActivationToken", Some(token)) => {
                FakeService::activation_token(&emitter, id, token).await
            }
            ("ActionInvoked", Some(action)) => {
                FakeService::action_invoked(&emitter, id, action).await
            }
            ("NotificationClosed", None) => FakeService::notification_closed(&emitter, id, 2).await,
            other => panic!("no such signal {other:?}"),
        }
    })
    .unwrap();
}

fn click(service: &zbus::Connection, id: u32, token: Option<&str>) {
    if let Some(token) = token {
        emit(service, "ActivationToken", id, Some(token));
    }
    emit(service, "ActionInvoked", id, Some("default"));
}

fn notification(tag: &str, title: &str, body: &str) -> OsNotification {
    OsNotification {
        id: format!("n-{title}"),
        tag: tag.into(),
        title: title.into(),
        body: body.into(),
        link: MessageLink {
            community_id: None,
            conversation: Conversation::DirectMessage { id: "d".into() },
            message_id: None,
        },
        parent_message_id: None,
        sound: None,
    }
}

fn clicked(tag: &str, token: Option<&str>) -> DesktopEvent {
    DesktopEvent::NotificationClicked {
        tag: tag.into(),
        activation_token: token.map(Into::into),
    }
}

#[test]
fn notifications_replace_by_tag_route_clicks_and_close() {
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

    let log = Arc::new(Mutex::new(Log::default()));
    let service = start_service(log.clone());
    let (sender, events) = mpsc::channel();
    let sender = Mutex::new(sender);
    let sink: DesktopEventSink = Arc::new(move |event| {
        let _ = sender.lock().unwrap().send(event);
    });
    let notifier = FreedesktopNotifier::start(sink);
    let shown = |count: usize| {
        until(&format!("{count} shown"), || {
            log.lock().unwrap().shown.len() >= count
        });
        log.lock().unwrap().shown[count - 1].clone()
    };

    // The first for a DM: a new notification, its body escaped for a markup server, with a default
    // action, the app's desktop entry, and no sound of the server's own.
    notifier
        .show(notification("dm:a", "Ava", "x < y & <b>z</b>"))
        .unwrap();
    let first = shown(1);
    assert_eq!(first.replaces_id, 0);
    assert_eq!(
        (first.app_name.as_str(), first.app_icon.as_str()),
        ("Semaphore", "app.semaphorechat.semaphore")
    );
    assert_eq!(first.summary, "Ava");
    assert_eq!(first.body, "x &lt; y &amp; &lt;b&gt;z&lt;/b&gt;");
    assert_eq!(first.actions.first().map(String::as_str), Some("default"));
    assert_eq!(
        String::try_from(first.hints["desktop-entry"].clone()).unwrap(),
        "app.semaphorechat.semaphore"
    );
    assert!(bool::try_from(first.hints["suppress-sound"].clone()).unwrap());

    // A newer one for the same DM replaces it; another conversation gets its own.
    notifier.show(notification("dm:a", "Ava", "again")).unwrap();
    let second = shown(2);
    assert_eq!((second.replaces_id, second.id), (first.id, first.id));
    notifier
        .show(notification("channel:b", "#general", "hello"))
        .unwrap();
    let channel = shown(3);
    assert_eq!(channel.replaces_id, 0);
    assert_ne!(channel.id, first.id);

    // A click comes back as its tag, with the activation token sent just before it.
    click(&service, first.id, Some("token-1"));
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        clicked("dm:a", Some("token-1"))
    );
    // A click without a token (an older server) still opens it.
    click(&service, channel.id, None);
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        clicked("channel:b", None)
    );

    // Closed (dismissed, expired): forgotten, so the next for that DM is a new notification. The
    // click on the channel after it is the barrier: signals arrive in order.
    emit(&service, "NotificationClosed", first.id, None);
    click(&service, channel.id, None);
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        clicked("channel:b", None)
    );
    notifier.show(notification("dm:a", "Ava", "third")).unwrap();
    let third = shown(4);
    assert_eq!(third.replaces_id, 0);
    assert_ne!(third.id, first.id);
    // A click on the closed one is nobody's.
    click(&service, first.id, None);

    // Withdrawn (read elsewhere): closed on the service, and its clicks no longer route.
    notifier.withdraw("channel:b");
    until("the close", || {
        log.lock().unwrap().closed.contains(&channel.id)
    });
    click(&service, channel.id, None);
    click(&service, third.id, Some("token-3"));
    assert_eq!(
        events.recv_timeout(PATIENCE).unwrap(),
        clicked("dm:a", Some("token-3"))
    );
    // Withdrawing what isn't shown sends nothing.
    notifier.withdraw("channel:nothing");

    // A plain notification is its own, never replacing another.
    notifier.notify("Title".into(), "Body".into()).unwrap();
    let plain = shown(5);
    assert_eq!(plain.replaces_id, 0);
    assert_eq!(plain.summary, "Title");
    assert_eq!(log.lock().unwrap().closed, vec![channel.id]);
    assert!(events.try_recv().is_err(), "no stray clicks");

    // Every method returned at once, from this (non-notifier) thread; dropping ends the thread.
    drop(notifier);
}
