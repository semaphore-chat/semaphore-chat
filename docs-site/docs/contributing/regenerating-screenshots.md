# Regenerating Screenshots

The screenshots and videos in the README and on the [Tour](../tour.md) page are generated from the real UI. The pipeline renders the app in the [Ladle UX sandbox](https://github.com/semaphore-chat/semaphore-chat/tree/main/frontend#ux-sandbox-ladle) against polished demo data, screenshots it with Playwright, records short scripted scenes, and encodes everything with ffmpeg. Everything runs in Docker, so you don't need a backend, a database or LiveKit. Regenerate the media whenever a UI change makes the current screenshots out of date.

## Generate

```bash
docker compose --profile tools up -d ladle          # the sandbox (first start compiles for ~30 s)
docker compose --profile tools run --rm media       # screenshots + scenes, then encode
```

`media` waits for `media-capture` to finish (Playwright screenshots and scene recordings) and then encodes the results. Everything is written to `frontend/.media-out/`, which is gitignored:

| Path | What |
|------|------|
| `screenshots/*.webp` | Desktop (1440×900) and phone (390×844) screenshots at 2× |
| `video/hero.webp`, `video/hero.gif` | The ~15 s README loop (animated WebP, with a GIF fallback) |
| `video/tour.mp4`, `video/tour-poster.webp` | The ~40 s tour video and its poster frame |
| `social.png` | 1280×640 social / Open Graph card |
| `manifest.json` | Every asset with its caption and alt text |
| `report.json` | Console errors, unhandled requests, broken images and forbidden text for each screenshot |
| `raw/` | Unencoded PNGs and per-scene recordings (not published) |

Useful variables:

- `MEDIA_STEPS=shots,encode` runs only some steps (`shots`, `record`, `encode`). To re-encode only, add `--no-deps` so the capture container isn't started: `MEDIA_STEPS=encode docker compose --profile tools run --rm --no-deps media`.
- `MEDIA_FILTER=voice` limits the run to screenshots or scenes whose name contains the text.

Stop the sandbox afterwards with `docker compose stop ladle && docker compose rm -f ladle media-capture`. `media-capture` runs as a dependency of `media`, so `--rm` does not remove it.

!!! note "Added a new story file?"
    Ladle only picks up **new** `*.stories.tsx` files after a restart (`docker compose --profile tools restart ladle`). Otherwise the capture shows "Story not found". The pipeline flags that page as forbidden text in `report.json`.

## Review

Look at every output before you publish. Nothing checks taste automatically.

1. `report.json` must show `"issueCount": 0`. Also check `raw/scenes/scenes.json` for page errors in the recordings.
2. Open every file in `screenshots/`. Look for realistic content, no loading spinners, no broken images, no error or offline toasts, and no sandbox artefacts. The pipeline also rejects "SIMULATED", "Story not found" and similar text.
3. Watch `video/hero.webp` in a browser. It should loop cleanly, and the cursor movement and typing should look human.
4. Watch `video/tour.mp4`, or pull out one frame per second onto a contact sheet to skim it (40 tiles, enough for the whole ~40 s tour):

    ```bash
    docker run --rm -v "$PWD/frontend/.media-out:/w" --entrypoint ffmpeg linuxserver/ffmpeg:9.0-cli-ls82 \
      -i /w/video/tour.mp4 -vf "fps=1,scale=480:-1,tile=5x8" -frames:v 1 /w/raw/tour-contact-sheet.png
    ```

5. Check the size targets: `hero.webp` should be 2 MB or less, `hero.gif` 5 MB or less, and `tour.mp4` a few MB.

## Publish

The media lives on an orphan `media` branch, the same pattern as the coverage `badges` branch. `main` never contains images or videos. The README and the docs load files from `https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/<path>`.

```bash
frontend/scripts/media/publish-media.sh --dry-run   # build the commit locally and show what would be pushed
frontend/scripts/media/publish-media.sh             # force-push it to origin/media
```

Each publish replaces the branch with a single new commit, so the branch history stays at one commit. Browsers and GitHub's image proxy can cache the old files for a few minutes after a publish.

!!! warning "Publish before the change reaches `main`"
    The README on `main` and the docs site (deployed on every `docs-site/**` push to `main`) load the media straight from the `media` branch. Publish when (or just before) a change that adds or renames media merges, otherwise those images and the video show as broken until someone does. Publishing a little early is fine, as long as the change doesn't rename or remove a file that `main` still uses (each publish replaces the whole branch).

`social.png` is not used by the README or the docs. After publishing a new one, upload it as the repository's social preview (**Settings → General → Social preview** on GitHub), which is what link previews of the repository show.

## Changing what's captured

| To change | Edit |
|-----------|------|
| Demo people, channels, messages, DMs, notifications | `frontend/src/stories/fixtures/showcase.ts` |
| Avatars, community logos, attached images | `frontend/src/stories/fixtures/showcaseArt.ts` (hand-written SVG, generated locally) |
| Theme, live socket and voice behaviour (`window.__showcase`) | `frontend/src/stories/fixtures/showcaseStory.ts` |
| Screens (one story per screenshot subject) | `frontend/src/stories/tour/Tour.stories.tsx` (story ids `tour--*`) |
| Which screenshots, viewports, captions and alt text | `frontend/scripts/media/catalog.mjs` |
| Video scenes (cursor paths, typing, teammates' actions) | `frontend/scripts/media/record.mjs` |
| Encoding, crossfades, sizes | `frontend/scripts/media/encode.sh` |
| Where the media is shown | `README.md`, `docs-site/docs/tour.md`, `docs-site/docs/index.md` |

Timestamps in the demo data are fixed wall-clock times, and the capture pins the browser clock and timezone to match. A "3:42 PM" in the data always renders as 3:42 PM.
