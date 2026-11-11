# The slice app (U13)

`crates/semaphore-app` is the real client: sign-in, the community and channel lists, a live message
list with selection, a composer with mentions, send with a nonce and a typed ack, and reconnect with
resync, session restore, the OS's sleep and network events, and voice with video tiles. Attachments
come in a later phase (see the U13 list
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

### Voice

The fake server's tokens are placeholders, so voice needs a LiveKit: run
`LK_STACK_NAME=u13-voice-livekit native/scripts/lk-stack.sh up`, then start the fake server with
`--livekit-url ws://<that address>:7880 --livekit-key devkey --livekit-secret
secret-that-is-at-least-32-characters-long` (the address `lk-stack.sh url` prints). A second
participant with video: `native/scripts/slice-e2e.sh --voice`'s publisher line, or the web client.

- [ ] Join Squad Up: your mic is live, others hear you, you hear them; the speaking ring follows.
- [ ] Mute, deafen and undeafen from the bar; the others see it.
- [ ] Settings: switch input and output while talking.
- [ ] Camera from the bar: the others see you, your own tile shows your picture; off again.
  Pick another camera under Settings, Camera, and turn it on again.
- [ ] Share screen. On Wayland the portal's dialog opens straight away; on X11 and Windows our picker
  lists screens and windows with thumbnails. Your share fills your stage, the others see it, and with
  a video playing they hear it too, without hearing themselves echoed back (T11). Stop it from the
  bar, and from the system's own "stop sharing" (Wayland), and by closing a shared window.
- [ ] Settings, Screen share: change resolution, frame rate and audio; the next share uses them (the
  defaults are 1080p at 30 fps with audio). At phone width, share is under "more".
- [ ] Video tiles from a sharing participant play smoothly on the GPU path.
- [ ] Leave from the bar; join, then close the window: the others see you leave at once.
- [ ] Stay in a call for an hour (T6 later runs 24): you stay on the roster throughout.

### Files and images

- [ ] Attach from the paperclip (the portal's file dialog), by pasting a screenshot, and by dropping
  files from the file manager; send. The message shows at once, then each file's progress, then the
  files themselves.
- [ ] A large file over a slow link: the bar moves steadily, and the upload doesn't time out.
- [ ] Click an image: it fills the window; Escape closes it. Click a file: Save as offers its name.
- [ ] Avatars everywhere you'd expect them; custom emoji in messages and reactions.
- [ ] Link previews show title and description, but no image: loading third-party images is off
  until you decide (it tells those sites your address).
- [ ] Scroll a long channel full of images for a while: memory settles (it's bounded).

### Message features (W1)

- [ ] Hover a message: the toolbar. Edit your own (or Up in an empty composer), Enter saves, Escape
  cancels. Delete your own: "Delete?" in place. Right-click someone else's: "Remove message", with
  a reason; it stays visible to you, marked removed.
- [ ] Pin from the toolbar; the header's pin badge counts it; the pin button opens the list, a click
  jumps to the message and tints it, the cross unpins.
- [ ] React from the toolbar's button: the picker opens with the caret in its search; hover a
  reaction for who reacted. The composer's emoji button inserts into the text.
- [ ] Reply in thread: the pane shows the message, its replies and a reply box; the bell turns
  notifications off and on; closing it brings back the pins or search panel if one was open.
- [ ] Search from the header: results as you type, "All channels" for the community; a hit opens its
  message (a thread reply opens its thread).
- [ ] A link to a message on this server (`https://server/#/community/C/channel/X?highlight=M`)
  opens it here; any other link opens the browser.
- [ ] A channel with unread messages shows the "N NEW MESSAGES" divider where you stopped reading,
  and it stays there while the channel is open.
- [ ] Anything the server refuses shows its message in a bar above the composer.

Not in this build, so not bugs yet: DM voice, DMs, notifications.

Please report anything that looks wrong with a screenshot, and the terminal output with
`SEMAPHORE_LOG=info`.

## The headless proof

```bash
native/scripts/in-image.sh scripts/slice-e2e.sh            # every steps file, each twice
native/scripts/slice-e2e.sh --voice                       # on the host: LiveKit too, about 15 s
```

`--voice` brings up `lk-stack.sh`'s LiveKit and a `lk room join --publish-demo` publisher, then runs
`rigs/slice/scripts/voice.steps` twice: join, the publisher's video reaching a tile, the heartbeat,
mute and deafen, the camera on (our own preview reaching our tile) and off, a camera that fails and
is retried, a screen share through our picker (the engine's fake screens, the rig's list) shown on
our own stage with its audio failing cleanly (no PipeWire in a container), a cancelled picker, the
bar elsewhere, a moderator removing us with the camera on (the call ends here and on the server, and
the camera goes off), a second call, and leaving.

`w1.steps` drives the message features against the showcase scenario: edit in place and Up to edit,
a thread with a reply and the bell, a first reply shown while the thread's count is still 0, delete,
a moderator's removal with a reason, pin, the pins panel, its jump and unpin, a reaction from the
emoji picker and its tooltip, the composer's emoji button, search with a jump to a thread reply, a
message link in the web's `/#/` form, and the unread divider.

The default run executes every `rigs/slice/scripts/*.steps` except `voice.steps`, in sorted order,
each twice with a fresh fake server per run, so a wave adds its own steps file instead of growing
`text.steps`. `text.steps` writes `<out-dir>/run-N`; every other file writes `<out-dir>/<name>/run-N`.
Each file's static shots must match between its two runs, and the script exits non-zero if any file's
don't. `slice-e2e.sh <out-dir> <steps-file>` runs just that file.

The default run also covers media: avatars and images drawn, two files sent after their message, a
refused upload retried and one removed, the image viewer, a custom emoji, and a link preview whose
image stays unrequested until the switch is turned on (the fake server's log proves it).

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
