#!/usr/bin/env bash
# T10 harness, run inside the image: render a story on lavapipe, twice in separate
# processes, and report whether the pixels match and how long one iteration took.
#
#   native/scripts/in-image.sh scripts/shot.sh <story> <width> <height> <out-dir>
#
# Prints one JSON object on stdout. Exits non-zero if rendering failed or the two
# renders differ. Lavapipe is forced, so a host GPU can never change the pixels.
set -euo pipefail

story="$1"; width="$2"; height="$3"; out_dir="$4"
mkdir -p "$out_dir"

export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"

started_ms="$(date +%s%3N)"
cargo build -q -p rig-shot
built_ms="$(date +%s%3N)"

rig="${CARGO_TARGET_DIR:-target}/debug/rig-shot"
first="$out_dir/$story.png"
second="$(mktemp --suffix=.png)"
trap 'rm -f "$second"' EXIT

"$rig" "$story" "$width" "$height" "$first" >&2
rendered_ms="$(date +%s%3N)"
"$rig" "$story" "$width" "$height" "$second" >&2

first_sha="$(sha256sum "$first" | cut -d' ' -f1)"
second_sha="$(sha256sum "$second" | cut -d' ' -f1)"
identical=false
[ "$first_sha" = "$second_sha" ] && identical=true

jq -n \
  --arg story "$story" --arg png "$first" --arg sha256 "$first_sha" \
  --argjson width "$width" --argjson height "$height" --argjson identical "$identical" \
  --argjson build_ms "$((built_ms - started_ms))" \
  --argjson render_ms "$((rendered_ms - built_ms))" \
  --argjson iteration_ms "$((rendered_ms - started_ms))" \
  --arg mesa "$(pacman -Q mesa | cut -d' ' -f2)" \
  '{story: $story, png: $png, sha256: $sha256, width: $width, height: $height,
    identical_across_processes: $identical, build_ms: $build_ms, render_ms: $render_ms,
    iteration_ms: $iteration_ms, renderer: "lavapipe", mesa: $mesa}'

[ "$identical" = true ]
