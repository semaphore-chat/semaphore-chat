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
#   --pr <n>            the PR to publish for / update
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
KEEP=0
PROBE_THRESHOLD="${UI_REVIEW_PROBE_THRESHOLD:-12}"
CONCURRENCY="${UI_REVIEW_CONCURRENCY:-3}"
SETTLE_MS="${UI_REVIEW_SETTLE_MS:-1500}"
QUIET_MS="${UI_REVIEW_QUIET_MS:-800}"
# Fixture epoch (src/stories/fixtures/rng.ts) + 30 min: relative times render
# the same on both sides and on every run.
FREEZE_TIME="${UI_REVIEW_FREEZE_TIME:-2026-09-22T18:30:00Z}"

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
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done
[[ -z "$PR" || "$PR" =~ ^[0-9]+$ ]] || die "--pr must be a number"
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
if (( PUBLISH )); then
  command -v gh >/dev/null || die "--publish/--update-pr need the gh CLI"
  (( DIRTY == 0 || ALLOW_DIRTY )) || die "uncommitted frontend/shared changes — commit them first (or pass --allow-dirty)"
  PR_HEAD="$(gh pr view "$PR" --json headRefOid --jq .headRefOid)" || die "cannot read PR #$PR with gh"
  [[ "$PR_HEAD" == "$HEAD_SHA" ]] || log "warning: PR #$PR head is ${PR_HEAD:0:7} but local HEAD is ${HEAD_SHA:0:7} (push first?)"
fi

REGEN="$SCRIPT_DIR/ui-review.sh --base $BASE_REF${PR:+ --pr $PR --update-pr}"
if (( ALL )); then REGEN+=" --all"; fi

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

# shoot_pair <head ids file> <base ids file> <out dir suffix>: screenshots of
# the listed stories on both Ladle instances, in parallel, into
# .ui-review/shots/{head,base}<suffix>/.
shoot_pair() {
  local head_ids="$1" base_ids="$2" suffix="$3" pids=() pid failed=0
  local env=(-e "UX_SHOTS_VIEWPORTS=phone,phone-short,tablet,desktop" -e "UX_SHOTS_CONCURRENCY=$CONCURRENCY"
    -e "UX_SHOTS_SETTLE_MS=$SETTLE_MS" -e "UX_SHOTS_QUIET_MS=$QUIET_MS" -e "UX_SHOTS_FREEZE_TIME=$FREEZE_TIME"
    -e UX_SHOTS_DISABLE_ANIMATIONS=1)
  if grep -q . "$head_ids"; then
    cexec "${env[@]}" -e UX_SHOTS_BASE_URL=http://localhost:61000 -e "UX_SHOTS_IDS=@/ui-review/work/$(basename "$head_ids")" \
      -e "UX_SHOTS_OUT_DIR=/ui-review/shots/head$suffix" shots node scripts/ux-shots.mjs >"$WORK/shots-head$suffix.log" 2>&1 &
    pids+=($!)
  fi
  if (( HAS_BASE )) && grep -q . "$base_ids"; then
    cexec "${env[@]}" -e UX_SHOTS_BASE_URL=http://localhost:61001 -e "UX_SHOTS_IDS=@/ui-review/work/$(basename "$base_ids")" \
      -e "UX_SHOTS_OUT_DIR=/ui-review/shots/base$suffix" shots node scripts/ux-shots.mjs >"$WORK/shots-base$suffix.log" 2>&1 &
    pids+=($!)
  fi
  for pid in "${pids[@]}"; do wait "$pid" || failed=1; done
  (( failed == 0 )) || die "screenshot capture failed — see .ui-review/work/shots-*.log"
}

capture() {
  local diff_args=(--work /ui-review/work --base-ref "$BASE_REF" --base-sha "$MERGE_BASE" --head-ref "$HEAD_REF"
    --head-sha "$HEAD_SHA" --dirty "$DIRTY")
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
  if [[ -z "$STORIES" && -f "$WORK/probe-plan.json" ]]; then
    cexec shots node scripts/ui-review/probe.ts /ui-review/work/probe-plan.json /ui-review/work/probe-out.json
  fi
  local select_args=(--work /ui-review/work --max "$MAX_STORIES")
  if (( ALL )); then select_args+=(--all); fi
  if [[ -n "$STORIES" ]]; then select_args+=(--ids "$STORIES"); fi
  tool select "${select_args[@]}"

  if (( HAS_BASE )) && grep -q . "$WORK/base-ids.txt"; then
    cexec shots node scripts/ui-review/warmup.ts http://localhost:61001 "$(head -n1 "$WORK/base-ids.txt")"
  fi
  log "capturing $(grep -c . "$WORK/head-ids.txt" || true) head / $(grep -c . "$WORK/base-ids.txt" || true) base stories (logs: .ui-review/work/shots-*.log) ..."
  shoot_pair "$WORK/head-ids.txt" "$WORK/base-ids.txt" ""
  tool diff "${diff_args[@]}"

  # Stability re-check: capture the changed stories once more on both sides. A
  # story whose own re-capture differs renders nondeterministically; its diff
  # is reported as "unstable" instead of "changed".
  if grep -q . "$WORK/recheck-ids.txt"; then
    log "re-capturing the $(grep -c . "$WORK/recheck-ids.txt") changed stories on both sides to rule out flaky rendering ..."
    shoot_pair "$WORK/recheck-ids.txt" "$WORK/recheck-ids.txt" "-recheck"
    tool diff "${diff_args[@]}"
  fi
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
  REPO_SLUG="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  if compgen -G "$OUT/composites/*" >/dev/null; then
    bash "$SCRIPT_DIR/pr-screenshots.sh" publish --pr "$PR" --folder "$FOLDER" --dir "$OUT/composites"
    for f in "$OUT"/composites/*; do
      echo "https://raw.githubusercontent.com/$REPO_SLUG/pr-screenshots/$FOLDER/$(basename "$f")"
    done
  else
    log "no composites (nothing changed visually) — clearing pr-$PR/ on pr-screenshots"
    bash "$SCRIPT_DIR/pr-screenshots.sh" prune --pr "$PR"
  fi
  tool block --report /ui-review/out/report.json --out /ui-review/out/pr-block.md --command "$REGEN" \
    --repo "$REPO_SLUG" --folder "$FOLDER"
fi

if (( UPDATE_PR )); then
  gh pr view "$PR" --json body >"$WORK/pr-body.json"
  tool splice --body-json /ui-review/work/pr-body.json --block /ui-review/out/pr-block.md --out /ui-review/work/pr-body.new.md
  gh pr edit "$PR" --body-file "$WORK/pr-body.new.md" >/dev/null
  log "updated the UI review section of PR #$PR"
fi

if [[ "$OUT_FILE" == "-" ]]; then
  cat "$OUT/pr-block.md"
elif [[ -n "$OUT_FILE" ]]; then
  cp "$OUT/pr-block.md" "$OUT_FILE"
fi

log "report:     .ui-review/out/report.json"
log "PR section: .ui-review/out/pr-block.md"
log "composites: .ui-review/out/composites/ ($(find "$OUT/composites" -type f 2>/dev/null | wc -l) images)"
