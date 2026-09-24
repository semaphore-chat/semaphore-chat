# Adding or changing a screenshot

A screenshot is made from four things: a **story** (what's on screen), a **catalog entry** (viewport, file name, caption, alt), a **placement** in the README or docs, and a **review**. Change them in this order.

## 1. The story: `frontend/src/stories/tour/Tour.stories.tsx`

Each export is one screen. Ladle gives it the id `tour--<kebab-case export name>`, so `ChatLightStandup` becomes `tour--chat-light-standup`. Reuse an existing story if the screen is the same and only the viewport differs; `tour--chat` serves both `chat-desktop` and `chat-phone`.

```tsx
/** One line: what this screen shows and why. */
export const Pinned = defineShowcase(showcasePaths.dev, {
  scenario: showcaseWithRead(showcaseChannels.dev.id),   // opened conversation starts read
  theme: { mode: 'light', accentColor: 'purple', intensity: 'balanced' }, // default: dark, purple, balanced
  overlay: <ClickOnMount find={() => findButtonByIconTestId('PushPinIcon')} timeoutMs={8000} />,
});
```

`defineShowcase(path, options)` (in `fixtures/showcaseStory.ts`) takes:

- `path`: an app route. `showcasePaths` has `dev`, `general`, `lounge`, `community`, `communitySettings`, `dms`, `dmPriya`, `dmLaunch`, `notifications`, `settings`, `profile` and `home`. Add a route to `showcasePaths` if you need a new one.
- `scenario`: a changed copy of `showcaseScenario`, e.g. `showcaseWithRead(id)` or `showcaseWithMeInVoice(channelId, scenario, joinedAt)`. Never change the shared object in place.
- `theme`: `{ mode, accentColor, intensity }`.
- `voiceState` + `voice`: to show Alex connected to a voice channel. Copy the `Voice` or `ChatLightStandup` stories: `channelVoiceState(channel, { createdAt })` and `voice: { me: { user: showcaseMe }, remotes: [...crew] }`, where the remotes are exactly the people already in that channel, and `speaking: true` lights up a tile.
- `overlay`: a component that acts once the story has mounted. It uses the helpers in `fixtures/interactions.tsx` (`ClickOnMount`, `TypeIntoTextareaOnMount`, `AttachFileOnMount`) and the finders in `fixtures/domQueries.ts` (`findButtonByText`, `findButtonByIconTestId`, `findMenuItemByText`). Use it to open a thread, a tab, a drawer or a menu.
- `extraHandlers`: MSW handlers for any endpoint the screen needs that the showcase doesn't answer yet. Unhandled requests show up in `report.json`.

**New story file?** Only needed if you don't add to `Tour.stories.tsx`. Restart Ladle: `docker compose --profile tools restart ladle`.

**New data?** Add it to `fixtures/showcase.ts` and follow the continuity rules in [demo-data.md](demo-data.md).

To check the story quickly, open `http://localhost:61000/?story=tour--<id>` (Ladle, when `ladle` is up), or run a filtered capture (step 3).

## 2. The catalog entry: `frontend/scripts/media/catalog.mjs`

Add an entry to `SHOTS`. The order of `SHOTS` is the capture order and the order in `manifest.json`.

```js
{
  name: 'pinned-desktop', story: 'tour--pinned', viewport: 'desktop', section: 'Chat',
  caption: 'Pin the messages everyone needs',               // short; used as the gallery title
  alt: 'The pinned messages panel open beside the #dev channel, listing three pinned messages.', // what is visible, specifically
  // readme: true,          // only for the six README grid shots (all desktop)
  // prepare: 'threadFromTop', // a page tweak from PREPARE in shots.mjs, run right before the screenshot
  // settleMs: 2500,        // extra settle time (default 2500)
},
```

- `name` becomes `screenshots/<name>.webp` and is part of the public URL. Use the pattern `<subject>-<desktop|phone>`. Renaming a shot breaks every page that links to the old name until you update it and publish (see "Publish" in SKILL.md).
- `viewport` is `desktop` (1440×900) or `phone` (390×844). Both are captured at 2x.
- `section` must be one of `SECTIONS`: Chat, Threads & replies, Voice & video, DMs, Communities & roles, Mobile & PWA, Themes. Add a new section to `SECTIONS` and to `tour.md` together.
- `prepare`: if the page needs adjusting before the screenshot (a scroll position, say), add a function to `PREPARE` in `shots.mjs` that throws if it can't find its target, and name it here. Before any `prepare` runs, the mouse is parked at (0, 0).

## 3. Generate and review

```bash
MEDIA_STEPS=shots,encode MEDIA_FILTER=pinned docker compose --profile tools run --rm media
```

Then read `screenshots/pinned-desktop.webp`, and check `report.json` against [review.md](review.md). Before publishing, do a full run, because a filtered run's `report.json` only covers the filtered shots.

## 4. Placement: README and docs

The media files are loaded from `https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/<path>`, so the path must match `name` exactly. Nothing reads `manifest.json` automatically: copy the caption and alt text by hand.

- **Docs Tour page** (`docs-site/docs/tour.md`): add the image under its section. Desktop shots go in a `<div class="grid tour-desktop" markdown>` block (two per row); phone shots go in a `<div class="grid tour-phones" markdown>` block.

  ```markdown
  ![<alt from catalog>](https://raw.githubusercontent.com/semaphore-chat/semaphore-chat/media/screenshots/pinned-desktop.webp){ loading=lazy data-gallery="chat" data-title="<caption from catalog>" }
  ```

  `data-gallery` groups the lightbox by section. Use the slug of an existing section: `chat`, `threads`, `voice`, `dms`, `communities`, `mobile` or `themes`.
- **README** (`README.md`): only for a `readme: true` shot. The grid is a hand-written 2×3 HTML `<table>`. Each cell is a link to the full-size image, an `<img>` with a shorter alt, and a `<sub>` caption. Keep it at six desktop shots, so if you add one, swap another out.
- **Hero**: `README.md` (a `<picture>` with WebP and a GIF fallback) and `docs-site/docs/index.md` (WebP only, linking to the Tour). Update their alt text if the hero's content changes. The canonical text is `VIDEOS` in `catalog.mjs`.

Optionally, check the docs build in Docker:

```bash
docker run --rm -v "$PWD/docs-site:/docs:ro" -w /docs python:3.12-slim sh -c \
  "pip install -q --root-user-action=ignore -r requirements.txt && mkdocs build --strict -d /tmp/site"
```

The build prints a long notice about MkDocs 2.0; ignore it. It must end with "Documentation built". Until the `media` branch has the new file, the image shows as broken on the rendered page. That is expected.
