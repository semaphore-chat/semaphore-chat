#!/usr/bin/env python3
"""T7 orchestrator: three participants in three network namespaces, faults, verdict by tone.

    run.py <netkill|lkrestart> --runs 10 --out results/t7/netkill [--outage-s 30] [--rejoin]

Runs on the host. Needs only docker and Python's standard library: `tc` runs inside the victim's
container (its own namespace), the rig binaries run in the pinned build image.

A run passes when every ordered pair of participants has the listener hearing the speaker's own
frequency for HOLD_S without a break, on a track subscribed after the fault. Pre-fault audio must
also have been heard by every pair, and the fault must have silenced the pairs it should.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[2]
ROOT = NATIVE.parent
LK = os.environ.get("LK_STACK_NAME", "t7-livekit")
KEY, SECRET = "devkey", "secret-that-is-at-least-32-characters-long"
TONES = {"a": 523, "b": 743, "c": 1013}
TONES_ARG = ",".join(f"{k}:{v}" for k, v in TONES.items())
HOLD_S = 3.0
PAIRS = [(l, s) for l in TONES for s in TONES if l != s]


def sh(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True)


def image():
    data = (NATIVE / "docker/Dockerfile.build").read_bytes() + (NATIVE / "rust-toolchain.toml").read_bytes()
    data += f"{os.getuid()}\n".encode()
    return "semaphore-native-build:" + hashlib.sha256(data).hexdigest()[:12]


def target_volume():
    return "semaphore-native-target-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:8]


def b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=")


def token(identity, room):
    now = int(time.time())
    claims = {"iss": KEY, "sub": identity, "name": identity, "nbf": now - 5, "exp": now + 7200,
              "video": {"room": room, "roomJoin": True, "canPublish": True, "canSubscribe": True}}
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()) + b"." + b64(json.dumps(claims).encode())
    return (head + b"." + b64(hmac.new(SECRET.encode(), head, hashlib.sha256).digest())).decode()


class Peer:
    def __init__(self, identity, room, run_id, rejoin):
        self.identity = identity
        self.name = f"t7-{run_id}-{identity}"
        self.lines = []
        self.lock = threading.Lock()
        args = ["docker", "run", "--rm", "--init", "--name", self.name, "--network", "semaphore-test",
                "--cap-add", "NET_ADMIN", "--user", f"{os.getuid()}:{os.getgid()}",
                "-v", f"{target_volume()}:/cache/target:ro",
                "-e", f"LK_URL=ws://{LK}:7880", "-e", f"LK_TOKEN={token(identity, room)}",
                "-e", f"IDENTITY={identity}", "-e", f"TONES={TONES_ARG}", "-e", f"REJOIN={'1' if rejoin else '0'}",
                image(), "/cache/target/debug/rig-reconnect"]
        self.process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for raw in self.process.stdout:
            try:
                line = json.loads(raw)
            except ValueError:
                line = {"ev": "stdout", "t": int(time.time() * 1000), "msg": raw.rstrip()}
            with self.lock:
                self.lines.append(line)

    def snapshot(self):
        with self.lock:
            return list(self.lines)

    def stop(self):
        sh("docker", "rm", "-f", self.name, check=False)
        self.process.wait(timeout=30)


def now_ms():
    return int(time.time() * 1000)


def good_since(lines, speaker, after_ms, at_ms):
    """When the current unbroken good stretch for `speaker` began, if it began after after_ms.
    Follows the newest stream only: that is the one a user would hear."""
    streams = {}
    for line in lines:
        if line.get("ev") == "tone" and line.get("from") == speaker:
            streams.setdefault(line["stream"], []).append(line)
        if line.get("ev") == "stream_end" and line.get("from") == speaker:
            streams.setdefault(line["stream"], []).append(line)
    if not streams:
        return None
    newest = streams[max(streams)]
    last = newest[-1]
    if last.get("ev") != "tone" or not last["good"] or last["t"] < after_ms:
        return None
    return last["t"]


def live(lines, speaker, within_ms, now):
    """The newest tally for this speaker is recent: frames are still arriving."""
    last_tally = None
    for line in lines:
        if line.get("ev") == "tally" and line.get("from") == speaker:
            last_tally = line
    return last_tally is not None and now - last_tally["t"] <= within_ms


def pair_ok(peers, listener, speaker, after_ms, interrupted):
    """The start of the good stretch if this pair has held HOLD_S, else None. A pair the fault
    should interrupt must have a stretch that began after the fault. One it shouldn't touch may
    have begun earlier, which is the point: it must never have broken."""
    now = now_ms()
    lines = peers[listener].snapshot()
    must_follow = after_ms if (listener in interrupted or speaker in interrupted) else 0
    start = good_since(lines, speaker, must_follow, now)
    if start is None or now - start < HOLD_S * 1000 or not live(lines, speaker, 2500, now):
        return None
    return start


def wait_audible(peers, after_ms, deadline_s, interrupted):
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        found = {(l, s): pair_ok(peers, l, s, after_ms, interrupted) for l, s in PAIRS}
        if all(found.values()):
            return found
        time.sleep(0.2)
    return None


def missing_pairs(peers, after_ms, interrupted):
    return [f"{l}<-{s}" for l, s in PAIRS if pair_ok(peers, l, s, after_ms, interrupted) is None]


def tc(container, *args):
    return sh("docker", "exec", "-u", "0", container, "tc", *args)


def kill_network(container):
    tc(container, "qdisc", "add", "dev", "eth0", "root", "netem", "loss", "100%")
    tc(container, "qdisc", "add", "dev", "eth0", "ingress")
    tc(container, "filter", "add", "dev", "eth0", "parent", "ffff:", "matchall", "action", "drop")


def heal_network(container):
    tc(container, "qdisc", "del", "dev", "eth0", "ingress")
    tc(container, "qdisc", "del", "dev", "eth0", "root")


def wait_livekit(deadline_s=60):
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        address = sh("docker", "inspect", "-f", '{{(index .NetworkSettings.Networks "semaphore-test").IPAddress}}', LK, check=False).stdout.strip()
        if address and subprocess.run(["curl", "-sf", "-o", "/dev/null", "-m", "1", f"http://{address}:7880"]).returncode == 0:
            return address
        time.sleep(0.1)
    raise RuntimeError("livekit did not come back")


def count(lines, ev, after, **match):
    return sum(1 for l in lines if l.get("ev") == ev and l.get("t", 0) >= after and all(l.get(k) == v for k, v in match.items()))


def loadavg():
    return Path("/proc/loadavg").read_text().strip()


def one_run(scenario, index, args, out_dir):
    run_id = uuid.uuid4().hex[:8]
    room = f"t7-{scenario}-{index}-{run_id}"
    record = {"run": index, "scenario": scenario, "room": room, "load_start": loadavg(), "started_at": now_ms()}
    peers = {identity: Peer(identity, room, run_id, args.rejoin) for identity in TONES}
    try:
        everyone = set(TONES)
        before = wait_audible(peers, 0, 45, everyone)
        record["pre_fault_audible"] = before is not None
        if before is None:
            record.update(ok=False, reason="never audible before the fault", missing=missing_pairs(peers, 0, everyone))
            return record
        victim = "a"
        interrupted = {victim} if scenario == "netkill" else everyone
        fault_at = now_ms()
        record["fault_at"] = fault_at
        if scenario == "netkill":
            kill_network(peers[victim].name)
            time.sleep(args.outage_s)  # The fault's own length, not a wait for anything.
            mid = missing_pairs(peers, fault_at, interrupted)
            heal_network(peers[victim].name)
        else:
            sh("docker", "restart", "-t", "0", LK)
            address = wait_livekit()
            record["livekit_ip_after"] = address
            mid = None
        healed_at = now_ms()
        record["healed_at"] = healed_at
        record["mid_fault_missing"] = mid
        audible = wait_audible(peers, fault_at, args.deadline_s, interrupted)
        done_at = now_ms()
        record["load_end"] = loadavg()
        record["ok_audible"] = audible is not None
        if audible:
            record["recover_ms"] = {f"{l}<-{s}": t - healed_at for (l, s), t in audible.items() if l in interrupted or s in interrupted}
            record["unbroken_pairs"] = [f"{l}<-{s}" for (l, s), t in audible.items() if t < fault_at]
            record["worst_recover_ms"] = max(record["recover_ms"].values())
        else:
            record["missing"] = missing_pairs(peers, fault_at, interrupted)
        evidence = {}
        restarted = sorted(interrupted)
        for identity, peer in peers.items():
            lines = peer.snapshot()
            sids = [l.get("sid") for l in lines if l.get("ev") in ("joined", "reconnected") and l.get("sid")]
            evidence[identity] = {
                "sids": sids,
                "new_sid": len(set(sids)) > 1,
                "track_subscribed_after_fault": count(lines, "track_subscribed", fault_at),
                "reconnecting": count(lines, "reconnecting", fault_at),
                "reconnected": count(lines, "reconnected", fault_at),
                "disconnected": count(lines, "disconnected", fault_at),
                "local_republished": count(lines, "local_republished", fault_at),
                "restart_attempts": sum(1 for l in lines if l.get("ev") == "sdk_log" and "restarting connection" in l.get("msg", "")),
                "resume_attempts": sum(1 for l in lines if l.get("ev") == "sdk_log" and "resuming connection" in l.get("msg", "")),
                "rejoined": count(lines, "joined", fault_at),
            }
        record["evidence"] = evidence
        full = all(evidence[i]["restart_attempts"] > 0 or evidence[i]["rejoined"] > 0 for i in restarted)
        resubscribed = all(
            any(l.get("ev") == "track_subscribed" and l.get("from") == s and l.get("t", 0) >= fault_at for l in peers[l_id].snapshot())
            for l_id, s in PAIRS if l_id in restarted or s in restarted)
        record["full_reconnect_seen"] = full
        record["resubscribed"] = resubscribed
        record["ok"] = bool(audible) and full and resubscribed
        record["duration_to_verdict_s"] = (done_at - fault_at) / 1000
        return record
    finally:
        for peer in peers.values():
            peer.stop()
        raw = out_dir / f"run-{index:02d}.jsonl"
        with raw.open("w") as handle:
            for identity, peer in peers.items():
                for line in peer.snapshot():
                    line["who_am_i"] = identity
                    handle.write(json.dumps(line) + "\n")
        subprocess.run(["gzip", "-f", str(raw)], check=False)


def sample_cost(args):
    """The rough number the result schema requires. Not a measurement to compare."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("sample_proc", NATIVE / "scripts/sample-proc.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    run_id = uuid.uuid4().hex[:8]
    peers = {identity: Peer(identity, f"t7-sample-{run_id}", run_id, False) for identity in TONES}
    try:
        if wait_audible(peers, 0, 45, set(TONES)) is None:
            raise SystemExit("never audible")
        Path(args.out).write_text(json.dumps(module.sample(peers["b"].name, 30), indent=1))
    finally:
        for peer in peers.values():
            peer.stop()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", choices=["netkill", "lkrestart", "sample"])
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--out", required=True)
    parser.add_argument("--outage-s", type=float, default=30)
    parser.add_argument("--deadline-s", type=float, default=90)
    parser.add_argument("--rejoin", action="store_true")
    args = parser.parse_args()
    if args.scenario == "sample":
        sample_cost(args)
        return
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = []
    for index in range(1, args.runs + 1):
        record = one_run(args.scenario, index, args, out_dir)
        runs.append(record)
        print(json.dumps({k: record.get(k) for k in ("run", "ok", "ok_audible", "full_reconnect_seen", "resubscribed", "worst_recover_ms", "reason", "missing", "load_end")}), flush=True)
        (out_dir / "summary.json").write_text(json.dumps({"scenario": args.scenario, "args": vars(args), "runs": runs}, indent=1))
    passed = sum(1 for r in runs if r.get("ok"))
    print(f"RESULT {args.scenario}: {passed}/{len(runs)}", flush=True)


if __name__ == "__main__":
    main()
