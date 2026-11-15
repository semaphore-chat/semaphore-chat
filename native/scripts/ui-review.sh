#!/usr/bin/env bash
# Native UI review: every story of the GPUI client rendered on a base ref and on the working tree,
# pixel-diffed, with a report and a section for a pull request description.
#
#   native/scripts/ui-review.sh [--base <ref>] [--stories <glob-or-comma-list>]
#                               [--sizes desktop:1280:720,phone:390:844] [--reuse]
#                               [--pr <N> [--update-pr]]
#
#   --base <ref>       compare against merge-base(<ref>, HEAD); default origin/main
#   --stories <list>   comma-separated story ids or globs (kit-*, shell-connected), default all
#   --sizes <list>     name:width:height, comma-separated; default desktop:1280:720,phone:390:844
#   --fuzz <percent>   differing pixels at or below this share of a shot count as unchanged
#                      (default 0: an exact pixel comparison)
#   --reuse            skip rendering the base when it was already rendered for the same base
#                      commit, sizes and --stories filter
#   --pr <n>           the pull request to publish the section to (--update-pr writes it)
#   --update-pr        replace (or append) the marked section in PR <n>'s description
#   --shards <n>       renders to run in parallel, and comparison shards (default 8,
#                      UI_REVIEW_SHARDS)
#
# Output (gitignored, under native/.ui-review/):
#   shots/{base,head,head2}/<size>/<story>.png   the renders (head twice, for unstable stories)
#   out/composites/<story>-<size>.png            before | after | diff, for what changed
#   out/report.json                              every story and shot, machine-readable
#   out/pr-block.md                              the section for a pull request description
#
# Everything that builds or renders runs in the pinned image through scripts/in-image.sh, as the
# host user. Docs: docs-site/docs/contributing/native-ui-review.md
set -euo pipefail

BASE_REF=origin/main
STORIES=""
SIZES="desktop:1280:720,phone:390:844"
FUZZ=0
REUSE=0
PR=""
UPDATE_PR=0
SHARDS="${UI_REVIEW_SHARDS:-8}"

die() {
  echo "ui-review: $*" >&2
  exit 1
}
log() { echo "ui-review: $*" >&2; }

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE_REF="${2:?--base needs a ref}"; shift 2 ;;
    --stories) STORIES="${2:?--stories needs a list}"; shift 2 ;;
    --sizes) SIZES="${2:?--sizes needs a list}"; shift 2 ;;
    --fuzz) FUZZ="${2:?--fuzz needs a percentage}"; shift 2 ;;
    --reuse) REUSE=1; shift ;;
    --pr) PR="${2:?--pr needs a number}"; shift 2 ;;
    --update-pr) UPDATE_PR=1; shift ;;
    --shards) SHARDS="${2:?--shards needs a number}"; shift 2 ;;
    --help | -h) usage; exit 0 ;;
    *) die "unknown option $1 (try --help)" ;;
  esac
done

[[ "$FUZZ" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "--fuzz takes a percentage, got '$FUZZ'"
[[ "$SHARDS" =~ ^[1-9][0-9]*$ ]] || die "--shards takes a count, got '$SHARDS'"
[[ -z "$PR" || "$PR" =~ ^[0-9]+$ ]] || die "--pr takes a number, got '$PR'"
(( UPDATE_PR == 0 )) || [[ -n "$PR" ]] || die "--update-pr needs --pr <n>"
command -v python3 >/dev/null || die "python3 is required"

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
NATIVE="$REPO_ROOT/native"
[[ -f "$NATIVE/scripts/in-image.sh" ]] || die "this is not the native checkout ($NATIVE/scripts/in-image.sh is missing)"
IN_IMAGE="$NATIVE/scripts/in-image.sh"
RENDER="$NATIVE/scripts/ui-review-render.sh"
REPORT="$NATIVE/scripts/ui-review-report.py"
UIR="$NATIVE/.ui-review"
BASE_DIR="$UIR/base-src"
SHOTS="$UIR/shots"
OUT="$UIR/out"
WORK="$UIR/work"
META="$UIR/meta"
# The image sets CARGO_TARGET_DIR; its volume is shared by every build of this checkout, so the
# base worktree's build is incremental against the head's.
RIG=/cache/target/debug/rig-shot
export VK_ICD_FILENAMES="${VK_ICD_FILENAMES:-/usr/share/vulkan/icd.d/lvp_icd.json}"

SIZE_NAMES=()
SIZE_WIDTHS=()
SIZE_HEIGHTS=()
while IFS=: read -r name width height; do
  [[ -n "$name" && "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] ||
    die "--sizes: expected name:width:height, got '$name:$width:$height'"
  SIZE_NAMES+=("$name")
  SIZE_WIDTHS+=("$width")
  SIZE_HEIGHTS+=("$height")
done < <(tr ',' '\n' <<<"$SIZES")
(( ${#SIZE_NAMES[@]} > 0 )) || die "--sizes is empty"

PATTERNS=()
if [[ -n "$STORIES" ]]; then
  while IFS= read -r pattern; do
    [[ -n "$pattern" ]] && PATTERNS+=("$pattern")
  done < <(tr ',' '\n' <<<"$STORIES")
fi

# ---------------------------------------------------------------- the image

# in_native <native-dir> <command...>: run a command in the build image, in that checkout's native/
# directory. The base worktree lives inside this checkout, so the image mounts it too.
in_native() {
  local dir="$1"
  shift
  # shellcheck disable=SC2016 # $1 and $@ expand in the container's bash, not here
  "$IN_IMAGE" bash -c 'cd "$1" || exit 1; shift; exec "$@"' _ "$dir" "$@"
}

build_rig() { # <native-dir>
  local output
  if ! output="$(in_native "$1" cargo build -q -p rig-shot 2>&1)"; then
    printf '%s\n' "$output" >&2
    die "cargo build -p rig-shot failed in ${1#"$REPO_ROOT"/}"
  fi
}

# ---------------------------------------------------------------- base

git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null || die "no such ref: $BASE_REF"
MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)" || die "no merge-base between $BASE_REF and HEAD"
HEAD_SHA="$(git rev-parse HEAD)"
HEAD_REF="$(git rev-parse --abbrev-ref HEAD)"
DIRTY=0
[[ -z "$(git status --porcelain -- native)" ]] || DIRTY=1

HAS_BASE=1
if ! git cat-file -e "$MERGE_BASE:native/rigs/shot/Cargo.toml" 2>/dev/null; then
  log "base ${MERGE_BASE:0:7} has no native client — every story will show as new"
  HAS_BASE=0
fi

REGEN="native/scripts/ui-review.sh --base $BASE_REF"
[[ -z "$STORIES" ]] || REGEN+=" --stories $STORIES"
[[ "$SIZES" == "desktop:1280:720,phone:390:844" ]] || REGEN+=" --sizes $SIZES"
[[ "$FUZZ" == 0 ]] || REGEN+=" --fuzz $FUZZ"
if [[ -n "$PR" ]]; then REGEN+=" --pr $PR --update-pr"; fi

rm -rf "$WORK" "$OUT"
mkdir -p "$WORK" "$OUT" "$META" "$SHOTS"

# ---------------------------------------------------------------- cleanup

BASE_WORKTREE=0
cleanup() {
  local status=$?
  if (( BASE_WORKTREE )); then
    git -C "$REPO_ROOT" worktree remove --force "$BASE_DIR" >/dev/null 2>&1 ||
      rm -rf "$BASE_DIR"
    git -C "$REPO_ROOT" worktree prune
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------- selecting stories

select_stories() { # <all-ids-file>
  local id pattern
  if (( ${#PATTERNS[@]} == 0 )); then
    cat "$1"
    return
  fi
  while read -r id; do
    for pattern in "${PATTERNS[@]}"; do
      # shellcheck disable=SC2053 # the right side is a glob on purpose
      if [[ "$id" == $pattern ]]; then
        printf '%s\n' "$id"
        break
      fi
    done
  done <"$1"
}

check_patterns() { # <head-ids-file> [<base-ids-file>]
  local pattern missing=()
  for pattern in "${PATTERNS[@]}"; do
    [[ "$pattern" == *[\*\?\[]* ]] && continue
    if ! grep -qxF -- "$pattern" "$1" && ! { [[ -n "${2:-}" ]] && grep -qxF -- "$pattern" "$2"; }; then
      missing+=("$pattern")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    die "unknown story id(s): ${missing[*]} — rig-shot --list shows every story"
  fi
}

# ---------------------------------------------------------------- rendering

RENDER_ERRORS=()

render_side() { # <native-dir> <ids-file> <out-root> <label>
  local dir="$1" ids="$2" root="$3" label="$4"
  local index size width height steps output line generic
  for index in "${!SIZE_NAMES[@]}"; do
    size="${SIZE_NAMES[index]}"
    width="${SIZE_WIDTHS[index]}"
    height="${SIZE_HEIGHTS[index]}"
    steps="$WORK/$label-$size.steps"
    : >"$steps"
    while read -r id; do
      [[ -n "$id" ]] || continue
      printf 'story %s %s %s dark-teal-minimal\nshot %s\n' "$id" "$width" "$height" "$id" >>"$steps"
    done <"$ids"
    [[ -s "$steps" ]] || continue
    log "rendering $label at $size ($(grep -c '^story ' "$steps") stories, $SHARDS shards) ..."
    generic=0
    if ! output="$(in_native "$dir" bash "$RENDER" "$steps" "$root/$size" "$WORK/$label-$size" "$SHARDS" "$RIG" 2>&1)"; then
      while IFS= read -r line; do
        case "$line" in
          "ui-review-render: failed "*) RENDER_ERRORS+=("$label/$size: ${line#ui-review-render: failed }") ;;
          "ui-review-render: "*) : ;;
          *) printf '%s\n' "$line" >&2; generic=1 ;;
        esac
      done <<<"$output"
      if (( generic )) && ! grep -q '^ui-review-render: failed ' <<<"$output"; then
        RENDER_ERRORS+=("$label/$size: rendering failed (see the output above)")
      fi
    fi
  done
}

# ---------------------------------------------------------------- base renders

BASE_ALL="$META/base-stories.txt"
BASE_SELECTED="$META/base-selected.txt"

reuse_base() {
  (( REUSE )) || return 1
  [[ "$(cat "$META/base-sha" 2>/dev/null || true)" == "$MERGE_BASE" ]] || return 1
  [[ "$(cat "$META/base-filter" 2>/dev/null || true)" == "${STORIES:-<all>}" ]] || return 1
  [[ "$(cat "$META/base-sizes" 2>/dev/null || true)" == "$SIZES" ]] || return 1
  [[ -s "$BASE_SELECTED" ]] || return 1
  # The recorded lists are useless if the renders themselves are gone.
  [[ -n "$(find "$SHOTS/base" -name '*.png' -print -quit 2>/dev/null)" ]] || return 1
  return 0
}

if (( HAS_BASE )); then
  if reuse_base; then
    log "reusing the base renders of ${MERGE_BASE:0:7} (native/.ui-review/shots/base)"
  else
    : >"$BASE_ALL"
    : >"$BASE_SELECTED"
    if git -C "$REPO_ROOT" worktree list --porcelain | grep -qxF "worktree $BASE_DIR"; then
      git -C "$REPO_ROOT" worktree remove --force "$BASE_DIR"
    fi
    rm -rf "$BASE_DIR" "$SHOTS/base"
    log "checking out base ${MERGE_BASE:0:7} in native/.ui-review/base-src ..."
    git -C "$REPO_ROOT" worktree add --detach --quiet "$BASE_DIR" "$MERGE_BASE"
    BASE_WORKTREE=1
    log "building rig-shot for the base ..."
    build_rig "$BASE_DIR/native"
    in_native "$BASE_DIR/native" "$RIG" --list >"$BASE_ALL"
    select_stories "$BASE_ALL" >"$BASE_SELECTED"
    render_side "$BASE_DIR/native" "$BASE_SELECTED" "$SHOTS/base" base
    printf '%s\n' "$MERGE_BASE" >"$META/base-sha"
    printf '%s\n' "${STORIES:-<all>}" >"$META/base-filter"
    printf '%s\n' "$SIZES" >"$META/base-sizes"
  fi
else
  : >"$BASE_ALL"
  : >"$BASE_SELECTED"
fi

# ---------------------------------------------------------------- head renders

HEAD_ALL="$META/head-stories.txt"
HEAD_SELECTED="$META/head-selected.txt"
log "building rig-shot for the working tree ..."
build_rig "$NATIVE"
in_native "$NATIVE" "$RIG" --list >"$HEAD_ALL"
select_stories "$HEAD_ALL" >"$HEAD_SELECTED"
check_patterns "$HEAD_ALL" "$BASE_ALL"
if [[ ! -s "$HEAD_SELECTED" && ! -s "$BASE_SELECTED" ]]; then
  die "no story matched --stories $STORIES"
fi

rm -rf "$SHOTS/head" "$SHOTS/head2"
render_side "$NATIVE" "$HEAD_SELECTED" "$SHOTS/head" head
render_side "$NATIVE" "$HEAD_SELECTED" "$SHOTS/head2" head2

# ---------------------------------------------------------------- comparing

python3 "$REPORT" jobs \
  --base-stories "$BASE_SELECTED" --head-stories "$HEAD_SELECTED" --sizes "$SIZES" \
  --base-dir "$SHOTS/base" --head-dir "$SHOTS/head" --head2-dir "$SHOTS/head2" \
  --out "$WORK/jobs.tsv"

: >"$WORK/compare.tsv"
log "comparing $(wc -l <"$WORK/jobs.tsv" | tr -d ' ') shots ..."
if ! in_native "$NATIVE" "$RIG" --compare "$WORK/jobs.tsv" \
  --composites "$OUT/composites" --fuzz "$FUZZ" >"$WORK/compare.tsv"; then
  log "the comparison could not read every shot — see the report"
fi

python3 "$REPORT" report \
  --compare "$WORK/compare.tsv" --jobs "$WORK/jobs.tsv" \
  --json "$OUT/report.json" --markdown "$OUT/pr-block.md" \
  --repo-root "$REPO_ROOT" --base-ref "$BASE_REF" --base-sha "$MERGE_BASE" \
  --head-ref "$HEAD_REF" --head-sha "$HEAD_SHA" --dirty "$DIRTY" --sizes "$SIZES" \
  --fuzz "$FUZZ" --command "$REGEN"

composites="$(find "$OUT/composites" -type f 2>/dev/null | wc -l | tr -d ' ')"
log "report:     native/.ui-review/out/report.json"
log "PR section: native/.ui-review/out/pr-block.md"
log "composites: native/.ui-review/out/composites/ ($composites images)"

# ---------------------------------------------------------------- failures

COMPARE_FAILED="$(awk -F'\t' '$3 == "failed" { print $1 " (" $2 ")" }' "$WORK/compare.tsv" | sort -u)"
if (( ${#RENDER_ERRORS[@]} > 0 )); then
  log "stories that did not render:"
  printf '  %s\n' "${RENDER_ERRORS[@]}" >&2
fi
if [[ -n "$COMPARE_FAILED" ]]; then
  log "shots that could not be compared:"
  printf '  %s\n' "$COMPARE_FAILED" >&2
fi
if (( ${#RENDER_ERRORS[@]} > 0 )) || [[ -n "$COMPARE_FAILED" ]]; then
  exit 1
fi

# ---------------------------------------------------------------- the pull request

if [[ -n "$PR" ]]; then
  command -v gh >/dev/null || die "--pr needs the gh CLI"
  if (( UPDATE_PR )); then
    gh pr view "$PR" --json body --jq .body >"$WORK/pr-body.md"
    python3 "$REPORT" splice --body "$WORK/pr-body.md" --block "$OUT/pr-block.md" --out "$WORK/pr-body.new.md"
    gh pr edit "$PR" --body-file "$WORK/pr-body.new.md" >/dev/null
    log "updated the native UI review section of PR #$PR"
  else
    log "--pr $PR: pass --update-pr to write the section into the description (native/.ui-review/out/pr-block.md)"
  fi
fi
