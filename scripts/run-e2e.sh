#!/bin/bash

# E2E Test Runner Script
# Runs Playwright tests against isolated Docker containers
#
# Usage:
#   ./scripts/run-e2e.sh              # Run all tests (chromium only for speed)
#   ./scripts/run-e2e.sh --all        # Run all projects
#   ./scripts/run-e2e.sh --ui         # Run with Playwright UI (on the host)
#   ./scripts/run-e2e.sh --headed     # Run with visible browser (on the host)
#   ./scripts/run-e2e.sh auth         # Run specific test file
#   ./scripts/run-e2e.sh --grep=@smoke --project=auth-tests   # other args go to Playwright
#   ./scripts/run-e2e.sh --clean      # Clean up this checkout's e2e containers only
#
# Everything runs in Docker by default, Playwright included (the `playwright`
# service in docker-compose.e2e.yml, which shares the frontend container's
# network namespace so the app is on a secure `localhost` origin). --ui and
# --headed need a display, so they run Playwright on the host against the
# published frontend port (5174; that needs Playwright installed on the host).
#
# Network: the stack joins the shared, long-lived `semaphore-test` network
# (scripts/test-net.sh creates it once; nothing removes it). It never creates
# or removes a network of its own: each one would add/remove a host bridge,
# which makes Chromium-based browsers on the machine drop their connections.
#
# Stack name: E2E_STACK (default e2e-<checkout dir>-<hash of its path>) is the
# compose project name and the prefix of every container name, which is how
# the services address each other (see docker-compose.e2e.yml). So runs from
# different checkouts can go at the same time, and cleanup only ever removes
# this checkout's containers. In Docker mode no fixed host ports are
# published either (random ones instead; override with E2E_*_PORT).

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
# shellcheck source=SCRIPTDIR/../frontend/scripts/ui-review/lib/hash.sh
source "$PROJECT_ROOT/frontend/scripts/ui-review/lib/hash.sh"

# Parse arguments
ALL_BROWSERS=false
UI_MODE=false
HEADED=false
CLEAN_ONLY=false
TEST_PATTERN=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --all)
      ALL_BROWSERS=true
      shift
      ;;
    --ui)
      UI_MODE=true
      shift
      ;;
    --headed)
      HEADED=true
      shift
      ;;
    --clean)
      CLEAN_ONLY=true
      shift
      ;;
    -*)
      EXTRA_ARGS+=("$1")
      shift
      ;;
    *)
      TEST_PATTERN="$1"
      shift
      ;;
  esac
done

HOST_MODE=false
if [ "$UI_MODE" = true ] || [ "$HEADED" = true ]; then
  HOST_MODE=true
fi

# Per-checkout stack name (compose project + container name prefix). The e2e-
# prefix keeps it clear of the dev stack's project (see #403) and of
# scripts/test-stack.sh tickets.
checkout_name="$(basename "$PROJECT_ROOT" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9-]/-/g' | cut -c1-24)"
E2E_STACK="${E2E_STACK:-e2e-${checkout_name}-$(printf '%s' "$PROJECT_ROOT" | digest 256 | cut -c1-6)}"
[[ "$E2E_STACK" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo -e "${RED}E2E_STACK must be lowercase [a-z0-9_-]${NC}" >&2; exit 1; }
export E2E_STACK

# In Docker mode nothing on the host talks to the stack, so publish random
# host ports: concurrent runs can't collide. Host mode needs the frontend on
# its known port (5174 unless E2E_FRONTEND_PORT says otherwise).
if [ "$HOST_MODE" = false ]; then
  export E2E_POSTGRES_PORT="${E2E_POSTGRES_PORT:-0}" E2E_REDIS_PORT="${E2E_REDIS_PORT:-0}" \
    E2E_BACKEND_PORT="${E2E_BACKEND_PORT:-0}" E2E_FRONTEND_PORT="${E2E_FRONTEND_PORT:-0}"
fi

# The project name is this stack's own, so `down -v --remove-orphans` only ever
# touches this checkout's e2e containers and volumes; the network is external,
# so compose never removes it.
COMPOSE=(docker compose -p "$E2E_STACK" -f docker-compose.e2e.yml)

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Semaphore Chat E2E Test Runner                        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo -e "${BLUE}Stack: ${E2E_STACK} (network semaphore-test)${NC}"
echo ""

# Files the (root) containers wrote into the checkout (API client, dist/,
# reports, e2e/.auth) go back to the invoking user.
hand_back() {
  [ "$(id -u)" != 0 ] || return 0
  docker run --rm --network none --entrypoint sh \
    -v "$PROJECT_ROOT/frontend:/w/frontend" -v "$PROJECT_ROOT/backend:/w/backend" -v "$PROJECT_ROOT/shared:/w/shared" \
    mcr.microsoft.com/playwright:v1.60.0-jammy \
    -c "find /w -name node_modules -prune -o -user 0 -exec chown -h $(id -u):$(id -g) {} +" >/dev/null 2>&1 || true
}

cleanup() {
  echo -e "\n${YELLOW}🧹 Cleaning up Docker containers...${NC}"
  cd "$PROJECT_ROOT"
  "${COMPOSE[@]}" down -v --remove-orphans 2>/dev/null || true
  hand_back
  echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Handle cleanup only
if [ "$CLEAN_ONLY" = true ]; then
  cleanup
  exit 0
fi

# Cleanup on exit
trap cleanup EXIT

# wait_http <service> <port> <tries> <sleep>: GET http://localhost:<port> from
# inside the service's own container (no host port needed).
wait_http() {
  local service="$1" url="http://localhost:$2$3" tries="$4" pause="$5" i
  for ((i = 1; i <= tries; i++)); do
    if "${COMPOSE[@]}" exec -T "$service" node -e \
      "fetch('$url').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$pause"
  done
  return 1
}

# Step 1: Start E2E containers
echo -e "${BLUE}📦 Starting E2E Docker containers...${NC}"
cd "$PROJECT_ROOT"
"$SCRIPT_DIR/test-net.sh"
"${COMPOSE[@]}" down -v --remove-orphans 2>/dev/null || true
"${COMPOSE[@]}" up -d postgres-test redis-test

# Wait for PostgreSQL to be ready
echo -e "${YELLOW}⏳ Waiting for PostgreSQL...${NC}"
for i in {1..30}; do
  if "${COMPOSE[@]}" exec -T postgres-test pg_isready -h 127.0.0.1 -U semaphore > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PostgreSQL is ready${NC}"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo -e "${RED}✗ PostgreSQL failed to start${NC}"
    exit 1
  fi
done

# Wait for Redis to be ready
echo -e "${YELLOW}⏳ Waiting for Redis...${NC}"
for i in {1..30}; do
  if "${COMPOSE[@]}" exec -T redis-test redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Redis is ready${NC}"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo -e "${RED}✗ Redis failed to start${NC}"
    exit 1
  fi
done

# Start backend
echo -e "${BLUE}🚀 Starting backend service...${NC}"
"${COMPOSE[@]}" up -d backend-test

# Wait for backend
echo -e "${YELLOW}⏳ Waiting for backend...${NC}"
if wait_http backend-test 3000 /api/health 60 2; then
  echo -e "${GREEN}✓ Backend is ready${NC}"
else
  echo -e "${RED}✗ Backend failed to start. Logs:${NC}"
  "${COMPOSE[@]}" logs backend-test --tail=50
  exit 1
fi

# Step 2: Migrate + seed the database (volumes are fresh after `down -v`,
# so the schema must be applied before seeding — same order as CI)
echo -e "${BLUE}🗄️  Running database migrations...${NC}"
"${COMPOSE[@]}" exec -T backend-test pnpm run prisma:migrate

echo -e "${BLUE}🌱 Seeding test database...${NC}"
"${COMPOSE[@]}" exec -T backend-test npx ts-node prisma/seed-e2e.ts
echo -e "${GREEN}✓ Database seeded${NC}"

# Start frontend
echo -e "${BLUE}🌐 Starting frontend service...${NC}"
"${COMPOSE[@]}" up -d frontend-test

# Wait for frontend
echo -e "${YELLOW}⏳ Waiting for frontend...${NC}"
if wait_http frontend-test 5173 / 60 2; then
  echo -e "${GREEN}✓ Frontend is ready${NC}"
else
  echo -e "${RED}✗ Frontend failed to start. Logs:${NC}"
  "${COMPOSE[@]}" logs frontend-test --tail=50
  exit 1
fi

# Step 3: Run Playwright tests
echo ""
echo -e "${BLUE}🎭 Running Playwright tests...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

PLAYWRIGHT_ARGS=(test)
if [ "$UI_MODE" = true ]; then
  PLAYWRIGHT_ARGS+=(--ui)
elif [ "$HEADED" = true ]; then
  PLAYWRIGHT_ARGS+=(--headed)
fi
if [ "$ALL_BROWSERS" = false ] && [ "$UI_MODE" = false ]; then
  PLAYWRIGHT_ARGS+=(--project=chromium)
fi
if [ -n "$TEST_PATTERN" ]; then
  PLAYWRIGHT_ARGS+=("$TEST_PATTERN")
fi
PLAYWRIGHT_ARGS+=(${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"})

TEST_EXIT_CODE=0
if [ "$HOST_MODE" = true ]; then
  frontend_port="$("${COMPOSE[@]}" port frontend-test 5173 | sed 's/.*://')"
  echo -e "${YELLOW}Running on the host: npx playwright ${PLAYWRIGHT_ARGS[*]} (E2E_BASE_URL=http://localhost:${frontend_port})${NC}"
  echo ""
  (cd "$PROJECT_ROOT/frontend" && E2E_BASE_URL="http://localhost:${frontend_port}" npx playwright "${PLAYWRIGHT_ARGS[@]}") || TEST_EXIT_CODE=$?
else
  echo -e "${YELLOW}Running in Docker: playwright ${PLAYWRIGHT_ARGS[*]}${NC}"
  echo ""
  "${COMPOSE[@]}" run --rm playwright /app/node_modules/.bin/playwright "${PLAYWRIGHT_ARGS[@]}" || TEST_EXIT_CODE=$?
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
else
  echo -e "${RED}❌ Some tests failed (exit code: $TEST_EXIT_CODE)${NC}"
  echo -e "${YELLOW}📊 Report: frontend/playwright-report/ (npm run test:e2e:report)${NC}"
fi

exit $TEST_EXIT_CODE
