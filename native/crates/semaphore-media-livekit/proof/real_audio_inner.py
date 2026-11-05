#!/usr/bin/env python3
"""Runs inside the PulseAudio image. A real daemon, a sine for a mic and null sinks for speakers, so
the engine's real device path runs and what it plays can be read back from each sink's monitor."""
import json, math, os, struct, subprocess, threading, time
from pathlib import Path

RESULTS = Path(os.environ["PROOF_OUT"]).parent
FAR_FILE = RESULTS / "real-audio-far.txt"
checks = {}


def sh(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def tone_rms(samples, hz, rate=48000):
    omega = 2 * math.pi * hz / rate
    coefficient = 2 * math.cos(omega)
    previous = before = 0.0
    energy = 0.0
    for sample in samples:
        energy += sample * sample
        previous, before = sample + coefficient * previous - before, previous
    power = previous * previous + before * before - coefficient * previous * before
    return math.sqrt(max(power, 0) * 2 / len(samples)) / math.sqrt(len(samples)) if samples else 0.0


def record(sink, seconds=0.4):
    """What this sink is playing right now."""
    process = subprocess.Popen(["parec", f"--device={sink}.monitor", "--format=s16le", "--rate=48000", "--channels=1", "--raw", "--latency-msec=20"],
                               stdout=subprocess.PIPE)
    want = int(48000 * seconds) * 2
    # The first chunk is whatever the monitor had buffered before this.
    process.stdout.read(4800 * 2)
    data = process.stdout.read(want)
    process.kill()
    process.wait()
    return struct.unpack(f"<{len(data) // 2}h", data)


def eventually(name, check, deadline_s=20):
    started = time.monotonic()
    value = None
    while time.monotonic() - started < deadline_s:
        value = check()
        if value:
            checks[name] = {"ok": True, "after_ms": int((time.monotonic() - started) * 1000)}
            print(f"PASS {name}: {checks[name]['after_ms']} ms", flush=True)
            return True
        time.sleep(0.1)
    checks[name] = {"ok": False, "last": str(value)}
    print(f"FAIL {name}: {value}", flush=True)
    return False


def far_hears(key, floor=800):
    try:
        return json.loads(FAR_FILE.read_text()).get(key, 0) > floor
    except (OSError, ValueError):
        return False


def far_silent(key):
    try:
        return json.loads(FAR_FILE.read_text()).get(key, 1e9) < 200
    except (OSError, ValueError):
        return False


os.makedirs("/tmp/pulse-run", exist_ok=True)
os.environ["XDG_RUNTIME_DIR"] = "/tmp/pulse-run"
SERVER = os.environ.get("AUDIO_SERVER", "pulseaudio")
if SERVER == "pipewire":
    # What Mike's desktop runs, and most Linux desktops now: PipeWire behind its pulse socket.
    for binary in ("pipewire", "wireplumber", "pipewire-pulse"):
        subprocess.Popen([binary], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
else:
    subprocess.Popen(["pulseaudio", "-n", "--daemonize=no", "--exit-idle-time=-1", "--disallow-exit", "--log-target=stderr", "--log-level=1",
                      "--load=module-native-protocol-unix"],
                     stderr=subprocess.DEVNULL)
ready = False
for _ in range(150):
    if subprocess.run(["pactl", "info"], capture_output=True).returncode == 0:
        ready = True
        break
    time.sleep(0.1)
if not ready:
    raise SystemExit("pulseaudio did not start")


def add_mic(name, hz):
    """A sine played into a null sink, with that sink's monitor remapped to look like a mic. Unlike
    module-sine-source, which only delivers one-second blocks, this honours a requested latency the
    way a sound card does. Returns what to unload to unplug it."""
    modules = [
        sh("pactl", "load-module", "module-null-sink", f"sink_name={name}-feed", "rate=48000"),
        sh("pactl", "load-module", "module-remap-source", f"master={name}-feed.monitor", f"source_name={name}", f"source_properties=device.description={name}"),
    ]
    amplitude = 0.2 * 32767
    second = struct.pack("<48000h", *(int(amplitude * math.sin(2 * math.pi * hz * n / 48000)) for n in range(48000)))
    player = subprocess.Popen(["pacat", "--playback", f"--device={name}-feed", "--format=s16le", "--rate=48000", "--channels=1", "--raw", "--latency-msec=20"],
                              stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def play():
        try:
            while True:
                player.stdin.write(second)
                player.stdin.flush()
        except (BrokenPipeError, OSError):
            pass

    threading.Thread(target=play, daemon=True).start()
    return list(reversed(modules))


sh("pactl", "load-module", "module-null-sink", "sink_name=spk", "rate=48000", "sink_properties=device.description=Speakers")
first_mic = add_mic("mic", 523)
sh("pactl", "set-default-sink", "spk")
sh("pactl", "set-default-source", "mic")
print("server:", sh("pactl", "info").splitlines()[3:6], flush=True)
print("sources:", sh("pactl", "list", "short", "sources"), flush=True)

latest = {}
rig = subprocess.Popen([os.environ["RIG"], "participant"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def read_rig():
    for raw in rig.stdout:
        try:
            line = json.loads(raw)
        except ValueError:
            print("rig:", raw.rstrip(), flush=True)
            continue
        latest.clear()
        latest.update(line)


threading.Thread(target=read_rig, daemon=True).start()

try:
    eventually("joined with real devices", lambda: latest.get("status") == "Connected" and not latest.get("audio_error"))
    print("devices:", json.dumps({"in": latest.get("inputs"), "out": latest.get("outputs")}), flush=True)
    eventually("device list has the mic and speakers, no monitors", lambda: any(d[0].endswith("mic") for d in latest.get("inputs", []))
               and any("spk" in d[0] for d in latest.get("outputs", []))
               and not any("monitor" in d[0] for d in latest.get("inputs", [])))
    eventually("far end hears our real mic", lambda: far_hears("real"))
    eventually("our real speakers play the far end", lambda: tone_rms(record("spk"), 743) > 500)

    eventually("the output buffer is a conversation's, not two seconds", lambda: 0 < latest.get("output_latency_ms", 0) < 150)
    print("output latency ms:", latest.get("output_latency_ms"), flush=True)
    sh("pactl", "load-module", "module-null-sink", "sink_name=usb", "sink_properties=device.description=USB-Headset")
    eventually("a plugged-in device shows up", lambda: any("usb" in d[0] for d in latest.get("outputs", [])))
    sh("pactl", "set-default-sink", "usb")
    eventually("output follows the default device", lambda: tone_rms(record("usb"), 743) > 500)
    eventually("and has left the old one", lambda: tone_rms(record("spk"), 743) < 100)

    second_mic = add_mic("mic2", 900)
    eventually("a new mic shows up", lambda: any(d[0].endswith("mic2") for d in latest.get("inputs", [])))
    sh("pactl", "set-default-source", "mic2")
    eventually("input follows the default device", lambda: far_hears("real2"))
    eventually("and has left the old one", lambda: far_silent("real"))

    usb_index = next(line.split()[0] for line in sh("pactl", "list", "short", "modules").splitlines() if "sink_name=usb" in line)
    sh("pactl", "unload-module", usb_index)
    sh("pactl", "set-default-sink", "spk")
    eventually("unplugging falls back to the speakers", lambda: tone_rms(record("spk"), 743) > 500)
    for module in second_mic:
        sh("pactl", "unload-module", module)
    sh("pactl", "set-default-source", "mic")
    eventually("unplugging the mic falls back too", lambda: far_hears("real"))
    eventually("the call never dropped", lambda: latest.get("status") == "Connected" and latest.get("rejoins") == 0)
finally:
    rig.kill()
    Path(os.environ["PROOF_OUT"]).write_text(json.dumps(checks, indent=1))

failed = [name for name, check in checks.items() if not check["ok"]]
print(f"RESULT real-audio: {len(checks) - len(failed)}/{len(checks)} failed={failed}", flush=True)
raise SystemExit(1 if failed else 0)
