//! The app's logs: stderr as before, plus rotating files under `<data dir>/logs`.
//!
//! - `SEMAPHORE_LOG` picks the level (error, warn, info, debug, trace), as it always has. A
//!   packaged build (`SEMAPHORE_PACKAGED=1`) defaults to info; a development build to warn.
//! - `semaphore.log` and `voice.log` are size-capped and rotated by hand: five app files of 2 MiB
//!   and three voice files of 512 KiB. `.1` is the previous file, `.2` the one before it.
//! - A directory that can't be written (read-only, a full disk, no permission) turns the files off
//!   and says so on stderr once: start-up carries on, because a log is a diagnostic, not a feature.
//! - Every line is one line, with a UTC timestamp, and goes through [`semaphore_core::redact`]:
//!   tokens, passwords, invite codes and URL query strings never reach the file. Message text is
//!   never logged anywhere to begin with.
//! - Voice events (`target: "voice"`) are the native counterpart of Electron's `voiceLog.ts`;
//!   they go to `voice.log` and to stderr, and not to `semaphore.log`.

use log::{LevelFilter, Log, Metadata, Record};
use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// The folder under the data directory that holds the logs and crash reports.
pub const LOGS_DIR: &str = "logs";
/// The app log's stem: `semaphore.log`, `semaphore.1.log`, ...
pub const APP_LOG: &str = "semaphore";
/// The voice event log's stem: `voice.log`, `voice.1.log`, ...
pub const VOICE_LOG: &str = "voice";
/// How many app log files are kept, the current one included.
pub const APP_FILES: usize = 5;
/// The app log's size cap, per file.
pub const APP_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// How many voice log files are kept, the current one included.
pub const VOICE_FILES: usize = 3;
/// The voice log's size cap, per file. Voice events are rare; this holds days of them.
pub const VOICE_MAX_BYTES: u64 = 512 * 1024;
/// The `log` target that puts a line in the voice log.
pub const VOICE_TARGET: &str = "voice";

/// Where the logs go for a given data directory.
pub fn logs_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(LOGS_DIR)
}

/// The level a build with no `SEMAPHORE_LOG` uses: info in a package, warn from a checkout.
pub fn default_level() -> LevelFilter {
    if option_env!("SEMAPHORE_PACKAGED") == Some("1") {
        LevelFilter::Info
    } else {
        LevelFilter::Warn
    }
}

/// The level `SEMAPHORE_LOG` asked for, or the default when it is unset or unreadable.
pub fn level_from_env() -> LevelFilter {
    level_for(std::env::var("SEMAPHORE_LOG").ok().as_deref())
}

fn level_for(asked: Option<&str>) -> LevelFilter {
    asked
        .and_then(|level| level.parse().ok())
        .unwrap_or_else(default_level)
}

/// Installs the logger. `SEMAPHORE_LOG` stays as it was: stderr gets the same lines in the same
/// format, and the files get them too when the directory allows it.
pub fn init(data_dir: &Path) -> LevelFilter {
    let level = level_from_env();
    let sink = Sink::new(&logs_dir(data_dir), level);
    if log::set_boxed_logger(Box::new(sink)).is_ok() {
        log::set_max_level(level);
    }
    level
}

/// The stderr and file sink.
struct Sink {
    level: LevelFilter,
    app: Mutex<RotatingFile>,
    voice: Mutex<RotatingFile>,
}

/// One file family: the current file and its older copies.
struct RotatingFile {
    dir: PathBuf,
    stem: &'static str,
    keep: usize,
    cap: u64,
    file: Option<File>,
    len: u64,
}

/// What each family keeps, for the real app and for tests with small files.
#[derive(Clone, Copy)]
struct Sizes {
    app: (usize, u64),
    voice: (usize, u64),
}

const DEFAULT_SIZES: Sizes = Sizes {
    app: (APP_FILES, APP_MAX_BYTES),
    voice: (VOICE_FILES, VOICE_MAX_BYTES),
};

impl Sink {
    fn new(dir: &Path, level: LevelFilter) -> Self {
        Self::with_sizes(dir, level, DEFAULT_SIZES)
    }

    fn with_sizes(dir: &Path, level: LevelFilter, sizes: Sizes) -> Self {
        let app = RotatingFile::open(dir, APP_LOG, sizes.app.0, sizes.app.1);
        let voice = RotatingFile::open(dir, VOICE_LOG, sizes.voice.0, sizes.voice.1);
        Self {
            level,
            app: Mutex::new(app),
            voice: Mutex::new(voice),
        }
    }

    #[cfg(test)]
    fn writing_files(&self) -> (bool, bool) {
        (
            self.app.lock().unwrap().file.is_some(),
            self.voice.lock().unwrap().file.is_some(),
        )
    }
}

impl Log for Sink {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        // stderr keeps the format it had before there were files.
        let message = one_line(&semaphore_core::redact::redact(&record.args().to_string()));
        eprintln!("{} {}: {}", record.level(), record.target(), message);
        let line = format!(
            "{} {:<5} {}: {}",
            timestamp(SystemTime::now()),
            record.level(),
            record.target(),
            message
        );
        let file = if record.target() == VOICE_TARGET {
            &self.voice
        } else {
            &self.app
        };
        file.lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .write_line(&line);
    }

    fn flush(&self) {}
}

/// A message or panic text as one log line: embedded newlines are escaped.
fn one_line(text: &str) -> String {
    if !text.contains(['\n', '\r']) {
        return text.to_owned();
    }
    text.replace('\r', "").replace('\n', "\\n")
}

impl RotatingFile {
    /// Opens (or rotates) the current file. A failure is reported on stderr and leaves the family
    /// off: the app runs without file logging.
    fn open(dir: &Path, stem: &'static str, keep: usize, cap: u64) -> Self {
        let mut file = Self {
            dir: dir.to_path_buf(),
            stem,
            keep: keep.max(1),
            cap: cap.max(1),
            file: None,
            len: 0,
        };
        if let Err(error) = std::fs::create_dir_all(dir) {
            eprintln!("semaphore-app: not writing the {stem} log: {error}; logging to stderr only");
            return file;
        }
        let opened = OpenOptions::new()
            .create(true)
            .append(true)
            .open(file.current());
        match opened {
            Ok(handle) => {
                file.len = handle.metadata().map(|meta| meta.len()).unwrap_or(0);
                file.file = Some(handle);
                if file.len >= file.cap {
                    file.rotate();
                }
                file
            }
            Err(error) => {
                eprintln!(
                    "semaphore-app: not writing the {} log at {}: {error}; logging to stderr only",
                    file.stem,
                    file.current().display()
                );
                file
            }
        }
    }

    fn current(&self) -> PathBuf {
        self.dir.join(format!("{}.log", self.stem))
    }

    fn archive(&self, index: usize) -> PathBuf {
        self.dir.join(format!("{}.{index}.log", self.stem))
    }

    /// Writes one line, rotating first when it wouldn't fit. A write error (a full disk) turns the
    /// family off and says so once; nothing panics.
    fn write_line(&mut self, line: &str) {
        if self.file.is_none() {
            return;
        }
        let bytes = line.len() as u64 + 1;
        if self.len > 0 && self.len + bytes > self.cap {
            self.rotate();
        }
        let Some(handle) = &mut self.file else {
            return;
        };
        if let Err(error) = handle
            .write_all(line.as_bytes())
            .and_then(|()| handle.write_all(b"\n"))
        {
            eprintln!(
                "semaphore-app: writing the {} log failed: {error}; logging to stderr only",
                self.stem
            );
            self.file = None;
            return;
        }
        self.len += bytes;
    }

    /// `semaphore.log` becomes `semaphore.1.log`, the older copies shift down, the oldest goes.
    fn rotate(&mut self) {
        self.file = None;
        if self.keep > 1 {
            let _ = std::fs::remove_file(self.archive(self.keep - 1));
            for index in (1..self.keep - 1).rev() {
                let from = self.archive(index);
                if from.exists() {
                    let _ = std::fs::rename(from, self.archive(index + 1));
                }
            }
            let _ = std::fs::rename(self.current(), self.archive(1));
        }
        match OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(self.current())
        {
            Ok(handle) => {
                self.file = Some(handle);
                self.len = 0;
            }
            Err(error) => {
                eprintln!(
                    "semaphore-app: rotating the {} log failed: {error}; logging to stderr only",
                    self.stem
                );
            }
        }
    }
}

/// A UTC timestamp, `2026-11-13T12:34:56.789Z`, without a date crate.
fn timestamp(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let rest = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600,
        (rest % 3_600) / 60,
        rest % 60,
        since.subsec_millis()
    )
}

/// Days since 1970-01-01 to a civil date (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::{Level, Record};
    use std::fs;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "semaphore-log-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    fn chmod(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    /// Writes one record through the sink, as the installed logger would.
    fn log_line(sink: &Sink, level: Level, target: &str, message: &str) {
        let text = message.to_owned();
        sink.log(
            &Record::builder()
                .args(format_args!("{text}"))
                .level(level)
                .target(target)
                .build(),
        );
    }

    fn lines(dir: &Path, stem: &str) -> Vec<String> {
        let mut all = Vec::new();
        for index in (1..8).rev() {
            let path = dir.join(format!("{stem}.{index}.log"));
            if let Ok(text) = fs::read_to_string(path) {
                all.extend(text.lines().map(str::to_owned));
            }
        }
        let text = fs::read_to_string(dir.join(format!("{stem}.log"))).unwrap_or_default();
        all.extend(text.lines().map(str::to_owned));
        all
    }

    #[test]
    fn timestamps_are_utc_and_exact() {
        assert_eq!(timestamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        // 2024-02-29T12:34:56.789Z (a leap day).
        let leap = UNIX_EPOCH + std::time::Duration::from_millis(1_709_210_096_789);
        assert_eq!(timestamp(leap), "2024-02-29T12:34:56.789Z");
    }

    #[test]
    fn the_level_comes_from_the_variable_and_falls_back() {
        assert_eq!(level_for(Some("debug")), LevelFilter::Debug);
        assert_eq!(level_for(Some("trace")), LevelFilter::Trace);
        assert_eq!(level_for(Some("off")), LevelFilter::Off);
        assert_eq!(level_for(Some("loud")), default_level());
        assert_eq!(level_for(None), default_level());
    }

    #[test]
    fn a_line_goes_to_stderr_and_the_current_file() {
        let dir = TempDir::new();
        let sink = Sink::with_sizes(&dir.0, LevelFilter::Trace, tiny(3, 200));
        log_line(&sink, Level::Info, "semaphore_app", "hello from the test");
        assert!(sink.writing_files().0);
        let text = fs::read_to_string(dir.0.join("semaphore.log")).unwrap();
        assert_eq!(text.lines().count(), 1);
        assert!(
            text.contains("INFO  semaphore_app: hello from the test"),
            "{text}"
        );
        assert!(text.starts_with("20"), "{text}");
        assert!(text.contains("Z INFO  semaphore_app: hello"), "{text}");
    }

    #[test]
    fn rotation_happens_at_the_boundary_and_keeps_a_fixed_number() {
        let dir = TempDir::new();
        let sink = Sink::with_sizes(&dir.0, LevelFilter::Trace, tiny(3, 120));
        // Each line is longer than a third of the cap, so every second or third line rotates.
        for index in 0..12 {
            log_line(
                &sink,
                Level::Info,
                "semaphore_app",
                &format!("line-{index:02}-{}", "x".repeat(30)),
            );
        }
        assert!(dir.0.join("semaphore.log").exists());
        assert!(dir.0.join("semaphore.1.log").exists());
        assert!(dir.0.join("semaphore.2.log").exists());
        assert!(!dir.0.join("semaphore.3.log").exists(), "only three kept");
        // The newest file holds the last line, and no file is over its cap.
        let newest = fs::read_to_string(dir.0.join("semaphore.log")).unwrap();
        assert!(newest.contains("line-11-"), "{newest}");
        for index in 0..3 {
            let path = if index == 0 {
                dir.0.join("semaphore.log")
            } else {
                dir.0.join(format!("semaphore.{index}.log"))
            };
            let len = fs::metadata(path).unwrap().len();
            assert!(len <= 120, "a file grew to {len} bytes");
        }
    }

    #[test]
    fn a_line_that_exactly_fills_the_cap_stays_in_that_file() {
        let dir = TempDir::new();
        // Nine characters plus the newline is ten bytes: two fill a 20-byte cap exactly, and the
        // third write rotates before it lands.
        let mut file = RotatingFile::open(&dir.0, APP_LOG, 3, 20);
        file.write_line("012345678");
        file.write_line("abcdefghi");
        assert_eq!(file.len, 20, "the second line fit exactly");
        file.write_line("klmnopqrs");
        let current = fs::read_to_string(dir.0.join("semaphore.log")).unwrap();
        let previous = fs::read_to_string(dir.0.join("semaphore.1.log")).unwrap();
        assert_eq!(current, "klmnopqrs\n");
        assert_eq!(previous, "012345678\nabcdefghi\n");
    }

    #[test]
    fn concurrent_writers_never_split_a_line() {
        let dir = TempDir::new();
        let sink = Arc::new(Sink::with_sizes(&dir.0, LevelFilter::Trace, tiny(3, 160)));
        let mut threads = Vec::new();
        for thread in 0..4 {
            let sink = sink.clone();
            threads.push(std::thread::spawn(move || {
                for line in 0..40 {
                    log_line(
                        &sink,
                        Level::Info,
                        "semaphore_app",
                        &format!("thread-{thread}: line-{line:02}"),
                    );
                }
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }
        let all = lines(&dir.0, "semaphore");
        assert!(!all.is_empty());
        for line in &all {
            assert!(line.starts_with("20"), "not a logged line: {line:?}");
            assert!(
                line.contains(" INFO  semaphore_app: thread-"),
                "a line was split: {line:?}"
            );
            let payload = line
                .split_once("semaphore_app: ")
                .expect("the target and its message")
                .1;
            let (thread, number) = payload.split_once(": line-").expect("intact payload");
            assert!(thread.starts_with("thread-"), "{line:?}");
            assert_eq!(number.len(), 2, "{line:?}");
        }
        // Rotation may drop old lines, but nothing is written twice.
        let mut seen = std::collections::BTreeSet::new();
        for line in &all {
            assert!(seen.insert(line.clone()), "duplicated {line:?}");
        }
    }

    #[test]
    fn a_read_only_directory_leaves_start_up_alone() {
        let dir = TempDir::new();
        let logs = dir.0.join(LOGS_DIR);
        fs::create_dir_all(&logs).unwrap();
        #[cfg(unix)]
        chmod(&logs, 0o555);
        let sink = Sink::with_sizes(&logs, LevelFilter::Trace, tiny(3, 200));
        log_line(&sink, Level::Info, "semaphore_app", "still alive");
        let wrote = fs::metadata(logs.join("semaphore.log")).is_ok();
        #[cfg(unix)]
        chmod(&logs, 0o755);
        if wrote {
            // Running as root (or on a filesystem that ignores the mode): the fallback test
            // below still covers the failure path.
            return;
        }
        assert_eq!(sink.writing_files(), (false, false));
    }

    #[test]
    fn an_unwritable_directory_falls_back_to_stderr() {
        let dir = TempDir::new();
        // `logs` is a file, so the directory can't be created: deterministic, unlike a mode.
        fs::write(dir.0.join(LOGS_DIR), b"not a directory").unwrap();
        let sink = Sink::with_sizes(&dir.0.join(LOGS_DIR), LevelFilter::Trace, tiny(3, 200));
        log_line(&sink, Level::Error, "semaphore_app", "write me anyway");
        assert_eq!(sink.writing_files(), (false, false));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_full_disk_turns_the_file_off_without_panicking() {
        let dir = TempDir::new();
        let full = OpenOptions::new().write(true).open("/dev/full").unwrap();
        let mut file = RotatingFile {
            dir: dir.0.clone(),
            stem: APP_LOG,
            keep: 3,
            cap: 200,
            file: Some(full),
            len: 0,
        };
        file.write_line("no room");
        assert!(file.file.is_none(), "a failed write disables the family");
        file.write_line("still no panic");
    }

    #[test]
    fn voice_events_take_their_own_file() {
        let dir = TempDir::new();
        let sink = Sink::with_sizes(&dir.0, LevelFilter::Trace, tiny(3, 400));
        log_line(&sink, Level::Info, "semaphore_app", "an app line");
        log_line(&sink, Level::Info, VOICE_TARGET, "join target=channel");
        let app = fs::read_to_string(dir.0.join("semaphore.log")).unwrap();
        let voice = fs::read_to_string(dir.0.join("voice.log")).unwrap();
        assert!(app.contains("an app line"));
        assert!(!app.contains("join target"), "{app}");
        assert!(voice.contains("voice: join target=channel"), "{voice}");
        assert!(!voice.contains("an app line"));
    }

    #[test]
    fn seeded_secrets_never_reach_a_file() {
        let dir = TempDir::new();
        let sink = Sink::with_sizes(&dir.0, LevelFilter::Trace, tiny(5, 4096));
        let secrets = [
            "at-secret-9f3c",
            "rt-secret-77aa",
            "pw-hunter2",
            "invite-code-abc123",
        ];
        let lines = [
            (
                "semaphore_net::http",
                "GET https://chat.example.org/api/x?access_token=at-secret-9f3c&refresh_token=rt-secret-77aa failed",
            ),
            (
                "semaphore_net::http",
                "login refused LoginRequest { password: \"pw-hunter2\" }",
            ),
            (
                "semaphore_app::links",
                "opened semaphore://join/invite-code-abc123",
            ),
            (
                VOICE_TARGET,
                "join-failed target=channel error_class=media_unreachable message=\"wss://lk.example.org/rtc?access_token=at-secret-9f3c\"",
            ),
            (
                "semaphore_net::http",
                "Authorization: Bearer at-secret-9f3c (expired)",
            ),
        ];
        for (target, line) in lines {
            log_line(&sink, Level::Warn, target, line);
        }
        let mut written = String::new();
        for entry in fs::read_dir(&dir.0).unwrap() {
            let entry = entry.unwrap();
            if entry.path().extension().is_some_and(|ext| ext == "log") {
                written.push_str(&fs::read_to_string(entry.path()).unwrap());
            }
        }
        assert!(written.contains("<redacted>"), "nothing was redacted");
        for secret in secrets {
            assert!(
                !written.contains(secret),
                "{secret} was written:\n{written}"
            );
        }
    }

    fn tiny(keep: usize, cap: u64) -> Sizes {
        Sizes {
            app: (keep, cap),
            voice: (keep, cap),
        }
    }
}
