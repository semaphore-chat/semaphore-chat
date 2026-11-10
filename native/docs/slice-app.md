# The slice app (U13)

`crates/semaphore-app` is the real client: sign-in, the community and channel lists, a live message
list with selection, a composer with mentions, send with a nonce and a typed ack, and reconnect with
resync, session restore and the OS's sleep and network events. Voice and attachments come in later
phases (see the U13 list
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
  refresh token in your keyring (`app.semaphorechat.semaphore`), so your keyring may ask to unlock,
  and the server's URL in `~/.local/share/semaphore/last-server`. The next start resumes the session
  with no password. The fake server is a new one each time, but it accepts any refresh token, so a
  restart of `slice-run.sh` resumes too (its container address may differ: then it can't reach the
  old one and offers Try again or Sign in again).
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

### Sleep, network and restart: what only a real machine shows

The e2e drives these through the same entry point the OS watcher uses (`os suspend`, `os resume`,
`os network-down`, `os network-up`, `restart`); only a real machine shows the watcher itself firing.
Run with `SEMAPHORE_LOG=info`: each event logs as `OS: Suspending` and so on.

- [ ] **Suspend and resume** (Linux, logind): signed in, `systemctl suspend`, wake after a minute.
  The log shows `OS: Suspending` then `OS: Resumed`; the "Reconnecting..." chip shows briefly or not
  at all, and messages sent meanwhile by someone else (`post_as` with `broadcast: true` from another
  terminal while asleep) are there after waking, once.
- [ ] **A long sleep:** suspend for more than 85 s (how long the server keeps a frozen socket). On waking the app
  reconnects and resyncs; nothing is missing or doubled.
- [ ] **Network off and on** (NetworkManager): `nmcli networking off`, wait, `nmcli networking on`.
  The log shows `OS: Network(Unavailable)`, the chip says "You're offline", then `Available` and a
  reconnect within a few seconds, not after a ping timeout.
- [ ] **Switching networks** (Wi-Fi to wired, or another Wi-Fi): note whether the log shows anything.
  NetworkManager only reports a state change; a move between two connected networks may show
  nothing, and then the socket recovers on its ping timeout. That's the known gap.
- [ ] **Quit and start again:** close the window, run the binary again
  (`~/.cache/semaphore-slice/semaphore-app`, with the fake server still up via `--server-only`).
  It opens signed in, on the first community, without asking for a password.
- [ ] **Keyring locked at start:** lock the keyring, start the app. The unlock prompt appears over the
  splash; after unlocking the session resumes.
- [ ] **Windows** (after the `windows-link` job is green): sleep and wake from the Start menu, and
  turn Wi-Fi off and on, with `SEMAPHORE_LOG=info` in a console build. Expect the same log lines.
  This code has only ever been compiled for Windows, never run.

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
dropped socket with a message only a resync finds, a sleep the socket doesn't survive, the network
going away and back and changing, restarts that resume, can't reach, or are refused a session, and
sign-out. Shots go to
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
3. A restart that restores the session and rotates the refresh token (the old one must then be
   refused: reuse detection), and a session revoked from the web's session list that signs out with
   the notice at the next start.
