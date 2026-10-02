#!/bin/bash
# Voice E2E Runner — spins up a REAL LiveKit server alongside the e2e stack and
# runs the Playwright "voice" project against it, so voice behaviour (audio flow,
# reconnect self-heal, live device switching) is validated without a second human.
#
# HOW IT WORKS (and why this shape):
#   - LiveKit, postgres, redis, backend, frontend all run in Docker (e2e stack +
#     real livekit-e2e). The browser runs on the HOST and points at
#     http://localhost:5174. `localhost` is a browser "secure context" WITHOUT
#     TLS, which is what getUserMedia/mic-publish requires — no HTTPS, no certs,
#     no flags. (See frontend/e2e/voice/README.md.)
#   - The host overlay publishes LiveKit on localhost:7882 with node_ip 127.0.0.1
#     so the host browser's WebRTC can reach it.
#
# This is also exactly how YOU can eyeball it locally: run with --headed to watch
# real browsers join a call and hear each other.
#
#   scripts/run-voice-e2e.sh                       # all voice specs (headless)
#   scripts/run-voice-e2e.sh reconnect-asymmetry   # filter by spec name
#   scripts/run-voice-e2e.sh --headed              # watch the browsers live
#   scripts/run-voice-e2e.sh --clean               # tear down volumes after
#
# One-time host prereq: cd frontend && npx playwright install chromium
#
# NO NODE ON THE HOST? Run Playwright in Docker instead:
#
#   VOICE_E2E_PLAYWRIGHT=docker scripts/run-voice-e2e.sh [spec] [--clean]
#
# This runs the same `playwright test --project=voice` in the official
# mcr.microsoft.com/playwright image whose version matches the lockfile's
# @playwright/test, with --network host: the container's localhost IS the
# host's, so the browser still sees http://localhost:5174 (a secure context)
# and LiveKit's 127.0.0.1 candidates exactly as a host browser would. Host
# networking creates no Docker network. It runs as your uid, installs the
# frontend's node_modules into this checkout (pnpm install --frozen-lockfile,
# no install scripts) and caches corepack + the pnpm store under
# ${XDG_CACHE_HOME:-~/.cache}/semaphore-voice-e2e. --headed needs the host
# browser and is rejected in this mode. Results land in
# frontend/test-results/voice (PW_VOICE_OUTPUT_DIR) and frontend/playwright-report.
set -uo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
# shellcheck source=SCRIPTDIR/../frontend/scripts/ui-review/lib/hash.sh
source frontend/scripts/ui-review/lib/hash.sh

# The stack joins the shared, long-lived `semaphore-test` network (external in
# the compose files; created once here, never removed), so no run creates or
# removes a network: each would add/remove a host bridge, which makes
# Chromium-based browsers on the machine drop their connections.
#
# E2E_STACK (default e2e-<checkout dir>-<hash of its path>, as in run-e2e.sh)
# is the compose project name and the prefix of the container names the
# services address each other by (see docker-compose.e2e.yml). The project name
# is this checkout's own, so `down -v` can never touch the dev stack (#403) or
# another checkout's e2e stack. The host overlay publishes fixed ports (7882,
# 7883, 50000-50019/udp; and 5174 / 3001 for the frontend / backend unless
# E2E_FRONTEND_PORT / E2E_BACKEND_PORT say otherwise), so one voice stack runs
# at a time: a stack left up without --clean keeps them until `--clean` or
# `down`.
checkout_name="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9-]/-/g' | cut -c1-24)"
E2E_STACK="${E2E_STACK:-e2e-${checkout_name}-$(printf '%s' "$ROOT" | digest 256 | cut -c1-6)}"
[[ "$E2E_STACK" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo -e "${RED}E2E_STACK must be lowercase [a-z0-9_-]${NC}" >&2; exit 1; }
export E2E_STACK
COMPOSE=(docker compose -p "$E2E_STACK" -f docker-compose.e2e.yml -f docker-compose.voice-e2e.yml -f docker-compose.voice-e2e.host.yml)
CLEAN=false
HEADED=""
SPEC=""
PLAYWRIGHT_MODE="${VOICE_E2E_PLAYWRIGHT:-host}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --clean) CLEAN=true; shift ;;
    --headed) HEADED="--headed"; shift ;;
    *) SPEC="$1"; shift ;;
  esac
done

case "$PLAYWRIGHT_MODE" in
  host) ;;
  docker)
    if [ -n "$HEADED" ]; then
      echo -e "${RED}--headed needs a host browser; unset VOICE_E2E_PLAYWRIGHT to use it${NC}" >&2
      exit 1
    fi ;;
  *) echo -e "${RED}VOICE_E2E_PLAYWRIGHT must be 'host' or 'docker' (got '$PLAYWRIGHT_MODE')${NC}" >&2; exit 1 ;;
esac

# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  if [ "$CLEAN" = true ]; then
    echo -e "${YELLOW}Tearing down voice-e2e stack (volumes too)...${NC}"
    "${COMPOSE[@]}" down -v
  fi
}
trap cleanup EXIT

# --workers=1 is REQUIRED: each voice spec launches 2–3 real browsers that all
# join real LiveKit rooms. Running spec files in parallel (Playwright's default)
# puts 12+ concurrent WebRTC peers on the single dev LiveKit server, which
# overwhelms it and fails even the baselines. Serialized, each spec uses its own
# seeded channel and the suite is reliable.
PW_ARGS=(test --project=voice --workers=1 "--reporter=list,json")
[ -n "$HEADED" ] && PW_ARGS+=("$HEADED")
[ -n "$SPEC" ] && PW_ARGS+=("$SPEC")

# shared/dist must exist before the stack starts: backend-test bind-mounts
# ./shared over the image's copy and imports @semaphore-chat/shared through
# dist/ (a fresh checkout has none, and the backend then fails to compile).
# CI's host `pnpm install` builds it via the root `prepare` script.
# shellcheck disable=SC2016 # evaluated later, on the host or in the container
SHARED_STALE='[ ! -f shared/dist/index.js ] || [ -n "$(find shared/src -newer shared/dist/index.js -print 2>/dev/null | head -n 1)" ]'

if [ "$PLAYWRIGHT_MODE" = docker ]; then
  # The browser build is tied to the Playwright version, so use the image of
  # the version the lockfile pins (the same one CI's `pnpm install` gets).
  pw_version="$(sed -n "s/^  '@playwright\/test@\([0-9][0-9.]*\)':.*/\1/p" pnpm-lock.yaml | head -1)"
  if [ -z "$pw_version" ]; then
    echo -e "${RED}could not read the @playwright/test version from pnpm-lock.yaml${NC}"
    exit 1
  fi
  PW_IMAGE="${VOICE_E2E_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v${pw_version}-noble}"
  PW_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/semaphore-voice-e2e"
  mkdir -p "$PW_CACHE/home" "$PW_CACHE/corepack" "$PW_CACHE/pnpm-store" frontend/test-results || exit 1
fi

# Run a command in the Playwright image as the caller (files it writes stay
# theirs), on the host network (its localhost is the host's; no Docker network
# is created), with this checkout mounted at its own path. --ipc host gives
# Chromium real shared memory (the default 64 MB /dev/shm crashes multi-browser
# runs); --init reaps the browsers' processes. Playwright's Chromium runs
# without its sandbox by default, so it needs no root.
#
# It starts as root only to take ownership of the */node_modules directories
# Docker created as root-owned empty mountpoints (each compose stack mounts an
# anonymous node_modules volume inside the bind-mounted frontend/, backend/ and
# shared/; just the directory itself, not its contents), then drops to the
# caller's uid/gid with setpriv. `corepack enable` (pnpm on PATH, for the
# scripts that call it) only changes the throwaway container's filesystem.
pw_docker() {
  local uid gid
  uid="$(id -u)"; gid="$(id -g)"
  docker run --rm --init --network host --ipc host \
    -e HOME=/pw-cache/home \
    -e COREPACK_HOME=/pw-cache/corepack \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e npm_config_store_dir=/pw-cache/pnpm-store \
    -e CI \
    -e PW_UID="$uid" -e PW_GID="$gid" -e PW_ROOT="$ROOT" \
    -v "$PW_CACHE:/pw-cache" \
    -v "$ROOT:$ROOT" \
    -w "$ROOT" \
    "$@"
}
# The entrypoint pw_docker's commands go through (see above).
# shellcheck disable=SC2016 # expanded by the container's bash
PW_AS_CALLER='for d in "$PW_ROOT"/frontend/node_modules "$PW_ROOT"/backend/node_modules "$PW_ROOT"/shared/node_modules; do
    if [ -d "$d" ] && [ "$(stat -c %u "$d")" = 0 ]; then chown "$PW_UID:$PW_GID" "$d"; fi
  done
  corepack enable
  exec setpriv --reuid="$PW_UID" --regid="$PW_GID" --clear-groups -- "$@"'

echo -e "${GREEN}== Voice E2E ==${NC}"
if [ "$PLAYWRIGHT_MODE" = docker ]; then
  # The frontend and its workspace deps only, without install scripts (no
  # Electron download, no native builds): Playwright and tsc need none.
  echo -e "${YELLOW}Installing frontend node_modules and building shared/dist in $PW_IMAGE...${NC}"
  # shellcheck disable=SC2016 # expanded by the container's bash
  pw_docker "$PW_IMAGE" bash -c "$PW_AS_CALLER" pw-prepare bash -c 'set -e
    pnpm install --frozen-lockfile --ignore-scripts --filter "./frontend..." --reporter=append-only >/dev/null
    if '"$SHARED_STALE"'; then pnpm run build:shared >/dev/null; fi' || exit 1
else
  # The dev/e2e stacks keep frontend/node_modules in a Docker named volume, so a
  # host checkout often has an incomplete node_modules (no @playwright/test). The
  # host Playwright run needs the real package installed on the host — otherwise
  # `npx` silently fetches a mismatched global playwright that can't see this
  # repo's config (projects come back empty). Install on the host if missing.
  if [ ! -f "frontend/node_modules/@playwright/test/package.json" ]; then
    echo -e "${YELLOW}Host frontend/node_modules is missing @playwright/test; running pnpm install...${NC}"
    ( cd frontend && pnpm install )
  fi
  if eval "$SHARED_STALE"; then
    echo -e "${YELLOW}Building shared/dist...${NC}"
    pnpm run build:shared || exit 1
  fi
  if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "frontend/node_modules/playwright-core/.local-browsers" ]; then
    echo -e "${YELLOW}Installing Playwright chromium (one-time)...${NC}"
    ( cd frontend && pnpm exec playwright install chromium )
  fi
fi

echo -e "${YELLOW}Starting stack (postgres, redis, livekit, backend, frontend)...${NC}"
scripts/test-net.sh || exit 1
# --renew-anon-volumes: node_modules live in anonymous volumes, which compose
# otherwise copies into a recreated container, so a rebuilt image (new
# lockfile, e.g. a livekit-client bump) would keep running the old packages.
"${COMPOSE[@]}" up -d --build --renew-anon-volumes postgres-test redis-test livekit-e2e backend-test frontend-test

# The frontend and backend host ports are 5174 / 3001 unless E2E_FRONTEND_PORT
# / E2E_BACKEND_PORT say otherwise (0 = a random free one, e.g. still exported
# from a dockerized run), so ask compose where they ended up.
host_port() { "${COMPOSE[@]}" port "$1" "$2" 2>/dev/null | sed -n '1s/.*://p'; }
backend_port="$(host_port backend-test 3000)"
frontend_port="$(host_port frontend-test 5173)"
if [ -z "$backend_port" ] || [ -z "$frontend_port" ]; then
  echo -e "${RED}could not find the host ports of backend-test / frontend-test${NC}"
  exit 1
fi

echo -e "${YELLOW}Waiting for backend-test (:$backend_port) and frontend-test (:$frontend_port)...${NC}"
for i in $(seq 1 45); do
  # /api/health is unauthenticated; /api/livekit/* requires a JWT (would 401).
  b=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:$backend_port/api/health" 2>/dev/null) || b=000
  f=$(curl -s  -o /dev/null -w "%{http_code}" "http://localhost:$frontend_port" 2>/dev/null) || f=000
  [ "$b" = "200" ] && [ "$f" = "200" ] && break
  if [ "$i" = 45 ]; then
    echo -e "${RED}services never became healthy (backend=$b frontend=$f)${NC}"
    "${COMPOSE[@]}" logs --tail=30 backend-test
    exit 1
  fi
  sleep 3
done

echo -e "${YELLOW}Applying migrations + seeding test data...${NC}"
"${COMPOSE[@]}" exec -T backend-test pnpm run prisma:migrate >/dev/null 2>&1 || true
"${COMPOSE[@]}" exec -T backend-test pnpm run seed:e2e >/dev/null 2>&1 || true

if [ "$PLAYWRIGHT_MODE" = docker ]; then
  echo -e "${YELLOW}Running voice specs in $PW_IMAGE (host network) against http://localhost:$frontend_port ...${NC}"
  # The JSON report goes to a file so the list reporter stays readable.
  # shellcheck disable=SC2016 # expanded by the container's bash
  pw_docker \
    -e E2E_BASE_URL="http://localhost:$frontend_port" \
    -e PW_VOICE_OUTPUT_DIR="$ROOT/frontend/test-results/voice" \
    -e PLAYWRIGHT_JSON_OUTPUT_FILE="$ROOT/frontend/test-results/voice-results.json" \
    -w "$ROOT/frontend" \
    "$PW_IMAGE" bash -c "$PW_AS_CALLER" pw-run pnpm exec playwright "${PW_ARGS[@]}"
  RUN_EXIT=$?
else
  echo -e "${YELLOW}Running voice specs on the host against http://localhost:$frontend_port ...${NC}"
  # Use pnpm exec (repo-local binary), never npx — npx will fetch a mismatched
  # global playwright if the local one isn't found, which can't see this config.
  ( cd frontend && E2E_BASE_URL="http://localhost:$frontend_port" \
      pnpm exec playwright "${PW_ARGS[@]}" )
  RUN_EXIT=$?
fi

if [ "$RUN_EXIT" = 0 ]; then
  echo -e "${GREEN}Voice E2E passed.${NC}"
else
  echo -e "${RED}Voice E2E failed (exit $RUN_EXIT). See frontend/playwright-report + frontend/test-results/.${NC}"
fi
exit $RUN_EXIT
