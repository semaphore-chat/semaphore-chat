#!/usr/bin/env bash
# Android UI review: every kit story rendered on a base ref and on the working tree, pixel-diffed,
# with a report and a section for a pull request description. The Android twin of ui-review.sh.
#
#   native/scripts/android-ui-review.sh [--base <ref>] [--stories <glob-or-comma-list>]
#                                       [--pr <N> [--update-pr]]
#
#   --base <ref>       compare against merge-base(<ref>, HEAD); default origin/main
#   --stories <list>   comma-separated story ids or globs (kit-button, kit-*), default all
#   --pr <n>           the pull request to publish the section to (--update-pr writes it)
#   --update-pr        replace (or append) the marked section in PR <n>'s description
#
# A story is a composable in native/android/kit/src/test/.../stories/KitStories.kt (kit-*) or
# native/android/screens/src/test/.../stories/ScreenStories.kt (screen-*). Each renders
# under Robolectric's native graphics (KitStoryShotsTest, no emulator and no Rust library) at
# every phone size (phone 360x800 dp, phone-large 412x915 dp, both xhdpi) in four themes (light
# and dark, violet and amber), so one story id here is `<story>-<theme>`, e.g.
# `kit-button-dark-violet`. The comparison is exact: Robolectric renders the same pixels every
# time, so there is no fuzz and no second render of the head.
#
# Output (gitignored, under native/android/.ui-review/):
#   shots/{base,head}/<size>/<story>-<theme>.png   the renders
#   out/composites/<story>-<theme>-<size>.png      before | after | diff, for what changed
#   out/report.json                                every story and shot, machine-readable
#   out/pr-block.md                                the section for a pull request description
#
# Everything that builds or renders runs in the Android image (native/scripts/android.sh
# --print-image) on the shared semaphore-test network, as the host user. It creates and removes
# no network. A base without the kit (no stories) shows every story as new.
set -euo pipefail

BASE_REF=origin/main
STORIES=""
PR=""
UPDATE_PR=0

die() {
  echo "android-ui-review: $*" >&2
  exit 1
}
log() { echo "android-ui-review: $*" >&2; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE_REF="${2:?--base needs a ref}"; shift 2 ;;
    --stories) STORIES="${2:?--stories needs a list}"; shift 2 ;;
    --pr) PR="${2:?--pr needs a number}"; shift 2 ;;
    --update-pr) UPDATE_PR=1; shift ;;
    --help | -h) usage; exit 0 ;;
    *) die "unknown option $1 (try --help)" ;;
  esac
done
[[ -z "$PR" || "$PR" =~ ^[0-9]+$ ]] || die "--pr takes a number, got '$PR'"
(( UPDATE_PR == 0 )) || [[ -n "$PR" ]] || die "--update-pr needs --pr <n>"
[[ "$STORIES" =~ ^[A-Za-z0-9*,_-]*$ ]] || die "--stories takes ids and globs, got '$STORIES'"

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
NATIVE="$REPO_ROOT/native"
REPORT="$NATIVE/scripts/ui-review-report.py"
COMPARE="$NATIVE/scripts/AndroidUiReviewCompare.java"
UIR="$NATIVE/android/.ui-review"
BASE_DIR="$UIR/base-src"
SHOTS="$UIR/shots"
OUT="$UIR/out"
WORK="$UIR/work"
STORY_TEST="native/android/kit/src/test/java/app/semaphorechat/android/kit/stories/KitStoryShotsTest.kt"
SCREEN_STORY_TEST="native/android/screens/src/test/java/app/semaphorechat/android/screens/stories/ScreenStoryShotsTest.kt"
# The sizes the stories render at (StoryPalettes.kt's STORY_SIZES), for the report.
SIZES="phone:360:800,phone-large:412:915"

cd "$REPO_ROOT"
git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null || die "no such ref: $BASE_REF"
MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)" || die "no merge-base between $BASE_REF and HEAD"
HEAD_SHA="$(git rev-parse HEAD)"
HEAD_REF="$(git rev-parse --abbrev-ref HEAD)"
DIRTY=0
[[ -z "$(git status --porcelain -- native design)" ]] || DIRTY=1
HAS_BASE=1
if ! git cat-file -e "$MERGE_BASE:$STORY_TEST" 2>/dev/null; then
  log "base ${MERGE_BASE:0:7} has no kit stories: every story will show as new"
  HAS_BASE=0
fi

REGEN="native/scripts/android-ui-review.sh --base $BASE_REF"
[[ -z "$STORIES" ]] || REGEN+=" --stories $STORIES"
if [[ -n "$PR" ]]; then REGEN+=" --pr $PR --update-pr"; fi

IMAGE="$("$NATIVE/scripts/android.sh" --print-image)"
# shellcheck source=image-cache.sh
. "$NATIVE/scripts/image-cache.sh"
"$REPO_ROOT/scripts/test-net.sh" >/dev/null
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

# Runs a command in the Android image, in <dir>, with the same Gradle cache and HOME volumes as
# android.sh (so dependencies are fetched once).
in_image() { # <dir> <command...>
  local dir="$1"
  shift
  docker run --rm --init \
    --name "android-ui-review-$$-$RANDOM" \
    --network semaphore-test \
    --user "$HOST_UID:$HOST_GID" \
    -v "$REPO_ROOT:$REPO_ROOT" \
    -v "$(native_cache_mount "${NATIVE_GRADLE_CACHE:-semaphore-android-gradle}" /cache/gradle)" \
    -v semaphore-android-home:/cache/home \
    -w "$dir" \
    "$IMAGE" "$@"
}

render() { # <checkout-root> <shots-dir>
  local checkout="$1" dir="$2"
  rm -rf "$dir"
  mkdir -p "$dir"
  local args=(./gradlew --no-daemon --console=plain --quiet :kit:testDebugUnitTest
    --tests 'app.semaphorechat.android.kit.stories.KitStoryShotsTest')
  # The screens' stories (native/android/screens), where the checkout has them.
  if [[ -f "$checkout/$SCREEN_STORY_TEST" ]]; then
    args+=(:screens:testDebugUnitTest --tests 'app.semaphorechat.android.screens.stories.ScreenStoryShotsTest')
  fi
  args+=("-Psemaphore.shotsDir=$dir")
  [[ -z "$STORIES" ]] || args+=("-Psemaphore.stories=$STORIES")
  if ! in_image "$checkout/native/android" "${args[@]}" >"$WORK/render-$(basename "$dir").log" 2>&1; then
    tail -n 60 "$WORK/render-$(basename "$dir").log" >&2
    die "rendering the stories failed in ${checkout#"$REPO_ROOT"/} (log: $WORK/render-$(basename "$dir").log)"
  fi
}

# The story ids a render produced: `<story>-<theme>`, the same at every size.
ids() { # <shots-dir>
  find "$1" -name '*.png' -printf '%f\n' | sed 's/\.png$//' | sort -u
}

rm -rf "$WORK" "$OUT"
mkdir -p "$WORK" "$OUT" "$SHOTS"

BASE_WORKTREE=0
cleanup() {
  local status=$?
  if (( BASE_WORKTREE )); then
    git -C "$REPO_ROOT" worktree remove --force "$BASE_DIR" >/dev/null 2>&1 || rm -rf "$BASE_DIR"
    git -C "$REPO_ROOT" worktree prune
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

: >"$WORK/base-stories.txt"
if (( HAS_BASE )); then
  log "rendering the base (${MERGE_BASE:0:7})"
  rm -rf "$BASE_DIR"
  git -C "$REPO_ROOT" worktree prune
  git -C "$REPO_ROOT" worktree add --detach --quiet "$BASE_DIR" "$MERGE_BASE"
  BASE_WORKTREE=1
  render "$BASE_DIR" "$SHOTS/base"
  ids "$SHOTS/base" >"$WORK/base-stories.txt"
else
  rm -rf "$SHOTS/base"
  mkdir -p "$SHOTS/base"
fi

log "rendering the working tree"
render "$REPO_ROOT" "$SHOTS/head"
ids "$SHOTS/head" >"$WORK/head-stories.txt"
[[ -s "$WORK/head-stories.txt" ]] || die "the working tree rendered no stories"
log "$(wc -l <"$WORK/head-stories.txt") stories at $(tr ',' '\n' <<<"$SIZES" | wc -l) sizes"

python3 "$REPORT" jobs \
  --base-stories "$WORK/base-stories.txt" --head-stories "$WORK/head-stories.txt" \
  --sizes "$SIZES" --base-dir "$SHOTS/base" --head-dir "$SHOTS/head" --head2-dir "$SHOTS/head" \
  --out "$WORK/jobs.tsv" >&2
in_image "$REPO_ROOT" java "$COMPARE" "$WORK/jobs.tsv" "$OUT/composites" >"$WORK/compare.tsv" ||
  die "the comparison failed"

python3 "$REPORT" report --flavour android \
  --compare "$WORK/compare.tsv" --jobs "$WORK/jobs.tsv" \
  --json "$OUT/report.json" --markdown "$OUT/pr-block.md" --repo-root "$REPO_ROOT" \
  --base-ref "$BASE_REF" --base-sha "$MERGE_BASE" --head-ref "$HEAD_REF" --head-sha "$HEAD_SHA" \
  --dirty "$DIRTY" --sizes "$SIZES" --fuzz 0 --command "$REGEN"

if (( UPDATE_PR )); then
  gh pr view "$PR" --json body -q .body >"$WORK/pr-body.md"
  python3 "$REPORT" splice --flavour android --body "$WORK/pr-body.md" --block "$OUT/pr-block.md" \
    --out "$WORK/pr-body.new.md"
  gh pr edit "$PR" --body-file "$WORK/pr-body.new.md" >/dev/null
  log "updated the Android UI review section of PR #$PR"
fi

log "report: ${OUT#"$REPO_ROOT"/}/report.json, section: ${OUT#"$REPO_ROOT"/}/pr-block.md"
if awk -F'\t' '$3 == "failed" { found = 1 } END { exit !found }' "$WORK/compare.tsv"; then
  die "some shots failed: see the report"
fi
