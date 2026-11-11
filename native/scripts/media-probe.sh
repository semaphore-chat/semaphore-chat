#!/usr/bin/env bash
# Prove the release binary's media stack works: start LiveKit on semaphore-test, mint a
# token, have semaphore-app join and leave a room, and confirm the server saw it.
#
#   native/scripts/media-probe.sh
#
# Expects the release binary to be built already. The server always comes down afterwards.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${LK_STACK_NAME:-native-spike-livekit}"
CLI_IMAGE=livekit/livekit-cli@sha256:04eff828f8edd810b996c18456a6260ba0698a60f8ea309d0f015c2b09696413
ROOM=native-media-probe

trap '"$SCRIPTS/lk-stack.sh" down' EXIT
"$SCRIPTS/lk-stack.sh" up >/dev/null

token="$(docker run --rm "$CLI_IMAGE" token create \
    --api-key devkey --api-secret secret-that-is-at-least-32-characters-long \
    --join --room "$ROOM" --identity probe --valid-for 5m 2>&1 \
  | sed -n 's/^Access token: *//p')"
[ -n "$token" ] || { echo "media-probe: could not mint a token" >&2; exit 1; }

"$SCRIPTS/in-image.sh" /cache/target/release/semaphore-app --probe-media "ws://$NAME:7880" "$token"

# The binary's own word isn't enough: the server must have started this session.
docker logs "$NAME" 2>&1 | grep -F 'starting RTC session' | grep -F '"participant": "probe"' \
  | cut -c1-120
