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
| U7 net | `semaphore-net`, `semaphore-platform-desktop` | U1, U5, `spike/t7-t8` | sonnet-medium | U8-U12 |
| U8 shell | `ui/src/{theme,kit,shell,auth,nav}`, `rigs/shot` steps | U2, U3 | **opus-medium** | U5, U6, U7, U9-U12 |
| U9 messages | `ui/src/messages` | U3 | **opus-high** | U5, U6, U7, U8, U10-U12 |
| U10 composer | `ui/src/composer` | U3 | **opus-medium** | U5, U6, U7, U8, U9, U11, U12 |
| U11 voice | `semaphore-media-livekit`, `ui/src/voice` | U0; final patch from the video agent | **opus-high** | U5-U10, U12 |
| U12 image dimensions | `backend/` on the API-contract stack | That stack landing | sonnet-medium | Everything |
| U13 app | `semaphore-app`, `scripts/slice-e2e.sh` | All | **opus-medium** | Nothing |
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

- **The pinned contract lacks the auth contract.** `security/release` isn't an ancestor of the pin,
  so `X-Client-Type` isn't in `contract/openapi.json`. U7 sends it by hand. Real-backend flows need
  a backend with both, which is `security/release` plus the API-contract stack.
- **U5 must keep `scripts/test-policy.sh` working when core gains `semaphore-wire`:** its fixture
  copies core alone and has its own `[workspace.dependencies]`. Keep `[dependencies]` last in core's
  `Cargo.toml` too, because that script appends to the file.
- **`spike/t7-t8` is not merged.** Expect conflicts in `Cargo.toml`, `Cargo.lock`, `deny.toml`, and
  in `core/src/lib.rs` and `net/src/lib.rs`. `RealtimeEvent` mirrors its `SocketEvent`, and
  `semaphore-net` adapts it to `Realtime`.
- **Windows now has a surface path:** `Window::video_uploader()` returns `Some` there too, through the
  vendored D3D11 patch, so tiles take the same path on both. It has compiled but never run on Windows
  (the CI job waits on a push). `third_party/README.md` has the API. U11 removes the fallback comment
  in `ui/src/voice/mod.rs`.

## The ledger

Every unit records this in `results/slice/ledger.jsonl`, one line when it finishes: unit, tier, wall
minutes, tokens, look/fix iterations, lines added, and rework after review. It's how the slice
answers the question of real agent productivity.
