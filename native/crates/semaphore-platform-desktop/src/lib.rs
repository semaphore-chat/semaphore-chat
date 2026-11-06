//! Desktop OS services: the clock, app directories, the system keyring and notifications.
//! Tray and screen capture are traits in `semaphore_core::platform` that arrive with the tests
//! that exercise them (T6, T11).

use directories::ProjectDirs;
use semaphore_core::platform::{AppPaths, Clock, CoreError, Notifier, SecretStore};
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

/// Secrets in the OS's native store: Secret Service on Linux, Credential Manager on Windows.
/// Never a file: with no store, or a locked one, every call fails with a [`CoreError`] that says
/// so, and nothing is written anywhere else.
///
/// Every call blocks, for as long as an unlock prompt stays open. On Linux it also runs zbus's own
/// `block_on`, which panics on a Tokio worker thread, so call this from a plain thread:
/// `HttpBackend` keeps one for its store.
pub struct KeyringSecrets {
    service: String,
}

impl KeyringSecrets {
    pub fn new() -> Self {
        Self {
            service: "app.semaphorechat.semaphore".into(),
        }
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry, CoreError> {
        keyring::Entry::new(&self.service, key).map_err(keyring_error)
    }
}

impl Default for KeyringSecrets {
    fn default() -> Self {
        Self::new()
    }
}

/// A missing or locked store reads as `Unavailable`, which a UI can explain, and anything else as
/// `Failed`. The message never includes the secret: `keyring` errors don't carry it.
fn keyring_error(error: keyring::Error) -> CoreError {
    match error {
        keyring::Error::NoStorageAccess(cause) => CoreError::Unavailable {
            what: format!(
                "the system keyring is locked or not running (unlock it, or start a Secret \
                 Service such as gnome-keyring or KeePassXC): {cause}"
            ),
        },
        keyring::Error::PlatformFailure(cause) => CoreError::Unavailable {
            what: format!("the system keyring could not be reached: {cause}"),
        },
        other => CoreError::Failed {
            message: format!("the system keyring failed: {other}"),
        },
    }
}

impl SecretStore for KeyringSecrets {
    fn load(&self, key: String) -> Result<Option<String>, CoreError> {
        match self.entry(&key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_error(error)),
        }
    }

    fn save(&self, key: String, value: String) -> Result<(), CoreError> {
        self.entry(&key)?
            .set_password(&value)
            .map_err(keyring_error)
    }

    fn delete(&self, key: String) -> Result<(), CoreError> {
        match self.entry(&key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_error(error)),
        }
    }
}

/// Desktop notifications: the freedesktop notification service on Linux, toasts on Windows.
pub struct DesktopNotifier;

impl Notifier for DesktopNotifier {
    fn notify(&self, title: String, body: String) -> Result<(), CoreError> {
        notify_rust::Notification::new()
            .appname("Semaphore")
            .summary(&title)
            .body(&body)
            .show()
            .map(|_| ())
            .map_err(|error| CoreError::Unavailable {
                what: format!("the notification service could not show it: {error}"),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_locked_or_missing_keyring_is_an_unavailable_error_that_says_so() {
        let locked = keyring_error(keyring::Error::NoStorageAccess("denied".into()));
        let CoreError::Unavailable { what } = locked else {
            panic!("expected Unavailable");
        };
        assert!(what.contains("locked or not running"), "{what}");
        assert!(what.contains("denied"), "{what}");

        let missing = keyring_error(keyring::Error::PlatformFailure("no bus".into()));
        assert!(matches!(missing, CoreError::Unavailable { .. }));
    }

    #[test]
    fn other_keyring_errors_are_failures() {
        let error = keyring_error(keyring::Error::TooLong("user".into(), 10));
        assert!(matches!(error, CoreError::Failed { .. }));
    }
}
