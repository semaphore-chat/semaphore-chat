#!/usr/bin/env bash
# Preview the docs with the media you just generated, before it is published.
# The docs load every image and video from the `media` branch, so until a
# publish the real pages show new shots as broken. This builds a copy of
# docs-site/ whose media URLs point at frontend/.media-out/ instead. Runs in
# Docker, from the repo root:
#
#   .claude/skills/regenerate-media/scripts/preview-docs.sh [shot-name ...]
#       Build, then screenshot the home page, each Tour section and, for each
#       named shot, the lightbox opened on it (desktop and phone). The PNGs go
#       to frontend/.media-out/raw/review/docs/; read them with the Read tool.
#   .claude/skills/regenerate-media/scripts/preview-docs.sh --serve
#       Build, then serve it at http://localhost:${PORT:-8008}/tour/ until Ctrl-C.
#
# The build also shows mkdocs warnings (a broken link, a missing page). The
# copy lives in frontend/.media-out/raw/docs-preview/ and is never published.
set -euo pipefail

serve=0
shots=()
for arg in "$@"; do
  case "$arg" in
    --serve) serve=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) shots+=("$arg") ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel)
OUT="$ROOT/frontend/.media-out"
PREV="$OUT/raw/docs-preview"
SHOTS_OUT="$OUT/raw/review/docs"
SKILL_SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
RAW_BASE="https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/"
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.60.0-jammy
PYTHON_IMAGE=python:3.12-slim
OWNER="$(id -u):$(id -g)"

[[ -d "$OUT/screenshots" && -d "$OUT/video" ]] || { echo "no media in $OUT - run the pipeline first" >&2; exit 1; }

# A copy of the docs with the media from .media-out, at /media/ on the site.
rm -rf "$PREV"
mkdir -p "$PREV/src"
cp -a "$ROOT/docs-site/." "$PREV/src/"
rm -rf "$PREV/src/site"
mkdir -p "$PREV/src/docs/media"
cp -a "$OUT/screenshots" "$OUT/video" "$PREV/src/docs/media/"
[[ -f "$OUT/social.png" ]] && cp -a "$OUT/social.png" "$PREV/src/docs/media/"
grep -rlF "$RAW_BASE" "$PREV/src/docs" --include='*.md' | while read -r f; do
  sed -i "s#${RAW_BASE}#/media/#g" "$f"
done

echo "building the docs preview (installs mkdocs first, about 30 s) ..."
docker run --rm -v "$PREV:/p" -w /p/src "$PYTHON_IMAGE" sh -c "
  pip install -q --root-user-action=ignore --disable-pip-version-check -r requirements.txt &&
  mkdocs build -q -d /p/site
  chown -R $OWNER /p"
[[ -f "$PREV/site/tour/index.html" ]] || { echo "the docs build failed (see above)" >&2; exit 1; }
echo "built $PREV/site"

if ((serve)); then
  port="${PORT:-8008}"
  echo "serving at http://localhost:$port/tour/ (Ctrl-C to stop)"
  exec docker run --rm -p "127.0.0.1:$port:8000" -v "$PREV/site:/s:ro" -w /s "$PYTHON_IMAGE" python -m http.server 8000
fi

rm -rf "$SHOTS_OUT"
mkdir -p "$SHOTS_OUT"
docker run --rm -v "$PREV/site:/site:ro" -v "$OUT/raw/review:/r" -v "$SKILL_SCRIPTS:/s:ro" \
  -e NODE_PATH=/opt/p/node_modules "$PLAYWRIGHT_IMAGE" sh -c "
  mkdir -p /opt/p && cd /opt/p && npm init -y --silent >/dev/null &&
  npm install --silent --no-audit --no-fund playwright-core@1.60.0 &&
  node /s/docs-shots.mjs /site /r/docs ${shots[*]:-}; status=\$?
  chown -R $OWNER /r; exit \$status"
echo "docs screenshots in $SHOTS_OUT:"
ls "$SHOTS_OUT"
