#!/usr/bin/env bash
# Sign the release manifest, or verify its signature: the exact commands the release workflow
# runs, so scripts/test-release-assembly.sh tests what CI does.
#
#   scripts/manifest-signature.sh sign   <private-key.pem> <latest.json>   # writes <latest.json>.sig
#   scripts/manifest-signature.sh verify <public-key.pem>  <latest.json> [<signature file>]
#
# The signature is a detached Ed25519 signature over the manifest's exact bytes, base64 on one
# line (no newline), which the updater checks before it reads the manifest
# (crates/semaphore-platform-desktop/src/update/signature.rs). Keys are PEM as written by
# `openssl genpkey -algorithm ed25519` (PKCS#8) and `openssl pkey -pubout`. Needs OpenSSL 3
# (`pkeyutl -rawin`). Nothing here prints a key.
set -euo pipefail

die() { echo "manifest-signature: $*" >&2; exit 1; }

[ $# -ge 3 ] || die "usage: $0 sign <private-key.pem> <latest.json> | verify <public-key.pem> <latest.json> [<sig>]"
mode="$1" key="$2" manifest="$3"
[ -f "$key" ] || die "no key file at $key"
[ -f "$manifest" ] || die "no manifest at $manifest"

case "$mode" in
  sign)
    out="$manifest.sig"
    tmp="$(mktemp "$out.XXXXXX")"
    trap 'rm -f "$tmp"' EXIT
    openssl pkeyutl -sign -inkey "$key" -rawin -in "$manifest" | base64 -w0 >"$tmp"
    # 64 bytes of signature are 88 base64 characters.
    [ "$(wc -c <"$tmp")" -eq 88 ] || die "the signature is not 88 base64 characters: is $key an Ed25519 key?"
    mv "$tmp" "$out"
    trap - EXIT
    echo "manifest-signature: signed $manifest -> $out"
    ;;
  verify)
    sig="${4:-$manifest.sig}"
    [ -f "$sig" ] || die "no signature at $sig"
    raw="$(mktemp)"
    trap 'rm -f "$raw"' EXIT
    base64 -d "$sig" >"$raw" 2>/dev/null || die "$sig is not base64"
    [ "$(wc -c <"$raw")" -eq 64 ] || die "$sig does not hold a 64-byte Ed25519 signature"
    if ! openssl pkeyutl -verify -pubin -inkey "$key" -rawin -in "$manifest" -sigfile "$raw" >/dev/null 2>&1; then
      die "$sig is NOT a signature of $manifest by $key"
    fi
    echo "manifest-signature: $sig verifies $manifest with $key"
    ;;
  *) die "unknown mode '$mode' (sign or verify)" ;;
esac
