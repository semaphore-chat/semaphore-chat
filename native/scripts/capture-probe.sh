#!/usr/bin/env bash
# Unit A's headless proof: the patched libwebrtc capturers, from Rust, in the pinned image.
#
#   native/scripts/capture-probe.sh
#
# - Screens: libwebrtc's X11 capturer on Xvfb (1280x720, white root): lists the screen and
#   captures 10 BGRA frames under a 15 fps cap.
# - Cameras: libwebrtc's PipeWire camera module, over our own connection to a private PipeWire
#   (with WirePlumber, which links the capture), against `rig-fake-camera`: a node with one fixed
#   YUY2 mode, as WirePlumber presents a real webcam.
#
# Runs in the T11 image (the build image plus PipeWire and WirePlumber). No network, no devices.
# Exit 0 only if both probes pass.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" != --inner ]; then
  image="$("$NATIVE_DIR/rigs/sysaudio/image.sh")"
  NATIVE_IMAGE="$image" exec "$NATIVE_DIR/scripts/in-image.sh" bash scripts/capture-probe.sh --inner
fi

nice -n 10 cargo build --locked -q -p semaphore-media-livekit --example capture_probe -p rig-fake-camera
PROBE=/cache/target/debug/examples/capture_probe

export XDG_RUNTIME_DIR="/tmp/capture-probe-$$"
export XDG_CONFIG_HOME="$XDG_RUNTIME_DIR/config"
export XDG_STATE_HOME="$XDG_RUNTIME_DIR/state"
LOGS="$XDG_RUNTIME_DIR/logs"
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
mkdir -p "$XDG_CONFIG_HOME/pipewire/pipewire.conf.d" "$XDG_STATE_HOME" "$LOGS"

pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() { # <what> <command...>: bounded poll, 10 s
  local what="$1"; shift
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  echo "capture-probe: $what never came up" >&2
  tail -n 30 "$LOGS"/*.log >&2 || true
  exit 1
}

echo "=== screens: X11 on Xvfb"
Xvfb :99 -screen 0 1280x720x24 -wr -nolisten tcp >"$LOGS/xvfb.log" 2>&1 & pids+=($!)
wait_for Xvfb test -S /tmp/.X11-unix/X99
# X11, not Wayland: libwebrtc picks PipeWire when the session says Wayland.
env -u WAYLAND_DISPLAY DISPLAY=:99 XDG_SESSION_TYPE=x11 \
  "$PROBE" screens --fps 15 --frames 10 --expect-size 1280x720 --expect-white

echo "=== cameras: PipeWire with a test camera node"
unset DBUS_SESSION_BUS_ADDRESS
pipewire >"$LOGS/pipewire.log" 2>&1 & pids+=($!)
wait_for pipewire pw-cli info 0
wireplumber >"$LOGS/wireplumber.log" 2>&1 & pids+=($!)
/cache/target/debug/rig-fake-camera >"$LOGS/fake-camera.log" 2>&1 & pids+=($!)
wait_for "the camera node" sh -c 'pw-cli ls Node | grep -q "Rig camera"'
"$PROBE" cameras --frames 30 --expect-device "Rig camera"
