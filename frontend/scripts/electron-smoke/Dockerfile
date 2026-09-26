# Runtime for the packaged-app smoke test (see README.md): a display (Xvfb),
# a session D-Bus and a Secret Service (gnome-keyring) so Electron's
# safeStorage has a real Linux keyring backend, and playwright-core for
# Playwright's Electron driver (_electron.launch). The Playwright image already
# has the GTK/NSS/ALSA/GBM libraries Chromium, and so Electron, needs.
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    dbus dbus-x11 gnome-keyring libsecret-1-0 libsecret-tools libnotify4 xauth xvfb \
  && rm -rf /var/lib/apt/lists/*

# Same version as frontend/package.json's @playwright/test (keep in sync).
RUN mkdir -p /opt/smoke && cd /opt/smoke \
  && npm init -y >/dev/null && npm pkg set type=module \
  && npm install --no-audit --no-fund playwright-core@1.63.0

# smoke.ts is mounted at /opt/smoke/src, so it resolves playwright-core from
# /opt/smoke/node_modules and is an ES module by /opt/smoke/package.json.
