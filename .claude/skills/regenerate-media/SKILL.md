---
name: regenerate-media
description: Regenerate, review and publish Semaphore Chat's README and docs media, all generated from the Ladle sandbox with Playwright and ffmpeg in Docker. That media is the hero loop (hero.webp/hero.gif), the README screenshot grid, the docs Tour page (tour.mp4 plus a gallery grouped by feature) and social.png. Use this skill whenever the published screenshots or videos need to change, e.g. "regenerate the screenshots", "update the README video", "refresh the hero gif", "add a screenshot of X to the docs", "the UI changed, refresh the tour", "fix the caption on the voice screenshot", "publish the media branch", or when a UI change makes the media out of date. Also use it when editing the showcase demo data (frontend/src/stories/fixtures/showcase*.ts), the tour stories, or frontend/scripts/media/.
---

# Regenerate the README / docs media

The README hero and grid, the docs Tour page (video plus gallery) and `social.png` are screenshots and recordings of the **real UI** in the Ladle sandbox, running against hand-written demo data (the "Couch Co-op" friend group, plus Alex's work community "Lumen Studio", Tuesday 9:04 PM). None of it is edited by hand. The loop is: **snapshot → generate → look at what changed → fix the data, stories or scripts → regenerate → publish** (publish only when asked).

The human-facing guide is `docs-site/docs/contributing/regenerating-screenshots.md`. The design is in `docs/superpowers/specs/2026-09-23-readme-media-design.md`.

## Ground rules

- **Docker only.** Never run pnpm, node, python or ffmpeg on the host, not even a one-off such as `python3 -m json.tool`. Read JSON with the Read tool (or `jq`, if the host has it). The skill's scripts run their tools in containers. `changed-media.sh` and `publish-media.sh` only use git and coreutils on the host.
- **Never commit image or video files.** The media lives only on the orphan `media` branch. `frontend/.media-out/` is gitignored.
- **Don't change product code** (`frontend/src` outside `stories/`) to make the media look better. If the media shows a product bug, report it with the frame or screenshot.
- **Publishing force-pushes a shared branch.** Run `publish-media.sh` without `--dry-run` only when the user asks. Only publish UI that is on `main`, or that is merging with this change.

## Map

| What | Where |
|------|-------|
| Demo data: people, channels, messages, DMs, notifications, roles, voice presence | `frontend/src/stories/fixtures/showcase.ts` |
| Artwork: avatars, logos, attachments, link preview (SVG) | `frontend/src/stories/fixtures/showcaseArt.ts` |
| Fake server: socket, LiveKit room, live badges, `window.__showcase` | `frontend/src/stories/fixtures/showcaseStory.ts` |
| One story per screen (ids `tour--<kebab-name>`) | `frontend/src/stories/tour/Tour.stories.tsx` |
| Screenshot list: story, viewport, section, caption, alt, `readme`, `prepare`; video captions | `frontend/scripts/media/catalog.mjs` |
| Screenshot capture, writes `manifest.json` and `report.json` | `frontend/scripts/media/shots.mjs` |
| Video scenes: cursor, typing, teammates, catch-up steps | `frontend/scripts/media/record.mjs` |
| Shared Playwright setup: viewports, frozen clock, forbidden text | `frontend/scripts/media/lib.mjs` |
| Capture entrypoint / encoding (WebP, hero, tour, poster, social) | `frontend/scripts/media/capture.sh` / `encode.sh` |
| Compose services `media-capture` (Playwright) → `media` (ffmpeg), profile `tools` | `docker-compose.yml` |
| Publish to the orphan `media` branch | `frontend/scripts/media/publish-media.sh` |
| Where the media is shown | `README.md` (hero plus a 2×3 grid), `docs-site/docs/tour.md`, `docs-site/docs/index.md` (hero) |
| Review helpers: what changed, video frames, a docs preview | `.claude/skills/regenerate-media/scripts/` (`changed-media.sh`, `review-frames.sh`, `preview-docs.sh`) |

## 1. Generate

```bash
.claude/skills/regenerate-media/scripts/changed-media.sh snapshot   # once, before you change or regenerate anything
docker compose --profile tools up -d ladle                  # sandbox on :61000; first start compiles for ~30 s
docker compose --profile tools run --rm media               # shots + record (media-capture), then encode (media)
docker ps -a --filter name=media-capture                    # then: docker rm -f <exited container>
```

- **Snapshot first.** `changed-media.sh snapshot` records a checksum of every published output. After you regenerate, `changed-media.sh` lists what changed since then (see step 2). Take the snapshot once, at the start of the task, and don't retake it until you're done. It is also how you check that an undo really restored the old outputs.
- `MEDIA_STEPS=shots,record,encode` (a comma list; the default is all three) runs only some steps. To re-encode only: `MEDIA_STEPS=encode docker compose --profile tools run --rm --no-deps media`.
- `MEDIA_FILTER=<text>` limits the **capture** steps to shots or scenes whose **name** contains the text. For example, `voice` matches `voice-desktop`, `voice-phone`, `hero-voice` and `tour-voice`.
  - **shots:** only the matching shots are captured, and the other PNGs in `raw/shots/` are kept. `report.json` then covers only those shots and records `"filter": "<text>"`. `manifest.json` is always rewritten in full from `catalog.mjs`, even by a filtered run.
  - **record:** only the matching scenes are recorded. They merge into `raw/scenes/scenes.json`.
  - **encode ignores the filter.** It always rebuilds every screenshot from `raw/shots/`, and both videos from `raw/scenes/`. That takes about 15 s. Encoding is deterministic, so an output whose inputs didn't change comes out byte-identical.
- **What gets removed.** An unfiltered shots run deletes `raw/shots/` first, and encode rebuilds `screenshots/` from it every time. So after an unfiltered shots run, `screenshots/` holds exactly the shots in the catalog. A filtered run removes nothing: a shot you removed from or renamed in the catalog stays in `screenshots/` until the next unfiltered shots run. `publish-media.sh` refuses to publish in that state. For scenes, `scenes.json` and `trims.txt` list only the scenes in `SCENES`, and encode builds the videos from the fixed lists in `encode.sh`. An old `.webm` file left behind is ignored.
- After adding a **new** `*.stories.tsx` file, run `docker compose --profile tools restart ladle`. Otherwise the capture shows "Story not found".
- The capture container's output isn't shown live. It goes to `frontend/.media-out/capture.log`, and `encode.sh` prints that log first.

**The final run.** Iterate with `MEDIA_FILTER`, then finish with one unfiltered run that fits what you changed:

| You changed | Final run | Takes |
|-------------|-----------|-------|
| `catalog.mjs`, `shots.mjs`, or a story that no scene records | `MEDIA_STEPS=shots,encode docker compose --profile tools run --rm media` | about 2 min |
| anything in `frontend/src/stories/fixtures/` (such as `showcase.ts`), `lib.mjs`, `record.mjs`, or a story a scene records (`tour--chat`, `tour--voice`, `tour--dm-list`, `tour--dms` or `tour--chat-light-squad`) | `docker compose --profile tools run --rm media` (all steps) | several minutes |
| only `encode.sh` | `MEDIA_STEPS=encode docker compose --profile tools run --rm --no-deps media` | about 15 s |

Re-record only when the scenes or the data they show changed. Recordings are never byte-identical, so every re-record means a new frame review.

Outputs go to `frontend/.media-out/`:

- `screenshots/<name>.webp`, at 2x
- `video/hero.webp`, `video/hero.gif`, `video/tour.mp4`, `video/tour-poster.webp`
- `social.png` (1280×640)
- `manifest.json` (captions and alt text)
- `report.json` (screenshot problems, and the `filter` of the run that wrote it)
- `raw/`: `shots/*.png`, `scenes/*.webm` plus `scenes.json` and `trims.txt`, `tmp/*.mp4` (trimmed clips and `hero.mp4`), `baseline/` (the snapshot), `review/` (frames and screenshots to look at) and `docs-preview/` (the docs preview build)

## 2. Review: look at everything that changed

The details and the checklist are in **[reference/review.md](reference/review.md)**. In short:

1. **Find what changed:** run `.claude/skills/regenerate-media/scripts/changed-media.sh`. It lists every output that changed, was added or was removed since the snapshot, and prints a diff of `manifest.json` (the captions and alt text). The other outputs are byte-identical to the snapshot. If what was there at the snapshot had been reviewed (it was published, or you had already checked it), you don't need to look at those files again. With no snapshot, on a first run, or when the snapshot itself was never reviewed, review every output.
   - Screenshot capture is usually byte-identical from run to run, but not always. `chat-phone`'s code block once moved by one CSS pixel between two runs. A changed screenshot may be such a wobble rather than a real change, but look at it anyway.
2. **Reports:** `report.json` shows `"issueCount": 0` and `"filter": null`. Every scene in `raw/scenes/scenes.json` has `error: null` and no page or render errors, unhandled requests or forbidden text.
3. **Read every changed or added screenshot** with the Read tool. Check for:
   - sandbox artefacts (Ladle chrome, "Story not found", SIMULATED tiles);
   - error, offline, update or notification-permission banners;
   - spinners and broken images;
   - hover toolbars and tooltips;
   - rows cut in half;
   - continuity (the same people, badges and times everywhere);
   - captions and alt text that match what's visible.

   `social.png` and `video/tour-poster.webp` are the `chat-desktop` screenshot, framed. Look at them when they change.
4. **Look at video frames** when `hero.*` or `tour.mp4` changed, not only a player. Run `.claude/skills/regenerate-media/scripts/review-frames.sh`. It writes timestamped 3×3 sheets of `tour.mp4`, plus hero frames decoded in Chromium (ffmpeg can't decode animated WebP), to `frontend/.media-out/raw/review/`. Read every sheet. Check that:
   - the cursor never rests on message rows or voice tiles;
   - every speaker lights up;
   - scenes carry on from each other;
   - the hero loop seam is clean.

   If the videos are unchanged, they show exactly what they did at the snapshot, so skip this.
5. **See it on the page:** when you add or move an image in `tour.md`, run `.claude/skills/regenerate-media/scripts/preview-docs.sh <shot-name>`. It builds the docs with their media URLs pointing at `.media-out`, prints any mkdocs warnings, and writes screenshots of each Tour section and of the lightbox opened on that shot to `raw/review/docs/`. `--serve` serves the preview at `http://localhost:8008/tour/` for a person to click through. The README grid can't be previewed locally.
6. Check sizes: `hero.webp` ≤ 2 MB, `hero.gif` ≤ 5 MB, `tour.mp4` a few MB.

## 3. Publish (only when asked)

```bash
frontend/scripts/media/publish-media.sh --dry-run   # builds the orphan commit on a temp index, lists files and URLs, pushes nothing
frontend/scripts/media/publish-media.sh             # force-pushes one orphan commit to origin/media
```

- The script publishes `screenshots/`, `video/`, `social.png` and `manifest.json`, but never `raw/`, `report.json` or logs. Your working tree, index and branch are left untouched.
- It **refuses to run** unless `report.json` has no issues and covers every screenshot in `manifest.json` (so it can't come from a `MEDIA_FILTER` run), and `screenshots/` holds exactly the catalog's shots. The fix for either refusal is the unfiltered `MEDIA_STEPS=shots,encode` run from step 1, then a review of what it changed.
- `media` is an **orphan branch holding one commit, which is replaced on every publish.** The README and the docs load `https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/<path>`, so file names are public URLs. Publish when (or just before) a change that adds or renames media merges to `main`. A publish that drops or renames a file breaks `main` until `main` is updated. Caches can serve the old files for a few minutes.
- To see whether anything has been published yet, run `git ls-remote --heads origin media`. When this skill was written, the branch had never been published, so every media URL returned 404 and the README and Tour images showed as broken. Use `preview-docs.sh` to see the pages before a publish.
- After a new `social.png`, upload it on GitHub under Settings → General → Social preview.

## Changing what's captured

- **Demo data** (people, messages, voice, badges, notifications): [reference/demo-data.md](reference/demo-data.md). It is one consistent moment across every shot. Read this before touching `showcase.ts`.
- **A screenshot:** add or change the story, the `catalog.mjs` entry, and its place in `tour.md` or the README. See [reference/add-a-shot.md](reference/add-a-shot.md).
- **A video scene:** the scene function and `SCENES` in `record.mjs`, the `before` catch-up steps, pacing and cursor parking, and the `HERO`/`TOUR` order in `encode.sh`. See [reference/add-a-scene.md](reference/add-a-scene.md).
- **The workflow:** snapshot, then iterate with a filter. Do the final run from the table in step 1, then run `changed-media.sh` and review what it lists. Then check the source files you changed:

  | Files | Check |
  |-------|-------|
  | `frontend/src/stories/**/*.ts(x)` | `docker compose run --rm frontend pnpm run type-check`, then `docker compose run --rm frontend pnpm exec eslint <the files>` |
  | `frontend/scripts/media/*.mjs` | Not covered by type-check. ESLint only parses them (no rules apply to `.mjs`), so `docker compose run --rm --no-deps frontend pnpm exec eslint scripts/media/` catches syntax errors. The pipeline run is the real test. |
  | `*.sh` | `bash -n <file>` |
  | `docs-site/**` | `preview-docs.sh` (it prints mkdocs warnings; there should be none) |

  Commit only the source files, staging each path by name.
- **Undoing a change** (a trial, or a validation run): revert the paths you changed (`git checkout -- <paths>`) and delete any files you added, then do the same final run again. You don't need to back up `.media-out`. Encoding is deterministic and capture nearly so, so `changed-media.sh` should then report nothing changed since the snapshot you took at the start, apart from a possible capture wobble. If your change re-recorded scenes, the undo run has to re-record them too. New recordings are never byte-identical to the old ones, so review their frames again.

## Gotchas that bite first

The full list, with the reason behind each fix, is in **[reference/gotchas.md](reference/gotchas.md)**. Read it before changing `record.mjs`, `encode.sh` or `lib.mjs`.

- Playwright video has **no cursor**, so an overlay is injected. Wherever it stops, the app shows a hover state: a message row shows its toolbar, and a voice tile loses its speaking ring. Park it on the composer, the channel header, the app bar or the empty middle of the voice bar.
- `recordVideo` captures **CSS pixels**. `deviceScaleFactor` doesn't upscale the video, and a bigger `size` letterboxes. Scenes record at 1x, at the viewport size.
- Tour scenes are **separate pages**. `before` catch-up steps replay what earlier scenes did. Space replayed messages 400 ms apart, or the list stops short of the bottom.
- Time is frozen with `clock.install` plus `timezoneId`. `Notification.permission` is stubbed, because headless Chromium reports it as denied. On a phone, Enter inserts a newline, so tap send instead.
- Containers write root-owned files, and the scripts `chown` them back. The user's shell is zsh, which doesn't word-split `$var`. Use arrays or `bash -c`.
