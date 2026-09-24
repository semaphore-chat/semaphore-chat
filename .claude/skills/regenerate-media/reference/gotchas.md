# Gotchas (all hit while building the pipeline)

Each one cost real time. The fix is already in the code; this list explains why it is there, so don't undo it.

## Running the pipeline

1. **Ladle only discovers new `*.stories.tsx` files on restart.** After adding a file, run `docker compose --profile tools restart ladle`. Otherwise the capture shows "Story not found", which the pipeline flags as forbidden text. Edits to existing files hot-reload.
2. **`compose run` doesn't stream the dependency's output.** `media-capture` runs as a dependency of `media`, so its log goes to `frontend/.media-out/capture.log`, which `encode.sh` prints at the start of its own output.
3. **`--rm` doesn't remove the dependency container.** After a run, remove the exited one: `docker ps -a --filter name=media-capture`, then `docker rm -f <name>` (or `docker compose rm -f media-capture`).
4. **To re-encode only, use `MEDIA_STEPS=encode … run --rm --no-deps media`.** Without `--no-deps`, the capture container starts anyway, reinstalls `playwright-core` and empties `capture.log`.
5. **A `MEDIA_FILTER` shots run overwrites `report.json` with only the filtered shots**, and sets its `"filter"`. Then `issueCount: 0` says nothing about the rest, so `publish-media.sh` refuses a report that doesn't cover every shot in the catalog. Finish with an unfiltered shots run. Filtered scene runs are different: they merge into `raw/scenes/scenes.json`. The filter never applies to encoding (gotcha 30).
6. **The containers run as root.** `capture.sh`, `encode.sh` and `scripts/review-frames.sh` `chown` their output back to the owner of the checkout. Do the same in any one-off `docker run` that writes into the repo.
7. **zsh (the user's shell) doesn't word-split `$var`.** `cmd $ARGS` passes one argument. Use arrays, or run the snippet with `bash -c`.

## Playwright capture

8. **Freeze time with `context.clock.install({ time: SHOWCASE_NOW })` and `timezoneId: 'America/New_York'`.** Then "3:42 PM" in `showcase.ts` renders as 3:42 PM and "Today" stays today. Timers still run in real time, so animations and scripted delays work. `SHOWCASE_NOW` is defined in both `lib.mjs` and `showcase.ts`, and the two must match.
9. **Headless Chromium reports `Notification.permission` as `denied`, even when the permission was granted.** The settings page then shows a "notifications are blocked" banner. `newCaptureContext` in `lib.mjs` stubs it to `granted`.
10. **Ladle must be reached as `localhost`, a secure context.** `media-capture` uses `network_mode: service:ladle` for that. Anything that decodes media in a page, such as `ImageDecoder` in `scripts/hero-frames.mjs`, also needs a secure (https or localhost) origin.
11. **`recordVideo` captures CSS pixels.** `deviceScaleFactor: 2` doesn't raise the video resolution, and a `size` larger than the viewport letterboxes the frame. Scenes record at 1x, at exactly the viewport size (1440×900, or 390×844 for phone). Screenshots use 2x.
12. **Playwright video has no mouse cursor.** `record.mjs` injects an overlay (an arrow on desktop, a touch dot on phone) that follows real mouse events. Wherever the pointer stops, the app shows its hover state. See "Cursor parking" below.
13. **On a phone, Enter in the composer inserts a newline.** Tap the send button (`button:has([data-testid="SendIcon"])`) instead.
14. **A phone thread opens scrolled to the newest reply**, which cuts the first reply's name row in half. The `thread-phone` shot uses `prepare: 'threadFromTop'` (`PREPARE` in `shots.mjs`).

## The fake server (`showcaseStory.ts`)

15. **`REACTION_ADDED` carries the reaction's full `userIds` list, not a delta.** `__showcase.react` accumulates the reactors, starting from whoever had already reacted in the fixture. If you send only the new user, the other reactors disappear.
16. **The app reads each member's roles from `/api/roles/user/:id/community/:id`**, not from the roles in the membership list. `memberRoleHandlers` in `showcaseStory.ts` answers that endpoint from `membershipsByCommunity`. Set roles there, and keep that handler for any story you build without `defineShowcase`.
17. **Messages that arrive within a frame or two of each other leave the list short of the bottom.** It stops following new messages, so the newest ones hide behind the scroll-to-bottom button. Space scripted messages about 400 ms apart (`CATCH_UP_GAP_MS`).
18. **Unread badges only clear when a conversation scrolls into view.** A story that opens a short conversation would keep its badge while you look at it. Such stories start from `showcaseWithRead(contextId)`.

## Cursor parking (video)

19. **Hovering a message row shows its action toolbar**, which includes a red delete icon. Start the cursor on the composer, the channel header or the app bar, and don't travel across the message list unless the cursor is about to click something in it, such as a reaction chip or "5 replies".
20. **A hovered voice stage tile swaps its green speaking ring for the card hover border**, so the speaker seems to stop talking. Keep the cursor in the empty middle of the voice bar, e.g. `place(420, 868)` then `move(820, 860)`.
21. **`actor.move` bows its path**: a rightward move curves down and a leftward move curves up. Along the channel header, go right to left so the arc rises into the empty app bar instead of dipping into the messages.
22. **A finger doesn't hover.** On phone scenes, `actor.tap()` jumps straight to the target, and the pointer rests on the app bar between taps.

## Encoding

23. **Run ffmpeg with `-nostdin` inside a `while read` loop.** Otherwise it reads the loop's input (`trims.txt`) and silently drops scenes.
24. **ffmpeg can't decode animated WebP.** To check `hero.webp`, decode it in Chromium with `scripts/review-frames.sh hero`, or look at `raw/tmp/hero.mp4`, which it is encoded from.
25. **Animated WebP shows banding on dark gradients below about quality 80.** The hero is encoded at 80.
26. **The animated WebP encoder skips pixels that changed by only a few levels.** A slow, linear crossfade over dark content never finishes in those areas, so the old scene's text stays burnt into the new scene as dark blocks. The hero's crossfades use a cubic ease (`HERO_XFADE`) so the last step is large enough to be encoded.
27. **Hero loop seam:** the end crossfades into a still of the very first frame, and that frame is held for `LOOP_HOLD`. Without the hold, the 12 fps WebP may never sample the fade's final frame, and the loop visibly jumps.
28. **The `chat-desktop` screenshot is used three times:** as a screenshot, as `social.png` (framed on violet), and as the tour poster. Changing that shot changes all three.

## Docs site

29. **mkdocs-glightbox writes `data-height="auto"`**, which glightbox turns into an invalid `max-height: calc(auto - …)`. Desktop screenshots then run off the top and bottom of the screen. `docs-site/docs/stylesheets/tour.css` sets a desktop-only `max-height`. Keep it.

## Reproducibility (what changed-media.sh relies on)

30. **Encoding ignores `MEDIA_FILTER`.** The encode step always rebuilds every screenshot from `raw/shots/` and both videos from `raw/scenes/`, which takes about 15 s. A filtered run therefore rewrites every output, but only the ones whose inputs changed come out different.
31. **ffmpeg's `gradients` source picks a random point for any end point outside the frame**, and `x1=1280` in a 1280-pixel-wide frame counts as outside. Until the end points were pulled in to `1279`/`639` and `899`, `social.png` and the phone scene's backdrop got a random gradient on every encode. `tour.mp4` and `social.png` then came out different even when nothing had changed. Keep end points at width − 1 and height − 1. With that, the same raw captures always encode to byte-identical files.
32. **Screenshot capture is almost, but not fully, deterministic.** The frozen clock and the fixed data make most shots byte-identical from run to run. `chat-phone`'s code block once came out one CSS pixel (2 px in the 2x image) higher than in the run before, and then stayed that way for seven runs. So a screenshot that `changed-media.sh` lists may be a wobble rather than a real change, but it still has to be looked at.

## Known noise in the reports (not problems)

- `consoleErrors` includes React's "`<pre>` cannot be a descendant of `<p>`" warning, which comes from code blocks in messages. That is a product issue. Report it if it matters, but don't patch it for the media.
- `httpErrors` includes `404 …/api/notifications/channels/<id>/override`. That endpoint answers 404 by design when a channel has no override.
- Neither of these counts toward `issueCount`, which only counts errors, page errors, render errors, unhandled requests, broken images and forbidden text.
