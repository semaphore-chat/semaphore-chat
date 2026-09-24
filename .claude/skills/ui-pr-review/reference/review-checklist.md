# Reviewing the screenshots

The pixel diff decides **what** changed. Whether each change is right is decided by looking. Open the images with the Read tool. It shows `.webp` and `.png`, though it may scale down very large images for display.

## Contents

- Finding what to look at
- Reading a composite
- The checklist in detail
- Console issues
- Theme changes: dark and light
- Writing it up

## Finding what to look at

`jq` works on the host, or you can Read the JSON. Paths are relative to the repo root:

```bash
# Every story that isn't unchanged: status, id, its composites
jq -r '.stories[] | select(.status != "unchanged") | [.status, .id, ([.shots[] | select(.composite) | .composite] | join(" "))] | @tsv' .ui-review/out/report.json

# Unchanged stories and the changed files they run (pick your sample from these)
jq -r '.stories[] | select(.status == "unchanged") | "\(.id)\t\(.reasons | join(", "))"' .ui-review/out/report.json

# Per changed file: captured / changed / unstable / not captured
jq -r '.files[]? | "\(.file)\tcaptured \(.captured)\tchanged \(.changed)\tunstable \(.unstable)\tnot captured \(.dropped)"' .ui-review/out/report.json

# Console issues, head side (compare with the base side for the same story)
jq -r '.issues[] | "\(.side)\t\(.storyId) @ \(.viewport)\t\((.pageErrors + .renderErrors + .unhandledRequests) | join(" | "))\(if .ok then "" else "\tcapture failed: \(.errorMessage)" end)"' .ui-review/out/report.json

# Blind spots
jq -r '"uncovered: \(.uncovered | join(", "))", "not visible in Ladle: \(.appOnly // [] | join(", "))", "capped: \(.selection.capped), global: \(.selection.global.files // [] | join(", "))"' .ui-review/out/report.json
```

- **Composites:** `.ui-review/out/composites/<story>--<viewport>.webp`. They exist only for changed, new, removed and unstable shots.
- **Raw full-page shots:** `.ui-review/shots/head/<viewport>/<story>.png` (and `base/`). At 1 image pixel per CSS pixel, these are what you open for unchanged stories, and when you want the whole page instead of the composite's crop.
- **Viewports:** `phone` 390×844, `tablet` 820×1180 and `desktop` 1440×900. Only `keyboard` stories are captured at `phone-short` 390×500, and a story with its own `meta.viewports` only at those (see [stories.md](stories.md#viewports-limiting-a-story-to-some-widths)), so a missing tablet or desktop shot there is expected.

## Reading a composite

- **Title bar:** the story id, a status badge (changed in amber, unstable in purple, new in green, removed in red), the viewport and its size, and the share of pixels changed.
- **Panels:**
  - `before · base <sha>` | `after · head <sha>`. A `+` after the head sha means uncommitted edits were included.
  - A third **diff** panel appears on phone only, with differing pixels in red.
  - New stories show only "after", and removed stories only "before".
- **Red outlines** mark the changed regions on every panel.
- **Scale:** phone panels are 1:1. Tablet panels are scaled a little, and desktop panels to about half. When the panels are scaled down and the change is small, a **zoom row** below shows the changed region at up to 1:1.
- **Tall pages** are cropped to a window around the change. Open the raw shot to see the rest of the page.

Compare "before" and "after" inside every outline, then scan the whole "after" panel. The outlines show where pixels differ, not everything that is wrong: a bug that is also on the base has no outline.

## The checklist in detail

1. **Intended?** For each changed story, name the edit that explains it. The story's `Renders:` line in the PR section, and its `reasons` in `report.json`, show which changed files the story runs. That includes a story whose own file changed: its line names the other changed files it runs, so a story you only touched for imports still shows the product change behind its difference. A change you can't explain is a regression until proven otherwise. That is exactly what this review exists to catch. Unexpected size changes (a list one row shorter, a panel 8 px taller) count too.
2. **Overlap, clipping, overflow:**
   - Elements drawn on top of each other.
   - Text or icons cut off by their container.
   - Content hidden under the app bar, bottom navigation, composer, voice bar or a drawer.
   - Horizontal overflow. On phone, the raw shot wider than 390 px, or a panel whose page width changed, means something is too wide.
   - Popovers and menus running off-screen.
3. **Truncation and wrapping:**
   - Long names should end in an ellipsis where the design truncates, and wrap cleanly where it wraps.
   - The part that identifies the item must still be visible.
   - Labels shouldn't wrap onto a second line that pushes buttons away.
   - Badges and counts shouldn't be squeezed out.
4. **Touch targets:** interactive elements on phone and tablet should be at least 44×44 CSS px (`TOUCH_TARGETS.MINIMUM` in `utils/breakpoints.ts`; 48 is recommended). Measure on the phone composite, which is 1:1, or on the raw shot. For anything borderline, confirm in the code (`sx` sizes, `minWidth`/`minHeight`, IconButton `size`), because the viewer may scale the image. Neighbouring targets shouldn't touch.
5. **Theme:** see "Theme changes" below.
6. **The other viewports:**
   - A phone fix must still look right on tablet (touch, 820 px) and desktop (1440 px), and the reverse.
   - Check the breakpoint-dependent pieces: drawers versus side panels, the bottom nav versus the sidebar, dialogs versus full-screen sheets.
7. **Sandbox artefacts,** which mean the screenshot doesn't show the real UI:
   - a blank or partly rendered page, a stuck spinner or skeleton, or "Loading...";
   - "Story not found";
   - an error boundary;
   - broken image icons;
   - a mock error toast ("Mock error (Ladle sandbox)") in a story that isn't about errors.

   On the head side only, these usually mean your story or change is broken. If they appear on both sides, the story was already like that: note it and don't let it hide your change.
8. **Console issues:** see "Console issues" below.
9. **Unstable shots:**
   - For each one, decide whether the outlined difference overlaps what you changed.
     - If it doesn't (for example only a menu's position moved in one of the known flaky stories), note it.
     - If it does, rerun that story once or twice (`--stories <id>`) and look again, because a real change can hide behind flakiness.
   - `rechecks` in `report.json` gives the differing pixels inside the region on each re-capture. A 0 there is what made the shot unstable.
   - Remember that a targeted run replaces `.ui-review/out`, so do the full run again before publishing.
10. **Blind spots:**
    - Files listed as "not visible in Ladle" (`index.html`, `vite.config.ts`, `main.tsx`, `index.css`, `public/`) need a check in the real app (`docker compose up`) or a note in the PR.
    - In a capped or sampled run, check that the stories you care about were captured.
    - "No probed story executes" and "no visible change" mean the screenshots don't show that code yet (see [stories.md](stories.md)).

## Console issues

The section's "Console issues" list, and `issues` in `report.json`, collect four kinds of problem per shot and side: a failed capture (with its error message), page errors (uncaught exceptions), render errors (a component threw, which usually leaves a blank area) and unhandled requests (an API call no MSW handler answered).

- **An issue on the head side only** comes from your change or your story:
  - an unhandled request means a new endpoint needs a fixture handler, either in `fixtures/handlers.ts` (`makeHandlers`) or through the story's `extraHandlers`;
  - a render or page error is a bug to fix.
- **The same issue on both sides** was already there. Mention it only if it affects what you're reviewing.

## Theme changes: dark and light

Ladle captures in **dark** mode by default. Light mode shows only in the theme stories:

- `edge-states-theme--light-*` (channel chat, channel list, DM list, DM chat, notifications, settings), each paired with a `--dark-*` version;
- the accent stories `edge-states-theme--accent-amber-balanced-light`, `--accent-rose-vibrant-dark` and `--accent-rose-vibrant-dark-channel-list`.

Changes under `src/theme/` are global, so the run samples stories and may not include these. If you touched colours, tokens, the theme or anything whose contrast depends on the mode, check that the theme stories were captured. If they weren't, do an extra run **before** your final one:

```bash
frontend/scripts/ui-review/ui-review.sh --base origin/main \
  --stories "$(jq -r '.stories | keys[] | select(startswith("edge-states-theme--"))' .ui-review/work/head-meta.json | paste -sd, -)"
```

In both modes, check that text and icons are readable against their background, that selected, hover and unread states stay distinguishable, and that nothing is still hard-coded to one mode (a white card in dark mode, or dark text on a dark header).

## Writing it up

Keep a list as you go: story, viewport, what's wrong, and whether it's fixed. Once everything is fixed or explained, the PR description (outside the markers) should say anything a reviewer can't see from the section:

- known flaky or unstable stories and why you believe they're unrelated;
- issues that also exist on the base;
- blind spots: not visible in Ladle, sampled or capped runs, and states no story reaches.
