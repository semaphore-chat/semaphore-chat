#!/usr/bin/env bash
#
# Launch the PACKAGED Electron app (electron-builder's linux-unpacked build)
# headless under Xvfb and drive it with Playwright's Electron driver against a
# real backend and LiveKit, all in Docker on the shared `semaphore-test`
# network. A manual smoke tool for Electron upgrades and main/preload changes:
# CI's smoke step only checks that the app reaches ready-to-show.
#
# Usage: scripts/run-electron-smoke.sh <ticket> [options]
#        (or frontend/scripts/electron-smoke/run.sh <ticket> [options])
#
#   --build           package this checkout first (build:all + electron-builder
#                     --dir, in the frontend image via scripts/test-stack.sh)
#   --app DIR         the linux-unpacked directory to test (default:
#                     frontend/release/linux-unpacked of this checkout). Point
#                     it at another checkout's build to compare versions
#                     against the same backend.
#   --out DIR         results directory (default: frontend/.electron-smoke-out;
#                     a results directory of an earlier run is emptied first,
#                     any other non-empty directory is refused)
#   --no-keyring      no Secret Service in the container: safeStorage falls
#                     back to whatever Chromium does without a keyring
#   --keep            leave the backend, LiveKit and databases running
#                     (scripts/test-stack.sh <ticket> down removes them)
#
# Writes <out>/results.json (one entry per check), screenshots, and the main
# process and renderer console logs. Exits non-zero if a check failed.
#
# The backend (seeded with the e2e users, see backend/prisma/seed-e2e.ts),
# postgres, redis, MinIO and LiveKit are the ticket's own containers
# (<ticket>-pg, <ticket>-livekit, ...), labelled like scripts/test-stack.sh's,
# so `scripts/test-stack.sh <ticket> down` removes them all. No network is
# created or removed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
NET=semaphore-test
LABEL=org.semaphore-chat.test-stack
LIVEKIT_IMAGE=livekit/livekit-server:latest
LIVEKIT_KEY=devkey
LIVEKIT_SECRET=secret-that-is-at-least-32-characters-long
# shellcheck source=SCRIPTDIR/../ui-review/lib/hash.sh
source "$ROOT/frontend/scripts/ui-review/lib/hash.sh"

die() { echo "electron-smoke: $*" >&2; exit 1; }
log() { echo "electron-smoke: $*" >&2; }

[[ $# -ge 1 && "$1" != -* ]] || { sed -n '2,/^set -euo/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'; exit 2; }
TICKET="$1"
shift
BUILD=false KEEP=false KEYRING=true
APP="$ROOT/frontend/release/linux-unpacked"
OUT="$ROOT/frontend/.electron-smoke-out"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=true; shift ;;
    --app) APP="$(cd "$2" && pwd)"; shift 2 ;;
    --out) mkdir -p "$2"; OUT="$(cd "$2" && pwd)"; shift 2 ;;
    --no-keyring) KEYRING=false; shift ;;
    --keep) KEEP=true; shift ;;
    *) die "unknown option $1" ;;
  esac
done

# Empty the results directory from a previous run, but only one this script
# made (it leaves a marker file): a mistyped --out can't wipe anything else.
mkdir -p "$OUT"
if [[ -n "$(ls -A "$OUT")" ]]; then
  [[ -f "$OUT/.electron-smoke" ]] ||
    die "$OUT is not empty and not an electron-smoke results directory; pass another --out"
  find "$OUT" -mindepth 1 -delete
fi
touch "$OUT/.electron-smoke"

STACK=("$ROOT/scripts/test-stack.sh" "$TICKET")
BACKEND_PID=""
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  # With --keep the backend's `test-stack.sh run` client stays in the
  # background (killing it would remove the backend container).
  if [[ "$KEEP" == false ]]; then
    # Stop the backend's client first (its trap removes the container), so
    # `down` doesn't race that removal.
    if [[ -n "$BACKEND_PID" ]]; then
      kill "$BACKEND_PID" 2>/dev/null || true
      wait "$BACKEND_PID" 2>/dev/null || true
    fi
    "${STACK[@]}" down || true
  fi
}
trap cleanup EXIT

if [[ "$BUILD" == true ]]; then
  log "packaging this checkout (build:all + electron-builder --dir)"
  "${STACK[@]}" run-frontend sh -c \
    'pnpm run build:all && pnpm run electron-builder:linux --dir --publish never'
fi
[[ -x "$APP/semaphore-chat" ]] || die "no packaged app at $APP (run with --build, or pass --app)"

# ------------------------------------------------------------ services
"${STACK[@]}" up

LIVEKIT="$TICKET-livekit"
if ! docker inspect "$LIVEKIT" >/dev/null 2>&1; then
  log "starting $LIVEKIT"
  docker run -d --name "$LIVEKIT" --network "$NET" \
    --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=livekit" \
    -e LIVEKIT_CONFIG="$(printf '%s\n' \
      'port: 7880' \
      'rtc:' \
      '  tcp_port: 7881' \
      '  port_range_start: 50000' \
      '  port_range_end: 50019' \
      '  use_external_ip: false' \
      'redis:' \
      "  address: $TICKET-redis:6379" \
      'keys:' \
      "  $LIVEKIT_KEY: $LIVEKIT_SECRET")" \
    "$LIVEKIT_IMAGE" >/dev/null
fi

backend_container() {
  docker ps -q --filter "label=$LABEL.ticket=$TICKET" --filter "label=$LABEL.role=backend" | head -n 1
}
BACKEND_ID="$(backend_container)"
if [[ -z "$BACKEND_ID" ]]; then
  log "starting the backend (migrate, seed the e2e users, nest start)"
  # CORS_ORIGIN=null: the packaged app is a file:// page, whose requests carry
  # `Origin: null`.
  "${STACK[@]}" run \
    -e CORS_ORIGIN=null \
    -e "LIVEKIT_URL=ws://$LIVEKIT:7880" -e "LIVEKIT_INTERNAL_URL=http://$LIVEKIT:7880" \
    -e "LIVEKIT_API_KEY=$LIVEKIT_KEY" -e "LIVEKIT_API_SECRET=$LIVEKIT_SECRET" \
    sh -c 'pnpm run prisma:migrate && pnpm run seed:e2e && exec pnpm run start' \
    >"$OUT/backend.log" 2>&1 &
  BACKEND_PID=$!
  for _ in $(seq 1 60); do
    BACKEND_ID="$(backend_container)"
    [[ -n "$BACKEND_ID" ]] && break
    kill -0 "$BACKEND_PID" 2>/dev/null || die "the backend exited (see $OUT/backend.log)"
    sleep 2
  done
  [[ -n "$BACKEND_ID" ]] || die "the backend container did not start (see $OUT/backend.log)"
fi
BACKEND="$(docker inspect -f '{{.Name}}' "$BACKEND_ID" | sed 's|^/||')"
log "waiting for $BACKEND to answer /api/health"
for i in $(seq 1 150); do
  if docker exec "$BACKEND" node -e \
    "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" \
    >/dev/null 2>&1; then
    break
  fi
  [[ "$i" -lt 150 ]] || die "the backend did not become healthy (see $OUT/backend.log)"
  if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    die "the backend exited (see $OUT/backend.log)"
  fi
  sleep 2
done

# ------------------------------------------------------------ smoke run
IMAGE="electron-smoke:$(digest 256 <"$HERE/Dockerfile" | cut -c1-12)"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  log "building $IMAGE"
  docker build -q -t "$IMAGE" "$HERE" >/dev/null
fi

log "running the smoke checks against $APP (server http://$BACKEND:3000)"
RC=0
docker run --rm --init --name "$TICKET-electron-smoke-$$" --network "$NET" \
  --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=electron-smoke" \
  --shm-size 1g -u "$(id -u):$(id -g)" -e HOME=/tmp/home \
  -e "SERVER_URL=http://$BACKEND:3000" -e "SMOKE_KEYRING=$KEYRING" \
  -v "$APP:/app:ro" -v "$HERE:/opt/smoke/src:ro" -v "$OUT:/out" \
  "$IMAGE" bash /opt/smoke/src/entrypoint.sh || RC=$?

if [[ -f "$OUT/results.json" ]]; then
  node_summary="$(docker run --rm --network none -v "$OUT:/out:ro" "$IMAGE" node -e '
    const r = require("/out/results.json");
    for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? "  - " + c.detail : ""}`);
    console.log(`\n${r.checks.filter(c => c.ok).length}/${r.checks.length} checks passed (Electron ${r.versions?.electron}, Chromium ${r.versions?.chrome}, Node ${r.versions?.node})`);
  ')"
  echo "$node_summary"
fi
log "results in $OUT"
exit "$RC"
