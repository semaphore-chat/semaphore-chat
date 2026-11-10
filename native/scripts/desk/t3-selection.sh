#!/usr/bin/env bash
# T3 on the real desktop: copy a selection that spans scrolled-out messages, then read it back
# from the real Wayland clipboard with wl-paste, a different client.
#
#   native/scripts/desk/t3-selection.sh [--dry-run] [--force]
#
# Builds rig-list in the pinned image, opens one window on this session. The rig drags a selection
# over about 150 messages by itself (scripted, in-process), copies it, and waits. The script then
# reads the clipboard with wl-paste and compares it byte for byte with the text the rig expected.
# If the compositor ignored the rig's own copy (Wayland wants a real input serial), it asks you to
# press Ctrl+C in the window, and checks again for up to 120 s.
# Overwrites your clipboard. --dry-run builds and checks tools, without a window or the clipboard.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
desk_init t3-selection "$0" "$@"
[[ ${#DESK_ARGS[@]} -eq 0 ]] || die "unknown option ${DESK_ARGS[0]}"
desk_need_display
command -v wl-paste >/dev/null || die "wl-paste not found: install wl-clipboard"
desk_gate

banner "building rig-list (release, in the image)"
"$NATIVE_DIR/scripts/in-image.sh" cargo build --release -p rig-list 2>&1 | tail -2
desk_extract /cache/target/release/rig-list rig-list
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD)"
IMAGES="$DESK_DIR/.cache/list-images"; mkdir -p "$IMAGES"
DONE="$RAW/done"; EXPECTED="$RAW/expected.txt"; CLIP="$RAW/wl-paste.txt"

clip_matches() {
  timeout 5 wl-paste --no-newline --type text/plain >"$CLIP" 2>/dev/null || timeout 5 wl-paste --no-newline >"$CLIP" 2>/dev/null || : >"$CLIP"
  cmp -s "$CLIP" "$EXPECTED"
}
clip_json() {
  printf '{"trigger":"%s","wl_paste_exact_match":%s,"wl_paste_bytes":%s,"expected_bytes":%s,"wl_paste_sha256":"%s","expected_sha256":"%s"}\n' \
    "$1" "$2" "$(stat -c %s "$CLIP")" "$(stat -c %s "$EXPECTED")" \
    "$(sha256sum "$CLIP" | cut -c1-64)" "$(sha256sum "$EXPECTED" | cut -c1-64)" >"$RAW/clipboard.json"
}

if [[ "$DRY_RUN" == true ]]; then
  say "would run: $BIN_DIR/rig-list select --out $RAW/select.json --expected-out $EXPECTED --shot-wait-file $DONE --wait-secs 180"
  say "then compare: wl-paste --no-newline against $EXPECTED (not read in a dry run: it's your clipboard)"
  ldd "$BIN_DIR/rig-list" | grep 'not found' && die "the binary is missing host libraries"
  say "binary links on the host: ok; wl-paste: $(command -v wl-paste)"
  desk_finish
  python3 "$DESK_DIR/desk.py" dry-result --test t3 --host "$OUT/host.json" --out "$OUT/result.json" --commit "$COMMIT" --binary "$BIN_DIR/rig-list"
  desk_validate "$OUT/result.json"
  say "dry run done"
  exit 0
fi

banner "T3: a window opens and selects by itself. Don't click in it."
RUST_LOG=warn "$BIN_DIR/rig-list" select --out "$RAW/select.json" --image-dir "$IMAGES" \
  --expected-out "$EXPECTED" --shot-wait-file "$DONE" --wait-secs 180 >"$RAW/select.log" 2>&1 &
pid=$!; desk_track_pid "$pid"
# The rig writes its JSON after copying, then holds the window (and the clipboard) until $DONE.
for _ in $(seq 1 300); do
  [[ -s "$RAW/select.json" ]] && break
  kill -0 "$pid" 2>/dev/null || die "the rig exited early (see $RAW/select.log)"
  sleep 1
done
[[ -s "$RAW/select.json" && -s "$EXPECTED" ]] || die "no selection after 300 s (see $RAW/select.log)"

trigger=rig_copy
if ! clip_matches; then
  say "wl-paste got $(stat -c %s "$CLIP") bytes, expected $(stat -c %s "$EXPECTED"): the rig's own copy didn't reach the clipboard"
  {
    echo
    echo "################################################################"
    echo "#  ACTION NEEDED: move the pointer onto the rig window WITHOUT"
    echo "#  clicking (a click starts a new selection), then press Ctrl+C."
    echo "#  Waiting up to 120 s."
    echo "################################################################"
    echo
  } >&2
  trigger=manual_ctrl_c
  matched=false
  for _ in $(seq 1 120); do
    kill -0 "$pid" 2>/dev/null || break
    if clip_matches; then matched=true; break; fi
    sleep 1
  done
  [[ "$matched" == true ]] || trigger=manual_ctrl_c_timed_out
fi
if cmp -s "$CLIP" "$EXPECTED"; then clip_json "$trigger" true; else clip_json "$trigger" false; fi
touch "$DONE"
for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
wait "$pid" || say "the rig exited non-zero (see $RAW/select.log)"
desk_finish
banner "T3 result"
python3 "$DESK_DIR/desk.py" t3 --raw "$RAW" --host "$OUT/host.json" --out "$OUT/result.json" --commit "$COMMIT" --binary "$BIN_DIR/rig-list"
desk_validate "$OUT/result.json" >/dev/null && say "result.json matches the schema: $OUT/result.json"
