#!/usr/bin/env bash
# Export the web client's message cache vectors and socket event rules for semaphore-core's tests.
#
#   native/scripts/gen-cache-vectors.sh          # write native/fixtures/cache
#   native/scripts/gen-cache-vectors.sh --check  # fail if a fresh export differs from the committed one
#
# The exporter runs at the commit in contract/PIN (scripts/export-web.sh), so the vectors describe
# the same web client the contract was generated from, not whatever frontend/ this branch has.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
check=false
case "${1:-}" in
  "") ;;
  --check) check=true ;;
  *)
    echo "usage: gen-cache-vectors.sh [--check]" >&2
    exit 2
    ;;
esac

"$NATIVE_DIR/scripts/export-web.sh" cache-vectors
out="$NATIVE_DIR/tools/web-export/out/cache-vectors"
fixtures="$NATIVE_DIR/fixtures/cache"

if $check; then
  if ! diff -ru "$fixtures" "$out"; then
    echo "gen-cache-vectors: fixtures/cache differs from a fresh export (run without --check)" >&2
    exit 1
  fi
else
  mkdir -p "$fixtures"
  cp "$out"/*.json "$fixtures/"
fi

echo "cache vectors up to date"
