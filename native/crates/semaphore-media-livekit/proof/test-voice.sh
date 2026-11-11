#!/usr/bin/env bash
# Runs the voice tests against a real LiveKit server. Run from anywhere.
#   native/crates/semaphore-media-livekit/proof/test-voice.sh [cargo test filter]
set -euo pipefail
NATIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export LK_STACK_NAME="${LK_STACK_NAME:-u11-livekit}"
"$NATIVE/scripts/lk-stack.sh" up 200 >/dev/null
trap '"$NATIVE/scripts/lk-stack.sh" down' EXIT
export NATIVE_DOCKER_ARGS="-e LK_URL=ws://$LK_STACK_NAME:7880 -e RUST_LOG=warn"
"$NATIVE/scripts/in-image.sh" nice -n 10 cargo test -p semaphore-media-livekit --test voice "${@:-}" -- --test-threads=4 --nocapture
