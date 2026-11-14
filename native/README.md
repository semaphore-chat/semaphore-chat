# Semaphore native client

The desktop client for Semaphore Chat, written in Rust with no webview. It is being built to
full parity with the Electron app, which keeps shipping until this one can replace it. Linux and
Windows are the targets today; the core is kept free of UI and desktop code so that Android and
iOS apps can reuse it later. The web client stays TypeScript and React.

Why: a much smaller download and lower memory and CPU use than Electron, above all in calls.

## Status

Work is planned in waves in [docs/parity-plan.md](docs/parity-plan.md), which lists every
feature of the Electron app and where its native counterpart stands.

| Wave | What | State |
|---|---|---|
| 0 | Foundations: sign-in, session restore, shell, settings store | on `main` |
| 1 | Text: messages, threads, pins, search, attachments, emoji, reactions | on `main` |
| 2 | DMs, friends, notifications, tray, deep links, single instance | on `main` |
| 3 | Profile, settings, registration, password reset, browser sign-in, in-app audio and video player | on `main` |
| 4 | Voice and video: channel and DM calls, soundboard, moderator actions, replay clips, mic test | on `main` |
| 5 | Community administration, roles and moderation | done (on `spike/native-gpui`) |
| 6 | Instance administration (first run stays on the web) | frozen, lanes not started |
| 7 | GIFs, thumbnails, link-preview images | frozen, lanes not started (link-preview images done in W3) |

Linux packages (AppImage, .deb and .rpm) are built by `scripts/package-linux.sh` and verified in
clean Debian, Ubuntu and Fedora containers by `scripts/test-packages.sh`. CI builds them, plus a
Windows portable zip, as artifacts only (`.github/workflows/native-package.yml`); nothing is
released or published, and there is no Windows installer yet. Alongside them the packaging script
writes `latest.json`, the manifest the app's updater reads (AppImage replaces itself, a `.deb` or
`.rpm` is downloaded for the user to install, a Windows build is told about the release). No feed
is published yet, so a shipped build checks nothing. See [docs/packaging.md](docs/packaging.md). Backend and web-client problems found along the way are
filed as GitHub issues and linked from the plan.

## How it is built

**Libraries first.** We write our own code only where no suitable library exists or its licence
rules it out.

| Need | What we use |
|---|---|
| UI framework | [GPUI](https://www.gpui.rs/), the GPU-rendered framework behind the Zed editor (published as `gpui-pre`) |
| Components | [gpui-kit](https://crates.io/crates/gpui-kit): buttons, inputs, selects, dialogs, menus, virtual lists and more |
| Voice and video | The LiveKit Rust SDK on libwebrtc, the same engine browsers use |
| Audio devices | `cpal` |
| HTTP, WebSocket, TLS | `reqwest`, `tokio-tungstenite`, `rustls` with the OS certificate store |
| Async runtime, JSON | `tokio`, `serde` |
| Token storage | `keyring` (Secret Service on Linux, Credential Manager on Windows) |
| Tray, notifications, sleep inhibit | `ksni`, `zbus`, the `windows` crates |
| Images | `image` |
| Media playback | The FFmpeg, libvpx, dav1d and Opus decoders already inside libwebrtc |
| Mobile bindings (later) | `uniffi` |

**Generated, not hand-written.** The REST client and wire types are generated from the backend's
OpenAPI contract, pinned in `contract/`. Design tokens and icons are generated from the web
client's sources, so both clients share one look; the emoji data is generated too.

**Written here**, because nothing fitting existed: the Socket.IO session on top of
`tokio-tungstenite`, the query cache and message store, and Semaphore's own screens.

**Our own component layer.** `crates/semaphore-ui/src/kit` wraps gpui-kit into the app's design
system (fields, controls, lists, overlays, typography). Feature screens are built from the kit
and never style raw widgets themselves. Every component and screen state has a story, rendered to
PNGs without a display, which is how UI changes are reviewed.

**Layers.** Each layer may only depend on the ones above it in this table:

| Crate | What | May depend on |
|---|---|---|
| `semaphore-wire` | Generated types from `contract/` | Pure Rust only |
| `semaphore-core` | All app logic: query cache, message store, calls, permissions, view models, and traits for OS services | wire; pure Rust only, no C build |
| `semaphore-api` | Generated REST client, hand-written upload | wire |
| `semaphore-net` | HTTP, WebSocket, TLS; implements core's backend and realtime traits | core, api |
| `semaphore-media-livekit` | Core's media engine on LiveKit | core |
| `semaphore-player` | Audio and video file playback (optional feature) | core, media |
| `semaphore-sysaudio` | System audio capture for screen sharing | media (optional) |
| `semaphore-platform-desktop` | Desktop OS services: keyring, tray, notifications, keep-awake | core |
| `semaphore-design` | Generated tokens and icons | Nothing |
| `semaphore-ui` | GPUI views, one directory per feature, plus the kit | core, design, gpui-kit |
| `semaphore-app` | The desktop binary: wires everything together | all of the above |
| `semaphore-fake-server` | Dev only: a fake backend for tests. The app never links it | wire |
| `semaphore-ffi` | Dev only: keeps core usable from Kotlin and Swift | core |

Screens hold no business logic. Core decides (who may do what, what a call's state is, when a
ring stops) and hands the UI plain view data; the UI sends commands back. That is what lets the
same core drive a mobile app, and what makes the logic testable without a window.

Other directories: `contract/` (the pinned API contract; `PIN` says where it came from),
`third_party/` (GPUI with our video surface patch; see its README), `tools/` and `fixtures/`
(generators and their committed output), `rigs/` (headless test drivers, below), `docs/`.

## How it is tested

- **Unit and wire tests.** Core is tested against a fake backend, and again through the real
  HTTP client and socket against `semaphore-fake-server`, which mirrors the real backend's
  responses and events.
- **Stories.** `rigs/shot` renders any story to a PNG with no display.
- **End to end.** `rigs/slice` drives the real app headlessly through scripted steps
  (`rigs/slice/scripts/*.steps`), twice, and compares the screenshots. `--voice` runs against a
  real LiveKit server; `slice-real.sh` runs against a real backend.
- **Reviews.** Token, concurrency and parser code gets an independent review before it merges.

`scripts/verify.sh` runs the build, tests, formatting, lints, licence policy, the core boundary
check and the Windows checks. CI runs it on Linux, links the app on Windows, and checks core
for Android and iOS.

## Rules

- **Build in Docker.** `scripts/in-image.sh <command>` runs anything in the pinned image, on
  `semaphore-test`. It creates no network. Each checkout gets its own target volume, so
  parallel worktrees don't block each other.
- **Run on the host only for tests that need a real compositor or real audio devices.** The
  image shares CachyOS's ABI, so a binary built there runs directly on the host.
- **Nothing UI or C-building reaches core.** `scripts/check-core-boundary.py` enforces it, and
  `cargo check -p semaphore-core` on `aarch64-linux-android` and `aarch64-apple-ios` backs it up.
- **No GPL in anything we ship.** `deny.toml` allows licences by name; our own crates are the
  only AGPL allowed, each listed. A new crate needs a line there. Zed's `livekit_client`, `ui`,
  `markdown`, `audio` and similar crates are GPL-3.0: reference only, never copied.
- **Never add Zed's git `gpui`.** gpui-kit pins `gpui-pre`, and a second GPUI won't unify. Our
  renderer patch goes through `[patch.crates-io]`, from `third_party/`.
- **Generators read `contract/`, not `backend/`.** Update it with `scripts/pin-contract.sh <ref>`.
- **Bugs found in the backend or web client get fixed or filed**, and linked from the plan.

## Commands

```bash
native/scripts/verify.sh                                  # the full local check
native/scripts/in-image.sh cargo build --workspace
native/scripts/in-image.sh cargo test --workspace
native/scripts/in-image.sh scripts/shot.sh shell-connected 800 480 results/shots   # one story
native/scripts/in-image.sh scripts/slice-e2e.sh           # end to end against the fake server
native/scripts/in-image.sh scripts/slice-e2e.sh --player  # with the in-app player
native/scripts/slice-e2e.sh --voice                       # against a real LiveKit server
native/scripts/slice-real.sh                              # against a real backend
native/scripts/lk-stack.sh up                             # LiveKit on semaphore-test, prints its URL
native/scripts/lk-stack.sh down
native/scripts/package-linux.sh                           # AppImage, .deb, .rpm -> dist-packages/
native/scripts/test-packages.sh                           # install and start them in clean containers
```

Real-desktop runs (performance, IME, screen reader, real audio): [scripts/desk](scripts/desk/README.md).

`cargo build --workspace` turns on gpui-kit's `test-support` for every crate, because the rigs
need it. For size or performance numbers, build with `-p semaphore-app` in release mode.

Two release-type profiles: `release` (thin LTO, what `verify.sh`, CI and the rigs build) and `dist`
(release plus fat LTO and one codegen unit: about 14 MB smaller, about three minutes longer).
Packages are built with `cargo build --locked --profile dist -p semaphore-app --features player`
inside the Debian 12 package image (glibc 2.36), not the Arch development image: see
[docs/packaging.md](docs/packaging.md) and [docs/size.md](docs/size.md#release-build-environment).

`verify.sh` reads the result schema from `scripts/native-baseline/result.schema.json`, or from
`RESULT_SCHEMA_HOST` when run from a checkout that lacks it.

## More

- [docs/parity-plan.md](docs/parity-plan.md): the feature inventory, waves, lanes and backend asks.
- [docs/slice-app.md](docs/slice-app.md): how the app is wired, and the manual checklists.
- [docs/player.md](docs/player.md), [docs/av-publish.md](docs/av-publish.md), [docs/size.md](docs/size.md).
- [docs/spike-results.md](docs/spike-results.md): the go/no-go tests (video, Socket.IO, system
  audio, large lists) that were run before committing to this client. Kept as a record.

The integration branch is still named `spike/native-gpui` for historical reasons: work lands
there in batches and goes to `main` by pull request.
