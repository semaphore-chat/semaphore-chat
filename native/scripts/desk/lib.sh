# Shared by the desk kit scripts. Source it; don't run it.
#
#   desk_init <test> "$@"   parse --dry-run, --force, --runs N, -h; set OUT, RAW, BIN_DIR
#   desk_gate               record host info and load1; refuse above DESK_MAX_LOAD1 (2.0)
#   desk_track_pid PID      killed on exit or Ctrl-C
#   desk_track_container N  removed on exit or Ctrl-C
#   desk_poll_proc PID FILE sample load1, PSS and GPU use once a second while PID lives
#   desk_finish             load1 after, into host.json
# shellcheck shell=bash

DESK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$(cd "$DESK_DIR/../.." && pwd)"
ROOT="$(cd "$NATIVE_DIR/.." && pwd)"
DESK_MAX_LOAD1="${DESK_MAX_LOAD1:-2.0}"
BIN_DIR="$DESK_DIR/.bin"
DRY_RUN=false FORCE=false RUNS=3
DESK_PIDS=() DESK_CONTAINERS=()

say() { printf 'desk: %s\n' "$*" >&2; }
die() { printf 'desk: %s\n' "$*" >&2; exit 1; }
banner() { printf '\n==== %s ====\n\n' "$*" >&2; }

desk_cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  local pid
  for pid in "${DESK_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${DESK_PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  local c
  for c in "${DESK_CONTAINERS[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  exit "$rc"
}
desk_track_pid() { DESK_PIDS+=("$1"); }
desk_track_container() { DESK_CONTAINERS+=("$1"); }

desk_usage() { sed -n '2,/^set -euo/p' "$1" | sed -e 's/^# \{0,1\}//' -e '/^set -euo/d'; }

# desk_init <test> <script> "$@": leaves the script's own flags in DESK_ARGS.
desk_init() {
  DESK_TEST="$1"; local script="$2"; shift 2
  DESK_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=true; shift ;;
      --force) FORCE=true; shift ;;
      --runs) RUNS="$2"; shift 2 ;;
      -h|--help) desk_usage "$script"; exit 0 ;;
      *) DESK_ARGS+=("$1"); shift ;;
    esac
  done
  [[ "$RUNS" =~ ^[1-9][0-9]*$ ]] || die "--runs must be a positive integer"
  if [[ "$DRY_RUN" == true ]]; then
    OUT="$NATIVE_DIR/results/desk/$DESK_TEST/dry-run"
    rm -rf "$OUT"
  else
    OUT="$NATIVE_DIR/results/desk/$DESK_TEST/$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  RAW="$OUT/raw"
  mkdir -p "$RAW" "$BIN_DIR"
  trap desk_cleanup EXIT
  trap 'say "interrupted"; exit 130' INT TERM
  [[ "$DRY_RUN" == true ]] && say "DRY RUN: everything except opening windows and measuring"
  say "results in $OUT"
}

load1() { cut -d' ' -f1 /proc/loadavg; }

# Host facts the earlier provisional runs lacked: load, GPU and driver, compositor, refresh rate.
desk_gate() {
  local start; start="$(cat /proc/loadavg)"
  DESK_FORCE="$FORCE" python3 "$DESK_DIR/desk.py" host-info --out "$OUT/host.json" --load-start "$start" \
    --max-load1 "$DESK_MAX_LOAD1" --dry-run "$DRY_RUN"
  local l1; l1="$(load1)"
  if awk -v l="$l1" -v m="$DESK_MAX_LOAD1" 'BEGIN { exit !(l > m) }'; then
    {
      echo
      echo "################################################################"
      echo "#  HOST IS BUSY: load1 is $l1, above $DESK_MAX_LOAD1."
      echo "#  A loaded host is what made the earlier numbers provisional."
      echo "#  Running containers:"
      docker ps --format '#    {{.Names}}  ({{.Status}})' 2>/dev/null | head -15
      echo "#  Close builds, browsers and other agents' stacks, then retry."
      echo "################################################################"
      echo
    } >&2
    if [[ "$DRY_RUN" == true ]]; then
      say "dry run: carrying on anyway"
    elif [[ "$FORCE" == true ]]; then
      say "--force: carrying on; the result will be marked provisional"
    else
      die "refusing to measure (pass --force to run anyway, marked provisional)"
    fi
  fi
}

desk_finish() {
  python3 "$DESK_DIR/desk.py" host-end --host "$OUT/host.json" --load-end "$(cat /proc/loadavg)"
}

# Bounded by the process's life: one sample a second while PID runs.
desk_poll_proc() {
  local pid="$1" file="$2" gpu
  : >"$file"
  while kill -0 "$pid" 2>/dev/null; do
    gpu="$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 || true)"
    printf '%s %s %s\n' "$(load1)" \
      "$(awk '/^Pss:/ { print $2 }' "/proc/$pid/smaps_rollup" 2>/dev/null || true)" "${gpu:--}" >>"$file"
    sleep 1
  done
}

# Copy a release binary out of this checkout's target volume, as the host user.
desk_extract() {
  local from="$1" name="$2"
  "$NATIVE_DIR/scripts/in-image.sh" install -m 755 "$from" "$BIN_DIR/$name"
  [[ -x "$BIN_DIR/$name" ]] || die "no binary at $BIN_DIR/$name"
}

desk_validate() {
  "$NATIVE_DIR/scripts/in-image.sh" python3 scripts/validate-result.py "$@"
}

desk_need_display() {
  [[ -n "${WAYLAND_DISPLAY:-}" ]] || die "no WAYLAND_DISPLAY: run this from a terminal on the Hyprland session"
}
