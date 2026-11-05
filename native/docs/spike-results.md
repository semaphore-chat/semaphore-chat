# Native spike results

Updated at each phase. No go/no-go verdict exists yet.

## Decision rule

Accepted from the design, with the T5 and T9/T10 decisions above folded in:

- **Go:** T1-T8 and T11 pass, T5 at the bar in the table below. T9 and T10 must also pass for a
  clean go.
- **Re-decide with Mike:** T9 or T10 fails. Neither stops the project automatically, but either
  forces a new decision and a revised estimate.
- **Patch:** only T1 fails, profiling blames conversion or upload, and Iced's shader arm uses at
  least 30% less CPU or holds 60 fps. Budget: 3 agent-days.
- **Switch to Iced:** the patch misses, or GPUI-caused Hyprland freezes persist. Iced must first
  pass T2-T5.
- **Neither:** T7, T8 or T11 failures question Rust itself and go to Mike.

## Status

Phase 1 was launched from this branch after Phase 0. Results land here as those branches report.

| Test | Status |
|---|---|
| T1 video | Investigated separately by two agents, outside this workspace, for now |
| T2, T3 | Phase 1, on `spike/t2-t3` |
| T7, T8 | Phase 1, on `spike/t7-t8` |
| T10 agent loop | Harness works; the 20-run test is Phase 1, on `spike/t10-runner` |
| `gpui-pre` audit | Phase 1, on `spike/gpui-audit` |
| T4-T6, T9, T11 | Not started |
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
| T5 | No explicit pass bar | New messages announced, composer editable, no panic over 1 hour (the research report's bar) | **Decided** | Replaces the design's weaker "navigable without panic", which is not enough |
| T7 | Everyone audible | Same, measured by per-publisher tone detection | Defined | None |
| T8 | 1,000 disconnects | Same, plus a suspend/resume case | **Added** | Stricter |
| T9 | Under half a day each | Under 4 agent hours, tokens recorded | Defined | A human half-day doesn't map onto agents |
| T9 | 4 consecutive releases | 3 replayed (0.8.0, 0.8.1, 0.9.0, from a port down to 0.7.3) plus the next live one | **Changed** | Replayed bumps were already fixed upstream, so less pressure than a surprise |
| T9 | (Research report also required gpui-agent patches to re-apply) | Not in the brief; dropped unless gpui-agent is adopted | **Changed** | Weaker, if adopted later |
| T9, T10 | Pass/fail like the others | Not automatic stops, but a failure of either forces a re-decision with Mike and a revised estimate. A clean go still requires both to pass | **Decided** | Replaces the design's "raises the estimate only". The plan relies on agents doing the bulk of the work and on staying current with weekly kit releases |
| T1 patch path | "Patch the renderer" | Only if T1 alone fails, profiling blames conversion or upload, Iced's shader arm uses at least 30% less CPU or holds 60 fps; budget 3 agent-days | **Added** | New gate |
| Switch to Iced | "Move to Iced" | Iced must first pass T2-T5 | **Added** | Stricter |

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

**Decided:** the baseline's `d_video_grid` screen share changes from 1080p30 at 4 Mbps to
**1080p60 at about 9 Mbps**, matching T1 and the web client's default. The coordinator is telling
the baseline agent. Any Electron video result from before that change isn't comparable with native.

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
