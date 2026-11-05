#!/usr/bin/env bash
# Run a rig-list scenario in a real window under headless sway, on the real GPU or on lavapipe.
#
#   native/scripts/run-list.sh gpu|lavapipe <out-dir> <mode> [rig-list flags...]
#
# Needs the release binary (`scripts/in-image.sh cargo build --release -p rig-list`). Creates no
# network. Writes <out-dir>/<label>.json (the rig's output), the compositor log and, with SHOT=1,
# a screenshot. The GPU image is the one the video rigs use, for its sway, grim and NVIDIA setup.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
renderer="$1"; out_dir="$(realpath -m "$2")"; mode="$3"; shift 3
label="${LABEL:-$mode}"
image="${RUN_IMAGE:-gpui-rig:local}"
checkout="$(printf '%s' "$ROOT" | sha256sum | cut -c1-8)"
mkdir -p "$out_dir"

gpu_args=()
if [ "$renderer" = gpu ]; then
  gpu_args=(--cap-add SYS_NICE --gpus all --runtime=nvidia -e NVIDIA_DRIVER_CAPABILITIES=all --device /dev/dri -e WLR_RENDERER=vulkan -e WLR_RENDER_DRM_DEVICE=/dev/dri/renderD128)
else
  gpu_args=(--cap-add SYS_NICE -e WLR_RENDERER=pixman -e VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json)
fi

# CPUSET pins the rig to some cores, because a 32-thread host flatters.
pin=()
[ -n "${CPUSET:-}" ] && pin=(--cpuset-cpus "$CPUSET")

# Allocator settings under test.
malloc=()
[ -n "${MALLOC_MMAP_THRESHOLD_:-}" ] && malloc+=(-e "MALLOC_MMAP_THRESHOLD_=$MALLOC_MMAP_THRESHOLD_")

timeout "${RUN_TIMEOUT:-300}" docker run --rm --name "rig-list-$$" --network none "${gpu_args[@]}" "${pin[@]}" "${malloc[@]}" \
  -e ZED_ALLOW_ROOT=true -e XDG_RUNTIME_DIR=/tmp/xdg -e WLR_BACKENDS=headless -e WLR_LIBINPUT_NO_DEVICES=1 \
  -e WLR_HEADLESS_OUTPUTS=1 -e RUST_LOG=warn -e SHOT="${SHOT:-0}" -e LABEL="$label" -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "semaphore-native-target-$checkout:/cache/target:ro" \
  -v semaphore-native-list-images:/images \
  -v "$out_dir:/out" \
  -v "$NATIVE_DIR/scripts/run-list-inner.sh:/run-inner.sh:ro" \
  "$image" bash /run-inner.sh "$mode" "$@"
