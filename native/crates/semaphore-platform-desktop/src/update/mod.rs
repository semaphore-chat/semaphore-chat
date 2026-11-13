//! Auto-update: the release manifest, which install can update itself, the download and install,
//! and the state machine the UI mirrors.
//!
//! What Electron does with electron-updater is the reference: it trusts the release host over
//! HTTPS plus the SHA-512 in its manifest, checks three seconds after start and then hourly,
//! downloads without asking, and installs the AppImage over the running file while a `.deb` or
//! `.rpm` is installed by the package manager under `pkexec` (`AppImageUpdater.doInstall` and
//! `LinuxUpdater.runCommandWithSudoIfNeeded` in electron-updater 6.8.3; see `patches/README.md`).
//! Native keeps the same trust model and schedule, and the same states, but never elevates:
//! an AppImage is replaced in place and the app restarts; a package is downloaded and the app
//! says how to install it; a Windows portable zip is only announced. See
//! [`docs/packaging.md`](../../../../../docs/packaging.md), "Auto-update".
//!
//! - [`version`]: what a release calls itself, and which of two is newer.
//! - [`manifest`]: the JSON release document, validated strictly.
//! - [`install`]: what kind of install this is, from an injectable environment.
//! - [`download`]: streaming to a temporary file, the SHA-256 check, and the AppImage swap.
//! - [`state`]: [`state::UpdateState`], [`state::Updater`] and the check schedule.
//!
//! Nothing here reads the environment or touches a file at construction: the [`state::Updater`]
//! is given its [`install::InstallKind`], its cache directory, its HTTP client and its running
//! version, so tests and rigs never see this machine's environment. No UI types either: the app
//! maps [`state::UpdateState`] to the view its banner and settings row draw.

pub mod download;
pub mod install;
pub mod manifest;
pub mod state;
pub mod version;

#[cfg(test)]
mod testserver;

pub use download::{DownloadError, clear_previous};
pub use install::{InstallEnv, InstallKind, PackageFamily, ReadyAction, RpmManager};
pub use manifest::{
    Arch, Artifact, ArtifactKind, MAX_ARTIFACT_SIZE, MAX_MANIFEST_BYTES, ManifestError,
    ReleaseManifest, Sha256Digest, feed_url_is_trusted, is_trusted_url, verify_signature,
};
pub use state::{Schedule, UpdateConfig, UpdateSink, UpdateState, Updater, drive};
pub use version::{VersionError, is_newer, parse_version};
