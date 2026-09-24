# Reviewing the media

Nothing checks taste automatically, and a passing report doesn't mean the media is good. Before you call a run done or publish it, look at every output that changed, and at video frames at least every 0.5 s whenever a video changed.

## 0. What changed

```bash
.claude/skills/regenerate-media/scripts/changed-media.sh     # compares with the snapshot from `changed-media.sh snapshot`
```

It lists each output (`screenshots/*.webp`, `video/*`, `social.png`, `manifest.json`) as `changed`, `added` or `removed`, and prints a diff of `manifest.json`, which leaves out its `generatedAt` line. An output it doesn't list is byte-identical to the snapshot. Encoding is deterministic, and screenshot capture almost always is too, so an unlisted file shows exactly what it showed then.

- Skip the unlisted files only if the snapshot itself had been reviewed: it was what's published, or you had already checked it. With no snapshot, on a first run, or when nobody reviewed the snapshot, review everything below.
- A listed screenshot is usually a real change. It can also be a capture wobble: `chat-phone`'s code block once came out one CSS pixel (2 px in the 2x image) higher in one run than in the one before. Look at it either way.
- The videos only change when scenes were re-recorded or `encode.sh` changed. If `video/hero.*` and `video/tour.mp4` aren't listed, skip step 3.

## 1. Reports

- `frontend/.media-out/report.json` must have `"issueCount": 0` and `"filter": null`, which means it comes from an unfiltered shots run. A `MEDIA_FILTER` run overwrites it with only the filtered shots and records the filter. `publish-media.sh` refuses a report that doesn't cover every shot in the catalog. Each entry lists `error`, `pageErrors`, `renderErrors`, `unhandledRequests`, `brokenImages` and `forbidden`.
- In `frontend/.media-out/raw/scenes/scenes.json`, every scene needs `error: null` and empty `pageErrors`, `renderErrors`, `unhandledRequests` and `forbidden`.
- `consoleErrors` and `httpErrors` are informational. For the known noise, see the end of [gotchas.md](gotchas.md).
- `capture.log`, which `encode.sh` also prints, ends each shot and scene with `ok` or `ISSUES: …`, and gives each scene's kept length in seconds.

## 2. Screenshots: open every changed or added file in `screenshots/`

Read each one with the Read tool (every file in `screenshots/` when step 0 says to review everything). For each one, check for:

- **Sandbox artefacts:** Ladle chrome or a Ladle backdrop, "Story not found", "SIMULATED" camera tiles, lorem ipsum, and "reply #N" filler.
- **Error states:** error, offline, "update available" or reconnecting banners and toasts, a "notifications are blocked" banner, "Something went wrong", "Failed to load", and empty states such as "No clips yet".
- **Unfinished loads:** spinners, skeletons, broken images, or blank avatars.
- **Stray interaction state:** a hover toolbar or tooltip, a focus ring, an open menu that the story didn't ask for, or a blinking caret.
- **Clipping:** no message, name row or card should be cut in half at an edge of a scroll area. The fix is a `prepare` step or different data, not a crop.
- **Continuity** (see [demo-data.md](demo-data.md)):
  - the same people in the same voice channel everywhere;
  - no badge on the conversation being viewed;
  - a bell count that matches the unread notifications;
  - times that fit 9:04 PM on Tuesday;
  - nobody listed twice.
- **Caption and alt text:** the caption and alt in `catalog.mjs`, and the copies in `docs-site/docs/tour.md` and `README.md`, must describe what is actually visible, including counts ("five replies", "four participant tiles, two of them outlined").

## 3. Videos: look at frames, not just a player (when a video changed)

```bash
.claude/skills/regenerate-media/scripts/review-frames.sh          # tour + hero (or: tour | hero)
```

This writes to `frontend/.media-out/raw/review/`, all in Docker:

- `tour-NN.png`: 3×3 sheets of `tour.mp4` at 2 frames/s, timestamped.
- `hero/fNNN.png`: every 6th frame of `hero.webp` (0.5 s apart) plus the last frame. The frames are decoded in Chromium, because ffmpeg can't decode animated WebP.
- `hero-NN.png`: 3×3 sheets of those frames.

Read every sheet. For a closer look, read single `hero/f*.png` files, or pull full-size frames around a timestamp:

```bash
docker run --rm -v "$PWD/frontend/.media-out:/m" --entrypoint bash linuxserver/ffmpeg:9.0-cli-ls82 -c \
  'ffmpeg -nostdin -loglevel error -y -ss 12 -t 2 -i /m/video/tour.mp4 -vf fps=4 /m/raw/review/at12-%02d.png; chown -R $(stat -c %u:%g /m) /m/raw/review'
```

Raw, untrimmed scene recordings are in `raw/scenes/<scene>.webm`, and the trimmed 1440×900 clips are in `raw/tmp/<scene>.mp4`. Use them to tell whether a problem comes from the recording or from the encode.

Check in the frames:

- **Cursor:**
  - It never rests on a message row (which shows the action toolbar with a red delete icon), and it only crosses rows on its way to click something in them.
  - It never sits on a voice stage tile (which hides the green speaking ring).
  - On the phone, taps show a touch dot and there is no pointer drift.
- **Voice:** every person in the clip lights up green at least once. The hero shows dropbear, then pri, then both together. People in the voice channel match the sidebar.
- **Messages:** sent messages settle with no stuck "sending" state, teammates' replies appear, and the newest message is fully visible with no scroll-to-bottom button hiding it.
- **Continuity between tour scenes:** what one scene did (sent messages, reactions, read DMs, which voice channel Alex is in) is still true in the next one, and the badges agree.
- **Pacing:** typing and cursor movement look human, and each key moment is held long enough to read.
- **Hero loop seam:** `hero/f000.png` and the last `hero/f*.png` should look the same, with no jump when the loop restarts. Crossfades should leave no burnt-in dark blocks.
- **Crossfades:** no black flash between scenes, and no leftover text from the previous scene.

## 4. On the page

When an image was added to or moved in `docs-site/docs/tour.md`, look at it where readers will see it:

```bash
.claude/skills/regenerate-media/scripts/preview-docs.sh <shot-name> [<shot-name> ...]
```

The real pages load the media from the `media` branch, so they can't show anything that hasn't been published. The preview builds the docs with the media URLs pointing at `frontend/.media-out/` and writes screenshots to `raw/review/docs/`: each Tour section at desktop width (`tour-<section>.png`), the lightbox opened on each named shot on a desktop and on a phone (`lightbox-<shot>-desktop.png`, `lightbox-<shot>-phone.png`), and the docs home page (`home.png`). Check that the grid lines up, the phone column stays narrow, and the lightbox shows the whole image with its caption. Apart from the MkDocs 2.0 notice, anything the build prints is a warning to fix. The README grid can't be previewed locally.

## 5. Sizes

Check them with `ls -la frontend/.media-out/video/`:

| File | Target | Last good run |
|------|--------|---------------|
| `video/hero.webp` | ≤ 2 MB (about 15 s, 960 px, 12 fps) | 1.2 MB, 15.65 s |
| `video/hero.gif` | ≤ 5 MB (800 px) | 2.8 MB |
| `video/tour.mp4` | a few MB (about 40 s, 1440×900, CRF 28) | 1.1 MB, 36.9 s |
| `screenshots/*.webp` | 2x: 2880×1800 desktop, 780×1688 phone | |

If the hero grows past 2 MB, shorten the hero scenes before lowering the quality (see gotchas 25 and 26).

## 6. When the product is at fault

If something looks wrong because of the product itself, such as a layout bug, a wrong string or a console error from app code, rather than the demo data or the scripts, don't change product code (`frontend/src` outside `stories/`) to make the media look better. Report it with the screenshot or frame, and work around it in the data or the scene only if the workaround stays honest.
