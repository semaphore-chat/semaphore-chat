#!/usr/bin/env bash
# Capture step of the media pipeline (runs in the `media-capture` container,
# Playwright image, cwd frontend/). MEDIA_STEPS: comma list of
# shots,record,encode (default: all; "encode" is handled by encode.sh).
#
# `docker compose run media` starts this container as a dependency and does
# NOT stream its output, so everything is also written to
# .media-out/capture.log, which encode.sh prints.
set -euo pipefail
steps="${MEDIA_STEPS:-shots,record,encode}"
mkdir -p .media-out
: > .media-out/capture.log
case ",$steps," in *,shots,*) node scripts/media/shots.mjs 2>&1 | tee -a .media-out/capture.log ;; esac
case ",$steps," in *,record,*) node scripts/media/record.mjs 2>&1 | tee -a .media-out/capture.log ;; esac
# Containers run as root; hand the output back to whoever owns the checkout.
chown -R "$(stat -c %u:%g .)" .media-out 2>/dev/null || true
