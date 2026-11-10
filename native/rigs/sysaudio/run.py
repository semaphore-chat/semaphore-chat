#!/usr/bin/env python3
"""T11 orchestrator: scenarios L1-L10, each in its own headless PipeWire container, judged by tone.

    run.py --mode livekit --runs 5 [--scenarios L1,L2,...] [--profile release] [--parallel 4]
    run.py --mode local   --runs 1 --scenarios L1,L9          # fast iteration, no LiveKit

Runs on the host with docker and Python's standard library. Each run is one container from the
sysaudio image on `semaphore-test` (livekit) or no network (local); nothing creates a network.
The LiveKit server comes from scripts/lk-stack.sh. Results: results/t11/<mode>.json, plus the
events of every run (slow windows and events, no 100 ms windows) under results/t11/raw/<mode>/.

Bars (fixed in the design before any run; see docs/spike-results.md, T11):
  present  level within 6 dB of nominal (-12.04 dBFS) in at least 95% of 1 s windows
  absent   every 1 s window at or below min(L9 call level - 50 dB, -80 dBFS)
  L3       mid-share stream heard within 1.0 s (local) / 1.5 s (viewer); viewer median under 0.5 s
  L9       negative control valid: call tone within 6 dB of the game tone
  L10      10 min soak: as L1, at most 1 dropped 10 ms block per minute, capture threads under
           2% of a core (provisional on a shared host)
"""
import argparse
import base64
import hashlib
import hmac
import json
import math
import os
import statistics
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[2]
ROOT = NATIVE.parent
RIG = NATIVE / "rigs/sysaudio"
LK_NAME = os.environ.get("LK_STACK_NAME", "t11-livekit")
KEY, SECRET = "devkey", "secret-that-is-at-least-32-characters-long"
NOMINAL = 20 * math.log10(0.25)
PRESENT_DB, PRESENT_SHARE = 6.0, 0.95
ABSENT_BELOW_CALL, ABSENT_FLOOR = 50.0, -80.0
WARMUP_MS = 2000
ALL = [f"L{i}" for i in range(1, 11)]

PRESENT = {
    "L1": ["a"], "L2": ["a2"], "L3": ["a"], "L4": ["a", "d"], "L5": ["a"],
    "L6": ["a", "mono", "fc"], "L7": ["a"], "L8": ["a"], "L9": ["a", "b"], "L10": ["a"],
}
ABSENT = {s: ["b"] for s in ALL if s != "L9"}
ABSENT["L7"] = ["b", "m"]
WHAT = {
    "L1": "PulseAudio game, our call audio playing",
    "L2": "native PipeWire game",
    "L3": "a game that starts 6 s into the share",
    "L4": "a game on a second sink; our call moved to that sink mid-share",
    "L5": "our call output reopened mid-share (local: new stream; share: switched to the second sink)",
    "L6": "mono game, and a 5.1 game with sound only in the centre channel",
    "L7": "a live microphone (440 Hz test source, being recorded) next to the share",
    "L8": "our call moved into an effects chain (pw-loopback) mid-share",
    "L9": "negative control: our own streams included on purpose",
    "L10": "10 minute soak of L1",
}


def sh(*args, check=True, env=None):
    return subprocess.run(args, check=check, capture_output=True, text=True, env=env)


def image():
    return sh(str(RIG / "image.sh")).stdout.strip()


def target_volume():
    return "semaphore-native-target-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:8]


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def token(identity, room):
    now = int(time.time())
    claims = {"iss": KEY, "sub": identity, "name": identity, "nbf": now - 5, "exp": now + 7200,
              "video": {"room": room, "roomJoin": True, "canPublish": True, "canSubscribe": True,
                        "canUpdateOwnMetadata": True}}
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()) + b"." + b64(json.dumps(claims).encode())
    return (head + b"." + b64(hmac.new(SECRET.encode(), head, hashlib.sha256).digest())).decode()


def one_run(scenario, index, mode, args, lk_url, img):
    name = f"t11-{scenario.lower()}-{index}-{uuid.uuid4().hex[:6]}"
    room = name
    cmd = ["docker", "run", "--rm", "--init", "--name", name,
           "--network", "semaphore-test" if mode == "livekit" else "none",
           "--user", f"{os.getuid()}:{os.getgid()}",
           # What rtkit gives PipeWire on a desktop: realtime priority for its data threads.
           # Without it a loaded host makes the graph skip quanta (T11's first runs).
           *(["--cap-add", "SYS_NICE", "--ulimit", "rtprio=95", "--ulimit", "memlock=-1"] if args.rt else []),
           "-v", f"{target_volume()}:/cache/target:ro", "-v", f"{NATIVE}:{NATIVE}", "-w", str(RIG)]
    if mode == "livekit":
        cmd += ["-e", f"LK_URL={lk_url}", "-e", f"LK_TOKEN_SHARE={token('sharer', room)}",
                "-e", f"LK_TOKEN_VIEW={token('viewer', room)}"]
    cmd += [img, "./pw-session.sh", "python3", "scenario.py", scenario, mode, f"/cache/target/{args.profile}/rig-sysaudio"]
    timeout = 900 if scenario == "L10" else 180
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        output, code = done.stdout + done.stderr, done.returncode
    except subprocess.TimeoutExpired as expired:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
        output, code = (expired.stdout or b"").decode() if isinstance(expired.stdout, bytes) else (expired.stdout or ""), "timeout"
    events = []
    for raw in output.splitlines():
        try:
            events.append(json.loads(raw))
        except ValueError:
            events.append({"ev": "text", "msg": raw[:400]})
    return {"scenario": scenario, "run": index, "exit": code, "events": events}


def first(events, ev, **match):
    for e in events:
        if e.get("ev") == ev and all(e.get(k) == v for k, v in match.items()):
            return e
    return None


def windows(events, role, span):
    return [e for e in events if e.get("ev") == "win" and e.get("role") == role and e.get("span") == span]


def evaluate(result, mode, call_ref):
    s, ev = result["scenario"], result["events"]
    role = "local" if mode == "local" else "viewer"
    sharer = "local" if mode == "local" else "share"
    started = first(ev, "capture_started", src=sharer)
    done = first(ev, "done", src=sharer)
    out = {"run": result["run"], "exit": result["exit"], "checks": {}, "metrics": {}}
    if not started or not done:
        out["pass"] = False
        out["error"] = "sharer never started or never finished: " + "; ".join(
            e.get("msg", "") for e in ev if e.get("ev") in ("text", "error"))[:600]
        return out
    begin = started["t"]
    viewer_first = first(ev, "first_frame")
    if mode == "livekit":
        if not viewer_first:
            out["pass"] = False
            out["error"] = "viewer never received the screen share audio track"
            return out
        begin = max(begin, viewer_first["t"])
        out["metrics"]["viewer_channels"] = viewer_first.get("channels")
    slow = [w for w in windows(ev, role, "slow") if w["t"] - 1000 >= begin + WARMUP_MS and w["t"] <= done["t"]]
    fast = [w for w in windows(ev, role, "fast") if w["t"] - 100 >= begin and w["t"] <= done["t"]]
    out["metrics"]["windows"] = len(slow)
    if len(slow) < (500 if s == "L10" else 10):
        out["checks"]["enough_windows"] = False
    a3_start = None
    if s == "L3":
        game = first(ev, "game_started", game="a3")
        a3_start = game["t"] if game else None

    def present(tone, ws):
        if not ws:
            return False, {}
        levels = [w["db"][tone] for w in ws]
        good = sum(1 for v in levels if abs(v - NOMINAL) <= PRESENT_DB)
        share = good / len(levels)
        return share >= PRESENT_SHARE, {"share_within_6db": round(share, 3), "median_db": statistics.median(levels),
                                        "min_db": min(levels), "max_db": max(levels)}

    for tone in PRESENT[s]:
        ok, m = present(tone, slow)
        out["checks"][f"present_{tone}"] = ok
        out["metrics"][f"present_{tone}"] = m
    if s == "L3":
        if a3_start is None:
            out["checks"]["present_a3"] = False
        else:
            later = [w for w in slow if w["t"] - 1000 >= a3_start + 1500]
            ok, m = present("a3", later)
            out["checks"]["present_a3"] = ok
            out["metrics"]["present_a3"] = m
            onset = next((w["t"] - a3_start for w in fast if w["t"] >= a3_start and w["db"]["a3"] >= NOMINAL - PRESENT_DB), None)
            out["metrics"]["a3_onset_ms"] = onset
            out["checks"]["a3_onset"] = onset is not None and onset <= (1000 if mode == "local" else 1500)
    threshold = min(call_ref - ABSENT_BELOW_CALL, ABSENT_FLOOR)
    # Not a bar: how far the absent tone stands above tones nobody plays, in the same window. A
    # leak puts it far above them; decoder noise (a concealed packet) raises them all together.
    controls = [t for t in slow[0]["db"] if t not in PRESENT[s] and t not in ABSENT.get(s, []) and t != "a3"] if slow else []
    for tone in ABSENT.get(s, []):
        margins = [w["db"][tone] - max(w["db"][c] for c in controls) for w in slow if controls]
        if margins:
            out["metrics"][f"{tone}_above_unplayed_tones_max_db"] = round(max(margins), 2)
    for tone in ABSENT.get(s, []):
        levels = [w["db"][tone] for w in slow]
        fast_levels = [w["db"][tone] for w in fast]
        out["checks"][f"absent_{tone}"] = bool(levels) and max(levels) <= threshold
        out["metrics"][f"absent_{tone}"] = {"threshold_db": round(threshold, 2), "max_db": max(levels) if levels else None,
                                            "median_db": statistics.median(levels) if levels else None,
                                            "max_fast_db": max(fast_levels) if fast_levels else None}
    if s == "L9":
        a = statistics.median(w["db"]["a"] for w in slow)
        b = statistics.median(w["db"]["b"] for w in slow)
        out["checks"]["control_valid"] = abs(a - b) <= 6.0
        out["metrics"]["control"] = {"a_median_db": a, "b_median_db": b}
    if s == "L7":
        decoy = first(ev, "decoy_mic")
        live = decoy and isinstance(decoy.get("db"), (int, float)) and decoy["db"] > -30
        out["checks"]["decoy_mic_live"] = bool(live)
        out["metrics"]["decoy_mic_db"] = decoy.get("db") if decoy else None
    if s == "L8":
        move = first(ev, "moved_ours")
        if move:
            near = [w["db"]["b"] for w in fast if abs(w["t"] - move["t"]) <= 1000]
            out["metrics"]["b_max_fast_db_within_1s_of_move"] = max(near) if near else None
    if s == "L1" and slow:
        out["metrics"]["stereo_a_db"] = {"left": statistics.median(w["l"]["a"] for w in slow),
                                         "right": statistics.median(w["r"]["a"] for w in slow)}
    cpu = first(ev, "cpu", src=sharer)
    if cpu:
        out["metrics"]["cpu"] = {"wall_s": round(cpu["wall_s"], 1), "process_s": cpu["process_s"],
                                 "capture_s": cpu["capture_s"],
                                 "capture_core_share": round(cpu["capture_s"] / cpu["wall_s"], 4)}
    dropped = first(ev, "dropped", src=sharer)
    if dropped:
        out["metrics"]["dropped_frames"] = dropped["frames"]
    if s == "L10":
        minutes = (cpu["wall_s"] if cpu else 600) / 60
        if mode == "livekit":
            out["checks"]["dropped_per_minute"] = dropped is not None and dropped["frames"] / minutes <= 1.0
        out["checks"]["capture_cpu_provisional"] = bool(cpu) and cpu["capture_s"] / cpu["wall_s"] < 0.02
    leftover = first(ev, "leftover")
    if leftover:
        out["checks"]["nothing_left_in_graph"] = leftover["nodes"] == 0 and leftover["links"] == 0
    out["verdicts"] = [e.get("msg") for e in ev if e.get("target") == "sysaudio" and str(e.get("msg", "")).startswith("node ")]
    out["errors"] = [e.get("msg") for e in ev if e.get("ev") == "error" or e.get("level") in ("WARN", "ERROR")][:10]
    out["pass"] = all(out["checks"].values()) and result["exit"] == 0
    return out


def keep(event):
    """What goes into the committed raw file: events and 1 s windows, not 100 ms ones or debug."""
    if event.get("ev") == "win":
        return event.get("span") == "slow"
    if event.get("ev") == "log":
        return event.get("level") != "DEBUG"
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["local", "livekit"], default="livekit")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--scenarios", default=",".join(ALL))
    parser.add_argument("--profile", default="release")
    parser.add_argument("--parallel", type=int, default=3)
    parser.add_argument("--no-rt", dest="rt", action="store_false",
                        help="no realtime priority for PipeWire in the container (the first runs had none)")
    parser.add_argument("--out", default=str(NATIVE / "results/t11"))
    args = parser.parse_args()
    scenarios = args.scenarios.split(",")
    out_dir = Path(args.out)
    raw_dir = out_dir / "raw" / args.mode
    raw_dir.mkdir(parents=True, exist_ok=True)
    img = image()
    lk_url = None
    if args.mode == "livekit":
        lk_url = sh(str(NATIVE / "scripts/lk-stack.sh"), "up", env={**os.environ, "LK_STACK_NAME": LK_NAME}).stdout.strip()
        print(f"livekit at {lk_url}", flush=True)
    try:
        jobs = [(s, i) for s in scenarios for i in range(1, args.runs + 1)]
        # The soak runs together at the end, so they don't hold up everything else.
        jobs.sort(key=lambda job: job[0] == "L10")
        with ThreadPoolExecutor(max_workers=args.parallel) as pool:
            results = list(pool.map(lambda job: one_run(job[0], job[1], args.mode, args, lk_url, img), jobs))
    finally:
        if args.mode == "livekit":
            sh(str(NATIVE / "scripts/lk-stack.sh"), "down", check=False, env={**os.environ, "LK_STACK_NAME": LK_NAME})
    for result in results:
        with open(raw_dir / f"{result['scenario']}-{result['run']}.jsonl", "w") as f:
            for event in result["events"]:
                if keep(event):
                    f.write(json.dumps(event) + "\n")

    controls = []
    for result in results:
        if result["scenario"] == "L9":
            levels = [w["db"]["b"] for w in windows(result["events"], "local" if args.mode == "local" else "viewer", "slow")]
            if levels:
                controls.append(statistics.median(levels))
    call_ref = statistics.median(controls) if controls else NOMINAL
    summary = {"test": "T11", "mode": args.mode, "profile": args.profile, "runs_per_scenario": args.runs,
               "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "commit": sh("git", "-C", str(ROOT), "rev-parse", "HEAD").stdout.strip(),
               "call_reference_db": round(call_ref, 2), "call_reference_from": "L9 median" if controls else "nominal",
               "absent_threshold_db": round(min(call_ref - ABSENT_BELOW_CALL, ABSENT_FLOOR), 2),
               "scenarios": {}}
    for s in scenarios:
        runs = [evaluate(r, args.mode, call_ref) for r in results if r["scenario"] == s]
        passed = sum(1 for r in runs if r["pass"])
        entry = {"what": WHAT[s], "commit": summary["commit"], "parallel": args.parallel, "realtime": args.rt, "passed": passed,
                 "runs": len(runs), "pass": passed == len(runs), "detail": runs}
        failed_absent = [r["metrics"].get("b_above_unplayed_tones_max_db") for r in runs]
        if any(v is not None for v in failed_absent):
            entry["b_above_unplayed_tones_max_db"] = max(v for v in failed_absent if v is not None)
        if s == "L3":
            onsets = [r["metrics"].get("a3_onset_ms") for r in runs if r["metrics"].get("a3_onset_ms") is not None]
            entry["a3_onset_ms_median"] = statistics.median(onsets) if onsets else None
            if args.mode == "livekit":
                entry["onset_median_under_500ms"] = bool(onsets) and statistics.median(onsets) < 500
                entry["pass"] = entry["pass"] and entry["onset_median_under_500ms"]
        summary["scenarios"][s] = entry
        print(f"{s}: {passed}/{len(runs)} {'PASS' if entry['pass'] else 'FAIL'}  {WHAT[s]}", flush=True)
    summary["pass"] = all(e["pass"] for e in summary["scenarios"].values())
    path = out_dir / f"{args.mode}.json"
    if path.exists() and set(scenarios) != set(ALL):
        # A partial rerun updates its scenarios and keeps the rest.
        old = json.loads(path.read_text())
        old["scenarios"].update(summary["scenarios"])
        summary["scenarios"] = old["scenarios"]
        summary["pass"] = all(e["pass"] for e in summary["scenarios"].values())
    path.write_text(json.dumps(summary, indent=1) + "\n")
    print(f"wrote {path}: {'PASS' if summary['pass'] else 'FAIL'}")
    return 0 if summary["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
