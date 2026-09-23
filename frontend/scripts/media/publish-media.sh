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
set -euo pipefail

DRY_RUN=0
REMOTE=origin
while (($#)); do
  case "$1" in
    --dry-run|-n) DRY_RUN=1 ;;
    --remote) REMOTE="$2"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
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
if [[ -f "$SRC/report.json" ]] && ! grep -q '"issueCount": 0' "$SRC/report.json"; then
  echo "report.json lists screenshot issues — fix them (or review report.json) before publishing" >&2
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
