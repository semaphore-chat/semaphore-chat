#!/usr/bin/env bash
# Renders every voice story at the sizes that matter, on lavapipe, through rig-shot.
#   native/scripts/in-image.sh crates/semaphore-media-livekit/proof/stories.sh <out-dir>
set -euo pipefail
out="${1:-crates/semaphore-media-livekit/proof/results/stories}"
mkdir -p "$out"
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
cargo build -q -p rig-shot
rig="${CARGO_TARGET_DIR:-target}/debug/rig-shot"
for story in $("$rig" --list | grep '^voice-'); do
  for shape in desktop:1280:720 phone:390:844; do
    IFS=: read -r name width height <<<"$shape"
    "$rig" "$story" "$width" "$height" "$out/$story-$name.png" >/dev/null
  done
done
ls "$out" | wc -l
