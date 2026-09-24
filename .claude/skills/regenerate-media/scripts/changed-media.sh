#!/usr/bin/env bash
# Which published media files changed since a snapshot? Run it from the repo
# root, on the host (it only uses sha256sum, awk and diff):
#
#   .claude/skills/regenerate-media/scripts/changed-media.sh snapshot   # before you regenerate
#   .claude/skills/regenerate-media/scripts/changed-media.sh            # after: what changed
#
# Encoding is deterministic, so the same raw captures always give
# byte-identical outputs. Screenshot capture has been deterministic too (the
# clock is frozen). An output this script reports as unchanged therefore
# shows exactly what it showed at the snapshot. Only the changed and added
# files need to be looked at again, and videos only if one of them is listed.
#
# It compares screenshots/*.webp, video/*, social.png and manifest.json. The
# manifest is compared without its generatedAt line, and a changed manifest
# is printed as a diff so you can check the captions and alt text. The
# snapshot is kept in frontend/.media-out/raw/baseline/, which is never
# published.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
OUT="$ROOT/frontend/.media-out"
BASE="$OUT/raw/baseline"

# "<sha256>  <path>" for every published output.
sums() (
  cd "$OUT"
  shopt -s nullglob
  for f in screenshots/*.webp video/* social.png; do
    [[ -f "$f" ]] && sha256sum "$f"
  done
  if [[ -f manifest.json ]]; then
    printf '%s  manifest.json\n' "$(grep -v '"generatedAt"' manifest.json | sha256sum | cut -d' ' -f1)"
  fi
)

case "${1:-diff}" in
  snapshot)
    [[ -d "$OUT" ]] || { echo "no $OUT yet: nothing to snapshot, so review every output after the first run" >&2; exit 1; }
    rm -rf "$BASE"
    mkdir -p "$BASE"
    sums > "$BASE/sums.sha256"
    [[ -f "$OUT/manifest.json" ]] && cp "$OUT/manifest.json" "$BASE/manifest.json"
    echo "snapshot: $(wc -l < "$BASE/sums.sha256") file(s) recorded in $BASE"
    ;;
  diff)
    [[ -f "$BASE/sums.sha256" ]] || {
      echo "no snapshot in $BASE: run '$0 snapshot' before regenerating. Without one, review every output." >&2
      exit 1
    }
    report=$(awk '
      NR == FNR { base[$2] = $1; next }
      { now[$2] = $1 }
      END {
        for (p in now) {
          if (!(p in base)) print "added    " p
          else if (base[p] != now[p]) print "changed  " p
        }
        for (p in base) if (!(p in now)) print "removed  " p
      }' "$BASE/sums.sha256" <(sums) | sort -k2)
    total=$(sums | wc -l)
    if [[ -z "$report" ]]; then
      echo "Nothing changed since the snapshot ($total file(s) compared)."
      exit 0
    fi
    count() { grep -c "^$1 " <<<"$report" || true; }
    changed=$(count changed) added=$(count added) removed=$(count removed)
    echo "$report"
    echo "($changed changed, $added added, $removed removed, $((total - changed - added)) unchanged)"
    if grep -q ' manifest.json$' <<<"$report" && [[ -f "$BASE/manifest.json" ]]; then
      echo
      echo "manifest.json (captions and alt text), snapshot -> now:"
      diff -u <(grep -v '"generatedAt"' "$BASE/manifest.json") <(grep -v '"generatedAt"' "$OUT/manifest.json") | tail -n +3 || true
    fi
    echo
    if grep -q '^\(changed\|added\) *screenshots/' <<<"$report"; then
      echo "- Read every changed or added screenshot (reference/review.md, step 2)."
    fi
    if grep -q '^\(changed\|added\) *\(social\.png\|video/tour-poster\.webp\)$' <<<"$report"; then
      echo "- social.png and video/tour-poster.webp are the chat-desktop screenshot, framed. Look at them too."
    fi
    if grep -q '^\(changed\|added\) *video/\(hero\.webp\|hero\.gif\|tour\.mp4\)$' <<<"$report"; then
      echo "- A video changed: run scripts/review-frames.sh and read every sheet (reference/review.md, step 3)."
    else
      echo "- The videos are unchanged, so they don't need another frame review."
    fi
    if ((removed)); then
      echo "- Check that nothing in README.md or docs-site/docs still links to the removed files."
    fi
    ;;
  -h|--help) sed -n '2,18p' "$0" ;;
  *) echo "usage: $0 [snapshot|diff]" >&2; exit 2 ;;
esac
