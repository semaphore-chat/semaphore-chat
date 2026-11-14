#!/usr/bin/env bash
# A local dry run of the native release job, everything that doesn't need the signing secret:
# assemble a release from fixture artifacts, sign latest.json with a THROWAWAY key generated in
# a temporary directory, verify it, validate it with check-manifest.py, and check that a tampered
# manifest, a tampered signature and the wrong key all fail. Also checks the committed Rust test
# fixture verifies with OpenSSL, and that release notes can be written for this checkout.
#
#   scripts/in-image.sh scripts/test-release-assembly.sh
#
# Needs bash, python3, OpenSSL 3 and git (the build image has them). Writes only under a
# temporary directory, which it removes; contacts nothing.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$NATIVE_DIR/scripts"
VERSION=0.10.0
TAG="native-v$VERSION"
REPO=semaphore-chat/semaphore-chat
BASE="https://github.com/$REPO/releases/download/$TAG"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
passed=0
ok() { passed=$((passed + 1)); echo "ok   $*"; }
fail() { echo "FAIL $*" >&2; exit 1; }
# `refuses <what> <command...>`: the command must exit non-zero.
refuses() {
  local what="$1"; shift
  if "$@" >"$work/refused.log" 2>&1; then
    cat "$work/refused.log" >&2
    fail "$what was accepted"
  fi
  ok "$what is refused: $(tail -1 "$work/refused.log")"
}

echo "== fixture artifacts ($VERSION)"
artifacts="$work/artifacts"
mkdir -p "$artifacts"
for name in "Semaphore-Chat-Native-$VERSION-x86_64.AppImage" \
            "semaphore-chat-native_${VERSION}_amd64.deb" \
            "semaphore-chat-native-$VERSION-1.x86_64.rpm" \
            "semaphore-chat-native-$VERSION-windows-x86_64.zip" \
            "Semaphore-Chat-Native-Setup-$VERSION-x64.exe"; do
  head -c "$((4096 + RANDOM))" /dev/urandom >"$artifacts/$name"
done
files=("$artifacts"/*)

echo "== assemble"
release="$work/release"
python3 "$SCRIPTS/assemble-release.py" --version "$VERSION" --tag "$TAG" --repo "$REPO" \
  --out "$release" "${files[@]}"
for name in latest.json SHA256SUMS; do
  [ -s "$release/$name" ] || fail "no $name"
done
( cd "$release" && sha256sum --quiet -c SHA256SUMS ) || fail "SHA256SUMS doesn't match"
[ "$(wc -l <"$release/SHA256SUMS")" -eq 5 ] || fail "SHA256SUMS should list 5 files"
ok "latest.json and SHA256SUMS for 5 artifacts"

assembled=("$release"/*.AppImage "$release"/*.deb "$release"/*.rpm "$release"/*.zip "$release"/*.exe)
python3 "$SCRIPTS/check-manifest.py" --base-url "$BASE" \
  --notes-url "https://github.com/$REPO/releases/tag/$TAG" "$release/latest.json" "${assembled[@]}"
ok "check-manifest.py accepts the assembled manifest against the files"

echo "== what assembly refuses"
refuses "a tag that doesn't match the version" python3 "$SCRIPTS/assemble-release.py" \
  --version "$VERSION" --tag native-v0.10.1 --repo "$REPO" --out "$work/r1" "${files[@]}"
refuses "a pre-release version" python3 "$SCRIPTS/assemble-release.py" \
  --version "$VERSION-rc.1" --tag "native-v$VERSION-rc.1" --repo "$REPO" --out "$work/r2" "${files[@]}"
refuses "a 'v' in the version" python3 "$SCRIPTS/assemble-release.py" \
  --version "v$VERSION" --tag "native-vv$VERSION" --repo "$REPO" --out "$work/r3" "${files[@]}"
cp "$artifacts/semaphore-chat-native_${VERSION}_amd64.deb" "$work/semaphore-chat-native_0.9.0_amd64.deb"
refuses "a package built as another version" python3 "$SCRIPTS/assemble-release.py" \
  --version "$VERSION" --tag "$TAG" --repo "$REPO" --out "$work/r4" \
  "${files[@]/*.deb/$work/semaphore-chat-native_0.9.0_amd64.deb}"
without_exe=()
for file in "${files[@]}"; do [[ "$file" == *.exe ]] || without_exe+=("$file"); done
refuses "a missing Windows installer" python3 "$SCRIPTS/assemble-release.py" \
  --version "$VERSION" --tag "$TAG" --repo "$REPO" --out "$work/r5" "${without_exe[@]}"

echo "== what check-manifest.py refuses"
refuses "a manifest pointing at another release" python3 "$SCRIPTS/check-manifest.py" \
  --base-url "https://github.com/$REPO/releases/download/native-v0.9.0" \
  "$release/latest.json" "${assembled[@]}"
refuses "a manifest missing a file that is published" python3 "$SCRIPTS/check-manifest.py" \
  "$release/latest.json" "${assembled[@]:0:4}"
python3 - "$release/latest.json" "$work/edited.json" <<'EOF'
import json, sys
manifest = json.load(open(sys.argv[1]))
manifest["artifacts"][3]["size"] += 1
json.dump(manifest, open(sys.argv[2], "w"), indent=2)
EOF
refuses "a manifest whose size doesn't match the zip" python3 "$SCRIPTS/check-manifest.py" \
  "$work/edited.json" "${assembled[@]}"

echo "== sign with a throwaway key, verify"
keys="$work/keys"
mkdir -m 700 "$keys"
openssl genpkey -algorithm ed25519 -out "$keys/throwaway.pem" 2>/dev/null
chmod 600 "$keys/throwaway.pem"
openssl pkey -in "$keys/throwaway.pem" -pubout -out "$keys/throwaway.pub.pem"
"$SCRIPTS/manifest-signature.sh" sign "$keys/throwaway.pem" "$release/latest.json"
[ "$(wc -l <"$release/latest.json.sig")" -eq 0 ] || fail "latest.json.sig should be one line, no newline"
"$SCRIPTS/manifest-signature.sh" verify "$keys/throwaway.pub.pem" "$release/latest.json"
ok "a fresh signature verifies"

echo "== tampering"
cp "$release/latest.json" "$work/tampered.json"
sed -i "0,/$VERSION/s//0.10.9/" "$work/tampered.json"
cmp -s "$release/latest.json" "$work/tampered.json" && fail "the tampered manifest is unchanged"
refuses "a tampered manifest" "$SCRIPTS/manifest-signature.sh" verify "$keys/throwaway.pub.pem" \
  "$work/tampered.json" "$release/latest.json.sig"
printf '%s\n' "$(cat "$release/latest.json")" | head -c -1 >"$work/no-newline.json"
refuses "the manifest without its last newline" "$SCRIPTS/manifest-signature.sh" verify \
  "$keys/throwaway.pub.pem" "$work/no-newline.json" "$release/latest.json.sig"
python3 - "$release/latest.json.sig" "$work/flipped.sig" <<'EOF'
import base64, sys
raw = bytearray(base64.b64decode(open(sys.argv[1]).read()))
raw[5] ^= 0x01
open(sys.argv[2], "w").write(base64.b64encode(bytes(raw)).decode())
EOF
refuses "a signature with one bit flipped" "$SCRIPTS/manifest-signature.sh" verify \
  "$keys/throwaway.pub.pem" "$release/latest.json" "$work/flipped.sig"
printf 'not base64!' >"$work/junk.sig"
refuses "a signature that isn't base64" "$SCRIPTS/manifest-signature.sh" verify \
  "$keys/throwaway.pub.pem" "$release/latest.json" "$work/junk.sig"
refuses "the release key, which didn't sign it" "$SCRIPTS/manifest-signature.sh" verify \
  "$NATIVE_DIR/packaging/update-signing-key.pub.pem" "$release/latest.json"
openssl genpkey -algorithm ed448 -out "$keys/ed448.pem" 2>/dev/null
refuses "signing with a key that isn't Ed25519" "$SCRIPTS/manifest-signature.sh" sign \
  "$keys/ed448.pem" "$work/tampered.json"

echo "== the committed Rust fixture"
fixture="$NATIVE_DIR/fixtures/update-signature"
"$SCRIPTS/manifest-signature.sh" verify "$fixture/throwaway.pub.pem" "$fixture/latest.json"
ok "the fixture the Rust tests verify is an OpenSSL signature"
python3 "$NATIVE_DIR/scripts/check-manifest.py" "$fixture/latest.json" >/dev/null 2>&1 \
  && fail "the fixture should lack the Linux .deb and .rpm (it is not a release)"
openssl pkey -pubin -in "$NATIVE_DIR/packaging/update-signing-key.pub.pem" -noout \
  || fail "packaging/update-signing-key.pub.pem is not a public key"
ok "the committed release public key reads as one"

echo "== release notes"
# A worktree's .git points outside the checkout, which the build image doesn't mount: there the
# notes are skipped (say so), and the host run or CI covers them.
if git -C "$NATIVE_DIR" rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
  "$SCRIPTS/release-notes.sh" "$VERSION" HEAD "$REPO" >"$work/notes.md"
  grep -q "Semaphore-Chat-Native-Setup-$VERSION-x64.exe" "$work/notes.md" || fail "the notes don't list the installer"
  grep -q '^## ' "$work/notes.md" || fail "the notes have no changes section"
  grep -q '^- .* ([0-9a-f]\{7,\})$' "$work/notes.md" || fail "the notes list no native/ commit"
  ok "release notes for HEAD ($(grep -c '^- ' "$work/notes.md") lines of changes)"
  refuses "notes for a commit that doesn't exist" "$SCRIPTS/release-notes.sh" "$VERSION" \
    0000000000000000000000000000000000000000 "$REPO"
else
  echo "skip release notes: no git history in this container (run the script on the host too)"
fi

echo
echo "test-release-assembly: $passed checks passed"
