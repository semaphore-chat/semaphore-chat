# shellcheck shell=bash
# Sourced by the scripts that build native/'s pinned images (in-image.sh, android.sh,
# android-device-test.sh, package-linux.sh, package-windows.sh, test-package-windows.sh).
#
# Each image keeps its local name, semaphore-native-<kind>:<hash>, where the hash covers every
# file the image is built from. With NATIVE_IMAGE_REGISTRY set (CI sets ghcr.io/semaphore-chat),
# an image missing locally is pulled from <registry>/<local name> before it is built, and with
# NATIVE_IMAGE_PUSH=1 a freshly built one is pushed there, once: a tag that already exists is
# never overwritten. There is no `latest`; a changed input is a new hash, so a new tag.
#
#   native_image_fetch <image>          0 if <image> is here, locally or pulled; 1 if it must be built
#   native_image_build <image> <docker build args...>   builds it as <image> (-q), then pushes it
#
# Neither unset: nothing is pulled or pushed, and the scripts build locally exactly as before.

NATIVE_IMAGE_SOURCE_URL="https://github.com/semaphore-chat/semaphore-chat"

native_image_fetch() {
  local image="$1" remote
  docker image inspect "$image" >/dev/null 2>&1 && return 0
  [ -n "${NATIVE_IMAGE_REGISTRY:-}" ] || return 1
  remote="$NATIVE_IMAGE_REGISTRY/$image"
  echo "image-cache: pulling $remote ..." >&2
  # A miss and a registry outage both fall back to a build: the run is never worse than without
  # the registry.
  if docker pull -q "$remote" >/dev/null 2>&1; then
    docker tag "$remote" "$image"
    echo "image-cache: pulled $remote" >&2
    return 0
  fi
  echo "image-cache: $remote is not in the registry (or the pull failed); building it" >&2
  return 1
}

native_image_build() {
  local image="$1" remote
  shift
  # The source label links a pushed package to this repository on GHCR.
  docker build -q --label "org.opencontainers.image.source=$NATIVE_IMAGE_SOURCE_URL" \
    -t "$image" "$@" >/dev/null || return 1
  [ -n "${NATIVE_IMAGE_REGISTRY:-}" ] && [ "${NATIVE_IMAGE_PUSH:-0}" = 1 ] || return 0
  remote="$NATIVE_IMAGE_REGISTRY/$image"
  # Write once: whoever pushed the tag first wins, and the same hash names the same inputs.
  if docker manifest inspect "$remote" >/dev/null 2>&1; then
    echo "image-cache: $remote already exists; not pushing" >&2
    return 0
  fi
  echo "image-cache: pushing $remote ..." >&2
  docker tag "$image" "$remote"
  # A failed push only costs the next run a build, so it warns and does not fail the job.
  if docker push -q "$remote" >/dev/null; then
    echo "image-cache: pushed $remote" >&2
  else
    echo "image-cache: pushing $remote failed; the next run builds it again" >&2
    [ -z "${GITHUB_ACTIONS:-}" ] || echo "::warning title=Image cache::pushing $remote failed"
  fi
  return 0
}

# A cache mount for `docker run -v`: a named volume, or an absolute host path (CI points these at
# directories actions/cache saves and restores). A path is created first, so Docker does not
# create it owned by root.
native_cache_mount() { # <volume-or-absolute-path> <container path>
  case "$1" in
    /*) mkdir -p "$1" ;;
  esac
  printf '%s:%s' "$1" "$2"
}
