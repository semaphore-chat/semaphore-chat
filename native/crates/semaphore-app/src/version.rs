//! The version this build reports.
//!
//! The binary's `--version`, the About dialog, the package metadata and
//! `scripts/package-linux.sh` all use the same string: `build.rs` turns `SEMAPHORE_VERSION` (CI
//! and the packaging script set it) into the crate's `Cargo.toml` version when it is unset.

/// The app's version, as `semaphore-app --version` prints it.
pub fn version() -> &'static str {
    env!("SEMAPHORE_VERSION")
}
