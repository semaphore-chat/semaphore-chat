//! First-run import of the Electron app's non-secret settings.
//!
//! The Electron app keeps `userData/settings.json` (`frontend/electron/main.ts:39-59`), whose only
//! field today is `closeToTray`. `userData` is Electron's per-app config folder:
//!
//! | Platform | Folder |
//! |---|---|
//! | Linux | `$XDG_CONFIG_HOME/Semaphore Chat` (default `~/.config/Semaphore Chat`) |
//! | Windows | `%APPDATA%\Semaphore Chat` |
//! | macOS | `~/Library/Application Support/Semaphore Chat` |
//!
//! Only [`import_from`] reads it, only when the native `settings.json` doesn't exist yet, and it
//! never writes there. The refresh token lives in `userData/secure-tokens` and the server URL,
//! volumes, device ids and drafts live in Chromium's renderer `localStorage` (LevelDB), not in
//! `settings.json`; this app doesn't read either, so there is nothing secret to import and the
//! server URL stays unset (`last-server` is written after the first sign-in).
//!
//! The mapping is deliberately strict: a file with an unknown `version`, a wrong type or no JSON
//! object imports nothing, so a future Electron format can't be half-read.

use crate::settings::{SETTINGS_FILE, SettingsStore};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Electron's app name, from `frontend/package.json`'s `productName`.
pub const ELECTRON_APP_NAME: &str = "Semaphore Chat";
/// The file in its `userData` folder.
pub const ELECTRON_SETTINGS_FILE: &str = "settings.json";
/// The only schema this reader knows. Electron writes no `version` today; treat that as this one.
pub const KNOWN_VERSION: u64 = 1;

/// What an Electron `settings.json` held that this app understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElectronSettings {
    /// A file this reader understands; `close_to_tray` is `None` when the field is absent.
    Recognised { close_to_tray: Option<bool> },
    /// A `version` this build doesn't know: import nothing.
    UnknownVersion(u64),
    /// Not a JSON object, not UTF-8, or a known field with the wrong type.
    Malformed,
}

/// What [`import_from`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Import {
    /// The native settings file was created with this close-to-tray value.
    Imported { close_to_tray: bool },
    /// Nothing was read or written, for this reason.
    Nothing(Nothing),
    /// The file was understood but the native settings couldn't be saved.
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Nothing {
    /// The native `settings.json` already exists: import only ever happens on a first run.
    NativeSettingsExist,
    /// There is no Electron `settings.json` here (or it can't be read).
    NoElectronSettings,
    /// Its `version` is newer than this build knows.
    UnknownVersion(u64),
    /// Not JSON, not an object, or a wrong type.
    Malformed,
    /// Understood, but it has no field with a native equivalent.
    NothingToImport,
}

/// Electron's `userData` folder on this platform, from the environment it would use.
pub fn electron_user_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from)?;
        Some(appdata.join(ELECTRON_APP_NAME))
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        Some(
            home.join("Library/Application Support")
                .join(ELECTRON_APP_NAME),
        )
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| home.map(|home| home.join(".config")))?;
        Some(config.join(ELECTRON_APP_NAME))
    }
}

/// The real first-run import, for the binary. Tests call [`import_from`] with fixture folders so
/// they never read a real home directory.
pub fn import_once(native_data_dir: &Path) -> Import {
    let electron = electron_user_data_dir();
    import_from(native_data_dir, electron.as_deref())
}

/// The mapping and the one write, with both folders given. See the module docs for the rules.
pub fn import_from(native_data_dir: &Path, electron_user_data: Option<&Path>) -> Import {
    if native_data_dir.join(SETTINGS_FILE).exists() {
        return Import::Nothing(Nothing::NativeSettingsExist);
    }
    let Some(electron_dir) = electron_user_data else {
        return Import::Nothing(Nothing::NoElectronSettings);
    };
    let Ok(bytes) = std::fs::read(electron_dir.join(ELECTRON_SETTINGS_FILE)) else {
        return Import::Nothing(Nothing::NoElectronSettings);
    };
    let close_to_tray = match map_settings(&bytes) {
        ElectronSettings::Recognised { close_to_tray } => close_to_tray,
        ElectronSettings::UnknownVersion(version) => {
            return Import::Nothing(Nothing::UnknownVersion(version));
        }
        ElectronSettings::Malformed => return Import::Nothing(Nothing::Malformed),
    };
    let Some(close_to_tray) = close_to_tray else {
        return Import::Nothing(Nothing::NothingToImport);
    };
    let mut store = SettingsStore::load(native_data_dir);
    match store.update(|settings| settings.close_to_tray = close_to_tray) {
        Ok(()) => Import::Imported { close_to_tray },
        Err(error) => Import::Failed(error.to_string()),
    }
}

/// Electron's `settings.json`, mapped to what this app can use. Pure: no file is touched.
pub fn map_settings(bytes: &[u8]) -> ElectronSettings {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return ElectronSettings::Malformed;
    };
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(text) else {
        return ElectronSettings::Malformed;
    };
    if let Some(version) = object.get("version") {
        match version.as_u64() {
            Some(KNOWN_VERSION) => {}
            Some(other) => return ElectronSettings::UnknownVersion(other),
            None => return ElectronSettings::Malformed,
        }
    }
    let close_to_tray = match object.get("closeToTray") {
        None | Some(Value::Null) => None,
        Some(Value::Bool(value)) => Some(*value),
        Some(_) => return ElectronSettings::Malformed,
    };
    ElectronSettings::Recognised { close_to_tray }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "semaphore-electron-import-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn electron(&self) -> PathBuf {
            let dir = self.0.join("electron");
            fs::create_dir_all(&dir).unwrap();
            dir
        }

        fn native(&self) -> PathBuf {
            let dir = self.0.join("native");
            fs::create_dir_all(&dir).unwrap();
            dir
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_electron_settings_format_maps_or_refuses() {
        // The file Electron writes today (no version, closeToTray only), and the shapes around it.
        let table: &[(&str, ElectronSettings)] = &[
            (r#"{"closeToTray":true}"#, recognised(Some(true))),
            (r#"{"closeToTray":false}"#, recognised(Some(false))),
            // Pretty-printed, as `setSetting` writes it with `JSON.stringify(…, null, 2)`.
            ("{\n  \"closeToTray\": true\n}", recognised(Some(true))),
            // Unknown fields are ignored: the native reader does the same.
            (
                r#"{"closeToTray":false,"windowBounds":{"width":10}}"#,
                recognised(Some(false)),
            ),
            (
                r#"{"version":1,"closeToTray":true}"#,
                recognised(Some(true)),
            ),
            (
                r#"{"version":2,"closeToTray":true}"#,
                ElectronSettings::UnknownVersion(2),
            ),
            (r#"{"version":99}"#, ElectronSettings::UnknownVersion(99)),
            (
                r#"{"version":"1","closeToTray":true}"#,
                ElectronSettings::Malformed,
            ),
            (r#"{"closeToTray":"yes"}"#, ElectronSettings::Malformed),
            (r#"{"closeToTray":1}"#, ElectronSettings::Malformed),
            ("[]", ElectronSettings::Malformed),
            ("null", ElectronSettings::Malformed),
            ("", ElectronSettings::Malformed),
            ("{ not json", ElectronSettings::Malformed),
        ];
        for (text, expected) in table {
            assert_eq!(map_settings(text.as_bytes()), *expected, "{text}");
        }
        assert_eq!(
            map_settings(b"{\"closeToTray\":true,\"x\":\"\xff\"}"),
            ElectronSettings::Malformed,
            "invalid UTF-8 is refused"
        );
        assert_eq!(
            map_settings(b"{}"),
            recognised(None),
            "an empty object has nothing to import"
        );
    }

    fn recognised(close_to_tray: Option<bool>) -> ElectronSettings {
        ElectronSettings::Recognised { close_to_tray }
    }

    #[test]
    fn a_first_run_imports_close_to_tray_and_a_second_run_does_not() {
        let dir = TempDir::new();
        let electron = dir.electron();
        let native = dir.native();
        let electron_file = electron.join(ELECTRON_SETTINGS_FILE);
        fs::write(&electron_file, r#"{"closeToTray":false}"#).unwrap();

        assert_eq!(
            import_from(&native, Some(&electron)),
            Import::Imported {
                close_to_tray: false
            }
        );
        let mut store = SettingsStore::load(&native);
        assert!(!store.get().close_to_tray);
        assert_eq!(store.get().version, crate::settings::CURRENT_VERSION);

        // The user changes their mind in the native app; the Electron file changes too.
        store
            .update(|settings| settings.close_to_tray = true)
            .unwrap();
        fs::write(&electron_file, r#"{"closeToTray":false}"#).unwrap();
        assert_eq!(
            import_from(&native, Some(&electron)),
            Import::Nothing(Nothing::NativeSettingsExist)
        );
        assert!(SettingsStore::load(&native).get().close_to_tray);
    }

    #[test]
    fn a_native_settings_file_is_never_overwritten() {
        let dir = TempDir::new();
        let electron = dir.electron();
        let native = dir.native();
        fs::write(
            native.join(SETTINGS_FILE),
            r#"{"version":4,"close_to_tray":true,"theme":"dark-teal-balanced"}"#,
        )
        .unwrap();
        fs::write(
            electron.join(ELECTRON_SETTINGS_FILE),
            r#"{"closeToTray":false}"#,
        )
        .unwrap();
        let before = fs::read(native.join(SETTINGS_FILE)).unwrap();
        assert_eq!(
            import_from(&native, Some(&electron)),
            Import::Nothing(Nothing::NativeSettingsExist)
        );
        assert_eq!(fs::read(native.join(SETTINGS_FILE)).unwrap(), before);
    }

    #[test]
    fn electron_files_are_never_written() {
        let dir = TempDir::new();
        let electron = dir.electron();
        let native = dir.native();
        let electron_file = electron.join(ELECTRON_SETTINGS_FILE);
        let original = r#"{"closeToTray":false,"unknown":1}"#;
        fs::write(&electron_file, original).unwrap();
        let modified = fs::metadata(&electron_file).unwrap().modified().unwrap();
        import_from(&native, Some(&electron));
        assert_eq!(fs::read_to_string(&electron_file).unwrap(), original);
        assert_eq!(
            fs::metadata(&electron_file).unwrap().modified().unwrap(),
            modified,
            "the Electron file wasn't touched"
        );
        assert!(!electron.join("secure-tokens").exists());
    }

    #[test]
    fn a_malformed_or_unknown_file_imports_nothing() {
        let dir = TempDir::new();
        let electron = dir.electron();
        let native = dir.native();
        for (text, nothing) in [
            ("{ not json", Nothing::Malformed),
            (
                r#"{"version":7,"closeToTray":true}"#,
                Nothing::UnknownVersion(7),
            ),
            (r#"{"other":true}"#, Nothing::NothingToImport),
        ] {
            fs::write(electron.join(ELECTRON_SETTINGS_FILE), text).unwrap();
            assert_eq!(
                import_from(&native, Some(&electron)),
                Import::Nothing(nothing),
                "{text}"
            );
            assert!(
                !native.join(SETTINGS_FILE).exists(),
                "nothing to import writes no file: {text}"
            );
        }
    }

    #[test]
    fn no_electron_folder_is_a_normal_first_run() {
        let dir = TempDir::new();
        let native = dir.native();
        assert_eq!(
            import_from(&native, None),
            Import::Nothing(Nothing::NoElectronSettings)
        );
        assert_eq!(
            import_from(&native, Some(&dir.0.join("absent"))),
            Import::Nothing(Nothing::NoElectronSettings)
        );
        assert_eq!(SettingsStore::load(&native).get(), &Settings::default());
    }
}
