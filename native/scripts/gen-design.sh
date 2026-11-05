#!/usr/bin/env bash
# Regenerate crates/semaphore-design from the web client at the commit in contract/PIN.
#
#   native/scripts/gen-design.sh           # export the theme and icons, then generate
#   native/scripts/gen-design.sh --check   # the same, but fail if anything committed differs
#
# The exporters run in the frontend container (scripts/export-web.sh) and the generator in the
# pinned build image, as every other cargo/python step here does.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$NATIVE_DIR"

case "${1:-}" in
  "") mode="" ;;
  --check) mode="--check" ;;
  *)
    echo "usage: gen-design.sh [--check]" >&2
    exit 2
    ;;
esac
[ "$#" -le 1 ] || { echo "usage: gen-design.sh [--check]" >&2; exit 2; }

"$NATIVE_DIR/scripts/export-web.sh" theme
"$NATIVE_DIR/scripts/export-web.sh" icons
"$NATIVE_DIR/scripts/in-image.sh" python3 tools/gen-design/gen_design.py $mode
