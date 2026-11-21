#!/usr/bin/env bash
# The generators read native/contract/, not backend/, so a backend change reaches the native
# client only when the pin moves. PIN records the commit it came from, so generation is repeatable.
#
#   native/scripts/pin-contract.sh <git-ref>        copy the contract from that ref and rewrite PIN
#   native/scripts/pin-contract.sh --floor <tag>    copy that release's openapi.json as the floor
#                                                   and rewrite FLOOR
#   native/scripts/pin-contract.sh --check          fail if the files don't match PIN and FLOOR,
#                                                   or the commits they name
#
# The floor is the oldest server release the native client still reads. `tools/gen-api` makes
# every required field that the floor's schema doesn't have optional (`Option<T>`, missing
# decodes as `None`), so a client built from a newer contract still decodes an older server's
# responses. Move the floor only to a released tag, and only when support for the releases
# below it is dropped on purpose: moving it up turns those fields back into required ones, and
# a server older than the new floor then fails to decode. Run `scripts/gen-api.sh` after.
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$NATIVE_DIR/contract"
# file in contract/ -> path in the repo
FILES=("openapi.json:backend/openapi.json" "socket-events.json:backend/socket-events.json" "wire-contract.md:docs-site/docs/architecture/wire-contract.md")

FLOOR_FILE="floor-openapi.json"

check_floor() {
  local commit want got
  commit="$(sed -n 's/^commit=//p' "$DIR/FLOOR")"
  want="$(sed -n "s/^$FLOOR_FILE=//p" "$DIR/FLOOR")"
  got="$(sha256sum "$DIR/$FLOOR_FILE" | cut -d' ' -f1)"
  [ "$want" = "$got" ] || { echo "$FLOOR_FILE doesn't match FLOOR" >&2; exit 1; }
  if git -C "$NATIVE_DIR" cat-file -e "$commit" 2>/dev/null; then
    git -C "$NATIVE_DIR" show "$commit:backend/openapi.json" | cmp - "$DIR/$FLOOR_FILE"
  fi
  echo "floor matches FLOOR ($(sed -n 's/^ref=//p' "$DIR/FLOOR"), $commit)"
}

if [ "${1:-}" = "--floor" ]; then
  ref="${2:?usage: pin-contract.sh --floor <release tag>}"
  commit="$(git -C "$NATIVE_DIR" rev-parse "$ref^{commit}")"
  git -C "$NATIVE_DIR" show "$commit:backend/openapi.json" > "$DIR/$FLOOR_FILE"
  {
    echo "# The oldest server release the native client reads. Update only with scripts/pin-contract.sh --floor <tag>."
    echo "ref=$ref"
    echo "commit=$commit"
    echo "$FLOOR_FILE=$(sha256sum "$DIR/$FLOOR_FILE" | cut -d' ' -f1)"
  } > "$DIR/FLOOR.new"
  mv "$DIR/FLOOR.new" "$DIR/FLOOR"
  echo "floor pinned to $ref ($commit)"
  exit 0
fi

if [ "${1:-}" = "--check" ]; then
  check_floor
  commit="$(sed -n 's/^commit=//p' "$DIR/PIN")"
  for entry in "${FILES[@]}"; do
    name="${entry%%:*}"
    want="$(sed -n "s/^$name=//p" "$DIR/PIN")"
    got="$(sha256sum "$DIR/$name" | cut -d' ' -f1)"
    [ "$want" = "$got" ] || { echo "$name doesn't match PIN" >&2; exit 1; }
    if git -C "$NATIVE_DIR" cat-file -e "$commit" 2>/dev/null; then
      git -C "$NATIVE_DIR" show "$commit:${entry#*:}" | cmp - "$DIR/$name"
    fi
  done
  echo "contract matches PIN ($commit)"
  exit 0
fi

ref="${1:?usage: pin-contract.sh <git-ref> | --check}"
commit="$(git -C "$NATIVE_DIR" rev-parse "$ref")"
{
  echo "# The contract every generator reads. Update only with scripts/pin-contract.sh <git-ref>."
  echo "ref=$ref"
  echo "commit=$commit"
  for entry in "${FILES[@]}"; do
    name="${entry%%:*}"
    git -C "$NATIVE_DIR" show "$commit:${entry#*:}" > "$DIR/$name"
    echo "$name=$(sha256sum "$DIR/$name" | cut -d' ' -f1)"
  done
} > "$DIR/PIN.new"
mv "$DIR/PIN.new" "$DIR/PIN"
echo "pinned $ref ($commit)"
