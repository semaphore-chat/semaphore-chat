#!/usr/bin/env bash
# UI review: before/after screenshots of the Ladle stories a change affects,
# at phone / tablet / desktop, pixel-diffed, optionally published to the orphan
# `pr-screenshots` branch and written into the PR description.
#
# Runs on the host but only drives git, gh and docker — every node step runs in
# a container (see compose.yml next to this file). Docs:
# docs-site/docs/contributing/ui-review.md
#
#   frontend/scripts/ui-review/ui-review.sh [options]
#
#   --base <ref>        compare against merge-base(<ref>, HEAD) (default origin/main;
#                       fetch it first if it may be stale)
#   --pr <n>            the PR to publish for / update (must be this branch's open PR)
#   --publish           push the composites to the pr-screenshots branch (needs --pr)
#   --update-pr         also replace the UI-review section of the PR body (implies --publish)
#   --out <file|->      also write the generated section there ('-' = stdout)
#   --reuse             skip capture; reuse .ui-review/out from the previous run of
#                       the same base/head (e.g. review locally, open the PR, then
#                       --pr <n> --update-pr --reuse)
#   --stories <a,b,...> capture exactly these story ids instead of detecting them
#   --all               no cap: capture every affected story
#   --max-stories <n>   cap (default 40, env UI_REVIEW_MAX_STORIES)
#   --allow-dirty       allow --publish with uncommitted frontend/shared changes
#   --force-pr          publish for a PR that is not this branch's open PR
#   --keep              leave containers and the base worktree up afterwards
#
# The working tree is what gets reviewed (uncommitted edits included); the base
# is a temporary git worktree at the merge-base under .ui-review/base.
# Output (gitignored): .ui-review/out/{report.json,pr-block.md,composites/*.webp}
set -euo pipefail

BASE_REF=origin/main
PR=""
PUBLISH=0
UPDATE_PR=0
OUT_FILE=""
REUSE=0
STORIES=""
ALL=0
MAX_STORIES="${UI_REVIEW_MAX_STORIES:-40}"
ALLOW_DIRTY=0
FORCE_PR=0
KEEP=0
PROBE_THRESHOLD="${UI_REVIEW_PROBE_THRESHOLD:-12}"
# Pages per side while capturing: CPU-bound (two Vite dev servers + Chromium).
CONCURRENCY="${UI_REVIEW_CONCURRENCY:-$(( $(nproc 2>/dev/null || echo 8) >= 24 ? 4 : 3 ))}"
SETTLE_MS="${UI_REVIEW_SETTLE_MS:-1500}"
QUIET_MS="${UI_REVIEW_QUIET_MS:-800}"
# Extra captures of each changed shot (both sides, that viewport only); the
# difference has to reproduce in its region every time to count as a change.
RECHECKS="${UI_REVIEW_RECHECKS:-2}"
# pixelmatch colour tolerance; empty = the tool's default (lib/classify.ts).
PIXEL_THRESHOLD="${UI_REVIEW_PIXEL_THRESHOLD:-}"
# Fixture epoch (src/stories/fixtures/rng.ts) + 30 min: relative times render
# the same on both sides and on every run.
FREEZE_TIME="${UI_REVIEW_FREEZE_TIME:-2026-09-22T18:30:00Z}"
WARMUP_CONCURRENCY=6

die() { echo "ui-review: $*" >&2; exit 1; }
log() { echo "ui-review: $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE_REF="$2"; shift 2 ;;
    --pr) PR="$2"; shift 2 ;;
    --publish) PUBLISH=1; shift ;;
    --update-pr) UPDATE_PR=1; PUBLISH=1; shift ;;
    --out) OUT_FILE="$2"; shift 2 ;;
    --reuse) REUSE=1; shift ;;
    --stories) STORIES="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    --max-stories) MAX_STORIES="$2"; shift 2 ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --force-pr) FORCE_PR=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
[[ -z "$PR" || "$PR" =~ ^[0-9]+$ ]] || die "--pr must be a number"
[[ "$MAX_STORIES" =~ ^[0-9]+$ ]] || die "--max-stories must be a number"
[[ "$RECHECKS" =~ ^[0-9]+$ ]] || die "UI_REVIEW_RECHECKS must be a number"
(( PUBLISH == 0 )) || [[ -n "$PR" ]] || die "--publish/--update-pr need --pr <n> (images are published per PR; see --help)"
command -v docker >/dev/null || die "docker is required"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
SCRIPT_DIR=frontend/scripts/ui-review
UIR="$REPO_ROOT/.ui-review"
WORK="$UIR/work"
OUT="$UIR/out"
BASE_DIR="$UIR/base"
PROJECT="uir-$(printf '%s' "$REPO_ROOT" | sha1sum | cut -c1-10)"
COMPOSE=(docker compose -p "$PROJECT" --project-directory "$REPO_ROOT" -f "$SCRIPT_DIR/compose.yml")

MERGE_BASE="$(git merge-base "$BASE_REF" HEAD)" || die "no merge-base between $BASE_REF and HEAD"
HEAD_SHA="$(git rev-parse HEAD)"
HEAD_REF="$(git rev-parse --abbrev-ref HEAD)"
DIRTY=0
[[ -z "$(git status --porcelain -- frontend shared)" ]] || DIRTY=1

# owner/name of a remote's GitHub repository (images are pushed to origin, so
# their URLs must name origin's repository — in a fork clone that's the fork).
remote_slug() {
  local url
  url="$(git remote get-url "$1" 2>/dev/null)" || return 1
  url="${url%/}"
  url="${url%.git}"
  [[ "$url" =~ github\.com[:/]+([^/:]+)/([^/]+)$ ]] || return 1
  echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
}

if (( PUBLISH )); then
  command -v gh >/dev/null || die "--publish/--update-pr need the gh CLI"
  (( DIRTY == 0 || ALLOW_DIRTY )) || die "uncommitted frontend/shared changes — commit them first (or pass --allow-dirty)"
  PR_INFO="$(gh pr view "$PR" --json headRefName,headRefOid,state --jq '[.headRefName, .headRefOid, .state] | @tsv')" ||
    die "cannot read PR #$PR with gh"
  IFS=$'\t' read -r PR_BRANCH PR_HEAD PR_STATE <<<"$PR_INFO"
  if [[ "$PR_BRANCH" != "$HEAD_REF" || "$PR_STATE" != OPEN ]]; then
    msg="PR #$PR is ${PR_STATE,,}, for branch '$PR_BRANCH' — this checkout is on '$HEAD_REF'"
    (( FORCE_PR )) || die "$msg. Wrong --pr? (--force-pr publishes anyway)"
    log "warning: $msg (--force-pr)"
  fi
  [[ "$PR_HEAD" == "$HEAD_SHA" ]] || log "warning: PR #$PR head is ${PR_HEAD:0:7} but local HEAD is ${HEAD_SHA:0:7} (push first?)"
  REPO_SLUG="$(remote_slug origin)" ||
    die "remote 'origin' ($(git remote get-url origin 2>/dev/null || echo none)) is not a GitHub repository — the images are pushed there"
fi

# The command that regenerates this section, with the options that shaped it.
regen=("$SCRIPT_DIR/ui-review.sh" --base "$BASE_REF")
if [[ -n "$PR" ]]; then regen+=(--pr "$PR" --update-pr); fi
if (( ALL )); then regen+=(--all); fi
if [[ -n "$STORIES" ]]; then regen+=(--stories "$STORIES"); fi
if [[ "$MAX_STORIES" != 40 ]]; then regen+=(--max-stories "$MAX_STORIES"); fi
REGEN=""
for var in UI_REVIEW_PROBE_THRESHOLD UI_REVIEW_RECHECKS UI_REVIEW_PIXEL_THRESHOLD UI_REVIEW_SETTLE_MS UI_REVIEW_QUIET_MS UI_REVIEW_FREEZE_TIME; do
  if [[ -n "${!var:-}" ]]; then REGEN+="$var=${!var} "; fi
done
REGEN+="${regen[*]}"

# ---------------------------------------------------------------- images

# Content-addressed image tag: same deps → same image, shared across checkouts.
image_tag() {
  (cd "$1" && cat frontend/Dockerfile package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc shared/package.json frontend/package.json patches/* 2>/dev/null) |
    sha256sum | cut -c1-12
}
ensure_image() {
  local image="$1" context="$2"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    log "building $image (dependencies changed or first run) ..."
    docker build -q -f "$context/frontend/Dockerfile" -t "$image" "$context" >/dev/null
  fi
}

HEAD_IMAGE="uir-frontend:$(image_tag "$REPO_ROOT")"
export UI_REVIEW_IMAGE="$HEAD_IMAGE" UI_REVIEW_BASE_IMAGE="$HEAD_IMAGE" UI_REVIEW_BASE_DIR="$BASE_DIR"

# ---------------------------------------------------------------- cleanup

as_root() { # rm/chown things containers created as root, via a throwaway container
  docker run --rm --entrypoint sh -v "$REPO_ROOT:/repo" "$HEAD_IMAGE" -c "$1"
}
remove_base() {
  if [[ -e "$BASE_DIR" ]]; then
    as_root "rm -rf /repo/.ui-review/base"
  fi
  git worktree prune
}
cleanup() {
  local code=$?
  if (( KEEP )); then
    log "--keep: containers ($PROJECT) and $BASE_DIR left in place"
  else
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
    remove_base 2>/dev/null || true
  fi
  # Hand generated files back to the invoking user.
  as_root "chown -R $(id -u):$(id -g) /repo/.ui-review $(printf '/repo/frontend/%s ' .ladle/public src/api-client) 2>/dev/null; true" \
    >/dev/null 2>&1 || true
  exit $code
}

tool() { "${COMPOSE[@]}" exec -T tool node scripts/ui-review/cli.ts "$@"; }
cexec() { "${COMPOSE[@]}" exec -T "$@"; } # cexec [-e VAR=x ...] <service> <cmd...>

# ---------------------------------------------------------------- capture

# shoot_pair <ids|tasks> <head list> <base list> <out dir suffix>: screenshots
# on both Ladle instances, in parallel, into .ui-review/shots/{head,base}<suffix>/.
# `ids` lists story ids (every viewport); `tasks` lists "<id> <viewport>" pairs.
shoot_pair() {
  local mode="$1" head_list="$2" base_list="$3" suffix="$4" pids=() pid failed=0 spec
  spec=UX_SHOTS_IDS
  [[ "$mode" == ids ]] || spec=UX_SHOTS_TASKS
  local env=(-e "UX_SHOTS_VIEWPORTS=phone,phone-short,tablet,desktop" -e "UX_SHOTS_CONCURRENCY=$CONCURRENCY"
    -e "UX_SHOTS_SETTLE_MS=$SETTLE_MS" -e "UX_SHOTS_QUIET_MS=$QUIET_MS" -e "UX_SHOTS_FREEZE_TIME=$FREEZE_TIME"
    -e UX_SHOTS_DISABLE_ANIMATIONS=1)
  if grep -q . "$head_list"; then
    cexec "${env[@]}" -e UX_SHOTS_BASE_URL=http://localhost:61000 -e "$spec=@/ui-review/work/$(basename "$head_list")" \
      -e "UX_SHOTS_OUT_DIR=/ui-review/shots/head$suffix" shots node scripts/ux-shots.mjs >"$WORK/shots-head$suffix.log" 2>&1 &
    pids+=($!)
  fi
  if (( HAS_BASE )) && grep -q . "$base_list"; then
    cexec "${env[@]}" -e UX_SHOTS_BASE_URL=http://localhost:61001 -e "$spec=@/ui-review/work/$(basename "$base_list")" \
      -e "UX_SHOTS_OUT_DIR=/ui-review/shots/base$suffix" shots node scripts/ux-shots.mjs >"$WORK/shots-base$suffix.log" 2>&1 &
    pids+=($!)
  fi
  for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
  (( failed == 0 )) || die "screenshot capture failed — see .ui-review/work/shots-*.log"
}

# Loads the stories about to be captured on both Ladle instances first, so the
# timed capture doesn't wait on Vite's first transform of their chunks.
warm_both() {
  local pids=() pid
  if grep -q . "$WORK/head-ids.txt"; then
    cexec shots node scripts/ui-review/warmup.ts http://localhost:61000 @/ui-review/work/head-ids.txt "$WARMUP_CONCURRENCY" \
      >"$WORK/warmup-head.log" 2>&1 &
    pids+=($!)
  fi
  if (( HAS_BASE )) && grep -q . "$WORK/base-ids.txt"; then
    cexec shots node scripts/ui-review/warmup.ts http://localhost:61001 @/ui-review/work/base-ids.txt "$WARMUP_CONCURRENCY" \
      >"$WORK/warmup-base.log" 2>&1 &
    pids+=($!)
  fi
  for pid in "${pids[@]}"; do wait "$pid" || log "warning: warm-up failed (see .ui-review/work/warmup-*.log); capturing anyway"; done
}

# Key of the render probe's result: the plan plus everything the head renders
# (tracked tree, uncommitted edits, untracked files, dependency image).
probe_cache_key() {
  {
    echo "$HEAD_IMAGE"
    git ls-tree -r HEAD -- frontend shared
    git diff HEAD --binary --no-ext-diff -- frontend shared
    git ls-files --others --exclude-standard -z -- frontend shared | xargs -0 -r sha1sum
    cat "$WORK/probe-plan.json"
  } | sha256sum | cut -c1-16
}

capture() {
  local diff_args=(--work /ui-review/work --base-ref "$BASE_REF" --base-sha "$MERGE_BASE" --head-ref "$HEAD_REF"
    --head-sha "$HEAD_SHA" --dirty "$DIRTY" --rechecks "$RECHECKS")
  if [[ -n "$PIXEL_THRESHOLD" ]]; then diff_args+=(--pixel-threshold "$PIXEL_THRESHOLD"); fi
  ensure_image "$HEAD_IMAGE" "$REPO_ROOT"
  mkdir -p "$UIR"
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  HAS_BASE=0
  if git cat-file -e "$MERGE_BASE:frontend/.ladle/config.mjs" 2>/dev/null; then
    HAS_BASE=1
    remove_base
    git worktree add --detach --quiet "$BASE_DIR" "$MERGE_BASE"
    local base_tag
    base_tag="$(image_tag "$BASE_DIR")"
    if [[ "uir-frontend:$base_tag" != "$HEAD_IMAGE" ]]; then
      UI_REVIEW_BASE_IMAGE="uir-frontend:$base_tag"
      ensure_image "$UI_REVIEW_BASE_IMAGE" "$BASE_DIR"
    fi
  else
    log "merge-base ${MERGE_BASE:0:7} has no Ladle setup — every story will show as new"
  fi

  local services=(ladle-head shots tool)
  if (( HAS_BASE )); then services+=(ladle-base); fi
  log "starting ${services[*]} (project $PROJECT) ..."
  "${COMPOSE[@]}" up -d "${services[@]}" >/dev/null
  "${COMPOSE[@]}" exec -T tool sh -c "rm -rf /ui-review/work /ui-review/shots /ui-review/out && mkdir -p /ui-review/work /ui-review/out && chown $(id -u):$(id -g) /ui-review/work /ui-review/out"

  git diff --name-status -z -M "$MERGE_BASE" -- . >"$WORK/changed.z"
  git ls-files --others --exclude-standard -z >"$WORK/untracked.z"
  git -c core.quotePath=false diff -U0 --no-color --no-ext-diff -M "$MERGE_BASE" -- . >"$WORK/changes.diff"

  wait_ladle 61000 head
  if (( HAS_BASE )); then wait_ladle 61001 base; fi

  tool affected --work /ui-review/work --probe-threshold "$PROBE_THRESHOLD" --freeze-time "$FREEZE_TIME"
  cexec shots node scripts/ui-review/warmup.ts http://localhost:61000
  local select_args=(--work /ui-review/work --max "$MAX_STORIES")
  if [[ -z "$STORIES" && -f "$WORK/probe-plan.json" ]]; then
    local key cache
    key="$(probe_cache_key)"
    cache="$UIR/cache/probe-$key.json"
    if [[ -f "$cache" ]]; then
      log "render probe: reusing the result of an earlier run of the same code (.ui-review/cache/probe-$key.json)"
      cp "$cache" "$WORK/probe-out.json"
      select_args+=(--probe-cached)
    else
      cexec shots node scripts/ui-review/probe.ts /ui-review/work/probe-plan.json /ui-review/work/probe-out.json
      mkdir -p "$UIR/cache"
      cp "$WORK/probe-out.json" "$cache"
      # Keep the 10 most recent results.
      # shellcheck disable=SC2012 # names are probe-<hex>.json
      ls -1t "$UIR"/cache/probe-*.json | tail -n +11 | xargs -r rm -f
    fi
  fi
  if (( ALL )); then select_args+=(--all); fi
  if [[ -n "$STORIES" ]]; then select_args+=(--ids "$STORIES"); fi
  tool select "${select_args[@]}"

  warm_both
  log "capturing $(grep -c . "$WORK/head-ids.txt" || true) head / $(grep -c . "$WORK/base-ids.txt" || true) base stories, $CONCURRENCY pages per side (logs: .ui-review/work/shots-*.log) ..."
  shoot_pair ids "$WORK/head-ids.txt" "$WORK/base-ids.txt" ""
  tool diff "${diff_args[@]}"

  # Stability re-checks: capture each changed shot (that story, that viewport)
  # again on both sides. A difference that doesn't reproduce in its region is
  # reported as "unstable", not "changed".
  local pass
  for ((pass = 1; pass <= RECHECKS; pass++)); do
    grep -q . "$WORK/recheck-tasks.txt" || break
    cp "$WORK/recheck-tasks.txt" "$WORK/recheck-tasks-$pass.txt"
    log "stability re-check $pass/$RECHECKS: capturing the $(grep -c . "$WORK/recheck-tasks-$pass.txt") changed shot(s) again on both sides ..."
    shoot_pair tasks "$WORK/recheck-tasks-$pass.txt" "$WORK/recheck-tasks-$pass.txt" "-recheck-$pass"
    tool diff "${diff_args[@]}"
  done
  cexec shots node scripts/ui-review/composite.ts /ui-review/work/composite-jobs.json
  tool finalize --work /ui-review/work --out /ui-review/out
  printf '{"base":"%s","head":"%s","dirty":%s}\n' "$MERGE_BASE" "$HEAD_SHA" "$DIRTY" >"$OUT/run.json"
}

wait_ladle() { # <port> <head|base>
  log "waiting for Ladle ($2) ..."
  "${COMPOSE[@]}" exec -T shots sh -c "for i in \$(seq 1 600); do
      test -f /opt/uxshots/.ready && curl -sf http://localhost:$1/meta.json -o /ui-review/work/$2-meta.json && exit 0
      sleep 1; done; exit 1" || die "Ladle ($2) did not come up — docker compose -p $PROJECT logs ladle-$2"
}

# ---------------------------------------------------------------- main

if (( REUSE )); then
  [[ -f "$OUT/report.json" && -f "$OUT/run.json" ]] || die "--reuse: no previous run in $OUT"
  grep -q "\"base\":\"$MERGE_BASE\",\"head\":\"$HEAD_SHA\"" "$OUT/run.json" ||
    die "--reuse: .ui-review/out was generated for a different base/head — run without --reuse"
  ensure_image "$HEAD_IMAGE" "$REPO_ROOT"
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  "${COMPOSE[@]}" up -d tool >/dev/null
else
  capture
fi

tool block --report /ui-review/out/report.json --out /ui-review/out/pr-block.md --command "$REGEN"

if (( PUBLISH )); then
  FOLDER="$(tool folder --pr "$PR" --sha "$HEAD_SHA")"
  HAS_IMAGES=0
  if compgen -G "$OUT/composites/*" >/dev/null; then HAS_IMAGES=1; fi
  block_args=(--report /ui-review/out/report.json --out /ui-review/out/pr-block.md --command "$REGEN" --repo "$REPO_SLUG" --folder "$FOLDER")
  if (( UPDATE_PR )); then
    # Render the new description first: if it can't fit GitHub's limit this
    # fails here, before anything is pushed.
    gh pr view "$PR" --json body >"$WORK/pr-body.json"
    block_args+=(--body-json /ui-review/work/pr-body.json --body-out /ui-review/work/pr-body.new.md)
  fi
  tool block "${block_args[@]}"

  if (( UPDATE_PR )); then
    # Earlier runs stay published until the description no longer links them.
    if (( HAS_IMAGES )); then
      bash "$SCRIPT_DIR/pr-screenshots.sh" publish --pr "$PR" --folder "$FOLDER" --dir "$OUT/composites" --keep-previous
    fi
    gh pr edit "$PR" --body-file "$WORK/pr-body.new.md" >/dev/null
    log "updated the UI review section of PR #$PR"
    if (( HAS_IMAGES )); then
      bash "$SCRIPT_DIR/pr-screenshots.sh" prune --pr "$PR" --keep "$FOLDER"
    else
      log "no composites (nothing changed visually) — clearing pr-$PR/ on pr-screenshots"
      bash "$SCRIPT_DIR/pr-screenshots.sh" prune --pr "$PR"
    fi
  elif (( HAS_IMAGES )); then
    bash "$SCRIPT_DIR/pr-screenshots.sh" publish --pr "$PR" --folder "$FOLDER" --dir "$OUT/composites"
  else
    log "no composites (nothing changed visually) — clearing pr-$PR/ on pr-screenshots"
    bash "$SCRIPT_DIR/pr-screenshots.sh" prune --pr "$PR"
  fi
fi

if [[ "$OUT_FILE" == "-" ]]; then
  cat "$OUT/pr-block.md"
elif [[ -n "$OUT_FILE" ]]; then
  cp "$OUT/pr-block.md" "$OUT_FILE"
fi

log "report:     .ui-review/out/report.json"
log "PR section: .ui-review/out/pr-block.md"
log "composites: .ui-review/out/composites/ ($(find "$OUT/composites" -type f 2>/dev/null | wc -l) images)"
