#!/usr/bin/env python3
"""Judge a T11 desktop run: rig-sysaudio MODE=desktop output, on a real session.

    desk_judge.py <rig.jsonl> <summary.json> --game-db -26.02 [--leftover-links N] [--dry-run]

The game tone (played by the script through pw-play, a separate process) must be in the capture
within 6 dB of its level in at least 95% of 1 s windows; the call tone (played by the rig itself,
so ours) must never leak: no window above -80 dBFS and 20 dB above the unplayed 330 Hz reference.
Windows above -80 but not 20 dB above it are glitches, counted; more than 5% of them fails the run
as too noisy to judge (t11_judge.py). Prints a six-line summary.
"""
import argparse
import json
import statistics
import sys

import t11_judge


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("rig")
    parser.add_argument("summary")
    parser.add_argument("--game-db", type=float, required=True)
    parser.add_argument("--leftover-links", type=int, default=0)
    args = parser.parse_args()
    events = []
    with open(args.rig) as f:
        for raw in f:
            try:
                events.append(json.loads(raw))
            except ValueError:
                pass
    started = next((e["t"] for e in events if e.get("ev") == "capture_started"), None)
    done = next((e["t"] for e in events if e.get("ev") == "done"), None)
    slow = [e for e in events if e.get("ev") == "win" and e.get("span") == "slow"
            and started and e["t"] - 1000 >= started + 2000 and (done is None or e["t"] <= done)]
    a = [w["db"]["a"] for w in slow]
    call = t11_judge.judge_absent(slow, "b")
    a_share = sum(1 for v in a if abs(v - args.game_db) <= 6.0) / len(a) if a else 0.0
    checks = {
        "windows": len(slow) >= 10,
        "game_present": a_share >= 0.95,
        "call_absent": call["no_leak"],
        "judgeable": call["judgeable"],
        "no_links_left": args.leftover_links == 0,
    }
    verdicts = [e["msg"] for e in events if e.get("target") == "sysaudio" and str(e.get("msg", "")).startswith("node ")]
    summary = {
        "test": "T11 desktop", "pass": all(checks.values()), "checks": checks,
        "game_db_expected": args.game_db,
        "game": {"share_within_6db": round(a_share, 3), "median_db": statistics.median(a) if a else None},
        "call": call,
        "windows": len(slow), "leftover_links": args.leftover_links,
        "streams": verdicts,
        "errors": [e.get("msg") for e in events if e.get("ev") == "error" or e.get("level") in ("WARN", "ERROR")][:10],
    }
    with open(args.summary, "w") as f:
        json.dump(summary, f, indent=1)
        f.write("\n")
    print(f"T11 desktop: {'PASS' if summary['pass'] else 'FAIL'} ({len(slow)} windows)")
    print(f"  game tone in the share: {a_share:.0%} of windows within 6 dB of {args.game_db} dBFS (bar 95%)")
    print(f"  our call tone: {t11_judge.describe('b', call)}")
    print(f"  glitches (above -80 dBFS, < 20 dB over the {t11_judge.REF_HZ} Hz reference): {call['glitches']}"
          f" of {call['windows']} windows (bar {t11_judge.MAX_GLITCH_SHARE:.0%})")
    print(f"  links left in the graph after stopping: {args.leftover_links} (bar 0)")
    print(f"  streams seen: {'; '.join(verdicts[-8:]) or 'none'}")
    return 0 if summary["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
