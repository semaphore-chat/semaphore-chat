# Native UI Review

The GPUI client's version of [UI Review Screenshots](ui-review.md): render every story on a base
ref and on your working tree, pixel-diff the two, and write a section for the pull request
description. Stories come from `native/crates/semaphore-ui/src/stories.rs` and are rendered by
`native/rigs/shot` with no display server, on the software Vulkan driver in the pinned image, so
the shots don't depend on the machine or its GPU.

```bash
# Before/after renders against merge-base(origin/main, HEAD), uncommitted edits included.
native/scripts/ui-review.sh

# After opening the PR: replace (or append) the section in its description.
native/scripts/ui-review.sh --pr 123 --update-pr
```

For that run the tool:

1. checks the base out in a detached worktree at `native/.ui-review/base-src`;
2. builds `rig-shot` for the base and for the working tree — both into the same cargo target
   volume, so only the base's own crates compile twice;
3. renders every story at **desktop** (1280×720) and **phone** (390×844) on the base, and twice
   on the working tree;
4. compares them and sorts the stories into **changed / new / removed / unstable / unchanged**;
5. writes a composite per changed story and the report below.

Everything that builds or renders runs in the pinned image through `native/scripts/in-image.sh`,
as your user; only git, docker and Python 3 (standard library) run on the host. Never run cargo
on the host.

## Output

Gitignored, under `native/.ui-review/`:

| Path | What |
| --- | --- |
| `shots/base/<size>/<story>.png` | the base renders |
| `shots/head/<size>/<story>.png` | the working tree's renders |
| `shots/head2/<size>/<story>.png` | the second pass, which decides "unstable" |
| `out/composites/<story>-<size>.png` | **before \| after \| diff**; new stories have only the after shot, removed ones only the before shot |
| `out/report.json` | every story and shot: status, differing pixels, per cent, paths, base and head |
| `out/pr-block.md` | the section for the pull request, between the `native-ui-review` markers |

The composite's third panel is the after shot dimmed, with every differing pixel in red. Shots are
2× device pixels (a 1280×720 window is a 2560×1440 PNG), so the composites are large: look at
them with an image viewer, or at 1:1 on the region you changed.

## Reading the report

The run ends with one line, the same shape as the web tool's:

```
[native-ui-review] diff: 2 changed, 0 new, 0 removed, 0 unstable, 830 unchanged, 0 failed
```

| Status | Meaning |
| --- | --- |
| **changed** | rendered on both sides and the pixels differ; there is a composite |
| **new** | the story only exists on the working tree (the after shot alone) |
| **removed** | the story only exists on the base (the before shot alone) |
| **unstable** | base and head differ, but rendering the working tree a second time did not reproduce the difference |
| **unchanged** | identical on both sides |
| **failed** | a shot did not render; the run exits non-zero and names the story |

**Unstable** stories are not counted as changes. Two renders of the same code should be identical
— `rig-shot` waits for the window to settle, and the theme, the clock and the fixture are fixed —
so a difference that doesn't reproduce comes from the story itself (an animation, a list that
anchored differently, something that raced a layout). Rerun just that story with `--stories` and
look at its composite; if it keeps happening it is a finding about the story, not about this
change.

**The tool only says that pixels moved.** It cannot say whether the result is right: open every
composite and check the change you meant to make, that nothing overlaps, clips or is truncated,
and that the phone layout still works. A story reported unchanged for code you meant to change
visibly is a finding too — the state may need a story of its own.

## What is not compared

`native/rigs/shot/scripts/*.steps` are interaction scripts (click, type, wait, shoot) that drive a
story through the states after its first render, mostly in more than one theme and width. Between
them they take about 1,600 shots — as many as every story at both sizes — and each shot is named
inside its script, so "one story id" wouldn't describe them. They stay out of the run to keep it
at the story renders; `native/rigs/shot/review.sh` renders the one that reviews the kit by eye.

Every story is also rendered in `ThemeChoice::default()` (dark, teal, minimal), which is what
`rig-shot <story> <w> <h> <out.png>` produces; the light and vibrant themes a screen renders on its
own are inside the stories that set them.

## Options

| Option | What |
| --- | --- |
| `--base <ref>` | compare against `merge-base(<ref>, HEAD)`; default `origin/main` |
| `--stories <list>` | comma-separated story ids or globs (`kit-*`, `kit-cjk,about`); default every story |
| `--sizes <list>` | `name:width:height` pairs; default `desktop:1280:720,phone:390:844` |
| `--fuzz <percent>` | differing pixels at or below this share of a shot count as unchanged; default `0`, an exact pixel comparison. The report says which mode ran |
| `--reuse` | skip the base build and renders when the same base commit, sizes and `--stories` filter were already rendered (`native/.ui-review/meta/base-sha`) |
| `--pr <n>`, `--update-pr` | replace (or append) the marked section in PR `<n>`'s description with `gh`; everything outside the markers, a web UI-review section included, is left alone |
| `--shards <n>` | renders in parallel, and threads for the comparison; default 8, or `UI_REVIEW_SHARDS` |

Exit code: `0` when everything rendered, changes or not; `1` when the build failed or a story
didn't render, with the failing story ids listed. Visual changes are never a failure.

**`--stories` for a quick look.** A full run renders 832 stories three times: about six minutes on
a 32-core machine (8 shards), and roughly four times that on four cores. Four stories take about
half a minute once the build is warm. Use `--stories` while iterating, then do the full run for
the section you publish.

## In CI

`.github/workflows/native-spike.yml` runs the tool in the Linux job for pull requests that touch
`native/**`, against the PR's base, after the job's `verify.sh` (which already built `rig-shot`).
It uploads `native/.ui-review/out` as the `native-ui-review` artifact and writes the section into
the job summary. It fails the job only when a story doesn't render.

## Relationship to the web tool

Same idea, same statuses, same summary line, similar report. Two differences: the native client
has no story sandbox to select from (every story is rendered, and there is no render probe), and
the images are not published anywhere — they are local files, uploaded as the CI artifact, so the
PR section lists their paths instead of embedding them.
