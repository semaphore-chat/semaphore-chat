#!/usr/bin/env bash
# Publish / prune PR screenshots on the orphan `pr-screenshots` branch.
#
# Plain bash + git (+ gh for prune): runs the same on a laptop and on a bare
# ubuntu-latest runner (.github/workflows/prune-pr-screenshots.yml). It never
# checks anything out and never touches another branch: it builds the new tree
# in a temporary index from the remote branch, writes ONE parentless commit
# (the branch stays a single commit, so it never grows history) and pushes it
# with --force-with-lease against the tip it started from, retrying from a
# fresh fetch if someone else pushed in between.
#
# Layout of the branch:  README.md, pr-<n>/<run>/<story>--<viewport>.webp
#
# Usage:
#   pr-screenshots.sh publish --pr <n> --folder pr-<n>/<run> --dir <files dir>
#       Replace everything under pr-<n>/ with <files dir>'s files at <folder>/.
#   pr-screenshots.sh prune --pr <n> [--dry-run]
#       Remove pr-<n>/ (e.g. when that PR closed). No gh needed.
#   pr-screenshots.sh prune [--dry-run]
#       Remove every pr-<n>/ whose PR is merged or closed (asks gh; a PR gh
#       can't resolve is kept). No-op when the branch doesn't exist.
# Options: --remote <name> (default origin), --branch <name> (default
#          pr-screenshots), --repo <owner/name> (for gh; default: gh's own
#          detection, or $GITHUB_REPOSITORY in Actions).
# Exit codes: 0 ok / nothing to do, 1 error, 3 push rejected for lack of
#             permission (read-only token, e.g. a fork PR's workflow run).
set -euo pipefail

REMOTE=origin
BRANCH=pr-screenshots
REPO="${GITHUB_REPOSITORY:-}"
PR=""
FOLDER=""
DIR=""
DRY_RUN=0
MAX_ATTEMPTS=5

die() { echo "pr-screenshots: $*" >&2; exit 1; }
log() { echo "pr-screenshots: $*" >&2; }

cmd="${1:-}"
[[ -n "$cmd" ]] || die "usage: pr-screenshots.sh <publish|prune> [options] (see header)"
shift
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR="$2"; shift 2 ;;
    --folder) FOLDER="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
[[ -z "$PR" || "$PR" =~ ^[0-9]+$ ]] || die "--pr must be a number"

cd "$(git rev-parse --show-toplevel)"
PRIVATE_REF="refs/ui-review/$BRANCH"
TMP_INDEX="$(mktemp)"
rm -f "$TMP_INDEX" # git wants to create it itself
cleanup() { rm -f "$TMP_INDEX" "$TMP_INDEX.lock"; git update-ref -d "$PRIVATE_REF" 2>/dev/null || true; }
trap cleanup EXIT

README='# PR screenshots

Generated before/after UI screenshots referenced from pull request
descriptions (see `frontend/scripts/ui-review/` and
docs-site/docs/contributing/ui-review.md). One folder per PR (`pr-<number>/`).

This branch is rewritten as a single commit on every publish and pruned when
PRs close — do not base anything on it or push to it by hand.
'

# Fetches the remote branch into a private ref; prints its sha ("" if absent).
fetch_tip() {
  git update-ref -d "$PRIVATE_REF" 2>/dev/null || true
  if ! git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
    echo ""
    return
  fi
  git fetch --quiet --no-tags "$REMOTE" "+refs/heads/$BRANCH:$PRIVATE_REF"
  git rev-parse "$PRIVATE_REF"
}

idx() { GIT_INDEX_FILE="$TMP_INDEX" git "$@"; }

# Removes every index entry under <dir>/.
remove_dir() {
  idx ls-files -z -- "$1/" | xargs -0 -r env GIT_INDEX_FILE="$TMP_INDEX" git update-index --force-remove --
}

ensure_readme() {
  local sha
  sha="$(printf '%s' "$README" | git hash-object -w --stdin)"
  idx update-index --add --cacheinfo "100644,$sha,README.md"
}

# Folders pr-<n> currently on the branch tip.
pr_folders() {
  git ls-tree --name-only "$1" | grep -E '^pr-[0-9]+$' || true
}

# Decides which pr-<n> folders prune should drop; prints them.
folders_to_prune() {
  local tip="$1" folder number state
  if [[ -n "$PR" ]]; then
    pr_folders "$tip" | grep -Fx "pr-$PR" || true
    return
  fi
  command -v gh >/dev/null || die "prune without --pr needs the gh CLI"
  local repo_args=()
  [[ -n "$REPO" ]] && repo_args=(--repo "$REPO")
  for folder in $(pr_folders "$tip"); do
    number="${folder#pr-}"
    if state="$(gh pr view "$number" "${repo_args[@]}" --json state --jq .state 2>/dev/null)"; then
      case "$state" in
        MERGED|CLOSED) echo "$folder" ;;
        *) log "keep $folder ($state)" ;;
      esac
    else
      log "keep $folder (could not look up PR #$number)"
    fi
  done
}

# Builds the new tree for the current tip in the temp index; prints the tree
# sha, or nothing when there is nothing to change.
build_tree() {
  local tip="$1" file sha
  rm -f "$TMP_INDEX"
  if [[ -n "$tip" ]]; then idx read-tree "$tip"; else idx read-tree --empty; fi
  case "$cmd" in
    publish)
      remove_dir "pr-$PR"
      for file in "$DIR"/*; do
        [[ -f "$file" ]] || continue
        sha="$(git hash-object -w -- "$file")"
        idx update-index --add --cacheinfo "100644,$sha,$FOLDER/$(basename "$file")"
      done
      ;;
    prune)
      local folders
      folders="$(folders_to_prune "$tip")"
      [[ -n "$folders" ]] || return 0
      while IFS= read -r folder; do
        if [[ $DRY_RUN -eq 1 ]]; then log "would remove $folder/"; else log "remove $folder/"; fi
        remove_dir "$folder"
      done <<<"$folders"
      [[ $DRY_RUN -eq 1 ]] && return 0
      ;;
  esac
  ensure_readme
  local tree
  tree="$(idx write-tree)"
  if [[ -n "$tip" && "$tree" == "$(git rev-parse "$tip^{tree}")" ]]; then
    return 0
  fi
  echo "$tree"
}

run() {
  local attempt tip tree commit message push_out
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    tip="$(fetch_tip)"
    if [[ "$cmd" == prune && -z "$tip" ]]; then
      log "branch $BRANCH does not exist on $REMOTE — nothing to prune"
      return 0
    fi
    tree="$(build_tree "$tip")"
    if [[ -z "$tree" ]]; then
      log "nothing to change"
      return 0
    fi
    if [[ "$cmd" == publish ]]; then message="Publish $FOLDER"; else message="Prune closed PR screenshots"; fi
    commit="$(git commit-tree "$tree" -m "$message")"
    if push_out="$(git push --porcelain --force-with-lease="refs/heads/$BRANCH:$tip" "$REMOTE" "$commit:refs/heads/$BRANCH" 2>&1)"; then
      log "pushed $BRANCH ($message) as ${commit:0:7}"
      return 0
    fi
    if grep -qiE 'permission|403|denied|not allowed|protected branch' <<<"$push_out"; then
      log "push not permitted (read-only token?):"
      echo "$push_out" >&2
      return 3
    fi
    log "push rejected (attempt $attempt/$MAX_ATTEMPTS), re-fetching and retrying:"
    echo "$push_out" >&2
    sleep $((attempt * 2))
  done
  die "gave up after $MAX_ATTEMPTS attempts"
}

case "$cmd" in
  publish)
    [[ -n "$PR" ]] || die "publish needs --pr"
    [[ "$FOLDER" == "pr-$PR/"* && "$FOLDER" != *..* ]] || die "--folder must be pr-$PR/<run>"
    [[ -d "$DIR" ]] || die "--dir $DIR is not a directory"
    [[ $DRY_RUN -eq 0 ]] || die "--dry-run is only for prune"
    run
    ;;
  prune)
    run
    ;;
  *)
    die "unknown command $cmd (publish|prune)"
    ;;
esac
