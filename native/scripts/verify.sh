#!/usr/bin/env bash
# Phase 0's definition of done, with real exit codes. Run from anywhere:
#
#   RESULT_SCHEMA_HOST=/path/to/result.schema.json native/scripts/verify.sh
#
# RESULT_SCHEMA_HOST defaults to scripts/native-baseline/result.schema.json in this checkout.
# Every step runs even if an earlier one fails, and the summary lists all of them.
set -uo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
IN_IMAGE="$NATIVE_DIR/scripts/in-image.sh"
SCHEMA="${RESULT_SCHEMA_HOST:-$ROOT/scripts/native-baseline/result.schema.json}"
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"

if [ -f "$SCHEMA" ]; then
  export NATIVE_DOCKER_ARGS="-v $SCHEMA:/schema/result.schema.json:ro -e RESULT_SCHEMA=/schema/result.schema.json -e GIT_COMMIT=$COMMIT"
else
  echo "verify: no schema at $SCHEMA, so the two result steps will fail" >&2
  export NATIVE_DOCKER_ARGS="-e GIT_COMMIT=$COMMIT"
fi

names=()
codes=()
step() { # <name> <command...>
  local name="$1"; shift
  echo
  echo "=== $name"
  echo "\$ $*"
  "$@"
  local rc=$?
  echo "--- $name: exit $rc"
  names+=("$name")
  codes+=("$rc")
}

step "vendored crates match series" "$NATIVE_DIR/third_party/vendor.sh" --check
step "contract matches PIN" "$NATIVE_DIR/scripts/pin-contract.sh" --check
step "cargo build --workspace" "$IN_IMAGE" cargo build --locked --workspace
step "cargo test --workspace" "$IN_IMAGE" cargo test --locked --workspace
step "cargo fmt --check" "$IN_IMAGE" cargo fmt --all --check
step "cargo clippy" "$IN_IMAGE" cargo clippy --locked --workspace --all-targets -- -D warnings
step "cargo deny check" "$IN_IMAGE" cargo deny check
step "zbus 5 has no tokio feature" "$IN_IMAGE" scripts/check-zbus-tokio.sh
step "core boundary" "$IN_IMAGE" python3 scripts/check-core-boundary.py
step "guards reject bad input" "$IN_IMAGE" scripts/test-policy.sh
step "core: cargo check Android" "$IN_IMAGE" cargo check --locked -p semaphore-core --target aarch64-linux-android
step "core: cargo check iOS" "$IN_IMAGE" cargo check --locked -p semaphore-core --target aarch64-apple-ios
step "patched Windows renderer: cargo check" "$IN_IMAGE" cargo check --locked -p gpui-pre-windows --target x86_64-pc-windows-msvc
step "video surface draws on lavapipe" "$IN_IMAGE" sh -c 'cargo build --locked -q -p rig-surface-smoke && VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json XDG_RUNTIME_DIR=/tmp /cache/target/debug/rig-surface-smoke'
step "rig-surface-smoke: cargo check Windows" "$IN_IMAGE" cargo check --locked -p rig-surface-smoke --target x86_64-pc-windows-msvc
# The OS sleep and network listeners: the furthest the image gets towards the app on Windows (net and
# media need MSVC headers for ring and libwebrtc; the windows-link CI job builds the rest).
step "platform-desktop: cargo clippy Windows" "$IN_IMAGE" cargo clippy --locked -p semaphore-platform-desktop --target x86_64-pc-windows-msvc --all-targets -- -D warnings
step "T11 Windows capture: cargo check" "$IN_IMAGE" cargo check --locked -p semaphore-sysaudio --no-default-features --target x86_64-pc-windows-msvc
# The capture shim's Rust (webrtc-sys and libwebrtc bridges, the probe): C++ isn't built here.
step "capture shim + probe: cargo check Windows" "$IN_IMAGE" sh scripts/check-webrtc-windows.sh \
  -p semaphore-media-livekit --lib --tests --example capture_probe -p rig-fake-camera
step "capture probe: Xvfb screen and PipeWire camera" "$NATIVE_DIR/scripts/capture-probe.sh"
step "desktop: hide/show on X11 and Wayland, tray and notifier on private buses" "$NATIVE_DIR/scripts/desktop-probe.sh"
step "T10 harness: screenshot on lavapipe" "$IN_IMAGE" scripts/shot.sh shell-connected 800 480 results/phase0/shots
step "cargo build --release -p semaphore-app" "$IN_IMAGE" nice -n 10 cargo build --locked --release -p semaphore-app
step "release binary joins a real LiveKit room" "$NATIVE_DIR/scripts/media-probe.sh"
step "emit result JSON" "$IN_IMAGE" python3 scripts/emit-result.py \
  /cache/target/release/semaphore-app results/phase0/native-shell.json
step "validate result JSON" "$IN_IMAGE" python3 scripts/validate-result.py results/phase0/native-shell.json

echo
echo "=== summary"
failed=0
for i in "${!names[@]}"; do
  printf '%-44s exit %s\n' "${names[$i]}" "${codes[$i]}"
  [ "${codes[$i]}" = 0 ] || failed=1
done
exit "$failed"
