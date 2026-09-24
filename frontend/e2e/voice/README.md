# Voice E2E — real LiveKit, multi-participant, no second human

These specs validate actual voice behaviour against a **real LiveKit server** by
driving 2–3 real browsers from one Playwright run and asserting "can A hear B"
(and "can A *see* B", "did A stop hearing B after a mute") via WebRTC `getStats`
(inbound bytes + audio energy increasing/flat). No human listener and no second
machine are required.

**Status (verified 2026-05-31, serialized run): 16 passed, 1 skipped, 0 failed.**
Skipped is a single `test.fixme` for the "no bytes to a non-watcher" guarantee
(see that spec's header — in this build video reaches every participant, so the
gating isn't observable; flagged rather than faked green).

Run `scripts/run-voice-e2e.sh` and **read the real pass/fail output** — do not
treat any spec as green without the runner reporting it. The runner uses
`--workers=1` (each spec drives 2–3 real browsers into real LiveKit rooms;
parallel specs overwhelm the single dev LiveKit), and each heavy spec uses its
OWN seeded VOICE channel so they don't contaminate each other's room state.

## Run it

```bash
scripts/run-voice-e2e.sh            # headless, all voice specs
scripts/run-voice-e2e.sh --headed   # watch the browsers join a call live
scripts/run-voice-e2e.sh reconnect-asymmetry   # filter by spec name
scripts/run-voice-e2e.sh --clean    # tear down volumes afterward
```

Host prereqs (the runner handles these if missing): the dev/e2e stack keeps
`frontend/node_modules` in a Docker volume, so a host checkout is often missing
`@playwright/test` — the runner runs `pnpm install` (NOT `npx`, which fetches a
mismatched global playwright that can't see the `voice` project) and
`pnpm exec playwright install chromium`.

## How it works (and the gotchas it took to get here)

- **LiveKit / backend / frontend run in Docker** (the e2e stack + a real
  `livekit-e2e`). The **browser runs on the host** against `http://localhost:5174`.
- **Secure context (the key constraint):** `getUserMedia` — needed for the mic
  to publish, i.e. for any audio at all — is only available in a *secure
  context*. `http://localhost` (and `127.0.0.1`, `*.localhost`) **is** a secure
  context with no TLS, but an arbitrary hostname like `http://frontend-test:5173`
  is **not**, and `--unsafely-treat-insecure-origin-as-secure` does not work in
  headless Chromium. So we point the host browser at `localhost` and need no
  HTTPS, no certs, no flags. (This is also the standard WebRTC test setup.)
- **LiveKit in Docker reachable from the host:** the host overlay
  (`docker-compose.voice-e2e.host.yml`) publishes LiveKit on `localhost:7882`
  with `node_ip: 127.0.0.1` so the host browser's ICE candidates resolve, and
  uses an **ICE UDP port range** (50000–50019) rather than single-port mux —
  single-port mux misroutes the DTLS handshake between peers and causes
  `dtls timeout` with no media. (Refs: livekit#4149, LiveKit ports/firewall docs.)
- **Fake media:** each participant launches its own Chromium with
  `--use-file-for-fake-audio-capture=<wav>` (distinct tones in `assets/`), so
  each is a deterministic, recognisable audio source.
- **Dev-only window hooks** (`src/features/voice/VoiceTestHooks.tsx`, active under
  `VITE_LIVEKIT_TEST_HOOK`): the specs drive the real `Room` via:
  - audio/diagnostics: `__lkRoom`, `__lkCaptureDiagnostics`, `__lkGetInboundAudio`,
    `__lkForceResubscribeMic`, `__lkGetLocalMicDeviceId`, `__lkEnableMic`
  - local media: `__lkSetMic`, `__lkSetCamera`, `__lkSetScreenShare`, `__lkSwitchMic`
  - on-demand subscription (opt-in video): `__lkWatchCamera` / `__lkUnwatchCamera`
    / `__lkWatchScreenShare` / `__lkUnwatchScreenShare`
  - read-side: `__lkGetInboundVideo`, `__lkGetSubscriptionState`

  These go through the SAME app code paths the UI uses (e.g. `watchScreenShare`
  is the action a video tile fires), so a passing test exercises real behaviour,
  not a bespoke shortcut.

## What's covered

| Spec | Channel | Validates |
|------|---------|-----------|
| `reconnect-asymmetry.spec.ts` | `voice-reconnect` | (PR #352) 3 participants all hear each other; audio **self-heals** after a forced `signal-reconnect` and `full-reconnect`; manual `forceResubscribeMic` recovery |
| `mute.spec.ts` | `voice-mute` | **local mute** (A mutes own mic → B stops receiving A, unmute restores) and **moderator mute** (admin mutes B server-side via `POST /livekit/channels/:id/mute-participant` → A stops receiving B, lift restores) |
| `screenshare-subscription.spec.ts` | `voice-video` | screen share publish → a **watcher** receives video → stop removes the publication. The **autoSubscribe:false "no bytes to a non-watcher"** guarantee is a `test.fixme` — not observable in this build (video reaches all participants; see the spec header) |
| `device-switching.spec.ts` | `voice-chat` | (PR #351) switching the mic swaps the **live** capture track with no rejoin (#346), asserted via `__lkSwitchMic` → `room.switchActiveDevice` against real LiveKit. The Settings-form wiring (#346 onDeviceChange) and #347 sensitivity persistence are client-only and covered by `VoiceSettings.test.tsx` / `AudioVideoSettingsPanel.test.tsx` unit tests |
| `midcall-edge.spec.ts` | `voice-edge` | mid-call timing: join **while a peer is muted** (late joiner hears unmuted peers only), **leave during another's reconnect** (reconnecting peer recovers a clean mesh, departed peer gone — no ghost), **audio continuity across a device switch** |
| `mute-permissions.spec.ts` | `voice-mute` | moderator-mute **denied (403)** for a non-privileged member (with an OWNER positive-control proving the endpoint works), and **rapid mute/unmute toggles** settle to the final state |
| `matrix-degraded.spec.ts` `@slow` | `voice-matrix` | **4-participant all-pairs matrix** (all 12 ordered pairs hear each other) and **force-tcp** degraded transport (audio survives a TCP-only reconnect). Tagged `@slow` → excluded from PR runs, runs on nightly/manual |

**Verified (2026-05-31, serialized full run): 16 passed, 1 skipped (the screenshare `test.fixme`), 0 failed.**

### Running in CI

A dedicated `voice-e2e` job lives in `.github/workflows/e2e-tests.yml`. Like the
main e2e job, it runs the browser on the runner against `localhost:5174`. Unlike
that job, which runs the backend and frontend directly on the runner, it builds
and starts the dockerized e2e stack with the real-LiveKit overlays, then runs
`--project=voice --workers=1`. It runs on
**nightly cron + manual dispatch only** — not on PRs, and not on push to main.

> ⚠️ **Runner-WebRTC caveat (unverified).** This job has **not yet completed a
> green run on a GitHub-hosted `ubuntu-latest` runner**, so whether the
> host-browser ↔ dockerized-LiveKit WebRTC path (published `localhost:7882` + UDP
> `50000-50019`, `node_ip 127.0.0.1`) works there is still unproven. Until a
> nightly/dispatch run confirms it, the job is kept entirely off the push/PR
> path. **The full voice suite is verified locally** via `scripts/run-voice-e2e.sh`
> (16 passed / 1 skipped / 0 failed) — that is the source of truth today.
>
> Note: the `playwright install` step deliberately omits `--with-deps` — apt-get
> hangs on the runner and the chromium system libs are already present on
> ubuntu-latest, so a browser-only install is fast and reliable (this hang was
> what previously timed out both this job *and* the main e2e job's install step).

### Channel isolation

The seed (`backend/prisma/seed-e2e.ts`) provisions separate VOICE channels —
`voice-reconnect`, `voice-mute`, `voice-video` (plus the default `voice-chat`) —
so each heavy multi-participant spec joins its own LiveKit room. `closeParticipant`
also disconnects the room and waits for the server to drop the session before
killing the browser, so no ghost participants linger between specs.

## Extending the suite — adding a spec for a new voice feature

The harness is built so a new feature gets a spec in a few lines. The pattern:

1. **Seed an isolated channel** (only for *heavy multi-participant* specs, so they
   don't contend on one room). Add it to `TEST_COMMUNITIES[0].channels` in
   `backend/prisma/seed-e2e.ts`, e.g. `{ name: 'voice-myfeature', type: 'VOICE' }`,
   then re-seed (the runner does this; manually:
   `docker compose … exec -T backend-test pnpm run seed:e2e`). A simple 1–2
   participant spec can reuse `voice-chat`.
2. **Write `frontend/e2e/voice/<feature>.spec.ts`** using the fixture helpers:

   ```ts
   import { test, expect } from '@playwright/test';
   import {
     launchParticipant, joinVoiceChannel, closeParticipant,
     waitForAudioFlow, expectNoAudioGrowth, setMicEnabled,
     TEST_USER, TEST_USER_2, type Participant,
   } from '../fixtures/voice.fixture';

   test.describe.configure({ mode: 'serial' }); // multi-browser specs run serially
   const CH = 'voice-myfeature';

   test('my feature behaves', async () => {
     const a = await launchParticipant(TEST_USER, 'sample-a.wav');
     const b = await launchParticipant(TEST_USER_2, 'sample-b.wav');
     try {
       await joinVoiceChannel(a, CH);
       await joinVoiceChannel(b, CH);
       await waitForAudioFlow(b, a);          // assert real audio over real LiveKit
       // …drive your feature via fixture helpers / window hooks, then assert…
     } finally {
       await Promise.all([a, b].map((p) => closeParticipant(p).catch(() => {})));
     }
   });
   ```

   The `voice` Playwright project auto-discovers any `voice/*.spec.ts`. Run just
   yours with `scripts/run-voice-e2e.sh <feature>`.
3. **Tag `@slow`** in the `describe`/test title for heavy specs (4+ participants,
   long reconnect loops) so PR/normal runs can skip them
   (`--grep-invert @slow`); they still run on nightly/manual.

### Fixture helpers (`e2e/fixtures/voice.fixture.ts`)

| Helper | What it does |
|--------|--------------|
| `launchParticipant(creds, wav)` | one browser + fake-audio source, API-logged-in |
| `joinVoiceChannel(p, channel?)` | UI-drive into a VOICE channel; waits for `connected`; records `identity` + `channelId` |
| `waitForAudioFlow(from, remote)` | assert audio IS flowing (inbound bytes grow + energy > 0) |
| `expectNoAudioGrowth(from, remote)` | assert audio STOPPED (bytes don't grow) — for mutes |
| `setMicEnabled` / `setCameraEnabled` / `startScreenShare` / `stopScreenShare` | local media control |
| `switchMic(p, deviceId)` / `listAudioInputs` / `getLocalMicDeviceId` | live device switching (#351) |
| `watchScreenShareOf` / `watchCameraOf` / `waitForVideoFlow` / `expectNoVideoToNonWatcher` | opt-in video subscription |
| `moderatorMute` / `tryModeratorMuteAs(creds,…)` | server-mute REST (throwing / status-returning) |
| `forceReconnect(p, scenario)` / `forceResubscribeMic` | `signal-reconnect` / `full-reconnect` / `force-tcp`; #352 recovery |
| `getSubscriptionState` / `getInboundAudioStats` / `captureDiagnostics` | read-side state |
| `closeParticipant(p)` | clean room disconnect + browser teardown (avoids ghost participants) |

If a helper doesn't exist for what you need, add a thin wrapper around the
**window hooks** below rather than reaching into the page directly — keeps specs
declarative.

### Window hooks (drive the real `Room` from `page.evaluate`)

These live in `src/features/voice/VoiceTestHooks.tsx`, are **gated by
`VITE_LIVEKIT_TEST_HOOK`** (inert/dead-code-eliminated in prod), and go through
the *same app actions the UI fires* — so a passing test exercises real behaviour:
`__lkRoom`, `__lkSetMic/Camera/ScreenShare`, `__lkSwitchMic`,
`__lkWatch/Unwatch{Camera,ScreenShare}`, `__lkForceResubscribeMic`,
`__lkGetInboundAudio/Video`, `__lkGetSubscriptionState`, `__lkCaptureDiagnostics`.
To expose a new capability, add the hook here + its type in
`voiceTestHooks.types.ts`, then a fixture wrapper.

### Adding a participant / credentials

Seed users live in `backend/prisma/seed-e2e.ts` (`TEST_USERS`) and their creds are
re-exported from the fixture: `TEST_USER`, `TEST_USER_2`, `TEST_USER_3`,
`ADMIN_USER`, `MEMBER_USER`. `OWNER`-role users can drive the join UI; the
`USER`-role `member` is **REST-only** (used to assert a 403 — it isn't driven
through the voice-join UI). Add a new user in both places if you need more.

### Diagnostics module

`src/features/voice/voiceDiagnostics.ts` is the single source of truth for parsing
WebRTC stats and capturing a snapshot — the **same code path** backs the debug
panel's *Export* button and the test assertions. Extend it (e.g. a new stat) and
both the UI export and the tests get it.

## Notes / gotchas

- Assert on `getStats` deltas (bytes + energy increasing), never on audible
  playback — those increment even when autoplay pauses the `<audio>` element.
- The mic is (re)published via `window.__lkEnableMic` after join: the app enables
  it once at connect, which can race the page becoming a stable secure context in
  a fresh headless tab. Mirrors a user unmuting; the product's join-time enable
  is unchanged.
- Playwright in the container vs host: run on the host (this is the supported
  path). For a fully-in-Docker run you'd need the frontend reachable at a
  `*.localhost` name or over HTTPS so the in-container origin is secure — not
  wired up; the host path is simpler and is what `run-voice-e2e.sh` uses.

## Regenerating the fake-audio samples

```bash
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=10:sample_rate=48000" \
  -ac 1 -c:a pcm_s16le e2e/assets/sample-a.wav   # 660Hz -> b, 880Hz -> c
```
