//! W13's conditions, and the loopback update feed the end-to-end run reads.
//!
//! The rig hosts a manifest and a few bytes of "AppImage" on `127.0.0.1` (the one plain-HTTP
//! exception the manifest's rule allows), and tells the app that it is an AppImage install whose
//! file is the rig's own stand-in in the run's data directory. Nothing on this machine is read or
//! written, and no real release is contacted.
//!
//! ```text
//! wait core w13 state checking|up-to-date|available|downloading|ready|failed
//! wait core w13 banner 9.9.9          # the card shows that version; `none` when nothing is shown
//! expect core w13 restart-asked 1     # the app asked its restart seam this often
//! wait core w13 appimage updated      # running|updated: the file the update replaces
//! expect core w13 checks 2            # the feed was read this many times (a manual check adds one)
//! ```
//!
//! The feed's version is [`UPDATE_VERSION`], newer than anything this workspace builds; the bytes
//! it serves contain [`UPDATE_MARKER`], and the file it replaces starts with [`RUNNING_MARKER`],
//! so `appimage updated` proves the download was verified and put in place.

use anyhow::{Context as _, Result, bail};
use semaphore_platform_desktop::update::{Arch, InstallKind, Schedule};
use sha2::{Digest as _, Sha256};
use std::io::{Read as _, Write as _};
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

/// The version the fake feed publishes.
pub(crate) const UPDATE_VERSION: &str = "9.9.9";
/// What the feed's artifact says, so a step can prove the file was replaced.
pub(crate) const UPDATE_MARKER: &str = "w13: the updated AppImage";
/// What the file the update replaces said before.
pub(crate) const RUNNING_MARKER: &str = "w13: the AppImage that was running";

/// Where the app finds the update: a manifest on loopback, and the file it would replace.
pub(crate) struct UpdateFeed {
    /// `http://127.0.0.1:<port>/latest.json`.
    manifest_url: String,
    /// The stand-in for `$APPIMAGE`, inside the run's data directory.
    appimage: PathBuf,
    /// How often the app asked to restart.
    restarts: Arc<AtomicUsize>,
    /// How often the manifest was fetched.
    checks: Arc<AtomicUsize>,
}

impl UpdateFeed {
    /// What the app is told about updates, for `AppConfig::update`.
    pub(crate) fn options(&self, cache_dir: PathBuf) -> semaphore_app::update::UpdateOptions {
        semaphore_app::update::UpdateOptions {
            manifest_url: self.manifest_url.clone(),
            install: InstallKind::AppImage {
                path: self.appimage.clone(),
            },
            cache_dir,
            // No waiting in a rig: the check starts at once, and the hourly one never arrives.
            schedule: Schedule {
                settle: Duration::ZERO,
                interval: Duration::from_secs(60 * 60),
            },
        }
    }

    /// Counts a restart request, for the app's restart seam.
    pub(crate) fn restarts(&self) -> Arc<AtomicUsize> {
        self.restarts.clone()
    }
}

/// Starts the feed and writes the file it would replace, under `dir` (the run's data directory).
pub(crate) fn start(dir: &Path) -> Result<UpdateFeed> {
    std::fs::create_dir_all(dir).with_context(|| dir.display().to_string())?;
    let appimage = dir.join("Semaphore-Chat-Native.AppImage");
    std::fs::write(&appimage, RUNNING_MARKER).with_context(|| appimage.display().to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&appimage, std::fs::Permissions::from_mode(0o755))?;
    }

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).context("the update feed's port")?;
    let port = listener.local_addr()?.port();
    let body = format!("#!/bin/sh\n# {UPDATE_MARKER}\nexit 0\n").into_bytes();
    let digest = format!("{:x}", Sha256::digest(&body));
    let manifest = format!(
        r#"{{"version": "{UPDATE_VERSION}", "notes_url": "https://example.org/releases/v{UPDATE_VERSION}",
            "artifacts": [{{"kind": "appimage", "arch": "{}", "url": "http://127.0.0.1:{port}/download/AppImage",
                            "sha256": "{digest}", "size": {}}}]}}"#,
        Arch::X86_64.name(),
        body.len()
    );
    let checks = Arc::new(AtomicUsize::new(0));
    let counted = checks.clone();
    std::thread::Builder::new()
        .name("w13-update-feed".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else {
                    return;
                };
                if answer(&mut stream, &manifest, &body) {
                    counted.fetch_add(1, Ordering::Relaxed);
                }
            }
        })
        .context("the update feed's thread")?;
    Ok(UpdateFeed {
        manifest_url: format!("http://127.0.0.1:{port}/latest.json"),
        appimage,
        restarts: Arc::new(AtomicUsize::new(0)),
        checks,
    })
}

/// One request: the manifest, the artifact, or a 404. True for the manifest.
fn answer(stream: &mut std::net::TcpStream, manifest: &str, body: &[u8]) -> bool {
    let mut head = Vec::new();
    let mut buffer = [0u8; 512];
    while !head.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return false,
            Ok(read) => head.extend_from_slice(&buffer[..read]),
        }
        if head.len() > 8 * 1024 {
            return false;
        }
    }
    let text = String::from_utf8_lossy(&head);
    let (status, payload, manifest_read): (&str, &[u8], bool) = match text.split_whitespace().nth(1)
    {
        Some("/latest.json") => ("200 OK", manifest.as_bytes(), true),
        Some("/download/AppImage") => ("200 OK", body, false),
        _ => ("404 Not Found", b"", false),
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(payload);
    let _ = stream.flush();
    manifest_read
}

/// W13's conditions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum W13 {
    /// `state idle|checking|up-to-date|available|downloading|ready|failed`.
    State(String),
    /// `banner VERSION`: the card shows that version; `none`: no card.
    Banner(Option<String>),
    /// `restart-asked N`: the restart seam was asked at least this often.
    RestartAsked(usize),
    /// `checks N`: the feed's manifest was fetched at least this often.
    Checks(usize),
    /// `appimage running|updated`: what the file the update replaces holds.
    AppImage(String),
}

/// The words after `w13`.
pub(crate) fn parse(words: &[&str]) -> Result<W13> {
    Ok(match words {
        [
            "state",
            state @ ("idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready"
            | "failed"),
        ] => W13::State((*state).to_owned()),
        ["banner", "none"] => W13::Banner(None),
        ["banner", version] => W13::Banner(Some((*version).to_owned())),
        ["restart-asked", count] => W13::RestartAsked(
            count
                .parse()
                .map_err(|_| anyhow::anyhow!("not a number: {count}"))?,
        ),
        ["checks", count] => W13::Checks(
            count
                .parse()
                .map_err(|_| anyhow::anyhow!("not a number: {count}"))?,
        ),
        ["appimage", state @ ("running" | "updated")] => W13::AppImage((*state).to_owned()),
        _ => bail!("unknown w13 condition: {}", words.join(" ")),
    })
}

impl super::Rig {
    pub(crate) fn w13_holds(&mut self, condition: &W13) -> Result<bool> {
        let Some(feed) = &self.update else {
            bail!("w13 conditions need the run to be started with --update");
        };
        match condition {
            W13::State(expected) => {
                let app = self.app()?.clone();
                let status = self.driver.cx.update(|cx| app.read(cx).update_status());
                Ok(state_name(&status) == expected)
            }
            W13::Banner(expected) => {
                let app = self.app()?.clone();
                let status = self
                    .driver
                    .cx
                    .update(|cx| app.read(cx).update_banner_status());
                let shown = status.and_then(|status| match status {
                    semaphore_ui::update::UpdateStatus::Available { version, .. }
                    | semaphore_ui::update::UpdateStatus::Ready { version, .. } => Some(version),
                    _ => None,
                });
                Ok(shown == *expected)
            }
            W13::RestartAsked(count) => Ok(feed.restarts().load(Ordering::Relaxed) >= *count),
            W13::Checks(count) => Ok(feed.checks.load(Ordering::Relaxed) >= *count),
            W13::AppImage(expected) => {
                let read = std::fs::read(&feed.appimage).unwrap_or_default();
                let text = String::from_utf8_lossy(&read);
                Ok(match expected.as_str() {
                    "running" => text.contains(RUNNING_MARKER),
                    _ => text.contains(UPDATE_MARKER) && executable(&feed.appimage),
                })
            }
        }
    }
}

#[cfg(unix)]
fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::metadata(path).is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn executable(_: &Path) -> bool {
    true
}

fn state_name(status: &semaphore_ui::update::UpdateStatus) -> &'static str {
    use semaphore_ui::update::UpdateStatus;
    match status {
        UpdateStatus::Unknown => "idle",
        UpdateStatus::Checking => "checking",
        UpdateStatus::UpToDate => "up-to-date",
        UpdateStatus::Available { .. } => "available",
        UpdateStatus::Downloading { .. } => "downloading",
        UpdateStatus::Ready { .. } => "ready",
        UpdateStatus::Failed { .. } => "failed",
    }
}
