//! Where the release feed comes from, what this install is, and how the updater's state becomes
//! what the UI draws.
//!
//! **The feed is a build-time constant that is empty today**: `SEMAPHORE_UPDATE_MANIFEST_URL`
//! is not set by any build in this repository yet, so a shipped app has nothing to check and
//! says so in its settings. A release build sets it (the packaging pipeline publishes the
//! manifest `scripts/package-linux.sh` writes; see `docs/packaging.md`). `SEMAPHORE_UPDATE_URL`
//! overrides it at run time, which is how the end-to-end rig points the app at a manifest served
//! from loopback; the override is held to the same rule as the build's URL, so it can only reach
//! HTTPS or a loopback address.
//!
//! Nothing here starts a download: [`start`] only decides whether this build and install can
//! update at all, and why not when it can't (the settings row shows that reason).

use semaphore_platform_desktop::update::{
    Arch, InstallEnv, InstallKind, ReadyAction, Schedule, UpdateState, feed_url_is_trusted,
};
use semaphore_ui::update::{ReadyHow, UpdateStatus};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// The run-time override of the build's feed. Only tests and rigs set it.
pub const FEED_URL_ENV: &str = "SEMAPHORE_UPDATE_URL";

/// The feed a release build is compiled with. Empty until releases are published, which is why
/// the shipped app never checks.
const BUILD_FEED: &str = match option_env!("SEMAPHORE_UPDATE_MANIFEST_URL") {
    Some(url) => url,
    None => "",
};

/// Why this build doesn't check for updates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhyNoUpdates {
    /// No feed was compiled in, and the environment didn't name one.
    NoFeed,
    /// The feed (or the override) isn't a URL the updater may fetch.
    BadFeed,
    /// A checkout, a sandbox, a format this build can't update, or a package it can't identify.
    UnsupportedInstall,
    /// The build's version isn't a semantic version, so nothing can be compared with a release.
    BadVersion,
}

impl WhyNoUpdates {
    /// What the settings row says under its button.
    pub fn note(self) -> &'static str {
        match self {
            Self::NoFeed => "This build has no update feed, so nothing is checked.",
            Self::BadFeed => "The update feed this build was given isn't an https address.",
            Self::UnsupportedInstall => {
                "Updates aren't available for the way this copy was installed."
            }
            Self::BadVersion => "This build's version can't be compared with a release.",
        }
    }
}

/// Everything the updater needs from this process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateOptions {
    pub manifest_url: String,
    pub install: InstallKind,
    pub cache_dir: PathBuf,
    pub schedule: Schedule,
}

/// Whether this build checks, and why not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateStart {
    On(Box<UpdateOptions>),
    Off(WhyNoUpdates),
}

/// The feed to read: `SEMAPHORE_UPDATE_URL` when set, else the build's constant.
pub fn feed_url() -> Option<String> {
    feed_from(std::env::var(FEED_URL_ENV).ok(), BUILD_FEED)
}

/// [`feed_url`]'s decision, so a test doesn't have to set the process's environment.
fn feed_from(from_env: Option<String>, build: &str) -> Option<String> {
    let from_env = from_env
        .map(|url| url.trim().to_owned())
        .filter(|url| !url.is_empty());
    from_env.or_else(|| {
        let build = build.trim();
        (!build.is_empty()).then(|| build.to_owned())
    })
}

/// This build's version, as `--version` reports it (`SEMAPHORE_VERSION`, from `build.rs`).
pub fn current_version() -> Result<semver::Version, WhyNoUpdates> {
    semver::Version::parse(env!("SEMAPHORE_VERSION")).map_err(|error| {
        log::warn!("updates are off: the build's version is not a semantic version: {error}");
        WhyNoUpdates::BadVersion
    })
}

/// Decides whether the updater runs in this process.
///
/// `install` is passed in so a rig can say what install to pretend to be; the app passes what
/// [`InstallEnv::current`] finds.
pub fn start_for(install: InstallKind, cache_dir: Option<PathBuf>) -> UpdateStart {
    let Some(url) = feed_url() else {
        return UpdateStart::Off(WhyNoUpdates::NoFeed);
    };
    if !feed_url_is_trusted(&url) {
        log::warn!("updates are off: {url} is not an https feed address");
        return UpdateStart::Off(WhyNoUpdates::BadFeed);
    }
    if current_version().is_err() {
        return UpdateStart::Off(WhyNoUpdates::BadVersion);
    }
    if Arch::current().is_none() {
        return UpdateStart::Off(WhyNoUpdates::UnsupportedInstall);
    }
    if matches!(install, InstallKind::Unknown) {
        return UpdateStart::Off(WhyNoUpdates::UnsupportedInstall);
    }
    let Some(cache_dir) = cache_dir else {
        return UpdateStart::Off(WhyNoUpdates::UnsupportedInstall);
    };
    UpdateStart::On(Box::new(UpdateOptions {
        manifest_url: url,
        install,
        cache_dir,
        schedule: Schedule::default(),
    }))
}

/// This machine's answer: what the app's `main` asks once.
pub fn start() -> UpdateStart {
    use semaphore_core::platform::AppPaths as _;
    // No home directory means nowhere to keep a download, which `start_for` reports.
    let cache_dir = semaphore_platform_desktop::DesktopPaths::new()
        .map(|paths| PathBuf::from(paths.cache_dir()));
    start_for(InstallEnv::current().detect(), cache_dir)
}

/// The flag that tells a build it was started by "Restart to update": it waits for the previous
/// app's single-instance lock instead of handing its launch to it.
pub const AFTER_UPDATE_FLAG: &str = "--after-update";

/// What the AppImage runtime sets for the image that is running. The new image's runtime sets its
/// own; inheriting these would point the new build at the old mount, which goes away when this
/// process exits.
const APPIMAGE_VARIABLES: &[&str] = &["APPIMAGE", "APPDIR", "ARGV0", "OWD"];

/// The command that starts the updated AppImage at `appimage`: `--after-update`, this launch's
/// `--server` if it had one, and this process's environment (`vars`) without the running image's
/// traces: the AppImage variables go, and every `:`-separated list loses its entries inside
/// `$APPDIR` (our AppRun puts `$APPDIR/usr/bin` on `PATH`; others add library paths). It starts
/// in the folder the user launched from (`$OWD`), else the home folder, never inside the old mount.
pub fn restart_command(
    appimage: &Path,
    server_url: Option<&str>,
    vars: impl IntoIterator<Item = (OsString, OsString)>,
) -> std::process::Command {
    let vars: Vec<(OsString, OsString)> = vars.into_iter().collect();
    let lookup = |name: &str| {
        vars.iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| PathBuf::from(value))
    };
    let appdir = lookup("APPDIR").filter(|dir| dir.is_absolute() && dir.parent().is_some());
    let directory = lookup("OWD")
        .filter(|dir| dir.is_absolute() && dir.is_dir())
        .filter(|dir| {
            !appdir
                .as_ref()
                .is_some_and(|appdir| dir.starts_with(appdir))
        })
        .or_else(|| lookup("HOME").filter(|dir| dir.is_absolute() && dir.is_dir()))
        .unwrap_or_else(|| PathBuf::from("/"));

    let mut command = std::process::Command::new(appimage);
    command.arg(AFTER_UPDATE_FLAG);
    if let Some(url) = server_url {
        command.arg("--server").arg(url);
    }
    command.env_clear();
    for (key, value) in &vars {
        if APPIMAGE_VARIABLES.iter().any(|name| key == *name) {
            continue;
        }
        match &appdir {
            Some(appdir) => {
                if let Some(value) = without_entries_under(value, appdir) {
                    command.env(key, value);
                }
            }
            None => {
                command.env(key, value);
            }
        }
    }
    command.current_dir(directory);
    command
}

/// `value` as a `:`-separated list without the entries inside `dir`; `None` when nothing is left
/// of a value that had some. A value that isn't UTF-8 is kept as it is unless it names `dir`.
fn without_entries_under(value: &OsStr, dir: &Path) -> Option<OsString> {
    let Some(text) = value.to_str() else {
        return (!Path::new(value).starts_with(dir)).then(|| value.to_owned());
    };
    if !text
        .split(':')
        .any(|entry| Path::new(entry).starts_with(dir))
    {
        return Some(value.to_owned());
    }
    let kept: Vec<&str> = text
        .split(':')
        .filter(|entry| !Path::new(entry).starts_with(dir))
        .collect();
    (!kept.is_empty()).then(|| OsString::from(kept.join(":")))
}

/// The updater's state as the banner and the settings row draw it.
pub fn status_of(state: &UpdateState) -> UpdateStatus {
    match state {
        UpdateState::Idle => UpdateStatus::Unknown,
        UpdateState::Checking => UpdateStatus::Checking,
        UpdateState::UpToDate => UpdateStatus::UpToDate,
        UpdateState::Available { version, notes_url } => UpdateStatus::Available {
            version: version.to_string(),
            notes_url: notes_url.clone(),
        },
        UpdateState::Downloading { received, total } => UpdateStatus::Downloading {
            received: *received,
            total: *total,
        },
        UpdateState::Ready { version, action } => UpdateStatus::Ready {
            version: version.to_string(),
            how: match action {
                ReadyAction::Restart { .. } => ReadyHow::Restart,
                ReadyAction::Package { command, .. } => ReadyHow::Package {
                    command: command.clone(),
                },
            },
        },
        UpdateState::Failed { message, retryable } => UpdateStatus::Failed {
            message: message.clone(),
            retryable: *retryable,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_platform_desktop::update::ReadyAction;
    use semaphore_ui::update::UpdateStatus;

    #[test]
    fn maps_every_state_for_the_ui() {
        let version = semver::Version::parse("1.4.0").unwrap();
        assert_eq!(status_of(&UpdateState::Idle), UpdateStatus::Unknown);
        assert_eq!(status_of(&UpdateState::Checking), UpdateStatus::Checking);
        assert_eq!(status_of(&UpdateState::UpToDate), UpdateStatus::UpToDate);
        assert_eq!(
            status_of(&UpdateState::Available {
                version: version.clone(),
                notes_url: Some("https://example.org/notes".into()),
            }),
            UpdateStatus::Available {
                version: "1.4.0".into(),
                notes_url: Some("https://example.org/notes".into()),
            }
        );
        assert_eq!(
            status_of(&UpdateState::Downloading {
                received: 40,
                total: 100,
            }),
            UpdateStatus::Downloading {
                received: 40,
                total: 100,
            }
        );
        assert_eq!(
            status_of(&UpdateState::Ready {
                version: version.clone(),
                action: ReadyAction::Restart {
                    path: "/home/mike/Semaphore.AppImage".into(),
                },
            }),
            UpdateStatus::Ready {
                version: "1.4.0".into(),
                how: ReadyHow::Restart,
            }
        );
        assert_eq!(
            status_of(&UpdateState::Ready {
                version,
                action: ReadyAction::Package {
                    path: "/tmp/a.deb".into(),
                    command: "sudo apt install '/tmp/a.deb'".into(),
                },
            }),
            UpdateStatus::Ready {
                version: "1.4.0".into(),
                how: ReadyHow::Package {
                    command: "sudo apt install '/tmp/a.deb'".into(),
                },
            }
        );
        assert_eq!(
            status_of(&UpdateState::Failed {
                message: "the server answered 503".into(),
                retryable: true,
            }),
            UpdateStatus::Failed {
                message: "the server answered 503".into(),
                retryable: true,
            }
        );
    }

    #[test]
    fn the_environment_names_a_feed_only_when_the_build_has_none() {
        assert_eq!(feed_from(None, ""), None);
        assert_eq!(
            feed_from(None, "https://example.org/latest.json"),
            Some("https://example.org/latest.json".into())
        );
        assert_eq!(
            feed_from(Some("http://127.0.0.1:9/latest.json".into()), ""),
            Some("http://127.0.0.1:9/latest.json".into())
        );
        // The override replaces the build's feed, even a blank one.
        assert_eq!(
            feed_from(Some("   ".into()), "https://example.org/latest.json"),
            Some("https://example.org/latest.json".into())
        );
        assert_eq!(
            feed_from(
                Some("https://staging.example.org/latest.json".into()),
                "https://example.org/latest.json"
            ),
            Some("https://staging.example.org/latest.json".into())
        );
    }

    fn vars(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs
            .iter()
            .map(|(key, value)| (OsString::from(key), OsString::from(value)))
            .collect()
    }

    fn envs(command: &std::process::Command) -> Vec<(String, String)> {
        let mut envs: Vec<(String, String)> = command
            .get_envs()
            .filter_map(|(key, value)| {
                Some((key.to_str()?.to_owned(), value?.to_str()?.to_owned()))
            })
            .collect();
        envs.sort();
        envs
    }

    /// The new AppImage starts clean: no trace of the old mount in its environment or working
    /// folder, the original `--server`, and the flag that makes it wait for this app's lock.
    #[test]
    fn the_restart_command_drops_the_old_images_traces() {
        let home = std::env::temp_dir();
        let home = home.to_str().unwrap();
        let command = restart_command(
            Path::new("/home/mike/Apps/Semaphore.AppImage"),
            Some("https://chat.example.org"),
            vars(&[
                ("APPIMAGE", "/home/mike/Apps/Semaphore.AppImage"),
                ("APPDIR", "/tmp/.mount_SemaXY"),
                ("ARGV0", "./Semaphore.AppImage"),
                ("OWD", "/nonexistent/launch/folder"),
                ("HOME", home),
                ("PATH", "/tmp/.mount_SemaXY/usr/bin:/usr/local/bin:/usr/bin"),
                ("LD_LIBRARY_PATH", "/tmp/.mount_SemaXY/usr/lib"),
                ("XDG_DATA_DIRS", "/usr/share:/tmp/.mount_SemaXY/usr/share"),
                ("APPIMAGE_EXTRACT_AND_RUN", "1"),
                ("WAYLAND_DISPLAY", "wayland-1"),
                // Looks like the mount but isn't inside it.
                ("OTHER", "/tmp/.mount_SemaXYZ/bin"),
            ]),
        );
        assert_eq!(command.get_program(), "/home/mike/Apps/Semaphore.AppImage");
        let args: Vec<&OsStr> = command.get_args().collect();
        assert_eq!(
            args,
            ["--after-update", "--server", "https://chat.example.org"]
        );
        assert_eq!(
            envs(&command),
            [
                ("APPIMAGE_EXTRACT_AND_RUN".to_owned(), "1".to_owned()),
                ("HOME".to_owned(), home.to_owned()),
                ("OTHER".to_owned(), "/tmp/.mount_SemaXYZ/bin".to_owned()),
                ("PATH".to_owned(), "/usr/local/bin:/usr/bin".to_owned()),
                ("WAYLAND_DISPLAY".to_owned(), "wayland-1".to_owned()),
                ("XDG_DATA_DIRS".to_owned(), "/usr/share".to_owned()),
            ]
        );
        // Every variable not listed is cleared, not inherited from this test process.
        assert!(command.get_envs().all(|(_, value)| value.is_some()));
        // OWD doesn't exist here, so it starts at home.
        assert_eq!(command.get_current_dir(), Some(Path::new(home)));
    }

    #[test]
    fn the_restart_command_starts_where_the_user_launched_from() {
        let owd = std::env::temp_dir();
        let command = restart_command(
            Path::new("/a/Semaphore.AppImage"),
            None,
            vars(&[("APPDIR", "/tmp/.mount_A"), ("OWD", owd.to_str().unwrap())]),
        );
        assert_eq!(command.get_current_dir(), Some(owd.as_path()));
        let args: Vec<&OsStr> = command.get_args().collect();
        assert_eq!(args, ["--after-update"]);
        // Neither OWD nor HOME usable: the root, never the old mount.
        let command = restart_command(
            Path::new("/a/Semaphore.AppImage"),
            None,
            vars(&[("APPDIR", "/tmp/.mount_A"), ("OWD", "/tmp/.mount_A/usr")]),
        );
        assert_eq!(command.get_current_dir(), Some(Path::new("/")));
    }

    #[test]
    fn why_no_updates_says_so() {
        assert_eq!(
            WhyNoUpdates::NoFeed.note(),
            "This build has no update feed, so nothing is checked."
        );
        assert_eq!(
            WhyNoUpdates::BadFeed.note(),
            "The update feed this build was given isn't an https address."
        );
        assert_eq!(
            WhyNoUpdates::UnsupportedInstall.note(),
            "Updates aren't available for the way this copy was installed."
        );
    }
}
