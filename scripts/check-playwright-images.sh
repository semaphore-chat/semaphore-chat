#!/usr/bin/env bash
# Every mcr.microsoft.com/playwright image the repo uses, and every
# playwright-core@X.Y.Z driver pin installed into one, must match the
# @playwright/test version in pnpm-lock.yaml. The package and the image ship
# matching browser builds; when Dependabot bumps the package alone, the
# Dockerised E2E, voice E2E, UI review and Electron smoke fail with
# "Executable doesn't exist at /ms-playwright/...".
#
#   scripts/check-playwright-images.sh        (run from anywhere; CI runs it)
# docs/ (historical design specs) is not checked.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(grep -oE "^  '@playwright/test@[0-9]+\.[0-9]+\.[0-9]+'" pnpm-lock.yaml | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ -z "$version" ]; then
  echo "check-playwright-images: @playwright/test not found in pnpm-lock.yaml" >&2
  exit 1
fi

status=0
while IFS=: read -r file line match; do
  tag=$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<<"$match")
  if [ "$tag" != "$version" ]; then
    echo "$file:$line pins $match, but @playwright/test is $version" >&2
    status=1
  fi
done < <(grep -rnoE '(mcr\.microsoft\.com/playwright:v|playwright-core@)[0-9]+\.[0-9]+\.[0-9]+' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.ui-review --exclude-dir=docs \
  --exclude=CHANGELOG.md --exclude=check-playwright-images.sh . || true)

if [ "$status" -eq 0 ]; then
  echo "check-playwright-images: every Playwright image and playwright-core pin matches @playwright/test $version"
else
  echo "Update the pins above to $version (mcr.microsoft.com/playwright:v$version-jammy, playwright-core@$version)." >&2
fi
exit "$status"
