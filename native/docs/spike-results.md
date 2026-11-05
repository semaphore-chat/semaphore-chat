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
| T2 message list | **Provisional.** Fling timing needs the real desktop. No-jump and memory pass, each with a stated condition |
| T3 selection | **Pass with a prototype, fail with the kit's selection** in a message list |
| T7, T8 | Phase 1, on `spike/t7-t8`, not reported yet |
| T10 agent loop | Harness passes on a one-screen crate (`results/t10.json`, provisional: load peaked at 107). Rerun on the slice's real UI crate is U14 |
| `gpui-pre` audit | **Reviewed:** no behavioural change found. See "Supply chain" |
| T4-T6, T9, T11 | Not started, or reported separately |
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
  `zed-rev = f816e1f9263e3a8ef63c4baaa02e1441ce1c6038`. That claim is now checked: see the audit
  verdict below.
- **Protection today:** the exact pin and `Cargo.lock`'s checksums stop a new publish reaching
  us unless we choose to bump. crates.io keeps yanked versions available to existing lockfiles.
- **Exposure:** every bump is unreviewed third-party code, the bump itself is on someone else's
  schedule, and if the account goes quiet, snapshots stop.

### Audit verdict: `gpui-pre` 0.3.11 against Zed

**Accept.** None of the 14 unexpected differences changes runtime behaviour beyond what its comment
says, and none adds network, process or file access to anything we ship. Raw data:
`results/gpui-pre-audit.md`, `results/gpui-pre-reqwest-audit.md`.

| Diff | Files | What it is | Verdict |
|---|---|---|---|
| `gpui-pre` | `src/action.rs` | The `actions!` derive says `$crate::Action` instead of `gpui::Action` | Harmless |
| `gpui-pre-apple` | `build.rs` | Reads gpui's sources from `vendor/gpui`, not `../gpui` | Harmless. macOS and iOS only: `cargo tree` finds no path to this crate from the app on Linux or Windows |
| `gpui-pre-apple` | 5 files under `vendor/gpui/src` | Copies for that build script. The audit's network, process and unsafe flags are keyword hits in gpui's own code | Harmless. Byte-identical to Zed per the audit; I also `cmp`'d each against `gpui-pre`'s own file |
| `gpui-pre-macros` | `Cargo.toml` | Adds `proc-macro-crate` 3.5.0 | **Note 1** |
| `gpui-pre-macros` | `src/gpui_macros.rs` | Wraps all 19 macro entry points in `rewrite()`. Lines are only added; existing bodies move, unchanged, into inner functions | Harmless |
| `gpui-pre-macros` | `src/gpui_pre_facade_paths.rs` | The rewriter: `gpui::` and `gpui_platform::` become `gpui_kit::` and `gpui_kit::platform::` | **Note 2** |
| `gpui-pre-reqwest` | Whole crate, no Zed commit claimed | Every source file is byte-identical to `zed-industries/reqwest@68a26f46`. That fork adds one thing to reqwest: a per-request redirect policy, +96/-6 lines, with no TLS, proxy or unsafe changes | Harmless. **Note 3** |
| `gpui-pre-wgpu` | `wgpu_atlas.rs`, `wgpu_context.rs`, `wgpu_renderer.rs` | Adapts to crates.io wgpu 30.0.1: drops `default_queue`, `has_srgb_suffix()` becomes `is_srgb()` | Harmless. **Note 4** |

**The macro rewriter (I read all 87 lines).** It maps tokens, recursing into groups, and adds only
`crate`, `platform` and the name Cargo reports for `gpui-kit`, which comes from our own manifest. It
has no file, network or process calls of its own, and generated code gets nothing beyond the renamed
paths. It's cruder than it needs to be, and neither flaw affects the shipped client:

- **It checks only what follows an identifier.** `foo::gpui::bar` would become `foo::gpui_kit::bar`.
- **It rewrites string literals containing `::gpui::`, in anything a macro re-emits.** Only
  attribute macros re-emit caller code, so a literal in a `#[gpui::test]` body would change silently.
  Don't test GPUI paths through string literals.

**Notes**

1. **`proc-macro-crate` spawns a process at compile time.** `workspace_manifest_path` runs
   `$CARGO locate-project`. Our build already runs Cargo, and nothing of this reaches the binary.
2. **The rewriter can't make a macro leave gpui's own paths.** A crate that doesn't depend on `gpui-kit`
   keeps `gpui::` unchanged, which is why the T1 rig, on bare `gpui-pre`, still built.
3. **`cargo deny` is blind to this crate.** An advisory filed against `reqwest` won't match the name
   `gpui-pre-reqwest`, and the fork doesn't track upstream fixes. It isn't linked into `semaphore-app`
   on Linux or Windows; workspace builds reach it through `gpui-kit-assets`. Check this on each bump.
4. **We don't run the wgpu Zed runs.** Zed's source at this commit targets a different wgpu API, so
   Zed's own testing says less about this renderer than the name suggests (my inference; I didn't
   inspect Zed's wgpu pin).

**What this doesn't establish.**

- It shows the snapshot matches Zed, not that Zed's code is safe.
- The byte comparison is the audit script's. I read its output and spot-checked locally, but didn't
  rerun it against Zed.
- **Crates outside the audit, still unreviewed:** `gpui-kit`, `gpui-component`, `gpui-base` and
  `gpui-kit-assets` (the same publisher), and `zed-font-kit` and `zed-xim` (Linux). All of them
  link into the app. Extend the audit to them at the go decision.

Vendoring removes the two patched crates' checksums from `Cargo.lock`, so `third_party/series`
carries them, and `audit-gpui-pre.sh` needs the unpatched lock (see `third_party/README.md`).

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

## T2 and T3: message list and selection

Rig: `rigs/list`. Raw results: `results/t2.json`, `results/t3.json`. Bars unchanged.

### T2: 100k mixed-height messages

Three 50 s runs on an RTX 4090 under headless sway. Each run flings up through unmeasured rows for
30 s, flings down for 10 s, then jumps to the middle and flings up for 10 s.

| Bar | Measured | Status |
|---|---|---|
| Presented frame p99 at or under 16.7 ms | Median of runs 19.5-19.9 ms by phase, worst 22.5 ms. Mean 61.8 fps | **Provisional**: load1 peaked at 25-40, timer-driven compositor |
| No jump on prepend | 0.0 px: 5,000 rows mid-history, 50 at the top row, and during a live scroll (931 row-frames) | **Pass**, final |
| No jump on late image load | 0.0 px with the size known up front; **360 px** when an image in view has no known size | **Pass only with known sizes**: `File` has no width or height today |
| Under 500 MB | **Bounded cache alone: 642 MB** PSS plus swap in a 120 s soak. With `MALLOC_MMAP_THRESHOLD_=262144` too: **370 MB** | **Pass only with both**, final |

- **Timing:** an interval between present-call returns is about 16.1 ms plus the change in CPU
  cost since the previous frame, so cost jitter alone raises p99. Few intervals pass 1.5 vsyncs:
  0-10 per phase, out of 615-1,854 frames. CPU cost p99 is 5-9 ms, and images don't change it
  (19.7 ms p99 and 7 ms cost without them). The kit's TextView arm, with frames under 1 ms, gets
  16.4 ms in the same setup, so the harness can meet the bar. Whether real rows can meet it at
  this measuring point is open. T1 measures the same point.
- **Memory:** the cache held 126 MB and evicted 127 images in both soaks, so it works; glibc keeps
  the freed decodes in its arenas. The host swapped during both soaks, which first looked like
  the app releasing 400 MB, so samples now include swap.
- **Not covered:** CJK and colour-emoji fallback (DejaVu only), thumbnails (full-size decodes),
  hover toolbars and reactions, Windows.
- **Other numbers:** 4 pinned cores p99 19.8-23.9 ms. Lavapipe p99 24-25 ms, 964% of a core, 587 MB,
  for shape only. Still list 0.8% of a core; 6-15% with an animated emoji in view, because the
  whole window redraws at 60 fps for 12.5 fps of animation.

**Needs Mike's Hyprland desktop.** The window has to stay visible for about 50 s, three times:

```bash
native/scripts/in-image.sh cargo build --release -p rig-list
docker run --rm -v semaphore-native-target-$(printf '%s' "$PWD" | sha256sum | cut -c1-8):/t:ro alpine cat /t/release/rig-list > /tmp/rig-list
chmod +x /tmp/rig-list
for i in 1 2 3; do MALLOC_MMAP_THRESHOLD_=262144 /tmp/rig-list fling --out /tmp/t2-run$i.json; done
```

Run it from the checkout root, so the volume hash matches.

### T3: selection across virtual rows

| Arm | Copy across rows | Unmount and back | Verdict |
|---|---|---|---|
| A: `SelectableText` per row, as `examples/text_selection` does with TextView | Only while the anchor is on screen | **Selection cleared**, including at the tick the anchor scrolls off | Fail. `endpoint_departed` in `text_selection.rs` clears it by design |
| B: one `TextView::scrollable` document | Exact order, 283 messages, emoji included | Survives | Selection works, but it isn't a message list: **2.2 GB** at 100k with no images, and a prepend via `set_text` clears the selection and resets the scroll to the top |
| C: prototype, endpoints are a message id and a byte | **Byte-exact**: 398 messages over 66 screens, 195,857 bytes, up, down and past the anchor | Survives, highlight returns, survives a prepend | **Pass**, final |

Arm C is about 400 lines: `selection.rs` and the row and drag parts of `view.rs`. Inline emoji copy as
`:name:` (349 in that selection) and links as their text (283). A click opens a link and a drag
from one selects. A real window gives the same result with real shaping: 146 messages, 65,057
bytes, identical on Wayland with the GPU and X11 with lavapipe. Clipboard: exact on X11. Under
headless sway it came back empty because there is no seat, so **the Wayland clipboard still needs
the real desktop**.

**Not in the prototype:** word and line multi-click, select-all, keyboard extension, accessibility,
RTL, and sharing a selection with kit `TextView`s elsewhere in the window.

### Kit gaps

| Gap | Size |
|---|---|
| Selection across virtual rows: arm C plus what it lacks | 4-6 agent-days |
| Image width and height: schema, upload probe, backfill, API, client | About 1 agent-day |
| Scrollbar has no height hints, [#3513](https://github.com/longbridge/gpui-kit/issues/3513): the thumb sits near the top at row 50,000 of 100,000 | 1-2 agent-days |
| `MessageScroller` keeps its `ListState` private, so a drag can't `scroll_by` | A small upstream PR, or about 180 Apache-2.0 lines to copy |
| Bounded image cache and `mallopt` at startup | Half a day; the cache is 80 lines here |
| Animated emoji redraw the window at 60 fps | Half a day to schedule by frame delay |

Other open kit issues that apply: [#3798](https://github.com/longbridge/gpui-kit/issues/3798) (highlight
past short rows, and the prototype paints the same way), [#3669](https://github.com/longbridge/gpui-kit/issues/3669)
(selection geometry is private), [#3476](https://github.com/longbridge/gpui-kit/issues/3476) (a drag on an
overlay selects text beneath; a hover toolbar needs handling) and
[#3295](https://github.com/longbridge/gpui-kit/issues/3295) (`reveal_range` can panic in a virtual TextView,
arm B only). These come from reading the tracker, not from reproducing them.

### Working on it

The first render looked right. A release rebuild takes 15-20 s, and the build, run and screenshot
loop under a minute. The kit's tests were the best documentation. Friction: `use gpui_kit::*`
imports the `test` attribute, so `#[gpui_kit::test]` hits the recursion limit until `#[test]` is
imported explicitly. Three harness mistakes cost the most time, and each looked like a result:
GPUI's inactive-window limit (about 30 fps, because headless sway has no seat), a warmup that waited
for frames a still window never draws, and swap read as a memory release.

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
