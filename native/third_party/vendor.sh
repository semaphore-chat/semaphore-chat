#!/usr/bin/env bash
# Rebuild third_party/vendor/ from the checksummed crates.io source plus our patches.
#
#   native/third_party/vendor.sh           rewrite vendor/ from `series`
#   native/third_party/vendor.sh --check   fail if vendor/ isn't exactly that
#
# Downloaded crates are only unpacked, patched and compared here: nothing from them runs.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERIES="$HERE/series"
CHECK=false
[ "${1:-}" = "--check" ] && CHECK=true

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/out"

while read -r crate version sha patch_file; do
  case "$crate" in ''|\#*) continue ;; esac
  archive="$WORK/$crate.crate"
  curl -fsSL -o "$archive" "https://static.crates.io/crates/$crate/$crate-$version.crate"
  echo "$sha  $archive" | sha256sum -c --quiet -
  mkdir -p "$WORK/out/$crate"
  tar xzf "$archive" --strip-components=1 -C "$WORK/out/$crate"
  if [ "$patch_file" != "-" ]; then
    (cd "$WORK/out" && patch -s -p1 --no-backup-if-mismatch < "$HERE/$patch_file")
  fi
done < "$SERIES"

if $CHECK; then
  diff -r "$WORK/out" "$HERE/vendor"
  echo "third_party/vendor matches series"
else
  rm -rf "$HERE/vendor"
  cp -r "$WORK/out" "$HERE/vendor"
  echo "third_party/vendor rewritten from series"
fi
