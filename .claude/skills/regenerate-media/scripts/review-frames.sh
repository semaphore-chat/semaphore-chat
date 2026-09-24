#!/usr/bin/env bash
# Turn the encoded videos into still frames you can look at (with the Read
# tool). Runs everything in Docker, from the repo root:
#
#   .claude/skills/regenerate-media/scripts/review-frames.sh [tour|hero|all]
#
# Writes to frontend/.media-out/raw/review/ (gitignored, never published):
#   tour-NN.png      3x3 sheets of tour.mp4, 2 frames per second, timestamped
#   hero/fNNN.png    every 6th frame of hero.webp (0.5 s apart) + the last one,
#                    decoded in Chromium (ffmpeg can't decode animated WebP)
#   hero-NN.png      3x3 sheets of those frames, timestamped
# For the loop seam, compare hero/f000.png with the last hero/f*.png.
set -euo pipefail

what="${1:-all}"
ROOT=$(git rev-parse --show-toplevel)
OUT="$ROOT/frontend/.media-out"
SKILL_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
FFMPEG_IMAGE=linuxserver/ffmpeg:9.0-cli-ls82
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.60.0-jammy
OWNER="$(id -u):$(id -g)"

# A 3x3 timestamped sheet filter (the text is quoted for ffmpeg's filter parser).
SHEET="scale=640:-1,drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=3x3"

mkdir -p "$OUT/raw/review"

if [[ "$what" == tour || "$what" == all ]]; then
  [[ -f "$OUT/video/tour.mp4" ]] || { echo "no $OUT/video/tour.mp4 - run the pipeline first" >&2; exit 1; }
  rm -f "$OUT"/raw/review/tour-*.png
  docker run --rm -v "$OUT:/m" --entrypoint bash "$FFMPEG_IMAGE" -c "
    ffmpeg -nostdin -hide_banner -loglevel error -y -i /m/video/tour.mp4 -vf \"fps=2,$SHEET\" /m/raw/review/tour-%02d.png
    chown -R $OWNER /m/raw/review"
  echo "tour: $(ls "$OUT"/raw/review/tour-*.png | wc -l) sheet(s) in $OUT/raw/review/"
fi

if [[ "$what" == hero || "$what" == all ]]; then
  [[ -f "$OUT/video/hero.webp" ]] || { echo "no $OUT/video/hero.webp - run the pipeline first" >&2; exit 1; }
  rm -rf "$OUT/raw/review/hero" "$OUT"/raw/review/hero-*.png
  docker run --rm -v "$OUT:/m" -v "$SKILL_SCRIPTS:/s:ro" -e NODE_PATH=/opt/p/node_modules "$PLAYWRIGHT_IMAGE" sh -c "
    mkdir -p /opt/p && cd /opt/p && npm init -y --silent >/dev/null &&
    npm install --silent --no-audit --no-fund playwright-core@1.60.0 &&
    node /s/hero-frames.mjs /m/video/hero.webp /m/raw/review/hero 6
    chown -R $OWNER /m/raw/review"
  # Frames are 0.5 s apart, so reading them at 2 fps gives each its hero time.
  docker run --rm -v "$OUT:/m" --entrypoint bash "$FFMPEG_IMAGE" -c "
    ffmpeg -nostdin -hide_banner -loglevel error -y -framerate 2 -pattern_type glob -i '/m/raw/review/hero/f*.png' \
      -vf \"$SHEET\" /m/raw/review/hero-%02d.png
    chown -R $OWNER /m/raw/review"
  echo "hero: $(ls "$OUT"/raw/review/hero/*.png | wc -l) frame(s), $(ls "$OUT"/raw/review/hero-*.png | wc -l) sheet(s) in $OUT/raw/review/"
fi
