#!/usr/bin/env python3
"""U11's real-server proofs, on the host, with only docker and the standard library.

    proof.py rejoin <netkill|lkrestart> --runs 3 [--outage-s 90]
    proof.py bench [--seconds 20] [--rounds 3] [--cpuset 0-3]
    proof.py shots
    proof.py window [--seconds 40] [--rgba]
    proof.py real-audio [--server pulseaudio|pipewire]

Peers are `voice_rig` containers on semaphore-test: nothing is published and no network is made.
A rejoin run passes only when every ordered pair hears the other's own frequency for HOLD_S after
the fault, video is flowing again, and the fault demonstrably silenced what it should have.
"""
import argparse, hashlib, json, os, statistics, subprocess, threading, time, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[2]
ROOT = NATIVE.parent
RESULTS = HERE / "results"
LK = os.environ.get("LK_STACK_NAME", "u11-livekit")
TONES = {"a": 523, "b": 743, "c": 1013}
HOLD_S = 3.0
HEARD = 800
SILENT = 80
PAIRS = [(l, s) for l in TONES for s in TONES if l != s]
RIG = "/cache/target/release/examples/voice_rig"


def sh(*args, check=True, **kw):
    return subprocess.run(args, check=check, capture_output=True, text=True, **kw)


def image():
    data = (NATIVE / "docker/Dockerfile.build").read_bytes() + (NATIVE / "rust-toolchain.toml").read_bytes()
    data += f"{os.getuid()}\n".encode()
    return "semaphore-native-build:" + hashlib.sha256(data).hexdigest()[:12]


def target_volume():
    return "semaphore-native-target-" + hashlib.sha256(str(ROOT).encode()).hexdigest()[:8]


def lk_stack(*args):
    return sh(str(NATIVE / "scripts/lk-stack.sh"), *args, env={**os.environ, "LK_STACK_NAME": LK}).stdout.strip()


def run_args(name, env, extra=()):
    args = ["docker", "run", "--rm", "--init", "--name", name, "--network", "semaphore-test",
            "--user", f"{os.getuid()}:{os.getgid()}", "-v", f"{target_volume()}:/cache/target:ro",
            "-v", f"{ROOT}:{ROOT}", "-w", str(NATIVE), "-e", f"LK_URL=ws://{LK}:7880",
            "-e", "VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json", "-e", "XDG_RUNTIME_DIR=/tmp"]
    for key, value in env.items():
        args += ["-e", f"{key}={value}"]
    return args + list(extra) + [image()]


class Container:
    def __init__(self, name, command, env=None, extra=()):
        self.name = name
        self.lines = []
        self.lock = threading.Lock()
        self.process = subprocess.Popen(run_args(name, env or {}, extra) + command, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, text=True)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for raw in self.process.stdout:
            try:
                line = json.loads(raw)
            except ValueError:
                line = {"raw": raw.rstrip(), "t": int(time.time() * 1000)}
            with self.lock:
                self.lines.append(line)

    def snapshot(self):
        with self.lock:
            return list(self.lines)

    def stop(self):
        sh("docker", "rm", "-f", self.name, check=False)
        self.process.wait(timeout=30)


def wait_for(what, check, deadline_s):
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.2)
    raise TimeoutError(what)


def reports(lines):
    return [line for line in lines if "heard" in line]


def good_since(lines, speaker):
    """When the current unbroken stretch of hearing this speaker began."""
    start = None
    for line in reversed(reports(lines)):
        if line["heard"].get(speaker, 0) < HEARD:
            break
        start = line["t"]
    return start


def all_audible(peers, after_ms, interrupted):
    now = time.time() * 1000
    found = {}
    for listener, speaker in PAIRS:
        lines = peers[listener].snapshot()
        start = good_since(lines, speaker)
        floor = after_ms if (listener in interrupted or speaker in interrupted) else 0
        if start is None or start < floor or now - start < HOLD_S * 1000:
            return None
        found[(listener, speaker)] = start
    return found


def video_flowing(peers, after_ms, identity="cam-1"):
    """Every peer's frame count for the publisher rose after the fault."""
    for peer in peers.values():
        after = [l["video"].get(identity, 0) for l in reports(peer.snapshot()) if l["t"] >= after_ms and identity in l.get("video", {})]
        if len(after) < 8 or after[-1] <= after[-8]:
            return False
    return True


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
    def up():
        address = sh("docker", "inspect", "-f", '{{(index .NetworkSettings.Networks "semaphore-test").IPAddress}}', LK, check=False).stdout.strip()
        return address and subprocess.run(["curl", "-sf", "-o", "/dev/null", "-m", "1", f"http://{address}:7880"]).returncode == 0
    return wait_for("livekit back", up, deadline_s)


def rejoin_run(scenario, index, args):
    run_id = uuid.uuid4().hex[:6]
    room = f"u11-{scenario}-{index}-{run_id}"
    tones = ",".join(f"{k}:{v}" for k, v in TONES.items())
    publisher = Container(f"u11-pub-{run_id}", ["nice", "-n", "10", RIG, "publish", room, "1", "0"])
    peers = {i: Container(f"u11-{run_id}-{i}", [RIG, "participant"],
                          {"LK_ROOM": room, "IDENTITY": i, "HZ": TONES[i], "TONES": tones, "WANT_VIDEO": "1", "RUST_LOG": "warn"},
                          ["--cap-add", "NET_ADMIN"]) for i in TONES}
    record = {"run": index, "scenario": scenario, "room": room, "started_at": int(time.time() * 1000)}
    try:
        everyone = set(TONES)
        wait_for("audible before the fault", lambda: all_audible(peers, 0, everyone), 45)
        wait_for("video before the fault", lambda: video_flowing(peers, 0), 45)
        victim = "a"
        interrupted = {victim} if scenario == "netkill" else everyone
        fault_at = int(time.time() * 1000)
        record["fault_at"] = fault_at
        if scenario == "netkill":
            kill_network(peers[victim].name)
            time.sleep(args.outage_s)  # The fault's own length.
            bystanders_mid = [peers["b"].snapshot()[-1], peers["c"].snapshot()[-1]]
            record["mid_fault_b_hears_a"] = bystanders_mid[0]["heard"].get("a")
            record["mid_fault_a_status"] = None
            heal_network(peers[victim].name)
        else:
            sh("docker", "restart", "-t", "0", LK)
            wait_livekit()
        healed_at = int(time.time() * 1000)
        record["healed_at"] = healed_at
        found = wait_for("audible after the fault", lambda: all_audible(peers, fault_at, interrupted), args.deadline_s)
        record["worst_recover_ms"] = max(t - healed_at for (l, s), t in found.items() if l in interrupted or s in interrupted)
        record["recover_ms"] = {f"{l}<-{s}": t - healed_at for (l, s), t in found.items() if l in interrupted or s in interrupted}
        record["unbroken_pairs"] = [f"{l}<-{s}" for (l, s), t in found.items() if t < fault_at]
        wait_for("video after the fault", lambda: video_flowing(peers, healed_at), 60)
        record["video_back_ms"] = int(time.time() * 1000) - healed_at
        finals = {i: reports(p.snapshot())[-1] for i, p in peers.items()}
        record["status"] = {i: f["status"] for i, f in finals.items()}
        record["rejoins"] = {i: f["rejoins"] for i, f in finals.items()}
        record["people"] = {i: f["people"] for i, f in finals.items()}
        statuses = [
            (i, l["status"]) for i, p in peers.items() for l in reports(p.snapshot()) if l["t"] >= fault_at
        ]
        record["saw_reconnecting"] = sorted({i for i, s in statuses if s == "Reconnecting"})
        fault_real = scenario != "netkill" or record["mid_fault_b_hears_a"] < SILENT
        record["ok"] = fault_real and all(f["status"] == "Connected" for f in finals.values())
        if scenario == "netkill" and args.outage_s > 70:
            # Past the SDK's budget: only our own rejoin can have brought the victim back.
            record["ok"] = record["ok"] and finals["a"]["rejoins"] >= 1
        return record
    except TimeoutError as error:
        record.update(ok=False, reason=str(error))
        record["last"] = {i: (reports(p.snapshot()) or [None])[-1] for i, p in peers.items()}
        return record
    finally:
        for container in [*peers.values(), publisher]:
            container.stop()


def rejoin(args):
    lk_stack("up", "200")
    out = RESULTS / f"rejoin-{args.scenario}-{int(args.outage_s)}s.json"
    runs = []
    try:
        for index in range(1, args.runs + 1):
            record = rejoin_run(args.scenario, index, args)
            runs.append(record)
            print(json.dumps({k: record.get(k) for k in ("run", "ok", "worst_recover_ms", "video_back_ms", "rejoins", "saw_reconnecting", "unbroken_pairs", "reason", "last")}), flush=True)
            out.write_text(json.dumps({"scenario": args.scenario, "outage_s": args.outage_s, "runs": runs}, indent=1))
    finally:
        lk_stack("down")
    passed = sum(1 for r in runs if r.get("ok"))
    print(f"RESULT rejoin {args.scenario} {args.outage_s}s: {passed}/{len(runs)}", flush=True)
    return passed == len(runs)


def wait_publishing(publisher, count):
    wait_for("publishers up", lambda: any(l.get("raw", "").startswith(f"publishing {count}") for l in publisher.snapshot()), 90)


def bench(args):
    lk_stack("up", "200")
    run_id = uuid.uuid4().hex[:6]
    room = f"u11-bench-{run_id}"
    label = f"cpuset-{args.cpuset}" if args.cpuset else "unpinned"
    out = RESULTS / f"decode-{label}.json"
    # Not niced: on a busy machine a starved encoder would deliver fewer frames, and the bench would
    # credit that to whatever policy it was measuring. Each row records what really arrived.
    publisher = Container(f"u11-benchpub-{run_id}", [RIG, "publish", room, "9", "1"])
    extra = ["--cpuset-cpus", args.cpuset] if args.cpuset else []
    try:
        wait_publishing(publisher, 10)
        name = f"u11-bench-{run_id}"
        cmd = run_args(name, {"RUST_LOG": "warn"}, extra) + [RIG, "bench", room, str(out), str(args.seconds), str(args.rounds)]
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
            for line in process.stdout:
                print(line.rstrip()[:240], flush=True)
        rows = json.loads(out.read_text())
        summarize(rows, label)
    finally:
        publisher.stop()
        lk_stack("down")


def summarize(rows, label):
    table = {}
    for row in rows:
        table.setdefault(row["condition"], []).append(row)
    print(f"\n{label}: condition | cpu median (worst) % of a core | camera fps | screen fps | Mbps | settled")
    for name, group in table.items():
        cpu = [r["cpu_percent_of_core"] for r in group]
        fps = [max(r["camera_fps"]) for r in group]
        print(f"{name:26} | {statistics.median(cpu):6.1f} ({max(cpu):6.1f}) | {statistics.median(fps):5.1f} | "
              f"{statistics.median(r['screen_fps'] for r in group):5.1f} | {statistics.median(r['inbound_mbps'] for r in group):6.2f} | "
              f"{all(r['settled'] for r in group)} h={group[0]['camera_heights'][0]}/{group[0]['screen_height']}", flush=True)


SHOTS = [
    # name, width, height, layout
    ("live-nine-grid", 1280, 720, "grid-no-share"),
    ("live-stage-share", 1280, 720, "stage"),
    ("live-phone-grid", 390, 844, "grid-no-share"),
]


def shots(args):
    lk_stack("up", "200")
    run_id = uuid.uuid4().hex[:6]
    room = f"u11-shots-{run_id}"
    publisher = Container(f"u11-shotpub-{run_id}", ["nice", "-n", "10", RIG, "publish", room, "9", "1"])
    out_dir = RESULTS / "live"
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        wait_publishing(publisher, 10)
        for name, width, height, layout in SHOTS:
            path = out_dir / f"{name}.png"
            result = sh("docker", *run_args(f"u11-shot-{run_id}", {"RUST_LOG": "warn"})[1:], RIG, "shot", room, str(width), str(height), layout, str(path), check=False, timeout=180)
            print(result.stdout.strip()[-1400:], result.stderr.strip()[-600:], flush=True)
            if result.returncode:
                return False
    finally:
        publisher.stop()
        lk_stack("down")
    return True


def window(args):
    lk_stack("up", "200")
    run_id = uuid.uuid4().hex[:6]
    room = f"u11-window-{run_id}"
    publisher = Container(f"u11-winpub-{run_id}", ["nice", "-n", "10", RIG, "publish", room, "9", "1"])
    try:
        wait_publishing(publisher, 10)
        command = ["xvfb-run", "-a", "-s", "-screen 0 1280x720x24", RIG, "window", room, str(args.seconds)] + (["--rgba"] if args.rgba else [])
        cmd = run_args(f"u11-window-{run_id}", {"RUST_LOG": "warn"}) + command
        with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
            for line in process.stdout:
                print(line.rstrip()[:700], flush=True)
    finally:
        publisher.stop()
        lk_stack("down")


def real_audio(args):
    """Real cpal streams against a real PulseAudio daemon whose sinks are null and whose mic is a
    sine, in a throwaway image layered on the build image. Nothing is installed on the host."""
    packages = "pipewire-pulse wireplumber" if args.server == "pipewire" else "pulseaudio"
    tag = f"semaphore-native-build-{args.server}:" + image().rsplit(":", 1)[1]
    if sh("docker", "image", "inspect", tag, check=False).returncode:
        dockerfile = f"FROM {image()}\nUSER root\nRUN pacman -Sy --noconfirm {packages} libpulse && rm -rf /var/cache/pacman/pkg/*\nUSER {os.getuid()}\n"
        subprocess.run(["docker", "build", "-q", "-t", tag, "-"], input=dockerfile, text=True, check=True, capture_output=True)
    lk_stack("up", "200")
    run_id = uuid.uuid4().hex[:6]
    room = f"u11-real-{run_id}"
    tones = "real:523,real2:900"
    far = Container(f"u11-realfar-{run_id}", [RIG, "participant"],
                    {"LK_ROOM": room, "IDENTITY": "far", "HZ": 743, "TONES": tones})
    out = RESULTS / f"real-audio-{args.server}.json"
    try:
        cmd = run_args(f"u11-real-{run_id}", {"LK_ROOM": room, "IDENTITY": "real", "HZ": 523, "TONES": "far:743", "REAL": "1", "HOME": "/tmp", "RIG": RIG, "PROOF_OUT": str(out), "AUDIO_SERVER": args.server})
        cmd[-1] = tag
        cmd += ["python3", str(HERE / "real_audio_inner.py")]
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        far_heard = {}
        def far_reader():
            while process.poll() is None:
                lines = reports(far.snapshot())
                if lines:
                    far_heard.update(lines[-1]["heard"])
                    RESULTS.joinpath("real-audio-far.txt").write_text(json.dumps(lines[-1]["heard"]))
                time.sleep(0.2)
        threading.Thread(target=far_reader, daemon=True).start()
        for line in process.stdout:
            print(line.rstrip()[:400], flush=True)
        process.wait()
        return process.returncode == 0
    finally:
        far.stop()
        lk_stack("down")
        (RESULTS / "real-audio-far.txt").unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    r = sub.add_parser("rejoin")
    r.add_argument("scenario", choices=["netkill", "lkrestart"])
    r.add_argument("--runs", type=int, default=3)
    r.add_argument("--outage-s", type=float, default=90)
    r.add_argument("--deadline-s", type=float, default=120)
    b = sub.add_parser("bench")
    b.add_argument("--seconds", type=int, default=20)
    b.add_argument("--rounds", type=int, default=3)
    b.add_argument("--cpuset")
    sub.add_parser("shots")
    a = sub.add_parser("real-audio")
    a.add_argument("--server", choices=["pulseaudio", "pipewire"], default="pulseaudio")
    w = sub.add_parser("window")
    w.add_argument("--seconds", type=int, default=40)
    w.add_argument("--rgba", action="store_true")
    args = parser.parse_args()
    RESULTS.mkdir(parents=True, exist_ok=True)
    ok = {"rejoin": rejoin, "bench": bench, "shots": shots, "window": window, "real-audio": real_audio}[args.mode](args)
    raise SystemExit(0 if ok in (None, True) else 1)


if __name__ == "__main__":
    main()
