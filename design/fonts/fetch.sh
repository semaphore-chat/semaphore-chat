#!/usr/bin/env bash
# Fetch the design system's font files from google/fonts at a pinned commit, and check each
# against its pinned SHA-256. See design/fonts/README.md.
#
#   design/fonts/fetch.sh           download any missing file, then check every file
#   design/fonts/fetch.sh --check   check the files in the tree only (no network)
#
# A file whose hash does not match is an error, never overwritten: delete it and re-run to fetch
# it again. To move to a newer upstream, change COMMIT and the hashes together in one commit.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMIT=06bfe0d62a98375cb09c942fa18e68bd32cff057
BASE="https://raw.githubusercontent.com/google/fonts/$COMMIT"

# local name | path in google/fonts (URL-encoded) | sha256
FILES=(
  "figtree_wght.ttf|ofl/figtree/Figtree%5Bwght%5D.ttf|26ad3db9b31ff7dde67a91ff515d022d2f495cd506590699cf264f0bfe6fb714"
  "figtree_italic_wght.ttf|ofl/figtree/Figtree-Italic%5Bwght%5D.ttf|94dec1f18b9275d69e8b4a91b6514bdc18199048347e1c36e1285b11b0b87653"
  "bricolage_grotesque_wght.ttf|ofl/bricolagegrotesque/BricolageGrotesque%5Bopsz,wdth,wght%5D.ttf|413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682"
)

check_only=0
[ "${1:-}" = --check ] && check_only=1

status=0
for entry in "${FILES[@]}"; do
  IFS='|' read -r name path sum <<<"$entry"
  file="$DIR/$name"
  if [ ! -f "$file" ]; then
    if (( check_only )); then
      echo "fonts: $name is missing (run design/fonts/fetch.sh)" >&2
      status=1
      continue
    fi
    tmp="$(mktemp "$DIR/.$name.XXXXXX")"
    curl -fsSL -o "$tmp" "$BASE/$path"
    mv "$tmp" "$file"
  fi
  if [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$sum" ]; then
    echo "fonts: $name does not match its pinned SHA-256" >&2
    status=1
  else
    echo "fonts: $name ok"
  fi
done
exit "$status"
