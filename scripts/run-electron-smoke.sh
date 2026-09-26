#!/usr/bin/env bash
# Smoke-test the packaged Electron app (headless, real backend + LiveKit, all in
# Docker on semaphore-test). See frontend/scripts/electron-smoke/README.md.
#   scripts/run-electron-smoke.sh <ticket> [--build] [--keep] [--no-keyring] [--app DIR] [--out DIR]
exec "$(dirname "${BASH_SOURCE[0]}")/../frontend/scripts/electron-smoke/run.sh" "$@"
