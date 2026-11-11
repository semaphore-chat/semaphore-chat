#!/usr/bin/env python3
"""Offline presence comparison of T8 transcripts. Reads only.

    presence.py results/t8/pre-fix/cycles results/t8/cycles ...

For each run: was a presence event ever missed by a client that was connected when the other got
it, and how long after connecting does the first client to connect see its own userOnline? The
second number tests the TCP_NODELAY explanation: the Rust client should match socket.io-client.
"""
import bisect
import collections
import gzip
import json
import sys
from pathlib import Path


def load(run, kind):
    with gzip.open(Path(run) / f"transcript-{kind}.jsonl.gz", "rt") as handle:
        lines = [json.loads(line) for line in handle]
    connected = {l["conn"]: l["t"] for l in lines if l.get("k") == "connected"}
    gone = {l["conn"]: l["t"] for l in lines if l.get("k") == "disconnected"}
    events = [(l["t"], l["e"], l["conn"]) for l in lines if l.get("e") in ("userOnline", "userOffline")]
    return connected, gone, events


def was_connected(connected, gone, at, margin):
    return any(start <= at - margin and gone.get(conn, 1 << 62) >= at + margin for conn, start in connected.items())


def analyze(run):
    data = {kind: load(run, kind) for kind in ("rust", "ref")}
    result = {"run": run, "counts": {}, "missed_while_connected_5ms": {}, "first_to_connect_ms": {}}
    for me, other in (("rust", "ref"), ("ref", "rust")):
        connected, gone, theirs = data[other]
        eligible = missed = 0
        for at, event, _ in data[me][2]:
            if not was_connected(connected, gone, at, 5):
                continue
            eligible += 1
            near = theirs[bisect.bisect_left(theirs, (at - 400,)):bisect.bisect_left(theirs, (at + 401,))]
            if not any(name == event for _, name, _ in near):
                missed += 1
        result["missed_while_connected_5ms"][other] = {"eligible": eligible, "missed": missed}
    for kind in ("rust", "ref"):
        connected, _, events = data[kind]
        others = data["ref" if kind == "rust" else "rust"][0]
        delays = sorted(at - connected[conn] for at, name, conn in events if name == "userOnline" and conn in others and connected[conn] < others[conn])
        pick = lambda pct: delays[min(len(delays) - 1, int(pct / 100 * len(delays)))] if delays else None
        result["counts"][kind] = dict(collections.Counter(name for _, name, _ in events))
        result["first_to_connect_ms"][kind] = {"n": len(delays), "p50": pick(50), "p90": pick(90), "p99": pick(99), "max": delays[-1] if delays else None,
                                               "under_5ms": sum(d < 5 for d in delays)}
    return result


if __name__ == "__main__":
    print(json.dumps([analyze(run) for run in sys.argv[1:]], indent=1))
