#!/usr/bin/env bash
# The zbus `tokio` guard, run in the image: no zbus 5 may have the `tokio` feature.
#
# Our zbus users (the notifier, the tray's launcher count, the logind and NetworkManager watchers)
# and GPUI's notify-rust run `zbus::block_on`. Without `tokio`, that's `async_io::block_on`, which
# blocks its caller but works anywhere. With `tokio`, zbus starts a runtime of its own inside
# `block_on`, and that panics on a Tokio worker ("Cannot start a runtime from within a runtime"), as
# keyring's zbus 4 does today. Features unify, so any crate that adds zbus 5 with `tokio` would break
# them all. Give such a crate async-io instead.
set -euo pipefail

lines="$(cargo tree --locked --workspace -e normal -f '{p} [{f}]' --prefix none | grep -E '^zbus v5\.' | sort -u || true)"
if [ -z "$lines" ]; then
  echo "check-zbus-tokio: no zbus 5 in the tree; nothing to guard"
  exit 0
fi
echo "$lines"
if grep -q 'tokio' <<<"$lines"; then
  echo "check-zbus-tokio: zbus 5 has the tokio feature; zbus::block_on would panic on a Tokio worker" >&2
  exit 1
fi
echo "check-zbus-tokio: zbus 5 runs on async-io"
