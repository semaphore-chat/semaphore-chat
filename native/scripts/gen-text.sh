#!/usr/bin/env bash
# Export the web client's message-text vectors (mentionParser, richTextShortcuts, auto-link rule).
#
#   native/scripts/gen-text.sh          # write native/fixtures/text
#   native/scripts/gen-text.sh --check  # fail if a fresh export differs from the committed one
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$NATIVE_DIR/scripts/export-web.sh" text
out="$NATIVE_DIR/tools/web-export/out/text"
fixtures="$NATIVE_DIR/fixtures/text"
if [ "${1:-}" = "--check" ]; then
  diff -ru "$fixtures" "$out" || { echo "gen-text: fixtures/text differs from a fresh export" >&2; exit 1; }
else
  mkdir -p "$fixtures"
  cp "$out"/*.json "$fixtures/"
fi
echo "text vectors up to date"
