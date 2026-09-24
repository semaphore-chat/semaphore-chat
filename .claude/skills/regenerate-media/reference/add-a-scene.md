# Adding or changing a video scene

The hero (`hero.webp` / `hero.gif`, about 15 s) and the tour (`tour.mp4`, about 40 s) are built by stitching **scenes** together. Each scene is a separate Playwright recording (`recordVideo`) of one story, driven by `frontend/scripts/media/record.mjs`:

| Video | Scenes, in order (`encode.sh`) |
|-------|--------------------------------|
| hero | `hero-chat` (#general: send, +1 the 😂, scroll up, open the Friday thread) → `hero-voice` (Squad Up talking) → loop back |
| tour | `tour-chat` → `tour-dms` (reply to pri, she asks "you getting on?") → `tour-phone` (answer with a GIF from the picker) → `tour-voice` (Squad Up) → `tour-light` (Alex in Squad Up, light theme) |

## 1. The story

A scene records a story, just as a screenshot does. Reuse a tour story, or add one (see [add-a-shot.md](add-a-shot.md), step 1). A scene that needs a different starting state gets its own story. For example, `tour-light` uses `ChatLightSquad` because Alex is in Squad Up by then. Don't script the state into place on camera.

## 2. The scene function (in `record.mjs`)

```js
async function threadScene({ page, actor, start }) {
  // Before start(): set up. Nothing here ends up in the clip.
  const composer = page.locator('textarea').first();
  const box = await composer.boundingBox();
  await actor.place(box.x + box.width * 0.78, box.y + box.height / 2);   // park somewhere hover-safe
  await start();                                                        // the clip starts here
  await sleep(300);
  await actor.clickOn(page.locator('button', { hasText: /5 replies/ }).first(), { moveMs: 800 });
  await actor.showcase('say', 'dropbear', { channelId: 'cc-general' }, '9 works');
  await sleep(1700);                                                    // hold the result, then return: the clip ends
}
```

Then add it to `SCENES`:

```js
{ name: 'tour-thread', story: 'tour--chat', viewport: 'desktop', before: [afterTourChat], run: threadScene },
```

- The clip keeps only what happens between `start()` and the moment `run` returns. The trim offsets are written to `raw/scenes/scenes.json` and `trims.txt`.
- `viewport` is `desktop` (1440×900) or `phone` (390×844, recorded at 1x). `encode.sh` centres any scene whose name contains `phone` on a violet backdrop.
- **`before`** takes catch-up functions that run after the page loads and before the scene starts. They make a fresh page look like the rest of the tour so far. Every tour scene is a new page, so without them, messages sent earlier vanish and conversations that were already read show badges again. The existing ones are `afterTourChat` (Alex's "ok i'm on at 8:45 friday" and his 😂 +1) and `afterTourDms` (Alex's "yeah i saw", pri's "you getting on?", her DM read). If you change what a scene does, update the catch-up functions that replay it. Space out replayed messages with `CATCH_UP_GAP_MS` (gotcha 17). Shared text goes in `TOUR_TEXT`.

### The actor: cursor and keyboard (`makeActor`)

| Call | Does |
|------|------|
| `place(x, y)` | Jumps the cursor there instead of moving it. Use it before `start()`, or on the phone. |
| `move(x, y, ms = 650)` | An eased move with a slight arc (rightward moves bow down, leftward moves bow up). |
| `click(ms)` | Mouse down, then up. On desktop this shows a violet ring; on the phone, a touch dot. |
| `clickOn(locator, { dx, dy, moveMs = 700, pause = 180 })` | Moves to the centre of the locator, pauses, clicks. |
| `tap(locator)` | Phone: jumps to the target and taps it, with no travel. |
| `type(text)` | Types like a person, about 55–105 ms per key and longer after spaces and punctuation. |
| `showcase(fn, ...args)` | Calls `window.__showcase[fn](...args)` in the page. |

### Teammates: `window.__showcase` (`ShowcaseApi` in `showcaseStory.ts`)

`where` is `{ channelId: 'cc-general' }` or `{ dmId: 'dm-priya' }`. People are referred to by username (their handle): `alexk` (Alex, the viewer), `pri`, `dropbear`, `aiko`, `samira` (shown as "Samira"), `diego` ("Diego"), `gracie`, `tomatillo`, `zara`, `kwam3`, `chlo`, `noahbody` or `mateo`.

| Call | Effect |
|------|--------|
| `say(user, where, text, extra?)` | A new message, as a real `NEW_MESSAGE`/`NEW_DM` event. Returns its id. `extra` can add `reactions` and similar fields. |
| `typing(user, where, bool)` | A typing indicator. Turn it on, wait about 900 ms, turn it off, then `say`. |
| `react(user, messageId, emoji, where)` | Adds a reaction. The full list of reactors is sent (gotcha 15). |
| `read(where)` | Alex has read a conversation elsewhere: its badge clears and its notifications are marked read. |
| `speak(user, bool)` | One voice participant starts or stops speaking. Needs a story with `voice`. |
| `conversation([users], stepMs)` | Starts an endless, fixed talking pattern: `[0] [0] [1] [1,0] [2] [2] [0] [1] [1] [2,1]`, one step every `stepMs`. Start it before `start()`, then wait `lead` ms to choose where in the pattern the clip joins. |

To find a message you just sent, look it up in the DOM (`[data-message-id]` rows), as `chatScene` does. Ids of existing messages are in `showcase.ts`.

## 3. Pacing and the cursor

- A person watching needs time: about 700–800 ms for a cursor move to a target, a short pause before clicking, human typing speed, and **1.5–2 s held on the result** before the scene ends. The hero's total is about 15 s, so keep hero scenes tight. The tour can breathe.
- Park the cursor where hovering changes nothing: the composer, the channel header, the app bar, or the empty middle of the voice bar. Never park it on message rows or voice stage tiles (gotchas 19–22). Plan the path so it doesn't cross the message list unless it's going to click something there.
- In a voice scene, every speaker should light up at least once within the clip. Tune `stepMs` and `lead`. The hero uses `{ ms: 4000, stepMs: 1000, lead: 900 }` so that dropbear, then pri, then both together speak.
- On the phone, the pointer rests on the app bar (`place(195, 20)`), every interaction is a `tap`, and messages are sent by tapping the send button, because Enter adds a newline.

## 4. Wire it into the video (`encode.sh`)

- **Hero:** `HERO=(hero-chat hero-voice)`. The hero closes its loop by crossfading into its first frame, so its first scene must open on a calm frame. The hero is 12 fps, 960 px wide, and must be ≤ 2 MB.
- **Tour:** the `for c in tour-chat tour-dms …` list sets the order. Scenes are joined with 0.5 s crossfades (`FADE`), and the tour fades in from black and out to black.
- Update `VIDEOS` in `catalog.mjs` (caption, and alt text describing the scenes in order). Also update the copies of that alt text: the tour's in `docs-site/docs/tour.md` (`aria-label`); the hero's in `README.md` and `docs-site/docs/index.md`. If the length changes a lot, update "15 seconds" and "40-second" in the captions and the regenerating guide.

## 5. Record and look

From a worktree, run these as `MEDIA_STEPS=... MEDIA_FILTER=... scripts/test-stack.sh <ticket> media` (see SKILL.md).

```bash
MEDIA_STEPS=record,encode MEDIA_FILTER=tour-thread docker compose --profile tools run --rm media   # one scene; merges into scenes.json
MEDIA_STEPS=record,encode MEDIA_FILTER=tour- docker compose --profile tools run --rm media      # all tour scenes
.claude/skills/regenerate-media/scripts/review-frames.sh tour
```

Look at every sheet ([review.md](review.md), step 3). A scene whose `error` is set in `scenes.json` still produced a clip, but the clip stopped at the failure, so check `capture.log`.
