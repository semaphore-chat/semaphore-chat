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
# Safety: any failing git step aborts the run (nothing is pushed), the new tree
# is checked before the push (every other PR's folder unchanged, README.md
# present, a publish's folder complete), and it refuses to write to a branch
# that doesn't look like a screenshots branch (history, or files other than
# README.md and pr-<n>/) — so a wrong --branch can't clobber code.
#
# Layout of the branch:  README.md, pr-<n>/<run>/<story>--<viewport>.webp
#
# Usage:
#   pr-screenshots.sh publish --pr <n> --folder pr-<n>/<run> --dir <files dir> [--keep-previous]
#       Replace everything under pr-<n>/ with <files dir>'s files at <folder>/.
#       --keep-previous: add <folder>/ but keep pr-<n>/'s earlier runs (drop
#       them later with `prune --pr <n> --keep <folder>`, once nothing links them).
#   pr-screenshots.sh prune --pr <n> [--keep pr-<n>/<run>] [--dry-run]
#       Remove pr-<n>/ (e.g. when that PR closed), or all of it but <run>. No gh needed.
#   pr-screenshots.sh prune [--dry-run]
#       Remove every pr-<n>/ whose PR is merged or closed (asks gh; a PR gh
#       can't resolve is kept). No-op when the branch doesn't exist.
# Options: --remote <name> (default origin), --branch <name> (default
#          pr-screenshots), --repo <owner/name> (for gh; default: gh's own
#          detection, or $GITHUB_REPOSITORY in Actions).
# The remote branch is fetched into refs/ui-review/<branch>, which is kept
# between runs so the next fetch only transfers what changed.
# Exit codes: 0 ok / nothing to do, 3 push rejected for lack of permission
#             (read-only token, e.g. a fork PR's workflow run), any other
#             non-zero: error (a failing git step exits with git's status).
set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true # bash >= 4.4; the script does not rely on it

REMOTE=origin
BRANCH=pr-screenshots
REPO="${GITHUB_REPOSITORY:-}"
PR=""
FOLDER=""
DIR=""
KEEP=""
KEEP_PREVIOUS=0
DRY_RUN=0
MAX_ATTEMPTS=8

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
    --keep) KEEP="$2"; shift 2 ;;
    --keep-previous) KEEP_PREVIOUS=1; shift ;;
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
cleanup() { rm -f "$TMP_INDEX" "$TMP_INDEX.lock"; }
trap cleanup EXIT

# shellcheck disable=SC2016 # backticks are Markdown, not command substitution
README='# PR screenshots

Generated before/after UI screenshots referenced from pull request
descriptions (see `frontend/scripts/ui-review/` and
docs-site/docs/contributing/ui-review.md). One folder per PR (`pr-<number>/`).

This branch is rewritten as a single commit on every publish and pruned when
PRs close — do not base anything on it or push to it by hand.
'

TIP=""            # remote branch tip this attempt builds on ("" = branch absent)
NEW_TREE=""       # tree to push ("" = nothing to change)
PRUNE_FOLDERS=()  # prune: pr-<n> folders to drop

# Fetches the remote branch into the private ref; sets TIP.
fetch_tip() {
  local rc=0
  git ls-remote --exit-code --heads "$REMOTE" "refs/heads/$BRANCH" >/dev/null || rc=$?
  case "$rc" in
    0)
      git fetch --quiet --no-tags "$REMOTE" "+refs/heads/$BRANCH:$PRIVATE_REF"
      TIP="$(git rev-parse --verify "$PRIVATE_REF^{commit}")"
      ;;
    2)
      git update-ref -d "$PRIVATE_REF" 2>/dev/null || true
      TIP=""
      ;;
    *) die "cannot list $REMOTE's branches (git ls-remote exit $rc)" ;;
  esac
}

# Refuses a tip that doesn't look like a screenshots branch (and drops its tracking ref).
not_screenshots() { git update-ref -d "$PRIVATE_REF" 2>/dev/null || true; die "refusing to touch $REMOTE/$BRANCH: $*, so it is not a screenshots branch"; }
check_branch() {
  [[ -n "$TIP" ]] || return 0
  local parents names bad
  parents="$(git rev-list --parents -n1 "$TIP")"
  [[ "$parents" != *" "* ]] || not_screenshots "it has history"
  names="$(git ls-tree --name-only "$TIP")"
  bad="$(grep -vxE 'README\.md|pr-[0-9]+' <<<"$names" || true)"
  [[ -z "$bad" ]] || not_screenshots "it holds '$(head -n1 <<<"$bad")'"
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

# Decides which pr-<n> folders prune drops; sets PRUNE_FOLDERS.
folders_to_prune() {
  local folder number state folders
  PRUNE_FOLDERS=()
  folders="$(pr_folders "$TIP")"
  if [[ -n "$PR" ]]; then
    if grep -qFx "pr-$PR" <<<"$folders"; then PRUNE_FOLDERS=("pr-$PR"); fi
    return 0
  fi
  command -v gh >/dev/null || die "prune without --pr needs the gh CLI"
  local repo_args=()
  [[ -n "$REPO" ]] && repo_args=(--repo "$REPO")
  for folder in $folders; do
    number="${folder#pr-}"
    if state="$(gh pr view "$number" "${repo_args[@]}" --json state --jq .state 2>/dev/null)"; then
      case "$state" in
        MERGED|CLOSED) PRUNE_FOLDERS+=("$folder") ;;
        *) log "keep $folder ($state)" ;;
      esac
    else
      log "keep $folder (could not look up PR #$number)"
    fi
  done
}

# Whether this command may change/drop top-level folder <name>.
touched() {
  case "$cmd" in
    publish) [[ "$1" == "pr-$PR" ]] ;;
    prune) [[ " ${PRUNE_FOLDERS[*]} " == *" $1 "* ]] ;;
  esac
}

# Builds the new tree for TIP in the temp index; sets NEW_TREE ("" when there
# is nothing to change). Any failing git step exits the script.
build_tree() {
  local file sha folder tree tip_tree
  NEW_TREE=""
  rm -f "$TMP_INDEX"
  if [[ -n "$TIP" ]]; then idx read-tree "$TIP"; else idx read-tree --empty; fi
  case "$cmd" in
    publish)
      if (( KEEP_PREVIOUS )); then remove_dir "$FOLDER"; else remove_dir "pr-$PR"; fi
      for file in "$DIR"/*; do
        [[ -f "$file" ]] || continue
        sha="$(git hash-object -w -- "$file")"
        idx update-index --add --cacheinfo "100644,$sha,$FOLDER/$(basename "$file")"
      done
      ;;
    prune)
      folders_to_prune
      (( ${#PRUNE_FOLDERS[@]} )) || return 0
      for folder in "${PRUNE_FOLDERS[@]}"; do
        local what="$folder/"
        [[ -z "$KEEP" ]] || what="$folder/ except $KEEP/"
        if (( DRY_RUN )); then log "would remove $what"; else log "remove $what"; fi
        remove_dir "$folder"
        if [[ -n "$KEEP" ]]; then git ls-tree -r "$TIP" -- "$KEEP/" | idx update-index --index-info; fi
      done
      (( DRY_RUN == 0 )) || return 0
      ;;
  esac
  ensure_readme
  tree="$(idx write-tree)"
  if [[ -n "$TIP" ]]; then
    tip_tree="$(git rev-parse --verify "$TIP^{tree}")"
    [[ "$tree" != "$tip_tree" ]] || return 0
  fi
  NEW_TREE="$tree"
}

# Last check before pushing: other folders untouched, README present, a
# publish's folder complete.
verify_tree() {
  local entries sha name now expected got
  if [[ -n "$TIP" ]]; then
    entries="$(git ls-tree "$TIP")"
    while read -r _ _ sha name; do
      [[ "$name" =~ ^pr-[0-9]+$ ]] || continue
      touched "$name" && continue
      now="$(git rev-parse --verify -q "$NEW_TREE:$name")" || die "refusing to push: $name/ would be lost"
      [[ "$now" == "$sha" ]] || die "refusing to push: $name/ would change"
    done <<<"$entries"
  fi
  git rev-parse --verify -q "$NEW_TREE:README.md" >/dev/null || die "refusing to push: README.md would be missing"
  if [[ "$cmd" == publish ]]; then
    expected="$(find "$DIR" -mindepth 1 -maxdepth 1 -type f ! -name '.*' | wc -l)"
    got="$(git ls-tree --name-only "$NEW_TREE:$FOLDER" 2>/dev/null | wc -l)"
    (( got == expected )) || die "refusing to push: $FOLDER/ would hold $got of $expected files"
  fi
}

run() {
  local attempt commit message push_out
  for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
    fetch_tip
    if [[ "$cmd" == prune && -z "$TIP" ]]; then
      log "branch $BRANCH does not exist on $REMOTE — nothing to prune"
      return 0
    fi
    check_branch
    build_tree
    if [[ -z "$NEW_TREE" ]]; then
      log "nothing to change"
      return 0
    fi
    verify_tree
    if [[ "$cmd" == publish ]]; then
      message="Publish $FOLDER"
    elif [[ -n "$PR" && -n "$KEEP" ]]; then
      message="Remove pr-$PR/ runs other than $KEEP/"
    elif [[ -n "$PR" ]]; then
      message="Remove pr-$PR/"
    else
      message="Prune closed PR screenshots"
    fi
    commit="$(git commit-tree "$NEW_TREE" -m "$message")"
    if push_out="$(git push --porcelain --force-with-lease="refs/heads/$BRANCH:$TIP" "$REMOTE" "$commit:refs/heads/$BRANCH" 2>&1)"; then
      git update-ref "$PRIVATE_REF" "$commit"
      log "pushed $BRANCH ($message) as ${commit:0:7}"
      return 0
    fi
    # Not bare "403": push output holds 40-hex commit ids.
    if grep -qiE 'permission|denied|not allowed|protected branch|error: 403|HTTP 403|403 Forbidden' <<<"$push_out"; then
      log "push not permitted (read-only token?):"
      echo "$push_out" >&2
      return 3
    fi
    log "push rejected (attempt $attempt/$MAX_ATTEMPTS), re-fetching and retrying:"
    echo "$push_out" >&2
    # Jittered backoff so racing publishers don't keep colliding in lockstep.
    sleep $((attempt + RANDOM % (2 * attempt + 1)))
  done
  die "gave up after $MAX_ATTEMPTS attempts"
}

case "$cmd" in
  publish)
    [[ -n "$PR" ]] || die "publish needs --pr"
    [[ "$FOLDER" =~ ^pr-$PR/[A-Za-z0-9._-]+$ && "$FOLDER" != *..* ]] || die "--folder must be pr-$PR/<run>"
    [[ -d "$DIR" ]] || die "--dir $DIR is not a directory"
    [[ -z "$KEEP" && $DRY_RUN -eq 0 ]] || die "--keep and --dry-run are only for prune"
    run
    ;;
  prune)
    (( KEEP_PREVIOUS == 0 )) || die "--keep-previous is only for publish"
    if [[ -n "$KEEP" ]]; then
      [[ -n "$PR" ]] || die "--keep needs --pr"
      [[ "$KEEP" =~ ^pr-$PR/[A-Za-z0-9._-]+$ && "$KEEP" != *..* ]] || die "--keep must be pr-$PR/<run>"
    fi
    run
    ;;
  *)
    die "unknown command $cmd (publish|prune)"
    ;;
esac
