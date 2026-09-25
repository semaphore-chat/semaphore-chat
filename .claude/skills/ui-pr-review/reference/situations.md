# Special cases, failures and housekeeping

## Contents

- Nothing affected
- Docker (or gh) unavailable
- Global changes and sampling
- Flaky and unstable stories
- Stacked PRs
- Pull requests from forks
- Run time
- A run failed or was interrupted
- Housekeeping: pruning, images, disk, removing a worktree
- Changing the tool itself

## Nothing affected

The section says "No story renders the changed files, so there is nothing to compare", or shows 0 changed with only unchanged stories. There are two cases:

- **The change has no visual effect** (logic, types, a hook whose output renders the same). Publish the section anyway. It is short, and it shows reviewers the check ran. With `--update-pr` and no composites, the tool also clears any earlier `pr-<n>/` images.
- **The change should be visible but isn't.** The files appear under "Changed files no story renders", "no probed story executes" or "no visible change". The review hasn't seen your change yet. Add stories ([stories.md](stories.md)) and run again.

If the diff has nothing under `frontend/` or `shared/`, don't run the tool at all.

## Docker (or gh) unavailable

The script stops with `docker is required`, or can't start containers. There is no fallback: the screenshots come only from the containers.

- Don't write a fake or hand-made section, and don't claim the UI was reviewed.
- Put a note **between the markers**, so the next real run replaces it:

  ```markdown
  <!-- ui-review:start -->
  _UI review not run (Docker unavailable here). Run: `frontend/scripts/ui-review/ui-review.sh --base origin/main --pr <n> --update-pr`_
  <!-- ui-review:end -->
  ```

- Still add the stories the change needs. They're code, and type-check covers them.
- Tell the user the review is outstanding.

Without `gh` (or without auth), you can still capture and review locally (step 1 to 5). Publishing (`--publish`/`--update-pr`) needs `gh`. Say so, and hand over `.ui-review/out/pr-block.md` for someone to publish, not the images.

## Global changes and sampling

A change is **global** when it can restyle every story:

- `frontend/.ladle/**`, `frontend/src/theme/**`;
- `frontend/package.json`, `frontend/tsconfig*.json`, root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `patches/**`, `frontend/Dockerfile`, `shared/package.json`;
- anything the Ladle provider imports;
- the story harness nearly every story shares, and the app modules those import directly (`Layout`, context providers). The fixture files that count are listed in [stories.md](stories.md#what-a-story-file-may-export-and-where-shared-helpers-go): `SandboxShell.tsx`, `AuthenticatedShell.tsx`, `StoryRoutes.tsx`, `handlers.ts`, `builder.ts`, `types.ts`, `auth.ts`, `avatars.ts`, `fakeSocket.ts` and `rng.ts`. Other fixture files, such as `scenarios.ts` or `edge/nav.ts`, are ordinary changes.

What the tool then does:

- Every story (about 220) is a candidate.
- The stories that render the diff's **other** changed files are found (graph, then the render probe) and captured first.
- The rest of the cap (40 by default) is a sample spread across story directories.
- The section says how many of each were captured and how many story files the sample covered.

What to do:

- Check that the stories you meant to change are among the captured ones (`jq -r '.stories[].id' .ui-review/out/report.json`).
- For a theme or colour change, make sure dark and light are covered (see [review-checklist.md](review-checklist.md#theme-changes-dark-and-light)).
- When a sample isn't enough, because the change is meant to restyle everything or it's a dependency upgrade that can move any component (MUI, emotion, fonts):
  - use `--all`. It captures every candidate: about 220 stories × 3 viewports × 2 sides, several times a capped run. The PR section shortens itself to fit.
  - Or raise the cap with `--max-stories <n>`.
- `--stories a,b,...` is the way to look closely at specific areas. Do it before the final run, since each run replaces the output.
- `frontend/index.html`, `vite.config.ts`, `src/main.tsx`, `src/index.css` and `public/` are **not** global. Ladle never loads them, so they are listed as "Not visible in Ladle". Check those in the real app.

## Flaky and unstable stories

Some stories render nondeterministically. The known ones:

- `edge-chat-worst-case--everything-at-once`
- `edge-chat-dm--dm-composer-loaded`

Both open a menu while media is still sizing, so the menu anchors differently from one load to the next.

How the tool handles it:

- Every **changed** shot (a story at one viewport) is captured again on both sides, twice by default (`UI_REVIEW_RECHECKS=2`).
- A change is confirmed only if the base-vs-head difference **reproduces inside its own region** on every re-capture.
- If it vanishes on any re-capture, the shot is **unstable**: listed separately with its composite, and not counted as changed. A difference elsewhere on the page during a re-check doesn't matter.
- A flaky story can still come out **changed** when every re-capture happens to reproduce the same difference.

What to do:

- **For an unstable shot, or a "changed" shot in a known flaky story,** decide whether the difference is in the area your change touches.
  - If not (only the menu position moved, and you didn't touch menus, media or the composer), say so in the PR text.
  - If it is, rerun `--stories <id>` once or twice and look at the result. A real change can hide behind flakiness.
- **Don't** set `UI_REVIEW_RECHECKS=0` or raise thresholds to make it go away.
- **A story that is unstable run after run** is worth fixing: wait for media to size before opening the menu (a condition step in its driver; `wait()` never completes under the review's frozen clock). That is a separate change, so do it only when the user wants it in scope.
- **Mass instability** (many stories unstable, blank or half-rendered shots) usually means the machine was overloaded. That can come from another review or a heavy build running at the same time. Rerun when it's quiet, or with `UI_REVIEW_CONCURRENCY=2` or a higher `UI_REVIEW_SETTLE_MS`. The capture log `.ui-review/work/shots-*.log` marks shots whose page was still busy after the settle wait.

## Stacked PRs

When your branch is based on another unmerged branch, both the PR and the review compare against that branch:

```bash
git fetch origin
gh pr create --base <parent-branch> --title "..." --body-file <body.md>
frontend/scripts/ui-review/ui-review.sh --base origin/<parent-branch> --pr <n> --update-pr
```

Without `gh pr create --base`, the PR targets `main` and its diff includes the parent's commits. Without the tool's `--base`, the "before" side is `main`, and the section shows the parent's changes as yours. The "Regenerate" command in the section records the `--base`. When the parent merges and your PR is retargeted to `main`, run again with `--base origin/main`.

## Pull requests from forks

`origin` is the fork, so the images go to the fork's `pr-screenshots` branch, and the links point there. The upstream prune workflow can't clean it: run `frontend/scripts/ui-review/pr-screenshots.sh prune --pr <n>` (or delete the branch) once the PR is done.

## Run time

These times were measured on a 32-core machine. Plan for more on smaller machines.

| Change | Time |
|--------|------|
| First run on a dependency set | plus the `uir-frontend:<hash>` image build (about 3.7 GB) |
| A component or page, even one with its own stories (about 217 candidates, so a probe) | about 6.5 min probe, 8 to 10 min in total |
| A broad change: a constant used everywhere, such as `TOUCH_TARGETS` in `utils/breakpoints.ts` | about 2.5 to 6 min probe, about 10 to 11 min in total |
| Only story files changed, or a module no route reaches (12 candidates or fewer, so no probe) | about 2 min |
| `--stories` with four stories (never probes) | about 1.5 min |
| 40 stories, none changed | about 4.5 min |

Why nearly every change probes: every story mounts the shared harness, which imports `Layout` and lazily every page, so any component a route renders is statically reachable from nearly every story. The probe then loads each candidate (up to three viewports each) to find the few that run the changed code. A probe where most stories miss is the slow case, since each miss loads all its viewports.

The probe result is cached in `.ui-review/cache/` by the **content** of `frontend/` and `shared/` (plus the dependency image and the probe plan). A rerun on the same content reuses it, including after you commit the reviewed edits. Any edit there, a story file included, means a new probe. So look at new or changed stories with `--stories` runs, and do the full run once, on committed code, at the end.

`UI_REVIEW_RECHECKS=1` saves about 2 min on a run with many changed shots, but lets more flaky stories through as "changed". Always run the tool in the background from an agent, and continue when it reports back.

## A run failed or was interrupted

- The tool removes its containers (`docker compose -p uir-<id> down -v --remove-orphans`) and its base worktree (`.ui-review/base`) on exit, including on errors and Ctrl-C. The project name is printed at the start ("starting ... (project uir-...)"). The shared `semaphore-test` network they ran on is external and stays: never remove or prune it.
- **"Ladle (head/base) did not come up":** rerun with `--keep`, read `docker compose -p uir-<id> logs ladle-head` (or `ladle-base`), then clean up as below.
- **Everything shows as new:** the merge-base predates the Ladle sandbox. Check `--base`.
- **"PR #n is ..., for branch ...":** wrong `--pr`, or the PR is closed. Fix the number. Use `--force-pr` only when you really mean another PR.
- **"--reuse: ... different base/head":** you committed or rebased after the capture. Run without `--reuse`.
- **A start marker without an end marker:** the run stops. Fix the PR description by hand.
- **Leftovers after a killed run or `--keep`:** containers and a `.ui-review/base` worktree. Remove only this run's own, from the repo root:

  ```bash
  docker ps -aq --filter label=com.docker.compose.project=uir-<id> | xargs -r docker rm -fv   # -v: their anonymous volumes
  docker run --rm --entrypoint sh -v "$PWD/.ui-review:/r" uir-frontend:<hash> -c 'rm -rf /r/base'   # root-owned files
  git worktree prune
  ```

  Rerunning the tool also clears a stale base worktree before it starts.

  Never prune other projects' volumes or containers (the dev stack, another checkout's `uir-*` project).

## Housekeeping: pruning, images, disk, removing a worktree

- **The `pr-screenshots` branch** holds one parentless commit: `README.md` plus `pr-<n>/<timestamp>-<sha>/*.webp`. Only `pr-screenshots.sh` writes it, never a manual push.
- `.github/workflows/prune-pr-screenshots.yml` removes a PR's folder when the PR is closed or merged, and a daily run removes every closed PR's folder. You can also run it manually from Actions, where it defaults to a dry run. Locally:

  ```bash
  frontend/scripts/ui-review/pr-screenshots.sh prune --dry-run      # what would go
  frontend/scripts/ui-review/pr-screenshots.sh prune --pr <n>       # one PR
  ```

- **Never commit images to a code branch.** `.ui-review/` and `frontend/.ux-shots/` are gitignored. Stage files by name, and don't `git add -f` anything from them.
- **Disk:** each dependency set gets its own `uir-frontend:<hash>` image (about 3.7 GB). The tool never deletes them. List them with `docker image ls uir-frontend`. Remove stale ones only when no review is running, since another checkout may be using one, and ask the user first. The Playwright image (about 3.2 GB) is shared. `.ui-review/` is disposable, and each run replaces it.

### Removing a worktree after a review

The tool's containers run as root with the checkout mounted. At the end of every run, and of every `--exec`, the tool removes its containers and hands what they wrote (`.ui-review/`, `frontend/.ladle/public/`, `frontend/src/api-client/`) back to your user. So after a review:

```bash
git worktree remove <path>        # from another checkout of the repo
```

- The empty root-owned `frontend/node_modules` and `shared/node_modules` directories are the mount points Docker creates for the containers' own `node_modules` volumes. Empty directories don't stop the removal.
- If it fails with "Permission denied", a container outside the tool wrote files as root (for example your own `docker run` generating the API client). Hand the tree back with any `uir-frontend` image, then remove it:

  ```bash
  docker run --rm --entrypoint chown -v <path>:/w uir-frontend:<hash> -R "$(id -u):$(id -g)" /w
  git worktree remove <path>
  ```

- Check that nothing of the worktree's own is left: `docker compose ls -a` shows no `uir-<id>` project of it (the id is printed at the start of each run), and `git worktree list` no longer lists it. Leave the `uir-frontend` images alone unless the user asks.

## Changing the tool itself

If your PR changes `frontend/scripts/ui-review/` or `scripts/ux-shots.mjs`:

- run its unit tests in `frontend/src/__tests__/scripts/ui-review/` (`ui-review.sh --exec 'pnpm exec vitest run src/__tests__/scripts/ui-review/'`, and the full suite before pushing);
- after touching `pr-screenshots.sh`, run `frontend/scripts/ui-review/test-pr-screenshots.sh`. It works against a throwaway local bare repository and never touches the real remote;
- keep `docs-site/docs/contributing/ui-review.md` and this skill in sync with the behaviour.
