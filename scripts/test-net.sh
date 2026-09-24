#!/usr/bin/env bash
#
# Ensures the shared Docker network for every ephemeral test/dev stack exists.
#
# Every `docker network create`/`rm` adds or removes a br-* bridge with an IPv4
# address on the host. Chromium-based browsers on the same machine treat that
# as a network change and drop their open connections, so per-ticket or
# per-run networks (dw461_default, uir-*_default, ...) kept interrupting
# browsing. Instead, all test containers join ONE long-lived network,
# `semaphore-test`, created once by this script and never removed:
#
#   - scripts/test-stack.sh (per-ticket postgres/redis/minio + one-off
#     backend/frontend commands)
#   - docker-compose.e2e.yml / docker-compose.voice-e2e.yml (external network)
#     via scripts/run-e2e.sh and scripts/run-voice-e2e.sh
#   - frontend/scripts/ui-review/compose.yml via ui-review.sh
#
# It also keeps one idle container attached to the network,
# `semaphore-test-anchor` (alpine, `sleep infinity`, restart unless-stopped).
# Between test runs the network would otherwise have no containers, and then
# `docker network prune` / `docker system prune` delete it, so the next run
# would create it again: the very add/remove this avoids. With the anchor the
# network is never unused, and its bridge stays up instead of toggling its
# carrier as the first test container joins and the last one leaves.
#
# Idempotent and safe to run concurrently. It never deletes the network or the
# anchor, and nothing else should either (no `docker network rm
# semaphore-test`, no `docker network prune`). The long-running dev stack
# (docker-compose.yml, network semaphore-chat_default) is unrelated and
# untouched. To remove both for good, by hand:
#   docker rm -f semaphore-test-anchor && docker network rm semaphore-test
#
# Usage: scripts/test-net.sh        (prints nothing when all is in place)
set -euo pipefail

NET=semaphore-test
ANCHOR=semaphore-test-anchor
ANCHOR_IMAGE=alpine:3
LABEL=org.semaphore-chat.shared-test-network

die() { echo "test-net: $*" >&2; exit 1; }
warn() { echo "test-net: warning: $*" >&2; }

# "true attached" when the anchor is running on the network.
anchor_state() {
  docker inspect -f "{{.State.Running}} {{with index .NetworkSettings.Networks \"$NET\"}}attached{{end}}" \
    "$ANCHOR" 2>/dev/null
}

# Fast path: the anchor is running on the network, so the network exists.
if [[ "$(anchor_state)" == "true attached" ]]; then
  exit 0
fi

# Tell "not there yet" apart from "Docker is missing or unreachable", so a
# broken Docker is never reported as a network problem.
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH"
if ! err="$(docker version --format '{{.Server.Version}}' 2>&1 >/dev/null)"; then
  die "cannot reach the Docker daemon: ${err:-docker version failed}"
fi

if ! docker network inspect "$NET" >/dev/null 2>&1; then
  # Two callers can race here; if the create fails, succeed as long as the
  # network exists now (the other caller created it).
  if err="$(docker network create --driver bridge --label "$LABEL=true" "$NET" 2>&1 >/dev/null)"; then
    echo "test-net: created the shared Docker network $NET (it is never removed)" >&2
  else
    docker network inspect "$NET" >/dev/null 2>&1 || die "could not create the Docker network $NET: $err"
  fi
fi

# The anchor is hardening, not a prerequisite: if it can't be started, warn
# and carry on (the network exists). A concurrent caller may win the create.
if docker inspect "$ANCHOR" >/dev/null 2>&1; then
  state="$(anchor_state)"
  if [[ "$state" != *attached ]]; then
    docker network connect "$NET" "$ANCHOR" >/dev/null 2>&1 || warn "could not attach $ANCHOR to $NET"
  fi
  if [[ "$state" != true* ]]; then
    docker start "$ANCHOR" >/dev/null 2>&1 || warn "could not start $ANCHOR (see docker logs $ANCHOR)"
  fi
elif ! err="$(docker run -d --name "$ANCHOR" --network "$NET" --restart unless-stopped --init \
  --label "$LABEL=anchor" "$ANCHOR_IMAGE" sleep infinity 2>&1 >/dev/null)"; then
  docker inspect "$ANCHOR" >/dev/null 2>&1 || [[ "$err" == *Conflict* ]] ||
    warn "could not start $ANCHOR, the idle container that keeps $NET in use: $err"
fi
