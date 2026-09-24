#!/usr/bin/env bash
#
# Per-ticket test services and one-off backend/frontend containers, all on the
# ONE shared Docker network `semaphore-test` (see scripts/test-net.sh).
#
# Why: every Docker network create/remove adds/removes a br-* bridge with an
# IPv4 address on the host, and Chromium-based browsers drop their open
# connections on each one. A compose project creates `<project>_default` on
# its first `up`/`run` and `down` removes it, so `docker compose -p <ticket>
# ...` from a worktree (or plain `docker compose run` there, which names the
# project after the directory) churns a network per ticket. Don't do that.
# This script uses plain `docker run` on the shared network instead; it never
# creates a network other than semaphore-test and never removes any.
#
# Usage: scripts/test-stack.sh <ticket> <command> [args...]
#        scripts/test-stack.sh ls
#
#   up                  Start <ticket>-pg (postgres:17), <ticket>-redis
#                       (redis:latest) and <ticket>-minio (S3) on
#                       semaphore-test and wait until they accept connections.
#                       Idempotent. No host ports are published.
#   run [-e K=V]... <cmd...>
#                       `up`, then run <cmd> in the backend image, in
#                       backend/, with DATABASE_URL, REDIS_*, S3_* pointing at
#                       this ticket's containers by name (see `env`), e.g.
#                         run pnpm run prisma:migrate
#                         run pnpm exec jest src/messages
#                         run sh -c 'pnpm run prisma:migrate && pnpm run test:e2e'
#   run-backend [-e K=V]... <cmd...>
#                       The same container and environment as `run`, without
#                       starting the services: type-check, lint, unit tests,
#                       build, e.g. run-backend pnpm run type-check
#   run-frontend [-e K=V]... <cmd...>
#                       Run <cmd> in the frontend image, in frontend/ (the API
#                       client is generated from backend/openapi.json when
#                       missing; backend/ is at /spec), e.g.
#                         run-frontend pnpm run type-check
#                         run-frontend sh -c 'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts'
#   media               Regenerate the README/docs media from this checkout,
#                       like docker-compose.yml's `--profile tools run --rm
#                       media` (see .claude/skills/regenerate-media):
#                       <ticket>-ladle serves this checkout's Ladle (kept up
#                       for the next run; `docker restart <ticket>-ladle`
#                       after adding a *.stories.tsx file), a Playwright
#                       container in its network namespace captures, then
#                       ffmpeg encodes into frontend/.media-out/. MEDIA_STEPS
#                       and MEDIA_FILTER are passed on from the environment.
#   down                Remove this ticket's containers (the services, Ladle
#                       and any run container left behind, e.g. by a SIGKILL)
#                       and their anonymous volumes. Never touches a network.
#   ps                  List this ticket's containers.
#   env                 Print the environment `run` sets.
#   ls                  (no ticket) List every test-stack container, by ticket.
#
# <ticket>: 1-32 chars of [a-z0-9-], e.g. dw461 or fix-uploads. Names starting
# with semaphore, e2e-, uir- or kraken are reserved (the dev stack
# `semaphore-chat`, the shared network, and the run-e2e.sh / ui-review stacks).
# Every container is named <ticket>-<role>[-<pid>] and labelled
# org.semaphore-chat.test-stack.ticket=<ticket>, so tickets can run side by
# side and `down` only ever removes its own ticket's containers. Services
# reach each other by these container names, never by generic names such as
# "postgres" or "redis": several tickets share the network.
#
# The commands run in this checkout (the one this script is in): backend/,
# frontend/ and shared/ are bind-mounted like docker-compose.yml's services do,
# over content-addressed dependency images built from backend/Dockerfile and
# frontend/Dockerfile on first use (the frontend one is the same
# uir-frontend:<hash> image the UI review tool builds). Files the containers
# write as root are handed back to you afterwards, also when the script is
# interrupted (INT/TERM/HUP remove the one-off container first).
#
# Environment:
#   TEST_STACK_BACKEND_IMAGE / TEST_STACK_FRONTEND_IMAGE  use this image instead
#     of the content-addressed one (e.g. semaphore-chat-backend).
set -euo pipefail

NET=semaphore-test
LABEL=org.semaphore-chat.test-stack
# Same images as docker-compose.e2e.yml (postgres, redis) and the backend CI
# e2e job (MinIO: the upstream minio/minio Docker Hub repo is gone; see
# .github/workflows/backend-tests.yml).
PG_IMAGE=postgres:17
REDIS_IMAGE=redis:latest
MINIO_IMAGE=bitnamilegacy/minio:2025.7.23-debian-12-r5@sha256:6dabb4a2088c9a79908de3bc05f4586c23ad2182c8908e7e3acbf61c1467fb20
PG_DB=semaphore_test # "test" in the name: backend e2e resetDatabase() requires it
S3_BUCKET=semaphore-dev
# The media pipeline's images, as in docker-compose.yml's media-capture and
# media services (keep in sync).
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.60.0-jammy
FFMPEG_IMAGE=linuxserver/ffmpeg:9.0-cli-ls82

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=SCRIPTDIR/../frontend/scripts/ui-review/lib/hash.sh
source "$ROOT/frontend/scripts/ui-review/lib/hash.sh"

die() { echo "test-stack: $*" >&2; exit 1; }
log() { echo "test-stack: $*" >&2; }
usage() { sed -n '2,/^set -euo/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'; }

# ---------------------------------------------------------------- arguments

case "${1:-}" in
  -h | --help | help | "") usage; exit 0 ;;
esac
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH"
case "$1" in
  ls)
    docker ps -a --filter "label=$LABEL.ticket" \
      --format "table {{.Label \"$LABEL.ticket\"}}\t{{.Names}}\t{{.Status}}\t{{.Image}}"
    exit 0
    ;;
esac

TICKET="$1"
CMD="${2:-}"
shift 2 || die "usage: scripts/test-stack.sh <ticket> <up|run|run-backend|run-frontend|media|down|ps|env> [args...] (see --help)"

[[ "$TICKET" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]] ||
  die "invalid ticket '$TICKET': use 1-32 chars of [a-z0-9-], starting and ending with a letter or digit"
case "$TICKET" in
  semaphore* | e2e-* | uir-* | kraken*)
    die "ticket '$TICKET' is reserved (semaphore*, e2e-*, uir-*, kraken* belong to the dev stack, the shared network and the e2e / UI review stacks)"
    ;;
esac

PG="$TICKET-pg"
REDIS="$TICKET-redis"
MINIO="$TICKET-minio"

# The environment `run` / `run-backend` give the backend: this ticket's
# services by container name, test secrets, and LiveKit placeholders (the same
# ones docker-compose.e2e.yml uses; voice is not part of these stacks).
backend_env() {
  cat <<EOF
NODE_ENV=test
DATABASE_URL=postgresql://semaphore:semaphore@$PG:5432/$PG_DB
REDIS_HOST=$REDIS
REDIS_PORT=6379
JWT_SECRET=test-stack-jwt-secret
JWT_REFRESH_SECRET=test-stack-refresh-secret
SKIP_INVITE_CODE=true
LIVEKIT_URL=wss://e2e-test.livekit.cloud
LIVEKIT_API_KEY=e2e-test-api-key
LIVEKIT_API_SECRET=e2e-test-api-secret
S3_ENDPOINT=http://$MINIO:9000
S3_BUCKET=$S3_BUCKET
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_TEST_ENDPOINT=http://$MINIO:9000
S3_TEST_BUCKET=$S3_BUCKET
EOF
}

# ---------------------------------------------------------------- services

# check_ours <name>: fail unless <name> is absent or one of this ticket's.
check_ours() {
  local owner
  if owner="$(docker inspect -f "{{index .Config.Labels \"$LABEL.ticket\"}}" "$1" 2>/dev/null)"; then
    [[ "$owner" == "$TICKET" ]] ||
      die "a container named $1 exists that test-stack.sh did not create for ticket $TICKET; not touching it (pick another ticket name)"
  fi
}

# ensure_service <role> <image> [docker run args...] -- [command args...]:
# create and start <ticket>-<role> unless it exists; start it if stopped.
ensure_service() {
  local role="$1" image="$2" name="$TICKET-$1" status err i
  shift 2
  local opts=() args=()
  while [[ $# -gt 0 && "$1" != -- ]]; do opts+=("$1"); shift; done
  if [[ $# -gt 0 ]]; then shift; args=("$@"); fi

  check_ours "$name"
  if status="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null)"; then
    if [[ "$status" != running ]]; then
      log "starting $name ($status)"
      docker start "$name" >/dev/null
    fi
    return 0
  fi

  log "creating $name ($image)"
  if ! err="$(docker run -d --name "$name" --network "$NET" \
    --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=$role" \
    "${opts[@]}" "$image" ${args[@]+"${args[@]}"} 2>&1 >/dev/null)"; then
    # A concurrent `up` of the same ticket may have won the race. Docker
    # reports the name conflict before the winner's container can be
    # inspected, so give it a moment to appear (wait_ready then waits for it
    # to run).
    [[ "$err" == *Conflict* ]] || die "could not start $name: $err"
    for ((i = 0; i < 20; i++)); do
      if docker inspect "$name" >/dev/null 2>&1; then
        check_ours "$name"
        return 0
      fi
      sleep 0.5
    done
    die "could not start $name: $err"
  fi
}

# wait_ready <container> <seconds> <probe command...>: run the probe inside
# the container until it succeeds, failing early if the container dies.
wait_ready() {
  local name="$1" tries=$(($2 * 2)) i status
  shift 2
  for ((i = 0; i < tries; i++)); do
    if docker exec "$name" "$@" >/dev/null 2>&1; then return 0; fi
    status="$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null || echo missing)"
    case "$status" in
      running | restarting) ;;
      # Created by a concurrent `up` that has not started it yet (or never
      # will, if it was interrupted): starting it twice is harmless.
      created) docker start "$name" >/dev/null 2>&1 || true ;;
      *)
        docker logs --tail 30 "$name" >&2 || true
        die "$name stopped while starting ($status; logs above)"
        ;;
    esac
    sleep 0.5
  done
  docker logs --tail 30 "$name" >&2 || true
  die "$name did not become ready within $((tries / 2)) s (logs above)"
}

up() {
  "$ROOT/scripts/test-net.sh"
  # Check every name before creating anything, so a clash (another ticket's
  # or a foreign container) doesn't leave half a stack behind.
  local role
  for role in pg redis minio; do check_ours "$TICKET-$role"; done
  # Throwaway data on tmpfs, no fsync: fast and nothing left on disk.
  ensure_service pg "$PG_IMAGE" \
    -e POSTGRES_USER=semaphore -e POSTGRES_PASSWORD=semaphore -e "POSTGRES_DB=$PG_DB" \
    --tmpfs /var/lib/postgresql/data \
    --health-cmd "pg_isready -h 127.0.0.1 -U semaphore -d $PG_DB" --health-interval 5s --health-timeout 5s --health-retries 10 \
    -- postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off
  ensure_service redis "$REDIS_IMAGE" \
    --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 10s --health-retries 10 \
    -- redis-server --save '' --appendonly no
  ensure_service minio "$MINIO_IMAGE" \
    -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin -e "MINIO_DEFAULT_BUCKETS=$S3_BUCKET" \
    --health-cmd "curl -f http://localhost:9000/minio/health/live" --health-interval 5s --health-timeout 5s --health-retries 10

  # TCP, not the Unix socket: the image's first-boot init server listens only
  # on the socket and is restarted right after, so a socket probe can pass
  # before the real server is up.
  wait_ready "$PG" 60 pg_isready -h 127.0.0.1 -U semaphore -d "$PG_DB"
  # shellcheck disable=SC2016 # expanded by the container's shell
  wait_ready "$REDIS" 60 sh -c '[ "$(redis-cli ping)" = PONG ]'
  # The image's setup runs a temporary MinIO in the background to create the
  # bucket, stops it, then execs the real server as PID 1: wait for that one.
  # shellcheck disable=SC2016 # expanded by the container's shell
  wait_ready "$MINIO" 60 sh -c '[ "$(cat /proc/1/comm)" = minio ] && curl -sf http://localhost:9000/minio/health/live'
  log "ready on $NET: $PG:5432 (db $PG_DB), $REDIS:6379, $MINIO:9000 (bucket $S3_BUCKET)"
}

down() {
  local ids
  ids="$(docker ps -aq --filter "label=$LABEL.ticket=$TICKET")"
  if [[ -z "$ids" ]]; then
    log "no containers for ticket $TICKET"
    return 0
  fi
  # shellcheck disable=SC2086 # one id per word
  docker rm -f -v $ids >/dev/null
  log "removed the containers of ticket $TICKET (the $NET network stays)"
}

# ---------------------------------------------------------------- images

BACKEND_TAG_FILES=(backend/Dockerfile package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc
  shared/package.json backend/package.json)

# Content-addressed tag of the backend dependency image (like lib/hash.sh's
# image_tag for the frontend). The Prisma client in it depends on
# backend/prisma/schema.prisma, which is left out on purpose: a schema edit
# regenerates the client at run time (see prisma_label) instead of rebuilding.
backend_tag() {
  local f files=()
  for f in "${BACKEND_TAG_FILES[@]}"; do
    if [[ -f "$ROOT/$f" ]]; then files+=("$ROOT/$f"); fi
  done
  for f in "$ROOT"/patches/*; do
    if [[ -f "$f" ]]; then files+=("$f"); fi
  done
  cat -- "${files[@]}" | digest 256 | cut -c1-12
}

schema_hash() { digest 256 <"$ROOT/backend/prisma/schema.prisma" | cut -c1-12; }

# ensure_image <image> <dockerfile> [build args...]
ensure_image() {
  local image="$1" dockerfile="$2"
  shift 2
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    log "building $image from $dockerfile (first use of this dependency set; a few minutes) ..."
    docker build -q -f "$ROOT/$dockerfile" "$@" -t "$image" "$ROOT" >/dev/null
  fi
}

# Sets IMAGE to the backend / frontend image, building it if needed. (Not
# `image=$(...)`: errexit does not apply inside a command substitution, so a
# failed build would go unnoticed there.)
backend_image() {
  if [[ -n "${TEST_STACK_BACKEND_IMAGE:-}" ]]; then
    IMAGE="$TEST_STACK_BACKEND_IMAGE"
    return
  fi
  IMAGE="semaphore-test-backend:$(backend_tag)"
  ensure_image "$IMAGE" backend/Dockerfile --label "org.semaphore-chat.prisma-schema=$(schema_hash)"
}

frontend_image() {
  if [[ -n "${TEST_STACK_FRONTEND_IMAGE:-}" ]]; then
    IMAGE="$TEST_STACK_FRONTEND_IMAGE"
    return
  fi
  IMAGE="uir-frontend:$(image_tag "$ROOT")"
  ensure_image "$IMAGE" frontend/Dockerfile
}

# ---------------------------------------------------------------- run

# Hand files the (root) container wrote in the bind mounts back to the
# invoking user; node_modules (the image's, via anonymous volumes) is skipped.
hand_back() {
  local image="$1"
  shift
  (($(id -u) != 0)) || return 0
  local mounts=() d
  for d in "$@"; do mounts+=(-v "$ROOT/$d:/w/$d"); done
  docker run --rm --network none --entrypoint sh "${mounts[@]}" "$image" \
    -c "find /w -name node_modules -prune -o -user 0 -exec chown -h $(id -u):$(id -g) {} +" \
    >/dev/null 2>&1 || log "warning: could not hand root-owned files in $* back to $(id -un)"
}

# The one-off container running now (run, run-backend, run-frontend, media)
# and what to hand back afterwards (hand_back's arguments).
ONE_OFF=""
ONE_OFF_PID=""
HAND_BACK=()

# Interrupted (INT/TERM/HUP): remove the one-off container, which a stopped
# `docker run` client would otherwise leave running, hand files back, exit.
# (A SIGKILL can't be caught: `down` removes what it leaves behind.)
on_signal() {
  trap - INT TERM HUP
  if [[ -n "$ONE_OFF" ]]; then
    log "interrupted: removing $ONE_OFF"
    docker rm -f "$ONE_OFF" >/dev/null 2>&1 || true
  fi
  if [[ -n "$ONE_OFF_PID" ]]; then wait "$ONE_OFF_PID" 2>/dev/null || true; fi
  if [[ ${#HAND_BACK[@]} -gt 0 ]]; then hand_back "${HAND_BACK[@]}"; fi
  exit "$1"
}
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP

# one_off <name> <docker run args...>: `docker run --rm --init --name <name>
# ...`; sets RC to its exit status.
one_off() {
  ONE_OFF="$1"
  shift
  RC=0
  if [[ -t 0 && -t 1 ]]; then
    # Interactive: in the foreground with a TTY (Ctrl-C goes to the container).
    docker run --rm --init -it --name "$ONE_OFF" "$@" || RC=$?
  else
    # In the background, so that a signal interrupts `wait` and the trap runs
    # at once, not only after the container has exited.
    docker run --rm --init --name "$ONE_OFF" "$@" &
    ONE_OFF_PID=$!
    wait "$ONE_OFF_PID" || RC=$?
  fi
  ONE_OFF="" ONE_OFF_PID=""
}

# In the backend container, before the command: regenerate the Prisma client
# when this checkout's schema differs from the image's, and build shared/dist
# (the backend imports @semaphore-chat/shared through it; tests map it to
# src/) when it is missing or older than shared/src.
# shellcheck disable=SC2016 # expanded by the container's shell
BACKEND_PREP='set -e
if [ "${TEST_STACK_PRISMA_GENERATE:-0}" = 1 ]; then
  echo "test-stack: prisma/schema.prisma differs from the image: generating the Prisma client" >&2
  pnpm exec prisma generate >/dev/null
fi
if [ ! -f /app/shared/dist/index.js ] || [ -n "$(find /app/shared/src -newer /app/shared/dist/index.js -print 2>/dev/null | head -n 1)" ]; then
  echo "test-stack: building shared/dist" >&2
  (cd /app/shared && pnpm run build >/dev/null)
fi
exec "$@"'

# run_in <backend|frontend> [-e K=V]... <cmd...>
run_in() {
  local kind="$1"
  shift
  local env=() mounts=() prep=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -e | --env) [[ $# -ge 2 ]] || die "$1 needs KEY=VALUE"; env+=(-e "$2"); shift 2 ;;
      --) shift; break ;;
      *) break ;;
    esac
  done
  [[ $# -gt 0 ]] || die "no command given (e.g. scripts/test-stack.sh $TICKET run-$kind pnpm run type-check)"
  "$ROOT/scripts/test-net.sh"

  if [[ "$kind" == backend ]]; then
    backend_image
    local line want have defaults=()
    # The defaults go first so that -e options given on the command line win.
    while IFS= read -r line; do defaults+=(-e "$line"); done < <(backend_env)
    env=("${defaults[@]}" "${env[@]}")
    want="$(schema_hash)"
    have="$(docker image inspect -f '{{index .Config.Labels "org.semaphore-chat.prisma-schema"}}' "$IMAGE" 2>/dev/null || true)"
    if [[ "$want" != "$have" ]]; then env=(-e TEST_STACK_PRISMA_GENERATE=1 "${env[@]}"); fi
    # Mirrors docker-compose.yml's backend service: the per-package
    # node_modules come from the image via anonymous volumes; the hoisted
    # /app/node_modules is the image's own (not shadowed, not copied).
    mounts=(-v "$ROOT/backend:/app/backend" -v "$ROOT/shared:/app/shared"
      -v /app/backend/node_modules -v /app/shared/node_modules -w /app/backend)
    prep=(sh -c "$BACKEND_PREP" sh)
  else
    frontend_image
    # Mirrors docker-compose.yml's frontend service (and ui-review.sh --exec).
    mounts=(-v "$ROOT/frontend:/app/frontend" -v "$ROOT/shared:/app/shared"
      -v /app/frontend/node_modules -v /app/shared/node_modules -v "$ROOT/backend:/spec:ro" -w /app/frontend)
  fi

  HAND_BACK=("$IMAGE" "$kind" shared) # the backend/ or frontend/ dir, and shared/
  one_off "$TICKET-$kind-$$-$RANDOM" --network "$NET" \
    --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=$kind" \
    "${mounts[@]}" ${env[@]+"${env[@]}"} "$IMAGE" ${prep[@]+"${prep[@]}"} "$@"
  hand_back "${HAND_BACK[@]}"
  HAND_BACK=()
  return "$RC"
}

# ---------------------------------------------------------------- media

# The media-capture command of docker-compose.yml (keep in sync).
MEDIA_CAPTURE='mkdir -p /opt/uxshots && cd /opt/uxshots && npm init -y --silent >/dev/null &&
npm install --silent --no-audit --no-fund playwright-core@1.60.0 &&
cd /app/frontend && bash scripts/media/capture.sh'

# docker-compose.yml's `ladle` -> `media-capture` -> `media` pipeline for this
# checkout, on semaphore-test instead of the dev project's network.
media() {
  local steps="${MEDIA_STEPS:-shots,record,encode}" ladle="$TICKET-ladle" have
  "$ROOT/scripts/test-net.sh"
  case ",$steps," in
    *,shots,* | *,record,*)
      frontend_image
      check_ours "$ladle"
      if have="$(docker inspect -f '{{.Config.Image}} {{range .Mounts}}{{if eq .Destination "/app/frontend"}}{{.Source}}{{end}}{{end}}' "$ladle" 2>/dev/null)"; then
        # The same ticket used from another checkout: that Ladle is not ours.
        [[ "${have#* }" == "$ROOT/frontend" ]] ||
          die "$ladle serves another checkout (${have#* }); use a ticket name of this checkout's own"
        # Left by a run on other dependencies: replace it.
        if [[ "${have%% *}" != "$IMAGE" ]]; then
          log "replacing $ladle (${have%% *} -> $IMAGE)"
          docker rm -f "$ladle" >/dev/null
        fi
      fi
      # docker-compose.yml's ladle service without the host port (so it never
      # clashes with the dev ladle on :61000): the capture shares its network
      # namespace and opens it as localhost, a secure context, the way
      # ui-review.sh does. It stays up for the next run; `down` removes it.
      ensure_service ladle "$IMAGE" \
        -v "$ROOT/frontend:/app/frontend" -v "$ROOT/shared:/app/shared" \
        -v /app/frontend/node_modules -v /app/shared/node_modules -v "$ROOT/backend:/spec:ro" \
        -w /app/frontend \
        -- pnpm exec ladle serve --host 127.0.0.1 --port 61000
      log "waiting for Ladle in $ladle (a first start compiles for ~30 s) ..."
      wait_ready "$ladle" 300 node -e \
        "fetch('http://127.0.0.1:61000').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
      HAND_BACK=("$PLAYWRIGHT_IMAGE" frontend)
      one_off "$TICKET-media-capture-$$-$RANDOM" --network "container:$ladle" \
        --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=media-capture" \
        -v "$ROOT/frontend:/app/frontend" -w /app/frontend \
        -e MEDIA_BASE_URL=http://localhost:61000 -e MEDIA_FILTER -e MEDIA_STEPS \
        -e NODE_PATH=/opt/uxshots/node_modules \
        "$PLAYWRIGHT_IMAGE" sh -c "$MEDIA_CAPTURE"
      hand_back "${HAND_BACK[@]}"
      HAND_BACK=()
      [[ "$RC" == 0 ]] || die "the capture failed (exit $RC; see frontend/.media-out/capture.log)"
      ;;
  esac
  # The encode step (encode.sh skips itself unless MEDIA_STEPS has encode).
  HAND_BACK=("$FFMPEG_IMAGE" frontend)
  one_off "$TICKET-media-$$-$RANDOM" --network none \
    --label "$LABEL.ticket=$TICKET" --label "$LABEL.role=media" \
    -v "$ROOT/frontend:/app/frontend" -w /app/frontend -e MEDIA_STEPS \
    --entrypoint bash "$FFMPEG_IMAGE" scripts/media/encode.sh
  hand_back "${HAND_BACK[@]}"
  HAND_BACK=()
  return "$RC"
}

# ---------------------------------------------------------------- main

case "$CMD" in
  up) up ;;
  run) up; run_in backend "$@" ;;
  run-backend) run_in backend "$@" ;;
  run-frontend) run_in frontend "$@" ;;
  media)
    [[ $# -eq 0 ]] || die "media takes no arguments (set MEDIA_STEPS / MEDIA_FILTER in the environment)"
    media
    ;;
  down) down ;;
  ps)
    docker ps -a --filter "label=$LABEL.ticket=$TICKET" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
    ;;
  env) backend_env ;;
  *) die "unknown command '$CMD' (see --help)" ;;
esac
