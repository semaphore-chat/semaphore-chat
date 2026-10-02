# pnpm patches

`pnpm patch <pkg>@<version>` / `pnpm patch-commit` write dependency patches
here, and root `package.json` lists them under `pnpm.patchedDependencies`.
Every Dockerfile copies this directory before `pnpm install`.

## Current patches

### `livekit-client@2.22.3`: no lost room events after a full reconnect

`RTCEngine.waitForRestarted()` resolves at once when `pcState` is
`Connected`. In a full reconnect the new peer connection connects within
milliseconds, while `restartConnection()` still sleeps its fixed 2 s
`minReconnectWait` before it emits `Restarted`. `Room.handleSignalRestarted`
therefore declares the room `Reconnected` and flushes its event buffer while
`engine.pendingReconnect` is still true, and `Room.emitWhenConnected` buffers
every room event of the next ~2 s into `bufferedEvents`, which nothing
flushes again. Since 2.18.1 ("Emit TrackSubscribed event only when room is
connected", livekit/client-sdk-js#1860) that includes `TrackSubscribed`, so
after a full reconnect `AudioRenderer` never attached the re-subscribed mics
and the user heard nobody, although the audio arrived. The nightly voice E2E
full-reconnect specs (`reconnect-asymmetry` "full reconnect also
self-heals", `midcall-edge` "leave during another's reconnect") have failed
since livekit-client went from 2.17.1 to 2.22.3.

The patch keeps `waitForRestarted()` waiting for the real `Restarted` event
while a reconnect attempt is running (`pcState === Connected &&
!attemptingReconnect`, the test RTCEngine already uses for "really
connected" elsewhere). Only the ESM build (what Vite, Vitest and the
Electron renderer load) and the shipped TS source are patched, not the
one-line minified UMD/CJS build, which nothing here loads.
`frontend/src/__tests__/features/livekitClientPatch.test.ts` drives the real
RTCEngine and fails without the patch. Upstream `main` still has the
unpatched code (checked 2026-10-02). livekit-client is pinned exactly in `frontend/package.json` and Dependabot ignores it (`.github/dependabot.yml`), so it is only ever bumped by hand. On a livekit-client bump: check whether
upstream fixed `waitForRestarted`; if so, drop the patch once that test and
`scripts/run-voice-e2e.sh` pass without it, otherwise port it.

livekit-client is frontend-only, so `backend/Dockerfile` installs with
`--frozen-lockfile` (a plain install there fails with
`ERR_PNPM_UNUSED_PATCH`, see below).

## Rules for adding one

- **Prove the bug in the unpatched package first, and add a test that fails
  without the patch.** The 0.4.2 `electron-updater@6.8.3` patch removed the
  quotes around the `bash -c` command in `LinuxUpdater`, reasoning that they
  reached bash literally. They don't: `spawnSyncLog` spawns through `/bin/sh`
  (`shell: true`), which strips them. The patch made bash run `dpkg` with no
  arguments, so .deb and .rpm auto-update in 0.4.2 and 0.4.3 failed on every
  pkexec/sudo install. `frontend/src/__tests__/electron/linuxUpdaterInstall.node.test.ts`
  now runs that install path and fails if the package manager doesn't get the
  package path.
- **Leave `allowUnusedPatches` off.** With it on, a patch keyed to a version
  that's no longer installed (a Dependabot bump) is skipped without a word.
  Off, the lockfile refresh fails with `ERR_PNPM_UNUSED_PATCH`, and someone
  has to port or drop the patch.
- A patch for a dependency that only one workspace package uses fails a
  plain (re-resolving) `pnpm install` on a partial workspace without that
  package: the patch is unused there. `frontend/Dockerfile` still installs
  that way (no `backend/`), so a backend-only patch needs it changed the way
  `backend/Dockerfile` was for the frontend-only livekit-client patch
  (`--frozen-lockfile`). Handle that in the Dockerfile, not by turning
  `allowUnusedPatches` back on. CI's `--frozen-lockfile` installs,
  `--filter` installs and both `Dockerfile.prod`s are fine.
