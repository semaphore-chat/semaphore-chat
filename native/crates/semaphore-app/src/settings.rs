//! The local settings store: typed, versioned JSON at `<data dir>/settings.json`.
//!
//! - A missing file gives the defaults; unknown fields are ignored.
//! - A file written by a newer build (`version` above [`CURRENT_VERSION`]) is never touched: the app
//!   runs on defaults in memory and `save` refuses, so an older build can't overwrite newer settings.
//! - A corrupt file is renamed to `settings.json.corrupt` and the defaults are used.
//! - Saves are atomic: a temp file in the same directory, fsynced, renamed over the old file. Mode
//!   0600 on Unix.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};

/// The settings file's name inside the data directory.
pub const SETTINGS_FILE: &str = "settings.json";
/// The schema version this build reads and writes.
pub const CURRENT_VERSION: u32 = 3;
/// A user's volume, in percent, is clamped to this.
pub const MAX_USER_VOLUME: u8 = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct VoiceSettings {
    pub input_device: Option<String>,
    pub output_device: Option<String>,
    pub noise_suppression: bool,
    pub echo_cancellation: bool,
    pub auto_gain: bool,
    /// Voice activity (with its threshold) or push to talk. v1's `push_to_talk` switch.
    pub input_mode: InputMode,
    /// A GPUI key name, lowercase (`"f13"`, `"space"`): `semaphore_ui::settings::key_capture`.
    pub push_to_talk_key: Option<String>,
    pub mic_quality: MicQuality,
    /// The camera's device id; `None` is the system's default.
    pub camera_device: Option<String>,
    /// How screen shares are sent. Wayland's portal starts straight from these, with no dialog of
    /// ours in between.
    pub screen_share: ShareSettings,
}

/// How the microphone opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum InputMode {
    /// Open while unmuted, gated below `threshold` (0..=100; 0 = most sensitive, the default).
    VoiceActivity {
        #[serde(default)]
        threshold: u8,
    },
    /// Open while the push-to-talk key (or the bar's button) is held.
    PushToTalk,
}

impl Default for InputMode {
    fn default() -> Self {
        Self::VoiceActivity { threshold: 0 }
    }
}

/// The microphone's encoding preset: `MicPreset` in the engine. High is the default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MicQuality {
    Standard,
    #[default]
    High,
    Music,
}

/// The box a screen share is scaled to fit, as the settings file spells it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShareSize {
    Native,
    #[serde(rename = "2160p")]
    P2160,
    #[serde(rename = "1440p")]
    P1440,
    #[default]
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "480p")]
    P480,
}

impl ShareSize {
    pub const ALL: [ShareSize; 6] = [
        Self::Native,
        Self::P2160,
        Self::P1440,
        Self::P1080,
        Self::P720,
        Self::P480,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Native => "Native",
            Self::P2160 => "4K",
            Self::P1440 => "1440p",
            Self::P1080 => "1080p",
            Self::P720 => "720p",
            Self::P480 => "480p",
        }
    }

    pub fn resolution(self) -> semaphore_core::model::ShareResolution {
        use semaphore_core::model::ShareResolution as R;
        match self {
            Self::Native => R::Native,
            Self::P2160 => R::P2160,
            Self::P1440 => R::P1440,
            Self::P1080 => R::P1080,
            Self::P720 => R::P720,
            Self::P480 => R::P480,
        }
    }
}

/// The frame rates offered.
pub const SHARE_FPS: [u32; 3] = [15, 30, 60];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ShareSettings {
    pub resolution: ShareSize,
    /// 15, 30 or 60; anything else reads as 30.
    pub fps: u32,
    /// Send the system's audio with the screen: everything except our own call.
    pub audio: bool,
}

impl Default for ShareSettings {
    /// 1080p at 30 fps with audio. 60 fps is offered, but software VP8 at 1080p60 is a heavy default.
    fn default() -> Self {
        Self {
            resolution: ShareSize::P1080,
            fps: 30,
            audio: true,
        }
    }
}

impl ShareSettings {
    /// What to ask core for. `source_id` is `None` where the system's picker chooses.
    pub fn request(&self, source_id: Option<String>) -> semaphore_core::model::ScreenShareRequest {
        semaphore_core::model::ScreenShareRequest {
            source_id,
            resolution: self.resolution.resolution(),
            fps: if SHARE_FPS.contains(&self.fps) {
                self.fps
            } else {
                30
            },
            audio: self.audio,
        }
    }
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            input_device: None,
            output_device: None,
            noise_suppression: true,
            echo_cancellation: true,
            auto_gain: true,
            input_mode: InputMode::default(),
            push_to_talk_key: None,
            mic_quality: MicQuality::default(),
            camera_device: None,
            screen_share: ShareSettings::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub version: u32,
    pub voice: VoiceSettings,
    /// Per-user playback volume in percent (0..=200), by user id.
    pub user_volumes: BTreeMap<String, u8>,
    pub close_to_tray: bool,
    pub window: Option<WindowState>,
    pub last_channel: Option<String>,
    /// "Load images from other sites (link previews, GIFs)": one switch for every third-party
    /// image, off by default, because each one tells that site the viewer's address. v2's
    /// `link_preview_images`, widened to GIFs.
    pub third_party_media: bool,
    /// The last appearance this app showed (`ThemeChoice::name`), so a start draws in it before
    /// the server's appearance arrives, and the signed-out screens keep it.
    pub theme: Option<String>,
    /// W4: the float card's placement per viewport bucket (`StoredPlacement`).
    pub float_placements: BTreeMap<String, StoredPlacement>,
    /// W4: the DM call's stage share of the column's height (0..1), as the web's
    /// `semaphore_dm_stage_ratio`. `None`: the default split.
    pub dm_stage_ratio: Option<f32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            voice: VoiceSettings::default(),
            user_volumes: BTreeMap::new(),
            // On, like Electron. Closing only hides while a tray host shows our icon.
            close_to_tray: true,
            window: None,
            last_channel: None,
            third_party_media: false,
            theme: None,
            float_placements: BTreeMap::new(),
            dm_stage_ratio: None,
        }
    }
}

/// W4: the float card's placement as saved, one per `semaphore_ui::voice::dock::viewport_bucket`.
/// `anchor` is `PipAnchor::name`; one that doesn't parse, or isn't `PipPlacement::is_valid`, is
/// ignored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredPlacement {
    pub anchor: String,
    pub offset_x: f32,
    pub offset_y: f32,
    pub width: f32,
    pub height: f32,
    pub docked: bool,
    pub collapsed: bool,
}

/// Why a save didn't happen.
#[derive(Debug)]
pub enum SaveError {
    /// The file on disk is from a newer build; it is left alone.
    NewerOnDisk,
    Io(std::io::Error),
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NewerOnDisk => {
                f.write_str("settings.json is from a newer version; not overwriting")
            }
            Self::Io(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for SaveError {}

impl From<std::io::Error> for SaveError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// The settings and where they live.
#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
    settings: Settings,
    /// The file on disk is newer than this build knows: never write.
    read_only: bool,
}

impl SettingsStore {
    /// Loads `<data_dir>/settings.json`. Never fails: see the module docs for each bad case.
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join(SETTINGS_FILE);
        let mut store = Self {
            path,
            settings: Settings::default(),
            read_only: false,
        };
        let text = match std::fs::read_to_string(&store.path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return store,
            Err(error) => {
                // Unreadable (permissions, not UTF-8): don't clobber it either.
                if error.kind() == std::io::ErrorKind::InvalidData {
                    store.quarantine();
                } else {
                    log::warn!("cannot read {}: {error}", store.path.display());
                    store.read_only = true;
                }
                return store;
            }
        };
        let Ok(value) = serde_json::from_str::<Value>(&text) else {
            store.quarantine();
            return store;
        };
        let Some(object) = value.as_object() else {
            store.quarantine();
            return store;
        };
        let version = match object.get("version") {
            None => 0,
            Some(v) => match v.as_u64().and_then(|v| u32::try_from(v).ok()) {
                Some(v) => v,
                None => {
                    store.quarantine();
                    return store;
                }
            },
        };
        if version > CURRENT_VERSION {
            log::warn!(
                "settings.json is version {version}, newer than {CURRENT_VERSION}: using defaults and leaving it alone"
            );
            store.read_only = true;
            return store;
        }
        let migrated = migrate(version, value);
        match serde_json::from_value::<Settings>(migrated) {
            Ok(mut settings) => {
                settings.version = CURRENT_VERSION;
                for percent in settings.user_volumes.values_mut() {
                    *percent = (*percent).min(MAX_USER_VOLUME);
                }
                // Keys are GPUI's lowercase names; an older build stored "F13".
                if let Some(key) = &mut settings.voice.push_to_talk_key {
                    *key = key.to_lowercase();
                }
                store.settings = settings;
            }
            Err(_) => store.quarantine(),
        }
        store
    }

    /// Settings that live only in memory: `save` refuses. For rigs and tests of other code.
    pub fn ephemeral(settings: Settings) -> Self {
        Self {
            path: PathBuf::new(),
            settings,
            read_only: true,
        }
    }

    pub fn get(&self) -> &Settings {
        &self.settings
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Whether `save` will refuse because a newer build's file is on disk.
    pub fn is_read_only(&self) -> bool {
        self.read_only
    }

    /// Changes the settings in memory, then saves them.
    pub fn update(&mut self, change: impl FnOnce(&mut Settings)) -> Result<(), SaveError> {
        change(&mut self.settings);
        self.settings.version = CURRENT_VERSION;
        for percent in self.settings.user_volumes.values_mut() {
            *percent = (*percent).min(MAX_USER_VOLUME);
        }
        self.save()
    }

    /// Sets one user's volume, clamped to 0..=200, and saves.
    pub fn set_user_volume(&mut self, user_id: &str, percent: u32) -> Result<(), SaveError> {
        let clamped =
            u8::try_from(percent.min(u32::from(MAX_USER_VOLUME))).unwrap_or(MAX_USER_VOLUME);
        self.update(|s| {
            s.user_volumes.insert(user_id.to_owned(), clamped);
        })
    }

    /// Writes the settings atomically. Refuses when a newer build's file is on disk.
    pub fn save(&self) -> Result<(), SaveError> {
        if self.read_only {
            return Err(SaveError::NewerOnDisk);
        }
        let dir = self.path.parent().unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(dir)?;
        let json = serde_json::to_vec_pretty(&self.settings).map_err(std::io::Error::other)?;
        let tmp = dir.join(format!("{SETTINGS_FILE}.tmp-{}", std::process::id()));
        let written = (|| -> std::io::Result<()> {
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt as _;
                options.mode(0o600);
            }
            let mut file = options.open(&tmp)?;
            file.write_all(&json)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&tmp, &self.path)
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&tmp);
        }
        Ok(written?)
    }

    /// Moves a file we can't parse aside, so the next save doesn't destroy what a person may want
    /// to repair by hand.
    fn quarantine(&mut self) {
        let mut corrupt = self.path.clone().into_os_string();
        corrupt.push(".corrupt");
        if let Err(error) = std::fs::rename(&self.path, PathBuf::from(&corrupt)) {
            log::warn!("cannot move the corrupt settings file aside: {error}");
            // Couldn't move it: don't write over it either.
            self.read_only = true;
        } else {
            log::warn!(
                "settings.json was unreadable; kept as settings.json.corrupt, using defaults"
            );
        }
    }
}

/// Brings an older file's JSON up to [`CURRENT_VERSION`], one step per version.
fn migrate(from_version: u32, mut value: Value) -> Value {
    let mut version = from_version;
    while version < CURRENT_VERSION {
        value = match version {
            0 => migrate_v0_to_v1(value),
            1 => migrate_v1_to_v2(value),
            2 => migrate_v2_to_v3(value),
            _ => value,
        };
        version += 1;
    }
    value
}

/// v0 had no `version` field and kept the push-to-talk and device choices at the top level.
fn migrate_v0_to_v1(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        let mut voice = match object.remove("voice") {
            Some(Value::Object(voice)) => voice,
            _ => serde_json::Map::new(),
        };
        for (old, new) in [
            ("input_device", "input_device"),
            ("output_device", "output_device"),
            ("push_to_talk", "push_to_talk"),
            ("push_to_talk_key", "push_to_talk_key"),
        ] {
            if let Some(v) = object.remove(old) {
                voice.entry(new).or_insert(v);
            }
        }
        object.insert("voice".to_owned(), Value::Object(voice));
        object.insert("version".to_owned(), Value::from(1));
    }
    value
}

/// v1 had a `push_to_talk` switch; v2 has `input_mode`, plus the mic quality, the camera and the
/// last theme (all defaulted when absent).
fn migrate_v1_to_v2(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        if let Some(Value::Object(voice)) = object.get_mut("voice") {
            let push_to_talk = matches!(voice.remove("push_to_talk"), Some(Value::Bool(true)));
            let mode = if push_to_talk {
                serde_json::json!({ "mode": "push_to_talk" })
            } else {
                serde_json::json!({ "mode": "voice_activity", "threshold": 0 })
            };
            voice.entry("input_mode").or_insert(mode);
        }
        object.insert("version".to_owned(), Value::from(2));
    }
    value
}

/// v2 had `link_preview_images`; v3 makes it the one third-party media switch (link previews and
/// GIFs), keeping the old choice.
fn migrate_v2_to_v3(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        let was_on = matches!(
            object.remove("link_preview_images"),
            Some(Value::Bool(true))
        );
        object
            .entry("third_party_media")
            .or_insert(Value::Bool(was_on));
        object.insert("version".to_owned(), Value::from(3));
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "semaphore-settings-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn file(&self) -> PathBuf {
            self.0.join(SETTINGS_FILE)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = TempDir::new();
        let store = SettingsStore::load(&dir.0);
        assert_eq!(store.get(), &Settings::default());
        assert!(!store.is_read_only());
        assert!(!store.get().third_party_media);
        assert!(!dir.file().exists(), "loading writes nothing");
    }

    #[test]
    fn share_settings_default_to_1080p30_with_audio_and_read_back() {
        let defaults = ShareSettings::default();
        let request = defaults.request(None);
        assert_eq!(
            request.resolution,
            semaphore_core::model::ShareResolution::P1080
        );
        assert_eq!(request.fps, 30);
        assert!(request.audio);
        assert_eq!(request.source_id, None);
        // An older file has no screen_share at all; a hand-edited one may have odd values.
        let old: VoiceSettings = serde_json::from_str(r#"{"auto_gain":true}"#).unwrap();
        assert_eq!(old.screen_share, defaults);
        let edited: ShareSettings =
            serde_json::from_str(r#"{"resolution":"2160p","fps":7}"#).unwrap();
        assert_eq!(edited.resolution, ShareSize::P2160);
        assert_eq!(edited.request(Some("s".into())).fps, 30);
        assert_eq!(
            serde_json::to_value(ShareSize::Native).unwrap(),
            serde_json::json!("native")
        );
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = TempDir::new();
        let mut store = SettingsStore::load(&dir.0);
        store
            .update(|s| {
                s.voice.input_device = Some("mic".into());
                s.voice.input_mode = InputMode::PushToTalk;
                s.voice.push_to_talk_key = Some("f13".into());
                s.voice.mic_quality = MicQuality::Music;
                s.voice.camera_device = Some("cam-2".into());
                s.theme = Some("light-teal-balanced".into());
                s.voice.screen_share = ShareSettings {
                    resolution: ShareSize::P2160,
                    fps: 60,
                    audio: false,
                };
                s.close_to_tray = true;
                s.last_channel = Some("cc-general".into());
                s.third_party_media = true;
                s.window = Some(WindowState {
                    x: -5,
                    y: 10,
                    width: 1280,
                    height: 800,
                    maximized: true,
                });
            })
            .unwrap();
        store.set_user_volume("u1", 150).unwrap();
        let loaded = SettingsStore::load(&dir.0);
        assert_eq!(loaded.get(), store.get());
        assert_eq!(loaded.get().user_volumes["u1"], 150);
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let dir = TempDir::new();
        std::fs::write(
            dir.file(),
            r#"{"version":1,"close_to_tray":true,"from_the_future":{"a":1},"voice":{"auto_gain":false,"extra":3}}"#,
        )
        .unwrap();
        let store = SettingsStore::load(&dir.0);
        assert!(store.get().close_to_tray);
        assert!(!store.get().voice.auto_gain);
        assert!(
            store.get().voice.noise_suppression,
            "absent fields take defaults"
        );
    }

    #[test]
    fn newer_version_is_left_untouched() {
        let dir = TempDir::new();
        let text = r#"{"version":99,"close_to_tray":true,"shiny":[1,2,3]}"#;
        std::fs::write(dir.file(), text).unwrap();
        let mut store = SettingsStore::load(&dir.0);
        assert_eq!(store.get(), &Settings::default(), "defaults in memory");
        assert!(store.is_read_only());
        assert!(matches!(
            store.update(|s| s.close_to_tray = false),
            Err(SaveError::NewerOnDisk)
        ));
        assert!(matches!(store.save(), Err(SaveError::NewerOnDisk)));
        assert_eq!(std::fs::read_to_string(dir.file()).unwrap(), text);
        assert!(!dir.0.join("settings.json.corrupt").exists());
    }

    #[test]
    fn corrupt_file_is_renamed_and_defaults_used() {
        let dir = TempDir::new();
        std::fs::write(dir.file(), "{ not json").unwrap();
        let mut store = SettingsStore::load(&dir.0);
        assert_eq!(store.get(), &Settings::default());
        assert!(!dir.file().exists());
        assert_eq!(
            std::fs::read_to_string(dir.0.join("settings.json.corrupt")).unwrap(),
            "{ not json"
        );
        store.update(|s| s.close_to_tray = true).unwrap();
        assert!(SettingsStore::load(&dir.0).get().close_to_tray);
    }

    #[test]
    fn wrong_types_count_as_corrupt() {
        let dir = TempDir::new();
        std::fs::write(dir.file(), r#"{"version":1,"close_to_tray":"yes"}"#).unwrap();
        let store = SettingsStore::load(&dir.0);
        assert_eq!(store.get(), &Settings::default());
        assert!(dir.0.join("settings.json.corrupt").exists());
    }

    #[test]
    fn volumes_are_clamped_on_set_and_on_load() {
        let dir = TempDir::new();
        let mut store = SettingsStore::load(&dir.0);
        store.set_user_volume("loud", 9000).unwrap();
        store.set_user_volume("zero", 0).unwrap();
        assert_eq!(store.get().user_volumes["loud"], 200);
        assert_eq!(store.get().user_volumes["zero"], 0);
        std::fs::write(
            dir.file(),
            r#"{"version":1,"user_volumes":{"a":250,"b":100}}"#,
        )
        .unwrap();
        let loaded = SettingsStore::load(&dir.0);
        assert_eq!(loaded.get().user_volumes["a"], 200);
        assert_eq!(loaded.get().user_volumes["b"], 100);
    }

    #[test]
    fn save_is_atomic_and_leaves_no_temp_file() {
        let dir = TempDir::new();
        let mut store = SettingsStore::load(&dir.0);
        store.update(|s| s.close_to_tray = true).unwrap();
        store.update(|s| s.close_to_tray = false).unwrap();
        let names: Vec<String> = std::fs::read_dir(&dir.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![SETTINGS_FILE.to_owned()]);
    }

    #[cfg(unix)]
    #[test]
    fn saved_file_is_private() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = TempDir::new();
        let mut store = SettingsStore::load(&dir.0);
        store.update(|s| s.close_to_tray = true).unwrap();
        let mode = std::fs::metadata(dir.file()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn creates_the_data_dir_on_save() {
        let dir = TempDir::new();
        let nested = dir.0.join("a").join("b");
        let mut store = SettingsStore::load(&nested);
        store.update(|s| s.close_to_tray = true).unwrap();
        assert!(nested.join(SETTINGS_FILE).exists());
    }

    #[test]
    fn migrates_v0_to_v1() {
        let v0 = serde_json::json!({
            "input_device": "old-mic",
            "push_to_talk": true,
            "push_to_talk_key": "F13",
            "close_to_tray": true
        });
        let migrated = migrate_v0_to_v1(v0);
        assert_eq!(migrated["version"], 1);
        assert_eq!(migrated["voice"]["push_to_talk"], true);
        let settings: Settings = serde_json::from_value(migrate(1, migrated)).unwrap();
        assert_eq!(settings.version, CURRENT_VERSION);
        assert_eq!(settings.voice.input_device.as_deref(), Some("old-mic"));
        assert_eq!(settings.voice.input_mode, InputMode::PushToTalk);
        assert_eq!(settings.voice.push_to_talk_key.as_deref(), Some("F13"));
        assert!(settings.close_to_tray);
    }

    #[test]
    fn loading_a_v0_file_migrates_it() {
        let dir = TempDir::new();
        std::fs::write(
            dir.file(),
            r#"{"push_to_talk":true,"input_device":"old-mic"}"#,
        )
        .unwrap();
        let store = SettingsStore::load(&dir.0);
        assert_eq!(store.get().version, CURRENT_VERSION);
        assert_eq!(store.get().voice.input_mode, InputMode::PushToTalk);
        assert_eq!(store.get().voice.input_device.as_deref(), Some("old-mic"));
    }

    #[test]
    fn migrates_a_v1_file_to_v2() {
        let dir = TempDir::new();
        std::fs::write(
            dir.file(),
            r#"{"version":1,"close_to_tray":false,"voice":{"push_to_talk":true,"push_to_talk_key":"F13","auto_gain":false}}"#,
        )
        .unwrap();
        let mut store = SettingsStore::load(&dir.0);
        let voice = &store.get().voice;
        assert_eq!(voice.input_mode, InputMode::PushToTalk);
        assert_eq!(voice.push_to_talk_key.as_deref(), Some("f13"), "lowercased");
        assert!(!voice.auto_gain);
        assert_eq!(voice.mic_quality, MicQuality::High);
        assert_eq!(voice.camera_device, None);
        assert!(!store.get().close_to_tray);
        // Off in v1 is voice activity at the most sensitive threshold.
        let off = migrate(
            1,
            serde_json::json!({"version": 1, "voice": {"push_to_talk": false}}),
        );
        assert_eq!(
            off["voice"]["input_mode"],
            serde_json::json!({"mode": "voice_activity", "threshold": 0})
        );
        // Saved back as v2, with no v1 switch left.
        store
            .update(|s| s.voice.mic_quality = MicQuality::Standard)
            .unwrap();
        let saved: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.file()).unwrap()).unwrap();
        assert_eq!(saved["version"], CURRENT_VERSION);
        assert_eq!(saved["voice"]["input_mode"]["mode"], "push_to_talk");
        assert_eq!(saved["voice"]["mic_quality"], "standard");
        assert!(saved["voice"].get("push_to_talk").is_none());
    }

    #[test]
    fn migrates_a_v2_file_to_the_one_third_party_media_switch() {
        for (old, expected) in [
            (
                serde_json::json!({"version": 2, "link_preview_images": true}),
                true,
            ),
            (
                serde_json::json!({"version": 2, "link_preview_images": false}),
                false,
            ),
            (serde_json::json!({"version": 2}), false),
        ] {
            let migrated = migrate(2, old);
            assert_eq!(migrated["version"], CURRENT_VERSION);
            assert_eq!(migrated["third_party_media"], expected);
            assert!(
                migrated.get("link_preview_images").is_none(),
                "the old switch is gone"
            );
        }
        let settings: Settings = serde_json::from_value(migrate(
            2,
            serde_json::json!({"version": 2, "link_preview_images": true}),
        ))
        .unwrap();
        assert!(settings.third_party_media);
    }

    #[test]
    fn migrating_current_version_changes_nothing() {
        let value = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(migrate(CURRENT_VERSION, value.clone()), value);
    }
}
