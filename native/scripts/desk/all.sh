#!/usr/bin/env bash
# Every desk test in a row, about 40 minutes hands-off. Plays sound for about two minutes and
# overwrites the clipboard. Needs an empty focused workspace and the GPU to itself.
# A failing test doesn't stop the rest; the last lines say which failed.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failed=()
for t in t2-list t3-selection t11-sysaudio t1-video; do
  echo "===== $t ====="
  "$here/$t.sh" "$@" || failed+=("$t")
done
echo "===== baseline --short ====="
"$here/baseline.sh" --short "$@" || failed+=("baseline")
if [ "${#failed[@]}" -eq 0 ]; then echo "desk: all five ran"; else echo "desk: FAILED or refused: ${failed[*]}"; exit 1; fi
