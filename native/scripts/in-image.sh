#!/usr/bin/env bash
# Run a command in the pinned build image, from native/, as the host user.
#
#   native/scripts/in-image.sh cargo build --workspace
#
# - On the shared semaphore-test network only. It creates and removes no network.
# - The image tag hashes the Dockerfile, the toolchain file and the uid, so a change
#   rebuilds it and an unchanged one never does.
# - The cargo registry is shared across checkouts. The target directory is per
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

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "in-image: building $IMAGE (first use of this toolchain) ..." >&2
  docker build -q -f "$NATIVE_DIR/docker/Dockerfile.build" \
    --build-arg "HOST_UID=$HOST_UID" -t "$IMAGE" "$NATIVE_DIR" >/dev/null
fi

"$ROOT/scripts/test-net.sh" >/dev/null

checkout="$(printf '%s' "$ROOT" | sha256sum | cut -c1-8)"
exec docker run --rm --init \
  --name "native-spike-build-$$" \
  --network semaphore-test \
  --user "$HOST_UID:$HOST_GID" \
  -v "$ROOT:$ROOT" \
  -v semaphore-native-cargo:/cache/cargo \
  -v "semaphore-native-target-$checkout:/cache/target" \
  -w "$NATIVE_DIR" \
  ${NATIVE_DOCKER_ARGS:-} \
  "$IMAGE" "$@"
