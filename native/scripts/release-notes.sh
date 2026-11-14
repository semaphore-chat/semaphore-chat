#!/usr/bin/env bash
# Write the release notes of a native preview release to stdout.
#
#   scripts/release-notes.sh <version> <ref> <repo>
#
# <ref> is what is released (the tag on a tag build, the commit on a dispatch). The changes are
# the commits that touch native/ since the previous native-v* tag reachable from <ref> (merges
# left out), or the latest 100 when there is no earlier tag. Needs the full history
# (actions/checkout with fetch-depth: 0).
set -euo pipefail

die() { echo "release-notes: $*" >&2; exit 1; }
[ $# -eq 3 ] || die "usage: $0 <version> <ref> <owner/repo>"
version="$1" ref="$2" repo="$3"
tag="native-v$version"
git rev-parse --verify --quiet "$ref^{commit}" >/dev/null || die "no commit $ref"

# The newest native-v* tag before <ref>: describe from the parent, so a tag on <ref> itself
# (the tag build) isn't its own previous release.
previous=""
if git rev-parse --verify --quiet "$ref^" >/dev/null; then
  previous="$(git describe --tags --abbrev=0 --match 'native-v*' "$ref^" 2>/dev/null || true)"
fi

cat <<EOF
**Preview** of the native Semaphore Chat desktop client (Rust, GPUI), released next to the
Electron app, which is unchanged. Expect rough edges; the Electron app stays the supported client.

| Platform | Download |
|---|---|
| Linux, any distribution | \`Semaphore-Chat-Native-$version-x86_64.AppImage\` (updates itself) |
| Debian, Ubuntu | \`semaphore-chat-native_${version}_amd64.deb\` |
| Fedora, openSUSE | \`semaphore-chat-native-$version-1.x86_64.rpm\` |
| Windows 10/11 x64 | \`Semaphore-Chat-Native-Setup-$version-x64.exe\` (installer) or \`semaphore-chat-native-$version-windows-x86_64.zip\` (portable) |

The Windows files are not code-signed yet, so SmartScreen warns before the first start.
\`SHA256SUMS\` lists every file's SHA-256. \`latest.json\` is the update feed's manifest and
\`latest.json.sig\` its Ed25519 signature; installed copies read them from the
[native preview feed](https://github.com/$repo/releases/tag/native-preview-feed) and refuse
an unsigned or wrongly signed feed.

EOF

if [ -n "$previous" ]; then
  echo "## Changes in native/ since $previous"
  range="$previous..$ref"
  limit=()
else
  echo "## Recent changes in native/ (first preview release)"
  range="$ref"
  limit=(--max-count=100)
fi
echo
changes="$(git log --no-merges "${limit[@]}" --format='- %s (%h)' "$range" -- ':(top)native/')"
if [ -n "$changes" ]; then
  printf '%s\n' "$changes"
else
  echo "- No commits touched native/."
fi
if [ -n "$previous" ]; then
  echo
  echo "Full diff: https://github.com/$repo/compare/$previous...$tag"
fi
