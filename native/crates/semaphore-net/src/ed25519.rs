//! Ed25519 signature verification, for the update feed's signature.
//!
//! The policy (which keys, when a signature is required, where it is fetched) lives in
//! `semaphore_platform_desktop::update::signature`; this is only the primitive it is handed, so
//! the crate that builds ring is the one that calls it. See `docs/packaging.md`, "Auto-update".

use ring::signature::{ED25519, UnparsedPublicKey};

/// Whether `signature` is `public_key`'s Ed25519 signature of exactly `message`.
///
/// The shape of `semaphore_platform_desktop::update::Ed25519Verify`.
pub fn verify(public_key: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> bool {
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(message, signature)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use semaphore_platform_desktop::update::{
        PublicKey, SignatureCheck, SignatureError, TrustedKeys, verify_signature,
    };

    /// Made by `openssl pkeyutl -sign -rawin` with a throwaway key (only its public half is
    /// committed): the same command the release workflow signs with.
    const MANIFEST: &[u8] = include_bytes!("../../../fixtures/update-signature/latest.json");
    const SIGNATURE: &[u8] = include_bytes!("../../../fixtures/update-signature/latest.json.sig");
    const PUBLIC_PEM: &str = include_str!("../../../fixtures/update-signature/throwaway.pub.pem");
    /// The release key, which did not sign the fixture.
    const RELEASE_PEM: &str = include_str!("../../../packaging/update-signing-key.pub.pem");

    fn check(pem: &str) -> SignatureCheck {
        SignatureCheck::Required(TrustedKeys::new(
            vec![PublicKey::parse(pem).expect("a PEM public key")],
            verify,
        ))
    }

    #[test]
    fn an_openssl_signature_verifies() {
        assert_eq!(
            verify_signature(&check(PUBLIC_PEM), MANIFEST, SIGNATURE),
            Ok(())
        );
    }

    #[test]
    fn any_trusted_key_may_have_signed() {
        let keys = vec![
            PublicKey::parse(RELEASE_PEM).unwrap(),
            PublicKey::parse(PUBLIC_PEM).unwrap(),
        ];
        let rotated = SignatureCheck::Required(TrustedKeys::new(keys, verify));
        assert_eq!(verify_signature(&rotated, MANIFEST, SIGNATURE), Ok(()));
    }

    #[test]
    fn another_key_does_not_verify_it() {
        assert_eq!(
            verify_signature(&check(RELEASE_PEM), MANIFEST, SIGNATURE),
            Err(SignatureError::Mismatch)
        );
    }

    #[test]
    fn one_changed_byte_of_the_manifest_fails() {
        let mut tampered = MANIFEST.to_vec();
        let at = tampered.iter().position(|&byte| byte == b'1').unwrap();
        tampered[at] = b'2';
        assert_eq!(
            verify_signature(&check(PUBLIC_PEM), &tampered, SIGNATURE),
            Err(SignatureError::Mismatch)
        );
        // A trailing newline is a different document too.
        let mut longer = MANIFEST.to_vec();
        longer.push(b'\n');
        assert_eq!(
            verify_signature(&check(PUBLIC_PEM), &longer, SIGNATURE),
            Err(SignatureError::Mismatch)
        );
    }

    #[test]
    fn one_changed_bit_of_the_signature_fails() {
        use base64::Engine as _;
        let engine = base64::engine::general_purpose::STANDARD;
        let mut raw = engine
            .decode(std::str::from_utf8(SIGNATURE).unwrap().trim())
            .unwrap();
        raw[10] ^= 0x01;
        let tampered = engine.encode(&raw);
        assert_eq!(
            verify_signature(&check(PUBLIC_PEM), MANIFEST, tampered.as_bytes()),
            Err(SignatureError::Mismatch)
        );
    }

    #[test]
    fn the_primitive_refuses_a_zero_signature() {
        let key = PublicKey::parse(PUBLIC_PEM).unwrap();
        assert!(!verify(key.as_bytes(), MANIFEST, &[0; 64]));
    }
}
