# Electron smoke test (packaged app)

Launches the **packaged** desktop app (electron-builder's `linux-unpacked`
build, the same `app.asar` users get) headless under Xvfb and drives it with
Playwright's Electron driver against a real backend and LiveKit. Everything
runs in Docker on the shared `semaphore-test` network.

CI's smoke steps (`electron-smoke.yml`, `electron-build.yml`) only check that
the packed app reaches its ready state. Run this by hand before merging an
Electron upgrade or a change to `electron/main.ts` / `electron/preload.ts`.

```bash
# package this checkout, then run the checks (ticket: any [a-z0-9-] name)
scripts/run-electron-smoke.sh my-ticket --build

# again without rebuilding, keeping the backend/LiveKit/databases for the next run
scripts/run-electron-smoke.sh my-ticket --keep

# without a Secret Service: safeStorage is unavailable (Chromium's basic_text
# store), so the app must fall back to localStorage and show the warning
scripts/run-electron-smoke.sh my-ticket --keep --no-keyring

# compare with another build (e.g. main's, packaged in another worktree)
scripts/run-electron-smoke.sh my-ticket --keep \
  --app ../other-worktree/frontend/release/linux-unpacked --out /tmp/smoke-main

scripts/test-stack.sh my-ticket down   # after --keep
```

Results go to `frontend/.electron-smoke-out/` (or `--out`): `results.json`
(one entry per check, plus the Electron/Chromium/Node versions and the
safeStorage backend), screenshots, `main-process.log` (the app's whole
stdout/stderr) and the renderer console per launch. The script exits non-zero
if any check failed.

## What it checks

| Check | How |
|---|---|
| Main window loads `dist/index.html` from `app.asar` | window URL, React root mounted |
| Preload bridge, context isolation | `window.electronAPI.isElectron`; no `require`/`process`/`module` in the page; `contextIsolation`/`sandbox` on, `nodeIntegration` off in the window's web preferences |
| Connection wizard, login | through the UI, as the seeded e2e user |
| Community + text channel, send a message | UI, then confirmed through the REST API |
| safeStorage | refresh token in `userData/secure-tokens` (encrypted) and not in localStorage; with `--no-keyring`, the localStorage fallback and the one-time `SecureStorageWarning` |
| Restart | relaunch with the same profile: still signed in, channel history loads |
| Clipboard | `electronAPI.writeClipboard` -> main's `clipboard.writeText`, read back in main |
| desktopCapturer | `electronAPI.getDesktopSources` returns a screen with a thumbnail |
| Notifications | `electronAPI.showNotification` doesn't fail in main |
| Deep link | a second instance launched with `semaphore://community/<id>/channel/<id>` routes the running one there |
| Voice + screen share | join a voice channel (real LiveKit), open the `ScreenSourcePicker`, share a screen: main's `setDisplayMediaRequestHandler` grants it and the track publishes |
| Screen share refused | Cancel in the picker sends no request; with main's `desktopCapturer.getSources` stubbed to return nothing, a picked source that is gone and a request with no sources at all are denied (`callback(null)`) without main-process errors, `getDisplayMedia` rejects, sharing stays off and works again afterwards |
| Auto-updater | no uncaught updater errors (an unpacked build isn't an AppImage, so electron-updater skips the check) |
| Logs | no renderer page errors, no uncaught main-process errors |

## Notes

- `--no-sandbox`: the container has neither the SUID `chrome-sandbox` helper
  nor unprivileged user namespaces (CI's smoke steps pass it for the same
  reason), so this does not exercise the Chromium sandbox of a real install.
- The keyring run sets `XDG_CURRENT_DESKTOP=GNOME` and starts an unlocked
  gnome-keyring on a session D-Bus: Chromium chooses its Linux password store
  from the desktop environment.
- The backend runs with `CORS_ORIGIN=null`: the packaged app is a `file://`
  page, so its requests carry `Origin: null`.
- `--use-fake-device-for-media-stream` provides a microphone and camera. The
  fake-UI switch is deliberately not used: it would auto-grant
  `getDisplayMedia` inside Chromium and bypass main's handlers.
- Linux (X11) only. Windows- and macOS-specific paths (WASAPI loopback audio,
  DPAPI/Keychain safeStorage, NSIS install, `open-url` deep links) are not
  covered.
