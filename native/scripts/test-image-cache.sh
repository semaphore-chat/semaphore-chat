#!/usr/bin/env bash
# Tests image-cache.sh against a stub `docker` that logs its calls. No image, no network, no daemon.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

# The stub: `docker <cmd> ...` logs the call and exits with the code STUB_<CMD> names (0 by default).
mkdir -p "$work/bin"
cat >"$work/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
case "$1 ${2:-}" in
  "image inspect") exit "${STUB_INSPECT:-0}" ;;
  "manifest inspect")
    # STUB_MANIFEST: 0 the tag exists, 1 "manifest unknown", 2 another error.
    case "${STUB_MANIFEST:-0}" in
      0) exit 0 ;;
      1) echo "manifest unknown" >&2; exit 1 ;;
      *) echo "error pinging v2 registry: dial tcp: i/o timeout" >&2; exit 1 ;;
    esac ;;
esac
case "$1" in
  pull) exit "${STUB_PULL:-0}" ;;
  tag) exit "${STUB_TAG:-0}" ;;
  build) exit "${STUB_BUILD:-0}" ;;
  push) exit "${STUB_PUSH:-0}" ;;
esac
exit 0
STUB
chmod +x "$work/bin/docker"

# run <name> <env...> -- <bash snippet>: runs the snippet with image-cache.sh sourced, from a clean env.
run() {
  local name="$1"; shift
  local envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done
  shift
  : >"$work/log"
  env -i PATH="$work/bin:/usr/bin:/bin" STUB_LOG="$work/log" "${envs[@]}" \
    bash -c ". '$here/image-cache.sh'; $1" >"$work/out" 2>"$work/err"
  echo $? >"$work/rc"
  current="$name"
}
expect_rc() { local got; got="$(cat "$work/rc")"; [ "$got" = "$1" ] || { echo "FAIL $current: rc $got, want $1"; fail=1; }; }
expect_call() { grep -qxF -- "$1" "$work/log" || { echo "FAIL $current: no call '$1' in:"; sed 's/^/     /' "$work/log"; fail=1; }; }
expect_no() { if grep -q -- "$1" "$work/log"; then echo "FAIL $current: unexpected call matching '$1'"; fail=1; fi; }
ok() { [ "$fail" = 0 ] && echo "ok   $current"; }

img=semaphore-native-build:abc123
reg=ghcr.io/semaphore-chat

run "local image: nothing pulled" STUB_INSPECT=0 NATIVE_IMAGE_REGISTRY=$reg -- "native_image_fetch $img"
expect_rc 0; expect_no '^pull'; ok

run "no registry: a miss builds" STUB_INSPECT=1 -- "native_image_fetch $img"
expect_rc 1; expect_no '^pull'; ok

run "registry hit: pulled and tagged locally" STUB_INSPECT=1 NATIVE_IMAGE_REGISTRY=$reg -- "native_image_fetch $img"
expect_rc 0; expect_call "pull -q $reg/$img"; expect_call "tag $reg/$img $img"; ok

run "registry miss: falls back to a build" STUB_INSPECT=1 STUB_PULL=1 NATIVE_IMAGE_REGISTRY=$reg -- "native_image_fetch $img"
expect_rc 1; expect_no '^tag'; ok

run "build without push" NATIVE_IMAGE_REGISTRY=$reg -- "native_image_build $img -f D ctx"
expect_rc 0
expect_call "build -q --label org.opencontainers.image.source=https://github.com/semaphore-chat/semaphore-chat -t $img -f D ctx"
expect_no '^push'; expect_no '^manifest'; ok

run "push needs a registry" NATIVE_IMAGE_PUSH=1 -- "native_image_build $img ctx"
expect_rc 0; expect_no '^push'; expect_no '^manifest'; ok

run "push: a tag the registry calls unknown is pushed" NATIVE_IMAGE_PUSH=1 STUB_MANIFEST=1 NATIVE_IMAGE_REGISTRY=$reg -- "native_image_build $img ctx"
expect_rc 0; expect_call "tag $img $reg/$img"; expect_call "push -q $reg/$img"; ok

run "push: an existing tag is not pushed over" NATIVE_IMAGE_PUSH=1 STUB_MANIFEST=0 NATIVE_IMAGE_REGISTRY=$reg -- "native_image_build $img ctx"
expect_rc 0; expect_call "manifest inspect $reg/$img"; expect_no '^push'; ok

run "push failure only warns" NATIVE_IMAGE_PUSH=1 STUB_MANIFEST=1 STUB_PUSH=1 NATIVE_IMAGE_REGISTRY=$reg GITHUB_ACTIONS=true -- "native_image_build $img ctx"
expect_rc 0; grep -q '::warning title=Image cache::' "$work/out" || { echo "FAIL $current: no warning annotation"; fail=1; }; ok

run "build failure fails, nothing pushed" STUB_BUILD=1 NATIVE_IMAGE_PUSH=1 STUB_MANIFEST=1 NATIVE_IMAGE_REGISTRY=$reg -- "native_image_build $img ctx"
expect_rc 1; expect_no '^push'; ok

run "push: a registry error is not taken as absent" NATIVE_IMAGE_PUSH=1 STUB_MANIFEST=2 NATIVE_IMAGE_REGISTRY=$reg GITHUB_ACTIONS=true -- "native_image_build $img ctx"
expect_rc 0; expect_no '^push'; grep -q '::warning title=Image cache::not pushing' "$work/out" || { echo "FAIL $current: no warning"; fail=1; }; ok

run "a pulled image that can't be tagged is a miss" STUB_INSPECT=1 STUB_TAG=1 NATIVE_IMAGE_REGISTRY=$reg -- "native_image_fetch $img"
expect_rc 1; if grep -q 'image-cache: pulled' "$work/err"; then echo "FAIL $current: reported as pulled"; fail=1; fi; ok

run "cache mount: a volume name is passed through" -- "native_cache_mount semaphore-native-cargo /cache/cargo"
[ "$(cat "$work/out")" = "semaphore-native-cargo:/cache/cargo" ] || { echo "FAIL $current: got $(cat "$work/out")"; fail=1; }; ok

run "cache mount: a host path is created first" -- "native_cache_mount '$work/cache/cargo' /cache/cargo"
[ "$(cat "$work/out")" = "$work/cache/cargo:/cache/cargo" ] && [ -d "$work/cache/cargo" ] \
  || { echo "FAIL $current: got $(cat "$work/out")"; fail=1; }; ok

[ "$fail" = 0 ] && echo "image-cache: all tests passed" || echo "image-cache: FAILED"
exit "$fail"
