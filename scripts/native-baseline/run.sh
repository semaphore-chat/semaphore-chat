#!/usr/bin/env bash
#
# Repeatable resource baseline of the packaged Electron app. See README.md.
#
# Usage: scripts/native-baseline/run.sh [options]
#
#   --ticket NAME        test-stack ticket (default native-baseline)
#   --app DIR            linux-unpacked directory (default: this checkout's)
#   --build              package this checkout first
#   --out DIR            results directory (default scripts/native-baseline/out;
#                        an earlier run's directory is emptied first, any other
#                        non-empty directory is refused)
#   --steps LIST         comma list (default: all; disk is always measured):
#                        cold, a_idle, a_noinstrument, b_scroll, c_voice_audio, d_video_grid,
#                        e_idle_growth, probe_angle_lavapipe
#   --messages N         history size in #general (default 5000)
#   --window-scale X     multiply settle and measurement windows (dev runs)
#   --cold-runs N        cold-start runs per variant (default from scenarios.json)
#   --no-load-wait       start each step at once instead of waiting up to 3 minutes
#                        for the load average to drain (dev runs on a busy machine)
#   --release TAG        release whose download sizes to report (default latest)
#   --host               run the app on this desktop, not in the container
#   --no-sandbox         with --host, if Chromium's sandbox can't start here
#   --keep               leave the backend, LiveKit and databases running
#
# Writes <out>/results.json, valid against result.schema.json. Exits 2 if it is
# invalid, 3 if it is valid but a scenario failed validation.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NET=semaphore-test
LABEL=org.semaphore-chat.test-stack
LIVEKIT_IMAGE=livekit/livekit-server:v1.13.7
LIVEKIT_KEY=devkey
LIVEKIT_SECRET=secret-that-is-at-least-32-characters-long
CDP_PORT=19222
ALL_STEPS=cold,a_idle,a_noinstrument,b_scroll,c_voice_audio,d_video_grid,e_idle_growth,probe_angle_lavapipe

die() { echo "native-baseline: $*" >&2; exit 1; }
log() { echo "native-baseline: $*" >&2; }

TICKET=native-baseline
APP="$ROOT/frontend/release/linux-unpacked"
OUT="$HERE/out"
STEPS="$ALL_STEPS"
MESSAGES=5000
SCALE=1
COLD_RUNS=0
LOAD_WAIT=180
RELEASE=
BUILD=false KEEP=false HOST=false NO_SANDBOX_FLAG=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ticket) TICKET="$2"; shift 2 ;;
    --app) APP="$(cd "$2" && pwd)"; shift 2 ;;
    --build) BUILD=true; shift ;;
    --out) mkdir -p "$2"; OUT="$(cd "$2" && pwd)"; shift 2 ;;
    --steps) STEPS="$2"; shift 2 ;;
    --messages) MESSAGES="$2"; shift 2 ;;
    --window-scale) SCALE="$2"; shift 2 ;;
    --cold-runs) COLD_RUNS="$2"; shift 2 ;;
    --no-load-wait) LOAD_WAIT=0; shift ;;
    --release) RELEASE="$2"; shift 2 ;;
    --host) HOST=true; shift ;;
    --no-sandbox) NO_SANDBOX_FLAG=true; shift ;;
    --keep) KEEP=true; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
done
[[ "$MESSAGES" =~ ^[1-9][0-9]*$ ]] || die "--messages must be a positive integer"
has_step() { [[ ",$STEPS," == *",$1,"* ]]; }

mkdir -p "$OUT"
if [[ -n "$(ls -A "$OUT")" ]]; then
  [[ -f "$OUT/.native-baseline" ]] || die "$OUT is not empty and not a baseline results directory; pass another --out"
  find "$OUT" -mindepth 1 -delete
fi
touch "$OUT/.native-baseline"

STACK=("$ROOT/scripts/test-stack.sh" "$TICKET")
BACKEND_PID=""
PUBLISHERS="$TICKET-publishers"
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  docker rm -f "$PUBLISHERS" >/dev/null 2>&1 || true
  if [[ "$KEEP" == false ]]; then
    if [[ -n "$BACKEND_PID" ]]; then
      kill "$BACKEND_PID" 2>/dev/null || true
      wait "$BACKEND_PID" 2>/dev/null || true
    fi
    "${STACK[@]}" down || true
  fi
}
trap cleanup EXIT

if [[ "$BUILD" == true ]]; then
  log "packaging this checkout"
  "${STACK[@]}" run-frontend sh -c 'pnpm run build:all && pnpm run electron-builder:linux --dir --publish never'
fi
[[ -x "$APP/semaphore-chat" ]] || die "no packaged app at $APP (run with --build, or pass --app)"

IMAGE="native-baseline:$(sha256sum "$HERE/Dockerfile" | cut -c1-12)"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  log "building $IMAGE"
  docker build -q -t "$IMAGE" "$HERE" >/dev/null
fi

# frontend/package.json stays at 0.0.1; releases are versioned by their tag.
BUILD_VERSION="$(git -C "$ROOT" describe --tags --always)"
BUILD_COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"

# Tools on the shared network; the run writes as this user.
tool() {
  docker run --rm --init --network "$NET" --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=baseline-tool" \
    -u "$(id -u):$(id -g)" -e HOME=/tmp/home -e PYTHONDONTWRITEBYTECODE=1 \
    -v "$APP:/app:ro" -v "$HERE:/opt/baseline/src:ro" -v "$OUT:/out" "$IMAGE" "$@"
}

# ------------------------------------------------------------ disk (no services)
log "measuring disk footprint"
TAG_ARGS=()
[[ -n "$RELEASE" ]] && TAG_ARGS=("$RELEASE")
ASSET_ARGS=()
if gh release view "${TAG_ARGS[@]}" --repo semaphore-chat/semaphore-chat --json tagName,assets \
    --jq '{source: .tagName, assets: [.assets[] | {name, size}]}' >"$OUT/release-assets.json" 2>/dev/null; then
  ASSET_ARGS=(--release-assets /out/release-assets.json)
else
  log "could not read release assets: disk.artifacts will be empty"
  rm -f "$OUT/release-assets.json"
fi
tool python3 /opt/baseline/src/disk.py analyze /app "${ASSET_ARGS[@]}" >"$OUT/disk.json"

# ------------------------------------------------------------ services
# LiveKit gets 200 ICE ports below: with 20, only 3 of scenario d's 11 peers
# connect, and the server logs no port errors.
"$ROOT/scripts/test-net.sh" >/dev/null
"${STACK[@]}" up
LIVEKIT="$TICKET-livekit"
if ! docker inspect "$LIVEKIT" >/dev/null 2>&1; then
  log "starting $LIVEKIT"
  docker run -d --name "$LIVEKIT" --network "$NET" \
    --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=livekit" \
    -e LIVEKIT_CONFIG="$(printf '%s\n' \
      'port: 7880' 'rtc:' '  tcp_port: 7881' \
      '  port_range_start: 50000' '  port_range_end: 50199' \
      '  use_external_ip: false' \
      'redis:' "  address: $TICKET-redis:6379" \
      'keys:' "  $LIVEKIT_KEY: $LIVEKIT_SECRET")" \
    "$LIVEKIT_IMAGE" >/dev/null
fi
ip_of() { docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$1"; }

# On the desktop the app can't resolve container names; the bridge IPs are
# routable from the host, so nothing has to be published.
LIVEKIT_PUBLIC="ws://$LIVEKIT:7880"
[[ "$HOST" == true ]] && LIVEKIT_PUBLIC="ws://$(ip_of "$LIVEKIT"):7880"

backend_container() {
  docker ps -q --filter "label=$LABEL.ticket=$TICKET" --filter "label=$LABEL.role=backend" | head -n 1
}
BACKEND_ID="$(backend_container)"
if [[ -z "$BACKEND_ID" ]]; then
  log "starting the backend (migrate, seed the e2e users, nest start)"
  # CORS_ORIGIN=null: the packaged app is a file:// page.
  "${STACK[@]}" run \
    -e CORS_ORIGIN=null \
    -e "LIVEKIT_URL=$LIVEKIT_PUBLIC" -e "LIVEKIT_INTERNAL_URL=http://$LIVEKIT:7880" \
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

# ------------------------------------------------------------ seed
log "seeding $MESSAGES messages into #general"
tool node /opt/baseline/src/seed/gen-history.ts \
  --server "http://$BACKEND:3000" --messages "$MESSAGES" --manifest /out/seed.json >"$OUT/history.sql"
docker exec -i "$TICKET-pg" psql -q -v ON_ERROR_STOP=1 -U semaphore -d semaphore_test <"$OUT/history.sql" >/dev/null
rm -f "$OUT/history.sql"

# ------------------------------------------------------------ measuring
SERVER="http://$BACKEND:3000"
COMMON=(--window-scale "$SCALE" --cold-runs "$COLD_RUNS" --load-wait "$LOAD_WAIT" --build-version "$BUILD_VERSION" --build-commit "$BUILD_COMMIT")
if [[ "$HOST" == true ]]; then
  SERVER="http://$(ip_of "$BACKEND"):3000"
  DRIVER="docker run --rm -i --network host -e BASELINE_CDP=http://127.0.0.1:$CDP_PORT -u $(id -u):$(id -g) -v $HERE:/opt/baseline/src:ro $IMAGE node /opt/baseline/src/driver.ts"
  SANDBOX_ARGS=()
  [[ "$NO_SANDBOX_FLAG" == true ]] && SANDBOX_ARGS=(--no-sandbox)
  # Python stdlib only, like the native harness; Node stays in the container.
  step() {
    PYTHONDONTWRITEBYTECODE=1 python3 "$HERE/baseline.py" "$@" --mode host --app "$APP" --out "$OUT" \
      --profile "$OUT/profile" --server "$SERVER" --driver "$DRIVER" "${SANDBOX_ARGS[@]}" "${COMMON[@]}"
  }
else
  # A fresh container per step, so nothing carries over except the profile.
  step() {
    docker run --rm --init --name "$TICKET-baseline-$$" --network "$NET" \
      --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=baseline" \
      --shm-size 1g -u "$(id -u):$(id -g)" -e HOME=/tmp/home -e PYTHONDONTWRITEBYTECODE=1 \
      -v "$APP:/app:ro" -v "$HERE:/opt/baseline/src:ro" -v "$OUT:/out" "$IMAGE" \
      xvfb-run -a -s "-screen 0 1920x1080x24" \
      python3 /opt/baseline/src/baseline.py "$@" --no-sandbox --server "$SERVER" "${COMMON[@]}"
  }
fi

start_publishers() {
  local scenario="$1" channel="$2" room
  room="$(tool python3 -c 'import json,sys; print(json.load(open("/out/seed.json"))["channels"][sys.argv[1]])' "$channel")"
  docker rm -f "$PUBLISHERS" >/dev/null 2>&1 || true
  log "starting publishers for $scenario in room $room"
  docker run -d --init --name "$PUBLISHERS" --network "$NET" \
    --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=publishers" \
    -u "$(id -u):$(id -g)" -e HOME=/tmp/home \
    -e "LIVEKIT_URL=ws://$LIVEKIT:7880" -e "LIVEKIT_API_KEY=$LIVEKIT_KEY" -e "LIVEKIT_API_SECRET=$LIVEKIT_SECRET" \
    -e "ROOM=$room" -e "SCENARIO=$scenario" -e SEED_FILE=/out/seed.json \
    -e SCENARIOS_FILE=/opt/baseline/src/scenarios.json -e "REPORT_FILE=/out/publishers-$scenario.json" \
    -v "$HERE:/opt/baseline/src:ro" -v "$OUT:/out" -w /opt/baseline/src/publishers \
    "$IMAGE" node publish.ts >/dev/null
  for i in $(seq 1 120); do
    docker logs "$PUBLISHERS" 2>/dev/null | grep -q '^READY$' && return 0
    if [[ "$(docker inspect -f '{{.State.Running}}' "$PUBLISHERS")" != true ]]; then
      docker logs --tail 40 "$PUBLISHERS" >&2
      return 1
    fi
    [[ "$i" -lt 120 ]] || { docker logs --tail 40 "$PUBLISHERS" >&2; return 1; }
    sleep 1
  done
}
stop_publishers() {
  docker logs "$PUBLISHERS" >"$OUT/publishers-$1.log" 2>&1 || true
  docker stop -t 15 "$PUBLISHERS" >/dev/null 2>&1 || true
  docker rm -f "$PUBLISHERS" >/dev/null 2>&1 || true
}

log "signing in on a fresh profile"
step prep
log "recording the environment"
step env

has_step cold && { log "cold start"; step cold-start; }
for scenario in a_idle a_noinstrument b_scroll; do
  has_step "$scenario" && { log "scenario $scenario"; step scenario "$scenario"; }
done
if has_step c_voice_audio; then
  log "scenario c_voice_audio"
  start_publishers c_voice_audio voice-chat || die "publishers for c_voice_audio did not start"
  step scenario c_voice_audio
  stop_publishers c_voice_audio
fi
if has_step d_video_grid; then
  log "scenario d_video_grid"
  # Failing to publish is a failed scenario, not a dead run.
  if start_publishers d_video_grid voice-video; then
    step scenario d_video_grid
  else
    log "publishers for d_video_grid did not start: recorded as failed"
    tool python3 -c '
import json, os, sys
sys.path.insert(0, "/opt/baseline/src")
import baseline
raw = open("/proc/loadavg").read().strip()
load = baseline.load_report(raw, raw, [], os.cpu_count(), 0.25)
json.dump({"title": "Receiving 9x 720p30 cameras and 1x 1080p60 screen share", "ok": False, "best_effort": False,
           "errors": ["synthetic publishers did not start; see publishers-d_video_grid.log"],
           "window_s": None, "cpu_pct_core": None, "memory_mb": None, "load": load, "provisional": load["provisional"]},
          open("/out/scenario-d_video_grid.json", "w"), indent=1)'
  fi
  stop_publishers d_video_grid
fi
has_step e_idle_growth && { log "scenario e_idle_growth"; step scenario e_idle_growth; }
if has_step probe_angle_lavapipe; then
  if [[ "$HOST" == true ]]; then
    log "skipping probe_angle_lavapipe on --host (it forces software Vulkan)"
  else
    log "probe_angle_lavapipe (best effort)"
    step scenario probe_angle_lavapipe || log "the probe failed; carrying on"
  fi
fi

RC=0
tool python3 /opt/baseline/src/baseline.py assemble --mode "$([[ "$HOST" == true ]] && echo host || echo container)" "${COMMON[@]}" || RC=$?
log "results in $OUT/results.json"
exit "$RC"
