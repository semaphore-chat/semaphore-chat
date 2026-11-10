#!/usr/bin/env bash
# Inside the video image: the raw I420 clips the rig replays, if absent. testsrc2 plus noise,
# 300 frames, the same recipe as the earlier container runs (gpui-rig/gen-frames.sh).
set -euo pipefail
dir="$1"; mkdir -p "$dir"
gen() {
  local name=$1 w=$2 h=$3 want=$(( $2 * $3 * 3 / 2 * 300 ))
  if [ -f "$dir/$name.i420" ] && [ "$(stat -c %s "$dir/$name.i420")" -ge "$want" ]; then echo "reuse $name"; return; fi
  ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=${w}x${h}:rate=30,noise=alls=25:allf=t+u" \
    -frames:v 300 -pix_fmt yuv420p -f rawvideo "$dir/$name.i420.tmp"
  mv "$dir/$name.i420.tmp" "$dir/$name.i420"
  echo "made $name"
}
gen 720p 1280 720
gen 1080p 1920 1080
