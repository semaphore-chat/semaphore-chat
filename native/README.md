# Native client spike

Go/no-go spike for a Rust desktop client on GPUI and gpui-kit, with no webview. It lives on
the long-lived `spike/native-gpui` branch. Status, test bars and decisions are in
[docs/spike-results.md](docs/spike-results.md).

## Layout

| Path | What | May depend on |
|---|---|---|
| `crates/semaphore-core` | Query cache, lifecycle, OS-service traits | Pure Rust only, no C build |
| `crates/semaphore-net` | HTTP, WebSocket, TLS | core |
| `crates/semaphore-media-livekit` | Core's `MediaEngine` on LiveKit | core |
| `crates/semaphore-platform-desktop` | Desktop OS services | core |
| `crates/semaphore-ui` | GPUI views | core, gpui-kit |
| `crates/semaphore-app` | The desktop binary | all of the above |
| `rigs/shot` | T10: render a story to a PNG with no display | core, ui |
| `rigs/reconnect` | T7: voice participants judged by tone, and the fault driver | livekit |
| `rigs/sio` | T8: the Socket.IO session against socket.io-client | core, net |
| `rigs/video-iced` (not created yet) | Excluded from the workspace, with its own lockfile | |

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
- **Never add Zed's git `gpui`.** gpui-kit pins `gpui-pre`, and a second GPUI won't unify. A
  renderer fork goes through `[patch.crates-io]`.
- **Test bars don't move silently.** Any change goes in the table in `docs/spike-results.md`.

## Commands

```bash
native/scripts/verify.sh                                  # everything Phase 0 promises
native/scripts/in-image.sh cargo build --workspace
native/scripts/in-image.sh scripts/shot.sh shell-connected 800 480 results/shots
native/scripts/lk-stack.sh up                             # LiveKit on semaphore-test, prints its URL
native/scripts/lk-stack.sh down
```

`cargo build --workspace` turns on gpui-kit's `test-support` for every crate, because `rig-shot`
needs it. For size or performance numbers, build with `-p semaphore-app` in release mode.

`verify.sh` reads the result schema from `scripts/native-baseline/result.schema.json`, or from
`RESULT_SCHEMA_HOST` until that file reaches this branch.

Named volumes to clean up after the spike: `semaphore-native-cargo` and
`semaphore-native-target-*`.
