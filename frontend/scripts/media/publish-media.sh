#!/usr/bin/env bash
# Publish frontend/.media-out/ to the orphan `media` branch (a single commit,
# force-pushed — same idea as the coverage `badges` branch). The README and
# docs load files from
#   https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/<path>
#
# Never run automatically. Usage:
#   frontend/scripts/media/publish-media.sh --dry-run   # build + show, push nothing
#   frontend/scripts/media/publish-media.sh             # build + force-push
#
# Only publishable files are included (screenshots/, video/, social.png,
# manifest.json) — never raw/ captures, report.json or logs. Uses a temporary
# index, so your working tree, index and current branch are untouched.
#
# Refuses to run unless report.json comes from an unfiltered shots run with no
# issues (it must list every screenshot in manifest.json) and screenshots/
# holds exactly the catalog's shots.
set -euo pipefail

DRY_RUN=0
REMOTE=origin
while (($#)); do
  case "$1" in
    --dry-run|-n) DRY_RUN=1 ;;
    --remote) REMOTE="$2"; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT=$(git rev-parse --show-toplevel)
SRC="$ROOT/frontend/.media-out"
RAW_BASE="https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media"

for required in manifest.json social.png video/hero.webp video/hero.gif video/tour.mp4 video/tour-poster.webp; do
  [[ -f "$SRC/$required" ]] || { echo "missing $SRC/$required — run the media pipeline first" >&2; exit 1; }
done
compgen -G "$SRC/screenshots/*.webp" >/dev/null || { echo "no screenshots in $SRC/screenshots" >&2; exit 1; }

# Only publish what a full, clean shots run produced: report.json must cover
# every screenshot in manifest.json (a MEDIA_FILTER run covers only the shots
# it took) with no issues, and screenshots/ must hold exactly those shots
# (after a filtered run, a shot removed from the catalog is still there).
# shots.mjs writes both files with JSON.stringify(..., null, 2), so the names
# are read without jq: each report entry has "name" at 6 spaces, and each
# manifest screenshot has "file": "screenshots/<name>.webp".
FULL_RUN='MEDIA_STEPS=shots,encode docker compose --profile tools run --rm media'
REPORT="$SRC/report.json"
[[ -f "$REPORT" ]] || { echo "missing $REPORT — run the shots step first: $FULL_RUN" >&2; exit 1; }
if ! grep -q '"issueCount": 0' "$REPORT"; then
  echo "report.json lists screenshot issues — fix them before publishing" >&2
  exit 1
fi
catalog_shots=$(sed -n 's#^ *"file": "screenshots/\(.*\)\.webp",*$#\1#p' "$SRC/manifest.json" | sort)
report_shots=$(sed -n 's#^      "name": "\(.*\)",$#\1#p' "$REPORT" | sort)
encoded_shots=$(cd "$SRC/screenshots" && printf '%s\n' *.webp | sed 's/\.webp$//' | sort)
list_diff() { # <label a> <names a> <label b> <names b>: the names only one side has
  diff <(echo "$2") <(echo "$4") | sed -n "s|^< |  only in $1: |p; s|^> |  only in $3: |p" >&2 || true
}
if [[ "$report_shots" != "$catalog_shots" ]]; then
  filter=$(sed -n 's/^  "filter": "\(.*\)",$/\1/p' "$REPORT")
  if [[ -n "$filter" ]]; then
    echo "report.json comes from a MEDIA_FILTER=$filter run: it covers $(grep -c . <<<"$report_shots") of the $(grep -c . <<<"$catalog_shots") screenshots." >&2
  else
    echo "report.json doesn't cover every screenshot in the catalog:" >&2
    list_diff manifest.json "$catalog_shots" report.json "$report_shots"
  fi
  echo "Run the shots step unfiltered, and review what it changes: $FULL_RUN" >&2
  exit 1
fi
if [[ "$encoded_shots" != "$catalog_shots" ]]; then
  echo "screenshots/ doesn't match the catalog (a shot was removed or renamed since the last unfiltered shots run)." >&2
  list_diff manifest.json "$catalog_shots" screenshots/ "$encoded_shots"
  echo "An unfiltered shots run deletes raw/shots/ first, and encode rebuilds screenshots/ from it: $FULL_RUN" >&2
  exit 1
fi

STAGE=$(mktemp -d)
INDEX=$(mktemp -u)
trap 'rm -rf "$STAGE" "$INDEX"' EXIT

mkdir -p "$STAGE/screenshots" "$STAGE/video"
cp "$SRC"/screenshots/*.webp "$STAGE/screenshots/"
cp "$SRC"/video/{hero.webp,hero.gif,tour.mp4,tour-poster.webp} "$STAGE/video/"
cp "$SRC/social.png" "$SRC/manifest.json" "$STAGE/"
SOURCE_SHA=$(git -C "$ROOT" rev-parse --short HEAD)
cat > "$STAGE/README.md" <<EOF
# Semaphore Chat media

Screenshots and videos used by the main README and docs.semaphorechat.app.
Generated from the Ladle sandbox by \`frontend/scripts/media/\` at ${SOURCE_SHA} —
do not edit by hand; see docs-site/docs/contributing/regenerating-screenshots.md.
This branch is force-pushed as a single orphan commit on every publish.
EOF

export GIT_INDEX_FILE="$INDEX"
git -C "$ROOT" --work-tree="$STAGE" add -A .
TREE=$(git -C "$ROOT" write-tree)
COMMIT=$(git -C "$ROOT" commit-tree "$TREE" -m "media: regenerate README/docs media (from ${SOURCE_SHA})")
unset GIT_INDEX_FILE

echo "Built orphan commit $COMMIT (tree $TREE, from $SOURCE_SHA):"
git -C "$ROOT" ls-tree -r -l "$COMMIT" | awk '{ printf "  %10d  %s\n", $4, $5 }'
TOTAL=$(git -C "$ROOT" ls-tree -r -l "$COMMIT" | awk '{ s += $4 } END { print s }')
echo "  total: $((TOTAL / 1024)) KiB"

if ((DRY_RUN)); then
  # Park it on a throwaway ref so it can be inspected, then clean up.
  REF=refs/media-dryrun/media
  git -C "$ROOT" update-ref "$REF" "$COMMIT"
  echo
  echo "[dry run] would run: git push --force $REMOTE $COMMIT:refs/heads/media"
  parents=$(git -C "$ROOT" rev-list --parents -n1 "$REF" | wc -w)
  echo "[dry run] $REF has $((parents - 1)) parent(s) (0 = orphan, as intended)"
  git -C "$ROOT" update-ref -d "$REF"
  echo "[dry run] deleted $REF; nothing pushed."
else
  git -C "$ROOT" push --force "$REMOTE" "$COMMIT:refs/heads/media"
  echo "Pushed to $REMOTE/media."
fi

echo
echo "URLs:"
git -C "$ROOT" ls-tree -r --name-only "$COMMIT" | grep -v '^README.md$' | sed "s#^#  $RAW_BASE/#"
