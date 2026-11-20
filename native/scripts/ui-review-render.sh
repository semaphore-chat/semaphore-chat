#!/usr/bin/env bash
# Inside the image: render a generated steps file, sharded over the machine's cores.
#
#   native/scripts/ui-review-render.sh <steps> <out-dir> <work-dir> <shards> <rig>
#
# ui-review.sh writes the steps file (one `story`/`shot` pair per story, at one size) and runs this
# from the checkout being rendered, so the rig finds `fixtures/scenarios` there. Every shot the
# steps file asks for has to come out: one that doesn't is run once more on its own, and its error
# is printed as `ui-review-render: failed <shot> <error>`. Exits non-zero if any shot is missing.
set -euo pipefail

steps="$1"
out="$2"
work="$3"
shards="$4"
rig="$5"

# The software Vulkan driver, and a runtime dir: without both, a rig dies with no renderer.
export VK_ICD_FILENAMES="${VK_ICD_FILENAMES:-/usr/share/vulkan/icd.d/lvp_icd.json}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
if [[ ! -f "$VK_ICD_FILENAMES" ]]; then
  echo "ui-review-render: no Vulkan driver at $VK_ICD_FILENAMES" >&2
  exit 1
fi

rm -rf "$work"
mkdir -p "$work/shards" "$work/one" "$out"

# One story per shard (`story` line and everything that follows it), and a file per shot holding
# just its own story, so a shot that failed can be run again on its own.
awk -v dir="$work" -v n="$shards" '
  function shard() { return dir "/shards/shard-" ((block - 1) % n) ".steps" }
  $1 == "story" { block++; header = $0 }
  $1 == "shot" {
    file = dir "/one/" $2 ".steps"
    print header > file
    print > file
    close(file)
  }
  { target = shard(); print > target }
' "$steps"

shopt -s nullglob
files=("$work"/shards/*.steps)
if (( ${#files[@]} == 0 )); then
  echo "ui-review-render: nothing to render in $steps" >&2
  exit 0
fi

pids=()
for file in "${files[@]}"; do
  "$rig" --script "$file" --out "$out" >"${file%.steps}.log" 2>&1 &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" || true; done

missing=0
while read -r kind name _; do
  [[ "$kind" == shot ]] || continue
  [[ -f "$out/$name.png" ]] && continue
  # A shard that died on one story leaves the rest of it unrendered: run this one alone first, so
  # only a story that really fails is reported.
  error="$("$rig" --script "$work/one/$name.steps" --out "$out" 2>&1 | tail -n 1)"
  [[ -f "$out/$name.png" ]] && continue
  missing=$((missing + 1))
  printf 'ui-review-render: failed %s %s\n' "$name" "${error:-no error output}" >&2
done <"$steps"

if (( missing > 0 )); then
  echo "ui-review-render: $missing shot(s) did not render" >&2
  exit 1
fi
