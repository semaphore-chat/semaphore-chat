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
# another checkout's e2e stack. The host overlay publishes fixed ports (5174,
# 3001, 7882, 7883, 50000-50019/udp), so one voice stack runs at a time: a
# stack left up without --clean keeps them until `--clean` or `down`.
checkout_name="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9-]/-/g' | cut -c1-24)"
E2E_STACK="${E2E_STACK:-e2e-${checkout_name}-$(printf '%s' "$ROOT" | digest 256 | cut -c1-6)}"
export E2E_STACK
COMPOSE=(docker compose -p "$E2E_STACK" -f docker-compose.e2e.yml -f docker-compose.voice-e2e.yml -f docker-compose.voice-e2e.host.yml)
CLEAN=false
HEADED=""
SPEC=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --clean) CLEAN=true; shift ;;
    --headed) HEADED="--headed"; shift ;;
    *) SPEC="$1"; shift ;;
  esac
done

# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  if [ "$CLEAN" = true ]; then
    echo -e "${YELLOW}Tearing down voice-e2e stack (volumes too)...${NC}"
    "${COMPOSE[@]}" down -v
  fi
}
trap cleanup EXIT

echo -e "${GREEN}== Voice E2E ==${NC}"
echo -e "${YELLOW}Starting stack (postgres, redis, livekit, backend, frontend)...${NC}"
scripts/test-net.sh || exit 1
"${COMPOSE[@]}" up -d --build postgres-test redis-test livekit-e2e backend-test frontend-test

echo -e "${YELLOW}Waiting for backend-test (:3001) and frontend-test (:5174)...${NC}"
for i in $(seq 1 45); do
  # /api/health is unauthenticated; /api/livekit/* requires a JWT (would 401).
  b=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null || echo 000)
  f=$(curl -s  -o /dev/null -w "%{http_code}" http://localhost:5174 2>/dev/null || echo 000)
  [ "$b" = "200" ] && [ "$f" = "200" ] && break
  sleep 3
  [ "$i" = 45 ] && { echo -e "${RED}services never became healthy (backend=$b frontend=$f)${NC}"; exit 1; }
done

echo -e "${YELLOW}Applying migrations + seeding test data...${NC}"
"${COMPOSE[@]}" exec -T backend-test pnpm run prisma:migrate >/dev/null 2>&1 || true
"${COMPOSE[@]}" exec -T backend-test pnpm run seed:e2e >/dev/null 2>&1 || true

echo -e "${YELLOW}Running voice specs on the host against http://localhost:5174 ...${NC}"

# The dev/e2e stacks keep frontend/node_modules in a Docker named volume, so a
# host checkout often has an incomplete node_modules (no @playwright/test). The
# host Playwright run needs the real package installed on the host — otherwise
# `npx` silently fetches a mismatched global playwright that can't see this
# repo's config (projects come back empty). Install on the host if missing.
if [ ! -f "frontend/node_modules/@playwright/test/package.json" ]; then
  echo -e "${YELLOW}Host frontend/node_modules is missing @playwright/test; running pnpm install...${NC}"
  ( cd frontend && pnpm install )
fi

if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "frontend/node_modules/playwright-core/.local-browsers" ]; then
  echo -e "${YELLOW}Installing Playwright chromium (one-time)...${NC}"
  ( cd frontend && pnpm exec playwright install chromium )
fi

# Use pnpm exec (repo-local binary), never npx — npx will fetch a mismatched
# global playwright if the local one isn't found, which can't see this config.
#
# --workers=1 is REQUIRED: each voice spec launches 2–3 real browsers that all
# join real LiveKit rooms. Running spec files in parallel (Playwright's default)
# puts 12+ concurrent WebRTC peers on the single dev LiveKit server, which
# overwhelms it and fails even the baselines. Serialized, each spec uses its own
# seeded channel and the suite is reliable.
( cd frontend && E2E_BASE_URL=http://localhost:5174 \
    pnpm exec playwright test --project=voice --workers=1 --reporter=list,json $HEADED ${SPEC:+"$SPEC"} )
RUN_EXIT=$?

if [ "$RUN_EXIT" = 0 ]; then
  echo -e "${GREEN}Voice E2E passed.${NC}"
else
  echo -e "${RED}Voice E2E failed (exit $RUN_EXIT). See frontend/playwright-report + frontend/test-results/.${NC}"
fi
exit $RUN_EXIT
