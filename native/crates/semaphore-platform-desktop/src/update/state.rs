//! The updater: the state the UI mirrors, the check and download that move it, and the schedule
//! that starts them.
//!
//! The states are electron-updater's events (`checking-for-update`, `update-available`,
//! `download-progress`, `update-downloaded`, `error`, `update-not-available`), plus `Idle` before
//! the first check. A check downloads as soon as it finds a newer version, as Electron does; a
//! `.deb`/`.rpm` download ends in `Ready` meaning "downloaded" (the app tells the user how to
//! install it), and an AppImage's ends in `Ready` meaning "in place: restart".
//!
//! **Checks never overlap a download**, and a check that finds a newer version than the one
//! already downloaded replaces it: the user ends up on the newest. A check that finds the same
//! version as `Ready` leaves `Ready` alone, so a second check doesn't throw away a downloaded
//! update.
//!
//! **Schedule** (Electron's, from `electron/main.ts`): once three seconds after start, then every
//! hour. [`Schedule`] is data so tests and rigs don't wait an hour; [`drive`] is the loop.

use crate::update::download::{self, DownloadError, DownloadRequest};
use crate::update::install::{InstallKind, ReadyAction};
use crate::update::manifest::{
    Arch, MAX_MANIFEST_BYTES, ManifestError, ReleaseManifest, verify_signature,
};
use semver::Version;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Electron checks three seconds after the window is ready (`setTimeout(..., 3000)` in
/// `setupAutoUpdater`).
pub const SETTLE: Duration = Duration::from_secs(3);
/// ... and then every hour (`setInterval(..., 60 * 60 * 1000)`).
pub const INTERVAL: Duration = Duration::from_secs(60 * 60);
/// A manifest that takes longer than this is not worth waiting for.
const MANIFEST_DEADLINE: Duration = Duration::from_secs(30);

/// When checks happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Schedule {
    pub settle: Duration,
    pub interval: Duration,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            settle: SETTLE,
            interval: INTERVAL,
        }
    }
}

/// What the updater is doing, as the UI shows it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum UpdateState {
    /// Nothing has been checked yet.
    #[default]
    Idle,
    Checking,
    /// The feed has nothing newer than this build.
    UpToDate,
    /// A newer release exists. A download starts at once for an install that can take one.
    Available {
        version: Version,
        notes_url: Option<String>,
    },
    Downloading {
        received: u64,
        total: u64,
    },
    /// Downloaded, and installed where the app can do that. `action` says what the UI offers.
    Ready {
        version: Version,
        action: ReadyAction,
    },
    Failed {
        message: String,
        retryable: bool,
    },
}

impl UpdateState {
    /// The release this state is about, when it is about one.
    pub fn version(&self) -> Option<&Version> {
        match self {
            Self::Available { version, .. } | Self::Ready { version, .. } => Some(version),
            _ => None,
        }
    }
}

/// Everything a check or a download needs. No environment is read here: the app (or a rig)
/// decides.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateConfig {
    pub manifest_url: String,
    /// This build's version, as `--version` reports it.
    pub current_version: Version,
    pub install: InstallKind,
    /// Where a package download goes: `<cache>/updates`.
    pub cache_dir: PathBuf,
    pub arch: Arch,
    /// Sent with every request, so a release host can see which client asked.
    pub user_agent: String,
}

/// Called with every new state, on whatever thread the check runs. Must not block.
pub type UpdateSink = Arc<dyn Fn(&UpdateState) + Send + Sync>;

/// A fetched manifest that couldn't be used.
#[derive(Debug, Clone, PartialEq, Eq)]
enum FetchError {
    Manifest(ManifestError),
    Network(String),
    Status(u16),
    Insecure(String),
    TooLarge,
}

impl FetchError {
    fn retryable(&self) -> bool {
        match self {
            Self::Manifest(_) | Self::Insecure(_) => false,
            Self::Network(_) => true,
            Self::Status(status) => *status >= 500 || *status == 408 || *status == 429,
            Self::TooLarge => false,
        }
    }
}

impl From<FetchError> for UpdateState {
    fn from(error: FetchError) -> Self {
        let retryable = error.retryable();
        let message = match error {
            FetchError::Manifest(error) => error.to_string(),
            FetchError::Network(message) => {
                format!("The update server couldn't be reached: {message}")
            }
            FetchError::Status(status) => {
                format!("The update server answered {status}.")
            }
            FetchError::Insecure(message) => format!("The update check was refused: {message}"),
            FetchError::TooLarge => {
                "The update feed's answer was too large to be a manifest.".into()
            }
        };
        UpdateState::Failed { message, retryable }
    }
}

#[derive(Default)]
struct Inner {
    state: Mutex<UpdateState>,
    manifest: Mutex<Option<ReleaseManifest>>,
    sink: Mutex<Option<UpdateSink>>,
}

/// The updater, shared (and cloned) by the check that runs it and the UI that watches it.
#[derive(Clone)]
pub struct Updater {
    config: Arc<UpdateConfig>,
    client: reqwest::Client,
    inner: Arc<Inner>,
}

impl fmt::Debug for Updater {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Updater")
            .field("manifest_url", &self.config.manifest_url)
            .field("install", &self.config.install)
            .field("state", &self.state())
            .finish()
    }
}

impl Updater {
    pub fn new(config: UpdateConfig, client: reqwest::Client) -> Self {
        Self {
            config: Arc::new(config),
            client,
            inner: Arc::new(Inner::default()),
        }
    }

    pub fn config(&self) -> &UpdateConfig {
        &self.config
    }

    pub fn state(&self) -> UpdateState {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    /// Every later state goes to `sink` as well as being kept.
    pub fn set_sink(&self, sink: UpdateSink) {
        *self
            .inner
            .sink
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(sink);
    }

    fn set_state(&self, state: UpdateState) {
        {
            let mut current = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            *current = state.clone();
        }
        let sink = self
            .inner
            .sink
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();
        if let Some(sink) = sink {
            sink(&state);
        }
    }

    /// Reads the feed and decides. Never starts or interrupts a download; the UI says what is
    /// available and [`Updater::download`] fetches it.
    pub async fn check(&self) -> UpdateState {
        // One transfer at a time: a check while downloading would either be ignored or throw
        // away the transfer in progress.
        let previous = self.state();
        if matches!(previous, UpdateState::Downloading { .. }) {
            return previous;
        }
        self.set_state(UpdateState::Checking);
        match self.fetch_manifest().await {
            Ok(manifest) => self.apply(manifest, previous),
            Err(error) => {
                let state = UpdateState::from(error);
                self.set_state(state.clone());
                state
            }
        }
    }

    /// A check followed by a download when the release is newer and this install takes one.
    pub async fn check_and_download(&self) -> UpdateState {
        let checked = self.check().await;
        if matches!(checked, UpdateState::Available { .. }) && self.config.install.downloads() {
            return self.download().await;
        }
        checked
    }

    async fn fetch_manifest(&self) -> Result<ReleaseManifest, FetchError> {
        let url = &self.config.manifest_url;
        let response = tokio::time::timeout(
            MANIFEST_DEADLINE,
            self.client
                .get(url)
                .header(reqwest::header::USER_AGENT, &self.config.user_agent)
                .send(),
        )
        .await
        .map_err(|_| FetchError::Network("it didn't answer in time".into()))?
        .map_err(|error| FetchError::Network(error.to_string()))?;
        if !response.status().is_success() {
            return Err(FetchError::Status(response.status().as_u16()));
        }
        download::check_final_url(url, response.url())
            .map_err(|error| FetchError::Insecure(error.to_string()))?;
        let mut body = Vec::new();
        let mut response = response;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| FetchError::Network(error.to_string()))?
        {
            body.extend_from_slice(&chunk);
            if body.len() > MAX_MANIFEST_BYTES {
                return Err(FetchError::TooLarge);
            }
        }
        verify_signature(&body, url).map_err(FetchError::Manifest)?;
        ReleaseManifest::parse(&body).map_err(FetchError::Manifest)
    }

    /// Moves to `UpToDate`, `Available` or `Failed` for a manifest that was read. `previous` is
    /// the state before this check, so a downloaded update isn't forgotten.
    fn apply(&self, manifest: ReleaseManifest, previous: UpdateState) -> UpdateState {
        let ready = match &previous {
            UpdateState::Ready { version, .. } => Some(version.clone()),
            _ => None,
        };
        let newer = manifest.version > self.config.current_version;
        // A newer release than the one already downloaded replaces it; the same one keeps the
        // download the user already has.
        let already_have_it = ready.is_some_and(|version| version >= manifest.version);
        if !newer || already_have_it {
            let state = if already_have_it {
                previous
            } else {
                UpdateState::UpToDate
            };
            *self
                .inner
                .manifest
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()) = None;
            self.set_state(state.clone());
            return state;
        }

        let Some(kind) = self.config.install.artifact_kind() else {
            let state = UpdateState::Failed {
                message: format!(
                    "Version {} can't be installed on {}. Check the release page.",
                    manifest.version,
                    self.config.install.label()
                ),
                retryable: false,
            };
            self.set_state(state.clone());
            return state;
        };
        if manifest.artifact_for(kind, self.config.arch).is_none() {
            let state = UpdateState::Failed {
                message: format!(
                    "Version {} has no {} download for {}.",
                    manifest.version,
                    kind.name(),
                    self.config.arch.name()
                ),
                retryable: false,
            };
            self.set_state(state.clone());
            return state;
        }

        let state = UpdateState::Available {
            version: manifest.version.clone(),
            notes_url: manifest.notes_url.clone(),
        };
        *self
            .inner
            .manifest
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(manifest);
        self.set_state(state.clone());
        state
    }

    /// Downloads the available release and, for an AppImage, installs it. The state reaches
    /// `Ready` only after the SHA-256 matched and the file is in place.
    pub async fn download(&self) -> UpdateState {
        let UpdateState::Available { version, .. } = self.state() else {
            return self.state();
        };
        let manifest = self
            .inner
            .manifest
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();
        let Some(artifact) = manifest
            .as_ref()
            .and_then(|manifest| self.artifact(manifest))
        else {
            let state = UpdateState::Failed {
                message: "There is no update to download. Check again.".into(),
                retryable: true,
            };
            self.set_state(state.clone());
            return state;
        };
        let target = match self.target(&artifact, &version) {
            Ok(target) => target,
            Err(error) => {
                let state = failure(&error);
                self.set_state(state.clone());
                return state;
            }
        };

        self.set_state(UpdateState::Downloading {
            received: 0,
            total: artifact.size,
        });
        let reported = std::sync::atomic::AtomicU8::new(0);
        let mut progress = |received: u64, total: u64| {
            let percent = received
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(0)
                .min(100) as u8;
            if percent != reported.load(std::sync::atomic::Ordering::Relaxed) {
                reported.store(percent, std::sync::atomic::Ordering::Relaxed);
                self.set_state(UpdateState::Downloading { received, total });
            }
        };
        let request = DownloadRequest {
            artifact: &artifact,
            target: target.clone(),
            executable: self.config.install.installs_itself(),
            keep_previous: self.config.install.installs_itself(),
        };
        match download::download(
            &self.client,
            &request,
            &self.config.user_agent,
            &mut progress,
        )
        .await
        {
            Ok(()) => {
                let state = match &self.config.install {
                    InstallKind::AppImage { .. } => UpdateState::Ready {
                        version,
                        action: ReadyAction::Restart { path: target },
                    },
                    InstallKind::Deb { .. } | InstallKind::Rpm { .. } => UpdateState::Ready {
                        version,
                        action: ReadyAction::Package {
                            command: self
                                .config
                                .install
                                .command(&target)
                                .unwrap_or_else(|| format!("install {}", target.display())),
                            path: target,
                        },
                    },
                    // `target` refuses these, so a download never gets here; a caller that asked
                    // anyway gets nothing installed.
                    InstallKind::WindowsZip | InstallKind::Unknown => UpdateState::Failed {
                        message: "This installation doesn't download updates.".into(),
                        retryable: false,
                    },
                };
                *self
                    .inner
                    .manifest
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner()) = None;
                self.set_state(state.clone());
                state
            }
            Err(error) => {
                let state = failure(&error);
                self.set_state(state.clone());
                state
            }
        }
    }

    fn artifact(&self, manifest: &ReleaseManifest) -> Option<crate::update::manifest::Artifact> {
        manifest
            .artifact_for(self.config.install.artifact_kind()?, self.config.arch)
            .cloned()
    }

    /// Where this install's download goes.
    fn target(
        &self,
        artifact: &crate::update::manifest::Artifact,
        version: &Version,
    ) -> Result<PathBuf, DownloadError> {
        match &self.config.install {
            InstallKind::AppImage { path } => Ok(path.clone()),
            InstallKind::Deb { .. } | InstallKind::Rpm { .. } => {
                let extension = artifact.kind.extension();
                let name = download::package_name(&artifact.url, &version.to_string(), extension);
                Ok(self.cache_dir().join(name))
            }
            InstallKind::WindowsZip | InstallKind::Unknown => Err(DownloadError::Target(
                "this install doesn't download updates".into(),
            )),
        }
    }

    /// `<cache dir>/updates`, created on demand by the download.
    fn cache_dir(&self) -> PathBuf {
        self.config.cache_dir.join("updates")
    }
}

fn failure(error: &DownloadError) -> UpdateState {
    UpdateState::Failed {
        message: error.to_string(),
        retryable: error.retryable(),
    }
}

/// Checks after `settle`, then every `interval`, until `stop` says otherwise (or the app's
/// runtime goes away with it).
pub async fn drive(
    updater: Updater,
    schedule: Schedule,
    mut stop: tokio::sync::watch::Receiver<bool>,
) {
    if !wait(&mut stop, schedule.settle).await {
        return;
    }
    loop {
        updater.check_and_download().await;
        if !wait(&mut stop, schedule.interval).await {
            return;
        }
    }
}

/// Sleeps for `duration`, or returns false at once when the updater was asked to stop.
async fn wait(stop: &mut tokio::sync::watch::Receiver<bool>, duration: Duration) -> bool {
    if *stop.borrow_and_update() {
        return false;
    }
    tokio::select! {
        () = tokio::time::sleep(duration) => true,
        changed = stop.changed() => {
            let _ = changed;
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::download::previous_path;
    use crate::update::manifest::{Artifact, ArtifactKind, Sha256Digest};
    use crate::update::testserver::{Response, Server, client};
    use sha2::{Digest as _, Sha256};
    use tokio::sync::mpsc;

    const BODY: &[u8] = b"#!fake AppImage\nbuilt by the test\n";
    const VERSION: &str = "9.9.9";

    fn digest(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn manifest_json(version: &str, url: &str, body: &[u8]) -> String {
        format!(
            r#"{{"version": "{version}", "notes_url": "https://example.org/notes",
                "artifacts": [{{"kind": "appimage", "arch": "x86_64", "url": "{url}",
                                "sha256": "{}", "size": {}}}]}}"#,
            digest(body),
            body.len()
        )
    }

    struct Fixture {
        server: Server,
        dir: PathBuf,
        appimage: PathBuf,
        config: UpdateConfig,
    }

    impl Fixture {
        async fn new(name: &str) -> Self {
            let server = Server::start().await;
            let dir = std::env::temp_dir().join(format!(
                "semaphore-updater-{name}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let appimage = dir.join("Semaphore-Chat-Native.AppImage");
            std::fs::write(&appimage, b"the running build").unwrap();
            let config = UpdateConfig {
                manifest_url: server.url("/latest.json"),
                current_version: Version::parse("0.9.0").unwrap(),
                install: InstallKind::AppImage {
                    path: appimage.clone(),
                },
                cache_dir: dir.join("cache"),
                arch: Arch::X86_64,
                user_agent: "semaphore-test".into(),
            };
            Self {
                server,
                dir,
                appimage,
                config,
            }
        }

        fn updater(&self) -> Updater {
            Updater::new(self.config.clone(), client())
        }

        fn serve(&self, body: &[u8]) {
            self.server.route(
                "/latest.json",
                Response::ok(manifest_json(
                    VERSION,
                    &self.server.url("/a.AppImage"),
                    body,
                )),
            );
            self.server.route("/a.AppImage", Response::ok(body));
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[tokio::test]
    async fn a_newer_release_becomes_available_and_then_ready() {
        let fixture = Fixture::new("happy").await;
        fixture.serve(BODY);
        let updater = fixture.updater();
        let (states_tx, mut states_rx) = mpsc::unbounded_channel();
        updater.set_sink(Arc::new(move |state| {
            let _ = states_tx.send(state.clone());
        }));

        let state = updater.check_and_download().await;
        let UpdateState::Ready { version, action } = state else {
            panic!("expected Ready, got {state:?}");
        };
        assert_eq!(version.to_string(), VERSION);
        assert_eq!(
            action,
            ReadyAction::Restart {
                path: fixture.appimage.clone()
            }
        );
        assert_eq!(std::fs::read(&fixture.appimage).unwrap(), BODY);
        assert_eq!(
            std::fs::read(previous_path(&fixture.appimage)).unwrap(),
            b"the running build"
        );
        let seen: Vec<UpdateState> = std::iter::from_fn(|| states_rx.try_recv().ok()).collect();
        assert!(
            seen.contains(&UpdateState::Available {
                version: Version::parse(VERSION).unwrap(),
                notes_url: Some("https://example.org/notes".into())
            }),
            "{seen:?}"
        );
        assert!(
            seen.iter().any(|state| matches!(
                state,
                UpdateState::Downloading { received, total } if *received == 0 && *total == BODY.len() as u64
            )),
            "{seen:?}"
        );
    }

    #[tokio::test]
    async fn the_same_version_is_up_to_date() {
        let fixture = Fixture::new("uptodate").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json("0.9.0", &fixture.server.url("/a"), BODY)),
        );
        let updater = fixture.updater();
        assert_eq!(updater.check().await, UpdateState::UpToDate);
        assert_eq!(fixture.server.count("/a.AppImage"), 0);
    }

    #[tokio::test]
    async fn an_older_version_in_the_feed_is_up_to_date() {
        let fixture = Fixture::new("older").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json("0.8.9", &fixture.server.url("/a"), BODY)),
        );
        assert_eq!(fixture.updater().check().await, UpdateState::UpToDate);
    }

    #[tokio::test]
    async fn a_release_without_this_installs_artifact_is_refused_once() {
        let fixture = Fixture::new("noartifact").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(format!(
                r#"{{"version": "{VERSION}", "artifacts": [
                    {{"kind": "deb", "arch": "x86_64", "url": "https://example.org/a.deb",
                      "sha256": "{}", "size": 1}}]}}"#,
                digest(BODY)
            )),
        );
        let state = fixture.updater().check().await;
        let UpdateState::Failed { message, retryable } = state else {
            panic!("expected Failed, got {state:?}");
        };
        assert!(message.contains("no appimage download"), "{message}");
        assert!(!retryable);
    }

    /// A check in the middle of a transfer neither reads the feed nor disturbs the download: the
    /// server holds the body open, so the state stays `Downloading` until the test lets go.
    #[tokio::test]
    async fn check_while_downloading_is_ignored() {
        let fixture = Fixture::new("busy").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json(
                VERSION,
                &fixture.server.url("/a.AppImage"),
                BODY,
            )),
        );
        fixture.server.route(
            "/a.AppImage",
            Response::ok(BODY).stall_after(BODY.len() / 2),
        );
        let updater = fixture.updater();
        assert!(matches!(
            updater.check().await,
            UpdateState::Available { .. }
        ));
        let transfer = tokio::spawn({
            let updater = updater.clone();
            async move { updater.download().await }
        });
        tokio::time::timeout(Duration::from_secs(10), async {
            while !matches!(updater.state(), UpdateState::Downloading { .. }) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the download never started");

        let state = updater.check().await;
        assert!(
            matches!(state, UpdateState::Downloading { .. }),
            "{state:?}"
        );
        assert_eq!(
            fixture.server.count("/latest.json"),
            1,
            "a check during a download read the feed"
        );
        transfer.abort();
    }

    /// A release newer than the one downloaded replaces it, before the restart.
    #[tokio::test]
    async fn a_newer_release_supersedes_a_ready_one() {
        let fixture = Fixture::new("supersede").await;
        fixture.serve(BODY);
        let updater = fixture.updater();
        assert!(matches!(
            updater.check_and_download().await,
            UpdateState::Ready { .. }
        ));

        let next = b"a newer build\n";
        let server = &fixture.server;
        server.route(
            "/latest.json",
            Response::ok(format!(
                r#"{{"version": "9.9.10", "artifacts": [{{"kind": "appimage", "arch": "x86_64",
                    "url": "{}", "sha256": "{}", "size": {}}}]}}"#,
                server.url("/b.AppImage"),
                digest(next),
                next.len()
            )),
        );
        server.route("/b.AppImage", Response::ok(next));
        let state = updater.check_and_download().await;
        assert_eq!(state.version().unwrap().to_string(), "9.9.10");
        assert_eq!(std::fs::read(&fixture.appimage).unwrap(), next);
    }

    /// The same release does not throw the downloaded update away.
    #[tokio::test]
    async fn a_ready_update_survives_a_repeat_check() {
        let fixture = Fixture::new("repeat").await;
        fixture.serve(BODY);
        let updater = fixture.updater();
        let ready = updater.check_and_download().await;
        assert!(matches!(ready, UpdateState::Ready { .. }));
        assert_eq!(updater.check().await, ready);
        assert_eq!(updater.check_and_download().await, ready);
        assert_eq!(fixture.server.count("/a.AppImage"), 1);
    }

    #[tokio::test]
    async fn a_server_that_is_down_is_a_retryable_failure() {
        let fixture = Fixture::new("down").await;
        fixture.server.route("/latest.json", Response::status(503));
        let state = fixture.updater().check().await;
        let UpdateState::Failed { message, retryable } = state else {
            panic!("expected Failed, got {state:?}");
        };
        assert!(message.contains("503"), "{message}");
        assert!(retryable);
    }

    #[tokio::test]
    async fn a_manifest_that_is_not_one_is_not_retryable() {
        let fixture = Fixture::new("badmanifest").await;
        fixture
            .server
            .route("/latest.json", Response::ok("{not a manifest"));
        let state = fixture.updater().check().await;
        let UpdateState::Failed { retryable, message } = state else {
            panic!("expected Failed, got {state:?}");
        };
        assert!(!retryable);
        assert!(message.contains("not JSON"), "{message}");
    }

    #[tokio::test]
    async fn a_deb_is_downloaded_with_the_command_to_install_it() {
        let fixture = Fixture::new("deb").await;
        let config = UpdateConfig {
            install: InstallKind::Deb {
                path: "/usr/bin/semaphore-app".into(),
            },
            ..fixture.config.clone()
        };
        fixture.server.route(
            "/latest.json",
            Response::ok(format!(
                r#"{{"version": "{VERSION}", "artifacts": [{{"kind": "deb", "arch": "x86_64",
                    "url": "{}", "sha256": "{}", "size": {}}}]}}"#,
                fixture.server.url("/semaphore-chat-native_9.9.9_amd64.deb"),
                digest(BODY),
                BODY.len()
            )),
        );
        fixture
            .server
            .route("/semaphore-chat-native_9.9.9_amd64.deb", Response::ok(BODY));
        let updater = Updater::new(config, client());
        let state = updater.check_and_download().await;
        let UpdateState::Ready {
            action: ReadyAction::Package { path, command },
            ..
        } = state
        else {
            panic!("expected a downloaded package, got {state:?}");
        };
        assert_eq!(
            path,
            fixture
                .dir
                .join("cache/updates/semaphore-chat-native_9.9.9_amd64.deb")
        );
        assert_eq!(std::fs::read(&path).unwrap(), BODY);
        assert!(
            command.starts_with("sudo dpkg -i '")
                && command.contains("semaphore-chat-native_9.9.9_amd64.deb"),
            "{command}"
        );
        // The running file of another install is not touched.
        assert_eq!(
            std::fs::read(&fixture.appimage).unwrap(),
            b"the running build"
        );
    }

    #[tokio::test]
    async fn windows_keeps_the_link_and_downloads_nothing() {
        let fixture = Fixture::new("windows").await;
        let config = UpdateConfig {
            install: InstallKind::WindowsZip,
            ..fixture.config.clone()
        };
        fixture.server.route(
            "/latest.json",
            Response::ok(format!(
                r#"{{"version": "{VERSION}", "artifacts": [{{"kind": "windows-zip", "arch": "x86_64",
                    "url": "https://example.org/Semaphore-Chat-Native-{VERSION}-portable.zip",
                    "sha256": "{}", "size": 1}}]}}"#,
                digest(BODY)
            )),
        );
        let updater = Updater::new(config, client());
        let state = updater.check_and_download().await;
        assert!(matches!(state, UpdateState::Available { .. }), "{state:?}");
        assert_eq!(fixture.server.count("/latest.json"), 1);
    }

    /// A download failure after `Available` reports bytes or a hash, never a partial file.
    #[tokio::test]
    async fn a_corrupt_download_is_a_retryable_failure() {
        let fixture = Fixture::new("corrupt").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json(
                VERSION,
                &fixture.server.url("/a.AppImage"),
                BODY,
            )),
        );
        // The same length, different bytes: a transfer that completed but was corrupted.
        fixture
            .server
            .route("/a.AppImage", Response::ok(vec![b'x'; BODY.len()]));
        let updater = fixture.updater();
        let state = updater.check_and_download().await;
        let UpdateState::Failed { message, retryable } = state else {
            panic!("expected Failed, got {state:?}");
        };
        assert!(message.contains("SHA-256"), "{message}");
        assert!(retryable);
        assert_eq!(
            std::fs::read(&fixture.appimage).unwrap(),
            b"the running build"
        );
        assert!(!download::temporary_path(&fixture.appimage).exists());
        assert!(!previous_path(&fixture.appimage).exists());
    }

    #[tokio::test]
    async fn a_manifest_over_the_size_cap_is_refused() {
        let fixture = Fixture::new("bigmanifest").await;
        let padding = "x".repeat(MAX_MANIFEST_BYTES + 1);
        fixture.server.route("/latest.json", Response::ok(padding));
        let state = fixture.updater().check().await;
        assert!(
            matches!(
                state,
                UpdateState::Failed {
                    retryable: false,
                    ..
                }
            ),
            "{state:?}"
        );
    }

    #[tokio::test]
    async fn the_schedule_checks_once_and_stops_when_asked() {
        let fixture = Fixture::new("drive").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json("0.9.0", &fixture.server.url("/a"), BODY)),
        );
        let updater = fixture.updater();
        let (sink_tx, mut sink_rx) = mpsc::unbounded_channel();
        updater.set_sink(Arc::new(move |state| {
            let _ = sink_tx.send(state.clone());
        }));
        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
        let task = tokio::spawn(drive(
            updater,
            Schedule {
                settle: Duration::ZERO,
                interval: INTERVAL,
            },
            stop_rx,
        ));
        // The check finishes as soon as the server answers; nothing waits on the interval.
        let first = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let state = sink_rx.recv().await.unwrap();
                if matches!(state, UpdateState::UpToDate) {
                    break state;
                }
            }
        })
        .await
        .expect("the first check never finished");
        assert_eq!(first, UpdateState::UpToDate);
        stop_tx.send(true).unwrap();
        tokio::time::timeout(Duration::from_secs(10), task)
            .await
            .expect("the loop kept going after stop")
            .unwrap();
    }

    #[test]
    fn a_digest_of_a_known_body() {
        assert_eq!(
            Sha256Digest::parse(&digest(b"")).unwrap().to_string(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn a_windows_or_unknown_install_has_no_artifact() {
        assert_eq!(
            InstallKind::WindowsZip.artifact_kind(),
            Some(ArtifactKind::WindowsZip)
        );
        assert_eq!(InstallKind::Unknown.artifact_kind(), None);
        let artifact = Artifact {
            kind: ArtifactKind::Deb,
            arch: Arch::X86_64,
            url: "https://example.org/a.deb".into(),
            sha256: Sha256Digest::parse(&digest(BODY)).unwrap(),
            size: BODY.len() as u64,
        };
        assert_eq!(artifact.kind.extension(), "deb");
    }
}
