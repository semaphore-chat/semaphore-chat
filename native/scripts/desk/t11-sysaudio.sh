#!/usr/bin/env bash
# T11 on the real desktop: share system audio and check, on your own PipeWire session, that apps
# are in the capture and our own call audio is not.
#
#   native/scripts/desk/t11-sysaudio.sh [--dry-run] [--force] [--seconds N]
#
# Builds rig-sysaudio in the pinned image and copies it to native/scripts/desk/.bin/rig-sysaudio
# (the host path of the built binary). Then, for N seconds (default 60):
#   - a "game" tone (523 Hz, quiet: -26 dBFS) plays from pw-play, a separate process;
#   - the rig plays a "call" tone (743 Hz, same level) through the real call output path (cpal
#     over PipeWire's pulse socket), captures system audio as a screen share would, judges each
#     second, and records the capture to raw/capture.wav.
# Pass: the game tone in at least 95% of 1 s windows within 6 dB, no window where the call tone
# leaks (above -80 dBFS and 20 dB above an unplayed 330 Hz reference; above -80 but not that far
# above it is a glitch, and more than 5% glitches is "too noisy to judge"), and no link of ours left
# in the graph afterwards.
# While it runs, play anything you like (a game, a video, music, a Flatpak app, a Bluetooth
# headset, an EasyEffects chain): it should all be in raw/capture.wav, and the call tone never.
# You will hear both tones quietly. Afterwards, listen to the capture:  pw-play <out>/raw/capture.wav
# --dry-run builds and checks the binary links on this host, without playing or capturing.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
desk_init t11-sysaudio "$0" "$@"
SECONDS_TO_RUN=60
set -- "${DESK_ARGS[@]+"${DESK_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seconds) SECONDS_TO_RUN="$2"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
[[ "$SECONDS_TO_RUN" =~ ^[1-9][0-9]*$ ]] || die "--seconds must be a positive integer"
command -v pw-play >/dev/null || die "pw-play not found: install pipewire-audio"
command -v pw-dump >/dev/null || die "pw-dump not found: install pipewire"
desk_gate

banner "building rig-sysaudio (release, in the image)"
"$NATIVE_DIR/scripts/in-image.sh" cargo build --release -p rig-sysaudio 2>&1 | tail -2
desk_extract /cache/target/release/rig-sysaudio rig-sysaudio
BIN="$BIN_DIR/rig-sysaudio"
if ldd "$BIN" | grep 'not found'; then die "the binary is missing host libraries"; fi
ldd "$BIN" | grep -q libpipewire || die "the binary doesn't link libpipewire"
say "binary: $BIN (links on this host: ok)"

# The pure-Rust PulseAudio client looks for the cookie in \$HOME only; libpulse keeps it under
# XDG_CONFIG_HOME. Point it at whichever exists.
for cookie in "${XDG_CONFIG_HOME:-$HOME/.config}/pulse/cookie" "$HOME/.config/pulse/cookie" "$HOME/.pulse-cookie"; do
  if [[ -f "$cookie" ]]; then export PULSE_COOKIE="$cookie"; break; fi
done

AMPLITUDE=0.05
GAME_DB=-26.02
python3 - "$RAW/game.wav" "$((SECONDS_TO_RUN + 15))" "$AMPLITUDE" <<'PY'
import math, struct, sys, wave
path, seconds, amplitude = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
with wave.open(path, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000)
    for second in range(seconds):
        w.writeframes(b"".join(struct.pack("<hh", v, v) for v in (
            int(amplitude * 32767 * math.sin(2 * math.pi * 523 * (second * 48000 + i) / 48000)) for i in range(48000))))
PY

if [[ "$DRY_RUN" == true ]]; then
  say "would run: pw-play $RAW/game.wav &; MODE=desktop RECORD=$RAW/capture.wav $BIN"
  desk_finish
  say "dry run done"
  exit 0
fi

banner "T11: two quiet tones for ${SECONDS_TO_RUN} s. Play anything else you like meanwhile."
pw-play "$RAW/game.wav" &
game=$!; desk_track_pid "$game"
MODE=desktop RECORD="$RAW/capture.wav" DURATION_S="$SECONDS_TO_RUN" CALL_AMPLITUDE="$AMPLITUDE" \
  CALL_HZ=743 TONES=a:523,b:743,ref:330 "$BIN" >"$RAW/rig.jsonl" 2>"$RAW/rig.stderr" || say "rig exited with $?"
kill "$game" 2>/dev/null || true
wait "$game" 2>/dev/null || true

# Our links are object.linger=false: they must be gone with the rig.
leftover="$(pw-dump | python3 -c '
import json, sys
objs = json.load(sys.stdin)
ours = {o["id"] for o in objs if o.get("info", {}).get("props", {}).get("node.name") == "semaphore-system-audio"}
print(len(ours) + sum(1 for o in objs if o.get("type", "").endswith("Link")
      and o.get("info", {}).get("input-node-id") in ours))')"
pw-dump >"$RAW/pw-dump-after.json"
desk_finish
python3 "$NATIVE_DIR/rigs/sysaudio/desk_judge.py" "$RAW/rig.jsonl" "$OUT/summary.json" \
  --game-db "$GAME_DB" --leftover-links "$leftover"
say "listen to what a viewer would get: pw-play $RAW/capture.wav"
