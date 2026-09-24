# UI Review Screenshots

Every pull request that changes what the frontend looks like should show it:
before/after screenshots of the affected screens and components at **phone,
tablet and desktop** widths, in the PR description. The UI review tool
produces them from the [Ladle sandbox](https://github.com/semaphore-chat/semaphore-chat/blob/main/frontend/README.md#ux-sandbox-ladle)
(real app screens and components rendered against fake data), so no backend,
database or LiveKit is needed.

```bash
frontend/scripts/ui-review/ui-review.sh --base origin/main --pr 123 --update-pr
```

For a change it:

1. works out which stories the change affects;
2. renders them on the merge-base and on your working tree, at phone/tablet/desktop;
3. pixel-diffs each pair and sorts stories into **changed / new / removed / unchanged**
   (and **unstable**: stories that render differently from one load to the next);
4. renders labelled before | after composites (changed regions outlined, plus a
   1:1 zoom on small changes);
5. optionally publishes the images to the `pr-screenshots` branch and writes a
   section into the PR description (between `<!-- ui-review:start -->` and
   `<!-- ui-review:end -->`; the rest of the description is left untouched).

## Requirements

`bash`, `git`, Docker with Compose v2, and the [`gh` CLI](https://cli.github.com/)
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

Images are published per PR number, so publishing needs `--pr`; before the PR
exists, review locally. `--reuse` only works when base and head haven't changed
since the capture.

### Review checklist

Before publishing, check the run the way a reviewer would:

- **Expected stories changed?** Each changed story should be one you meant to
  change; look at every composite (agents: open the `.webp` files with the image
  viewer / Read tool).
- **Unexpected changes?** A "changed" story you didn't intend to touch is a regression
  until proven otherwise.
- **Unstable stories** — their diff may or may not come from your change; look
  at the composite. A story that is unstable run after run is worth fixing
  (usually a race between a menu/popover opening and media or data settling).
- **Console issues** — page errors, render errors or unhandled MSW requests in
  the section's "Console issues" list usually mean a broken story or a missing
  fixture handler.
- **Changed files no story renders** — the tool lists changed UI files that no
  story reaches. Add a story (`frontend/src/stories/`, see the frontend README)
  so the change can be seen.
- **Capped / sampled?** If the section says the run was capped, rerun with `--all`
  when the dropped stories matter.

## Options

| Option | Meaning |
| --- | --- |
| `--base <ref>` | Compare against `merge-base(<ref>, HEAD)` (default `origin/main`; fetch first) |
| `--pr <n>` | PR to publish for / update |
| `--publish` | Push the composites to `pr-screenshots` under `pr-<n>/` |
| `--update-pr` | Also replace the UI-review section of the PR body (implies `--publish`) |
| `--out <file>` / `--out -` | Also write the generated section to a file / stdout |
| `--reuse` | Skip capture, reuse `.ui-review/out` from the last run of the same base/head |
| `--stories a,b` | Capture exactly these story ids instead of detecting them |
| `--all` | No cap: capture every affected story |
| `--max-stories <n>` | Cap (default 40) |
| `--allow-dirty` | Allow publishing with uncommitted `frontend/`/`shared/` changes |
| `--keep` | Leave the containers and the base worktree running (debugging) |

Tuning via environment: `UI_REVIEW_MAX_STORIES`, `UI_REVIEW_PROBE_THRESHOLD`
(default 12), `UI_REVIEW_CONCURRENCY` (capture: 3 pages per side),
`UI_REVIEW_SETTLE_MS` (1500), `UI_REVIEW_QUIET_MS` (800), `UI_REVIEW_RECHECKS` (2),
`UI_REVIEW_FREEZE_TIME`.
The render probe runs one page per CPU core minus two (at most 12).

## How it works

Everything lives in `frontend/scripts/ui-review/`: `ui-review.sh` orchestrates,
`compose.yml` defines its containers, `cli.ts`/`probe.ts`/`composite.ts` are the
Node steps and `lib/` holds the (unit-tested) pure logic.

### Which stories are affected

Changed files are `git diff <merge-base>` of the **working tree** plus untracked
files, limited to what Ladle can render (`frontend/` and `shared/`).

1. **Module graph.** One esbuild build with every story file (plus the Ladle
   global provider) as entry points yields a metafile: every import edge,
   resolved exactly like the bundler — `@semaphore-chat/shared` alias, index
   barrels, `import()`/`React.lazy`, CSS imports.
2. **Global changes** restyle every story: `frontend/.ladle/**`, `src/theme/**`,
   `src/index.css`, `index.html`, the Vite config, tsconfigs, package manifests,
   the lockfile, patches — plus anything the Ladle provider imports, the
   harness modules nearly every story shares (`SandboxShell`, fixtures builder,
   ...) and the app modules those import directly (`Layout`, context
   providers). All stories are then candidates, capped to a representative sample
   (one story per story file, spread across directories); the PR section says so.
3. **Changed story files** are always captured ("direct"); stories that
   disappeared from them are reported as removed.
4. **Everything else**: every story whose file can reach the changed file.
   That is nearly every story — they all mount the shared harness, which
   statically imports `Layout` and lazily every page — so when there are more
   than a dozen candidates a **render probe** narrows them: each candidate is
   loaded in Chromium (desktop, then tablet, then phone, stopping at the first
   hit) with V8 function coverage on, and it is kept only if a
   function *containing a changed line* actually ran (changed lines come from
   `git diff -U0`, mapped through the inline source maps Vite serves). A padding
   change inside `SingleReactionChip` keeps the stories that render reaction
   chips, not every story that renders a message list. Changes outside any
   function (imports, top-level `styled()`/constants) fall back to "some
   function of that module ran".

Changed UI files that no story reaches are listed in the PR section — a
reminder to add a story.

### Capture

Two Ladle dev servers run in containers that share one network namespace (no
host ports, so a running `ladle` on :61000 is never disturbed): the working
tree on `:61000` and a temporary git worktree at the merge-base on `:61001`
(`.ui-review/base`, created and removed by the tool). The base uses the same
image unless its dependency manifests differ, in which case an image is built
from the base's own lockfile. Screenshots come from `scripts/ux-shots.mjs`
(exact-id mode) with the clock frozen at a fixed instant, CSS animations
disabled and a wait for the DOM to go quiet, so identical code renders
identical pixels.

### Diff and classification

[pixelmatch](https://github.com/mapbox/pixelmatch) compares each pair with its
anti-aliasing detection on (AA pixels never count) and a per-pixel colour
threshold of 0.1. A shot is **changed** when more than 24 pixels differ or the
page size changed; **new** when the story has no base; **removed** when it has
no head.

A few stories render nondeterministically (for example a menu opened while
media is still sizing: the menu anchors differently from load to load). To
keep those out of "changed", every story with a changed shot is **captured
again on both sides** (two more times by default, `UI_REVIEW_RECHECKS`; each
pass only re-captures stories that still show a change). If the head or the
base differs from its own first capture, the shot is reported as
**unstable** — listed separately, with its composite, and not counted as a
change. A flaky story can still slip through as "changed" when every
re-capture happens to match, but that gets unlikely quickly; a real change
reproduces every time.

Composites are drawn by Chromium from an HTML template (the
before | after panels, a diff panel on phone, red outlines around changed
regions, and a 1:1 zoom row when the panels had to be scaled down), then
encoded as WebP at most 1600 px wide.

### Publishing

Images go to the orphan branch **`pr-screenshots`**, never to a code branch:

```
README.md
pr-123/20260923-190507-abc1234/<story-id>--<viewport>.webp
pr-130/...
```

Each publish replaces `pr-<n>/` entirely (a fresh timestamped folder, so GitHub's
image caches never show stale pictures) and keeps other PRs' folders. The branch
is rebuilt as a **single parentless commit** every time, so it never accumulates
history, and pushed with `--force-with-lease` against the tip it was built from
— a concurrent publish makes the push fail, and the script re-fetches and
re-applies. It never checks anything out or touches another branch. Images are
referenced as `https://raw.githubusercontent.com/<owner>/<repo>/pr-screenshots/...`.

The PR section is spliced between its markers byte-for-byte (CRLF bodies
included); running it again replaces it in place. If the markers are missing
it is appended to the end — to put it somewhere else (e.g. above a footer),
add the two marker lines there first:

```markdown
<!-- ui-review:start -->
<!-- ui-review:end -->
```

## Pruning

Folders of closed PRs are removed automatically by
`.github/workflows/prune-pr-screenshots.yml`:

- when a PR is **closed or merged**, its `pr-<n>/` folder is dropped;
- a **daily** run drops every folder whose PR is closed — the safety net for
  closed-PR runs that could not push (pull requests from forks get a read-only
  token; the workflow logs a notice and exits cleanly) or that were superseded;
- it can be run **manually** (Actions → Prune PR screenshots), dry run by default.

The workflow has `contents: write` + `pull-requests: read` only, runs one prune
at a time (`concurrency`, queued rather than cancelled) and does nothing when
the branch doesn't exist yet. It runs the same script you can run locally:

```bash
frontend/scripts/ui-review/pr-screenshots.sh prune --dry-run   # what would go
frontend/scripts/ui-review/pr-screenshots.sh prune             # every closed PR
frontend/scripts/ui-review/pr-screenshots.sh prune --pr 123    # one PR
```

`frontend/scripts/ui-review/test-pr-screenshots.sh` exercises the script
against a throwaway local bare repository (publish, replace, a lost push race,
prune by PR / by state / dry run, the read-only exit code) — run it after
changing the script; it never touches the real remote.

## Limitations

- Only what stories render is covered: states behind interactions (hover,
  menus opened by a click) show up only if a story sets them up.
- The probe works at function granularity: a story is kept when the function
  holding the change ran, even if the changed branch inside it didn't render
  anything visible, or rendered it outside the screenshot (e.g. a reaction on a
  message scrolled out of view) — such stories end up in the collapsed
  "unchanged" list.
- Global changes and very broad changes are sampled (cap 40); use `--all` for
  a full sweep (roughly 220 stories × 3 viewports × 2 sides — minutes, not
  seconds).
- A run takes minutes: two Ladle servers start, a broad change probes ~200
  stories and each captured story is shot 3× per side. Measured on a 32-core
  machine for a one-line change to the reaction chip: 220 candidates probed in
  ~6 min (50 kept), 40 captured, about 11 min end to end. A change to a single
  screen or component with its own story is much faster (no probe below 12
  candidates).
- Links use `raw.githubusercontent.com`, which serves public repositories.

## Troubleshooting

- **"Ladle (head/base) did not come up"** — rerun with `--keep` and check
  `docker compose -p uir-<id> logs ladle-head` (the project name is printed at
  start).
- **Everything shows as new** — the merge-base predates the Ladle sandbox.
- **Blank or half-rendered shots** — raise `UI_REVIEW_SETTLE_MS`, lower
  `UI_REVIEW_CONCURRENCY`.
- `.ui-review/` is disposable (gitignored); files the containers create there are
  handed back to your user at the end of every run.
