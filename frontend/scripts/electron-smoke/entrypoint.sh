#!/usr/bin/env bash
# Runs inside the electron-smoke image (see run.sh): a session D-Bus, an
# unlocked gnome-keyring Secret Service (unless SMOKE_KEYRING=false) and an
# Xvfb display around smoke.ts.
set -euo pipefail
mkdir -p "$HOME"
# Playwright's own log of the app's stdout/stderr, from the first line on.
export DEBUG=pw:browser DEBUG_FILE=/out/main-process.log
if [[ "${SMOKE_KEYRING:-true}" == true ]]; then
  # Chromium picks its Linux password store from the desktop environment:
  # GNOME -> libsecret (the gnome-keyring started below).
  export XDG_CURRENT_DESKTOP=GNOME
  exec dbus-run-session -- bash -c '
    printf smoke | gnome-keyring-daemon --unlock --components=secrets >/dev/null
    exec xvfb-run -a -s "-screen 0 1920x1080x24" node /opt/smoke/src/smoke.ts'
fi
exec xvfb-run -a -s "-screen 0 1920x1080x24" node /opt/smoke/src/smoke.ts
