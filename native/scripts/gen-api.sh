#!/usr/bin/env bash
# Regenerates the Rust wire types and REST client from the pinned contract.
#
#   native/scripts/gen-api.sh            write the three generated files
#   native/scripts/gen-api.sh --check    regenerate to a temp directory and fail on any
#                                        difference, plus check the contract matches PIN
#
# Everything runs in the build image, so the rustfmt version that shapes the output (and
# therefore the diff) is the pinned one.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IN_IMAGE="$NATIVE_DIR/scripts/in-image.sh"

WIRE="$NATIVE_DIR/crates/semaphore-wire/src/generated.rs"
EVENTS="$NATIVE_DIR/crates/semaphore-wire/src/events.rs"
API="$NATIVE_DIR/crates/semaphore-api/src/generated.rs"

generate() { # <wire> <api> <events>
  "$IN_IMAGE" sh -c \
    "cd tools/gen-api && cargo run --quiet --locked -- ../../contract '$1' '$2' '$3'"
}

case "${1:-}" in
  --check)
    "$NATIVE_DIR/scripts/pin-contract.sh" --check

    work="$NATIVE_DIR/target/gen-api-check"
    rm -rf "$work"
    trap 'rm -rf "$work"' EXIT
    mkdir -p "$work"
    generate "$work/generated-wire.rs" "$work/generated-api.rs" "$work/events.rs"

    status=0
    check() { # <committed file> <regenerated file>
      if ! diff -u "$1" "$2"; then
        echo "out of date: ${1#"$NATIVE_DIR"/}" >&2
        status=1
      fi
    }
    check "$WIRE" "$work/generated-wire.rs"
    check "$API" "$work/generated-api.rs"
    check "$EVENTS" "$work/events.rs"
    [ "$status" -eq 0 ] || { echo "run native/scripts/gen-api.sh to regenerate" >&2; exit 1; }
    echo "generated code matches the contract"
    ;;
  "")
    generate "$WIRE" "$API" "$EVENTS"
    ;;
  *)
    echo "usage: gen-api.sh [--check]" >&2
    exit 2
    ;;
esac
