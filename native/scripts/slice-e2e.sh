#!/usr/bin/env bash
# U13: the real app, headless on lavapipe, against semaphore-fake-server, twice.
#
#   native/scripts/in-image.sh scripts/slice-e2e.sh [out-dir] [steps-file]
#     no steps-file: every rigs/slice/scripts/*.steps except voice and real, in sorted order, each
#     with a fresh fake server per run. text.steps writes <out-dir>/run-N (as it always did);
#     any other file writes <out-dir>/<name>/run-N. A steps-file argument runs just that file.
#   native/scripts/slice-e2e.sh --voice [out-dir]          # on the host: brings up LiveKit too
#
# --voice starts lk-stack's LiveKit and a demo publisher (`demo-peer`, video) in Squad Up, then runs
# rigs/slice/scripts/voice.steps the same way, with the fake server minting real tokens for it.
#
# Each run starts a fresh fake server (scenario showcase) on 127.0.0.1 inside this container and
# drives rig-slice through the steps: state checks, and screenshots into <run dir>/run-N. The
# second run must give the same pixels for every static shot, the ones not named *-live-*.
# Exits non-zero on any failed step or differing shot, after running every steps file.
set -euo pipefail

LK_NAME="${SLICE_LK_NAME:-u13-voice-livekit}"
LK_KEY=devkey
LK_SECRET=secret-that-is-at-least-32-characters-long
LK_CLI=livekit/livekit-cli@sha256:04eff828f8edd810b996c18456a6260ba0698a60f8ea309d0f015c2b09696413

if [ "${1:-}" = "--voice" ]; then
  # The host half: LiveKit and the publisher are containers of their own on semaphore-test.
  shift
  NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  publisher="$LK_NAME-demo"
  cleanup() {
    docker rm -f "$publisher" >/dev/null 2>&1 || true
    LK_STACK_NAME="$LK_NAME" "$NATIVE_DIR/scripts/lk-stack.sh" down
  }
  trap cleanup EXIT INT TERM
  LK_STACK_NAME="$LK_NAME" "$NATIVE_DIR/scripts/lk-stack.sh" up >/dev/null
  docker run -d --rm --name "$publisher" --network semaphore-test "$LK_CLI" \
    --url "ws://$LK_NAME:7880" --api-key "$LK_KEY" --api-secret "$LK_SECRET" \
    room join --identity demo-peer --publish-demo vc-squad >/dev/null
  # Bounded: the publisher is in the room once LiveKit lists it.
  for _ in $(seq 1 60); do
    if docker run --rm --network semaphore-test "$LK_CLI" \
      --url "ws://$LK_NAME:7880" --api-key "$LK_KEY" --api-secret "$LK_SECRET" \
      room participants list vc-squad 2>/dev/null | grep -q demo-peer; then
      break
    fi
    sleep 0.5
  done
  "$NATIVE_DIR/scripts/in-image.sh" scripts/slice-e2e.sh --voice-inner "${1:-results/slice/e2e-voice}"
  exit $?
fi

voice=false
if [ "${1:-}" = "--voice-inner" ]; then
  voice=true
  shift
fi
out_dir="${1:-results/slice/e2e}"
# Each entry is "steps-file|run-dir". text.steps keeps the original <out-dir>/run-N layout.
suites=()
if $voice; then
  suites=("rigs/slice/scripts/voice.steps|$out_dir")
elif [ -n "${2:-}" ]; then
  suites=("$2|$out_dir")
else
  for f in rigs/slice/scripts/*.steps; do
    name="$(basename "$f" .steps)"
    # voice.steps needs --voice; real.steps a real backend (scripts/slice-real.sh).
    case "$name" in voice | real) continue ;; esac
    if [ "$name" = text ]; then suites+=("$f|$out_dir"); else suites+=("$f|$out_dir/$name"); fi
  done
fi
scenario=showcase
port="${SLICE_PORT:-3999}"
server_args=()
rig_args=()
if $voice; then
  server_args=(--livekit-url "ws://$LK_NAME:7880" --livekit-key "$LK_KEY" --livekit-secret "$LK_SECRET")
  rig_args=(--heartbeat-ms 1000 --livekit-http "http://$LK_NAME:7880" --livekit-key "$LK_KEY" --livekit-secret "$LK_SECRET")
fi

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
  "$target/fake-server" --scenario "$scenario" --port "$port" ${server_args[@]+"${server_args[@]}"} >"$log" 2>&1 &
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

total_different=0
total_compared=0
for suite in "${suites[@]}"; do
  steps="${suite%%|*}"
  suite_dir="${suite#*|}"
  echo "== $steps" >&2
  for run in 1 2; do
    dir="$suite_dir/run-$run"
    rm -rf "$dir"
    mkdir -p "$dir"
    start_server "$dir/fake-server.log"
    echo "== run $run" >&2
    run_started="$(date +%s%3N)"
    "$target/rig-slice" \
      --server "http://127.0.0.1:$port" \
      --scenario "fixtures/scenarios/$scenario.json" \
      --script "$steps" \
      --out "$dir" ${rig_args[@]+"${rig_args[@]}"} | tee "$dir/steps.log" >&2
    echo "run $run: $(( $(date +%s%3N) - run_started )) ms" >&2
    stop_server
  done

  different=0
  compared=0
  for first in "$suite_dir"/run-1/*.png; do
    name="$(basename "$first")"
    case "$name" in *-live-*) continue ;; esac
    second="$suite_dir/run-2/$name"
    compared=$((compared + 1))
    if [ ! -f "$second" ]; then
      echo "slice-e2e: $steps: run 2 has no $name" >&2
      different=$((different + 1))
    elif ! cmp -s "$first" "$second"; then
      echo "slice-e2e: $steps: $name differs between runs" >&2
      different=$((different + 1))
    fi
  done
  (cd "$suite_dir/run-1" && sha256sum ./*.png) >"$suite_dir/shots.sha256"
  echo "slice-e2e: $steps: $compared static shots compared, $different differ" >&2
  total_different=$((total_different + different))
  [ "$compared" -gt 0 ] || total_different=$((total_different + 1))
  total_compared=$((total_compared + compared))
done
echo "slice-e2e: $total_compared static shots compared, $total_different differ; build $(( built_ms - started_ms )) ms, total $(( $(date +%s%3N) - started_ms )) ms" >&2
[ "$total_different" -eq 0 ] && [ "$total_compared" -gt 0 ]
