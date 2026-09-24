---
name: ui-pr-review
description: Before/after UI review for Semaphore Chat pull requests. Renders the Ladle stories a frontend change affects on base and branch at phone, tablet and desktop (frontend/scripts/ui-review/ui-review.sh, in Docker). Then you add stories for uncovered or new states, look at every changed screenshot against a checklist, fix, and put the generated before/after section in the PR description. Use it before you open a PR, create a pull request (gh pr create), push frontend changes or mark a PR ready for review, and again after pushing more UI commits to an open PR, whenever the diff touches frontend/src in a way that can change what renders (a component, page, layout, style or sx, theme, breakpoint, or a hook or util the UI reads), frontend/.ladle, shared/ or frontend dependencies. Also use it when fixing a visual bug, when someone says they changed a component, page, style or theme, asks for before/after or UI screenshots in a PR, or wants the UI review section updated. Skip it for backend-, docs- or test-only diffs.
---

# UI review for pull requests

A PR that changes what the frontend looks like has to show it: before/after composites of every affected Ladle story at phone, tablet and desktop, in the PR description. `frontend/scripts/ui-review/ui-review.sh` finds the affected stories, renders them on the merge-base and on your working tree, pixel-diffs them and writes the PR section. The tool only tells you **that** pixels changed. It can't tell you whether the result is right. That is your job: make sure the change is covered by stories, **look at every changed screenshot**, fix what's wrong, then attach the section.

The human guide (every option, how stories are selected, the publishing mechanics) is `docs-site/docs/contributing/ui-review.md`. This skill is the agent workflow on top of it.

## When

- **Applies** when the diff touches anything that can change rendered pixels:
  - `frontend/src` outside `__tests__/` and `api-client/`. That includes components, pages, `sx` and styles, `theme/`, `utils/breakpoints.ts`, hooks and utils that feed rendering, and stories and fixtures.
  - `frontend/.ladle/` or `shared/`.
  - Frontend dependencies (`package.json`, `pnpm-lock.yaml`, `patches/`).
- **When:** before `gh pr create`, before `gh pr ready`, and again after every later push to the PR that touches UI. The section is replaced in place each time. Do the review locally first. Publishing needs the PR number, so publish right after the PR exists.
- **Skip** it for diffs with nothing under `frontend/` or `shared/`, and for changes limited to tests, docs, CI or the generated API client. If you're unsure, run it. With nothing affected it finishes in a couple of minutes and says so.

## Ground rules

- **Docker only.** The script drives only git, gh and docker on the host, and every Node step runs in its own containers. Never run pnpm, node or python on the host. Read JSON with the Read tool, or with `jq`.
- **Never commit images.** Screenshots go only to the orphan `pr-screenshots` branch (`pr-<n>/`), and only through the script. `.ui-review/` is gitignored. Don't copy composites into the repo, docs or code branches, and never push to `pr-screenshots` by hand.
- **Leave the dev `ladle` container (:61000) alone.** The tool doesn't use it. It runs its own compose project (`uir-<hash of the checkout path>`) with no host ports, so reviews in different worktrees don't collide.
- **Don't tune the result away.** Don't raise `UI_REVIEW_PIXEL_THRESHOLD` or lower `UI_REVIEW_RECHECKS` to make a difference disappear. Don't hand-edit the section between the markers, because the next run replaces it.
- **Every run replaces** `.ui-review/out/` and `.ui-review/shots/`, and `--reuse` publishes whatever the last run produced. Do targeted runs (`--stories`) before the final full run, not after it.

## 0. Make the change and its tests first

The tool compares your working tree with the base, so a run before the edit has nothing to show. Make the product change and its unit tests first. For a bug fix, write the failing test before the fix.

For a visual bug, find the stories that show it before you fix it: `grep -rl <Component> frontend/src/stories/` gives the story files, and `--stories id1,id2` (step 3) captures them even with no change yet, so you can open their head shots and see the bug. A bug that an **existing** story shows gives the most useful before/after (see step 2 for new stories).

Run the checks with the tool's `--exec`, which works in any checkout or worktree. `docker compose run frontend ...` needs `backend/.env` and a generated `src/api-client/`, which a fresh worktree doesn't have:

```bash
frontend/scripts/ui-review/ui-review.sh --exec 'pnpm run type-check'
frontend/scripts/ui-review/ui-review.sh --exec 'pnpm run lint'
frontend/scripts/ui-review/ui-review.sh --exec 'pnpm run test'    # the full suite, before any push
```

## 1. Run the tool and read the selection

```bash
git fetch origin
frontend/scripts/ui-review/ui-review.sh --base origin/main   # stacked PR: --base origin/<parent-branch>
```

- It reviews the **working tree**, uncommitted edits included. But **commit before the run you intend to publish**: `--reuse` only accepts output captured for the same merge-base and HEAD commit, and publishing refuses uncommitted `frontend/` or `shared/` changes.
- **Plan for about 8 to 10 minutes.** Nearly every component or page is reachable from nearly every story through the shared harness (about 217 candidates), so a render probe of about 6.5 minutes finds the stories that really run your code before the capture. Only a change limited to story files, or a `--stories` run, skips the probe (about 2 minutes). The first run on a new dependency set also builds a `uir-frontend:<hash>` image. Start it in the background (Bash `run_in_background`) and continue when it finishes.
- The probe result is cached by the **content** of `frontend/` and `shared/`: a rerun after only committing reuses it, while any edit, a story file included, probes again. So iterate with `--stories` (step 3) and do the full run once at the end.
- **Outputs:**
  - `.ui-review/out/pr-block.md`: the section, with local image paths.
  - `.ui-review/out/report.json`: everything, machine-readable.
  - `.ui-review/out/composites/<story>--<viewport>.webp`: only for changed, new, removed and unstable shots.
  - `.ui-review/shots/{base,head}/<viewport>/<story>.png`: raw full-page shots at 1 CSS px per pixel.

Read `pr-block.md` first. The counts line and the notes (probe, cap, global sample) tell you what was captured. The lists at the bottom tell you what wasn't: changed files no story renders, files no probed story executes, files with no visible change, and files not visible in Ladle.

## 2. Add stories where the change isn't shown

Add or extend stories when:

- **"Changed files no story renders"** lists a file. Nothing can show that change until a story renders it.
- **"no probed story executes"** or **"no visible change in any captured story"** names a file you meant to change visibly. The state is behind an interaction, a closed dialog or menu, or data no fixture has.
- **Your change adds a new state**, even if an existing story already renders the file. For example: a new component or variant, an empty, loading or error state, a badge, a new breakpoint behaviour, or a permission-dependent control.

Build them with the fixture builder:

- `defineScreen(scenario, path, opts)` for screens.
- `defineComponent(scenario, () => <X />, opts)` for components.
- `edgeScreen(scenario, path, { theme, offline, voice, extraHandlers, overlay })` for edge states.
- Data comes from `buildScenario({ seed, ... })` plus the `with*` modifiers.

Cover the edge cases your change can break: long and unbroken names, empty lists, many items, loading, errors, unread and mention badges, dark and light. How to write them, the helpers, story ids, per-story viewports and the determinism rules are in **[reference/stories.md](reference/stories.md)**. Two rules catch people out:

- **Every export of a story file is a story.** Put shared helpers and data in `frontend/src/stories/fixtures/` (for example `fixtures/edge/nav.ts`), not in a story file.
- **A story that only makes sense at some widths** (a 320 px column is a phone layout) sets `MyStory.meta = { viewports: ['phone'] };`. Otherwise it is also captured at tablet and desktop, in layouts the app never produces.

**New stories have no "before".** They show up as **new**, with after-only composites, because the base has no such story. For a bug fix:

- Prefer an existing story that shows the bug. Its before/after shows the fix.
- If only a new story shows it, commit the story on its own first, then the fix. A local run with `--base <sha of the story commit>` then shows that story before and after the fix. The PR section still comes from the normal run against the real base, where the story is after-only, so say in the PR text which story you checked this way.

Type-check and lint the new files (`--exec`, step 0), then go on to step 3.

## 3. Capture before/after

Rerun step 1's command whenever you added stories or changed code. For quick iterations on a few stories, `--stories id1,id2` captures exactly those, without a probe, in about 1.5 minutes for four stories. A story id is the file name and the export name in kebab case, joined by `--`: `EdgeNavNotifications.stories.tsx` with `export const LongNamesNarrow320` gives `edge-nav-notifications--long-names-narrow320` (digits stay attached to the word before them). An unknown id stops the run and suggests the right one. Finish with the normal run on committed code, because that is the run the PR section should come from.

## 4. Look at every screenshot

Open the images with the **Read tool** (it displays `.webp` and `.png`). Look at:

- **every changed, new and removed composite** at each viewport it was captured at: phone, tablet and desktop, except stories whose id contains `keyboard` (only `phone-short`, 390×500) and stories with their own `meta.viewports` (only those).
- **every unstable composite.**
- **a sample of unchanged stories**: two or three that run your changed files (their `reasons` in `report.json`). Open their head shots at each viewport in `.ui-review/shots/head/<viewport>/<id>.png`. An "unchanged" result for code you meant to change visibly is a finding in itself. In a sampled run (a global change), also open one sampled story that doesn't run your files. In a normal run every captured story runs your change, so there is nothing else to open.

Check each against this list. The detail for each item, the composite anatomy and `jq` one-liners are in **[reference/review-checklist.md](reference/review-checklist.md)**.

1. **Intended?** Every changed story is one you meant to change. An unexpected change is a regression until you can explain it. The story's `Renders:` line names the changed files it runs.
2. **Overlap, clipping, overflow:** nothing overlaps or is cut off, there's no horizontal scroll (the page is no wider than the viewport), and nothing is hidden under the app bar, bottom nav, composer or voice bar.
3. **Truncation:** long text ends with an ellipsis where that's intended, and labels don't wrap into a mess or push controls off-screen.
4. **Touch targets** are at least 44×44 CSS px on phone and tablet (`TOUCH_TARGETS.MINIMUM`). Phone panels are shown 1:1. Confirm borderline sizes in the code.
5. **Theme:** if you touched colours, the theme or tokens, check dark (the Ladle default) and light (`edge-states-theme--light-*`), and that contrast is still readable.
6. **The other viewports aren't regressed:** a phone fix must not break tablet or desktop, and the reverse.
7. **No sandbox artefacts:** no blank or half-loaded page, stuck spinner, "Loading...", skeleton, "Story not found", error boundary, broken image, or mock-error toast you didn't intend.
8. **Console issues** in the section (page errors, render errors, unhandled requests): an issue on the head side only is yours. It usually means a missing MSW handler or broken code.
9. **Unstable shots:** if the difference sits where your change is, rerun that story (`--stories <id>`) and look again. Two stories are known to be flaky. See [reference/situations.md](reference/situations.md#flaky-and-unstable-stories).
10. **Blind spots:** "Not visible in Ladle" files (`index.html`, `vite.config.ts`, `main.tsx`, `index.css`, `public/`), capped or sampled runs, and states no story reaches. Say in the PR what the screenshots can't show.

Note each finding as you go (story, viewport, what's wrong).

## 5. Fix and repeat

Fix the product code, or the story if the story is what's wrong. Then commit, rerun (step 3) and look at what changed again. Repeat until the checklist is clean. If you deliberately leave something, such as a known flaky story or an issue that is also on the base, say so in the PR description **outside** the markers.

## 6. Create or update the PR with the section

The section goes between two marker lines. If the body has no markers, the tool appends the section at the very end, which puts it below any footer. So put the markers **above the footer** (such as the Claude Code attribution lines) when you write the body. They must be on lines of their own, outside code blocks:

```markdown
## Summary
...

## Test plan
...

<!-- ui-review:start -->
<!-- ui-review:end -->

<footer lines>
```

**New PR:** do steps 0 to 5 on committed code first. Then:

```bash
git push -u origin HEAD
gh pr create --title "..." --body-file <body.md>          # body contains the markers above the footer
frontend/scripts/ui-review/ui-review.sh --base origin/main --pr <n> --update-pr --reuse   # same --base as the review run
```

**Stacked PR** (your branch is based on another unmerged branch): pass the parent branch to both commands, `gh pr create --base <parent-branch> ...` and `ui-review.sh --base origin/<parent-branch> ...`. Otherwise the PR targets `main` and the "before" side is `main`, so the parent's changes show up as yours.

**Later UI pushes to an open PR:** commit, then do steps 1 to 5 locally, push, and publish with `--pr <n> --update-pr --reuse`. Without `--reuse` it captures again, which takes as long as a normal run, and you still have to look at the new composites. If an existing body lacks the markers, add them above the footer first (`gh pr view <n> --json body -q .body` to a file, edit it, `gh pr edit <n> --body-file <file>`).

- `--pr` must be the open PR of the branch you're on. Push first: the tool warns when the PR head differs from local HEAD.
- `--update-pr` fits the section under GitHub's 65,536-character limit, shortening it if needed, before anything is pushed. It publishes the new run next to the old one, updates the body, then prunes the old run.
- **Verify** the result:
  - `gh pr view <n> --json body -q .body` shows the section between the markers, with the footer still last.
  - One image URL answers 200: `gh pr view <n> --json body -q .body | grep -om1 'https://raw.githubusercontent.com/[^)]*\.webp' | xargs curl -sI | head -1`.
- Then mark the PR ready if that was the plan. Tell the user:
  - what you reviewed (counts by status);
  - what you found and fixed;
  - what's left: unstable stories, blind spots, a sampled run.

## 7. Special cases

Details for each are in **[reference/situations.md](reference/situations.md)**.

- **Nothing affected:** the section says there was nothing to compare. If only non-visual frontend code changed, publishing it is fine, because it records that the check ran. If files are listed as uncovered, go back to step 2.
- **Docker unavailable** (the script stops with "docker is required"): don't fake the section. Put a one-line note between the markers saying the UI review wasn't run and giving the command to run. The next real run replaces it. Tell the user.
- **Global change** (`frontend/.ladle/**`, `src/theme/**`, manifests, the lockfile, tsconfigs, patches, or the shared story harness and the app shell it imports): every story is a candidate. The stories that render your other changed files are captured first, then a sample, 40 stories in total. Check that the sample covers what you meant to change (for a theme change, light and dark). Use `--stories` or `--all` when it doesn't. Which fixture files count as the harness is listed in situations.md.
- **Flaky stories:** `edge-chat-worst-case--everything-at-once` and `edge-chat-dm--dm-composer-loaded` open a menu while media is still sizing. Each changed shot is captured twice more, and a difference that doesn't reproduce is reported as **unstable**, not changed.
- **Housekeeping:**
  - `.github/workflows/prune-pr-screenshots.yml` removes `pr-<n>/` when a PR closes, and in a daily sweep. For a fork PR, run `pr-screenshots.sh prune --pr <n>` yourself.
  - Never commit images.
  - The tool removes its containers and hands the files its containers wrote back to your user after every run, so `git worktree remove <path>` works after a review. The empty root-owned `frontend/node_modules` and `shared/node_modules` directories are Docker mount points and don't block it. If removal fails with "Permission denied", see situations.md.
  - `uir-frontend:<hash>` images take about 3.7 GB each and are never deleted by the tool. Other checkouts share them, so ask the user before removing one.
