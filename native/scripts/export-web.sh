#!/usr/bin/env bash
# Run one exporter from native/tools/web-export against the web client at the commit in
# contract/PIN, so tokens, icons and scenarios match the contract the Rust side generates from.
#
#   native/scripts/export-web.sh <name>
#
# Runs tools/web-export/<name>.test.ts or .tsx as a Vitest file, in the frontend container, in a
# temporary detached worktree. Vitest because that's the one runner here that can load the
# frontend's TypeScript. An exporter writes under `native-export-out/<name>/`, relative to its
# working directory (frontend/); that lands in native/tools/web-export/out/<name>/.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="${1:?usage: export-web.sh <name>}"
tool="$(ls "$NATIVE_DIR/tools/web-export/$name".test.ts* 2>/dev/null | head -1)"
[ -n "$tool" ] || { echo "no tools/web-export/$name.test.ts or .tsx" >&2; exit 1; }
commit="$(sed -n 's/^commit=//p' "$NATIVE_DIR/contract/PIN")"
ticket="native-export-$name"
work="$NATIVE_DIR/tools/web-export/.work-$name"

cleanup() { git -C "$NATIVE_DIR" worktree remove --force "$work" 2>/dev/null || true; }
trap cleanup EXIT
cleanup
git -C "$NATIVE_DIR" worktree add -q --detach "$work" "$commit"

mkdir -p "$work/frontend/src/__tests__/native-export"
cp "$tool" "$work/frontend/src/__tests__/native-export/"
cd "$work"
scripts/test-stack.sh "$ticket" run-frontend sh -c \
  'OPENAPI_SPEC_PATH=/spec/openapi.json pnpm exec openapi-ts >/dev/null'
scripts/test-stack.sh "$ticket" run-frontend \
  pnpm exec vitest run "src/__tests__/native-export/$(basename "$tool")" --coverage.enabled=false

out="$NATIVE_DIR/tools/web-export/out/$name"
rm -rf "$out"
mkdir -p "$(dirname "$out")"
cp -r "$work/frontend/native-export-out/$name" "$out"
echo "exported to $out"
