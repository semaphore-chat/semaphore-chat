#!/usr/bin/env bash
# U13: the real app, headless on lavapipe, against semaphore-fake-server, twice.
#
#   native/scripts/in-image.sh scripts/slice-e2e.sh [out-dir] [steps-file]
#
# Each run starts a fresh fake server (scenario showcase) on 127.0.0.1 inside this container and
# drives rig-slice through the steps: state checks, and screenshots into <out-dir>/run-N. The
# second run must give the same pixels for every static shot, the ones not named *-live-*.
# Exits non-zero on any failed step or differing shot.
set -euo pipefail

out_dir="${1:-results/slice/e2e}"
steps="${2:-rigs/slice/scripts/text.steps}"
scenario=showcase
port="${SLICE_PORT:-3999}"

export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
export TZ=UTC
export SEMAPHORE_LOG="${SEMAPHORE_LOG:-warn}"

started_ms="$(date +%s%3N)"
cargo build -q -p semaphore-fake-server -p rig-slice
built_ms="$(date +%s%3N)"
target="${CARGO_TARGET_DIR:-target}/debug"

server_pid=""
stop_server() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    server_pid=""
  fi
}
trap stop_server EXIT INT TERM

start_server() {
  local log="$1"
  "$target/fake-server" --scenario "$scenario" --port "$port" >"$log" 2>&1 &
  server_pid=$!
  # Bounded: the server prints its address once it is listening, within a second or so.
  for _ in $(seq 1 200); do
    if grep -q 'listening on' "$log"; then return 0; fi
    if ! kill -0 "$server_pid" 2>/dev/null; then cat "$log" >&2; return 1; fi
    sleep 0.05
  done
  echo "slice-e2e: the fake server never said it was listening" >&2
  cat "$log" >&2
  return 1
}

for run in 1 2; do
  dir="$out_dir/run-$run"
  rm -rf "$dir"
  mkdir -p "$dir"
  start_server "$dir/fake-server.log"
  echo "== run $run" >&2
  run_started="$(date +%s%3N)"
  "$target/rig-slice" \
    --server "http://127.0.0.1:$port" \
    --scenario "fixtures/scenarios/$scenario.json" \
    --script "$steps" \
    --out "$dir" | tee "$dir/steps.log" >&2
  echo "run $run: $(( $(date +%s%3N) - run_started )) ms" >&2
  stop_server
done

different=0
compared=0
for first in "$out_dir"/run-1/*.png; do
  name="$(basename "$first")"
  case "$name" in *-live-*) continue ;; esac
  second="$out_dir/run-2/$name"
  compared=$((compared + 1))
  if [ ! -f "$second" ]; then
    echo "slice-e2e: run 2 has no $name" >&2
    different=$((different + 1))
  elif ! cmp -s "$first" "$second"; then
    echo "slice-e2e: $name differs between runs" >&2
    different=$((different + 1))
  fi
done
(cd "$out_dir/run-1" && sha256sum ./*.png) >"$out_dir/shots.sha256"
echo "slice-e2e: $compared static shots compared, $different differ; build $(( built_ms - started_ms )) ms, total $(( $(date +%s%3N) - started_ms )) ms" >&2
[ "$different" -eq 0 ] && [ "$compared" -gt 0 ]
