#!/usr/bin/env bash
# Inside the run image: start headless sway, wait for its socket, run the rig in it.
set -uo pipefail
mode="$1"; shift
mkdir -p "$XDG_RUNTIME_DIR" /tmp/s; chmod 700 "$XDG_RUNTIME_DIR"
printf 'output HEADLESS-1 mode 1920x1080@60Hz\ndefault_border none\nseat seat0 hide_cursor 1000\n' > /tmp/s/cfg
sway --unsupported-gpu -c /tmp/s/cfg > "/out/$LABEL.sway.log" 2>&1 &
SWAY=$!
for _ in $(seq 1 200); do
  [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break
  kill -0 "$SWAY" 2>/dev/null || { echo "sway died"; tail -5 "/out/$LABEL.sway.log"; exit 1; }
  python3 -c 'import time; time.sleep(0.05)'
done
[ -S "$XDG_RUNTIME_DIR/wayland-1" ] || { echo "no compositor socket"; exit 1; }
export WAYLAND_DISPLAY=wayland-1
unset DISPLAY

wait_file=()
if [ "${SHOT:-0}" = 1 ]; then wait_file=(--shot-wait-file /tmp/s/shot-done); fi
/cache/target/release/rig-list "$mode" --out "/out/$LABEL.json" --image-dir /images "${wait_file[@]}" "$@" > "/out/$LABEL.log" 2>&1 &
RIG=$!
if [ "${SHOT:-0}" = 1 ]; then
  for _ in $(seq 1 1200); do
    [ -s "/out/$LABEL.json" ] && break
    kill -0 "$RIG" 2>/dev/null || break
    python3 -c 'import time; time.sleep(0.1)'
  done
  grim "/out/$LABEL.png"
  touch /tmp/s/shot-done
fi
wait "$RIG"; rc=$?
kill "$SWAY" 2>/dev/null
vendor="$(grep -m1 -oE 'NVIDIA|llvmpipe|renderer: .*' "/out/$LABEL.log" || true)"
echo "rig-list $mode exit=$rc renderer_hint=${vendor:-unknown}"
chown -R "$HOST_UID:$HOST_GID" /out 2>/dev/null
exit "$rc"
