//! The release manifest: the small JSON document a release publishes next to its artifacts.
//!
//! ```json
//! {
//!   "version": "1.4.0",
//!   "notes_url": "https://github.com/semaphore-chat/semaphore-chat/releases/tag/v1.4.0",
//!   "artifacts": [
//!     { "kind": "appimage", "arch": "x86_64",
//!       "url": "https://github.com/.../Semaphore-Chat-Native-1.4.0-x86_64.AppImage",
//!       "sha256": "9f86d0…", "size": 30345720 }
//!   ]
//! }
//! ```
//!
//! Validation is strict where a wrong answer would install the wrong thing, and lenient only where
//! the release pipeline may grow: an artifact of a `kind` or `arch` this build doesn't know is
//! ignored (so a future macOS artifact doesn't break today's build), while an artifact that *is*
//! for this build must have every field, a trusted URL, a 64-hex SHA-256 and a size that isn't
//! absurd. Two artifacts for the same kind and arch are refused: there is no honest way to pick.
//!
//! **Trust.** For now it is the transport plus the hash, as with electron-updater: the manifest is
//! read over HTTPS (or plain HTTP to a loopback address, which is how tests and rigs serve one),
//! and the artifact must hash to the SHA-256 the manifest names. [`verify_signature`] is the one
//! seam where a signed manifest would be checked, before any field is trusted; it is
//! deliberately empty until there is a key to verify against.

use crate::update::version::parse_version;
use semver::Version;
use serde_json::Value;
use std::fmt;
use url::{Host, Url};

/// The largest artifact a manifest may name: 512 MiB. The AppImage is about 30 MB today; anything
/// near this is a mistake or a hostile manifest, and the download refuses to write it.
pub const MAX_ARTIFACT_SIZE: u64 = 512 * 1024 * 1024;

/// The most of a manifest body that is read: 1 MiB. The document is a few hundred bytes.
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;

/// What an artifact is installed as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArtifactKind {
    AppImage,
    Deb,
    Rpm,
    WindowsZip,
}

impl ArtifactKind {
    /// The manifest's spelling, or `None` for a kind this build doesn't know.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "appimage" => Some(Self::AppImage),
            "deb" => Some(Self::Deb),
            "rpm" => Some(Self::Rpm),
            "windows-zip" => Some(Self::WindowsZip),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::AppImage => "appimage",
            Self::Deb => "deb",
            Self::Rpm => "rpm",
            Self::WindowsZip => "windows-zip",
        }
    }

    /// The file name extension a download of this kind keeps.
    pub fn extension(self) -> &'static str {
        match self {
            Self::AppImage => "AppImage",
            Self::Deb => "deb",
            Self::Rpm => "rpm",
            Self::WindowsZip => "zip",
        }
    }
}

/// The processor architecture an artifact is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Arch {
    X86_64,
    Aarch64,
}

impl Arch {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "x86_64" => Some(Self::X86_64),
            "aarch64" => Some(Self::Aarch64),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::X86_64 => "x86_64",
            Self::Aarch64 => "aarch64",
        }
    }

    /// The architecture this binary was built for, when releases name it.
    pub const fn current() -> Option<Self> {
        #[cfg(target_arch = "x86_64")]
        {
            Some(Self::X86_64)
        }
        #[cfg(target_arch = "aarch64")]
        {
            Some(Self::Aarch64)
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            None
        }
    }
}

/// A SHA-256 digest: 32 bytes, printed as 64 lowercase hex digits.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Sha256Digest([u8; 32]);

impl Sha256Digest {
    /// Parses 64 hex digits, either case.
    pub fn parse(text: &str) -> Option<Self> {
        if text.len() != 64 {
            return None;
        }
        let mut bytes = [0u8; 32];
        let (pairs, _) = text.as_bytes().as_chunks::<2>();
        for (index, pair) in pairs.iter().enumerate() {
            let high = hex_digit(pair[0])?;
            let low = hex_digit(pair[1])?;
            bytes[index] = high << 4 | low;
        }
        Some(Self(bytes))
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

impl fmt::Display for Sha256Digest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(formatter, "{byte:02x}")?;
        }
        Ok(())
    }
}

impl fmt::Debug for Sha256Digest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "sha256:{self}")
    }
}

/// One downloadable file of a release.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Artifact {
    pub kind: ArtifactKind,
    pub arch: Arch,
    pub url: String,
    pub sha256: Sha256Digest,
    pub size: u64,
}

/// A release, as the pipeline publishes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseManifest {
    pub version: Version,
    /// Where the release's notes are, when the release has them.
    pub notes_url: Option<String>,
    pub artifacts: Vec<Artifact>,
}

impl ReleaseManifest {
    /// The artifact this build would install: that kind, for this architecture.
    pub fn artifact_for(&self, kind: ArtifactKind, arch: Arch) -> Option<&Artifact> {
        self.artifacts
            .iter()
            .find(|artifact| artifact.kind == kind && artifact.arch == arch)
    }

    /// Parses and validates a manifest body.
    pub fn parse(body: &[u8]) -> Result<Self, ManifestError> {
        let value: Value = serde_json::from_slice(body)
            .map_err(|error| ManifestError::NotJson(error.to_string()))?;
        let object = value
            .as_object()
            .ok_or(ManifestError::Shape("the manifest is not a JSON object"))?;

        let version_text = object
            .get("version")
            .ok_or(ManifestError::Missing("version"))?
            .as_str()
            .ok_or(ManifestError::Field("version", "is not a string"))?;
        let version = parse_version(version_text).map_err(|error| ManifestError::BadVersion {
            text: error.text,
            message: error.message,
        })?;

        let notes_url = match object.get("notes_url") {
            None | Some(Value::Null) => None,
            Some(value) => {
                let text = value
                    .as_str()
                    .ok_or(ManifestError::Field("notes_url", "is not a string"))?;
                Some(trusted_url(text, "notes_url")?.to_string())
            }
        };

        let entries = object
            .get("artifacts")
            .ok_or(ManifestError::Missing("artifacts"))?
            .as_array()
            .ok_or(ManifestError::Field("artifacts", "is not an array"))?;

        let mut artifacts: Vec<Artifact> = Vec::new();
        for entry in entries {
            let Some(artifact) = parse_artifact(entry)? else {
                continue;
            };
            if artifacts
                .iter()
                .any(|known| known.kind == artifact.kind && known.arch == artifact.arch)
            {
                return Err(ManifestError::Field(
                    "artifacts",
                    "names the same kind and architecture twice",
                ));
            }
            artifacts.push(artifact);
        }
        Ok(Self {
            version,
            notes_url,
            artifacts,
        })
    }
}

/// One entry. `None` when its kind or architecture isn't for this build, which is not an error:
/// the entry is skipped before its other fields matter.
fn parse_artifact(entry: &Value) -> Result<Option<Artifact>, ManifestError> {
    let object = entry
        .as_object()
        .ok_or(ManifestError::Field("artifacts[]", "is not an object"))?;
    let kind_text = object
        .get("kind")
        .ok_or(ManifestError::Missing("artifacts[].kind"))?
        .as_str()
        .ok_or(ManifestError::Field("artifacts[].kind", "is not a string"))?;
    let Some(kind) = ArtifactKind::parse(kind_text) else {
        return Ok(None);
    };
    let arch_text = object
        .get("arch")
        .ok_or(ManifestError::Missing("artifacts[].arch"))?
        .as_str()
        .ok_or(ManifestError::Field("artifacts[].arch", "is not a string"))?;
    let Some(arch) = Arch::parse(arch_text) else {
        return Ok(None);
    };

    let url = object
        .get("url")
        .ok_or(ManifestError::Missing("artifacts[].url"))?
        .as_str()
        .ok_or(ManifestError::Field("artifacts[].url", "is not a string"))?;
    let url = trusted_url(url, "artifacts[].url")?.to_string();

    let sha256_text = object
        .get("sha256")
        .ok_or(ManifestError::Missing("artifacts[].sha256"))?
        .as_str()
        .ok_or(ManifestError::Field(
            "artifacts[].sha256",
            "is not a string",
        ))?;
    let sha256 = Sha256Digest::parse(sha256_text).ok_or(ManifestError::Field(
        "artifacts[].sha256",
        "is not 64 hex digits",
    ))?;

    let size = object
        .get("size")
        .ok_or(ManifestError::Missing("artifacts[].size"))?
        .as_u64()
        .ok_or(ManifestError::Field(
            "artifacts[].size",
            "is not a positive integer",
        ))?;
    if size == 0 {
        return Err(ManifestError::Field("artifacts[].size", "is zero"));
    }
    if size > MAX_ARTIFACT_SIZE {
        return Err(ManifestError::Field("artifacts[].size", "is over 512 MiB"));
    }

    Ok(Some(Artifact {
        kind,
        arch,
        url,
        sha256,
        size,
    }))
}

/// A URL the manifest may point at: `https`, or `http` to a loopback host (tests and rigs serve
/// their manifest that way). Credentials in a release URL are refused: the user should never be
/// asked to trust a URL that carries a password.
fn trusted_url(text: &str, field: &'static str) -> Result<Url, ManifestError> {
    let url = Url::parse(text).map_err(|error| ManifestError::BadUrl {
        field,
        url: text.to_owned(),
        message: error.to_string(),
    })?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ManifestError::BadUrl {
            field,
            url: text.to_owned(),
            message: "has a user name or password".into(),
        });
    }
    if !is_trusted_url(&url) {
        return Err(ManifestError::BadUrl {
            field,
            url: text.to_owned(),
            message: "is not https (only a loopback address may be plain http)".into(),
        });
    }
    Ok(url)
}

/// Whether a feed URL may be fetched: the same rule as an artifact's, plus no credentials.
/// Used by the app on the feed it was built with (or given in its environment) before starting
/// the updater at all.
pub fn feed_url_is_trusted(text: &str) -> bool {
    Url::parse(text).is_ok_and(|url| {
        is_trusted_url(&url) && url.username().is_empty() && url.password().is_none()
    })
}

/// Whether a URL may be fetched: `https`, or plain `http` to a loopback address.
pub fn is_trusted_url(url: &Url) -> bool {
    match url.scheme() {
        "https" => true,
        "http" => is_loopback(url),
        _ => false,
    }
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(name)) => name.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

/// Why a manifest isn't one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestError {
    NotJson(String),
    /// The document isn't an object.
    Shape(&'static str),
    Missing(&'static str),
    Field(&'static str, &'static str),
    BadVersion {
        text: String,
        message: String,
    },
    BadUrl {
        field: &'static str,
        url: String,
        message: String,
    },
}

impl fmt::Display for ManifestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotJson(message) => {
                write!(formatter, "the release manifest is not JSON: {message}")
            }
            Self::Shape(message) => write!(formatter, "{message}"),
            Self::Missing(field) => write!(formatter, "the release manifest has no {field}"),
            Self::Field(field, message) => write!(formatter, "{field} {message} in the manifest"),
            Self::BadVersion { text, message } => {
                write!(
                    formatter,
                    "the manifest's version {text:?} is not one: {message}"
                )
            }
            Self::BadUrl {
                field,
                url,
                message,
            } => write!(formatter, "{field} {url:?} {message}"),
        }
    }
}

impl std::error::Error for ManifestError {}

/// The seam a signed manifest would be verified at.
///
/// Today trust is the transport (HTTPS, or loopback HTTP in a test) plus the SHA-256 the manifest
/// names for the artifact, which is electron-updater's model with the GitHub provider. A signature
/// (a minisign signature or a detached OpenPGP one, published next to the manifest) would be
/// verified **here**, against `body` exactly as received and the URL it came from, before
/// [`ReleaseManifest::parse`] trusts a single field. Nothing is implemented, and no key is
/// invented: a signed release feed is a later decision, recorded in `docs/packaging.md`.
pub fn verify_signature(_body: &[u8], _manifest_url: &str) -> Result<(), ManifestError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIGEST: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn document(version: &str, artifacts: &str) -> String {
        format!(r#"{{"version": "{version}", "artifacts": [{artifacts}]}}"#)
    }

    fn artifact(kind: &str, arch: &str, url: &str, sha256: &str, size: u64) -> String {
        format!(
            r#"{{"kind": "{kind}", "arch": "{arch}", "url": "{url}", "sha256": "{sha256}", "size": {size}}}"#
        )
    }

    fn good(kind: &str, arch: &str) -> String {
        artifact(
            kind,
            arch,
            "https://example.org/Semaphore-Chat-Native-1.4.0-x86_64.AppImage",
            DIGEST,
            30_345_720,
        )
    }

    #[test]
    fn parses_a_full_document() {
        let body = r#"{
            "version": "1.4.0",
            "notes_url": "https://github.com/semaphore-chat/semaphore-chat/releases/tag/v1.4.0",
            "artifacts": [
                {"kind": "appimage", "arch": "x86_64",
                 "url": "https://example.org/a.AppImage",
                 "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
                 "size": 30345720},
                {"kind": "deb", "arch": "x86_64",
                 "url": "https://example.org/a.deb",
                 "sha256": "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08",
                 "size": 22755076}
            ]
        }"#;
        let manifest = ReleaseManifest::parse(body.as_bytes()).unwrap();
        assert_eq!(manifest.version, Version::new(1, 4, 0));
        assert_eq!(
            manifest.notes_url.as_deref(),
            Some("https://github.com/semaphore-chat/semaphore-chat/releases/tag/v1.4.0")
        );
        assert_eq!(manifest.artifacts.len(), 2);
        let appimage = manifest
            .artifact_for(ArtifactKind::AppImage, Arch::X86_64)
            .unwrap();
        assert_eq!(appimage.size, 30_345_720);
        assert_eq!(appimage.sha256.to_string(), DIGEST);
        assert!(
            manifest
                .artifact_for(ArtifactKind::Rpm, Arch::X86_64)
                .is_none()
        );
    }

    #[test]
    fn notes_are_optional() {
        let manifest =
            ReleaseManifest::parse(document("1.4.0", &good("appimage", "x86_64")).as_bytes())
                .unwrap();
        assert_eq!(manifest.notes_url, None);
    }

    #[test]
    fn another_kind_or_architecture_is_skipped() {
        let artifacts = [
            artifact(
                "pacman",
                "x86_64",
                "https://example.org/a.pkg.tar.zst",
                DIGEST,
                1,
            ),
            artifact(
                "appimage",
                "riscv64",
                "https://example.org/a.AppImage",
                DIGEST,
                1,
            ),
            good("rpm", "x86_64"),
        ]
        .join(",");
        let manifest = ReleaseManifest::parse(document("1.4.0", &artifacts).as_bytes()).unwrap();
        assert_eq!(manifest.artifacts.len(), 1);
        assert_eq!(manifest.artifacts[0].kind, ArtifactKind::Rpm);
    }

    /// A kind this build doesn't know is skipped before its other fields are looked at.
    #[test]
    fn an_unknown_kind_may_lack_every_other_field() {
        let manifest = ReleaseManifest::parse(
            document("1.4.0", r#"{"kind": "flatpak", "whatever": true}"#).as_bytes(),
        )
        .unwrap();
        assert!(manifest.artifacts.is_empty());
    }

    #[test]
    fn rejects_a_document_that_is_not_one() {
        assert!(matches!(
            ReleaseManifest::parse(b"[]"),
            Err(ManifestError::Shape(_))
        ));
        assert!(matches!(
            ReleaseManifest::parse(b"not json"),
            Err(ManifestError::NotJson(_))
        ));
        assert_eq!(
            ReleaseManifest::parse(br#"{"artifacts": []}"#).unwrap_err(),
            ManifestError::Missing("version")
        );
        assert_eq!(
            ReleaseManifest::parse(br#"{"version": "1.4.0"}"#).unwrap_err(),
            ManifestError::Missing("artifacts")
        );
        assert_eq!(
            ReleaseManifest::parse(br#"{"version": 140, "artifacts": []}"#).unwrap_err(),
            ManifestError::Field("version", "is not a string")
        );
        assert!(matches!(
            ReleaseManifest::parse(document("latest", "").as_bytes()),
            Err(ManifestError::BadVersion { text, .. }) if text == "latest"
        ));
        assert_eq!(
            ReleaseManifest::parse(document("1.4.0", r#"{"kind": "appimage"}"#).as_bytes())
                .unwrap_err(),
            ManifestError::Missing("artifacts[].arch")
        );
        assert_eq!(
            ReleaseManifest::parse(document("1.4.0", "[7]").as_bytes()).unwrap_err(),
            ManifestError::Field("artifacts[]", "is not an object")
        );
    }

    #[test]
    fn rejects_an_artifact_without_a_field_it_needs() {
        for missing in ["url", "sha256", "size"] {
            let mut value: Value = serde_json::from_str(&good("appimage", "x86_64")).unwrap();
            value.as_object_mut().unwrap().remove(missing);
            let body = document("1.4.0", &value.to_string());
            match ReleaseManifest::parse(body.as_bytes()) {
                Err(ManifestError::Missing(field)) => {
                    assert!(field.ends_with(missing), "{field} for {missing}")
                }
                other => panic!("{missing} missing should be refused: {other:?}"),
            }
        }
    }

    #[test]
    fn refuses_urls_that_are_not_trusted() {
        for url in [
            "http://example.org/a.AppImage",
            "ftp://example.org/a.AppImage",
            "file:///tmp/a.AppImage",
            "https://user:secret@example.org/a.AppImage",
            "/relative/a.AppImage",
            "javascript:alert(1)",
        ] {
            let body = document("1.4.0", &artifact("appimage", "x86_64", url, DIGEST, 1));
            assert!(
                matches!(
                    ReleaseManifest::parse(body.as_bytes()),
                    Err(ManifestError::BadUrl { .. })
                ),
                "{url} should be refused"
            );
        }
    }

    #[test]
    fn loopback_http_is_how_tests_serve_a_manifest() {
        for url in [
            "http://127.0.0.1:3999/a.AppImage",
            "http://localhost:3999/a.AppImage",
            "http://[::1]:3999/a.AppImage",
        ] {
            let body = document("1.4.0", &artifact("appimage", "x86_64", url, DIGEST, 1));
            assert!(
                ReleaseManifest::parse(body.as_bytes()).is_ok(),
                "{url} should be accepted"
            );
        }
    }

    #[test]
    fn refuses_absurd_sizes() {
        for size in [0, MAX_ARTIFACT_SIZE + 1, u64::MAX] {
            let body = document(
                "1.4.0",
                &artifact(
                    "appimage",
                    "x86_64",
                    "https://example.org/a.AppImage",
                    DIGEST,
                    size,
                ),
            );
            assert!(
                matches!(
                    ReleaseManifest::parse(body.as_bytes()),
                    Err(ManifestError::Field("artifacts[].size", _))
                ),
                "size {size} should be refused"
            );
        }
        let top = document(
            "1.4.0",
            &artifact(
                "appimage",
                "x86_64",
                "https://example.org/a.AppImage",
                DIGEST,
                MAX_ARTIFACT_SIZE,
            ),
        );
        assert!(ReleaseManifest::parse(top.as_bytes()).is_ok());
    }

    #[test]
    fn refuses_a_bad_digest() {
        let digests = [
            String::new(),
            "9f86d0".to_owned(),
            "z".repeat(64),
            "9".repeat(63),
            "9".repeat(65),
        ];
        for digest in digests {
            let body = document(
                "1.4.0",
                &artifact(
                    "appimage",
                    "x86_64",
                    "https://example.org/a.AppImage",
                    &digest,
                    1,
                ),
            );
            assert!(
                matches!(
                    ReleaseManifest::parse(body.as_bytes()),
                    Err(ManifestError::Field("artifacts[].sha256", _))
                ),
                "{digest:?} should be refused"
            );
        }
    }

    #[test]
    fn refuses_two_artifacts_of_one_kind() {
        let artifacts = [good("appimage", "x86_64"), good("appimage", "x86_64")].join(",");
        assert!(matches!(
            ReleaseManifest::parse(document("1.4.0", &artifacts).as_bytes()),
            Err(ManifestError::Field("artifacts", _))
        ));
    }

    #[test]
    fn a_notes_url_must_be_trusted_too() {
        let body =
            r#"{"version": "1.4.0", "notes_url": "http://example.org/notes", "artifacts": []}"#;
        assert!(matches!(
            ReleaseManifest::parse(body.as_bytes()),
            Err(ManifestError::BadUrl {
                field: "notes_url",
                ..
            })
        ));
    }

    #[test]
    fn a_feed_url_is_held_to_the_same_rule() {
        for trusted in [
            "https://example.org/latest.json",
            "http://127.0.0.1:3999/latest.json",
        ] {
            assert!(feed_url_is_trusted(trusted), "{trusted}");
        }
        for refused in [
            "http://example.org/latest.json",
            "ftp://example.org/latest.json",
            "https://user:pw@example.org/latest.json",
            "not a url",
        ] {
            assert!(!feed_url_is_trusted(refused), "{refused}");
        }
    }

    #[test]
    fn digests_print_lowercase_and_parse_either_case() {
        let lower = Sha256Digest::parse(DIGEST).unwrap();
        let upper = Sha256Digest::parse(&DIGEST.to_uppercase()).unwrap();
        assert_eq!(lower, upper);
        assert_eq!(lower.to_string(), DIGEST);
    }
}
