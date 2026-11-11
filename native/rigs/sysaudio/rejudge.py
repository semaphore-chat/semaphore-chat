#!/usr/bin/env python3
"""Re-judge stored T11 Linux runs with the current absent rule, without re-recording.

    rejudge.py <summary.json> <raw dir> [--out <file>]

Reads the 1 s windows kept in the raw files and replaces each run's absent checks with the ones
t11_judge.py gives; every other check (presence, onset, CPU, leftover links) is kept from the
summary, since the raw files have no 100 ms windows to recompute onsets from.

Runs recorded before the reference bin existed have no `ref` level. For them the reference is a
stand-in, measured the same way in the same window: the median of the bins of tones that this
scenario doesn't play (5 or 6 of 440, 587, 659, 880, 1013 and 1109 Hz). The output says which.
"""
import argparse
import json
import statistics
from pathlib import Path

import run
import t11_judge


def unplayed(scenario, window):
    skip = set(run.PRESENT[scenario]) | set(run.ABSENT.get(scenario, [])) | {"a3" if scenario == "L3" else "", t11_judge.REF}
    return [t for t in window["db"] if t not in skip]


def rejudge(summary_path, raw_dir):
    summary = json.loads(Path(summary_path).read_text())
    mode, call_ref = summary["mode"], summary["call_reference_db"]
    out = {"source": str(summary_path), "mode": mode, "absent_threshold_db": summary["absent_threshold_db"],
           "rule": "leak = above the threshold and >= 20 dB above the reference; glitch = above it but not; "
                   "> 5% glitch windows: too noisy to judge", "scenarios": {}}
    for s, entry in summary["scenarios"].items():
        runs = []
        for old in entry["detail"]:
            ev = [json.loads(line) for line in open(Path(raw_dir) / f"{s}-{old['run']}.jsonl")]
            slow, _, _, error = run.judged_windows(ev, mode)
            new = {"run": old["run"], "exit": old["exit"], "old_pass": old["pass"]}
            if error or not slow:
                new.update(pass_=False, error=error or "no windows")
                runs.append(new)
                continue
            if t11_judge.REF in slow[0]["db"]:
                ref_of, new["reference"] = t11_judge.ref_bin, f"{t11_judge.REF_HZ} Hz bin"
            else:
                names = unplayed(s, slow[0])
                ref_of = lambda w, names=names: statistics.median(w["db"][t] for t in names)  # noqa: E731
                new["reference"] = "stand-in: median of unplayed " + ",".join(names)
            checks, metrics = run.judge_absence(s, slow, call_ref, ref_of)
            kept = {k: v for k, v in old["checks"].items() if not k.startswith(("absent_", "judgeable_", "control_detected"))}
            new["checks"] = {**kept, **checks}
            new["absent"] = {k: {x: v[x] for x in ("leaks", "glitches", "glitch_share", "max_db", "leak_windows", "glitch_windows")}
                             for k, v in metrics.items() if k.endswith("_verdict")}
            if "control_detected" in metrics:
                new["control"] = metrics["control_detected"]
            new["pass_"] = all(new["checks"].values()) and old["exit"] == 0
            runs.append(new)
        for r in runs:
            r["pass"] = r.pop("pass_")
        passed = sum(1 for r in runs if r["pass"])
        ok = passed == len(runs)
        if s == "L3" and "onset_median_under_500ms" in entry:
            ok = ok and entry["onset_median_under_500ms"]
        out["scenarios"][s] = {"old": f"{entry['passed']}/{entry['runs']}", "passed": passed, "runs": len(runs),
                               "pass": ok, "detail": runs}
    out["pass"] = all(e["pass"] for e in out["scenarios"].values())
    return out


def table(result):
    lines = [f"{result['source']} ({result['mode']}): {'PASS' if result['pass'] else 'FAIL'}"]
    for s, e in result["scenarios"].items():
        leaks = sum(v["leaks"] for r in e["detail"] for v in r.get("absent", {}).values())
        glitches = sum(v["glitches"] for r in e["detail"] for v in r.get("absent", {}).values())
        noisy = [str(r["run"]) for r in e["detail"] if any(not v for k, v in r.get("checks", {}).items() if k.startswith("judgeable_"))]
        other = [f"{r['run']}:{k}" for r in e["detail"] for k, v in r.get("checks", {}).items()
                 if not v and not k.startswith(("absent_", "judgeable_"))]
        control = [r["control"]["leak_share"] for r in e["detail"] if "control" in r]
        lines.append(f"  {s:4} old {e['old']:>4}  new {e['passed']}/{e['runs']}  leak windows {leaks}  glitch windows {glitches}"
                     + (f"  too noisy: runs {','.join(noisy)}" if noisy else "")
                     + (f"  other failed checks: {' '.join(other)}" if other else "")
                     + (f"  control leak share {control}" if control else ""))
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("summary")
    parser.add_argument("raw")
    parser.add_argument("--out")
    args = parser.parse_args()
    result = rejudge(args.summary, args.raw)
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=1) + "\n")
    print(table(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
