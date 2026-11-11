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

- [ ] Direct messages: the rail's chat button lists them; one opens under its header with search;
  sending, editing, reactions and threads work as in a channel; "+" starts a DM or a named group.
- [ ] Friends: the sidebar's Friends tab, its pending requests (accept, decline, cancel), Add Friend.
- [ ] The bell opens the notification centre beside the messages; a row opens its message; "Mark all
  as read" clears the count on the rail, the tray and the dock.
- [ ] A mention or DM while you're elsewhere raises a desktop notification with its sound (the
  account menu's "Notification settings" has the switches and a test button); clicking it opens the
  conversation; reading the conversation takes the notification down.
- [ ] The @ button in a channel's header sets that channel's notification level.

Not in this build, so not bugs yet: DM voice and calls, the settings page (notification settings sit
in the account menu until then).

Please report anything that looks wrong with a screenshot, and the terminal output with
`SEMAPHORE_LOG=info`.

## Desktop integration: what only a person can check

The tray, close to tray, single instance, `semaphore://` links and window restore (W2-desktop).
`scripts/desktop-probe.sh` proves hide/show on Xvfb and headless weston and the tray on a private
bus, and the notifier on a private bus with a fake `org.freedesktop.Notifications` (replace by tag,
click with its activation token, closed cleanup, withdraw); everything below needs a real panel,
compositor, notification daemon or Windows.

A packaged build (built with `SEMAPHORE_PACKAGED=1`) registers `semaphore://` for itself on every
start (Linux: a desktop entry and icon under `~/.local/share` and the default in
`~/.config/mimeapps.list`; Windows: `HKCU\Software\Classes\semaphore`), unless a package installed
`app.semaphorechat.semaphore.desktop`. A development build does not: until the native app replaces
the Electron one it must not take links away from the installed app. To test links with a
development build, start it with `SEMAPHORE_REGISTER_SCHEME=1`, and afterwards open the installed
app once so it registers itself again. `SEMAPHORE_REGISTER_SCHEME=0` forbids it in any build.

| Where | What | How | Expected |
|---|---|---|---|
| Hyprland | Tray host | Is there a StatusNotifier tray (waybar's `tray` module)? | With one: the icon shows. Without: no icon, and closing the window quits (it never hides where nothing could bring it back) |
| Hyprland | Close to tray | Close the window (`killactive`), then click the tray icon | It hides, and comes back at its size with what was open; the call, if any, kept going |
| Hyprland | Tray menu | Right-click: Show/Hide, Close to Tray (checked by default), Quit | Each does what it says; unchecking makes closing quit; Quit quits from hidden too |
| Hyprland | Focus on show | Click the tray icon or run a second launch while the window is behind others | Focused if `misc:focus_on_activate = true`; with the default (false) Hyprland only marks it urgent |
| Hyprland | Single instance | `~/.cache/semaphore-slice/semaphore-app` while it runs | No second window; the running one comes forward |
| Hyprland | Links | `xdg-open 'semaphore://direct-messages'` with the app running, then quit it and run it again | Running: the window comes forward and the log (`SEMAPHORE_LOG=info`) shows the link received. Cold: the app starts and logs it (routing comes with the app-wiring unit) |
| Hyprland | Window restore | Resize, quit, start | Same size (Wayland won't let a client place itself, so not the position); maximized stays maximized |
| Hyprland | Unread dot | Once core reports unread (app-wiring unit) | A red dot on the tray icon, the count in its tooltip |
| Hyprland | Notifications | Once core raises them (app-wiring unit), with mako or dunst running: two messages in one DM, then click | One notification for the DM (the newer replaced the older), the window comes forward (focused with `misc:focus_on_activate`) on that DM; reading the DM elsewhere takes it down |
| KDE or GNOME (optional) | Same rows | | Also the count on the task manager or dock (`com.canonical.Unity.LauncherEntry`) |
| Windows VM | Tray | Icon in the notification area (maybe under the overflow arrow); click and right-click | Click toggles the window, the menu as on Linux |
| Windows VM | Explorer restart | Task Manager, restart Windows Explorer | The icon comes back |
| Windows VM | Close to tray, restore | Close, then the tray; move to the second monitor, quit, start; unplug that monitor, start | Hides and returns; reopens where it was; centred when that monitor is gone |
| Windows VM | Links | Win+R `semaphore://direct-messages`, and a link in a browser | The app comes forward (or starts) with the link logged; a second launch never opens a second window |
| Windows VM | Unread | Once core reports unread | Dotted tray icon and a dot overlay on the taskbar button |
| Windows VM | Toasts | Once core raises them: two messages in one DM, then click the toast | One toast for the DM, named Semaphore; a click brings the app forward on that DM |

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

`w2.steps` drives wave 2: a `semaphore://` link passed before sign-in that the session lands on; the
DM list and a DM under its header; sending, editing, a unicode reaction, a thread and search in it
(no pin and no custom emoji offered); a group of two picked from searches and named; a friend
request from another user (`friend_request_as`) accepted; a mention from another user (`post_as`
with `mentionUserId`) that the rig's recording notifier shows with its sound on the virtual speaker,
withdrawn once the channel is read; a DM from another user (`post_dm_as`) whose notification is
clicked, opening the DM and marking it read on the server; the notification centre and mark all
read emptying the badge; and links while signed in to a DM (through `parse_deep_link`) and a
channel. The rig activates its window first, as a user's would be: the pane marks what it shows read
only in an active window.

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

## The real-backend smoke test

`native/scripts/slice-real.sh` (from the host) drives the same app against this checkout's backend
instead of the fake server:

1. `scripts/test-stack.sh w0real up` (postgres, redis, S3 on `semaphore-test`), then the backend in a
   `test-stack.sh w0real run` container: `prisma:migrate`, `prisma/seed-e2e.ts` (the backend's own
   e2e seed: `testuser`, `testuser2`, "Test Community", "Second Community"), `pnpm run start`. The
   script waits for `/api/health`.
2. In the build image, also on `semaphore-test`: `scripts/real-api.py ids` reads the seeded ids into
   `rigs/slice/scripts/real.steps` (`{{CH_GENERAL}}` and so on), and `rig-slice` runs it with the
   machine's clock (no `--scenario`).
3. The script: sign in (the refresh token arrives in the body and is stored), both communities and
   the first one's text channels, a send acked once, a message from `testuser2` arriving over the
   socket, a mention from the picker and one of us, the server's sessions list naming the app's
   session by its `X-Device-Name`, a restart that restores the session with a rotated refresh token,
   the rotated-out token replayed and refused (reuse detection then ends the session and the app signs
   out), a new sign-in, and that session revoked from the sessions list, which signs the app out.
   What the other users do goes through `real-api.py` (the rig's `exec` step, used by no other
   script).

Shots go to `results/slice/real/`; nothing is compared between runs. Every container it started is
removed on exit (`SLICE_REAL_KEEP=1` leaves them up).
