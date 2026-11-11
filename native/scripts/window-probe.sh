#!/usr/bin/env bash
# W2-desktop's headless proof that close to tray's hide and show work on the patched GPUI:
# rig-window-hide on X11 (Xvfb) and on Wayland (weston's headless backend), both on lavapipe.
#
#   native/scripts/window-probe.sh
#
# Runs in the desktop image (the build image plus weston). No network, no devices, nothing on the
# host's display. Exit 0 only if both pass.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" != --inner ]; then
  base="$("$NATIVE_DIR/scripts/in-image.sh" --print-image)"
  tag="$( { echo "$base"; cat "$NATIVE_DIR/docker/Dockerfile.desktop"; } | sha256sum | cut -c1-12)"
  image="semaphore-native-desktop:$tag"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "window-probe: building $image" >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.desktop" --build-arg "BASE=$base" \
      -t "$image" "$NATIVE_DIR/docker" >/dev/null
  fi
  NATIVE_IMAGE="$image" exec "$NATIVE_DIR/scripts/in-image.sh" bash scripts/window-probe.sh --inner
fi

nice -n 10 cargo build --locked -q -p rig-window-hide
RIG=/cache/target/debug/rig-window-hide
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export XDG_RUNTIME_DIR="/tmp/window-probe-$$"
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
LOGS="$XDG_RUNTIME_DIR/logs"
mkdir -p "$LOGS"
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() { # what, then a test command: polls it for up to 10 s
  local what="$1"; shift
  for _ in $(seq 1 200); do "$@" && return 0; sleep 0.05; done
  echo "window-probe: $what never came up" >&2
  return 1
}

status=0

echo "=== X11 (Xvfb)"
Xvfb :98 -screen 0 1280x720x24 -nolisten tcp >"$LOGS/xvfb.log" 2>&1 & pids+=($!)
wait_for Xvfb test -S /tmp/.X11-unix/X98
env -u WAYLAND_DISPLAY DISPLAY=:98 timeout 60 "$RIG" | tee /dev/stderr | grep -q "WINDOW_HIDE result=pass" || status=1

if command -v weston >/dev/null; then
  echo "=== Wayland (weston, headless)"
  weston --backend=headless --renderer=pixman --fake-seat --socket=wayland-probe --idle-time=0 \
    >"$LOGS/weston.log" 2>&1 & pids+=($!)
  wait_for weston test -S "$XDG_RUNTIME_DIR/wayland-probe"
  if ! env -u DISPLAY WAYLAND_DISPLAY=wayland-probe timeout 60 "$RIG" | tee /dev/stderr | grep -q "WINDOW_HIDE result=pass"; then
    status=1
    echo "--- weston log"; tail -20 "$LOGS/weston.log"
  fi
else
  echo "window-probe: no weston in this image" >&2
  status=1
fi
exit $status
