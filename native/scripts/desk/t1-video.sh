#!/usr/bin/env bash
# T1 on the real desktop: the GPUI video rig (rigs/video), 9x 720p30 tiles plus a 1080p60 share.
#
#   native/scripts/desk/t1-video.sh [--dry-run] [--force] [--runs N] [--duration S]
#
# Builds the rig in the pinned image plus libyuv and ffmpeg (rigs/video/Dockerfile), generates the
# clips once, then runs each configuration N times (default 3) in a window on this session:
#   none    0+0   UI alone, the CPU baseline          (all cores, and 4 cores)
#   surface 9+1   the vendored video patch, full grid (all cores, and 4 cores)
#   surface 9+0   tiles only, for the per-stream CPU bar
#   surface 0+1   share only, for the 1080p60 bar
#   today   9+1   Zed's per-frame image path, for comparison
# Each run is the duration (default 20 s) plus 5 s warmup. 4 cores means taskset -c 0-3.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
DURATION=20
desk_init t1-video "$0" "$@"
set -- "${DESK_ARGS[@]+"${DESK_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --duration) DURATION="$2"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
desk_need_display
desk_gate

RIG="$NATIVE_DIR/rigs/video"
BASE="$("$NATIVE_DIR/scripts/in-image.sh" --print-image)"
VIDEO_IMAGE="semaphore-native-video:$({ cat "$RIG/Dockerfile"; echo "$BASE"; } | sha256sum | cut -c1-12)"
if ! docker image inspect "$VIDEO_IMAGE" >/dev/null 2>&1; then
  banner "building $VIDEO_IMAGE (adds libyuv and ffmpeg to $BASE)"
  docker build -q --build-arg "BASE=$BASE" -t "$VIDEO_IMAGE" "$RIG" >/dev/null
fi
in_video() { NATIVE_IMAGE="$VIDEO_IMAGE" "$NATIVE_DIR/scripts/in-image.sh" "$@"; }

banner "building gpui-video-rig (release, in the image)"
in_video bash -c 'rigs/video/prepare.sh && cd rigs/video && CARGO_TARGET_DIR=/cache/target/video-rig RUSTFLAGS="-C force-frame-pointers=yes" cargo build --release --locked 2>&1 | tail -2'
desk_extract /cache/target/video-rig/release/gpui-video-rig gpui-video-rig
CLIPS="$DESK_DIR/.cache/video-clips"
in_video rigs/video/gen-clips.sh "$CLIPS"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"
ldd "$BIN_DIR/gpui-video-rig" | grep 'not found' && die "the rig is missing host libraries (libyuv?)"

# arm tiles share cores
CONFIGS=(
  "none 0 0 all" "surface 9 1 all" "surface 9 0 all" "surface 0 1 all" "today 9 1 all"
  "none 0 0 4" "surface 9 1 4"
)
total=$(( ${#CONFIGS[@]} * RUNS ))
say "$total runs of about $(( DURATION + 8 )) s each: about $(( total * (DURATION + 8) / 60 + 1 )) minutes"

if [[ "$DRY_RUN" == true ]]; then
  for c in "${CONFIGS[@]}"; do
    read -r arm tiles share cores <<<"$c"
    pfx=""; [[ "$cores" == 4 ]] && pfx="taskset -c 0-3 "
    say "would run x$RUNS: $pfx$BIN_DIR/gpui-video-rig --arm=$arm --tiles=$tiles --share=$share --duration=$DURATION --warmup=5 --frames=$CLIPS"
  done
  desk_finish
  python3 "$DESK_DIR/desk.py" dry-result --test t1 --host "$OUT/host.json" --out "$OUT/result.json" --commit "$COMMIT" --binary "$BIN_DIR/gpui-video-rig"
  desk_validate "$OUT/result.json"
  say "dry run done"
  exit 0
fi

banner "T1: $total windows open one after another. Don't touch anything until the summary prints."
n=0
for run in $(seq 1 "$RUNS"); do
  for c in "${CONFIGS[@]}"; do
    read -r arm tiles share cores <<<"$c"
    n=$((n + 1))
    name="t1-$arm-$tiles-$share-$cores-run$run"
    say "[$n/$total] $arm ${tiles}x720p30 + ${share}x1080p60, $cores cores, run $run"
    pin=(); [[ "$cores" == 4 ]] && pin=(taskset -c 0-3)
    start="$(cat /proc/loadavg)"
    RUST_LOG=warn RIG_RENDERER="wgpu-vulkan desk $cores-cores" "${pin[@]}" "$BIN_DIR/gpui-video-rig" \
      --arm="$arm" --tiles="$tiles" --share="$share" --duration="$DURATION" --warmup=5 \
      --frames="$CLIPS" --out="$RAW/$name.json" >"$RAW/$name.log" 2>&1 &
    pid=$!; desk_track_pid "$pid"
    desk_poll_proc "$pid" "$RAW/$name.samples" &
    desk_track_pid $!
    for _ in $(seq 1 $(( DURATION + 120 ))); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    if kill -0 "$pid" 2>/dev/null; then kill "$pid"; die "$name did not finish (see $RAW/$name.log)"; fi
    wait "$pid" || die "$name failed (see $RAW/$name.log)"
    [[ -s "$RAW/$name.json" ]] || die "$name wrote no result (see $RAW/$name.log)"
    printf '{"arm":"%s","tiles":%s,"share":%s,"cores":"%s","run":%s,"load":{"start":"%s","end":"%s"}}\n' \
      "$arm" "$tiles" "$share" "$cores" "$run" "$start" "$(cat /proc/loadavg)" >"$RAW/$name.meta"
  done
done
desk_finish
banner "T1 result"
python3 "$DESK_DIR/desk.py" t1 --raw "$RAW" --host "$OUT/host.json" --out "$OUT/result.json" --commit "$COMMIT" --binary "$BIN_DIR/gpui-video-rig"
desk_validate "$OUT/result.json" >/dev/null && say "result.json matches the schema: $OUT/result.json"
