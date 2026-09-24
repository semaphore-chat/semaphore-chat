#!/usr/bin/env bash
# Self-test for lib/hash.sh (digest, image_tag). Needs only bash + git + coreutils:
#   frontend/scripts/ui-review/test-hash.sh
# Covers: image_tag unchanged from the original `cat ... | sha256sum` formula,
# a checkout without patches/ (merge-base predating it), an empty patches/,
# missing optional files, patches changing the tag, and digest's fallbacks when
# sha<N>sum (macOS) or both sha<N>sum and shasum are absent.
set -euo pipefail

# shellcheck source=lib/hash.sh
source "$(cd "$(dirname "$0")" && pwd)/lib/hash.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

pass=0
ok() { echo "ok - $*"; pass=$((pass + 1)); }
fail() { echo "FAIL - $*" >&2; exit 1; }

mk_checkout() { # <dir>: every IMAGE_TAG_FILES entry, with distinct content
  local f
  for f in "${IMAGE_TAG_FILES[@]}"; do
    mkdir -p "$1/$(dirname "$f")"
    echo "$f" >"$1/$f"
  done
}

C="$T/full"
mk_checkout "$C"
mkdir -p "$C/patches"
echo p1 >"$C/patches/a.patch"; echo p2 >"$C/patches/b.patch"
expected="$(cd "$C" && cat frontend/Dockerfile package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc shared/package.json frontend/package.json patches/* | sha256sum | cut -c1-12)"
got="$(image_tag "$C")"
[[ "$got" == "$expected" ]] || fail "tag differs from the original formula ($got != $expected)"
ok "tag matches the original formula (existing images stay valid)"

N="$T/nopatches"
mk_checkout "$N"
got="$(image_tag "$N")" || fail "image_tag failed without patches/"
[[ "$got" =~ ^[0-9a-f]{12}$ ]] || fail "bad tag without patches/: $got"
[[ "$got" != "$(image_tag "$C")" ]] || fail "patches don't affect the tag"
ok "no patches/ dir: succeeds under set -euo pipefail; patches change the tag"

mkdir "$N/patches"
[[ "$(image_tag "$N")" == "$got" ]] || fail "empty patches/ changed the tag"
ok "empty patches/ dir: same tag as none"

rm "$N/.npmrc"
got2="$(image_tag "$N")" || fail "image_tag failed with a file missing"
[[ "$got2" =~ ^[0-9a-f]{12}$ && "$got2" != "$got" ]] || fail "missing .npmrc: $got2"
ok "missing optional file: skipped, tag still computed"

# digest fallbacks: a PATH holding only what each branch needs.
LIB="$(cd "$(dirname "$0")" && pwd)/lib/hash.sh"
link_tools() { local d="$1" t; shift; mkdir -p "$d"; for t in "$@"; do ln -s "$(command -v "$t")" "$d/$t"; done; }
digest_with_path() { # <PATH> <bits>: digest of "abc" in a bash that sees only <PATH>
  # shellcheck disable=SC2016 # expanded by the inner bash
  env PATH="$1" "$BASH" -c 'source "$1"; printf abc | digest "$2"' _ "$LIB" "$2"
}
want256="$(printf abc | sha256sum | cut -d' ' -f1)"
want1="$(printf abc | sha1sum | cut -d' ' -f1)"
[[ "$(digest_with_path "$PATH" 256)" == "$want256" && "$(digest_with_path "$PATH" 1)" == "$want1" ]] || fail "digest with coreutils"
ok "digest: sha<N>sum"

link_tools "$T/bin-mac" cut git
cat >"$T/bin-mac/shasum" <<EOF
#!/bin/sh
# stub of macOS shasum: \`shasum -a N\` prints what shaNsum does
[ "\$1" = -a ] || exit 2
case "\$2" in 1) exec "$(command -v sha1sum)" ;; 256) exec "$(command -v sha256sum)" ;; esac
exit 2
EOF
chmod +x "$T/bin-mac/shasum"
[[ "$(digest_with_path "$T/bin-mac" 256)" == "$want256" && "$(digest_with_path "$T/bin-mac" 1)" == "$want1" ]] ||
  fail "shasum fallback"
ok "digest: no sha<N>sum (macOS) → shasum -a <N>"

link_tools "$T/bin-git" cut git
got="$(digest_with_path "$T/bin-git" 256)" || fail "git fallback failed"
[[ "$got" == "$(printf abc | git hash-object --stdin)" ]] || fail "git fallback gave $got"
ok "digest: neither → git hash-object"

echo "all $pass passed"
