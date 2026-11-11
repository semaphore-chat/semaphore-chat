#!/usr/bin/env bash
# Export the web client's emoji categories, search names and quick reactions (emojiData.ts) for the
# native emoji picker.
#
#   native/scripts/gen-emoji.sh          # write crates/semaphore-ui/assets/emoji/emoji.json
#   native/scripts/gen-emoji.sh --check  # fail if a fresh export differs from the committed one
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$NATIVE_DIR/scripts/export-web.sh" emoji
out="$NATIVE_DIR/tools/web-export/out/emoji"
assets="$NATIVE_DIR/crates/semaphore-ui/assets/emoji"
if [ "${1:-}" = "--check" ]; then
  diff -ru "$assets" "$out" || { echo "gen-emoji: assets/emoji differs from a fresh export" >&2; exit 1; }
else
  mkdir -p "$assets"
  cp "$out"/emoji.json "$assets/"
fi
echo "emoji data up to date"
