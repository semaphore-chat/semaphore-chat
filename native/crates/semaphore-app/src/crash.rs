//! Crash reports: a panic hook that writes a small report beside the logs.
//!
//! - The default hook still prints to stderr; the file is written after it. A panic inside a panic
//!   hook aborts the process (`catch_unwind` can't stop that), so the report writer has no
//!   `unwrap`, `expect` or indexing: every failure (no folder, a full disk) just means no report.
//! - The folder is private to the user (0700) and each report 0600, on Unix, like the logs.
//! - A report has the time, the version, the platform, the thread, the panic message and location,
//!   and a backtrace when one is available. It has no environment dump and no user data; the
//!   message goes through the same redaction as a log line.
//! - `crash-<UTC time>-<pid>.txt` files in the log folder; the newest [`KEPT`] are kept.
//! - The next start only logs that a previous report exists (see `main.rs`): no dialog.

use std::io::Write as _;
use std::panic::PanicHookInfo;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// How many crash reports stay in the folder, the newest first.
pub const KEPT: usize = 10;
/// Every report's name starts with this, so a folder listing finds them.
pub const PREFIX: &str = "crash-";

/// Installs the hook for the life of the process. A report goes in `dir`, which is also tidied to
/// the newest [`KEPT`] reports.
pub fn install(dir: &Path) {
    let dir = dir.to_path_buf();
    let _ = crate::logging::create_private_dir(&dir);
    prune(&dir, KEPT);
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        // The default hook's stderr line stays, exactly as before.
        default(panic);
        write_report(&dir, panic);
    }));
}

/// The newest report in `dir`, for the start-up line. `None` when there is none.
pub fn newest_report(dir: &Path) -> Option<PathBuf> {
    let mut reports = reports(dir);
    reports.sort();
    reports.pop()
}

fn reports(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(PREFIX) && name.ends_with(".txt"))
        })
        .collect()
}

fn prune(dir: &Path, keep: usize) {
    let mut reports = reports(dir);
    reports.sort();
    let excess = reports.len().saturating_sub(keep);
    for report in reports.into_iter().take(excess) {
        let _ = std::fs::remove_file(report);
    }
}

/// Writes one report. Called from the hook and from tests; never panics.
fn write_report(dir: &Path, panic: &PanicHookInfo<'_>) {
    let now = SystemTime::now();
    let stamp = file_stamp(now);
    let pid = std::process::id();
    let Some((path, mut file)) = create(dir, &stamp, pid) else {
        return;
    };
    let thread = std::thread::current();
    let thread = thread.name().unwrap_or("<unnamed>");
    let message = payload_message(panic.payload());
    let location = panic
        .location()
        .map(|location| {
            format!(
                "{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            )
        })
        .unwrap_or_else(|| "<unknown>".to_owned());
    let text = format!(
        "Semaphore Chat crash report\n\
         time: {}\n\
         version: {}\n\
         platform: {} {}\n\
         thread: {}\n\
         panic: {}\n\
         location: {}\n\
         backtrace:\n{}\n",
        timestamp(now),
        crate::version::version(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        thread,
        semaphore_core::redact::redact(&message).replace('\n', "\\n"),
        location,
        std::backtrace::Backtrace::force_capture(),
    );
    if file.write_all(text.as_bytes()).is_err() {
        let _ = std::fs::remove_file(&path);
        return;
    }
    prune(dir, KEPT);
}

/// `crash-YYYYMMDD-HHMMSS-mmm-pid.txt`; a suffix if two reports land in one millisecond.
fn create(dir: &Path, stamp: &str, pid: u32) -> Option<(PathBuf, std::fs::File)> {
    for suffix in 0..100 {
        let name = if suffix == 0 {
            format!("{PREFIX}{stamp}-{pid}.txt")
        } else {
            format!("{PREFIX}{stamp}-{pid}-{suffix}.txt")
        };
        let path = dir.join(name);
        match crate::logging::private_file_options()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Some((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return None,
        }
    }
    None
}

fn payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_owned()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "<a panic payload that isn't a string>".to_owned()
    }
}

fn file_stamp(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let rest = secs % 86_400;
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}-{:03}",
        rest / 3_600,
        (rest % 3_600) / 60,
        rest % 60,
        since.subsec_millis()
    )
}

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
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// The panic hook is process-wide, so the two tests that install one run one after the other.
    static HOOK_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "semaphore-crash-test-{}-{}",
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

    fn reports_in(dir: &Path) -> Vec<PathBuf> {
        let mut found = reports(dir);
        found.sort();
        found
    }

    #[test]
    fn a_panic_in_another_thread_writes_one_report() {
        let _guard = HOOK_GUARD
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let dir = TempDir::new();
        let previous = std::panic::take_hook();
        install(&dir.0);
        let thread = std::thread::Builder::new()
            .name("crash-test-thread".into())
            .spawn(|| panic!("the crash report test panicked: token=at-secret-9f3c"))
            .unwrap();
        assert!(thread.join().is_err(), "the panic still unwinds");
        std::panic::set_hook(previous);

        let found = reports_in(&dir.0);
        assert_eq!(found.len(), 1, "{found:?}");
        let report = fs::read_to_string(&found[0]).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&found[0]), 0o600, "the report is private");
            assert_eq!(mode(&dir.0), 0o700, "the folder is private");
        }
        assert!(
            report.starts_with("Semaphore Chat crash report\n"),
            "{report}"
        );
        assert!(report.contains("thread: crash-test-thread"), "{report}");
        assert!(
            report.contains("panic: the crash report test panicked"),
            "{report}"
        );
        assert!(
            !report.contains("at-secret-9f3c"),
            "the message wasn't redacted:\n{report}"
        );
        assert!(report.contains("version: "), "{report}");
        assert!(
            report.contains(&format!(
                "platform: {} {}",
                std::env::consts::OS,
                std::env::consts::ARCH
            )),
            "{report}"
        );
        assert!(report.contains("location: "), "{report}");
        assert!(!report.contains("location: <unknown>"), "{report}");
        assert!(report.contains("backtrace:\n"), "{report}");
        assert!(!report.contains("RUST_BACKTRACE"), "no environment dump");
    }

    #[test]
    fn only_the_newest_reports_are_kept() {
        let dir = TempDir::new();
        for index in 0..15 {
            let path = dir
                .0
                .join(format!("{PREFIX}20260101-000000-{index:03}-1.txt"));
            fs::write(path, "old").unwrap();
        }
        prune(&dir.0, KEPT);
        let left = reports_in(&dir.0);
        assert_eq!(left.len(), KEPT);
        let names: Vec<String> = left
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        // The newest names survive.
        assert!(
            names.iter().any(|name| name.contains("-014-1.txt")),
            "{names:?}"
        );
        assert!(
            !names.iter().any(|name| name.contains("-004-1.txt")),
            "{names:?}"
        );
        assert_eq!(newest_report(&dir.0), left.last().cloned());
    }

    #[test]
    fn a_report_that_cannot_be_written_does_not_panic() {
        let _guard = HOOK_GUARD
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let dir = TempDir::new();
        // The log "folder" is a file: creating the report fails instead of panicking.
        let blocked = dir.0.join("blocked");
        fs::write(&blocked, b"not a directory").unwrap();
        let previous = std::panic::take_hook();
        install(&blocked);
        let thread = std::thread::spawn(|| panic!("still no second panic"));
        assert!(thread.join().is_err());
        std::panic::set_hook(previous);
        assert!(!blocked.is_dir());
    }

    #[test]
    fn a_name_holds_the_time_and_the_pid() {
        assert_eq!(file_stamp(UNIX_EPOCH), "19700101-000000-000");
        let leap = UNIX_EPOCH + std::time::Duration::from_millis(1_709_210_096_789);
        assert_eq!(timestamp(leap), "2024-02-29T12:34:56.789Z");
        assert_eq!(file_stamp(leap), "20240229-123456-789");
        assert!(
            create(&TempDir::new().0, "20260101-000000-000", 7)
                .unwrap()
                .0
                .ends_with("crash-20260101-000000-000-7.txt")
        );
    }
}
