//! The update feed's signature: which keys a build trusts, when a signature is required, and the
//! check itself.
//!
//! **Format.** A release publishes `latest.json` and, next to it, `latest.json.sig`: one line of
//! base64, the detached Ed25519 signature of the manifest's exact bytes, as
//! `openssl pkeyutl -sign -inkey <key> -rawin -in latest.json | base64 -w0` writes it. The
//! signature's URL is the manifest's with `.sig` appended to the path ([`signature_url`]). The
//! updater verifies the bytes it received **before** [`ReleaseManifest::parse`] reads a field,
//! so nothing a forged manifest says is acted on.
//!
//! **When it is required** ([`signature_policy`]; the app decides the inputs, nothing here reads
//! the environment):
//!
//! | Feed | Override key (`SEMAPHORE_UPDATE_PUBLIC_KEY`) | Check |
//! |---|---|---|
//! | the build's own feed | ignored | required, against the build's trusted keys |
//! | an override, https | not set | required, against the build's trusted keys |
//! | an override, https | set | required, against that key only |
//! | an override, loopback | not set | none (the rig and tests: transport plus hash) |
//! | an override, loopback | set | required, against that key only |
//! | an override, either | set but not a key | updates are off |
//!
//! A missing, malformed or wrong signature fails the check without retry ([`SignatureError`]),
//! and nothing is downloaded.
//!
//! **The primitive is handed in** ([`Ed25519Verify`]): the app passes
//! `semaphore_net::ed25519::verify` (ring). ring compiles C, and this crate's Windows check in the
//! build image has no MSVC headers, so the one crate that already builds ring does the maths.
//!
//! [`ReleaseManifest::parse`]: crate::update::manifest::ReleaseManifest::parse

use crate::update::manifest::is_loopback;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use std::fmt;
use url::Url;

/// The most of a signature file that is read: 1 KiB. The file is 88 characters and a newline.
pub const MAX_SIGNATURE_BYTES: usize = 1024;

/// `true` when `signature` is `public_key`'s Ed25519 signature of exactly `message`.
pub type Ed25519Verify = fn(public_key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool;

/// The DER prefix of an Ed25519 `SubjectPublicKeyInfo` (RFC 8410): what `openssl pkey -pubout`
/// writes, base64'd, between the PEM lines. The 32 key bytes follow it.
const SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

/// An Ed25519 public key: its 32 raw bytes.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct PublicKey([u8; 32]);

impl PublicKey {
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Reads a key written as a PEM `PUBLIC KEY` block (`openssl pkey -pubout`), as the base64
    /// of that block's DER, or as the base64 of the 32 raw bytes. Whitespace around it is
    /// ignored; anything else (another algorithm's key, a private key, a truncated one) is `None`.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let body: String = if text.starts_with("-----") {
            let mut lines = text.lines().map(str::trim);
            if lines.next()? != "-----BEGIN PUBLIC KEY-----" {
                return None;
            }
            let mut body = String::new();
            let mut ended = false;
            for line in lines {
                if line == "-----END PUBLIC KEY-----" {
                    ended = true;
                    break;
                }
                body.push_str(line);
            }
            if !ended {
                return None;
            }
            body
        } else {
            text.split_ascii_whitespace().collect()
        };
        let bytes = STANDARD.decode(body).ok()?;
        let raw: &[u8] = match bytes.len() {
            32 => &bytes,
            44 if bytes[..12] == SPKI_PREFIX => &bytes[12..],
            _ => return None,
        };
        Some(Self(raw.try_into().ok()?))
    }
}

impl fmt::Debug for PublicKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "ed25519:{}", STANDARD.encode(self.0))
    }
}

/// The keys a signature may be made with, and the function that checks one.
#[derive(Clone)]
pub struct TrustedKeys {
    keys: Vec<PublicKey>,
    verify: Ed25519Verify,
}

impl TrustedKeys {
    pub fn new(keys: Vec<PublicKey>, verify: Ed25519Verify) -> Self {
        Self { keys, verify }
    }

    pub fn keys(&self) -> &[PublicKey] {
        &self.keys
    }
}

impl fmt::Debug for TrustedKeys {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedKeys")
            .field("keys", &self.keys)
            .finish_non_exhaustive()
    }
}

impl PartialEq for TrustedKeys {
    fn eq(&self, other: &Self) -> bool {
        self.keys == other.keys && std::ptr::fn_addr_eq(self.verify, other.verify)
    }
}

impl Eq for TrustedKeys {}

/// Whether the feed's signature is checked, and against what.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureCheck {
    /// No signature is fetched: a loopback feed with no key given (the rig, tests).
    Off,
    /// `latest.json.sig` must exist and verify against one of these keys.
    Required(TrustedKeys),
}

/// Where the feed URL came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedSource {
    /// Compiled in (`SEMAPHORE_UPDATE_MANIFEST_URL` at build time).
    BuiltIn,
    /// Given at run time (`SEMAPHORE_UPDATE_URL`): rigs and testing.
    Override,
}

/// The override key isn't an Ed25519 public key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BadOverrideKey;

impl fmt::Display for BadOverrideKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "the update public key is not an Ed25519 public key"
        )
    }
}

impl std::error::Error for BadOverrideKey {}

/// The table in the module documentation. `override_key` is the text of the override key's
/// variable (blank counts as unset); `built_in` is the build's trusted keys.
pub fn signature_policy(
    source: FeedSource,
    feed_url: &str,
    override_key: Option<&str>,
    built_in: &[PublicKey],
    verify: Ed25519Verify,
) -> Result<SignatureCheck, BadOverrideKey> {
    let built_in = || SignatureCheck::Required(TrustedKeys::new(built_in.to_vec(), verify));
    let override_key = override_key.map(str::trim).filter(|text| !text.is_empty());
    match source {
        FeedSource::BuiltIn => Ok(built_in()),
        FeedSource::Override => match override_key {
            Some(text) => {
                let key = PublicKey::parse(text).ok_or(BadOverrideKey)?;
                Ok(SignatureCheck::Required(TrustedKeys::new(
                    vec![key],
                    verify,
                )))
            }
            None if Url::parse(feed_url).is_ok_and(|url| is_loopback(&url)) => {
                Ok(SignatureCheck::Off)
            }
            None => Ok(built_in()),
        },
    }
}

/// Where a manifest's signature is: the same URL with `.sig` appended to the path
/// (`…/latest.json` → `…/latest.json.sig`). `None` for a URL that names a directory.
pub fn signature_url(manifest_url: &str) -> Option<String> {
    let mut url = Url::parse(manifest_url).ok()?;
    let path = url.path().to_owned();
    if path.is_empty() || path.ends_with('/') {
        return None;
    }
    url.set_path(&format!("{path}.sig"));
    Some(url.into())
}

/// Why a feed's signature was refused. None of these is retried: the next scheduled check reads
/// the feed again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignatureError {
    /// The feed has no `latest.json.sig` (404 or 410), or its URL has no file name.
    Missing,
    /// The file isn't one line of base64 holding 64 bytes, or is over [`MAX_SIGNATURE_BYTES`].
    Malformed(&'static str),
    /// A well-formed signature that no trusted key made, or of other bytes.
    Mismatch,
}

impl fmt::Display for SignatureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing => write!(
                formatter,
                "the update feed is not signed (no latest.json.sig)"
            ),
            Self::Malformed(why) => write!(formatter, "the update feed's signature {why}"),
            Self::Mismatch => write!(
                formatter,
                "the update feed's signature does not match a key this build trusts"
            ),
        }
    }
}

impl std::error::Error for SignatureError {}

/// Checks `signature_file` (the bytes of `latest.json.sig`) against `body` (the manifest exactly
/// as received). Always `Ok` when the check is [`SignatureCheck::Off`].
pub fn verify_signature(
    check: &SignatureCheck,
    body: &[u8],
    signature_file: &[u8],
) -> Result<(), SignatureError> {
    let SignatureCheck::Required(trusted) = check else {
        return Ok(());
    };
    if signature_file.len() > MAX_SIGNATURE_BYTES {
        return Err(SignatureError::Malformed("is larger than 1 KiB"));
    }
    let text = std::str::from_utf8(signature_file)
        .map_err(|_| SignatureError::Malformed("is not text"))?
        .trim_ascii();
    if text.is_empty() {
        return Err(SignatureError::Malformed("is empty"));
    }
    let raw = STANDARD
        .decode(text)
        .map_err(|_| SignatureError::Malformed("is not base64"))?;
    let signature: [u8; 64] = raw
        .try_into()
        .map_err(|_| SignatureError::Malformed("is not 64 bytes (an Ed25519 signature)"))?;
    if trusted
        .keys
        .iter()
        .any(|key| (trusted.verify)(key.as_bytes(), body, &signature))
    {
        Ok(())
    } else {
        Err(SignatureError::Mismatch)
    }
}

/// A stand-in for Ed25519 in tests that can't link ring (this crate's Windows check): the
/// "signature" is two SHA-256 digests over the key and the message, so it is deterministic,
/// bound to both, and wrong for any other key or byte.
#[cfg(test)]
pub(crate) mod fake {
    use sha2::{Digest as _, Sha256};

    pub fn sign(key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        let mut signature = [0u8; 64];
        let first = Sha256::new()
            .chain_update(key)
            .chain_update(message)
            .finalize();
        let second = Sha256::new()
            .chain_update(message)
            .chain_update(key)
            .finalize();
        signature[..32].copy_from_slice(&first);
        signature[32..].copy_from_slice(&second);
        signature
    }

    pub fn verify(key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool {
        sign(key, message) == *signature
    }

    /// `sign`'s output as the `.sig` file carries it.
    pub fn signature_file(key: &[u8; 32], message: &[u8]) -> String {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(sign(key, message))
    }

    pub fn other_verify(_: &[u8; 32], _: &[u8], _: &[u8; 64]) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY_A: PublicKey = PublicKey::from_bytes([7; 32]);
    const KEY_B: PublicKey = PublicKey::from_bytes([9; 32]);
    /// The release key, as the owner generated it (docs/packaging.md).
    const RELEASE_PEM: &str = "-----BEGIN PUBLIC KEY-----\n\
        MCowBQYDK2VwAyEAnpKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbKk=\n\
        -----END PUBLIC KEY-----\n";
    const RELEASE_RAW: &str = "npKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbKk=";

    fn required(keys: &[PublicKey]) -> SignatureCheck {
        SignatureCheck::Required(TrustedKeys::new(keys.to_vec(), fake::verify))
    }

    // ----- keys ---------------------------------------------------------------------------

    #[test]
    fn a_key_parses_as_pem_der_or_raw() {
        let from_pem = PublicKey::parse(RELEASE_PEM).unwrap();
        let from_raw = PublicKey::parse(RELEASE_RAW).unwrap();
        let from_der =
            PublicKey::parse("MCowBQYDK2VwAyEAnpKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbKk=")
                .unwrap();
        assert_eq!(from_pem, from_raw);
        assert_eq!(from_der, from_raw);
        assert_eq!(from_raw.as_bytes()[..4], [0x9e, 0x92, 0x86, 0x23]);
        // Indented, CRLF, or with the base64 wrapped: the same key.
        let messy = "  -----BEGIN PUBLIC KEY-----\r\n  MCowBQYDK2VwAyEAnpKGI6KciDhy\r\n  \
            J24dpEeOaehvJuJv8TeZCnzch3tEbKk=\r\n  -----END PUBLIC KEY-----  ";
        assert_eq!(PublicKey::parse(messy), Some(from_raw));
        assert_eq!(format!("{from_raw:?}"), format!("ed25519:{RELEASE_RAW}"));
    }

    #[test]
    fn anything_else_is_not_a_key() {
        for text in [
            "",
            "   ",
            "not base64!",
            // 31 bytes.
            "npKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbA==",
            // 33 bytes.
            "npKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbKkA",
            // A 44-byte DER whose prefix is another algorithm's (X25519: 1.3.101.110).
            "MCowBQYDK2VuAyEAnpKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbKk=",
            // A private key's armour.
            "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----",
            // No end line.
            "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAnpKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbKk=",
            // Base64 that isn't standard padding.
            "npKGI6KciDhyJ24dpEeOaehvJuJv8TeZCnzch3tEbKk",
        ] {
            assert_eq!(PublicKey::parse(text), None, "{text:?}");
        }
    }

    // ----- the check ----------------------------------------------------------------------

    #[test]
    fn a_good_signature_verifies_and_off_needs_none() {
        let body = br#"{"version": "1.0.0", "artifacts": []}"#;
        let file = fake::signature_file(KEY_A.as_bytes(), body);
        assert_eq!(
            verify_signature(&required(&[KEY_A]), body, file.as_bytes()),
            Ok(())
        );
        // With the trailing newline `base64` and editors add.
        let with_newline = format!("{file}\n");
        assert_eq!(
            verify_signature(&required(&[KEY_A]), body, with_newline.as_bytes()),
            Ok(())
        );
        assert_eq!(verify_signature(&SignatureCheck::Off, body, b""), Ok(()));
        assert_eq!(
            verify_signature(&SignatureCheck::Off, body, b"junk"),
            Ok(())
        );
    }

    /// Rotation: a build trusts every key in its list, so a release signed by the next key
    /// verifies on a build that ships both.
    #[test]
    fn any_listed_key_may_sign() {
        let body = b"{}";
        let by_b = fake::signature_file(KEY_B.as_bytes(), body);
        assert_eq!(
            verify_signature(&required(&[KEY_A, KEY_B]), body, by_b.as_bytes()),
            Ok(())
        );
        assert_eq!(
            verify_signature(&required(&[KEY_A]), body, by_b.as_bytes()),
            Err(SignatureError::Mismatch)
        );
        assert_eq!(
            verify_signature(&required(&[]), body, by_b.as_bytes()),
            Err(SignatureError::Mismatch)
        );
    }

    #[test]
    fn other_bytes_or_a_flipped_bit_do_not_verify() {
        let body = br#"{"version": "1.0.0"}"#;
        let file = fake::signature_file(KEY_A.as_bytes(), body);
        assert_eq!(
            verify_signature(
                &required(&[KEY_A]),
                br#"{"version": "9.0.0"}"#,
                file.as_bytes()
            ),
            Err(SignatureError::Mismatch)
        );
        let mut raw = fake::sign(KEY_A.as_bytes(), body);
        raw[63] ^= 0x80;
        let flipped = STANDARD.encode(raw);
        assert_eq!(
            verify_signature(&required(&[KEY_A]), body, flipped.as_bytes()),
            Err(SignatureError::Mismatch)
        );
    }

    #[test]
    fn a_malformed_file_is_refused_before_any_key_is_tried() {
        let check = SignatureCheck::Required(TrustedKeys::new(vec![KEY_A], fake::other_verify));
        let short = STANDARD.encode([0u8; 63]);
        let long = STANDARD.encode([0u8; 65]);
        let cases: [(&[u8], &str); 7] = [
            (b"", "is empty"),
            (b" \n", "is empty"),
            (b"\xff\xfe", "is not text"),
            (b"not base64 at all!", "is not base64"),
            (short.as_bytes(), "is not 64 bytes (an Ed25519 signature)"),
            (long.as_bytes(), "is not 64 bytes (an Ed25519 signature)"),
            // Two signatures on two lines is not one signature.
            (b"AAAA\nAAAA", "is not base64"),
        ];
        for (file, why) in cases {
            assert_eq!(
                verify_signature(&check, b"{}", file),
                Err(SignatureError::Malformed(why)),
                "{file:?}"
            );
        }
        let huge = vec![b'A'; MAX_SIGNATURE_BYTES + 1];
        assert_eq!(
            verify_signature(&check, b"{}", &huge),
            Err(SignatureError::Malformed("is larger than 1 KiB"))
        );
    }

    #[test]
    fn errors_say_what_happened() {
        assert_eq!(
            SignatureError::Missing.to_string(),
            "the update feed is not signed (no latest.json.sig)"
        );
        assert_eq!(
            SignatureError::Malformed("is not base64").to_string(),
            "the update feed's signature is not base64"
        );
        assert_eq!(
            SignatureError::Mismatch.to_string(),
            "the update feed's signature does not match a key this build trusts"
        );
    }

    // ----- where it is --------------------------------------------------------------------

    #[test]
    fn the_signature_sits_next_to_the_manifest() {
        assert_eq!(
            signature_url(
                "https://github.com/semaphore-chat/semaphore-chat/releases/download/native-preview-feed/latest.json"
            )
            .as_deref(),
            Some(
                "https://github.com/semaphore-chat/semaphore-chat/releases/download/native-preview-feed/latest.json.sig"
            )
        );
        assert_eq!(
            signature_url("http://127.0.0.1:3999/latest.json").as_deref(),
            Some("http://127.0.0.1:3999/latest.json.sig")
        );
        assert_eq!(
            signature_url("https://example.org/feed/stable.json?channel=preview").as_deref(),
            Some("https://example.org/feed/stable.json.sig?channel=preview")
        );
        assert_eq!(signature_url("https://example.org/"), None);
        assert_eq!(signature_url("https://example.org/feed/"), None);
        assert_eq!(signature_url("not a url"), None);
    }

    // ----- the policy: every cell of the table ----------------------------------------------

    const HTTPS: &str = "https://example.org/latest.json";
    const LOOPBACK: &str = "http://127.0.0.1:3999/latest.json";

    fn policy(
        source: FeedSource,
        url: &str,
        key: Option<&str>,
    ) -> Result<SignatureCheck, BadOverrideKey> {
        signature_policy(source, url, key, &[KEY_A, KEY_B], fake::verify)
    }

    #[test]
    fn the_builds_own_feed_always_needs_the_builds_keys() {
        let expected = Ok(required(&[KEY_A, KEY_B]));
        for url in [HTTPS, LOOPBACK, "http://localhost/latest.json"] {
            // The override key is ignored for the built-in feed, valid or not.
            for key in [None, Some(RELEASE_RAW), Some("not a key"), Some("")] {
                assert_eq!(
                    policy(FeedSource::BuiltIn, url, key),
                    expected,
                    "{url} {key:?}"
                );
            }
        }
    }

    #[test]
    fn an_https_override_without_a_key_needs_the_builds_keys() {
        assert_eq!(
            policy(FeedSource::Override, HTTPS, None),
            Ok(required(&[KEY_A, KEY_B]))
        );
        // Blank is unset.
        assert_eq!(
            policy(FeedSource::Override, HTTPS, Some("  ")),
            Ok(required(&[KEY_A, KEY_B]))
        );
    }

    #[test]
    fn an_https_override_with_a_key_needs_that_key_only() {
        let release = PublicKey::parse(RELEASE_RAW).unwrap();
        assert_eq!(
            policy(FeedSource::Override, HTTPS, Some(RELEASE_PEM)),
            Ok(required(&[release]))
        );
    }

    #[test]
    fn a_loopback_override_without_a_key_is_not_checked() {
        for url in [
            LOOPBACK,
            "http://localhost:9/latest.json",
            "http://[::1]:9/latest.json",
            "https://127.0.0.1/latest.json",
        ] {
            assert_eq!(
                policy(FeedSource::Override, url, None),
                Ok(SignatureCheck::Off),
                "{url}"
            );
        }
    }

    #[test]
    fn a_loopback_override_with_a_key_needs_that_key() {
        let release = PublicKey::parse(RELEASE_RAW).unwrap();
        assert_eq!(
            policy(FeedSource::Override, LOOPBACK, Some(RELEASE_RAW)),
            Ok(required(&[release]))
        );
    }

    #[test]
    fn an_override_key_that_is_not_one_turns_updates_off() {
        for url in [HTTPS, LOOPBACK] {
            assert_eq!(
                policy(FeedSource::Override, url, Some("not a key")),
                Err(BadOverrideKey),
                "{url}"
            );
        }
    }

    #[test]
    fn trusted_keys_compare_by_keys_and_function() {
        assert_eq!(required(&[KEY_A]), required(&[KEY_A]));
        assert_ne!(required(&[KEY_A]), required(&[KEY_B]));
        assert_ne!(
            required(&[KEY_A]),
            SignatureCheck::Required(TrustedKeys::new(vec![KEY_A], fake::other_verify))
        );
        assert_ne!(required(&[KEY_A]), SignatureCheck::Off);
        assert_eq!(TrustedKeys::new(vec![KEY_A], fake::verify).keys(), &[KEY_A]);
    }
}
