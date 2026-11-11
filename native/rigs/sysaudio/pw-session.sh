#!/usr/bin/env bash
# Run a command inside a private, headless PipeWire session: the daemon, WirePlumber and
# pipewire-pulse, with two null sinks and a test-tone source in place of sound cards.
#
#   pw-session.sh <command...>
#
# No hardware, no privileges, no network: the graph is driven by the null sinks' timers.
set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/pw-rig-$$}"
export XDG_CONFIG_HOME="$XDG_RUNTIME_DIR/config"
export XDG_STATE_HOME="$XDG_RUNTIME_DIR/state"
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
mkdir -p "$XDG_CONFIG_HOME/pipewire/pipewire.conf.d" "$XDG_STATE_HOME" "$XDG_RUNTIME_DIR/logs"
LOGS="$XDG_RUNTIME_DIR/logs"

cat > "$XDG_CONFIG_HOME/pipewire/pipewire.conf.d/rig.conf" <<'CONF'
context.properties = { default.clock.rate = 48000 }
context.objects = [
  { factory = adapter args = { factory.name = support.null-audio-sink node.name = rig-speakers
      node.description = "Rig speakers" media.class = Audio/Sink audio.position = [ FL FR ]
      priority.session = 2000 priority.driver = 2000 object.linger = true } }
  { factory = adapter args = { factory.name = support.null-audio-sink node.name = rig-speakers-2
      node.description = "Rig headset" media.class = Audio/Sink audio.position = [ FL FR ]
      priority.session = 1000 priority.driver = 1000 object.linger = true } }
  # The microphone: a live source playing a 440 Hz sine whenever something records from it.
  { factory = adapter args = { factory.name = audiotestsrc library.name = audiotestsrc/libspa-audiotestsrc node.name = rig-mic
      node.description = "Rig microphone" media.class = Audio/Source
      priority.session = 2000 object.linger = true } }
]
CONF

pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() { # <what> <command...>: bounded poll, 10 s
  local what="$1"; shift
  for _ in $(seq 1 100); do "$@" >/dev/null 2>&1 && return 0; sleep 0.1; done
  echo "pw-session: $what never came up" >&2
  tail -n 30 "$LOGS"/*.log >&2 || true
  exit 1
}

# No D-Bus: WirePlumber runs without it (no device reservation, no logind), which a
# headless graph of null sinks does not need.
unset DBUS_SESSION_BUS_ADDRESS

pipewire >"$LOGS/pipewire.log" 2>&1 & pids+=($!)
wait_for pipewire pw-cli info 0
wireplumber >"$LOGS/wireplumber.log" 2>&1 & pids+=($!)
pipewire-pulse >"$LOGS/pipewire-pulse.log" 2>&1 & pids+=($!)
wait_for pipewire-pulse pactl info
# WirePlumber has picked the default sink once pulse reports it.
# libpulse keeps its cookie under XDG_CONFIG_HOME; the pure-Rust client cpal uses only looks in
# $HOME, and pipewire-pulse refuses it without one.
export PULSE_COOKIE="$XDG_CONFIG_HOME/pulse/cookie"
wait_for "a default sink" sh -c 'pactl get-default-sink | grep -qx rig-speakers'

"$@"
