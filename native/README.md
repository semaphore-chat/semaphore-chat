# Native client spike

Go/no-go spike for a Rust desktop client on GPUI and gpui-kit, with no webview. It lives on
the long-lived `spike/native-gpui` branch. Status, test bars and decisions are in
[docs/spike-results.md](docs/spike-results.md).

## Layout

| Path | What | May depend on |
|---|---|---|
| `crates/semaphore-wire` | Generated types from `contract/` | Pure Rust only |
| `crates/semaphore-core` | Query cache, message store, lifecycle, view models, OS-service traits | wire; pure Rust only, no C build |
| `crates/semaphore-api` | Generated REST client, hand-written upload | wire, reqwest with no TLS |
| `crates/semaphore-net` | HTTP, WebSocket, TLS; implements core's `Backend` and `Realtime` | core, api |
| `crates/semaphore-media-livekit` | Core's `MediaEngine` on LiveKit; `VideoSink` | core |
| `crates/semaphore-platform-desktop` | Desktop OS services | core |
| `crates/semaphore-design` | Generated tokens and icons | Nothing |
| `crates/semaphore-ui` | GPUI views, one directory per feature | core, design, gpui-kit |
| `crates/semaphore-app` | The desktop binary | all of the above |
| `crates/semaphore-fake-server` | Dev only: a fake backend. The app never links it | wire |
| `crates/semaphore-ffi` | Dev only: proves core stays UniFFI-friendly | core |
| `contract/` | The pinned API contract generators read. `PIN` says where it came from | |
| `third_party/` | GPUI with the video surface patch. See its README | |
| `tools/`, `fixtures/` | Generators and exporters, not in the workspace; their committed output | |
| `rigs/shot` | Render a story to a PNG with no display | core, ui |
| `rigs/list` | T2/T3: 100k message list and selection | gpui-kit |
| `rigs/reconnect` | T7: voice participants judged by tone, and the fault driver | livekit |
| `rigs/sio` | T8: the Socket.IO session against socket.io-client | core, net |
| `rigs/video` | T1: the GPUI video rig. Excluded from the workspace, own lockfile, rig-only telemetry patch | third_party |
| `rigs/video-iced` (not created yet) | Excluded from the workspace, with its own lockfile | |

The slice's work units and their specs are in [docs/slice-units](docs/slice-units/README.md).

## Rules

- **Build in Docker.** `scripts/in-image.sh <command>` runs anything in the pinned image, on
  `semaphore-test`. It creates no network. Each checkout gets its own target volume, so
  parallel worktrees don't block each other.
- **Run on the host only for tests that need a real compositor.** The image shares CachyOS's
  ABI, so a binary built there runs directly on the host. Rig results that come from a
  container say so in their JSON.
- **Nothing UI or C-building reaches core.** `scripts/check-core-boundary.py` enforces it, and
  `cargo check -p semaphore-core` on `aarch64-linux-android` and `aarch64-apple-ios` backs it
  up with no NDK or Xcode.
- **No GPL in anything we ship.** `deny.toml` allows licenses by name; our own crates are the
  only AGPL allowed, each listed. A new crate needs a line there. Zed's `livekit_client`, `ui`,
  `markdown`, `audio` and similar crates are GPL-3.0: reference only, never copied.
- **Never add Zed's git `gpui`.** gpui-kit pins `gpui-pre`, and a second GPUI won't unify. Our
  renderer patch goes through `[patch.crates-io]`, from `third_party/`.
- **Generators read `contract/`, not `backend/`.** Update it with `scripts/pin-contract.sh <ref>`.
- **Test bars don't move silently.** Any change goes in the table in `docs/spike-results.md`.

## Commands

```bash
native/scripts/verify.sh                                  # everything Phase 0 promises
native/scripts/in-image.sh cargo build --workspace
native/scripts/in-image.sh scripts/shot.sh shell-connected 800 480 results/shots
native/scripts/lk-stack.sh up                             # LiveKit on semaphore-test, prints its URL
native/scripts/lk-stack.sh down
native/scripts/in-image.sh cargo test -p rig-list         # T3 arms, in-process
native/scripts/in-image.sh cargo build --release -p rig-list
native/scripts/run-list.sh gpu /tmp/out fling             # T2 in a real window on headless sway
native/scripts/run-list.sh gpu /tmp/out jump
native/scripts/run-list.sh lavapipe /tmp/out select
```

Real-desktop runs for T1, T2, T3 and the Electron baseline: [scripts/desk](scripts/desk/README.md).

`cargo build --workspace` turns on gpui-kit's `test-support` for every crate, because `rig-shot`
needs it. For size or performance numbers, build with `-p semaphore-app` in release mode.

`verify.sh` reads the result schema from `scripts/native-baseline/result.schema.json`, or from
`RESULT_SCHEMA_HOST` until that file reaches this branch.

Named volumes to clean up after the spike: `semaphore-native-cargo` and
`semaphore-native-target-*`, `semaphore-native-list-images`.
