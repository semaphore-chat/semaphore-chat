# UI Review Screenshots

Every pull request that changes what the frontend looks like should show it:
before/after screenshots of the affected screens and components at **phone,
tablet and desktop** widths, in the PR description. The UI review tool
produces them from the [Ladle sandbox](https://github.com/semaphore-chat/semaphore-chat/blob/main/frontend/README.md#ux-sandbox-ladle)
(real app screens and components rendered against fake data), so no backend,
database or LiveKit is needed. It can only show what stories render, so a UI
change comes with stories for the states it adds or touches: see
[Writing Sandbox Stories](stories.md).

```bash
frontend/scripts/ui-review/ui-review.sh --base origin/main --pr 123 --update-pr
```

For a change it:

1. works out which stories the change affects;
2. renders them on the merge-base and on your working tree, at phone/tablet/desktop;
3. pixel-diffs each pair and sorts stories into **changed / new / removed / unchanged**
   (and **unstable**: stories whose difference did not reproduce when captured again);
4. renders labelled before/after composites narrow enough for a PR description
   (each changed region cropped at up to 1:1, above a full view with the
   changed regions outlined);
5. optionally publishes the images to the `pr-screenshots` branch and writes a
   section into the PR description (between `<!-- ui-review:start -->` and
   `<!-- ui-review:end -->`; the rest of the description is left untouched).

## Requirements

`bash` (4.4+), `git`, Docker with Compose v2, and the [`gh` CLI](https://cli.github.com/)
(authenticated) for `--publish`/`--update-pr`. Nothing runs on the host except
git, gh and docker; every Node step runs in a container. The first run builds a
`uir-frontend:<hash>` image (reused until dependencies change).

## Workflow

Review before you open the PR, then attach the result:

```bash
git fetch origin

# 1. Capture and diff. Uncommitted edits are included, so this works mid-change.
frontend/scripts/ui-review/ui-review.sh --base origin/main

# 2. Look at the results:
#    .ui-review/out/pr-block.md        the PR section (image links are local here)
#    .ui-review/out/composites/*.webp  one before|after composite per story × viewport
#    .ui-review/out/report.json        everything, machine-readable

# 3. Commit, push, open the PR, then publish without re-capturing:
gh pr create --fill
frontend/scripts/ui-review/ui-review.sh --base origin/main --pr <number> --update-pr --reuse

# After more commits, regenerate (the section is replaced in place):
frontend/scripts/ui-review/ui-review.sh --base origin/main --pr <number> --update-pr
```

Stacked on another unmerged branch? Pass it to both: `gh pr create --base
<parent-branch>` and `ui-review.sh --base origin/<parent-branch>`.

To type-check, lint or test a checkout the main Compose file can't run in
(a fresh worktree has no `backend/.env` and no generated API client), use the
tool's image: `frontend/scripts/ui-review/ui-review.sh --exec 'pnpm run
type-check'`.

Images are published per PR number, so publishing needs `--pr`; before the PR
exists, review locally. `--pr` must be the open PR of the branch you are on
(a typo would otherwise write into someone else's PR); `--force-pr` overrides
that check. `--reuse` only works when base and head haven't changed since the
capture, so commit before the run you intend to publish with `--reuse`.

Agents (Claude Code) follow the project skill
[`ui-pr-review`](https://github.com/semaphore-chat/semaphore-chat/blob/main/.claude/skills/ui-pr-review/SKILL.md),
which wraps this workflow: when it applies, adding stories for uncovered or new
states, a detailed screenshot checklist, and where the section goes in the PR
description.

### Review checklist

Before publishing, check the run the way a reviewer would:

- **Expected stories changed?** Each changed story should be one you meant to
  change; look at every composite (agents: open the `.webp` files with the image
  viewer / Read tool).
- **Unexpected changes?** A "changed" story you didn't intend to touch is a regression
  until proven otherwise.
- **Unstable stories** — their difference did not reproduce on a re-capture, so
  it may or may not come from your change; look at the composite. A story that
  is unstable run after run is worth fixing (usually a race between a
  menu/popover opening and media or data settling, or a story timing its
  steps with `Date.now()`, which the review pins — see the determinism rules
  below).
- **Changed files with no visible change** — the section lists changed files
  whose captured stories run the code but show nothing different (e.g. the
  component renders a closed dialog), and files no probed story runs at all.
  Either the change is behind an interaction no story sets up, or it has no
  visual effect; add a story if it should be visible.
- **Console issues** — page errors, render errors or unhandled MSW requests in
  the section's "Console issues" list usually mean a broken story or a missing
  fixture handler.
- **Changed files no story renders** — the tool lists changed UI files that no
  story reaches. Add a story (`frontend/src/stories/`, see
  [Writing Sandbox Stories](stories.md)) so the change can be seen.
- **Not visible in Ladle** — `index.html`, `vite.config.ts`, `main.tsx`,
  `index.css` and `public/` are only loaded by the real app; check those
  changes in the app itself.
- **Capped / sampled?** If the section says the run was capped, rerun with `--all`
  when the dropped stories matter.

## Options

| Option | Meaning |
| --- | --- |
| `--base <ref>` | Compare against `merge-base(<ref>, HEAD)` (default `origin/main`; fetch first) |
| `--pr <n>` | PR to publish for / update (this branch's open PR) |
| `--publish` | Push the composites to `pr-screenshots` under `pr-<n>/` |
| `--update-pr` | Also replace the UI-review section of the PR body (implies `--publish`) |
| `--out <file>` / `--out -` | Also write the generated section to a file / stdout |
| `--reuse` | Skip capture, reuse `.ui-review/out` from the last run of the same base/head |
| `--stories a,b` | Capture exactly these story ids instead of detecting them |
| `--all` | No cap: capture every affected story |
| `--max-stories <n>` | Cap (default 40) |
| `--allow-dirty` | Allow publishing with uncommitted `frontend/`/`shared/` changes |
| `--force-pr` | Publish for a PR that isn't this branch's open PR |
| `--keep` | Leave the containers and the base worktree running (debugging) |
| `--exec '<cmd>'` | Instead of a review, run `<cmd>` in the review image (dependencies installed, API client generated) and exit with its status: `--exec 'pnpm run type-check'`. Works in any checkout or worktree, without `backend/.env` |

Tuning via environment: `UI_REVIEW_MAX_STORIES`, `UI_REVIEW_PROBE_THRESHOLD`
(default 12), `UI_REVIEW_CONCURRENCY` (capture pages per side: 4 on 24+ cores,
else 3), `UI_REVIEW_SETTLE_MS` (1500), `UI_REVIEW_QUIET_MS` (800),
`UI_REVIEW_RECHECKS` (2; `1` is faster but lets more flaky stories through as
"changed"), `UI_REVIEW_PIXEL_THRESHOLD` (0.03), `UI_REVIEW_FREEZE_TIME`.
The render probe runs one page per CPU core minus two (at most 12). The
"Regenerate" command at the bottom of the section repeats the options and
`UI_REVIEW_*` overrides that shaped the run.

## How it works

Everything lives in `frontend/scripts/ui-review/`: `ui-review.sh` orchestrates,
`compose.yml` defines its containers, `cli.ts`/`probe.ts`/`composite.ts`/`warmup.ts`
are the Node steps and `lib/` holds the (unit-tested) pure logic.

### Which stories are affected

Changed files are `git diff <merge-base>` of the **working tree** plus untracked
files, limited to what Ladle can render (`frontend/` and `shared/`).

1. **Module graph.** One esbuild build with every story file (plus the Ladle
   global provider) as entry points yields a metafile: every import edge,
   resolved exactly like the bundler — `@semaphore-chat/shared` alias, index
   barrels, `import()`/`React.lazy`, CSS imports.
2. **Global changes** can restyle every story: `frontend/.ladle/**`,
   `src/theme/**`, tsconfigs, package manifests, the lockfile, patches — plus
   anything the Ladle provider imports, the harness modules nearly every story
   shares (`SandboxShell`, fixtures builder, ...) and the app modules those
   import directly (`Layout`, context providers). All stories are then
   candidates. The stories that render the diff's *other* changed files are
   still found (graph, then the probe below) and captured first; the rest of
   the cap is a sample spread across story directories. The PR section says
   how many of each, and how many story files the sample covered.
3. **Changed story files** are always captured ("direct"); stories that
   disappeared from every story file are reported as removed (a story file
   that moved keeps its ids). When the probe below runs, it loads them too,
   so their "Renders:" line names only the changed files they actually run.
4. **Everything else**: every story whose file can reach the changed file.
   That is nearly every story — they all mount the shared harness, which
   statically imports `Layout` and lazily every page — so when there are more
   than a dozen candidates a **render probe** narrows them: each candidate is
   loaded in Chromium (desktop, then tablet, then phone, stopping at the first
   hit) with V8 function coverage on, and it is kept only if the changed code
   actually ran (changed lines come from `git diff -U0`, mapped through the
   inline source maps Vite serves):
   - a changed line **inside a function** counts when that function ran. A
     padding change inside `SingleReactionChip` keeps the stories that render
     reaction chips, not every story that renders a message list;
   - a changed line **outside any function** (a top-level constant, a static
     `styled()` object) counts when the module's values are used: in a
     component module, when one of its components rendered; in any other module
     (constants, utils, style helpers) also when a module importing it ran,
     looking through re-exporting barrels. So a change to
     `TOUCH_TARGETS` in `utils/breakpoints.ts` keeps every story whose
     components read it, even though the file's own helpers never run;
   - lines that produce no code on their own (imports, types, comments) don't
     widen the check.

Changed UI files that no story reaches are listed in the PR section — a
reminder to add a story. Files only the real app loads (`index.html`,
`vite.config.ts` — Ladle has its own `.ladle/vite.config.ts` — `main.tsx`,
`index.css` and `public/`) are listed as **not visible in Ladle** instead of
triggering a sample that could only show "no change".

The probe result is cached in `.ui-review/cache/` by the probe plan, the
dependency image and the content of `frontend/` and `shared/` (the git tree
of the working tree, untracked files included). Rerunning on the same content
skips it, also after committing the reviewed edits; any edit there, a story
file included, probes again.

### Capture

Two Ladle dev servers run in containers that share one network namespace (no
host ports, so a running `ladle` on :61000 is never disturbed): the working
tree on `:61000` and a temporary git worktree at the merge-base on `:61001`
(`.ui-review/base`, created and removed by the tool). The containers join the
shared `semaphore-test` Docker network (created once by `scripts/test-net.sh`,
never removed), so a review never creates or removes a network, which would add
and remove a host bridge and make Chromium-based browsers on the machine drop
their connections. The base uses the same
image unless its dependency manifests differ, in which case an image is built
from the base's own lockfile. Before capturing, both servers load every
selected story once, so Vite's first transform of their chunks doesn't happen
during a timed capture. Screenshots come from `scripts/ux-shots.mjs`
(story × viewport task mode, the same list on both sides) with `Date.now()`
pinned to a fixed instant (timers keep running), CSS animations disabled,
animated images (GIF, animated WebP/PNG) shown at their first frame, and a
settle wait: the page counts as ready once, for 800 ms, the DOM has not
changed, no request started or finished, no script, stylesheet or font is
still loading — a lazy route whose chunk is still in flight behind a static
"Loading..." screen is not "ready" — and no story driver is still running (a
story that drives an interaction with `useDriver` sets
`<html data-story-busy>` until its last step ran). Identical code renders
identical pixels.

**Determinism rules for stories:** a story driver must never measure time
with `Date.now()` (it doesn't move during a review, so the wait never ends);
use `useDriver` with its `wait(ms)` steps, which count time with timers. Open
a menu over images only after a `mediaSettled()` step (images loaded, sizes
and scroll positions stable), or it anchors to a row that is still moving.
The full list is in `.claude/skills/ui-pr-review/reference/stories.md`.

Each story is shot at phone, tablet and desktop, except `*keyboard*` stories
(only `phone-short`, 390×500) and stories that name their own viewports in
their Ladle meta, for a layout only some widths can show (a 320 px column is
a phone layout):

```tsx
LongNamesNarrow320.meta = { viewports: ['phone'] };
```

It has to be a top-level statement with an object literal, because Ladle reads
it statically into `meta.json`. The probe, the capture and the diff all use
it, on both sides, and so does the plain `ux-shots.mjs` sweep.

### Diff and classification

[pixelmatch](https://github.com/mapbox/pixelmatch) compares each pair with its
anti-aliasing detection on (AA pixels never count) and a per-pixel colour
threshold of 0.03 (pixelmatch's default of 0.1 ignores grey steps below about
26/255 — a divider or border opacity tweak; 0.03 still ignores steps below
about 8/255, and renders are exact run to run). A shot is **changed** when more
than 24 pixels differ or the page size changed; **new** when the story has no
base; **removed** when it has no head.

A story can still render nondeterministically (for example a menu opened
while media is still sizing: the menu anchors differently from load to load).
To keep those out of "changed", every changed shot (that story at that viewport)
is **captured again on both sides**, twice by default (`UI_REVIEW_RECHECKS`).
A change is confirmed only if the base-vs-head difference **reproduces inside
its own region** (the changed boxes plus a small margin) on every re-capture;
if it vanishes on any re-capture, the shot is **unstable** — listed
separately, with its composite, and not counted as a change. Differences
elsewhere on the page on a re-capture (a list scrolled differently once) don't
matter either way. A flaky story can still come out "changed" when every
re-capture happens to reproduce the same difference.

Composites are drawn by Chromium from an HTML template, then encoded as WebP
at most 860 px wide: GitHub shows PR-description images at most about 880 px
wide, so a wider composite would be scaled down until its text is too small
to read. Top to bottom:

- a title bar (story id, status, viewport, share of pixels changed);
- for a change, each changed region (the changed pixels plus some context;
  nearby ones merged, at most the three biggest) cropped at up to 1:1:
  before | after | diff side by side when the three fit, else before | after,
  else before above after;
- a full view of the page with every changed region outlined in red: before |
  after side by side (1:1 on phone, reduced on tablet and desktop, where it
  is for orientation). A change too big to crop on a tablet or desktop page
  gets no crops; before is shown above after at the full width instead.

### Publishing

Images go to the orphan branch **`pr-screenshots`**, never to a code branch:

```
README.md
pr-123/20260923-190507-abc1234/<story-id>--<viewport>.webp
pr-130/...
```

With `--update-pr` the order is: render the new PR description (and check it
fits), publish the new run's folder next to the previous one, update the
description, then drop the previous run. If anything fails on the way, the
description still points at images that exist. Each run gets a fresh
timestamped folder, so GitHub's image caches never show stale pictures; other
PRs' folders are never touched. The branch is rebuilt as a **single parentless
commit** every time, so it never accumulates history, and pushed with
`--force-with-lease` against the tip it was built from — a concurrent publish
makes the push fail, and the script re-fetches and re-applies (with a
randomised backoff, up to 8 attempts). Any failing git step aborts the script
before it pushes, the new tree is checked before the push (other PRs' folders
unchanged, the new folder complete), and it refuses to write to a branch that
has history or holds anything but `README.md` and `pr-<n>/` folders. It never
checks anything out or touches another branch; the remote branch is fetched
into `refs/ui-review/pr-screenshots`, which is kept so the next fetch is
incremental. Images are referenced as
`https://raw.githubusercontent.com/<owner>/<repo>/pr-screenshots/...`, where
`<owner>/<repo>` is your `origin` remote.

The PR section is spliced between its markers byte-for-byte (CRLF bodies
included); running it again replaces it in place. A marker only counts on a
line of its own outside code blocks, so quoting the markers in the
description is harmless; a start marker without an end marker stops the run
(fix the description by hand). If the markers are missing the section is
appended to the end — to put it somewhere else (e.g. above a footer), add the
two marker lines there first:

```markdown
<!-- ui-review:start -->
<!-- ui-review:end -->
```

GitHub limits a PR description to 65,536 characters. The section gets
whatever room the rest of the description leaves; when it doesn't fit, it is
shortened step by step (shorter lists, images as links, one line per story)
and says so, with a link to the run's folder on `pr-screenshots`.

**Pull requests from forks:** your `origin` is the fork, so the images go to
your fork's `pr-screenshots` branch and the links point there. The upstream
prune workflow can't clean that branch; run
`frontend/scripts/ui-review/pr-screenshots.sh prune --pr <n>` yourself (or
delete the branch) when the PR is done.

## Pruning

Folders of closed PRs are removed automatically by
`.github/workflows/prune-pr-screenshots.yml`:

- when a PR is **closed or merged**, its `pr-<n>/` folder is dropped;
- a **daily** run drops every folder whose PR is closed — the safety net for
  closed-PR runs that could not push (pull requests from forks get a read-only
  token; the workflow logs a notice and exits cleanly) or that GitHub
  cancelled (see below);
- it can be run **manually** (Actions → Prune PR screenshots), dry run by default.

The workflow has `contents: write` + `pull-requests: read` only and does
nothing when the branch doesn't exist yet. Its `concurrency` group runs one
prune at a time; GitHub keeps only the newest pending run of a group, so when
several PRs close at once the runs in between are cancelled — the daily run
catches their folders. It runs the same script you can run locally:

```bash
frontend/scripts/ui-review/pr-screenshots.sh prune --dry-run   # what would go
frontend/scripts/ui-review/pr-screenshots.sh prune             # every closed PR
frontend/scripts/ui-review/pr-screenshots.sh prune --pr 123    # one PR
```

`frontend/scripts/ui-review/test-pr-screenshots.sh` exercises the script
against a throwaway local bare repository (publish, replace, a lost push race,
five simultaneous publishers, keep-previous, prune by PR / by state / dry run,
failing git steps, a missing `gh`, a non-screenshots branch, the read-only exit
code) — run it after changing the script; it never touches the real remote.

## Limitations

- Only what stories render is covered: states behind interactions (hover,
  menus opened by a click) show up only if a story sets them up.
- The probe works at function granularity: a story is kept when the function
  holding the change ran, even if the changed branch inside it didn't render
  anything visible, or rendered it outside the screenshot (e.g. a reaction on a
  message scrolled out of view). Such files are flagged as "no visible change";
  the stories end up in the collapsed "unchanged" list. A constant exported
  from a *component* module is only checked where that module's components
  render.
- Global changes and very broad changes are sampled (cap 40); use `--all` for
  a full sweep (roughly 220 stories × 3 viewports × 2 sides — minutes, not
  seconds; the PR section is shortened to fit the description).
- A run takes minutes: two Ladle servers start, a broad change probes ~220
  stories, each captured story is shot at 3 viewports per side, and each
  changed shot twice more. Measured on a 32-core machine: a one-line change to
  a constant used across the app (`TOUCH_TARGETS` in `utils/breakpoints.ts`):
  220 stories probed in 2.5 min (every one of them runs it; a probe where most
  stories miss takes about 7 min, since each miss loads 3 viewports), 40
  captured with 35 changed and 66 changed shots re-checked twice — about 11
  min end to end. Four stories via `--stories`: 1.5 min; 40 unchanged stories:
  4.5 min. A change to one component or page is not cheaper than that: every
  story reaches nearly every routed component through the shared harness, so
  it probes about 217 stories (about 6.5 min, most of them misses) and takes 8
  to 10 min in total. Only changes limited to story files, or to modules no
  route reaches (12 candidates or fewer), skip the probe (about 2 min). A rerun
  on the same content reuses the probe, and `UI_REVIEW_RECHECKS=1` saves the
  second re-check (about 2 min in the run above).
- Links use `raw.githubusercontent.com`, which serves public repositories.

## Disk space

Each dependency set gets its own `uir-frontend:<hash>` image (about 3.7 GB, of
which about 3.4 GB is unique): one per lockfile/manifest state you reviewed,
plus one for a merge-base whose dependencies differ. The tool never deletes
them. List and remove old ones with:

```bash
docker image ls uir-frontend
docker image rm uir-frontend:<hash>   # or: docker image ls -q uir-frontend | xargs docker image rm
```

The Playwright image (`mcr.microsoft.com/playwright`, about 3.2 GB) is shared.
Per-run output under `.ui-review/` is small (tens of MB) and replaced on the
next run.

## Troubleshooting

- **"Ladle (head/base) did not come up"** — rerun with `--keep` and check
  `docker compose -p uir-<id> logs ladle-head` (the project name is printed at
  start).
- **Everything shows as new** — the merge-base predates the Ladle sandbox.
- **Blank or half-rendered shots** — raise `UI_REVIEW_SETTLE_MS`, lower
  `UI_REVIEW_CONCURRENCY`. The capture log (`.ui-review/work/shots-*.log`)
  marks shots whose page was still busy after the settle wait.
- **"PR #n is ..., for branch ..."** — `--pr` doesn't match the branch you are
  on (or the PR is closed); fix the number, or pass `--force-pr`.
- **"... without a matching ... line after it"** — the PR description has a
  `<!-- ui-review:start -->` line but no end marker; fix the description by hand.
- `.ui-review/` is disposable (gitignored); files the containers create there are
  handed back to your user at the end of every run.
- **Removing a worktree after a review** — `git worktree remove <path>` works:
  the tool hands what its containers wrote back to your user, and the empty
  root-owned `frontend/node_modules` and `shared/node_modules` (Docker mount
  points) don't block it. If it reports "Permission denied", another container
  wrote files there as root; hand them back with
  `docker run --rm --entrypoint chown -v <path>:/w uir-frontend:<hash> -R "$(id -u):$(id -g)" /w`
  and remove it again.
- **"unknown story id(s)"** — `--stories` takes Ladle ids: `<file>--<export>`
  in kebab case, with digits kept on the word before them
  (`LongNamesNarrow320` → `long-names-narrow320`). The error suggests the
  right spelling or lists the ids of that story file.
