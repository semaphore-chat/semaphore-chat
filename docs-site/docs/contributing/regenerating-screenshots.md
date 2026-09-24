# Regenerating Screenshots

The screenshots and videos in the README and on the [Tour](../tour.md) page are generated from the real UI. The pipeline renders the app in the [Ladle UX sandbox](https://github.com/semaphore-chat/semaphore-chat/tree/main/frontend#ux-sandbox-ladle) against polished demo data, screenshots it with Playwright, records short scripted scenes, and encodes everything with ffmpeg. Everything runs in Docker, so you don't need a backend, a database or LiveKit. Regenerate the media whenever a UI change makes the current screenshots out of date.

Using Claude Code? The [`regenerate-media` project skill](https://github.com/semaphore-chat/semaphore-chat/tree/main/.claude/skills/regenerate-media) walks through the same generate, review and publish loop, with the full review checklist and the known pitfalls.

## Generate

```bash
docker compose --profile tools up -d ladle          # the sandbox (first start compiles for ~30 s)
docker compose --profile tools run --rm media       # screenshots + scenes, then encode
```

!!! note "From a git worktree"
    The commands on this page use the dev stack, so run them in the main
    checkout. For media work on a branch in a git worktree, run the same
    pipeline with `scripts/test-stack.sh <ticket> media` (the same
    `MEDIA_STEPS` and `MEDIA_FILTER` variables). It serves the worktree's
    Ladle as `<ticket>-ladle`, with no host port, on the shared
    `semaphore-test` Docker network, and never creates a network (see
    [Test Stacks](testing.md#test-stacks-and-the-shared-docker-network)).
    Restart it with `docker restart <ticket>-ladle` and remove it with
    `scripts/test-stack.sh <ticket> down`.

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
- `MEDIA_FILTER=voice` limits the capture to screenshots or scenes whose name contains the text. The encode step ignores it and rebuilds every output from `raw/`, which takes about 15 s. A filtered run keeps the other screenshots and writes a `report.json` that covers only the filtered ones, so finish with an unfiltered run (`MEDIA_STEPS=shots,encode` is enough if no scene changed) before you publish.

Stop the sandbox afterwards with `docker compose stop ladle && docker compose rm -f ladle media-capture`. `media-capture` runs as a dependency of `media`, so `--rm` does not remove it.

!!! note "Added a new story file?"
    Ladle only picks up **new** `*.stories.tsx` files after a restart (`docker compose --profile tools restart ladle`). Otherwise the capture shows "Story not found". The pipeline flags that page as forbidden text in `report.json`.

## Review

Look at every output before you publish. Nothing checks taste automatically.

1. `report.json` must show `"issueCount": 0` and `"filter": null` (an unfiltered run). Also check `raw/scenes/scenes.json` for page errors in the recordings.
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

The script refuses to publish unless `report.json` comes from an unfiltered screenshot run with no issues, and `screenshots/` holds exactly the screenshots in `catalog.mjs`. Each publish replaces the branch with a single new commit, so the branch history stays at one commit. Browsers and GitHub's image proxy can cache the old files for a few minutes after a publish.

!!! warning "Publish before the change reaches `main`"
    The README on `main` and the docs site (deployed on every `docs-site/**` push to `main`) load the media straight from the `media` branch. Publish when (or just before) a change that adds or renames media merges, otherwise those images and the video show as broken until someone does. Publishing a little early is fine, as long as the change doesn't rename or remove a file that `main` still uses (each publish replaces the whole branch).

`social.png` is not used by the README or the docs. After publishing a new one, upload it as the repository's social preview (**Settings → General → Social preview** on GitHub), which is what link previews of the repository show.

## Changing what's captured

| To change | Edit |
|-----------|------|
| Demo people, channels, messages, DMs, notifications | `frontend/src/stories/fixtures/showcase.ts` |
| Avatars, community logos, attached images | `frontend/src/stories/fixtures/showcaseArt.ts` (hand-written SVG, generated locally) |
| GIFs (picker results and GIF messages) | `frontend/src/stories/fixtures/showcaseGifs.ts` (drawn on a canvas and encoded as GIFs in the browser, served from a mocked GIF provider) |
| Theme, live socket and voice behaviour (`window.__showcase`) | `frontend/src/stories/fixtures/showcaseStory.ts` |
| Screens (one story per screenshot subject) | `frontend/src/stories/tour/Tour.stories.tsx` (story ids `tour--*`) |
| Which screenshots, viewports, captions and alt text | `frontend/scripts/media/catalog.mjs` |
| Video scenes (cursor paths, typing, teammates' actions) | `frontend/scripts/media/record.mjs` |
| Encoding, crossfades, sizes | `frontend/scripts/media/encode.sh` |
| Where the media is shown | `README.md`, `docs-site/docs/tour.md`, `docs-site/docs/index.md` |

Timestamps in the demo data are fixed wall-clock times, and the capture pins the browser clock and timezone to match. A "9:04 PM" in the data always renders as 9:04 PM.
