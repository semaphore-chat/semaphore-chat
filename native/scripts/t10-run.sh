#!/usr/bin/env bash
# T10 agent loop: 20 edit-build-render iterations of one story line, timed, in the pinned
# image. Writes native/results/t10.json (baseline result schema) and one PNG per iteration
# under native/results/t10/.
#
#   bash native/scripts/t10-run.sh                 # the T10 run: 20 iterations
#   bash native/scripts/t10-run.sh --iterations 2  # smoke test; its JSON says smoke_run
#
# The edited file (crates/semaphore-ui/src/shell/mod.rs) is restored when the loop ends.
# RESULT_SCHEMA_HOST optionally points at the baseline schema, as in verify.sh.
set -uo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
SCHEMA="${RESULT_SCHEMA_HOST:-$ROOT/scripts/native-baseline/result.schema.json}"

docker_args=(-e "GIT_COMMIT=$(git -C "$ROOT" rev-parse HEAD)")
if [ -f "$SCHEMA" ]; then
  docker_args+=(-v "$SCHEMA:/schema/result.schema.json:ro" -e RESULT_SCHEMA=/schema/result.schema.json)
else
  echo "t10: no schema at $SCHEMA, so the JSON will not be validated" >&2
fi

cd "$NATIVE_DIR"
NATIVE_DOCKER_ARGS="${docker_args[*]}" "$NATIVE_DIR/scripts/in-image.sh" \
  python3 scripts/t10-loop.py --out results/t10.json "$@"
