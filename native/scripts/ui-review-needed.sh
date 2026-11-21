#!/usr/bin/env bash
# Decides whether the native UI review (ui-review.sh, 1.5-2 h) has to run for a change.
#
#   git diff --name-only <base>...HEAD | native/scripts/ui-review-needed.sh
#
# Reads changed paths on stdin (repo-relative, one per line) and prints `run` if any of them can
# change what the desktop app draws, otherwise `skip`. Prints the first matching path on stderr
# (`ui-review-needed: run because of <path>`). Anything not listed is a path that cannot change a
# render: Android, the player's parser, media, net, ffi, packaging, docs.
#
# The rig that renders the stories (native/rigs/shot) links semaphore-ui (stories feature) and
# semaphore-core (which links semaphore-wire); the app crate is listed because it hosts the UI.
# Test: native/scripts/test-ui-review-needed.sh
set -euo pipefail

while IFS= read -r path; do
  case "$path" in
    native/crates/semaphore-ui/* | native/crates/semaphore-app/* | native/crates/semaphore-design/* | \
      native/crates/semaphore-wire/* | \
      native/crates/semaphore-core/src/model/* | native/crates/semaphore-core/src/text/* | \
      native/crates/semaphore-core/src/scenario.rs | native/crates/semaphore-core/Cargo.toml | \
      native/fixtures/scenarios/* | native/fixtures/text/* | \
      native/third_party/* | native/Cargo.toml | native/Cargo.lock | native/rust-toolchain.toml | \
      native/scripts/ui-review* | native/rigs/* | native/tools/gen-design/* | \
      design/tokens.json | design/colour.json | design/icons/* | design/fonts/* | \
      .github/workflows/native-spike.yml)
      echo "ui-review-needed: run because of $path" >&2
      echo run
      exit 0
      ;;
  esac
done
echo skip
