# Native spike results

Updated at each phase. No go/no-go verdict exists yet.

## Status

| Test | Status |
|---|---|
| T1 video | Investigated separately by two agents, outside this workspace, for now |
| T7 reconnect | **Pass**: 10/10 network kill, 10/10 LiveKit restart |
| T8 Socket.IO | **Pass**, see the limits below |
| T2-T6, T9, T11 | See their own agents |
| T10 agent loop | Harness works; the 20-run test is not done |
| Windows | CI job written, **never run**: pushing the branch is waiting on Mike |

## Test bars: what differs from the original brief

Everything here was added or changed after the brief, so no bar moves silently. Tests not
listed keep the brief's bar unchanged.

| Test | Original brief | Now | Kind | Effect |
|---|---|---|---|---|
| T1 | 60 fps UI | Presented frame times, p99 at or under 16.7 ms | Defined | Stricter than an average |
| T1 | Under 40% of a core per 720p stream above baseline | Same number, 720p30, process CPU including decode | Defined | Stricter: decode counts |
| T1 | No separate limit for the 1080p60 share | Under 150% of one core | **Added** | New bar |
| T1 | One machine | Also rerun on 4 pinned cores, because a 32-thread host flatters | **Added** | New bar |
| T1, T2 | No run count | Minimum three runs; report median and worst | **Added** | Stricter |
| T5 | No explicit pass bar. The research report had: new messages announced, composer editable, no panic over 1 hour | Decision rule says "navigable without panic" | **Changed** | **Possibly weaker than research: confirm which applies** |
| T7 | Everyone audible | Same, measured by per-publisher tone detection | Defined | None |
| T8 | 1,000 disconnects | Same, plus a suspend/resume case | **Added** | Stricter |
| T9 | Under half a day each | Under 4 agent hours, tokens recorded | Defined | A human half-day doesn't map onto agents |
| T9 | 4 consecutive releases | 3 replayed (0.8.0, 0.8.1, 0.9.0, from a port down to 0.7.3) plus the next live one | **Changed** | Replayed bumps were already fixed upstream, so less pressure than a surprise |
| T9 | (Research report also required gpui-agent patches to re-apply) | Not in the brief; dropped unless gpui-agent is adopted | **Changed** | Weaker, if adopted later |
| T9, T10 | Pass/fail like the others | Failure raises the estimate but does not block go | **Changed** | **Weaker: these two can no longer stop the project** |
| T1 patch path | "Patch the renderer" | Only if T1 alone fails, profiling blames conversion or upload, Iced's shader arm uses at least 30% less CPU or holds 60 fps; budget 3 agent-days | **Added** | New gate |
| Switch to Iced | "Move to Iced" | Iced must first pass T2-T5 | **Added** | Stricter |

## T7 and T8

Raw data, transcripts and result JSON are in `results/t7`, `results/t8`, `results/t7.json` and
`results/t8.json`. T8's final runs tested commit `ae1fd727`: a rebuild of it gave the same binary
hash as the one that ran (`0d9e2968564da037`).

### T7: pass

Three participants in three network namespaces, each hearing the others judged by tone per
publisher on decoded PCM. No real audio device was involved, so playout is not tested.

| Fault | Result | Worst pair audible |
|---|---|---|
| Victim's network dropped by `tc` for 30 s | 10/10 | 275-4711 ms after heal |
| LiveKit restarted | 10/10 | 291-434 ms after the server answered |
| 90 s outage, past the SDK's budget, with our rejoin (not the bar) | 3/3 | 992-3745 ms |
| 90 s outage, no rejoin (not the bar) | Never recovers | SDK gives up at its 60 s deadline |

**What a real session must add:** the SDK ends with `Disconnected` after 60 s, so the rejoin loop
in `rigs/reconnect` belongs in `semaphore-media-livekit`.

**Adaptive stream, read from the source, not tested (audio only):** `RoomOptions.adaptive_stream`
only sets a signalling flag. Nothing tracks what's visible: the app must call `set_enabled` and
`update_video_dimensions` itself, and again after a full reconnect, when publications are new.

### T8: pass

| Run (Rust and socket.io-client together) | Lost, Rust / ref | Duplicates, holes, losses outside the gap, payload mismatches | load1 |
|---|---|---|---|
| 1,000 cycles, 100 ms reconnect base | 1494 / 1555 of 5155 | 0 | 3.0-34.5 |
| 100 cycles, the web's 1 s base, up 2-4 s | 1291 / 1366 of 6532 | 0 | 12.4-32.0 |
| 200 cycles, reference cut first | 285 / 313 of 1039 | 0 | 11.8-40.6 |

Auth 6/6 on both clients: acks on every acked event, refresh and reauthenticate at the real 120 s
margin, expiry then refresh then reconnect, expired token at connect, logout. Suspend, freeze and
stall 5/5.

**The bars cover `newMessage`.** "Beyond web-client behaviour" was fixed before the first full run
as: no duplicates or holes beyond the reference, every loss inside the client's own disconnect gap,
and gap losses within 20% plus 10 messages of the reference. The backend ran with
`WS_CONNECTION_RATE_LIMIT` raised: the default of 10 per minute per address would refuse most of
1,000 reconnects from any client.

**Presence:** totals can't be compared between clients. The server broadcasts only on an
offline-to-online change, to whoever is connected at that moment, so totals record who won a race
(618+8 against 810 before the fix, 485+22 against 450+8 after). The valid test is whether a client
connected at the moment of a broadcast missed it: 0 missed in every run
(`results/t8/presence.json`).

**A real latency bug, found and fixed:** the Rust client had Nagle on, so `presenceOnline` waited on
a delayed ack after `subscribeAll`. Time from connect to own `userOnline`, for the first client to
connect:

| Build | Rust p50 / p90 | Ref p50 / p90 | load1 |
|---|---|---|---|
| Before, 1,000 cycles | 21 / 44 ms | 2 / 18 ms | 18-60 |
| `TCP_NODELAY` off only, 200 cycles | 15 / 41 ms | 2 / 7 ms | 4-15 |
| On, 200 cycles, same seed | 6 / 27 ms | 4 / 35 ms | 12-41 |
| On, 1,000 cycles | 3 / 13 ms | 3 / 14 ms | 3-35 |
| On, its first 200 cycles, the quiet part | 2 / 6 ms | 2 / 6 ms | 3-4 |

**What a resync can and can't recover.** The server has no sequence numbers, so nothing says what
was missed; the client refetches everything it holds. Measured against a witness that stayed
connected:

- **Recovered by REST:** new messages, edits, deletes and reactions, if they fall inside the pages
  refetched. One early rig run had a gap's messages pushed out of a 100-message page, so a refetch
  must follow `continuationToken` until it reaches what it already has.
- **Gone:** typing, and presence changes, unless presence is refetched separately. The rig tested
  channel messages only: DMs, threads, notifications, roles and voice presence need the same check.
- **`POST /api/messages` emits no `newMessage`:** only the gateway fans out.

**A frozen process keeps its socket** if it thaws before the server's 85 s limit. `resume()` used to
replace that socket and lost a buffered message. It now asks first with an acked `presenceOnline`,
and `freeze-short-resume` misses nothing.

**Deliberate difference:** `emit` while disconnected returns an error. socket.io-client buffers and
sends later.

**Not tested:** TLS, real OS suspend (`docker pause` stands in, and it keeps the monotonic clock
running), and a backend or Redis restart.

**Not run for this work:** `verify.sh`'s full workspace and GPUI build, held back because a priority
job had the machine. The crates this work touches passed the same checks individually.

## Facts checked in Phase 0

These were from memory or unknown in the design.

### `lk room join --publish`: real, with a limit

`lk` 2.18.8 accepts `.h264`, `.ivf` and `.ogg` files, and `<codec>://` sockets for h264, h265,
vp8 and opus. **Simulcast is h264 and h265 only**, so it can't reproduce the web client's VP8
simulcast publish. For load this doesn't change what a viewer decodes: the SFU forwards one
layer per viewer, so a single VP8 layer at the top layer's bitrate is equivalent on the
receiving side.

### What the web client sends

From `frontend/src` and `docs-site/docs/architecture/voice-video-quality.md`.

| Stream | Codec | Layers | Size and rate | Max bitrate |
|---|---|---|---|---|
| Camera | VP8 (LiveKit default) | Simulcast (default) | 1280x720, 30 fps | 1.7 Mbps (`VideoPresets.h720` in livekit-client 2.22.3) |
| Screen share | VP8 | Simulcast | 1080p60 by default in a browser | About 9 Mbps top layer |
| Mic | Opus | n/a | n/a | 96 kbps default, DTX and RED on |

Viewers use adaptive stream and dynacast. T1's 9x720p full-layer case is therefore the worst
case: real tiles usually get a lower layer.

**Mismatch to settle:** the baseline's `d_video_grid` uses a screen share of **1080p30 at
4 Mbps**, while T1 and the web client's default are **1080p60 at about 9 Mbps**. Until one
moves, Electron's and native's video numbers are not like for like, and the native side would
be carrying about twice the frame rate and bitrate.

### UDP ports T1 needs: about 80, so 200 to be safe

Measured with 10 publishers and 1 subscriber, using `lk` (the Go SDK) against
`livekit-server` v1.13.7 on `semaphore-test`:

| ICE range | Connected | UDP ports in use | Port errors in the server log |
|---|---|---|---|
| 200 ports | 11 of 11 | 80 at peak, 74 settled | 0 |
| 20 ports | **3 of 11** | 20 (exhausted) | **0** |

Each peer holds about 8 ports while connecting and about 6 afterwards. That's far above the 2
per peer the design assumed, and I didn't investigate why. The Rust SDK may differ, so T1
should re-measure with its real client.

**Exhaustion is silent:** the 4th peer onward simply never connects, and the server logs
nothing about ports. A rig that sees missing participants should check the range first.

- `scripts/lk-stack.sh` defaults to 200 ports, the same size the baseline harness uses.
- `docker-compose.voice-e2e.yml` and its host overlay stay at 20 ports. That's fine for their
  own 2-3 browsers, but they can't host T1 or T7 with more than 3 of these peers.
- A binary on the host reaches the server's `semaphore-test` address directly, with no port
  mapping, so host rigs need no published ports.

## Supply chain

### `gpui-pre` has one owner

- **What it is:** 22 `gpui-pre*` crates, plus `gpui-kit` and its siblings. They're how GPUI
  reaches us: `gpui-kit` pins them exactly, and Zed's own `gpui` on crates.io stopped at 0.2.2.
- **Who controls it:** one crates.io account, `huacnlee`, owns both `gpui-pre` and `gpui-kit`
  (checked `gpui-pre`, `gpui-pre-platform`, `gpui-kit`). Anyone with that token can publish.
- **What it isn't:** a fork, by its own policy. gpui-kit's `CONTRIBUTING.md` says snapshots
  must not carry behavioural patches. Each manifest records its source: 0.3.11 says
  `zed-rev = f816e1f9263e3a8ef63c4baaa02e1441ce1c6038`. **Nobody has checked that claim** by
  diffing a snapshot against that Zed commit.
- **Protection today:** the exact pin and `Cargo.lock`'s checksums stop a new publish reaching
  us unless we choose to bump. crates.io keeps yanked versions available to existing lockfiles.
- **Exposure:** every bump is unreviewed third-party code, the bump itself is on someone else's
  schedule, and if the account goes quiet, snapshots stop.

### What vendoring or mirroring would take, at the go decision

| Option | Cost | Buys |
|---|---|---|
| Diff each bump against its `zed-rev` | A small script, then one review per bump | Proof that the snapshot is what it claims; a check worth having whichever option is chosen |
| `cargo vendor` everything | **1.5 GB, 926 crates** (measured; `windows` alone is 120 MB per version). Too big for this repo's history | Builds survive any registry problem; every change shows up as a diff |
| `cargo vendor` to an internal mirror, in a separate repo or as a CI artifact | That size outside the repo, plus a source-replacement config | The same, without bloating this repo |
| Fork only `gpui-pre*` under `semaphore-chat`, via `[patch.crates-io]` | **Under 35 MB for those crates**, plus a rebase on each upstream move | Needed anyway if T1 forces the NV12 patch. Ends reliance on the publisher, not on Zed's API churn |
| Build directly from Zed git | Would need gpui-kit to allow it: its releases pin `gpui-pre`, so we'd be patching it | Cuts out a middleman but takes on gpui-kit compatibility ourselves |

**Recommendation for the go decision:** the diff check from day one, then the `gpui-pre*` fork
only if T1 needs a patch or the snapshots stall. Keep a vendored mirror for release builds.

### Other items for the same review

- **libwebrtc is not in `Cargo.lock`.** `webrtc-sys` downloads a prebuilt zip (`webrtc-a545de4`)
  from LiveKit's GitHub releases at build time, so no crate checksum covers it, `cargo vendor`
  doesn't capture it, and `cargo-deny` can't see its licenses. Mirror it and pin its hash with
  `LK_CUSTOM_WEBRTC`.
- **Seven unmaintained crates** are ignored by ID in `deny.toml`, none with a known
  vulnerability and all with no safe upgrade: `instant`, `paste`, `ttf-parser`, `rustybuzz`,
  `zvariant`, `zbus_names`, `zvariant_derive`. `rustybuzz` and `ttf-parser` matter most: they
  parse untrusted fonts and shape every line of text.

## Phase 0 verification

`native/scripts/verify.sh` on commit `e30204d8`, in image `semaphore-native-build:2bc850bf4d1c`
(clang 23.1.4, rustc 1.99.1, Mesa 26.2.6, cargo-deny 0.20.2). All 14 steps exited 0.

| Step | Result |
|---|---|
| `cargo build --workspace` | Pass |
| `cargo test -p semaphore-core` | 13 passed |
| `cargo fmt --check`, `cargo clippy -D warnings` | Pass |
| `cargo deny check` | advisories, bans, licenses, sources ok (7 advisories ignored by ID, listed above) |
| Core boundary | 18 dependencies, none UI, desktop-only or C-building |
| Guards reject bad input | Rejected a GPL dependency, `ring`, a UI crate, a media crate and an invalid result; accepted our AGPL crate |
| Core `cargo check` on Android and iOS | Pass, with no NDK or Xcode in the image |
| T10 screenshot on lavapipe | `results/phase0/shots/shell-connected.png`, looked at by eye |
| Release binary joins a real LiveKit room | Connected and left; the server log shows the session |
| Result JSON | `results/phase0/native-shell.json` validates against `semaphore-native-baseline-result-v1` (schema file sha256 `494befa287c0fe42...`, from the baseline agent's uncommitted worktree) |

**T10 early numbers, which are not T10's verdict:** identical PNG hash in separate processes
and across container runs. Three edit-rebuild-render loops took 12.0 s, 6.5 s and 6.1 s on this
32-thread host, with only a `touch` as the edit. The bar is under 60 s, and the 20-run test is
Phase 1 work.

**Shell numbers, for shape only:** 66.2 MB stripped, PSS 158 MB, RSS 168 MB, anon 58 MB, about
1% of a core, under Xvfb on lavapipe. The run is marked `provisional` because other agents had
load1 at 53 on this machine. Don't quote these as client numbers.

**Not run, because the branch isn't pushed:** every job in
`.github/workflows/native-spike.yml`.

- The `windows-link` job has never run. libwebrtc plus GPUI on MSVC remains unproven.
- The `core-mobile` job runs outside the image, on a stock runner. Its commands passed in the
  image only, so that form is unproven too.
- The `checks` job's two result steps will fail until `result.schema.json` reaches this branch.

## Known limits of Phase 0

- The probe connects to a room but publishes and subscribes to nothing: it proves libwebrtc
  links and signalling and ICE work, not media flow.
- `semaphore-core` is a stub of the right shape: 13 tests cover its cache and lifecycle, and
  nothing real calls it yet.
- The core mobile check proves core alone. `semaphore-net` and `semaphore-media-livekit` still
  need an NDK image and a macOS runner, and neither has been tried with those installed.
- `cargo-deny` sees crate metadata only. It doesn't read licenses of fonts or binaries a crate
  ships, or anything downloaded at build time.
- `native-shell.json` checks the format, not the client: it's a placeholder window under Xvfb
  on lavapipe, and its scenario is deliberately not named like the baseline's.
- The T10 screenshot renders at 2x (1600x960 for an 800x480 window). That's what GPUI's
  headless renderer reports; stories must fix their size with this in mind.
