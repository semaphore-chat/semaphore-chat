#!/usr/bin/env bash
# The generators read native/contract/, not backend/, so a backend change reaches the native
# client only when the pin moves. PIN records the commit it came from, so generation is repeatable.
#
#   native/scripts/pin-contract.sh <git-ref>   copy the contract from that ref and rewrite PIN
#   native/scripts/pin-contract.sh --check     fail if the files don't match PIN or that commit
set -euo pipefail

NATIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$NATIVE_DIR/contract"
# file in contract/ -> path in the repo
FILES=("openapi.json:backend/openapi.json" "socket-events.json:backend/socket-events.json" "wire-contract.md:docs-site/docs/architecture/wire-contract.md")

if [ "${1:-}" = "--check" ]; then
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
