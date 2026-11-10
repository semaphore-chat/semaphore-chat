//! U13's end-to-end rig: the real app, headless on lavapipe, against `semaphore-fake-server`.
//!
//!   rig-slice --server <url> --scenario <file.json> --script <file.steps> --out <dir>
//!
//! It runs `rig-shot`'s steps (click, type, press, drag, wait idle, shot, expect label...) and these:
//!
//! ```text
//! app 1280 800                        # opens the app's window
//! wait core session signed-in         # until true, or fails after 15 s
//! wait core text "hello" within 5     # a row on screen contains it
//! expect core count "hello" 1         # checks once, after settling
//! server drop_connections             # POST /__control/drop_connections
//! server post_as {"channelId": "cc-general", "authorId": "pri", "text": "hi"}
//! expect requests typingStart >= 1    # what the fake server saw, by operation or socket event
//! expect clipboard "some text"        # what the last copy put there contains this
//! os suspend                          # also resume, network-down, network-up
//! restart                             # quit as closing the window does, start again
//! expect stored-session yes           # a refresh token is in the (memory) keyring
//! ```
//!
//! Conditions: `session signed-in|signed-out|failed`, `connection connected|disconnected|offline`,
//! `rows >= N`, `text S`, `no-text S`, `sent S` (acked), `pending S`, `failed S`, `count S N`,
//! `channel ID`, `detached`, `live`, `label NAME`.

use anyhow::{Context as _, Result, anyhow, bail};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use rig_shot::driver::Driver;
use rig_shot::script;
use semaphore_app::{AppConfig, AppRoot, OsEvent};
use semaphore_core::model::{Conversation, MessageRow, SendState, SessionState};
use semaphore_core::platform::{Clock, CoreError, SecretStore};
use semaphore_core::{ConnectionState, NetworkState};
use semaphore_ui::kit::{UiAssets, set_reduced_motion};
use semaphore_ui::messages::TimeFormat;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_WITHIN: Duration = Duration::from_secs(15);
/// The longest a wait sits without news before looking again. Something always moves within this
/// while work is in flight; it bounds a look at a condition nothing will announce.
const LOOK_EVERY: Duration = Duration::from_millis(100);

/// The keyring stand-in: memory, so nothing touches the machine's secrets.
#[derive(Default)]
struct MemorySecrets(Mutex<HashMap<String, String>>);

impl SecretStore for MemorySecrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        Ok(self.0.lock().unwrap().get(&key).cloned())
    }
    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().insert(key, value);
        Ok(())
    }
    fn delete(&self, key: String) -> Result<(), CoreError> {
        self.0.lock().unwrap().remove(&key);
        Ok(())
    }
}

/// The scenario's time, moving with real time from when the rig started: a pending or failed row
/// shows the same day and minute on every run.
struct ScenarioClock {
    start_ms: i64,
    started: Instant,
}

impl Clock for ScenarioClock {
    fn now_ms(&self) -> u64 {
        (self.start_ms + self.started.elapsed().as_millis() as i64) as u64
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Condition {
    Session(String),
    Connection(String),
    Rows(usize),
    Text(String),
    NoText(String),
    Sent(String),
    Pending(String),
    Failed(String),
    Count(String, usize),
    Channel(String),
    Detached,
    Live,
    /// An element with this accessible name exists.
    Label(String),
}

#[derive(Debug, Clone, PartialEq)]
enum Step {
    Shot(script::Step),
    App {
        width: f32,
        height: f32,
    },
    Wait {
        condition: Condition,
        within: Duration,
    },
    Expect(Condition),
    Server {
        control: String,
        body: String,
    },
    ExpectRequests {
        name: String,
        at_least: usize,
    },
    ExpectClipboard(String),
    /// Clicks a row's control, `("retry", seq)` and the like, on the newest row containing the text.
    ClickRow {
        name: String,
        text: String,
    },
    /// What the OS watcher would report.
    Os(OsEvent),
    /// Quits the app as closing the window does, then starts it again on the same keyring and data.
    Restart,
    /// Whether a refresh token is stored.
    ExpectStoredSession(bool),
}

fn condition(words: &[&str]) -> Result<Condition> {
    let number = |value: &str| -> Result<usize> {
        value
            .parse()
            .map_err(|_| anyhow!("{value} is not a number"))
    };
    Ok(match words {
        ["session", state] => Condition::Session((*state).into()),
        ["connection", state] => Condition::Connection((*state).into()),
        ["rows", ">=", count] => Condition::Rows(number(count)?),
        ["text", text] => Condition::Text((*text).into()),
        ["no-text", text] => Condition::NoText((*text).into()),
        ["sent", text] => Condition::Sent((*text).into()),
        ["pending", text] => Condition::Pending((*text).into()),
        ["failed", text] => Condition::Failed((*text).into()),
        ["count", text, count] => Condition::Count((*text).into(), number(count)?),
        ["channel", id] => Condition::Channel((*id).into()),
        ["detached"] => Condition::Detached,
        ["live"] => Condition::Live,
        ["label", label] => Condition::Label((*label).into()),
        _ => bail!("not a condition: {}", words.join(" ")),
    })
}

fn parse(source: &str) -> Result<Vec<Step>> {
    let mut steps = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let at = |error: anyhow::Error| anyhow!("line {}: {error}", index + 1);
        let words = script::words(line).map_err(|error| at(anyhow!(error)))?;
        if words.is_empty() {
            continue;
        }
        let words: Vec<&str> = words.iter().map(String::as_str).collect();
        let step = match words.as_slice() {
            ["app", width, height] => Step::App {
                width: width.parse().map_err(|_| at(anyhow!("width")))?,
                height: height.parse().map_err(|_| at(anyhow!("height")))?,
            },
            ["wait", "core", rest @ ..] => {
                let (rest, within) = match rest {
                    [head @ .., "within", seconds] => (
                        head,
                        Duration::from_secs(seconds.parse().map_err(|_| at(anyhow!("within")))?),
                    ),
                    _ => (rest, DEFAULT_WITHIN),
                };
                Step::Wait {
                    condition: condition(rest).map_err(at)?,
                    within,
                }
            }
            ["expect", "core", rest @ ..] => Step::Expect(condition(rest).map_err(at)?),
            ["server", control] => Step::Server {
                control: (*control).into(),
                body: String::new(),
            },
            ["server", control, body] => Step::Server {
                control: (*control).into(),
                body: (*body).into(),
            },
            ["expect", "requests", name, ">=", count] => Step::ExpectRequests {
                name: (*name).into(),
                at_least: count.parse().map_err(|_| at(anyhow!("count")))?,
            },
            ["expect", "clipboard", text] => Step::ExpectClipboard((*text).into()),
            ["os", "suspend"] => Step::Os(OsEvent::Suspending),
            ["os", "resume"] => Step::Os(OsEvent::Resumed),
            ["os", "network-down"] => Step::Os(OsEvent::Network(NetworkState::Unavailable)),
            ["os", "network-up"] => Step::Os(OsEvent::Network(NetworkState::Available)),
            ["restart"] => Step::Restart,
            ["expect", "stored-session", "yes"] => Step::ExpectStoredSession(true),
            ["expect", "stored-session", "no"] => Step::ExpectStoredSession(false),
            ["click-row", name, text] => Step::ClickRow {
                name: (*name).into(),
                text: (*text).into(),
            },
            _ => Step::Shot(script::step(&words).map_err(|error| at(anyhow!(error)))?),
        };
        steps.push(step);
    }
    Ok(steps)
}

/// A POST to the fake server, over a bare socket: the rig needs nothing more than one request.
fn http(server: &str, method: &str, path: &str, body: &str) -> Result<Value> {
    let address = server
        .strip_prefix("http://")
        .ok_or_else(|| anyhow!("the server URL must be http://"))?
        .trim_end_matches('/');
    let mut stream =
        TcpStream::connect(address).with_context(|| format!("connecting {address}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let body = if body.is_empty() { "{}" } else { body };
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| anyhow!("no HTTP response"))?;
    if !head.starts_with("HTTP/1.1 200") {
        bail!("{method} {path}: {head}");
    }
    serde_json::from_str(body).with_context(|| format!("{path} answered {body}"))
}

/// The newest `sentAt` in a scenario plus a second: where the fake server's clock starts, so rows
/// show the same day and time on every run.
fn scenario_now_ms(path: &Path) -> Result<i64> {
    let json: Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let mut newest = 0i64;
    for section in [
        "messagesByChannel",
        "messagesByDmGroup",
        "threadRepliesByParent",
    ] {
        for messages in json[section]
            .as_object()
            .into_iter()
            .flat_map(|map| map.values())
        {
            for message in messages.as_array().into_iter().flatten() {
                if let Some(sent) = message["sentAt"].as_str() {
                    let ms = parse_rfc3339_ms(sent).with_context(|| sent.to_owned())?;
                    newest = newest.max(ms);
                }
            }
        }
    }
    Ok(newest + 1000)
}

/// `2026-09-22T18:00:00.000Z` to Unix milliseconds, without a date crate.
fn parse_rfc3339_ms(text: &str) -> Result<i64> {
    let digits = |range: std::ops::Range<usize>| -> Result<i64> {
        text.get(range)
            .and_then(|part| part.parse().ok())
            .ok_or_else(|| anyhow!("not RFC 3339"))
    };
    let (year, month, day) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    let (hour, minute, second) = (digits(11..13)?, digits(14..16)?, digits(17..19)?);
    let millis = if text.as_bytes().get(19) == Some(&b'.') {
        digits(20..23)?
    } else {
        0
    };
    // Days from the civil date, after Howard Hinnant's algorithm.
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Ok(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}

struct Rig {
    driver: Driver,
    server: String,
    now_ms: i64,
    app: Option<Entity<AppRoot>>,
    /// The keyring and the data directory, kept across a restart.
    secrets: Arc<MemorySecrets>,
    data_dir: PathBuf,
    size: (f32, f32),
}

impl Rig {
    fn new(server: String, now_ms: i64, data_dir: PathBuf) -> Self {
        let mut driver = Driver::new(Arc::new(UiAssets));
        driver.cx.update(|cx| {
            semaphore_app::init(cx);
            set_reduced_motion(true, cx);
        });
        // Core's work arrives from Tokio threads, so the scheduler may wait for it.
        driver.cx.allow_parking();
        Self {
            driver,
            server,
            now_ms,
            app: None,
            secrets: Arc::default(),
            data_dir,
            size: (1280., 800.),
        }
    }

    fn stored_session(&self) -> bool {
        self.secrets
            .0
            .lock()
            .unwrap()
            .keys()
            .any(|key| key.starts_with("refresh-token:"))
    }

    /// What closing the window does, then a new start.
    fn restart(&mut self) -> Result<()> {
        let app = self.app()?.clone();
        self.driver
            .cx
            .update(|cx| app.update(cx, |app, _| app.shutdown()));
        if let Some(window) = self.driver.window.take() {
            self.driver
                .cx
                .update_window(window, |_, window, _| window.remove_window())
                .context("closing the window")?;
        }
        self.app = None;
        self.driver.cx.run_until_parked();
        let (width, height) = self.size;
        self.open(width, height)
    }

    fn open(&mut self, width: f32, height: f32) -> Result<()> {
        self.size = (width, height);
        let config = AppConfig {
            secrets: self.secrets.clone(),
            data_dir: self.data_dir.clone(),
            watch_os: false,
            clock: Arc::new(ScenarioClock {
                start_ms: self.now_ms,
                started: Instant::now(),
            }),
            server_url: Some(self.server.clone()),
            time: TimeFormat::fixed(self.now_ms),
            scrollbar: false,
        };
        let mut app = None;
        let (handle, _) = self.driver.cx.update(|cx| {
            gpui_kit::open_window(
                semaphore_app::window_options(WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Default::default(),
                        size: size(px(width), px(height)),
                    })),
                    focus: false,
                    show: false,
                    ..Default::default()
                }),
                cx,
                |window, cx| {
                    let (root, built) = semaphore_app::build_root(config, window, cx);
                    app = Some(built);
                    root
                },
            )
        })?;
        self.driver.window = Some(handle);
        self.app = app;
        self.driver.settle()
    }

    fn app(&self) -> Result<&Entity<AppRoot>> {
        self.app
            .as_ref()
            .ok_or_else(|| anyhow!("no app is open: `app W H` first"))
    }

    fn rows(&mut self) -> Result<(Vec<MessageRow>, Option<Conversation>, bool)> {
        let app = self.app()?.clone();
        Ok(self.driver.cx.update(|cx| {
            let Some(pane) = app.read(cx).pane() else {
                return (Vec::new(), None, false);
            };
            let pane = pane.read(cx);
            let detached = pane.list().is_some_and(|list| list.read(cx).is_detached());
            (pane.rows().to_vec(), pane.conversation().cloned(), detached)
        }))
    }

    fn holds(&mut self, condition: &Condition) -> Result<bool> {
        if let Condition::Label(label) = condition {
            return self.driver.has_label(label);
        }
        let app = self.app()?.clone();
        let core = self.driver.cx.update(|cx| app.read(cx).core());
        let Some(core) = core else {
            return Ok(false);
        };
        let (rows, conversation, detached) = self.rows()?;
        fn matching<'a>(
            rows: &'a [MessageRow],
            text: &'a str,
        ) -> impl Iterator<Item = &'a MessageRow> {
            rows.iter().filter(move |row| row.display.contains(text))
        }
        Ok(match condition {
            Condition::Session(state) => match (state.as_str(), core.session()) {
                ("signed-in", SessionState::SignedIn { .. })
                | ("signed-out", SessionState::SignedOut)
                | ("failed", SessionState::SignInFailed { .. }) => true,
                ("signed-in" | "signed-out" | "failed", _) => false,
                (other, _) => bail!("unknown session state {other}"),
            },
            Condition::Connection(state) => {
                let wanted = match state.as_str() {
                    "connected" => ConnectionState::Connected,
                    "disconnected" => ConnectionState::Disconnected,
                    "offline" => ConnectionState::Offline,
                    "suspended" => ConnectionState::Suspended,
                    other => bail!("unknown connection state {other}"),
                };
                core.connection() == wanted
            }
            Condition::Rows(count) => rows.len() >= *count,
            Condition::Text(text) => matching(&rows, text).next().is_some(),
            Condition::NoText(text) => matching(&rows, text).next().is_none(),
            Condition::Sent(text) => matching(&rows, text)
                .any(|row| row.id.is_some() && row.send_state == SendState::Sent),
            Condition::Pending(text) => {
                matching(&rows, text).any(|row| row.send_state == SendState::Pending)
            }
            Condition::Failed(text) => {
                matching(&rows, text).any(|row| matches!(row.send_state, SendState::Failed { .. }))
            }
            Condition::Count(text, count) => matching(&rows, text).count() == *count,
            Condition::Channel(id) => {
                conversation == Some(Conversation::Channel { id: id.clone() })
            }
            Condition::Detached => detached,
            Condition::Live => !detached,
            Condition::Label(_) => unreachable!("answered above"),
        })
    }

    fn wait(&mut self, condition: &Condition, within: Duration) -> Result<()> {
        let activity = {
            let app = self.app()?.clone();
            self.driver.cx.update(|cx| app.read(cx).activity())
        };
        let deadline = Instant::now() + within;
        loop {
            let seen = activity.current();
            self.driver.settle()?;
            if self.holds(condition)? {
                return Ok(());
            }
            let now = Instant::now();
            if now >= deadline {
                let (rows, conversation, _) = self.rows()?;
                let tail: Vec<String> = rows
                    .iter()
                    .rev()
                    .take(5)
                    .map(|row| format!("{:?} {:?}", row.send_state, row.display))
                    .collect();
                bail!(
                    "still waiting after {within:?} for {condition:?} (on {conversation:?}, last rows {tail:?})"
                );
            }
            activity.wait_past(seen, LOOK_EVERY.min(deadline - now));
        }
    }

    fn click_row(&mut self, name: &str, text: &str) -> Result<()> {
        self.driver.settle()?;
        let (rows, _, _) = self.rows()?;
        let seq = rows
            .iter()
            .rev()
            .find(|row| row.display.contains(text))
            .map(|row| row.seq)
            .ok_or_else(|| anyhow!("no row contains {text:?}"))?;
        let id = ElementId::NamedInteger(name.to_owned().into(), seq as u64);
        self.driver.update(|window, cx| window.click(id, cx))
    }

    fn requests(&self, name: &str) -> Result<usize> {
        let answer = http(&self.server, "POST", "/__control/requests", "")?;
        Ok(answer["requests"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|record| {
                record["operation"].as_str() == Some(name) || record["event"].as_str() == Some(name)
            })
            .count())
    }

    fn run(&mut self, steps: &[Step], out_dir: &Path) -> Result<()> {
        for (index, step) in steps.iter().enumerate() {
            let started = Instant::now();
            let result = match step {
                Step::App { width, height } => self.open(*width, *height),
                Step::Shot(step) => self.driver.run_generic(step, out_dir).and_then(|known| {
                    if known {
                        Ok(())
                    } else {
                        bail!("{step:?} is a story step; rig-slice opens the app instead")
                    }
                }),
                Step::Wait { condition, within } => self.wait(condition, *within),
                Step::Expect(condition) => {
                    self.driver.settle()?;
                    if self.holds(condition)? {
                        Ok(())
                    } else {
                        let (rows, _, _) = self.rows()?;
                        let tail: Vec<&str> = rows
                            .iter()
                            .rev()
                            .take(5)
                            .map(|row| row.display.as_str())
                            .collect();
                        Err(anyhow!("expected {condition:?}; last rows {tail:?}"))
                    }
                }
                Step::Server { control, body } => {
                    http(&self.server, "POST", &format!("/__control/{control}"), body).map(|_| ())
                }
                Step::ExpectRequests { name, at_least } => {
                    let seen = self.requests(name)?;
                    if seen >= *at_least {
                        Ok(())
                    } else {
                        Err(anyhow!(
                            "expected {name} at least {at_least} times, saw {seen}"
                        ))
                    }
                }
                Step::ClickRow { name, text } => self.click_row(name, text),
                Step::Os(event) => {
                    let app = self.app()?.clone();
                    self.driver.cx.update(|cx| app.read(cx).os_event(*event));
                    Ok(())
                }
                Step::Restart => self.restart(),
                Step::ExpectStoredSession(wanted) => {
                    if self.stored_session() == *wanted {
                        Ok(())
                    } else {
                        Err(anyhow!("expected a stored session: {wanted}"))
                    }
                }
                Step::ExpectClipboard(text) => {
                    let copied = self
                        .driver
                        .cx
                        .update(|cx| cx.read_from_clipboard())
                        .and_then(|item| item.text())
                        .unwrap_or_default();
                    if copied.contains(text.as_str()) {
                        Ok(())
                    } else {
                        Err(anyhow!("the clipboard has {copied:?}, not {text:?}"))
                    }
                }
            };
            result.with_context(|| format!("step {}: {step:?}", index + 1))?;
            println!(
                "step {:>2} {:>5} ms  {step:?}",
                index + 1,
                started.elapsed().as_millis()
            );
        }
        Ok(())
    }
}

/// Log lines to stderr at `SEMAPHORE_LOG`, as the app does.
struct StderrLog(log::LevelFilter);

impl log::Log for StderrLog {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= self.0
    }
    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            eprintln!("{} {}: {}", record.level(), record.target(), record.args());
        }
    }
    fn flush(&self) {}
}

fn take_flag(args: &mut Vec<String>, flag: &str) -> Result<String> {
    let index = args
        .iter()
        .position(|arg| arg == flag)
        .ok_or_else(|| anyhow!("{flag} is required"))?;
    if index + 1 >= args.len() {
        bail!("{flag} needs a value");
    }
    args.remove(index);
    Ok(args.remove(index))
}

fn main() -> Result<()> {
    let level = std::env::var("SEMAPHORE_LOG")
        .ok()
        .and_then(|level| level.parse().ok())
        .unwrap_or(log::LevelFilter::Warn);
    if log::set_boxed_logger(Box::new(StderrLog(level))).is_ok() {
        log::set_max_level(level);
    }
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let server = take_flag(&mut args, "--server")?;
    let scenario = PathBuf::from(take_flag(&mut args, "--scenario")?);
    let script_path = take_flag(&mut args, "--script")?;
    let out_dir = PathBuf::from(take_flag(&mut args, "--out")?);
    let source = std::fs::read_to_string(&script_path).with_context(|| script_path.clone())?;
    let steps = parse(&source).with_context(|| script_path.clone())?;
    let now_ms = scenario_now_ms(&scenario)?;
    std::fs::create_dir_all(&out_dir)?;
    // A fresh data directory per run: no server remembered from the last one.
    let data_dir = out_dir.join("app-data");
    if data_dir.exists() {
        std::fs::remove_dir_all(&data_dir)?;
    }
    let mut rig = Rig::new(server, now_ms, data_dir);
    let result = rig.run(&steps, &out_dir);
    if let Some(app) = rig.app.clone() {
        rig.driver
            .cx
            .update(|cx| app.update(cx, |app, _| app.shutdown()));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::prelude::rust_2024::test;

    #[test]
    fn parses_its_own_steps_and_rig_shots() {
        let steps = parse(
            r#"
            app 1280 800
            wait core session signed-in
            wait core text "hello there" within 5
            expect core count "hi" 1
            server drop_connections
            server post_as "{\"text\": \"x\"}"
            expect requests typingStart >= 1
            expect clipboard "copied"
            click auth-login
            shot one
            "#,
        )
        .unwrap();
        assert_eq!(steps.len(), 10);
        assert_eq!(
            steps[2],
            Step::Wait {
                condition: Condition::Text("hello there".into()),
                within: Duration::from_secs(5),
            }
        );
        assert!(matches!(steps[8], Step::Shot(script::Step::Click { .. })));
        assert!(parse("wait core nonsense").is_err());
    }

    #[test]
    fn reads_rfc3339_like_the_server_writes_it() {
        assert_eq!(parse_rfc3339_ms("1970-01-01T00:00:00.000Z").unwrap(), 0);
        assert_eq!(
            parse_rfc3339_ms("2026-09-22T18:00:00.000Z").unwrap(),
            1_790_100_000_000
        );
    }
}
