---
name: regenerate-media
description: Regenerate, review and publish Semaphore Chat's README and docs media, all generated from the Ladle sandbox with Playwright and ffmpeg in Docker. That media is the hero loop (hero.webp/hero.gif), the README screenshot grid, the docs Tour page (tour.mp4 plus a gallery grouped by feature) and social.png. Use this skill whenever the published screenshots or videos need to change, e.g. "regenerate the screenshots", "update the README video", "refresh the hero gif", "add a screenshot of X to the docs", "the UI changed, refresh the tour", "fix the caption on the voice screenshot", "publish the media branch", or when a UI change makes the media out of date. Also use it when editing the showcase demo data (frontend/src/stories/fixtures/showcase*.ts), the tour stories, or frontend/scripts/media/.
---

# Regenerate the README / docs media

The README hero and grid, the docs Tour page (video plus gallery) and `social.png` are screenshots and recordings of the **real UI** in the Ladle sandbox, running against hand-written demo data ("Lumen Studio", Tuesday 3:42 PM). None of it is edited by hand. The loop is: **generate → look at every output → fix the data, stories or scripts → regenerate → publish** (publish only when asked).

The human-facing guide is `docs-site/docs/contributing/regenerating-screenshots.md`. The design is in `docs/superpowers/specs/2026-09-23-readme-media-design.md`.

## Ground rules

- **Docker only.** Never run pnpm, node, python or ffmpeg on the host. Every step below runs in a container.
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

## 1. Generate

```bash
docker compose --profile tools up -d ladle                  # sandbox on :61000; first start compiles for ~30 s
docker compose --profile tools run --rm media               # shots + record (media-capture), then encode (media)
docker ps -a --filter name=media-capture                    # then: docker rm -f <exited container>
```

- `MEDIA_STEPS=shots,record,encode` (a comma list; the default is all three) runs only some steps. To re-encode only: `MEDIA_STEPS=encode docker compose --profile tools run --rm --no-deps media`.
- `MEDIA_FILTER=<text>` limits the run to shots or scenes whose **name** contains the text, e.g. `voice` matches `voice-desktop`, `voice-phone`, `hero-voice` and `tour-voice`. Filtered scene runs merge into `raw/scenes/scenes.json`. A filtered shots run **overwrites `report.json`** with only those shots, so finish with a full run.
- After adding a **new** `*.stories.tsx` file, run `docker compose --profile tools restart ladle`. Otherwise the capture shows "Story not found".
- The capture container's output isn't shown live. It goes to `frontend/.media-out/capture.log`, and `encode.sh` prints that log first.
- A full run (16 screenshots, 7 scenes) takes several minutes.

Outputs go to `frontend/.media-out/`:

- `screenshots/<name>.webp`, at 2x
- `video/hero.webp`, `video/hero.gif`, `video/tour.mp4`, `video/tour-poster.webp`
- `social.png` (1280×640)
- `manifest.json` (captions and alt text)
- `report.json` (screenshot problems)
- `raw/`: `shots/*.png`, `scenes/*.webm` plus `scenes.json` and `trims.txt`, and `tmp/*.mp4` (trimmed clips and `hero.mp4`)

## 2. Review: look at everything

The details and the checklist are in **[reference/review.md](reference/review.md)**. In short:

1. `report.json` shows `"issueCount": 0` from a full run, and every scene in `raw/scenes/scenes.json` has `error: null` and no page or render errors, unhandled requests or forbidden text.
2. **Read every screenshot** with the Read tool. Check for:
   - sandbox artefacts (Ladle chrome, "Story not found", SIMULATED tiles);
   - error, offline, update or notification-permission banners;
   - spinners and broken images;
   - hover toolbars and tooltips;
   - rows cut in half;
   - continuity (the same people, badges and times everywhere);
   - captions and alt text that match what's visible.
3. **Look at video frames**, not only a player: run `.claude/skills/regenerate-media/scripts/review-frames.sh`. It writes timestamped 3×3 sheets of `tour.mp4`, plus hero frames decoded in Chromium (ffmpeg can't decode animated WebP), to `frontend/.media-out/raw/review/`. Read every sheet. Check that:
   - the cursor never rests on message rows or voice tiles;
   - every speaker lights up;
   - scenes carry on from each other;
   - the hero loop seam is clean.
4. Check sizes: `hero.webp` ≤ 2 MB, `hero.gif` ≤ 5 MB, `tour.mp4` a few MB.

## 3. Publish (only when asked)

```bash
frontend/scripts/media/publish-media.sh --dry-run   # builds the orphan commit on a temp index, lists files and URLs, pushes nothing
frontend/scripts/media/publish-media.sh             # force-pushes one orphan commit to origin/media
```

- The script publishes `screenshots/`, `video/`, `social.png` and `manifest.json`, but never `raw/`, `report.json` or logs. It refuses to run if `report.json` lists issues. Your working tree, index and branch are left untouched.
- `media` is an **orphan branch holding one commit, which is replaced on every publish.** The README and the docs load `https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/<path>`, so file names are public URLs. Publish when (or just before) a change that adds or renames media merges to `main`. A publish that drops or renames a file breaks `main` until `main` is updated. Caches can serve the old files for a few minutes.
- After a new `social.png`, upload it on GitHub under Settings → General → Social preview.

## Changing what's captured

- **Demo data** (people, messages, voice, badges, notifications): [reference/demo-data.md](reference/demo-data.md). It is one consistent moment across every shot. Read this before touching `showcase.ts`.
- **A screenshot:** add or change the story, the `catalog.mjs` entry, and its place in `tour.md` or the README. See [reference/add-a-shot.md](reference/add-a-shot.md).
- **A video scene:** the scene function and `SCENES` in `record.mjs`, the `before` catch-up steps, pacing and cursor parking, and the `HERO`/`TOUR` order in `encode.sh`. See [reference/add-a-scene.md](reference/add-a-scene.md).
- After a change: regenerate with a filter to iterate quickly, finish with a full run, review everything, then type-check and lint what you changed (`docker compose run --rm frontend pnpm run type-check`). Commit only the source files, staging each path by name.

## Gotchas that bite first

The full list, with the reason behind each fix, is in **[reference/gotchas.md](reference/gotchas.md)**. Read it before changing `record.mjs`, `encode.sh` or `lib.mjs`.

- Playwright video has **no cursor**, so an overlay is injected. Wherever it stops, the app shows a hover state: a message row shows its toolbar, and a voice tile loses its speaking ring. Park it on the composer, the channel header, the app bar or the empty middle of the voice bar.
- `recordVideo` captures **CSS pixels**. `deviceScaleFactor` doesn't upscale the video, and a bigger `size` letterboxes. Scenes record at 1x, at the viewport size.
- Tour scenes are **separate pages**. `before` catch-up steps replay what earlier scenes did. Space replayed messages 400 ms apart, or the list stops short of the bottom.
- Time is frozen with `clock.install` plus `timezoneId`. `Notification.permission` is stubbed, because headless Chromium reports it as denied. On a phone, Enter inserts a newline, so tap send instead.
- Containers write root-owned files, and the scripts `chown` them back. The user's shell is zsh, which doesn't word-split `$var`. Use arrays or `bash -c`.
