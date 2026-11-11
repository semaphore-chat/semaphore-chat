#!/usr/bin/env bash
# T2 on the real desktop: rig-list fling, 100k mixed-height messages, presented frame timing.
#
#   native/scripts/desk/t2-list.sh [--dry-run] [--force] [--runs N]
#
# Builds rig-list in the pinned image, then opens its window on this Hyprland session N times
# (default 3), about 50 s each. Leave the window alone: input is injected in-process.
# --dry-run builds, records the host and checks the emit path, without opening a window.
# --force runs on a busy host (load1 above 2.0); the result is then provisional.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
desk_init t2-list "$0" "$@"
[[ ${#DESK_ARGS[@]} -eq 0 ]] || die "unknown option ${DESK_ARGS[0]}"
desk_need_display
desk_gate

banner "building rig-list (release, in the image)"
"$NATIVE_DIR/scripts/in-image.sh" cargo build --release -p rig-list 2>&1 | tail -2
desk_extract /cache/target/release/rig-list rig-list
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"
IMAGES="$DESK_DIR/.cache/list-images"; mkdir -p "$IMAGES"

if [[ "$DRY_RUN" == true ]]; then
  say "would run $RUNS times: MALLOC_MMAP_THRESHOLD_=262144 $BIN_DIR/rig-list fling --out $RAW/fling-runN.json --image-dir $IMAGES"
  ldd "$BIN_DIR/rig-list" | grep -q 'not found' && die "the binary is missing host libraries: $(ldd "$BIN_DIR/rig-list" | grep 'not found')"
  say "binary links on the host: ok ($(stat -c %s "$BIN_DIR/rig-list") bytes)"
  desk_finish
  python3 "$DESK_DIR/desk.py" dry-result --test t2 --host "$OUT/host.json" --out "$OUT/result.json" --commit "$COMMIT" --binary "$BIN_DIR/rig-list"
  desk_validate "$OUT/result.json"
  say "dry run done"
  exit 0
fi

for i in $(seq 1 "$RUNS"); do
  banner "T2 run $i of $RUNS: a window opens for about 50 s. Don't touch it."
  MALLOC_MMAP_THRESHOLD_=262144 RUST_LOG=warn "$BIN_DIR/rig-list" fling --out "$RAW/fling-run$i.json" --image-dir "$IMAGES" \
    >"$RAW/fling-run$i.log" 2>&1 &
  pid=$!; desk_track_pid "$pid"
  # The rig ends itself; this is the ceiling if it hangs.
  for _ in $(seq 1 300); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid"; die "run $i did not finish in 300 s (see $RAW/fling-run$i.log)"; fi
  wait "$pid" || die "run $i failed (see $RAW/fling-run$i.log)"
  [[ -s "$RAW/fling-run$i.json" ]] || die "run $i wrote no result (see $RAW/fling-run$i.log)"
done
desk_finish
banner "T2 result"
python3 "$DESK_DIR/desk.py" t2 --raw "$RAW" --host "$OUT/host.json" --out "$OUT/result.json" --commit "$COMMIT" --binary "$BIN_DIR/rig-list"
desk_validate "$OUT/result.json" >/dev/null && say "result.json matches the schema: $OUT/result.json"
