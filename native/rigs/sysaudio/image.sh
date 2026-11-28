#!/usr/bin/env bash
# Print the T11 image tag, pulling or building it (and the build image under it) on first use.
set -euo pipefail
NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The build image's name only: it is pulled or built below only if this image has to be built.
BASE="$("$NATIVE_DIR/scripts/in-image.sh" --print-name)"
# Everything the image is built from: the base and the Dockerfile (it copies no files).
tag="$( { echo "$BASE"; cat "$NATIVE_DIR/docker/Dockerfile.sysaudio"; } | sha256sum | cut -c1-12)"
IMAGE="semaphore-native-sysaudio:$tag"
# shellcheck source=../../scripts/image-cache.sh
. "$NATIVE_DIR/scripts/image-cache.sh"
if ! native_image_fetch "$IMAGE"; then
  "$NATIVE_DIR/scripts/in-image.sh" --print-image >/dev/null
  echo "image: building $IMAGE" >&2
  native_image_build "$IMAGE" -f "$NATIVE_DIR/docker/Dockerfile.sysaudio" --build-arg "BASE=$BASE" \
    "$NATIVE_DIR/docker"
fi
echo "$IMAGE"
