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

## U13 must do

Core and the media crate provide these, but nothing calls them until the app does:

- **The voice heartbeat.** Call `Core::refresh_voice_presence` about every 30 s for as long as the
  app lives. The server's presence TTL is 90 s, so without it a user drops off the voice roster about
  90 s into every call, while their audio keeps working. It does nothing outside a connected call, so
  a plain timer is enough.
- **`TokenSource`.** Implement it over `Core::voice_token` and pass it to
  `LiveKitEngine::set_token_source`. Without one, the engine's rejoin loop reuses the first token and
  gives up after 20 failed attempts.
- **Report the engine to core.** Forward `LiveKitEngine::subscribe()` to `Core::ingest_media`, sending
  `snapshot.voice`. Without it `Core::voice()` has no tracks or speaking, and a call the engine ends
  still reads as connected.
- **`CoreSource`'s new reads** (`ui/src/shell/source.rs`): `members` from `Core::members`, mapping
  `MemberView` to `MemberRow` and showing `MemberList::truncated`; `rail_counts` from
  `Core::rail_counts`. They return empty today. `Core::members` returns `None` while loading, which is
  `Load::Loading`. Listen for `ViewKey::Members` and `ViewKey::Rail`.
- **`TileDemand` to `VideoDemand`.** `VoiceController::set_video_demands` takes the UI's `TileDemand`.
  Convert it and call `Core::set_video_demands`, or replace it with `core::model::VideoDemand`.
- **The `QualityLevel` mapping.** `VoiceStageModel` reads quality from its own map. Fill it from
  `ParticipantView::quality`, and `reconnect_attempt` from `VoiceView::reconnect_attempt`.
- **Wire up the rest of the row and list:** `MessageRow::reply_to` to `ListData::replies`, a
  `LoadNewer` event from `Core::at_live_edge` and `Core::load_newer`, a "jump to present" through
  `Core::jump_to_present`, a reply click through `Core::open_conversation_at`,
  `MessageListEvent::DiscardFailed` to `Core::discard_failed_send`, `MediaSource::emoji` from
  `Core::custom_emojis`, and `ChannelRow::{slowmode_seconds, permissions}` to the composer. A `None`
  in `permissions` fails open.
- **`HttpBackend`** needs the new `Backend` methods, if `semaphore-net` merges after these additions:
  `membership_controller_find_all_for_community`, `presence_controller_get_bulk_presence`,
  `notifications_controller_get_unread_count`, `messages_controller_find_around_for_group`.

Some UI comments still say core lacks these (`shell/source.rs`, `voice/model.rs`, `messages/view.rs`).
Drop each as its gap closes.

## Follow-ups, not cut

Later in the order, not out of scope:

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
