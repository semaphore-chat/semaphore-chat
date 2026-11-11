#!/usr/bin/env bash
# W0-real-smoke: the real app, headless on lavapipe, against a real backend.
#
#   native/scripts/slice-real.sh [out-dir]        # on the host; default results/slice/real
#
# The host half starts a per-ticket stack (scripts/test-stack.sh, ticket w0real: postgres, redis,
# S3 on the shared semaphore-test network), then this checkout's backend in a test-stack `run`
# container: migrated, seeded by backend/prisma/seed-e2e.ts, serving on port 3000. It waits for
# /api/health, then runs the inner half in the native build image, also on semaphore-test, which
# reaches the backend by its container name. The inner half asks the backend for the seeded ids
# (scripts/real-api.py ids), fills them into rigs/slice/scripts/real.steps, and drives rig-slice
# through it. Everything it started is removed on exit, by exact name; no network is created or
# removed.
#
# SLICE_REAL_KEEP=1 leaves the backend and the stack up afterwards (scripts/test-stack.sh w0real
# down, and docker rm -f the backend, clean up).
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--inner" ]; then
  server="${2:?--inner <server-url> <out-dir>}"
  out_dir="${3:?--inner <server-url> <out-dir>}"
  cd "$NATIVE_DIR"
  export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
  export TZ=UTC
  export SEMAPHORE_LOG="${SEMAPHORE_LOG:-warn}"
  cargo build -q -p rig-slice
  target="${CARGO_TARGET_DIR:-target}/debug"
  rm -rf "$out_dir"
  mkdir -p "$out_dir"
  python3 scripts/real-api.py "$server" ids >"$out_dir/ids.env"
  # {{NAME}} -> the id, for every NAME=value line, outside comments; an unknown NAME fails.
  python3 - "$out_dir/ids.env" rigs/slice/scripts/real.steps "$out_dir/real.steps" <<'EOF'
import re, sys
ids = dict(line.strip().split("=", 1) for line in open(sys.argv[1]) if "=" in line)
fill = lambda line: line if line.lstrip().startswith("#") else re.sub(
    r"\{\{(\w+)\}\}", lambda m: ids[m.group(1)], line)
open(sys.argv[3], "w").writelines(fill(line) for line in open(sys.argv[2]))
EOF
  started="$(date +%s%3N)"
  "$target/rig-slice" --server "$server" --script "$out_dir/real.steps" --out "$out_dir" \
    | tee "$out_dir/steps.log" >&2
  echo "slice-real: real.steps passed in $(( $(date +%s%3N) - started )) ms" >&2
  exit 0
fi

ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
TICKET=w0real
LABEL=org.semaphore-chat.test-stack
out_dir="${1:-results/slice/real}"
log_dir="$NATIVE_DIR/target/slice-real"
mkdir -p "$log_dir"
backend_log="$log_dir/backend.log"

run_pid=""
backend=""
cleanup() {
  local rc=$?
  if [ "${SLICE_REAL_KEEP:-0}" = 1 ]; then
    echo "slice-real: SLICE_REAL_KEEP=1, leaving $backend and the $TICKET stack up" >&2
    exit "$rc"
  fi
  if [ -n "$backend" ]; then docker rm -f "$backend" >/dev/null 2>&1 || true; fi
  if [ -n "$run_pid" ]; then
    kill "$run_pid" 2>/dev/null || true
    wait "$run_pid" 2>/dev/null || true
  fi
  "$ROOT/scripts/test-stack.sh" "$TICKET" down >/dev/null 2>&1 || true
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

backend_name() {
  docker ps --filter "label=$LABEL.ticket=$TICKET" --filter "label=$LABEL.role=backend" \
    --format '{{.Names}}' | head -n 1
}
if [ -n "$(backend_name)" ]; then
  echo "slice-real: a $TICKET backend is already running ($(backend_name)); remove it first" >&2
  exit 1
fi

"$ROOT/scripts/test-stack.sh" "$TICKET" up
# The backend as the e2e stack runs it (docker-compose.e2e.yml's backend-test): test mode, with
# the socket connection limit raised, migrated and seeded first.
"$ROOT/scripts/test-stack.sh" "$TICKET" run -e WS_CONNECTION_RATE_LIMIT=1000 sh -c \
  'pnpm run prisma:migrate && pnpm exec ts-node prisma/seed-e2e.ts && exec pnpm run start' \
  >"$backend_log" 2>&1 &
run_pid=$!

# Bounded: the container exists within seconds (the image may be built first, so up to 10 min).
for _ in $(seq 1 1200); do
  backend="$(backend_name)"
  [ -n "$backend" ] && break
  if ! kill -0 "$run_pid" 2>/dev/null; then
    tail -n 40 "$backend_log" >&2
    echo "slice-real: the backend container never started (log above)" >&2
    exit 1
  fi
  sleep 0.5
done
[ -n "$backend" ] || { echo "slice-real: no backend container after 10 min" >&2; exit 1; }
echo "slice-real: backend $backend (log $backend_log)" >&2

# Bounded: migrate, seed, compile and listen take a minute or two.
health="fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
started="$(date +%s)"
until docker exec "$backend" node -e "$health" >/dev/null 2>&1; do
  if ! kill -0 "$run_pid" 2>/dev/null; then
    tail -n 60 "$backend_log" >&2
    echo "slice-real: the backend exited before it was healthy (log above)" >&2
    exit 1
  fi
  if [ $(( $(date +%s) - started )) -gt 600 ]; then
    tail -n 60 "$backend_log" >&2
    echo "slice-real: the backend wasn't healthy within 10 min (log above)" >&2
    exit 1
  fi
  sleep 1
done
echo "slice-real: backend healthy after $(( $(date +%s) - started )) s" >&2

"$NATIVE_DIR/scripts/in-image.sh" scripts/slice-real.sh --inner "http://$backend:3000" "$out_dir"
