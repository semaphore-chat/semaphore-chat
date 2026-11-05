#!/usr/bin/env python3
"""CPU and memory of a container's main process, in the units the result schema wants.

    from sample-proc import sample  (loaded by path)

The schema makes a passing scenario carry cpu_pct_core and memory_mb. T7 and T8 aren't CPU tests
and ran on a loaded host, so these say only roughly what a rig costs. Never compare them.
"""
import os
import subprocess
import time
from pathlib import Path

CLK_TCK = os.sysconf("SC_CLK_TCK")


def host_pids(container):
    output = subprocess.run(["docker", "top", container, "-eo", "pid,comm"], capture_output=True, text=True, check=True).stdout
    return [line.split()[0] for line in output.splitlines()[1:] if "docker-init" not in line]


def ticks(pid):
    fields = Path(f"/proc/{pid}/stat").read_text().rpartition(")")[2].split()
    return int(fields[11]) + int(fields[12])


def memory_mb(pid):
    values = {}
    for line in Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines():
        key, _, rest = line.partition(":")
        if key in ("Pss", "Rss", "Anonymous"):
            values[key] = int(rest.split()[0]) / 1024
    return values


def sample(container, window_s=30):
    pid = host_pids(container)[0]
    series = []
    last_ticks, last_at = ticks(pid), time.monotonic()
    deadline = last_at + window_s
    memory = {}
    while time.monotonic() < deadline:
        time.sleep(1)
        now, current = time.monotonic(), ticks(pid)
        series.append(100 * (current - last_ticks) / CLK_TCK / (now - last_at))
        last_ticks, last_at = current, now
        memory = memory_mb(pid)
    ordered = sorted(series)
    return {
        "cpu_pct_core": {"avg": round(sum(series) / len(series), 2), "p95": round(ordered[int(0.95 * (len(ordered) - 1))], 2)},
        "memory_mb": {"primary_metric": "pss", "pss": round(memory["Pss"], 1), "rss": round(memory["Rss"], 1),
                      "anon": round(memory["Anonymous"], 1), "private_working_set": None, "pss_peak": None},
        "window_s": window_s, "container": container, "loadavg": Path("/proc/loadavg").read_text().strip(),
    }
