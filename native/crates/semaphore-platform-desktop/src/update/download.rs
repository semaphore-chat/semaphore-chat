//! Downloading an artifact: to a temporary file beside where it belongs, verified as it lies on
//! disk, and only then put in place.
//!
//! The size in the manifest is a cap: the transfer stops as soon as more than that arrives, and a
//! body shorter than it is a failure too. A transfer that moves less than [`Stall::min_bytes`] in
//! [`Stall::window`] is given up. When the body is complete, the temporary file is read back
//! through the descriptor it was written with and hashed: what is checked is the file that will be
//! renamed, not the bytes that went past. Any failure, and a download dropped half way (the app
//! quit), removes the temporary file; the target is only ever replaced after its replacement is
//! complete and verified, so an interrupted update never leaves a half-written AppImage where the
//! old one was.
//!
//! **The folder must be this user's alone** ([`check_private_dir`]): owned by the user, writable
//! by nobody else (so not `/tmp`, sticky or not). Only then are the names in it (`<file>.part`,
//! `<file>.old`) trustworthy; anywhere else the updater refuses rather than risk renaming or
//! copying through someone else's symlink. The temporary file is created new (`O_EXCL`, no
//! symlink followed, mode 0600) and everything after that happens through its descriptor.
//!
//! The old AppImage is kept beside the new one as `<file>.old` (a hard link, so nothing is copied
//! and both names share the blocks until the old one goes) and removed on the next start, which
//! proves the new file runs. electron-updater's AppImage updater instead deletes the running file
//! (`unlinkSync`) and moves the download into its place, with no way back if the download is bad;
//! see `docs/packaging.md`, "Auto-update".
//!
//! **Redirects** are checked hop by hop ([`configure_client`]'s policy): every hop must be https
//! without credentials. Plain http to a loopback address is allowed only when the request itself
//! started at a loopback address (the tests and the rig); [`check_final_url`] checks the same of
//! where the response came from.

use crate::update::manifest::{Artifact, Sha256Digest, is_loopback, is_trusted_url};
use sha2::{Digest as _, Sha256};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::time::Duration;
use url::Url;

/// More hops than this is a loop or a hostile host.
const MAX_REDIRECTS: usize = 10;
/// How long a connection may take to open.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long one read may wait for a byte.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// The updater's HTTP client settings, applied over `builder` (which carries the TLS
/// configuration: the app passes one with `semaphore-net`'s): its own redirect rule and timeouts.
/// [`crate::update::Updater::new`] applies this itself, so no caller can forget it.
pub fn configure_client(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    builder
        .redirect(redirect_policy())
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
}

/// Follows a redirect only to where [`redirect_allowed`] says, and at most [`MAX_REDIRECTS`]
/// times.
fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() > MAX_REDIRECTS {
            return attempt.error(format!("more than {MAX_REDIRECTS} redirects"));
        }
        let from_loopback = attempt
            .previous()
            .first()
            .is_some_and(|origin| origin.scheme() == "http" && is_loopback(origin));
        match redirect_allowed(attempt.url(), from_loopback) {
            Ok(()) => attempt.follow(),
            Err(reason) => attempt.error(reason),
        }
    })
}

/// Whether one redirect hop may be followed: https without credentials, or plain http to a
/// loopback address when the request started at one (`from_loopback`).
pub fn redirect_allowed(next: &Url, from_loopback: bool) -> Result<(), String> {
    if !next.username().is_empty() || next.password().is_some() {
        return Err(format!(
            "a redirect to {} carries a user name or password",
            next.host_str().unwrap_or("?")
        ));
    }
    match next.scheme() {
        "https" => Ok(()),
        "http" if from_loopback && is_loopback(next) => Ok(()),
        _ => Err(format!("a redirect to {next} is not https")),
    }
}

/// When a transfer counts as stuck: less than `min_bytes` in any `window`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stall {
    pub window: Duration,
    pub min_bytes: u64,
}

impl Default for Stall {
    /// 64 KiB a minute: a dial-up line passes, a server trickling a byte at a time doesn't.
    fn default() -> Self {
        Self {
            window: Duration::from_secs(60),
            min_bytes: 64 * 1024,
        }
    }
}

/// What to fetch, and what the result becomes.
#[derive(Debug, Clone)]
pub struct DownloadRequest<'a> {
    pub artifact: &'a Artifact,
    /// The file the artifact becomes: the running AppImage, or a package in the cache.
    pub target: PathBuf,
    /// Make the result executable (an AppImage), keeping the replaced file's permission bits.
    pub executable: bool,
    /// Keep the file this replaces as `<target>.old` (an AppImage).
    pub keep_previous: bool,
    pub stall: Stall,
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
    /// Writing, or putting the file in place, failed, or the folder isn't safe to update in.
    /// Retrying the same download won't help.
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

    /// Whether the release itself is wrong (its bytes don't match what it says), so fetching the
    /// same artifact again on a schedule only downloads the same wrong bytes.
    pub fn release_is_wrong(&self) -> bool {
        matches!(self, Self::TooLarge { .. } | Self::HashMismatch { .. })
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

/// A request that failed before or while the response arrived. A redirect the policy refused is
/// a refusal, not a network fault.
pub(crate) fn request_error(error: &reqwest::Error) -> DownloadError {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(inner) = source {
        message.push_str(": ");
        message.push_str(&inner.to_string());
        source = inner.source();
    }
    if error.is_redirect() {
        DownloadError::Insecure(message)
    } else {
        DownloadError::Network(message)
    }
}

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
    create_private_dir(parent).map_err(|error| {
        DownloadError::Target(format!("cannot make {}: {error}", parent.display()))
    })?;
    check_private_dir(parent).map_err(DownloadError::Target)?;
    // Removed again on every way out of here but the successful rename, a dropped future (the
    // app quit mid-download) included.
    let mut part = PartFile::create(temporary_path(&request.target))?;
    fetch_into(client, request, user_agent, &mut part.file, progress).await?;
    verify_file(&mut part.file, request.artifact)?;
    place(request, &mut part)
}

/// The temporary file, removed when dropped unless it was put in place.
struct PartFile {
    path: PathBuf,
    file: File,
    placed: bool,
}

impl PartFile {
    /// A new file at `path`, replacing whatever a crashed run left there (a symlink is removed,
    /// never followed). Readable and writable by this user only.
    fn create(path: PathBuf) -> Result<Self, DownloadError> {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(DownloadError::Target(format!(
                    "cannot remove the leftover {}: {error}",
                    path.display()
                )));
            }
        }
        let file = create_new_private(&path).map_err(|error| {
            DownloadError::Target(format!("cannot write {}: {error}", path.display()))
        })?;
        Ok(Self {
            path,
            file,
            placed: false,
        })
    }
}

impl Drop for PartFile {
    fn drop(&mut self) {
        if !self.placed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Opens `path` for reading and writing only if nothing is there yet: never a symlink, never an
/// existing file. Mode 0600 on Unix.
fn create_new_private(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
        #[cfg(target_os = "linux")]
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

async fn fetch_into(
    client: &reqwest::Client,
    request: &DownloadRequest<'_>,
    user_agent: &str,
    file: &mut File,
    progress: &mut (dyn FnMut(u64, u64) + Send),
) -> Result<(), DownloadError> {
    let artifact = request.artifact;
    let response = client
        .get(&artifact.url)
        .header(reqwest::header::USER_AGENT, user_agent)
        .send()
        .await
        .map_err(|error| request_error(&error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(DownloadError::Status(status.as_u16()));
    }
    check_final_url(&artifact.url, response.url())?;
    // A server that says up front it will send too much isn't read at all.
    if let Some(length) = response.content_length()
        && length > artifact.size
    {
        return Err(DownloadError::TooLarge {
            size: artifact.size,
        });
    }

    let mut response = response;
    let mut received = 0u64;
    let mut window_start = tokio::time::Instant::now();
    let mut window_bytes = 0u64;
    progress(0, artifact.size);
    loop {
        let next =
            tokio::time::timeout_at(window_start + request.stall.window, response.chunk()).await;
        let Ok(next) = next else {
            return Err(DownloadError::Network(format!(
                "the transfer stalled (under {} bytes in {} s)",
                request.stall.min_bytes,
                request.stall.window.as_secs_f32()
            )));
        };
        let Some(chunk) = next.map_err(|error| request_error(&error))? else {
            break;
        };
        received += chunk.len() as u64;
        // Whatever the headers said, the stream is cut at the cap.
        if received > artifact.size {
            return Err(DownloadError::TooLarge {
                size: artifact.size,
            });
        }
        file.write_all(&chunk)
            .map_err(|error| DownloadError::Target(error.to_string()))?;
        window_bytes += chunk.len() as u64;
        if window_bytes >= request.stall.min_bytes {
            window_start = tokio::time::Instant::now();
            window_bytes = 0;
        }
        progress(received, artifact.size);
    }
    if received != artifact.size {
        return Err(DownloadError::ShortBody {
            received,
            expected: artifact.size,
        });
    }
    Ok(())
}

/// Reads the file back through its own descriptor and checks its size and SHA-256: what is
/// verified is what will be renamed into place.
fn verify_file(file: &mut File, artifact: &Artifact) -> Result<(), DownloadError> {
    let target_error = |error: std::io::Error| DownloadError::Target(error.to_string());
    file.flush().map_err(target_error)?;
    file.sync_all().map_err(target_error)?;
    file.seek(SeekFrom::Start(0)).map_err(target_error)?;
    let mut hasher = Sha256::new();
    let mut length = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(target_error)?;
        if read == 0 {
            break;
        }
        length += read as u64;
        hasher.update(&buffer[..read]);
    }
    if length != artifact.size {
        return Err(DownloadError::ShortBody {
            received: length,
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
    Ok(())
}

/// Refuses a response that isn't where a trusted request may land: a redirect to plain http (or
/// to a URL carrying credentials) would undo the manifest's https rule. Plain http to loopback is
/// accepted only when `requested` was itself a loopback URL.
pub fn check_final_url(requested: &str, final_url: &Url) -> Result<(), DownloadError> {
    let from_loopback =
        Url::parse(requested).is_ok_and(|origin| origin.scheme() == "http" && is_loopback(&origin));
    if !is_trusted_url(final_url) || (final_url.scheme() == "http" && !from_loopback) {
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
fn place(request: &DownloadRequest<'_>, part: &mut PartFile) -> Result<(), DownloadError> {
    if request.executable {
        set_mode_like(&part.file, &request.target)?;
    }
    let mut kept = false;
    if request.keep_previous {
        kept = keep_previous(&request.target)?;
    }
    let renamed = still_the_same_file(part).and_then(|()| replace(&part.path, &request.target));
    if renamed.is_err() && kept {
        // The old file is still where it was; a backup made for nothing is removed again.
        let _ = std::fs::remove_file(previous_path(&request.target));
    }
    renamed?;
    part.placed = true;
    Ok(())
}

/// The name about to be renamed still names the file that was verified.
fn still_the_same_file(part: &PartFile) -> Result<(), DownloadError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        let open = part
            .file
            .metadata()
            .map_err(|error| DownloadError::Target(error.to_string()))?;
        let named = std::fs::symlink_metadata(&part.path)
            .map_err(|error| DownloadError::Target(error.to_string()))?;
        if open.dev() != named.dev() || open.ino() != named.ino() {
            return Err(DownloadError::Target(format!(
                "{} changed after it was verified",
                part.path.display()
            )));
        }
    }
    #[cfg(not(unix))]
    let _ = part;
    Ok(())
}

/// Gives the download the permission bits of the file it replaces (with the owner's execute bit,
/// since it has to run), or 0755 for a first install. Through the open descriptor.
fn set_mode_like(file: &File, target: &Path) -> Result<(), DownloadError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = match std::fs::symlink_metadata(target) {
            Ok(metadata) if metadata.is_file() => (metadata.permissions().mode() & 0o777) | 0o100,
            _ => 0o755,
        };
        file.set_permissions(std::fs::Permissions::from_mode(mode))
            .map_err(|error| DownloadError::Target(format!("cannot make it executable: {error}")))
    }
    #[cfg(not(unix))]
    {
        let _ = (file, target);
        Ok(())
    }
}

/// Keeps `target` as `<target>.old` unless it is already kept. Returns whether this call made the
/// backup. A hard link shares the blocks; a filesystem without them gets a copy, written to a new
/// file (never through whatever was at that name).
fn keep_previous(target: &Path) -> Result<bool, DownloadError> {
    let previous = previous_path(target);
    let error = |what: &str, error: std::io::Error| {
        DownloadError::Target(format!(
            "cannot keep {} before replacing it ({what}): {error}",
            target.display()
        ))
    };
    match std::fs::symlink_metadata(&previous) {
        // The original is already kept (a second update before the restart).
        Ok(metadata) if metadata.is_file() => return Ok(false),
        // A symlink or anything else at that name is not ours: it goes, and is not followed.
        Ok(_) => std::fs::remove_file(&previous).map_err(|e| error("remove", e))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(error("inspect", e)),
    }
    match std::fs::symlink_metadata(target) {
        Ok(metadata) if metadata.is_file() => {}
        // Nothing to keep: this is the first install at this path.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Ok(_) => {
            return Err(DownloadError::Target(format!(
                "{} is not a regular file",
                target.display()
            )));
        }
        Err(e) => return Err(error("inspect", e)),
    }
    if std::fs::hard_link(target, &previous).is_err() {
        let mut from = File::open(target).map_err(|e| error("open", e))?;
        let mut to = create_new_private(&previous).map_err(|e| error("create", e))?;
        if let Err(e) = std::io::copy(&mut from, &mut to) {
            let _ = std::fs::remove_file(&previous);
            return Err(error("copy", e));
        }
    }
    Ok(true)
}

/// Makes `dir` (and its parents) if missing; a new folder is this user's only (0700).
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt as _;
        builder.mode(0o700);
    }
    builder.create(dir)
}

/// Whether `dir` is a folder only this user can change: a real directory (not a symlink), owned
/// by this user, and writable by neither its group nor anyone else. Sticky world-writable folders
/// (`/tmp`) are refused too: another user could still plant names in them. The updater only
/// writes in a folder that passes. Always passes off Unix (Windows never self-updates).
pub fn check_private_dir(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        let metadata = std::fs::symlink_metadata(dir)
            .map_err(|error| format!("cannot inspect {}: {error}", dir.display()))?;
        if !metadata.is_dir() {
            return Err(format!("{} is not a folder", dir.display()));
        }
        // SAFETY: `geteuid` has no preconditions.
        let user = unsafe { libc::geteuid() };
        if metadata.uid() != user {
            return Err(format!(
                "{} belongs to another user, so the app won't update itself there",
                dir.display()
            ));
        }
        if metadata.mode() & 0o022 != 0 {
            return Err(format!(
                "other users can write in {}, so the app won't update itself there",
                dir.display()
            ));
        }
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
        Ok(())
    }
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

/// Removes a temporary file a killed download left beside `target`. Returns whether there was
/// one. Called at startup, next to [`clear_previous`].
pub fn clear_partial(target: &Path) -> std::io::Result<bool> {
    match std::fs::remove_file(temporary_path(target)) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

/// Removes what earlier downloads left in the package folder `dir`: every `.part`, and every
/// package except `keep`. Only regular files ending in `.part`, `.deb` or `.rpm` are touched.
/// Returns how many went.
pub fn sweep_packages(dir: &Path, keep: Option<&Path>) -> std::io::Result<usize> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error),
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if keep == Some(path.as_path()) || !entry.file_type()?.is_file() {
            continue;
        }
        let ours = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| matches!(extension, "part" | "deb" | "rpm"));
        if ours {
            std::fs::remove_file(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
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
            // Private, whatever the umask: the updater refuses a folder others can write.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            }
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
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let mut seen = Vec::new();
        download(
            &client(),
            &DownloadRequest {
                artifact: &artifact,
                target: target.clone(),
                executable: true,
                keep_previous: true,
                stall: Stall::default(),
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
                stall: Stall::default(),
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
                stall: Stall::default(),
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

    fn request(artifact: &Artifact, target: PathBuf) -> DownloadRequest<'_> {
        DownloadRequest {
            artifact,
            target,
            executable: false,
            keep_previous: false,
            stall: Stall::default(),
        }
    }

    /// A server that announces more than the manifest allows is refused before the body is read.
    #[tokio::test]
    async fn a_content_length_over_the_cap_is_refused_before_the_body() {
        let dir = TempDir::new("large-header");
        let server = Server::start().await;
        let big = vec![b'x'; 64 * 1024];
        server.route("/a.AppImage", Response::ok(big.clone()));
        let target = dir.join("Semaphore.AppImage");
        let mut artifact = artifact_of(server.url("/a.AppImage"), &big);
        artifact.size = 1024;
        let mut seen = Vec::new();
        let error = download(
            &client(),
            &request(&artifact, target.clone()),
            "test",
            &mut |received, _| seen.push(received),
        )
        .await
        .unwrap_err();
        assert_eq!(error, DownloadError::TooLarge { size: 1024 });
        assert!(seen.is_empty(), "no byte was read: {seen:?}");
        assert!(!target.exists());
        assert!(!temporary_path(&target).exists());
    }

    /// No `Content-Length` (chunked): the streaming cap stops the transfer as soon as it is
    /// crossed, and nothing beyond the cap was written.
    #[tokio::test]
    async fn a_chunked_body_over_the_cap_is_cut_while_streaming() {
        let dir = TempDir::new("large-chunked");
        let server = Server::start().await;
        let big = vec![b'x'; 64 * 1024];
        server.route("/a.AppImage", Response::ok(big.clone()).chunked());
        let target = dir.join("Semaphore.AppImage");
        let mut artifact = artifact_of(server.url("/a.AppImage"), &big);
        artifact.size = 4000;
        let mut seen = Vec::new();
        let error = download(
            &client(),
            &request(&artifact, target.clone()),
            "test",
            &mut |received, _| seen.push(received),
        )
        .await
        .unwrap_err();
        assert_eq!(error, DownloadError::TooLarge { size: 4000 });
        assert!(error.retryable());
        // Progress started at zero and was reported for streamed chunks, never past the cap.
        assert_eq!(seen.first(), Some(&0));
        assert!(seen.len() > 1, "the body was streamed: {seen:?}");
        assert!(seen.iter().all(|received| *received <= 4000), "{seen:?}");
        assert!(!target.exists());
        assert!(!temporary_path(&target).exists());
    }

    /// No `Content-Length` and the connection closes cleanly early: the transfer "succeeds" as
    /// HTTP, and only the size check catches it.
    #[tokio::test]
    async fn a_body_without_a_length_that_ends_early_is_a_short_body() {
        let dir = TempDir::new("short-unframed");
        let server = Server::start().await;
        server.route(
            "/a.AppImage",
            Response::ok(BODY).until_close().cut_after(10),
        );
        let target = dir.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let error = download(
            &client(),
            &request(&artifact, target.clone()),
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert_eq!(
            error,
            DownloadError::ShortBody {
                received: 10,
                expected: BODY.len() as u64
            }
        );
        assert!(error.retryable());
        assert!(!temporary_path(&target).exists());
    }

    /// A chunked body of exactly the right bytes downloads like any other.
    #[tokio::test]
    async fn a_chunked_body_of_the_right_size_is_accepted() {
        let dir = TempDir::new("chunked");
        let server = Server::start().await;
        let body: Vec<u8> = (0..5000u32).map(|n| n as u8).collect();
        server.route("/a.AppImage", Response::ok(body.clone()).chunked());
        let target = dir.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), &body);
        download(
            &client(),
            &request(&artifact, target.clone()),
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), body);
    }

    /// A server that sends a little and then nothing is given up after the stall window, instead
    /// of holding the download (and every later check) forever.
    #[tokio::test]
    async fn a_stalled_transfer_is_given_up() {
        let dir = TempDir::new("stall");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY).stall_after(5));
        let target = dir.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let mut stalled = request(&artifact, target.clone());
        stalled.stall = Stall {
            window: Duration::from_millis(300),
            min_bytes: 1024,
        };
        let error = tokio::time::timeout(
            Duration::from_secs(20),
            download(&client(), &stalled, "test", &mut |_, _| {}),
        )
        .await
        .expect("the stall rule never fired")
        .unwrap_err();
        assert!(
            matches!(&error, DownloadError::Network(message) if message.contains("stalled")),
            "{error}"
        );
        assert!(error.retryable());
        assert!(!temporary_path(&target).exists());
    }

    /// The app quits mid-download: the dropped transfer takes its temporary file with it.
    #[tokio::test]
    async fn a_download_dropped_half_way_leaves_no_temporary_file() {
        let dir = TempDir::new("dropped-future");
        let server = Server::start().await;
        server.route(
            "/a.AppImage",
            Response::ok(BODY).stall_after(BODY.len() / 2),
        );
        let target = dir.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let transfer = tokio::spawn({
            let target = target.clone();
            async move {
                let mut started = Some(started_tx);
                let _ = download(
                    &client(),
                    &request(&artifact, target),
                    "test",
                    &mut move |received, _| {
                        if received > 0
                            && let Some(started) = started.take()
                        {
                            let _ = started.send(());
                        }
                    },
                )
                .await;
            }
        });
        tokio::time::timeout(Duration::from_secs(10), started_rx)
            .await
            .expect("no byte arrived")
            .unwrap();
        assert!(
            temporary_path(&target).exists(),
            "the transfer is in progress"
        );
        transfer.abort();
        assert!(transfer.await.unwrap_err().is_cancelled());
        assert!(!temporary_path(&target).exists());
        assert!(!target.exists());
    }

    /// A symlink planted at `<file>.part` is removed, not written through.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_symlink_at_the_temporary_name_is_not_followed() {
        let dir = TempDir::new("part-symlink");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY));
        let target = dir.join("Semaphore.AppImage");
        std::fs::write(&target, b"the old build").unwrap();
        let victim = dir.join("victim");
        std::fs::write(&victim, b"not yours").unwrap();
        std::os::unix::fs::symlink(&victim, temporary_path(&target)).unwrap();
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        download(
            &client(),
            &request(&artifact, target.clone()),
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&victim).unwrap(), b"not yours");
        assert_eq!(std::fs::read(&target).unwrap(), BODY);
        assert!(std::fs::symlink_metadata(&target).unwrap().is_file());
    }

    /// A dangling symlink at `<file>.old` is replaced by a real backup; its target is never
    /// created.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_dangling_symlink_at_the_backup_name_is_not_followed() {
        let dir = TempDir::new("old-symlink");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY));
        let target = dir.join("Semaphore.AppImage");
        std::fs::write(&target, b"the old build").unwrap();
        let victim = dir.join("created-through-the-link");
        std::os::unix::fs::symlink(&victim, previous_path(&target)).unwrap();
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let mut keeping = request(&artifact, target.clone());
        keeping.executable = true;
        keeping.keep_previous = true;
        download(&client(), &keeping, "test", &mut |_, _| {})
            .await
            .unwrap();
        assert!(!victim.exists());
        let backup = previous_path(&target);
        assert!(std::fs::symlink_metadata(&backup).unwrap().is_file());
        assert_eq!(std::fs::read(&backup).unwrap(), b"the old build");
    }

    /// A folder other users can write (a shared folder, `/tmp`-like even with the sticky bit) is
    /// refused before anything is fetched or written.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_folder_others_can_write_is_refused() {
        use std::os::unix::fs::PermissionsExt as _;
        for mode in [0o770, 0o777, 0o1777] {
            let dir = TempDir::new(&format!("shared-{mode:o}"));
            let server = Server::start().await;
            server.route("/a.AppImage", Response::ok(BODY));
            let shared = dir.join("shared");
            std::fs::create_dir(&shared).unwrap();
            std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(mode)).unwrap();
            let target = shared.join("Semaphore.AppImage");
            std::fs::write(&target, b"the old build").unwrap();
            let artifact = artifact_of(server.url("/a.AppImage"), BODY);
            let error = download(
                &client(),
                &request(&artifact, target.clone()),
                "test",
                &mut |_, _| {},
            )
            .await
            .unwrap_err();
            assert!(
                matches!(&error, DownloadError::Target(message) if message.contains("other users")),
                "{mode:o}: {error}"
            );
            assert!(!error.retryable());
            assert_eq!(
                server.count("/a.AppImage"),
                0,
                "{mode:o}: nothing was fetched"
            );
            assert_eq!(std::fs::read(&target).unwrap(), b"the old build");
            assert_eq!(std::fs::read_dir(&shared).unwrap().count(), 1);
            std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
    }

    /// The replaced AppImage's permission bits carry over (a 0750 file stays 0750).
    #[cfg(unix)]
    #[tokio::test]
    async fn the_replaced_files_mode_is_kept() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = TempDir::new("mode");
        let server = Server::start().await;
        server.route("/a.AppImage", Response::ok(BODY));
        let target = dir.join("Semaphore.AppImage");
        std::fs::write(&target, b"the old build").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o750)).unwrap();
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        let mut executable = request(&artifact, target.clone());
        executable.executable = true;
        download(&client(), &executable, "test", &mut |_, _| {})
            .await
            .unwrap();
        let mode = std::fs::metadata(&target).unwrap().permissions().mode();
        assert_eq!(mode & 0o7777, 0o750);
    }

    /// A redirect between loopback addresses (the rig's and the tests' only http) is followed.
    #[tokio::test]
    async fn a_redirect_within_loopback_is_followed() {
        let dir = TempDir::new("redirect-ok");
        let server = Server::start().await;
        server.route(
            "/a.AppImage",
            Response::redirect(302, server.url("/b.AppImage")),
        );
        server.route("/b.AppImage", Response::ok(BODY));
        let target = dir.join("Semaphore.AppImage");
        let artifact = artifact_of(server.url("/a.AppImage"), BODY);
        download(
            &client(),
            &request(&artifact, target.clone()),
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), BODY);
        assert_eq!(server.count("/b.AppImage"), 1);
    }

    /// A hop to plain http off loopback, or to a URL with credentials, is refused by the redirect
    /// policy before it is followed (the refused host is never contacted), and is a refusal, not
    /// a network fault to retry.
    #[tokio::test]
    async fn a_redirect_that_leaves_https_is_refused_hop_by_hop() {
        let dir = TempDir::new("redirect-refused");
        let server = Server::start().await;
        let port = server.url("").rsplit(':').next().unwrap().to_owned();
        for (hop, location) in [
            ("/plain", "http://example.invalid/a.AppImage".to_owned()),
            (
                "/credentials",
                format!("http://user:secret@127.0.0.1:{port}/b.AppImage"),
            ),
            ("/ftp", "ftp://example.invalid/a.AppImage".to_owned()),
        ] {
            // Two hops: the first stays on loopback, the second is the bad one.
            server.route(
                &format!("/first{hop}"),
                Response::redirect(307, server.url(hop)),
            );
            server.route(hop, Response::redirect(302, location.clone()));
            server.route("/b.AppImage", Response::ok(BODY));
            let target = dir.join("Semaphore.AppImage");
            let artifact = artifact_of(server.url(&format!("/first{hop}")), BODY);
            let error = download(
                &client(),
                &request(&artifact, target.clone()),
                "test",
                &mut |_, _| {},
            )
            .await
            .unwrap_err();
            assert!(
                matches!(error, DownloadError::Insecure(_)),
                "{location}: {error}"
            );
            assert!(!error.retryable());
            assert!(!target.exists());
            assert!(!temporary_path(&target).exists());
        }
        assert_eq!(
            server.count("/b.AppImage"),
            0,
            "the credentialed hop was not followed"
        );
    }

    #[tokio::test]
    async fn a_redirect_loop_is_cut() {
        let dir = TempDir::new("redirect-loop");
        let server = Server::start().await;
        server.route("/loop", Response::redirect(302, server.url("/loop")));
        let artifact = artifact_of(server.url("/loop"), BODY);
        let error = download(
            &client(),
            &request(&artifact, dir.join("Semaphore.AppImage")),
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap_err();
        assert!(matches!(error, DownloadError::Insecure(_)), "{error}");
        assert!(
            server.count("/loop") <= MAX_REDIRECTS + 1,
            "{}",
            server.count("/loop")
        );
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
                    stall: Stall::default(),
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
            stall: Stall::default(),
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
                stall: Stall::default(),
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
                stall: Stall::default(),
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
            stall: Stall::default(),
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
                stall: Stall::default(),
            },
            "test",
            &mut |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"v3");
        assert_eq!(std::fs::read(previous_path(&target)).unwrap(), b"v1");
    }

    /// The hop rule and the final-URL rule: https anywhere, plain http only from loopback to
    /// loopback, never credentials.
    #[test]
    fn the_redirect_rule_allows_loopback_only_from_loopback() {
        let https = Url::parse("https://example.org/a.AppImage").unwrap();
        let loopback = Url::parse("http://127.0.0.1:3999/a.AppImage").unwrap();
        let plain = Url::parse("http://example.org/a.AppImage").unwrap();
        let credentials = Url::parse("https://user:secret@example.org/a.AppImage").unwrap();

        assert!(redirect_allowed(&https, false).is_ok());
        assert!(redirect_allowed(&https, true).is_ok());
        assert!(redirect_allowed(&loopback, true).is_ok());
        // An https release host can't send the client to a local port.
        assert!(redirect_allowed(&loopback, false).is_err());
        for refused in [&plain, &credentials] {
            assert!(redirect_allowed(refused, false).is_err(), "{refused}");
            assert!(redirect_allowed(refused, true).is_err(), "{refused}");
        }

        assert!(check_final_url("https://example.org/a", &https).is_ok());
        assert!(check_final_url("http://127.0.0.1:3999/a", &loopback).is_ok());
        for (requested, refused) in [
            ("https://example.org/a", &loopback),
            ("https://example.org/a", &plain),
            ("https://example.org/a", &credentials),
            ("http://127.0.0.1:3999/a", &plain),
        ] {
            let error = check_final_url(requested, refused).unwrap_err();
            assert!(matches!(error, DownloadError::Insecure(_)), "{error}");
            assert!(!error.retryable());
        }
    }

    #[test]
    fn leftovers_are_swept() {
        let dir = TempDir::new("sweep");
        let target = dir.join("Semaphore.AppImage");
        std::fs::write(temporary_path(&target), b"half").unwrap();
        assert!(clear_partial(&target).unwrap());
        assert!(!clear_partial(&target).unwrap());

        let packages = dir.join("updates");
        std::fs::create_dir(&packages).unwrap();
        for name in [
            "old_1.0.0.deb",
            "old-1.0.0.rpm",
            "new_1.1.0.deb",
            "x.deb.part",
            "notes.txt",
        ] {
            std::fs::write(packages.join(name), b"x").unwrap();
        }
        std::fs::create_dir(packages.join("folder.deb")).unwrap();
        let keep = packages.join("new_1.1.0.deb");
        assert_eq!(sweep_packages(&packages, Some(&keep)).unwrap(), 3);
        let mut left: Vec<String> = std::fs::read_dir(&packages)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, ["folder.deb", "new_1.1.0.deb", "notes.txt"]);
        assert_eq!(sweep_packages(&dir.join("missing"), None).unwrap(), 0);
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
