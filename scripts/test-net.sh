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
# Idempotent and safe to run concurrently. It never deletes the network, and
# nothing else should either (no `docker network rm semaphore-test`, no
# `docker network prune`). The long-running dev stack (docker-compose.yml,
# network semaphore-chat_default) is unrelated and untouched.
#
# Usage: scripts/test-net.sh        (prints nothing on success)
set -euo pipefail

NET=semaphore-test

if docker network inspect "$NET" >/dev/null 2>&1; then
  exit 0
fi

# Two callers can race here; if the create fails, succeed as long as the
# network exists now (the other caller created it).
if ! docker network create --driver bridge \
  --label org.semaphore-chat.shared-test-network=true \
  "$NET" >/dev/null 2>&1; then
  docker network inspect "$NET" >/dev/null 2>&1 || {
    echo "test-net: could not create the Docker network $NET" >&2
    exit 1
  }
fi
echo "test-net: created the shared Docker network $NET (it is never removed)" >&2
