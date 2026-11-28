#!/usr/bin/env bash
# Run a command in the pinned build image, from native/, as the host user.
#
#   native/scripts/in-image.sh cargo build --workspace
#
# - On the shared semaphore-test network only. It creates and removes no network.
# - The image tag hashes the Dockerfile, the toolchain file and the uid, so a change
#   rebuilds it and an unchanged one never does.
# - The cargo registry is shared across checkouts (NATIVE_CARGO_CACHE: another volume, or a host
#   path, which CI caches). The target directory is per
#   checkout, so parallel agents in separate worktrees don't block on one build lock.
# - The repo is mounted at its own path, so paths in output work on the host too.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

tag="$(cat "$NATIVE_DIR/docker/Dockerfile.build" "$NATIVE_DIR/rust-toolchain.toml" \
  | { cat; echo "$HOST_UID"; } | sha256sum | cut -c1-12)"
IMAGE="semaphore-native-build:$tag"

# `in-image.sh --print-name` prints the tag without pulling or building, for images layered on it
# that may be in the registry already (native/scripts/image-cache.sh).
if [ "${1:-}" = --print-name ]; then echo "$IMAGE"; exit 0; fi

# shellcheck source=image-cache.sh
. "$NATIVE_DIR/scripts/image-cache.sh"
if ! native_image_fetch "$IMAGE"; then
  echo "in-image: building $IMAGE (first use of this toolchain) ..." >&2
  native_image_build "$IMAGE" -f "$NATIVE_DIR/docker/Dockerfile.build" \
    --build-arg "HOST_UID=$HOST_UID" "$NATIVE_DIR"
fi

# `in-image.sh --print-image` builds the image if needed and prints its tag, for images layered on it.
if [ "${1:-}" = --print-image ]; then echo "$IMAGE"; exit 0; fi
# NATIVE_IMAGE runs in an image layered on this one (the video rig adds libyuv and ffmpeg).
IMAGE="${NATIVE_IMAGE:-$IMAGE}"

"$ROOT/scripts/test-net.sh" >/dev/null

# Keep the per-checkout target volume small: no incremental cache (worktrees are short-lived, and
# it was 43 GB of a 155 GB volume) and line tables only for debug info (backtraces keep file:line;
# full debug info made every test binary about 480 MB). Override either from the environment.
checkout="$(printf '%s' "$ROOT" | sha256sum | cut -c1-8)"
exec docker run --rm --init \
  --name "native-spike-build-$$" \
  --network semaphore-test \
  --user "$HOST_UID:$HOST_GID" \
  -v "$ROOT:$ROOT" \
  -v "$(native_cache_mount "${NATIVE_CARGO_CACHE:-semaphore-native-cargo}" /cache/cargo)" \
  -v "semaphore-native-target-$checkout:/cache/target" \
  -w "$NATIVE_DIR" \
  -e "CARGO_INCREMENTAL=${CARGO_INCREMENTAL:-0}" \
  -e "CARGO_PROFILE_DEV_DEBUG=${CARGO_PROFILE_DEV_DEBUG:-line-tables-only}" \
  -e "CARGO_PROFILE_TEST_DEBUG=${CARGO_PROFILE_TEST_DEBUG:-line-tables-only}" \
  ${NATIVE_DOCKER_ARGS:-} \
  "$IMAGE" "$@"
