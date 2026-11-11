#!/usr/bin/env bash
# The Electron baseline on the real desktop: scripts/native-baseline/run.sh --host.
#
#   native/scripts/desk/baseline.sh [--dry-run] [--force] [--short] [--rebuild]
#
# Packages this checkout's Electron app in Docker if it isn't packaged yet (--rebuild always does),
# starts the per-ticket backend, LiveKit and databases on semaphore-test, seeds 100k messages, and
# runs every scenario with the app in a real window on this session: about 50 minutes, or about
# 20 with --short (no 30-minute idle-growth scenario). The harness's own scripts/native-baseline/
# README.md "On the real desktop" section lists what to close first.
# --dry-run packages, measures disk, brings the stack up and seeds it, then stops before the app.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
SHORT=false REBUILD=false
desk_init baseline "$0" "$@"
set -- "${DESK_ARGS[@]+"${DESK_ARGS[@]}"}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --short) SHORT=true; shift ;;
    --rebuild) REBUILD=true; shift ;;
    *) die "unknown option $1" ;;
  esac
done
desk_need_display
desk_gate

STEPS=disk,cold,a_idle,a_noinstrument,b_scroll,c_voice_audio,d_video_grid,e_idle_growth
[[ "$SHORT" == true ]] && STEPS="${STEPS%,e_idle_growth}"
args=(--host --ticket desk-baseline --messages 100000 --out "$OUT/harness" --steps "$STEPS")
if [[ "$REBUILD" == true || ! -x "$ROOT/frontend/release/linux-unpacked/semaphore-chat" ]]; then
  say "packaging the Electron app in Docker (several minutes)"
  args+=(--build)
fi
[[ "$DRY_RUN" == true ]] && args+=(--dry-run)
# The harness waits for load to drain between steps and marks loaded steps provisional itself.
rc=0
"$ROOT/scripts/native-baseline/run.sh" "${args[@]}" || rc=$?
desk_finish
if [[ "$DRY_RUN" == true ]]; then
  [[ "$rc" -eq 0 ]] || die "the harness dry run failed ($rc)"
  say "dry run done: disk.json and seed.json in $OUT/harness"
  exit 0
fi
banner "Baseline result"
python3 - "$OUT/harness/results.json" "$OUT/host.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1])); host = json.load(open(sys.argv[2]))
s = r["scenarios"]
def cpu(k): return (s.get(k) or {}).get("cpu_pct_core") or {}
def mem(k): return (s.get(k) or {}).get("memory_mb") or {}
m = host.get("focused_monitor") or {}
print(f"Electron baseline on {host['compositor']['name']} {host['compositor']['version']} @ {m.get('refreshRate')} Hz, provisional: {r['provisional']} {r.get('provisional_reasons') or ''}")
print(f"  idle:   PSS {mem('a_idle').get('pss')} MB, CPU {cpu('a_idle').get('avg')}% of a core   (no bar: this is the comparison for the native client)")
print(f"  scroll: CPU {cpu('b_scroll').get('avg')}%; voice: CPU {cpu('c_voice_audio').get('avg')}%")
print(f"  video grid 9x720p30+1080p60: CPU {cpu('d_video_grid').get('avg')}%, PSS {mem('d_video_grid').get('pss')} MB, ok {(s.get('d_video_grid') or {}).get('ok')}")
print(f"  valid scenarios: {sum(1 for v in s.values() if v.get('ok'))}/{len(s)}; quote numbers only if provisional is false")
PY
say "results: $OUT/harness/results.json"
exit "$rc"
