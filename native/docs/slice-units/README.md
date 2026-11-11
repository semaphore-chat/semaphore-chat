# Slice work units

The vertical slice from the approved design: sign-in, community and channel lists, a live message
list with selection, a composer with mentions, send with nonce and ack v2, reconnect and resync, and
voice with video tiles. It answers what isolated rigs can't, and is the start of the real client if
the spike says go.

Spec files exist for U1-U4, which go to DeepSeek Flash. The rest get theirs from the coordinator.

## Status

| Unit | Owns | Depends on | Tier | Parallel with |
|---|---|---|---|---|
| U0 skeleton | Workspace, core API, stubs | | Done | |
| [U1 API generator](U1-api-gen.md) | `tools/gen-api`, `semaphore-wire`, `semaphore-api` | U0 | Flash | U2, U3 |
| [U2 design](U2-design.md) | `tools/web-export/{theme,icons}*`, `semaphore-design` | U0 | Flash | U1, U3 |
| [U3 scenarios](U3-scenarios.md) | `tools/web-export/scenarios*`, `fixtures/scenarios`, `core/src/scenario.rs` | U0 | Flash | U1, U2 |
| [U4 fake server](U4-fake-server.md) | `semaphore-fake-server` | U1, U3 | Flash | U2, U5-U10 |
| U5 core | `core/src/{store,events,send,resync,commands,cache,backend}*`, `semaphore-ffi` | U1 | **opus-high** | U4, U6, U8-U12 |
| U6 text | `core/src/text` | U1 | sonnet-medium | Everything after U1 |
| U7 net | `semaphore-net`, `semaphore-platform-desktop` | U1, U5 | sonnet-medium | U8-U12 |
| U8 shell | `ui/src/{theme,kit,shell,auth,nav}`, `rigs/shot` steps | U2, U3 | **opus-medium** | U5, U6, U7, U9-U12 |
| U9 messages | `ui/src/messages` | U3 | **opus-high** | U5, U6, U7, U8, U10-U12 |
| U10 composer | `ui/src/composer` | U3 | **opus-medium** | U5, U6, U7, U8, U9, U11, U12 |
| U11 voice | `semaphore-media-livekit`, `ui/src/voice` | U0; final patch from the video agent | **opus-high** | U5-U10, U12 |
| U12 image dimensions | `backend/` on the API-contract stack | That stack landing | sonnet-medium | Everything |
| U13 app | `semaphore-app`, `rigs/slice`, `scripts/slice-{e2e,run}.sh` | All | **opus-medium** | Nothing; phase 1 done |
| U14 measure | `results/slice` | U13 | Fresh **opus-medium**; scripts Flash | Nothing: it measures, so run it alone |

**Rules for running them.**

- Each unit gets its own worktree on a branch from `spike/native-gpui`, so builds don't share a lock.
- UI units touch only their directory, so they merge cleanly. Cap them at three at once: parallel
  builds distort T10 and the ledger.
- `ui/src/stories.rs` lists every feature already, so no unit needs to edit it.
- Workspace members are a glob, and every crate has its `deny.toml` line already. A unit adds a line
  only for a new rig.

## What is frozen

`crates/semaphore-core/src/model.rs` and `commands.rs`, `CoreEvent` in `platform.rs`, `realtime.rs`,
and the `VideoSink` trait. UI units build on them with fixtures before core is real. To change one,
ask the coordinator.

**Not frozen:** `backend.rs`, whose signatures use wire types (U5 adds them after U1), and the JSON
inside `cache.rs`, which U5 replaces with typed entries.

## Known gaps to carry

- **The auth contract (closed by W0-contract).** The pin is now `main`, whose `contract/openapi.json`
  has `X-Client-Type`, `X-Device-Id` and `X-Device-Name` as parameters of sign-in, refresh and the
  desktop token redeem; `semaphore-net` passes them there instead of as default headers. Only
  `User-Agent`, which the contract doesn't model, is still set by hand. The real-backend smoke test:
  [docs/slice-app.md](../slice-app.md#the-real-backend-smoke-test).
- **U5 must keep `scripts/test-policy.sh` working when core gains `semaphore-wire`:** its fixture
  copies core alone and has its own `[workspace.dependencies]`. Keep `[dependencies]` last in core's
  `Cargo.toml` too, because that script appends to the file.
- **`spike/t7-t8` is merged**, and U7 (`slice/u7-net`) implements `Backend` and `Realtime` over it:
  `HttpBackend` and `SocketRealtime` in `semaphore-net`. Sessions are not restored on startup yet:
  U7 stores the refresh token per server but nothing reads it back (needs a core command).
- **Windows now has a surface path, untested on a GPU:** `Window::video_uploader()` returns `Some`
  there too, through the vendored D3D11 patch, and `SURFACE_PATH_BUILT` includes Windows, so tiles take
  the same path on both. It has compiled but never run on a real GPU. `rigs/surface-smoke` in the
  `windows-link` job runs it on whatever the hosted runner offers, which at best is WARP, software
  rendering (the CI job waits on a push). A surface failure moves tiles to RGBA, but wrong colours or a
  black tile can't be detected: `SEMAPHORE_VIDEO_PATH=rgba` is the way out. If the surface pipeline
  fails to build at startup, renderer creation fails with it and no window opens, in any call or none.
  `third_party/README.md` has the API.

## U13 must do

U13 is in four phases, each leaving the app runnable: **1 text client (done)**, **2 voice (done)**,
**3 session restore and OS lifecycle (done)**, **4 media and attachments (done)**. How to run it: [docs/slice-app.md](../slice-app.md).

**Done in phase 1:** the app (`semaphore-app` as a library and binary; core on a Tokio runtime of its
own, events to GPUI through a channel), `CoreSource` over core's load states, members (with the
truncated flag) and rail counts, the list's `LoadNewer`, "Jump to present" and reply click,
`DiscardFailed`, channel permissions and slowmode to the composer, `send_settled` after every
`Send`, typing over the socket, the composer on U6's mention functions, `messages::init`,
`with_list_frame_policy`, `video_window_options`, `UiAssets` and `Root`. Core gained `load_state`,
`retry_failed`, `last_sign_out`, `probe_server` and `send_typing`, and a 401 after the backend's
refresh ends the session as `AuthLost` does. `SocketRealtime` now asks for typed send acks
(`auth.protocol: 2`); without it a refused send waited out the 10 s ack timeout.

**Done in phase 2:** the LiveKit engine is core's media engine. Its reports reach
`Core::ingest_media` with the call number they carry (`MediaEngine::connect(url, token, call)`), so a
call that connects and drops between two reports ends instead of showing connected; `Effect::EndCall`
disconnects the engine when a session ends under a call. Rejoins take fresh tokens from
`Core::voice_token`, presence is refreshed every 30 s, frames go into the window's `VideoFrames`, and
tile demands go to `Core::set_video_demands` (`TileDemand` is core's `VideoDemand` now). A voice row
joins and shows the stage; elsewhere the call's bar sits under the columns. The bar's Share audio
starts T11's system audio (`platform_capture()`, everything but our own call), audio only; a failure
shows in the bar and isn't retried. Settings opens a two-list device dialog. Closing the window leaves
the call (Mike may overrule). Not built: publishing the camera or the screen's picture (the bar keeps
those buttons off), DM voice, a push-to-talk key. T11's known gaps stand: the capture callback
allocates on the realtime thread, a failed PipeWire link isn't retried, and only our own process is
left out of the capture.

**Done in phase 3:** `Core::restore_session(url)` answers `SignedIn`, `NoSession`, `Refused` or
`Unreachable`. The app keeps the last server in `<data dir>/last-server` (not a secret);
`HttpBackend::restoring` reads that server's refresh token with the device id, in the one wait on the
keyring, and `set_server_url` takes it up. A refused token is deleted and the sign-in screen says the
session expired; an unreachable server keeps it and offers Try again. Shutdown stops core and the
socket, then the runtime, then waits for the keyring's queued writes (`HttpBackend::flush`), so a
rotated refresh token isn't lost at exit. `semaphore_platform_desktop::lifecycle` reports sleep and
network changes to `Core::suspend`, `resume` and `network_changed`: logind's `PrepareForSleep` and
NetworkManager's `StateChanged` over zbus 5 on async-io on a thread of its own, a boot-against-monotonic
clock check where logind is missing, and on Windows `PowerRegisterSuspendResumeNotification` and
`NotifyIpInterfaceChange` with `GetNetworkConnectivityHint`. Kit alerts are now accessible alerts.

Left out of phase 3, as follow-ups: a logind delay inhibitor (today a sleep can start before core has
heard of it, which costs nothing but a reconnect); NetworkManager's `PrimaryConnection` changes, so a
Wi-Fi to Wi-Fi move with no state change goes unnoticed until the socket's ping times out; networks
without NetworkManager (iwd, systemd-networkd) report nothing; Windows modern standby may skip
`PBT_APMSUSPEND`; the restored sign-in screen names the server by its host until it is probed again.

**Done in phase 4:** attachments drawn in messages (images inline, other files as a card with name
and size, an in-window viewer for images, Save as with a sanitised name for the rest), avatars
(list, shell, members, mention menu), custom emoji, and link-preview cards. Files come through
`Core::file` into one in-memory LRU of encoded bytes (64 MB, cleared at sign-out); GPUI decodes them
off the UI thread through the app's asset source into the bounded caches. Every image is checked from
its header before anyone decodes it: past 16 MB or 64 megapixels (4 for GIF and WebP) it's drawn as
its file card or initials. Sending follows the server's contract as the web uses it: the message
first with `pendingAttachments`, then each upload (streamed, with progress) attached to it; a refused
upload shows the server's reason with Retry and Remove, and core drops each file's bytes as it's
attached or removed. Files come from the file dialog, a paste or a drop. Link-preview images load only
with `AppConfig.link_preview_images`, off by default (waiting on Mike): http(s) only, image types
only, 5 MB, 10 s, three redirects, no session headers.

Left out of phase 4, as follow-ups: thumbnails sized by the server (U12) so image boxes stop being a
fixed size; a frame count limit for animated images beyond the pixel limit; streaming a large upload
from disk instead of holding its bytes; `:name:` for an unknown custom emoji in message text (a
placeholder shows instead; copying gives `:name:` already). GPUI packs images edge to edge in its atlas and has no
padding, so an image drawn larger than its pixels samples a sliver of its atlas neighbour along its
edge: the headless run showed it on 16-pixel test avatars (which is why the fake server's images are
now larger than they draw). Real avatars and photos are larger than they draw; custom emoji scaled up
may show a faint edge, unconfirmed on a real machine.

Some UI comments still say core lacks these (`voice/model.rs`). Drop each as its gap closes.

## Follow-ups, not cut

Later in the order, not out of scope:

- **A thread pane.** `MessageListEvent::OpenThread` logs; core opens threads already.
- **Editing.** `ComposerEvent::EditLastMessage` logs; core has no edit command.
- **Browser sign-in, registration, password reset.** Browser sign-in needs the client-type backend;
  Register and Forgot password open the server's web app.
- **Notifications.** Superseded in wave 2: core's `CoreEvent::Notify`, and the app's notifier
  (`semaphore-app/src/notifier.rs`: our freedesktop client on Linux, GPUI's toasts on Windows).
- **A DM list read.** Core has DM counts but no `direct-messages` read, so `Route::DirectMessages` has
  nothing to list.
- **Publishing the local camera and screen.** The engine only receives video: a user's own
  `ParticipantView` has no tracks.
- **DM voice.** `Core::join_voice` takes a channel. The DM presence and token endpoints aren't wired.
- **Third-party images in link previews.** `LinkPreviewView` carries the URLs and nothing loads them.
  Whether the UI fetches them directly, as the web does, is waiting on Mike. It exposes a viewer's IP
  to any site a poster links.

## The ledger

Every unit records this in `results/slice/ledger.jsonl`, one line when it finishes: unit, tier, wall
minutes, tokens, look/fix iterations, lines added, and rework after review. It's how the slice
answers the question of real agent productivity.
