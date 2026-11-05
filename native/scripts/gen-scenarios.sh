#!/usr/bin/env bash
# Export the web client's Ladle scenarios and check them against the API contract.
#
#   native/scripts/gen-scenarios.sh          # write native/fixtures/scenarios
#   native/scripts/gen-scenarios.sh --check  # fail if a fresh export differs from the committed one
#
# The exporter runs at the commit in contract/PIN (scripts/export-web.sh), so the fixtures always
# describe the same web client the contract was generated from. The JSON is key-sorted and
# indented by the exporter, so a re-export is byte-identical unless the scenarios changed.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
check=false
case "${1:-}" in
  "") ;;
  --check) check=true ;;
  *)
    echo "usage: gen-scenarios.sh [--check]" >&2
    exit 2
    ;;
esac

"$NATIVE_DIR/scripts/export-web.sh" scenarios
out="$NATIVE_DIR/tools/web-export/out/scenarios"
fixtures="$NATIVE_DIR/fixtures/scenarios"

if $check; then
  "$NATIVE_DIR/scripts/in-image.sh" python3 scripts/validate-scenarios.py --dir "$out"
  if ! diff -ru "$fixtures" "$out"; then
    echo "gen-scenarios: fixtures/scenarios differs from a fresh export (run without --check)" >&2
    exit 1
  fi
else
  mkdir -p "$fixtures"
  cp "$out"/*.json "$fixtures/"
  "$NATIVE_DIR/scripts/in-image.sh" python3 scripts/validate-scenarios.py
fi

echo "scenarios up to date"
