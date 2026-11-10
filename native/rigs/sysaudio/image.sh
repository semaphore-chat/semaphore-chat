#!/usr/bin/env bash
# Print the T11 image tag, building it (and the build image under it) on first use.
set -euo pipefail
NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
base_tag="$(cat "$NATIVE_DIR/docker/Dockerfile.build" "$NATIVE_DIR/rust-toolchain.toml" \
  | { cat; echo "$(id -u)"; } | sha256sum | cut -c1-12)"
BASE="semaphore-native-build:$base_tag"
if ! docker image inspect "$BASE" >/dev/null 2>&1; then
  "$NATIVE_DIR/scripts/in-image.sh" true
fi
tag="$( { echo "$BASE"; cat "$NATIVE_DIR/docker/Dockerfile.sysaudio"; } | sha256sum | cut -c1-12)"
IMAGE="semaphore-native-sysaudio:$tag"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "image: building $IMAGE" >&2
  docker build -q -f "$NATIVE_DIR/docker/Dockerfile.sysaudio" --build-arg "BASE=$BASE" \
    -t "$IMAGE" "$NATIVE_DIR/docker" >/dev/null
fi
echo "$IMAGE"
