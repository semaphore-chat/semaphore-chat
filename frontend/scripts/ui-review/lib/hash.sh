# shellcheck shell=bash
# Hashing helpers for ui-review.sh (sourced; tested by ../test-hash.sh).
# Portable: GNU coreutils (Linux), `shasum` (macOS), else `git hash-object`.

# digest <1|256>: hex digest of stdin. Uses sha<N>sum, else `shasum -a <N>`,
# else `git hash-object --stdin` (SHA-1 of a git blob — a different value, but
# stable on that machine, which is all the callers need: cache keys and names).
digest() {
  local bits="${1:-256}"
  if command -v "sha${bits}sum" >/dev/null 2>&1; then
    "sha${bits}sum" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a "$bits" | cut -d' ' -f1
  else
    git hash-object --stdin
  fi
}

# Files whose content decides the dependency image (relative to a checkout).
IMAGE_TAG_FILES=(frontend/Dockerfile package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc
  shared/package.json frontend/package.json)

# image_tag <checkout>: content-addressed tag of the dependency image — same
# deps → same image, shared across checkouts. Files that don't exist in that
# checkout (e.g. a merge-base older than patches/) are skipped, not an error.
image_tag() {
  local root="$1" f files=()
  for f in "${IMAGE_TAG_FILES[@]}" ; do
    if [[ -f "$root/$f" ]]; then files+=("$root/$f"); fi
  done
  for f in "$root"/patches/*; do # unmatched glob stays literal and fails -f
    if [[ -f "$f" ]]; then files+=("$f"); fi
  done
  if (( ${#files[@]} )); then cat -- "${files[@]}"; fi | digest 256 | cut -c1-12
}
