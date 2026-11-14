#!/usr/bin/env bash
# W2-desktop's headless proof, in the desktop image (the build image plus weston and a passwd entry
# so dbus-daemon starts):
#
# - Close to tray's hide and show on the patched GPUI: rig-window-hide on X11 (Xvfb) and on Wayland
#   (weston's headless backend), both on lavapipe.
# - The Linux tray on a private dbus-daemon with a fake StatusNotifierWatcher
#   (crates/semaphore-platform-desktop/tests/tray_linux.rs), and the notifier on one with a fake
#   org.freedesktop.Notifications (tests/notify_linux.rs: replace by tag, click with its activation
#   token, closed cleanup, withdraw). Plain `cargo test` skips both because the build image can't
#   start a bus.
# - A live-region announcement out of a real window: on a private session bus, the AT-SPI bus
#   launcher and an accessibility bus, rig-announce opens the message list scrolled away from the
#   bottom and inserts one message from another user and one of its own. dbus-monitor must see
#   exactly one polite `Announcement` reading "Alice: hello from Alice", and none for the own row.
#
#   native/scripts/desktop-probe.sh
#
# No network, no devices, nothing on the host's display or session bus. Exit 0 only if all pass.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" != --inner ]; then
  base="$("$NATIVE_DIR/scripts/in-image.sh" --print-image)"
  tag="$( { echo "$base"; cat "$NATIVE_DIR/docker/Dockerfile.desktop"; } | sha256sum | cut -c1-12)"
  image="semaphore-native-desktop:$tag"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    echo "desktop-probe: building $image" >&2
    docker build -q -f "$NATIVE_DIR/docker/Dockerfile.desktop" --build-arg "BASE=$base" \
      --build-arg "HOST_UID=$(id -u)" \
      -t "$image" "$NATIVE_DIR/docker" >/dev/null
  fi
  NATIVE_IMAGE="$image" exec "$NATIVE_DIR/scripts/in-image.sh" bash scripts/desktop-probe.sh --inner
fi

nice -n 10 cargo build --locked -q -p rig-window-hide
RIG=/cache/target/debug/rig-window-hide
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export XDG_RUNTIME_DIR="/tmp/desktop-probe-$$"
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
LOGS="$XDG_RUNTIME_DIR/logs"
mkdir -p "$LOGS"
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() { # what, then a test command: polls it for up to 10 s
  local what="$1"; shift
  for _ in $(seq 1 200); do "$@" && return 0; sleep 0.05; done
  echo "desktop-probe: $what never came up" >&2
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
  echo "desktop-probe: no weston in this image" >&2
  status=1
fi
echo "=== tray and notifications on private session buses"
SEMAPHORE_REQUIRE_DBUS=1 nice -n 10 cargo test --locked -q -p semaphore-platform-desktop \
  --test tray_linux --test notify_linux || status=1

echo "=== a live-region announcement reaches the accessibility bus"
nice -n 10 cargo build --locked -q -p rig-announce || status=1
announce_dir="$XDG_RUNTIME_DIR/announce"
mkdir -p "$announce_dir"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/announce-bus"
bus_pid="$(dbus-daemon --session --address="$DBUS_SESSION_BUS_ADDRESS" --fork --print-pid=1 | tr -d '\n')"
[ -n "$bus_pid" ] && pids+=("$bus_pid")
if ! gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
    --method org.a11y.Bus.GetAddress >"$announce_dir/address" 2>"$announce_dir/address.err"; then
  echo "desktop-probe: the AT-SPI bus did not start" >&2
  cat "$announce_dir/address.err" >&2
  status=1
else
  at_spi_address="$(sed -n "s/^('\(.*\)',)\$/\1/p" "$announce_dir/address")"
  if [ -z "$at_spi_address" ]; then
    echo "desktop-probe: GetAddress said $(cat "$announce_dir/address")" >&2
    status=1
  else
    monitor="$announce_dir/announcements.log"
    timeout 120 dbus-monitor --address "$at_spi_address" \
      "type='signal',interface='org.a11y.atspi.Event.Object',member='Announcement'" \
      >"$monitor" 2>&1 & monitor_pid=$!
    pids+=("$monitor_pid")
    coproc RIG {
      env -u WAYLAND_DISPLAY DISPLAY=:98 timeout 60 \
        /cache/target/debug/rig-announce 2>&1 | tee "$announce_dir/rig.log"
    }
    ready=1
    while IFS= read -r line <&"${RIG[0]}"; do
      [ "$line" = READY ] && { ready=0; break; }
    done
    if [ "$ready" -ne 0 ]; then
      echo "desktop-probe: rig-announce never said READY" >&2
      cat "$announce_dir/rig.log" >&2
      status=1
    else
      gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
        --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled "<true>" \
        >/dev/null || status=1
      while IFS= read -r line <&"${RIG[0]}"; do :; done
      rig_status=0
      wait "$RIG_PID" || rig_status=$?
      cat "$announce_dir/rig.log"
      [ "$rig_status" -eq 0 ] || status=1
    fi
    # Its own shell without `pipefail`: grep stops at the first match and closes tail's pipe,
    # which makes tail exit 141, and the pipeline's status is what this waits on.
    if ! (set +o pipefail; timeout 10 tail -n +1 -f "$monitor" | grep -q -m1 "member=Announcement"); then
      echo "desktop-probe: no Announcement reached the accessibility bus" >&2
      status=1
    fi
    kill "$monitor_pid" 2>/dev/null || true
    if ! python3 - "$monitor" <<'PY'
import sys

text = open(sys.argv[1], errors="replace").read()
blocks = [b for b in text.split("signal time=")[1:] if "member=Announcement" in b]
problems = []
if len(blocks) != 1:
    problems.append(f"{len(blocks)} announcements, want 1")
else:
    block = blocks[0]
    if "Alice: hello from Alice" not in block:
        problems.append("the announcement does not read 'Alice: hello from Alice'")
    if "int32 1" not in block:
        problems.append("the announcement is not polite (detail1 is not 1)")
if "my own message" in text:
    problems.append("the reader's own message was announced")
if problems:
    print("desktop-probe: " + "; ".join(problems), file=sys.stderr)
    print(text, file=sys.stderr)
    sys.exit(1)
print('announcement: polite "Alice: hello from Alice", once; nothing for the reader\'s own')
PY
    then
      status=1
    fi
  fi
fi
exit $status
