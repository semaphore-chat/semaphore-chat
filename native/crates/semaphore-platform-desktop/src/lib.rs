//! Desktop OS services. Phase 0 implements only what the app shell needs. Keyring, tray,
//! notifications and capture are traits in `semaphore_core::platform` and arrive with
//! the tests that exercise them (T6, T11).

use directories::ProjectDirs;
use semaphore_core::platform::{AppPaths, Clock};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as u64)
    }
}

pub struct DesktopPaths {
    dirs: ProjectDirs,
}

impl DesktopPaths {
    /// None when the OS reports no home directory.
    pub fn new() -> Option<Self> {
        ProjectDirs::from("app", "semaphorechat", "semaphore").map(|dirs| Self { dirs })
    }
}

impl AppPaths for DesktopPaths {
    fn data_dir(&self) -> String {
        self.dirs.data_dir().to_string_lossy().into_owned()
    }

    fn cache_dir(&self) -> String {
        self.dirs.cache_dir().to_string_lossy().into_owned()
    }
}
