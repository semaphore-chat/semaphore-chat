# The slice app (U13)

`crates/semaphore-app` is the real client: sign-in, the community and channel lists, a live message
list with selection, a composer with mentions, send with a nonce and a typed ack, and reconnect with
resync. Voice, session restore, OS lifecycle and attachments come in later phases (see the U13 list
in [slice-units](slice-units/README.md)).

## Launch it on the desktop

```bash
native/scripts/slice-run.sh                 # scenario showcase
native/scripts/slice-run.sh big-community   # 2,000 members, long channels
native/scripts/slice-run.sh --server-only   # just the fake server, printing its URL
```

The first run builds the release app and the fake server in the pinned image (several minutes). The
script starts the fake server in a container on `semaphore-test`, copies the app to
`~/.cache/semaphore-slice/` and opens it with the server's address filled in. Closing the window
stops the server. `SEMAPHORE_LOG=info` prints the app's log.

- **Sign in:** Connect, then any username and any password except `wrong`. The app stores the
  refresh token in your keyring (`app.semaphorechat.semaphore`), so your keyring may ask to unlock.
  Nothing reads it back yet: restore is phase 3, so it's sign-in on every start.
- **Signing out** is in the account menu, at the bottom of the rail.

## What to try

| What | How | Expected |
|---|---|---|
| T4 IME | Type into the composer with fcitx5 or IBus: Japanese, Chinese pinyin, a compose sequence, an emoji picker | Preedit underlined in place, the candidate window next to the caret, Enter confirms a candidate rather than sending |
| T5 screen reader | Orca on, then Tab and the arrow keys through the rail, channels, list and composer | Names for every control; new messages announced (the bar: announced, composer editable, no panic for an hour) |
| Selection | Drag across several messages, scroll while dragging, Ctrl+C, paste elsewhere | Exactly the text selected, `:name:` for custom emoji; the Wayland clipboard is the part no headless test covers |
| Mentions | `@` and `#` in the composer | Members and channels of this community; Enter or Tab picks |
| Send | Enter | The row shows at once, then settles; no duplicate |
| A refused send | `curl -X POST <url>/__control/fail_next_send -d '{"retryable":true}'`, then send | "Failed to send" with Retry and Delete; Retry sends it once |
| Reconnect | `curl -X POST <url>/__control/drop_connections` | A "Reconnecting..." chip, then back; nothing missing or doubled |
| A missed message | `.../refuse_connections -d '{"refuse":true}'`, `.../drop_connections`, then `.../post_as -d '{"channelId":"cc-general","authorId":"u-priya","text":"missed","broadcast":false}'`, then `.../refuse_connections -d '{"refuse":false}'` | After reconnecting, "missed" appears once |
| Window behaviour | Resize to phone width, unfocus and watch a message arrive | Layout follows; the list keeps full frame rate unfocused |

Not in this build, so not bugs yet: voice (joining a voice channel logs and does nothing), images and
avatars (placeholders), attachments, the emoji picker, threads, DMs, editing, notifications.

Please report anything that looks wrong with a screenshot, and the terminal output with
`SEMAPHORE_LOG=info`.

## The headless proof

```bash
native/scripts/in-image.sh scripts/slice-e2e.sh            # twice, about 35 s after the build
```

`rig-slice` runs the app's own code in GPUI's headless context on lavapipe, against a fake server in
the same container, through `rigs/slice/scripts/text.steps`: probe and sign in, lists, selection and
copy, a mention, send and ack, a refused send retried and one discarded, a message arriving live, a
dropped socket with a message only a resync finds, and sign-out. Shots go to
`results/slice/e2e/run-{1,2}`; every shot not named `*-live-*` must match between the runs.

## A real-backend smoke test, later

Not possible yet: the pinned contract lacks the client-type headers, and no backend build has both
them and the API-contract stack. `chore/auth-client-contract` (one commit on `main`) merges cleanly
with the stack tip `chore/stack-review-fixes`; `security/release` plus the stack conflicts. Once the
stack is rebased onto a release that has the client-type contract and the pin moves there:

1. A per-ticket stack (`scripts/test-stack.sh <ticket> up`) and the backend from that ref, migrated,
   with a seeded user and community.
2. `slice-e2e.sh` against it with the fault steps left out (no `__control` on a real server): sign
   in, lists, send and ack, the mention, sign-out, checking the server's sessions table for a
   `desktop-native` session with a device id, and that the refresh token came in the body.
3. With phase 3, a restart that restores the session and rotates the refresh token, and a revoked
   session that signs out with the notice.
