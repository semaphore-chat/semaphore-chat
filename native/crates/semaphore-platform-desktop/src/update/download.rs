//! Downloading an artifact: to a temporary file beside where it belongs, hashed as it arrives,
//! and only then put in place.
//!
//! The size in the manifest is a cap: the transfer stops as soon as more than that arrives, and a
//! body shorter than it is a failure too. The SHA-256 is computed while writing, so the file is
//! read once. Any failure removes the temporary file, and the target is only ever replaced after
//! its replacement is complete and verified: an interrupted update never leaves a half-written
//! AppImage where the old one was.
//!
//! The old AppImage is kept beside the new one as `<file>.old` (a hard link, so nothing is copied
//! and both names share the blocks until the old one goes) and removed on the next start, which
//! proves the new file runs. electron-updater's AppImage updater instead deletes the running file
//! (`unlinkSync`) and moves the download into its place, with no way back if the download is bad;
//! see `docs/packaging.md`, "Auto-update".

use crate::update::manifest::{Artifact, Sha256Digest, is_trusted_url};
use sha2::{Digest as _, Sha256};
use std::fmt;
use std::fs::OpenOptions;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use url::Url;

/// What to fetch, and what the result becomes.
#[derive(Debug, Clone)]
pub struct DownloadRequest<'a> {
    pub artifact: &'a Artifact,
    /// The file the artifact becomes: the running AppImage, or a package in the cache.
    pub target: PathBuf,
    /// Make the result executable (an AppImage).
    pub executable: bool,
    /// Keep the file this replaces as `<target>.old` (an AppImage).
    pub keep_previous: bool,
}

/// Why a download or its installation didn't happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadError {
    Network(String),
    Status(u16),
    /// The URL, or where a redirect took it, isn't one the updater trusts.
    Insecure(String),
    /// The body was larger than the manifest says.
    TooLarge {
        size: u64,
    },
    /// The body ended before the manifest's size.
    ShortBody {
        received: u64,
        expected: u64,
    },
    HashMismatch {
        expected: Sha256Digest,
        actual: Sha256Digest,
    },
    /// Writing, or putting the file in place, failed. Retrying the same download won't help.
    Target(String),
}

impl DownloadError {
    /// Whether asking again could give a different answer. A server that was down, a transfer
    /// that dropped, a truncated or corrupt body: yes. A refusal, a size the release got wrong,
    /// or a place on disk that can't be written: no.
    pub fn retryable(&self) -> bool {
        match self {
            Self::Network(_) => true,
            // A missing artifact or a server error can be a bad deployment; the next check may
            // find it fixed. A client error (404, 403) will not fix itself.
            Self::Status(status) => *status >= 500 || *status == 408 || *status == 429,
            Self::TooLarge { .. } | Self::ShortBody { .. } | Self::HashMismatch { .. } => true,
            Self::Insecure(_) | Self::Target(_) => false,
        }
    }
}

impl fmt::Display for DownloadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network(message) => {
                write!(formatter, "The update couldn't be downloaded: {message}")
            }
            Self::Status(status) => {
                write!(formatter, "The update server answered {status}.")
            }
            Self::Insecure(message) => write!(formatter, "The update was refused: {message}"),
            Self::TooLarge { size } => write!(
                formatter,
                "The update is larger than the release says ({size} bytes); the download was stopped."
            ),
            Self::ShortBody { received, expected } => write!(
                formatter,
                "The download stopped after {received} of {expected} bytes."
            ),
            Self::HashMismatch { .. } => write!(
                formatter,
                "The download didn't match the release's SHA-256, so it was discarded."
            ),
            Self::Target(message) => write!(formatter, "The update couldn't be saved: {message}"),
        }
    }
}

impl std::error::Error for DownloadError {}

/// Streams `request.artifact` to `request.target`, verifies it, then puts it in place. `progress`
/// is called with (received, expected) bytes as the body arrives, starting at zero.
pub async fn download(
    client: &reqwest::Client,
    request: &DownloadRequest<'_>,
    user_agent: &str,
    progress: &mut (dyn FnMut(u64, u64) + Send),
) -> Result<(), DownloadError> {
    let parent = request.target.parent().ok_or_else(|| {
        DownloadError::Target(format!("{} has no folder", request.target.display()))
    })?;
    std::fs::create_dir_all(parent).map_err(|error| {
        DownloadError::Target(format!("cannot make {}: {error}", parent.display()))
    })?;
    let temp = temporary_path(&request.target);
    let outcome = stream_to(client, request, user_agent, &temp, progress).await;
    let placed = outcome.and_then(|()| place(request, &temp));
    if placed.is_err() {
        // Whatever happened, nothing half-written stays behind.
        let _ = std::fs::remove_file(&temp);
    }
    placed
}

async fn stream_to(
    client: &reqwest::Client,
    request: &DownloadRequest<'_>,
    user_agent: &str,
    temp: &Path,
    progress: &mut (dyn FnMut(u64, u64) + Send),
) -> Result<(), DownloadError> {
    let artifact = request.artifact;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(temp)
        .map_err(|error| {
            DownloadError::Target(format!("cannot write {}: {error}", temp.display()))
        })?;

    let response = client
        .get(&artifact.url)
        .header(reqwest::header::USER_AGENT, user_agent)
        .send()
        .await
        .map_err(|error| DownloadError::Network(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(DownloadError::Status(status.as_u16()));
    }
    check_final_url(&artifact.url, response.url())?;
    if let Some(length) = response.content_length()
        && length > artifact.size
    {
        return Err(DownloadError::TooLarge {
            size: artifact.size,
        });
    }

    let mut response = response;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    progress(0, artifact.size);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| DownloadError::Network(error.to_string()))?
    {
        received += chunk.len() as u64;
        if received > artifact.size {
            return Err(DownloadError::TooLarge {
                size: artifact.size,
            });
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|error| DownloadError::Target(error.to_string()))?;
        progress(received, artifact.size);
    }
    if received != artifact.size {
        return Err(DownloadError::ShortBody {
            received,
            expected: artifact.size,
        });
    }
    let actual = Sha256Digest::from_bytes(hasher.finalize().into());
    if actual != artifact.sha256 {
        return Err(DownloadError::HashMismatch {
            expected: artifact.sha256,
            actual,
        });
    }
    file.sync_all()
        .map_err(|error| DownloadError::Target(error.to_string()))?;
    Ok(())
}

/// Refuses a response that isn't where a trusted request may land: a redirect to plain http (or
/// to a URL carrying credentials) would undo the manifest's https rule.
pub fn check_final_url(requested: &str, final_url: &Url) -> Result<(), DownloadError> {
    if !is_trusted_url(final_url) {
        return Err(DownloadError::Insecure(format!(
            "{requested} redirected to {final_url}, which is not https"
        )));
    }
    if !final_url.username().is_empty() || final_url.password().is_some() {
        return Err(DownloadError::Insecure(format!(
            "{requested} redirected to a URL with a user name or password"
        )));
    }
    Ok(())
}

/// Puts the verified temporary file where the update belongs.
fn place(request: &DownloadRequest<'_>, temp: &Path) -> Result<(), DownloadError> {
    if request.executable {
        set_executable(temp)?;
    }
    let mut kept = false;
    if request.keep_previous {
        kept = keep_previous(&request.target)?;
    }
    let renamed = replace(temp, &request.target);
    if renamed.is_err() && kept {
        // The old file is still where it was; a backup made for nothing is removed again.
        let _ = std::fs::remove_file(previous_path(&request.target));
    }
    renamed
}

fn set_executable(path: &Path) -> Result<(), DownloadError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| DownloadError::Target(format!("cannot make it executable: {error}")))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// Keeps `target` as `<target>.old` unless it is already kept. Returns whether this call made the
/// backup. A hard link shares the blocks; a filesystem without them gets a copy.
fn keep_previous(target: &Path) -> Result<bool, DownloadError> {
    let previous = previous_path(target);
    // Nothing to keep: this is the first install at this path.
    if previous.exists() || !target.exists() {
        return Ok(false);
    }
    if std::fs::hard_link(target, &previous).is_err() {
        std::fs::copy(target, &previous).map_err(|error| {
            DownloadError::Target(format!(
                "cannot keep {} before replacing it: {error}",
                target.display()
            ))
        })?;
    }
    Ok(true)
}

/// Renames `from` over `to`, replacing it. Unix does that atomically; Windows refuses while the
/// name exists, so it removes it first (the updater only does this on Linux today).
fn replace(from: &Path, to: &Path) -> Result<(), DownloadError> {
    #[cfg(windows)]
    {
        match std::fs::remove_file(to) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DownloadError::Target(format!(
                    "cannot replace {}: {error}",
                    to.display()
                )));
            }
        }
    }
    std::fs::rename(from, to)
        .map_err(|error| DownloadError::Target(format!("cannot replace {}: {error}", to.display())))
}

/// The file a download arrives in: beside the target, so the last step is a rename within one
/// directory.
pub fn temporary_path(target: &Path) -> PathBuf {
    with_suffix(target, ".part")
}

/// Where the file an update replaced is kept for the next start.
pub fn previous_path(target: &Path) -> PathBuf {
    with_suffix(target, ".old")
}

fn with_suffix(target: &Path, suffix: &str) -> PathBuf {
    match target.file_name() {
        Some(name) => {
            let mut name = name.to_os_string();
            name.push(suffix);
            target.with_file_name(name)
        }
        None => target.with_file_name(suffix.trim_start_matches('.')),
    }
}

/// Removes the copy the previous update kept, once the new file has started. Returns whether
/// there was one. Called by the app at startup for an AppImage install.
pub fn clear_previous(target: &Path) -> std::io::Result<bool> {
    match std::fs::remove_file(previous_path(target)) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// The file name a package download keeps: the URL's last segment, when it is a plain name, or
/// one built from the version. Never a path: `..`, separators and control characters are refused.
pub fn package_name(url: &str, version: &str, extension: &str) -> String {
    let from_url = Url::parse(url)
        .ok()
        .and_then(|url| {
            url.path_segments()
                .and_then(|mut segments| segments.next_back().map(str::to_owned))
        })
        .filter(|name| safe_file_name(name).as_deref() == Some(name.as_str()))
        .filter(|name| name.ends_with(&format!(".{extension}")));
    from_url.unwrap_or_else(|| format!("semaphore-chat-native-{version}.{extension}"))
}

/// `name` without anything that could name another directory, or `None` when nothing is left.
fn safe_file_name(name: &str) -> Option<String> {
    let cleaned: String = name
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
        .collect();
    if cleaned.is_empty() || cleaned.starts_with('.') || cleaned == "_" || cleaned.len() > 128 {
        return None;
    }
    Some(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::manifest::{Arch, ArtifactKind};
    use crate::update::testserver::{Response, Server, client};

    const BODY: &[u8] = b"#!fake AppImage\nthis is not a real ELF\n";

    fn digest(bytes: &[u8]) -> Sha256Digest {
        Sha256Digest::from_bytes(Sha256::digest(bytes).into())
    }

    fn artifact_of(url: String, body: &[u8]) -> Artifact {
        Artifact {
            kind: ArtifactKind::AppImage,
            arch: Arch::X86_64,
            url,
            sha256: digest(body),
            size: body.len() as u64,
        }
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "semaphore-update-test-{name}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn join(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn downloads_and_verifies_a_file() {
        let dir = TempDir::new("happy");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY));
        let target = dir.join("Semaphore.AppImage");
        std::fs::write(&target, b"the old build").unwrap();
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let mut seen = Vec::new();
        download(
            &client(),
            &DownloadRequest {
                artifact: &artifact,
                target: target.clone(),
                executable: true,
                keep_previous: true,
            },
            "test",
            &mut |received, total| seen.push((received, total)),
        )
        .await
        .unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), BODY);
        assert_eq!(seen.first(), Some(&(0, BODY.len() as u64)));
        assert_eq!(seen.last(), Some(&(BODY.len() as u64, BODY.len() as u64)));
        assert!(!temporary_path(&target).exists());
        assert_eq!(
            std::fs::read(previous_path(&target)).unwrap(),
            b"the old build"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&target).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o755, "the AppImage stays executable");
        }
        assert!(clear_previous(&target).unwrap());
        assert!(!previous_path(&target).exists());
        assert!(!clear_previous(&target).unwrap());
    }

    #[tokio::test]
    async fn a_wrong_hash_leaves_nothing_behind() {
        let dir = TempDir::new("hash");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(b"something else entirely"));
        let target = dir.join("Semaphore.AppImage");
        std::fs::write(&target, b"the old build").unwrap();
        let mut artifact = artifact_of(server.url("/a.AppImage"), BODY);
        artifact.size = b"something else entirely".len() as u64;

        let error = download(
            &client(),
            &DownloadRequest {
                artifact: &artifact,
                target: target.clone(),
                executable: true,
                keep_previous: true,
            },
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(
            matches!(error, DownloadError::HashMismatch { .. }),
            "{error}"
        );
        assert!(error.retryable());
        assert!(error.to_string().contains("SHA-256"), "{error}");
        assert_eq!(std::fs::read(&target).unwrap(), b"the old build");
        assert!(!temporary_path(&target).exists());
        assert!(!previous_path(&target).exists());
    }

    #[tokio::test]
    async fn a_short_body_is_a_failure() {
        let dir = TempDir::new("short");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY).cut_after(10));
        let target = dir.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let error = download(
            &client(),
            &DownloadRequest {
                artifact: &artifact,
                target: target.clone(),
                executable: false,
                keep_previous: false,
            },
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(
            matches!(
                error,
                DownloadError::Network(_) | DownloadError::ShortBody { .. }
            ),
            "{error}"
        );
        assert!(error.retryable());
        assert!(!target.exists());
        assert!(!temporary_path(&target).exists());
    }

    #[tokio::test]
    async fn a_body_larger_than_the_manifest_is_cut_at_the_cap() {
        let dir = TempDir::new("large");
        let server = Server::start().await;
        let big = vec![b'x'; 64 * 1024];
        server.route("/a.AppImage", Response::ok(big.clone()));
        let target = dir.join("Semaphore.AppImage");
        let mut artifact = artifact_of(server.url("/a.AppImage"), &big);
        artifact.size = 1024;

        let error = download(
            &client(),
            &DownloadRequest {
                artifact: &artifact,
                target: target.clone(),
                executable: false,
                keep_previous: false,
            },
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert_eq!(error, DownloadError::TooLarge { size: 1024 });
        assert!(error.retryable());
        assert!(!target.exists());
        assert!(!temporary_path(&target).exists());
    }

    #[tokio::test]
    async fn a_server_error_is_retryable_and_a_missing_artifact_is_not() {
        let dir = TempDir::new("status");
        let server = Server::start().await;
        server.route("/broken.AppImage", Response::status(503));
        server.route("/gone.AppImage", Response::status(404));
        for (path, retryable) in [("/broken.AppImage", true), ("/gone.AppImage", false)] {
            let target = dir.join("Semaphore.AppImage");
            let artifact = artifact_of(server.url(path), BODY);
            let error = download(
                &client(),
                &DownloadRequest {
                    artifact: &artifact,
                    target: target.clone(),
                    executable: false,
                    keep_previous: false,
                },
                "test",
                &mut |_, _| {},
            )
            .await
            .unwrap_err();
            assert!(matches!(error, DownloadError::Status(_)), "{error}");
            assert_eq!(error.retryable(), retryable, "{path}: {error}");
            assert!(!target.exists());
        }
    }

    /// The connection drops mid-body; the same request works the second time, with nothing left
    /// over from the first.
    #[tokio::test]
    async fn a_dropped_connection_can_be_retried() {
        let dir = TempDir::new("dropped");
        let server = Server::start().await;
        server.script(
            "/a.AppImage",
            vec![
                Response::ok(BODY).cut_after(BODY.len() / 2),
                Response::ok(BODY),
            ],
        );
        let target = dir.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let request = DownloadRequest {
            artifact: &artifact,
            target: target.clone(),
            executable: true,
            keep_previous: true,
        };
        let first = download(&client(), &request, "test", &mut |_, _| {})
            .await
            .unwrap_err();
        assert!(first.retryable(), "{first}");
        assert!(!temporary_path(&target).exists());
        assert!(!target.exists());

        download(&client(), &request, "test", &mut |_, _| {})
            .await
            .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), BODY);
        assert_eq!(server.count("/a.AppImage"), 2);
    }

    #[tokio::test]
    async fn a_target_that_cannot_be_written_is_not_retryable() {
        let dir = TempDir::new("unwritable");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY));
        // Its "folder" is a regular file, so nothing can be created beside it.
        let blocker = dir.join("not-a-folder");
        std::fs::write(&blocker, b"x").unwrap();
        let target = blocker.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let error = download(
            &client(),
            &DownloadRequest {
                artifact: &artifact,
                target,
                executable: false,
                keep_previous: false,
            },
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(matches!(error, DownloadError::Target(_)), "{error}");
        assert!(!error.retryable());
    }

    /// A directory the user may not write cannot receive the temporary file. Skipped as root,
    /// where permission bits don't stop anything.
    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn a_directory_that_is_not_writable_is_not_retryable() {
        use std::os::unix::fs::PermissionsExt as _;
        // SAFETY: `geteuid` has no preconditions.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let dir = TempDir::new("readonly");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY));
        let locked = dir.join("locked");
        std::fs::create_dir_all(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let error = download(
            &client(),
            &DownloadRequest {
                artifact: &artifact,
                target: locked.join("Semaphore.AppImage"),
                executable: false,
                keep_previous: false,
            },
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(error, DownloadError::Target(_)), "{error}");
        assert!(!error.retryable());
        assert_eq!(std::fs::read_dir(&locked).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn a_second_update_keeps_the_original_backup() {
        let dir = TempDir::new("backup");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY));
        let target = dir.join("Semaphore.AppImage");
        std::fs::write(&target, b"v1").unwrap();
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let request = DownloadRequest {
            artifact: &artifact,
            target: target.clone(),
            executable: true,
            keep_previous: true,
        };
        download(&client(), &request, "test", &mut |_, _| {})
            .await
            .unwrap();
        assert_eq!(std::fs::read(previous_path(&target)).unwrap(), b"v1");

        // A newer download before the restart: the backup still holds what was running.
        server.route("/b.AppImage", Response::ok(b"v3"));
        let next = artifact_of(server.url("/b.AppImage"), b"v3");
        download(
            &client(),
            &DownloadRequest {
                artifact: &next,
                target: target.clone(),
                executable: true,
                keep_previous: true,
            },
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"v3");
        assert_eq!(std::fs::read(previous_path(&target)).unwrap(), b"v1");
    }

    #[test]
    fn refuses_a_redirect_that_leaves_https() {
        let https = Url::parse("https://example.org/a.AppImage").unwrap();
        let loopback = Url::parse("http://127.0.0.1:3999/a.AppImage").unwrap();
        let plain = Url::parse("http://example.org/a.AppImage").unwrap();
        let credentials = Url::parse("https://user:secret@example.org/a.AppImage").unwrap();
        assert!(check_final_url("https://example.org/a", &https).is_ok());
        assert!(check_final_url("https://example.org/a", &loopback).is_ok());
        for refused in [&plain, &credentials] {
            let error = check_final_url("https://example.org/a", refused).unwrap_err();
            assert!(matches!(error, DownloadError::Insecure(_)), "{error}");
            assert!(!error.retryable());
        }
    }

    #[test]
    fn package_names_come_from_the_url_or_the_version() {
        assert_eq!(
            package_name(
                "https://example.org/Semaphore-Chat-Native-1.4.0-x86_64.AppImage",
                "1.4.0",
                "AppImage"
            ),
            "Semaphore-Chat-Native-1.4.0-x86_64.AppImage"
        );
        // Anything that isn't a plain file name of the right kind falls back to one built from
        // the version, and never keeps a path separator or a leading dot.
        for url in [
            "https://example.org/a/../../etc/passwd.deb",
            "https://example.org/%2e%2e%2fevil.deb",
            "https://example.org/.hidden.deb",
            "https://example.org/",
            "not a url",
            "https://example.org/a.deb.exe",
        ] {
            let name = package_name(url, "1.4.0", "deb");
            assert!(
                !name.contains('/') && !name.starts_with('.'),
                "{url}: {name}"
            );
            assert!(name.ends_with(".deb"), "{url}: {name}");
        }
        for url in [
            "https://example.org/",
            "not a url",
            "https://example.org/a.deb.exe",
        ] {
            assert_eq!(
                package_name(url, "1.4.0", "deb"),
                "semaphore-chat-native-1.4.0.deb",
                "{url}"
            );
        }
    }

    #[test]
    fn temporary_and_previous_files_sit_beside_the_target() {
        let target = Path::new("/home/mike/Apps/Semaphore.AppImage");
        assert_eq!(
            temporary_path(target),
            Path::new("/home/mike/Apps/Semaphore.AppImage.part")
        );
        assert_eq!(
            previous_path(target),
            Path::new("/home/mike/Apps/Semaphore.AppImage.old")
        );
    }
}
