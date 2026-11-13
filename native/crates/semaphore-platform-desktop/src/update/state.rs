//! The updater: the state the UI mirrors, the check and download that move it, and the schedule
//! that starts them.
//!
//! The states are electron-updater's events (`checking-for-update`, `update-available`,
//! `download-progress`, `update-downloaded`, `error`, `update-not-available`), plus `Idle` before
//! the first check. A check downloads as soon as it finds a newer version, as Electron does; a
//! `.deb`/`.rpm` download ends in `Ready` meaning "downloaded" (the app tells the user how to
//! install it), and an AppImage's ends in `Ready` meaning "in place: restart".
//!
//! **One operation at a time.** A check, a download, or a check followed by a download holds the
//! updater's one busy flag for its whole length; another started meanwhile (a manual check during
//! the scheduled one, Retry during a download) does nothing and returns the current state. So two
//! transfers never share the temporary file, and only the operation holding the flag ever changes
//! the state.
//!
//! **Ready sticks.** Once an update is downloaded (and, for an AppImage, already in place), a later
//! check that fails, finds the same or an older version, or finds a newer one whose download then
//! fails, leaves `Ready` as it was: the file on disk is still the update. Only a newer `Ready`
//! replaces it.
//!
//! **Which versions count.** Newer is semver precedence ([`is_newer`]: build metadata never makes
//! a version newer). A stable build ignores pre-release versions in the feed; a pre-release build
//! accepts them.
//!
//! **A release whose bytes are wrong** (hash mismatch, larger than it says) is remembered by
//! version and SHA-256: the hourly schedule doesn't fetch the same artifact again. A manual check
//! does.
//!
//! **Schedule** (Electron's, from `electron/main.ts`): once three seconds after start, then every
//! hour. [`Schedule`] is data so tests and rigs don't wait an hour; [`drive`] is the loop.

use crate::update::download::{self, DownloadError, DownloadRequest, Stall};
use crate::update::install::{InstallKind, ReadyAction};
use crate::update::manifest::{
    Arch, Artifact, MAX_MANIFEST_BYTES, ManifestError, ReleaseManifest, Sha256Digest,
    verify_signature,
};
use crate::update::version::is_newer;
use semver::Version;
use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Electron checks three seconds after the window is ready (`setTimeout(..., 3000)` in
/// `setupAutoUpdater`).
pub const SETTLE: Duration = Duration::from_secs(3);
/// ... and then every hour (`setInterval(..., 60 * 60 * 1000)`).
pub const INTERVAL: Duration = Duration::from_secs(60 * 60);
/// The whole manifest fetch, body included, must finish within this.
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

    fn from_request(error: &reqwest::Error) -> Self {
        match download::request_error(error) {
            DownloadError::Insecure(message) => Self::Insecure(message),
            other => Self::Network(match other {
                DownloadError::Network(message) => message,
                other => other.to_string(),
            }),
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

/// Who asked: the schedule doesn't refetch an artifact known to be wrong; a person does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Trigger {
    Schedule,
    Manual,
}

/// An artifact whose bytes didn't match its release, and the failure it gave.
#[derive(Debug, Clone)]
struct BadArtifact {
    version: Version,
    sha256: Sha256Digest,
    failure: UpdateState,
}

#[derive(Default)]
struct Inner {
    state: Mutex<UpdateState>,
    manifest: Mutex<Option<ReleaseManifest>>,
    sink: Mutex<Option<UpdateSink>>,
    /// Held by the one check or download in progress.
    busy: AtomicBool,
    /// The newest `Ready`: kept through later failures.
    ready: Mutex<Option<UpdateState>>,
    bad: Mutex<Option<BadArtifact>>,
}

/// Holds [`Inner::busy`] until dropped (a cancelled operation included).
struct Busy<'a>(&'a AtomicBool);

impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
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
    /// `builder` carries the TLS configuration; the updater adds its own redirect rule (every hop
    /// https, loopback http only from loopback) and timeouts before building it
    /// ([`download::configure_client`]).
    pub fn new(config: UpdateConfig, builder: reqwest::ClientBuilder) -> reqwest::Result<Self> {
        let client = download::configure_client(builder).build()?;
        Ok(Self {
            config: Arc::new(config),
            client,
            inner: Arc::new(Inner::default()),
        })
    }

    pub fn config(&self) -> &UpdateConfig {
        &self.config
    }

    pub fn state(&self) -> UpdateState {
        lock(&self.inner.state).clone()
    }

    /// Every later state goes to `sink` as well as being kept.
    pub fn set_sink(&self, sink: UpdateSink) {
        *lock(&self.inner.sink) = Some(sink);
    }

    /// Only the operation holding [`Busy`] calls this.
    fn set_state(&self, state: UpdateState) {
        *lock(&self.inner.state) = state.clone();
        let sink = lock(&self.inner.sink).clone();
        if let Some(sink) = sink {
            sink(&state);
        }
    }

    /// The busy flag, or `None` when another operation has it.
    fn begin(&self) -> Option<Busy<'_>> {
        self.inner
            .busy
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| Busy(&self.inner.busy))
    }

    /// Ends an operation in `failed`, unless an update is already `Ready`: then that stays.
    fn fail(&self, failed: UpdateState) -> UpdateState {
        let state = match lock(&self.inner.ready).clone() {
            Some(ready) => {
                if let UpdateState::Failed { message, .. } = &failed {
                    log::info!("update: {message} (the downloaded update stays ready)");
                }
                ready
            }
            None => failed,
        };
        self.set_state(state.clone());
        state
    }

    /// Reads the feed and decides; never downloads. Does nothing while another check or download
    /// runs (returns the current state).
    pub async fn check(&self) -> UpdateState {
        let Some(_busy) = self.begin() else {
            return self.state();
        };
        self.check_held().await
    }

    /// A check followed by a download when the release is newer and this install takes one.
    /// Does nothing while another check or download runs (returns the current state).
    pub async fn check_and_download(&self) -> UpdateState {
        self.run(Trigger::Manual).await
    }

    /// Downloads the release the last check made available. Does nothing while another check or
    /// download runs, or when nothing is available.
    pub async fn download(&self) -> UpdateState {
        let Some(_busy) = self.begin() else {
            return self.state();
        };
        self.download_held(Trigger::Manual).await
    }

    async fn run(&self, trigger: Trigger) -> UpdateState {
        let Some(_busy) = self.begin() else {
            return self.state();
        };
        let checked = self.check_held().await;
        if matches!(checked, UpdateState::Available { .. }) && self.config.install.downloads() {
            return self.download_held(trigger).await;
        }
        checked
    }

    async fn check_held(&self) -> UpdateState {
        // A `Ready` card doesn't blink away for a check that will most likely keep it.
        if lock(&self.inner.ready).is_none() {
            self.set_state(UpdateState::Checking);
        }
        let fetched = tokio::time::timeout(MANIFEST_DEADLINE, self.fetch_manifest())
            .await
            .unwrap_or_else(|_| Err(FetchError::Network("it didn't answer in time".into())));
        match fetched {
            Ok(manifest) => self.apply(manifest),
            Err(error) => self.fail(UpdateState::from(error)),
        }
    }

    async fn fetch_manifest(&self) -> Result<ReleaseManifest, FetchError> {
        let url = &self.config.manifest_url;
        let response = self
            .client
            .get(url)
            .header(reqwest::header::USER_AGENT, &self.config.user_agent)
            .send()
            .await
            .map_err(|error| FetchError::from_request(&error))?;
        if !response.status().is_success() {
            return Err(FetchError::Status(response.status().as_u16()));
        }
        download::check_final_url(url, response.url())
            .map_err(|error| FetchError::Insecure(error.to_string()))?;
        if response
            .content_length()
            .is_some_and(|length| length > MAX_MANIFEST_BYTES as u64)
        {
            return Err(FetchError::TooLarge);
        }
        let mut body = Vec::new();
        let mut response = response;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| FetchError::from_request(&error))?
        {
            body.extend_from_slice(&chunk);
            if body.len() > MAX_MANIFEST_BYTES {
                return Err(FetchError::TooLarge);
            }
        }
        verify_signature(&body, url).map_err(FetchError::Manifest)?;
        ReleaseManifest::parse(&body).map_err(FetchError::Manifest)
    }

    /// Whether `version` is a release this build should move to.
    fn wants(&self, version: &Version) -> bool {
        let current = &self.config.current_version;
        // A stable build stays on stable releases.
        if current.pre.is_empty() && !version.pre.is_empty() {
            return false;
        }
        is_newer(version, current)
    }

    /// Moves to `UpToDate`, `Available` or `Failed` for a manifest that was read, keeping a
    /// `Ready` update unless the manifest is newer still.
    fn apply(&self, manifest: ReleaseManifest) -> UpdateState {
        let ready = lock(&self.inner.ready).clone();
        let already_have_it = ready
            .as_ref()
            .and_then(UpdateState::version)
            .is_some_and(|version| !is_newer(&manifest.version, version));
        if !self.wants(&manifest.version) || already_have_it {
            *lock(&self.inner.manifest) = None;
            let state = ready.unwrap_or(UpdateState::UpToDate);
            self.set_state(state.clone());
            return state;
        }

        // An install that downloads needs its artifact; one that only announces (the Windows
        // portable zip) needs nothing but the version.
        if self.config.install.downloads() {
            let Some(kind) = self.config.install.artifact_kind() else {
                return self.fail(UpdateState::Failed {
                    message: format!(
                        "Version {} can't be installed on {}. Check the release page.",
                        manifest.version,
                        self.config.install.label()
                    ),
                    retryable: false,
                });
            };
            if manifest.artifact_for(kind, self.config.arch).is_none() {
                return self.fail(UpdateState::Failed {
                    message: format!(
                        "Version {} has no {} download for {}.",
                        manifest.version,
                        kind.name(),
                        self.config.arch.name()
                    ),
                    retryable: false,
                });
            }
        }

        let state = UpdateState::Available {
            version: manifest.version.clone(),
            notes_url: manifest.notes_url.clone(),
        };
        *lock(&self.inner.manifest) = Some(manifest);
        self.set_state(state.clone());
        state
    }

    /// Downloads the available release and, for an AppImage, installs it. The state reaches
    /// `Ready` only after the SHA-256 matched and the file is in place.
    async fn download_held(&self, trigger: Trigger) -> UpdateState {
        let UpdateState::Available { version, .. } = self.state() else {
            return self.state();
        };
        let manifest = lock(&self.inner.manifest).clone();
        let Some(artifact) = manifest
            .as_ref()
            .and_then(|manifest| self.artifact(manifest))
        else {
            return self.fail(UpdateState::Failed {
                message: "There is no update to download. Check again.".into(),
                retryable: true,
            });
        };
        if trigger == Trigger::Schedule {
            let known_bad = lock(&self.inner.bad)
                .clone()
                .filter(|bad| bad.version == version && bad.sha256 == artifact.sha256);
            if let Some(bad) = known_bad {
                return self.fail(bad.failure);
            }
        }
        let target = match self.target(&artifact, &version) {
            Ok(target) => target,
            Err(error) => return self.fail(failure(&error)),
        };

        self.set_state(UpdateState::Downloading {
            received: 0,
            total: artifact.size,
        });
        let mut reported = u8::MAX;
        let mut progress = |received: u64, total: u64| {
            let percent = received
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(0)
                .min(100) as u8;
            if percent != reported {
                reported = percent;
                self.set_state(UpdateState::Downloading { received, total });
            }
        };
        let request = DownloadRequest {
            artifact: &artifact,
            target: target.clone(),
            executable: self.config.install.installs_itself(),
            keep_previous: self.config.install.installs_itself(),
            stall: Stall::default(),
        };
        let downloaded = download::download(
            &self.client,
            &request,
            &self.config.user_agent,
            &mut progress,
        )
        .await;
        if let Err(error) = downloaded {
            let failed = failure(&error);
            if error.release_is_wrong() {
                *lock(&self.inner.bad) = Some(BadArtifact {
                    version,
                    sha256: artifact.sha256,
                    failure: failed.clone(),
                });
            }
            return self.fail(failed);
        }
        *lock(&self.inner.bad) = None;
        let state = match &self.config.install {
            InstallKind::AppImage { .. } => UpdateState::Ready {
                version,
                action: ReadyAction::Restart { path: target },
            },
            InstallKind::Deb { .. } | InstallKind::Rpm { .. } => {
                // Older downloads aren't wanted any more.
                if let Err(error) = download::sweep_packages(&self.cache_dir(), Some(&target)) {
                    log::warn!("cannot remove older update packages: {error}");
                }
                UpdateState::Ready {
                    version,
                    action: ReadyAction::Package {
                        command: self.config.install.command(&target).unwrap_or_else(|| {
                            "your package manager (open the folder to find the file)".into()
                        }),
                        path: target,
                    },
                }
            }
            // `target` refuses these, so a download never gets here.
            InstallKind::WindowsZip | InstallKind::Unknown => {
                return self.fail(UpdateState::Failed {
                    message: "This installation doesn't download updates.".into(),
                    retryable: false,
                });
            }
        };
        *lock(&self.inner.manifest) = None;
        *lock(&self.inner.ready) = Some(state.clone());
        self.set_state(state.clone());
        state
    }

    fn artifact(&self, manifest: &ReleaseManifest) -> Option<Artifact> {
        manifest
            .artifact_for(self.config.install.artifact_kind()?, self.config.arch)
            .cloned()
    }

    /// Where this install's download goes.
    fn target(&self, artifact: &Artifact, version: &Version) -> Result<PathBuf, DownloadError> {
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

    /// Removes what an earlier run left behind: the previous AppImage (this process proves the
    /// new one starts) and a killed download's temporary file, or the temporary files in the
    /// package folder. Called once at startup.
    pub fn clear_leftovers(&self) {
        match &self.config.install {
            InstallKind::AppImage { path } => {
                match download::clear_previous(path) {
                    Ok(true) => {
                        log::info!("the installed update is running; its predecessor is gone");
                    }
                    Ok(false) => {}
                    Err(error) => log::warn!("cannot remove the previous AppImage: {error}"),
                }
                if let Err(error) = download::clear_partial(path) {
                    log::warn!("cannot remove an unfinished update download: {error}");
                }
            }
            InstallKind::Deb { .. } | InstallKind::Rpm { .. } => {
                if let Ok(entries) = std::fs::read_dir(self.cache_dir()) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let partial = path
                            .extension()
                            .is_some_and(|extension| extension == "part");
                        if partial && entry.file_type().is_ok_and(|kind| kind.is_file()) {
                            let _ = std::fs::remove_file(path);
                        }
                    }
                }
            }
            InstallKind::WindowsZip | InstallKind::Unknown => {}
        }
    }
}

fn failure(error: &DownloadError) -> UpdateState {
    UpdateState::Failed {
        message: error.to_string(),
        retryable: error.retryable(),
    }
}

/// Checks after `settle`, then every `interval`, until `stop` says otherwise (or the app's
/// runtime goes away with it). An artifact that failed as wrong isn't fetched again by this loop.
pub async fn drive(
    updater: Updater,
    schedule: Schedule,
    mut stop: tokio::sync::watch::Receiver<bool>,
) {
    if !wait(&mut stop, schedule.settle).await {
        return;
    }
    loop {
        updater.run(Trigger::Schedule).await;
        if !wait(&mut stop, schedule.interval).await {
            return;
        }
    }
}

/// Waits for `duration`, or returns false at once when the updater was asked to stop.
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
    use crate::update::testserver::{Response, Server, builder};
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
            // Private, whatever the umask: the updater refuses a folder others can write.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
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
            Updater::new(self.config.clone(), builder()).unwrap()
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
        // An older package from an earlier update is swept once this one is complete.
        let packages = fixture.dir.join("cache/updates");
        std::fs::create_dir_all(&packages).unwrap();
        std::fs::write(
            packages.join("semaphore-chat-native_9.9.8_amd64.deb"),
            b"old",
        )
        .unwrap();
        let updater = Updater::new(config, builder()).unwrap();
        let state = updater.check_and_download().await;
        assert!(
            !packages
                .join("semaphore-chat-native_9.9.8_amd64.deb")
                .exists()
        );
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
            command.starts_with("sudo apt install '")
                && command.contains("semaphore-chat-native_9.9.9_amd64.deb"),
            "{command}"
        );
        // The running file of another install is not touched.
        assert_eq!(
            std::fs::read(&fixture.appimage).unwrap(),
            b"the running build"
        );
    }

    /// The Windows portable build only announces a release, so it needs no artifact of its own
    /// in the manifest (none is published today).
    #[tokio::test]
    async fn windows_announces_a_release_without_an_artifact() {
        let fixture = Fixture::new("windows").await;
        let config = UpdateConfig {
            install: InstallKind::WindowsZip,
            ..fixture.config.clone()
        };
        fixture.serve(BODY);
        let updater = Updater::new(config, builder()).unwrap();
        let state = updater.check_and_download().await;
        assert_eq!(
            state,
            UpdateState::Available {
                version: Version::parse(VERSION).unwrap(),
                notes_url: Some("https://example.org/notes".into())
            }
        );
        assert_eq!(fixture.server.count("/latest.json"), 1);
        assert_eq!(
            fixture.server.count("/a.AppImage"),
            0,
            "nothing was downloaded"
        );
    }

    /// Two checks at once (the schedule's and the settings button, on a multi-threaded runtime):
    /// one runs, the others return at once, and the file in place is exactly the release.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn overlapping_checks_run_once_and_install_a_whole_file() {
        let fixture = Fixture::new("overlap").await;
        let body: Vec<u8> = (0..200_000u32).map(|n| (n % 251) as u8).collect();
        fixture.serve(&body);
        let updater = fixture.updater();
        let barrier = Arc::new(tokio::sync::Barrier::new(4));
        let tasks: Vec<_> = (0..4)
            .map(|index| {
                let updater = updater.clone();
                let barrier = barrier.clone();
                tokio::spawn(async move {
                    barrier.wait().await;
                    if index % 2 == 0 {
                        updater.check_and_download().await
                    } else {
                        updater.run(Trigger::Schedule).await
                    }
                })
            })
            .collect();
        for task in tasks {
            task.await.unwrap();
        }
        // Whichever ran, it ran alone: one manifest, one transfer.
        assert_eq!(fixture.server.count("/latest.json"), 1);
        assert_eq!(fixture.server.count("/a.AppImage"), 1);
        assert!(
            matches!(updater.state(), UpdateState::Ready { .. }),
            "{:?}",
            updater.state()
        );
        assert_eq!(std::fs::read(&fixture.appimage).unwrap(), body);
        assert!(!download::temporary_path(&fixture.appimage).exists());
        // And the flag is free again: the next check reads the feed.
        updater.check().await;
        assert_eq!(fixture.server.count("/latest.json"), 2);
    }

    /// A manual check (or Retry) while the scheduled one is downloading does nothing: no second
    /// feed read, no second transfer, the download carries on.
    #[tokio::test]
    async fn a_manual_check_during_a_scheduled_download_is_ignored() {
        let fixture = Fixture::new("manual-during").await;
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
        let scheduled = tokio::spawn({
            let updater = updater.clone();
            async move { updater.run(Trigger::Schedule).await }
        });
        tokio::time::timeout(Duration::from_secs(10), async {
            while !matches!(updater.state(), UpdateState::Downloading { received, .. } if received > 0) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the download never started");
        for state in [
            updater.check_and_download().await,
            updater.check().await,
            updater.download().await,
        ] {
            assert!(
                matches!(state, UpdateState::Downloading { .. }),
                "{state:?}"
            );
        }
        assert_eq!(fixture.server.count("/latest.json"), 1);
        assert_eq!(fixture.server.count("/a.AppImage"), 1);
        scheduled.abort();
        assert!(scheduled.await.unwrap_err().is_cancelled());
        // The cancelled transfer took its temporary file and the busy flag with it.
        assert!(!download::temporary_path(&fixture.appimage).exists());
        assert_eq!(
            std::fs::read(&fixture.appimage).unwrap(),
            b"the running build"
        );
        fixture.serve(BODY);
        assert!(matches!(
            updater.check_and_download().await,
            UpdateState::Ready { .. }
        ));
    }

    /// Build metadata never makes a release newer: no reinstall loop for `+ci.N`.
    #[tokio::test]
    async fn build_metadata_is_not_a_newer_release() {
        let fixture = Fixture::new("metadata").await;
        let config = UpdateConfig {
            current_version: Version::parse("0.9.0+ci.1").unwrap(),
            ..fixture.config.clone()
        };
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json(
                "0.9.0+ci.2",
                &fixture.server.url("/a.AppImage"),
                BODY,
            )),
        );
        let updater = Updater::new(config, builder()).unwrap();
        assert_eq!(updater.check_and_download().await, UpdateState::UpToDate);

        // Nor does it make the feed's release newer than the one already downloaded.
        fixture.serve(BODY);
        let ready = updater.check_and_download().await;
        assert!(matches!(ready, UpdateState::Ready { .. }), "{ready:?}");
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json(
                &format!("{VERSION}+rebuilt"),
                &fixture.server.url("/a.AppImage"),
                BODY,
            )),
        );
        assert_eq!(updater.check_and_download().await, ready);
        assert_eq!(fixture.server.count("/a.AppImage"), 1);
    }

    /// A stable build doesn't take a pre-release from the feed; a pre-release build does.
    #[tokio::test]
    async fn only_a_pre_release_build_takes_pre_releases() {
        let fixture = Fixture::new("prerelease").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json(
                "1.0.0-rc.1",
                &fixture.server.url("/a.AppImage"),
                BODY,
            )),
        );
        fixture.server.route("/a.AppImage", Response::ok(BODY));
        assert_eq!(fixture.updater().check().await, UpdateState::UpToDate);

        let config = UpdateConfig {
            current_version: Version::parse("1.0.0-beta.2").unwrap(),
            ..fixture.config.clone()
        };
        let state = Updater::new(config, builder()).unwrap().check().await;
        assert!(matches!(state, UpdateState::Available { .. }), "{state:?}");
    }

    /// Once the update is in place, a failed check, a feed without our artifact, or a newer
    /// release whose download fails all leave `Ready` (and the file) as they were.
    #[tokio::test]
    async fn a_ready_update_survives_later_failures() {
        let fixture = Fixture::new("ready-sticks").await;
        fixture.serve(BODY);
        let updater = fixture.updater();
        let ready = updater.check_and_download().await;
        assert!(matches!(ready, UpdateState::Ready { .. }), "{ready:?}");

        fixture.server.route("/latest.json", Response::status(503));
        assert_eq!(updater.check_and_download().await, ready);
        fixture
            .server
            .route("/latest.json", Response::ok("{not a manifest"));
        assert_eq!(updater.check_and_download().await, ready);
        fixture.server.route(
            "/latest.json",
            Response::ok(r#"{"version": "9.9.10", "artifacts": []}"#),
        );
        assert_eq!(updater.check_and_download().await, ready);

        // A newer release whose bytes are wrong: the transfer fails, the earlier update stays.
        fixture.server.route(
            "/latest.json",
            Response::ok(format!(
                r#"{{"version": "9.9.10", "artifacts": [{{"kind": "appimage", "arch": "x86_64",
                    "url": "{}", "sha256": "{}", "size": {}}}]}}"#,
                fixture.server.url("/b.AppImage"),
                digest(b"what it should be"),
                b"what it really is".len()
            )),
        );
        fixture
            .server
            .route("/b.AppImage", Response::ok(b"what it really is".to_vec()));
        assert_eq!(updater.check_and_download().await, ready);
        assert_eq!(updater.state(), ready);
        assert_eq!(std::fs::read(&fixture.appimage).unwrap(), BODY);
        assert_eq!(fixture.server.count("/b.AppImage"), 1);
        assert_eq!(
            fixture.server.count("/a.AppImage"),
            1,
            "never downloaded again"
        );
    }

    /// A release whose artifact doesn't match its hash isn't refetched every hour; a person
    /// asking does refetch it.
    #[tokio::test]
    async fn the_schedule_does_not_refetch_a_wrong_artifact() {
        let fixture = Fixture::new("bad-artifact").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json(
                VERSION,
                &fixture.server.url("/a.AppImage"),
                BODY,
            )),
        );
        fixture
            .server
            .route("/a.AppImage", Response::ok(vec![b'x'; BODY.len()]));
        let updater = fixture.updater();
        let first = updater.run(Trigger::Schedule).await;
        assert!(matches!(first, UpdateState::Failed { .. }), "{first:?}");
        assert_eq!(updater.run(Trigger::Schedule).await, first);
        assert_eq!(
            fixture.server.count("/latest.json"),
            2,
            "the feed is still read"
        );
        assert_eq!(
            fixture.server.count("/a.AppImage"),
            1,
            "the artifact is not"
        );

        // A republished (fixed) release has a different hash: fetched at once. (The same hash
        // with corrected bytes waits for a manual check or the next start.)
        fixture.serve(b"the republished build\n");
        assert!(matches!(
            updater.run(Trigger::Schedule).await,
            UpdateState::Ready { .. }
        ));
        assert_eq!(fixture.server.count("/a.AppImage"), 2);
    }

    #[tokio::test]
    async fn a_manual_retry_refetches_a_wrong_artifact() {
        let fixture = Fixture::new("bad-manual").await;
        fixture.server.route(
            "/latest.json",
            Response::ok(manifest_json(
                VERSION,
                &fixture.server.url("/a.AppImage"),
                BODY,
            )),
        );
        fixture
            .server
            .route("/a.AppImage", Response::ok(vec![b'x'; BODY.len()]));
        let updater = fixture.updater();
        updater.run(Trigger::Schedule).await;
        updater.check_and_download().await;
        assert_eq!(fixture.server.count("/a.AppImage"), 2);
    }

    /// A redirect off https on the manifest is a refusal (not retried as a network fault).
    #[tokio::test]
    async fn a_manifest_redirected_off_https_is_refused() {
        let fixture = Fixture::new("manifest-redirect").await;
        fixture.server.route(
            "/latest.json",
            Response::redirect(302, "http://example.invalid/latest.json"),
        );
        let state = fixture.updater().check().await;
        let UpdateState::Failed { message, retryable } = state else {
            panic!("expected Failed, got {state:?}");
        };
        assert!(message.contains("refused"), "{message}");
        assert!(!retryable);
    }

    /// Leftovers of a killed run are removed at startup: the previous AppImage and a `.part`.
    #[tokio::test]
    async fn leftovers_are_cleared_at_startup() {
        let fixture = Fixture::new("leftovers").await;
        std::fs::write(previous_path(&fixture.appimage), b"old").unwrap();
        std::fs::write(download::temporary_path(&fixture.appimage), b"half").unwrap();
        fixture.updater().clear_leftovers();
        assert!(!previous_path(&fixture.appimage).exists());
        assert!(!download::temporary_path(&fixture.appimage).exists());
        assert_eq!(
            std::fs::read(&fixture.appimage).unwrap(),
            b"the running build"
        );
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

    /// Without a `Content-Length` the manifest cap still holds, while streaming.
    #[tokio::test]
    async fn a_chunked_manifest_over_the_size_cap_is_refused() {
        let fixture = Fixture::new("bigmanifest-chunked").await;
        let padding = "x".repeat(MAX_MANIFEST_BYTES + 4096);
        fixture
            .server
            .route("/latest.json", Response::ok(padding).chunked());
        let state = fixture.updater().check().await;
        let UpdateState::Failed { message, retryable } = state else {
            panic!("expected Failed, got {state:?}");
        };
        assert!(message.contains("too large"), "{message}");
        assert!(!retryable);
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
