#!/usr/bin/env bash
# Runs the camera and screen share tests against a real LiveKit server. Run from anywhere.
#   native/crates/semaphore-media-livekit/proof/test-video.sh [cargo test filter]
set -euo pipefail
NATIVE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export LK_STACK_NAME="${LK_STACK_NAME:-av-video-livekit}"
"$NATIVE/scripts/lk-stack.sh" up 200 >/dev/null
trap '"$NATIVE/scripts/lk-stack.sh" down' EXIT
export NATIVE_DOCKER_ARGS="-e LK_URL=ws://$LK_STACK_NAME:7880 -e RUST_LOG=warn"
"$NATIVE/scripts/in-image.sh" nice -n 10 cargo test --locked -p semaphore-media-livekit --test video "${@:-}" -- --test-threads=4 --nocapture
