#!/usr/bin/env bash
# Inside the image: renders rig-shot's review scripts on lavapipe.
#   scripts/in-image.sh rigs/shot/review.sh [script.steps ...]
set -euo pipefail
export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
nice -n 10 cargo build --locked -q -p rig-shot
rig="${CARGO_TARGET_DIR:-target}/debug/rig-shot"
out=results/slice/shots/u8
for script in "${@:-rigs/shot/scripts/review.steps}"; do
  "$rig" --script "$script" --out "$out"
done
