#!/usr/bin/env python3
"""Measure a release build of the native client and write baseline-schema result JSON.

    emit-result.py <binary> <out.json> [--window-s 30] [--commit SHA]

Runs inside the image: the shell window under Xvfb on lavapipe, sampling CPU and PSS from
/proc the same way the Electron baseline does. This is a Phase 0 shape check of the result
format: the shell draws a placeholder and is signed in to nothing, so its scenario is
named `phase0_shell_idle` and is deliberately not the baseline's `a_idle`.
"""
import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

CLK_TCK = os.sysconf("SC_CLK_TCK")
WINDOW = (1920, 1080, 1)
LAVAPIPE_ICD = "/usr/share/vulkan/icd.d/lvp_icd.json"


def read_loadavg():
    return Path("/proc/loadavg").read_text().strip()


def cpu_ticks(pid):
    # The command name can contain spaces, so fields are counted from its closing paren.
    fields = Path(f"/proc/{pid}/stat").read_text().rpartition(")")[2].split()
    return int(fields[11]) + int(fields[12])


def memory_mb(pid):
    values = {}
    for line in Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines():
        key, _, rest = line.partition(":")
        if key in ("Pss", "Rss", "Anonymous"):
            values[key] = int(rest.split()[0]) / 1024
    return values


def percentile(values, pct):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))]


def load_report(start, end, peak, threshold):
    provisional = peak is not None and peak > threshold
    return {
        "start": start,
        "end": end,
        "peak_load1": peak,
        "threshold_load1": threshold,
        "provisional": provisional,
        "reason": f"load1 peaked at {peak:.1f}, above {threshold:.1f}" if provisional else None,
    }


def start_xvfb():
    display = ":97"
    socket = Path("/tmp/.X11-unix/X97")
    process = subprocess.Popen(
        ["Xvfb", display, "-screen", "0", f"{WINDOW[0]}x{WINDOW[1]}x24"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 15
    while not socket.exists():
        if process.poll() is not None or time.monotonic() > deadline:
            sys.exit("Xvfb did not start")
        time.sleep(0.05)
    return process, display


def sample(binary, window_s):
    """One window of the running shell. Returns the scenario object for the schema."""
    threshold = (os.cpu_count() or 1) * 0.5
    load_start = read_loadavg()
    xvfb, display = start_xvfb()
    env = dict(os.environ, DISPLAY=display, VK_ICD_FILENAMES=LAVAPIPE_ICD, XDG_RUNTIME_DIR="/tmp")
    env.pop("WAYLAND_DISPLAY", None)
    app = subprocess.Popen([binary], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    title = "Shell window idle, signed in to nothing (Phase 0 format check)"
    try:
        cpu_series, pss_series, last_memory, peak = [], [], None, 0.0
        last_ticks, last_at = cpu_ticks(app.pid), time.monotonic()
        deadline = last_at + window_s
        while time.monotonic() < deadline:
            time.sleep(1)
            if app.poll() is not None:
                raise RuntimeError(f"app exited with {app.returncode}: {app.stderr.read()[-400:]}")
            now, ticks = time.monotonic(), cpu_ticks(app.pid)
            cpu_series.append(100 * (ticks - last_ticks) / CLK_TCK / (now - last_at))
            last_ticks, last_at = ticks, now
            last_memory = memory_mb(app.pid)
            pss_series.append(last_memory["Pss"])
            peak = max(peak, float(read_loadavg().split()[0]))
        load = load_report(load_start, read_loadavg(), peak, threshold)
        return {
            "title": title,
            "ok": True,
            "provisional": load["provisional"],
            "load": load,
            "errors": [],
            "window_s": window_s,
            "cpu_pct_core": {"avg": round(statistics.fmean(cpu_series), 2), "p95": round(percentile(cpu_series, 95), 2)},
            "memory_mb": {
                "primary_metric": "pss",
                "pss": round(last_memory["Pss"], 1),
                "rss": round(last_memory["Rss"], 1),
                "anon": round(last_memory["Anonymous"], 1),
                "private_working_set": None,
                "pss_peak": round(max(pss_series), 1),
            },
        }
    except (RuntimeError, OSError) as error:
        return {
            "title": title,
            "ok": False,
            "provisional": False,
            "load": load_report(load_start, read_loadavg(), None, threshold),
            "errors": [str(error)],
            "cpu_pct_core": None,
            "memory_mb": None,
            "readings": [],
        }
    finally:
        for process in (app, xvfb):
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def is_stripped(binary):
    output = subprocess.run(["file", binary], capture_output=True, text=True)
    if output.returncode != 0:
        return None
    return "not stripped" not in output.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary")
    parser.add_argument("out")
    parser.add_argument("--window-s", type=float, default=30)
    parser.add_argument("--commit", default=os.environ.get("GIT_COMMIT", "unknown"))
    args = parser.parse_args()

    binary = Path(args.binary).resolve()
    bytes_on_disk = binary.stat().st_size
    stripped = is_stripped(str(binary)) if shutil.which("file") else None
    scenario = sample(str(binary), args.window_s)

    reasons = [scenario["load"]["reason"]] if scenario["load"]["reason"] else []
    packages = subprocess.run(["pacman", "-Q", "mesa", "clang"], capture_output=True, text=True).stdout
    result = {
        "schema_version": 1,
        "client": "native",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ok": scenario["ok"],
        "provisional": scenario["provisional"],
        "provisional_reasons": reasons,
        "build": {"version": "0.0.0-phase0", "commit": args.commit, "stripped": stripped},
        "window_scale": 1,
        "env": {
            "platform": "linux",
            "display": "xvfb",
            "mode": "container",
            "cpus": os.cpu_count(),
            "sandbox": False,
            "window": {"width": WINDOW[0], "height": WINDOW[1], "device_scale_factor": WINDOW[2]},
            "renderer": {"name": "lavapipe", "icd": LAVAPIPE_ICD},
            "packages": dict(line.split(" ", 1) for line in packages.splitlines()),
        },
        "disk": {
            "unpacked_bytes": bytes_on_disk,
            "file_count": 1,
            "top_level": [{"path": binary.name, "bytes": bytes_on_disk}],
            "binary": {"bytes": bytes_on_disk, "stripped": stripped},
            "artifacts": [],
        },
        "cold_start_ms": None,
        "scenarios": {"phase0_shell_idle": scenario},
        "comparability_notes": [
            "Phase 0 format check, not a measurement of the client: a placeholder window, no sign-in, no message list, no voice.",
            "Not comparable with the baseline's a_idle, which is why the scenario has its own name.",
            "Lavapipe under Xvfb: RSS and PSS include software-Vulkan mappings, and CPU includes software rasterizing.",
        ],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps({"out": args.out, "ok": result["ok"], "provisional": result["provisional"],
                      "binary_bytes": bytes_on_disk, "stripped": stripped,
                      "cpu_pct_core": scenario["cpu_pct_core"], "memory_mb": scenario["memory_mb"]}))
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
