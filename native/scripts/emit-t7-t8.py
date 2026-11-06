#!/usr/bin/env python3
"""Turn T7's and T8's raw run data into baseline-schema result JSON.

    emit-t7-t8.py --commit SHA --binary-bytes-reconnect N --binary-bytes-sio N

Writes results/t7.json and results/t8.json. These are protocol tests, not CPU or memory
measurements. The numbers that matter live in each scenario's aux. The schema makes a passing
scenario carry cpu_pct_core and memory_mb, so those come from one 30 s sample of a rig process
(results/t7/proc-sample.json, results/t8/proc-sample.json): rough, on a loaded host, never to compare.
The host's load is recorded per run, to judge whether load explains a timing failure.
"""
import argparse
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[1]
RESULTS = NATIVE / "results"
CPUS = 32
THRESHOLD = CPUS * 0.5


def metrics(test, ok):
    if not ok:
        return {"cpu_pct_core": None, "memory_mb": None}
    sample = json.loads((RESULTS / test / "proc-sample.json").read_text())
    return {"cpu_pct_core": sample["cpu_pct_core"], "memory_mb": sample["memory_mb"]}


def load_of(entries):
    """Load across runs. `entries` are (start, end) loadavg strings, in order."""
    entries = [e for e in entries if e[0] and e[1]]
    if not entries:
        return {"start": None, "end": None, "peak_load1": None, "threshold_load1": THRESHOLD, "provisional": False, "reason": None}
    peak = max(float(v.split()[0]) for pair in entries for v in pair)
    return {
        "start": entries[0][0], "end": entries[-1][1], "peak_load1": peak, "threshold_load1": THRESHOLD,
        # Not a CPU measurement: load only matters if it explains a timing failure, and the
        # scenario's errors say so if it does.
        "provisional": False,
        "reason": f"load1 peaked at {peak:.1f}; not a CPU test, recorded for timing failures only",
    }


def base(binary, binary_bytes, commit, notes):
    return {
        "schema_version": 1, "client": "native",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "provisional": False, "provisional_reasons": [],
        "build": {"version": "0.0.0-spike", "commit": commit, "stripped": False},
        "window_scale": 1,
        "env": {"platform": "linux", "display": "xvfb", "mode": "container", "cpus": CPUS, "sandbox": False,
                "window": {"width": 0, "height": 0, "device_scale_factor": 1},
                "renderer": {"name": "none: headless protocol rig, no window", "icd": None}},
        "disk": {"unpacked_bytes": binary_bytes, "file_count": 1, "top_level": [{"path": binary, "bytes": binary_bytes}],
                 "binary": {"bytes": binary_bytes, "stripped": False}, "artifacts": []},
        "cold_start_ms": None,
        "comparability_notes": notes,
    }


def t7_scenario(path, title, expected_runs=10):
    summary = json.loads((RESULTS / path / "summary.json").read_text())
    runs = summary["runs"]
    passed = [r for r in runs if r.get("ok")]
    worst = [r["worst_recover_ms"] for r in runs if r.get("worst_recover_ms") is not None]
    errors = [f"run {r['run']}: audible={r.get('ok_audible')} full_reconnect={r.get('full_reconnect_seen')} resubscribed={r.get('resubscribed')} missing={r.get('missing')} reason={r.get('reason')}" for r in runs if not r.get("ok")]
    ok = len(passed) == len(runs) and len(runs) >= expected_runs
    return {
        "title": title, "ok": ok, "provisional": False,
        "load": load_of([(r.get("load_start"), r.get("load_end")) for r in runs]),
        "errors": errors, **metrics("t7", ok),
        "aux": {"runs": len(runs), "passed": len(passed), "args": summary["args"],
                "worst_pair_recover_ms_after_heal": {"median": statistics.median(worst) if worst else None, "max": max(worst) if worst else None, "per_run": worst},
                "raw": f"results/{path}/"},
    }


def t8_cycles(path, title):
    analysis = json.loads((RESULTS / path / "analysis.json").read_text())
    return {"title": title, "ok": analysis["pass"], "provisional": False,
            "load": load_of([(analysis["load_start"], analysis["load_end"])]),
            "errors": [name for name, good in analysis["bars"].items() if not good],
            **metrics("t8", analysis["pass"]), "aux": dict(analysis, raw=f"results/{path}/")}


def t8_list(path, file, title):
    entries = json.loads((RESULTS / path / file).read_text())
    ok = all(e.get("ok") for e in entries)
    return {"title": title, "ok": ok, "provisional": False,
            "load": load_of([(e.get("load_start"), e.get("load_end")) for e in entries]),
            "errors": [f"{e['name']}: {e.get('error', 'a check failed')}" for e in entries if not e.get("ok")],
            **metrics("t8", ok), "aux": {"scenarios": entries, "raw": f"results/{path}/"}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", required=True)
    parser.add_argument("--binary-bytes-reconnect", type=int, required=True)
    parser.add_argument("--binary-bytes-sio", type=int, required=True)
    args = parser.parse_args()

    t7 = base("rig-reconnect", args.binary_bytes_reconnect, args.commit, [
        "T7 pass bar: every ordered pair audible by tone after a full reconnect in 10 of 10 runs, on resubscribed tracks.",
        "Audio is judged per publisher on NativeAudioStream's decoded PCM, Goertzel per 100 ms. No real audio device was involved.",
        "No Electron counterpart: this is a behaviour test, not a measurement to compare.",
        "cpu_pct_core and memory_mb are one 30 s sample of one participant with the tone running, on a loaded host, because the schema requires them. Never compare them.",
        "env.display and env.window are placeholders the schema requires: there is no window.",
    ])
    t7["scenarios"] = {
        "t7_netkill": t7_scenario("t7/netkill", "Victim's network dropped by tc for 30 s, mid-call, 3 participants"),
        "t7_lkrestart": t7_scenario("t7/lkrestart", "LiveKit server restarted mid-call, 3 participants"),
    }
    extra = RESULTS / "t7/netkill-long/summary.json"
    if extra.exists():
        t7["scenarios"]["t7_netkill_past_budget"] = t7_scenario("t7/netkill-long", "Characterisation, not the bar: outage past the SDK's 60 s reconnect budget, with an app-level rejoin", expected_runs=1)
    bar = ["t7_netkill", "t7_lkrestart"]
    t7["ok"] = all(t7["scenarios"][name]["ok"] for name in bar)

    t8 = base("rig-sio", args.binary_bytes_sio, args.commit, [
        "T8 pass bar: auth refresh works; 1,000 disconnect cycles with events flowing, no lost or duplicated events beyond web-client behaviour, by transcript diff against socket.io-client in a container; plus suspend and resume.",
        "The backend ran with WS_CONNECTION_RATE_LIMIT raised: the default of 10 per minute per address refuses most of 1,000 reconnects, for both clients.",
        "The 1,000 cycle run used a 100 ms reconnect base for both clients to fit the time box; the 100 cycle run uses the web's 1,000 ms.",
        "cpu_pct_core and memory_mb are one 30 s sample of the Rust client receiving 16 msg/s, on a loaded host, because the schema requires them. Never compare them.",
        "The bars cover newMessage. Presence is compared separately in results/t8/presence.json, since the server broadcasts it only on a change, to whoever is connected at that moment.",
        "results/t8/pre-fix holds the runs before the TCP_NODELAY and resume fixes, kept as the comparison.",
        "Refresh in the rig replays the login's refresh cookie. No special User-Agent. Never in a real client.",
        "env.display and env.window are placeholders the schema requires: there is no window.",
    ])
    t8["scenarios"] = {
        "t8_cycles": t8_cycles("t8/cycles", "1,000 disconnect cycles, events flowing, against socket.io-client"),
        "t8_cycles_web_delay": t8_cycles("t8/cycles-web-delay", "100 cycles with the web's 1 s reconnect delay and 2-4 s up"),
        "t8_cycles_ref_first": t8_cycles("t8/cycles-ref-first", "200 cycles, cutting socket.io-client first"),
        "t8_auth": t8_list("t8/auth", "auth.json", "Acks, refresh, reauthenticate, expiry, logout"),
        "t8_suspend": t8_list("t8/suspend", "suspend.json", "Suspend, freeze and stall, then resync"),
    }
    t8["ok"] = all(s["ok"] for s in t8["scenarios"].values())

    (RESULTS / "t7.json").write_text(json.dumps(t7, indent=1) + "\n")
    (RESULTS / "t8.json").write_text(json.dumps(t8, indent=1) + "\n")
    print(json.dumps({"t7_ok": t7["ok"], "t8_ok": t8["ok"]}))


if __name__ == "__main__":
    main()
