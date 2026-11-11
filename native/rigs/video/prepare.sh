#!/usr/bin/env bash
# Inside the image, from native/: rebuild rigs/video/.vendor/gpui-pre-wgpu from third_party's
# vendored copy plus the rig-only telemetry patch. Idempotent: always starts from a fresh copy.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="$here/../../third_party/vendor/gpui-pre-wgpu"
dst="$here/.vendor/gpui-pre-wgpu"
rm -rf "$dst"; mkdir -p "$(dirname "$dst")"
cp -a "$src" "$dst"
patch -s -p1 -d "$dst" < "$here/patches/gpui-pre-wgpu-telemetry.patch"
echo "prepared $dst"
