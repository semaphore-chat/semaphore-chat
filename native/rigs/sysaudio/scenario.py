#!/usr/bin/env python3
"""One T11 scenario run, inside the sysaudio container under pw-session.sh.

    scenario.py <L1..L10> <local|livekit> <binary>     (LK_URL, LK_TOKEN_SHARE, LK_TOKEN_VIEW)

Plays the "games" (separate processes, over both the PulseAudio protocol and native PipeWire),
starts the rig, does the scenario's moves, and prints every event as one JSON line on stdout,
tagged with its source. run.py on the host applies the bars.
"""
import json
import math
import os
import struct
import subprocess
import sys
import threading
import time
import wave

AMPLITUDE = 0.25
TONES = {"a": 523, "a2": 659, "a3": 1013, "d": 880, "mono": 587, "fc": 1109, "m": 440, "b": 743}
TONES_ARG = ",".join(f"{k}:{v}" for k, v in TONES.items())
CALL_HZ = TONES["b"]
LOCK = threading.Lock()


def now_ms():
    return int(time.time() * 1000)


def out(line):
    with LOCK:
        sys.stdout.write(json.dumps(line) + "\n")
        sys.stdout.flush()


def tone_wav(path, hz, seconds, channels=2, only=None):
    """A sine at AMPLITUDE in every channel, or only in channel index `only`."""
    frames = int(48000 * seconds)
    with wave.open(path, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(48000)
        chunk = []
        for i in range(frames):
            v = int(AMPLITUDE * 32767 * math.sin(2 * math.pi * hz * i / 48000))
            chunk.append(struct.pack("<" + "h" * channels,
                                     *[(v if only is None or c == only else 0) for c in range(channels)]))
            if len(chunk) == 48000:
                w.writeframes(b"".join(chunk))
                chunk = []
        w.writeframes(b"".join(chunk))


def wav_tone_db(path, hz):
    """Level of `hz` in the last second of a recording, dBFS, to prove the decoy mic was live."""
    try:
        with wave.open(path, "rb") as w:
            channels, width, frames = w.getnchannels(), w.getsampwidth(), w.getnframes()
            w.setpos(max(0, frames - 48000))
            raw = w.readframes(48000)
    except (OSError, EOFError, wave.Error) as error:
        return f"unreadable: {error}"
    if width != 2 or not raw:
        return f"unexpected format: width {width}, {len(raw)} bytes"
    samples = struct.unpack("<" + "h" * (len(raw) // 2), raw)[::channels]
    n = len(samples)
    re = sum(s * math.cos(2 * math.pi * hz * i / 48000) * (0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1))) for i, s in enumerate(samples))
    im = sum(s * math.sin(2 * math.pi * hz * i / 48000) * (0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1))) for i, s in enumerate(samples))
    amplitude = 4 * math.hypot(re, im) / n / 32768
    return round(20 * math.log10(max(amplitude, 1e-12)), 2)


class Proc:
    def __init__(self, tag, args, env=None, capture=True):
        self.tag = tag
        self.proc = subprocess.Popen(args, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                                     stderr=subprocess.STDOUT, text=True, env={**os.environ, **(env or {})})
        self.events = []
        self.started = threading.Event()
        if capture:
            threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for raw in self.proc.stdout:
            try:
                line = json.loads(raw)
            except ValueError:
                line = {"ev": "text", "t": now_ms(), "msg": raw.rstrip()[:400]}
            line["src"] = self.tag
            if line.get("ev") == "capture_started":
                self.started.set()
            out(line)

    def wait_started(self, timeout):
        if not self.started.wait(timeout):
            raise RuntimeError(f"{self.tag} never started capturing")

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def sink_inputs():
    raw = subprocess.run(["pactl", "-f", "json", "list", "sink-inputs"], capture_output=True, text=True).stdout
    return json.loads(raw or "[]")


def move_ours(pid, sink, timeout=5.0):
    """Move every sink-input of process `pid` (our call output) to `sink`."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        moved = 0
        for si in sink_inputs():
            if str(si.get("properties", {}).get("application.process.id")) == str(pid):
                subprocess.run(["pactl", "move-sink-input", str(si["index"]), sink], check=True)
                moved += 1
        if moved:
            out({"ev": "moved_ours", "t": now_ms(), "src": "scenario", "sink": sink, "count": moved})
            return
        time.sleep(0.1)
    raise RuntimeError(f"no sink-input of pid {pid} to move")


def play(tag, kind, path, extra=None, env=None):
    if kind == "pulse":
        args = ["paplay", path]
    else:
        args = ["pw-play", *(extra or []), path]
    p = Proc(tag, args, env=env, capture=False)
    out({"ev": "game_started", "t": now_ms(), "src": "scenario", "game": tag, "kind": kind, "pid": p.proc.pid})
    return p


def wait_until(t_ms):
    while now_ms() < t_ms:
        time.sleep(0.02)


def main():
    scenario, mode, binary = sys.argv[1], sys.argv[2], sys.argv[3]
    duration = 600 if scenario == "L10" else 20
    files = "/tmp/t11"
    os.makedirs(files, exist_ok=True)
    length = duration + 30
    wavs = {
        "a": (TONES["a"], 2, None), "a2": (TONES["a2"], 2, None), "a3": (TONES["a3"], 2, None),
        "d": (TONES["d"], 2, None), "mono": (TONES["mono"], 1, None), "fc": (TONES["fc"], 6, 2),
    }
    for name, (hz, channels, only) in wavs.items():
        tone_wav(f"{files}/{name}.wav", hz, length, channels, only)
    out({"ev": "scenario", "t": now_ms(), "src": "scenario", "scenario": scenario, "mode": mode,
         "duration_s": duration, "tones": TONES, "amplitude": AMPLITUDE})

    games, helpers = [], []
    if scenario == "L8":
        helpers.append(Proc("fx", ["pw-loopback", "--capture-props=media.class=Audio/Sink node.name=fx-sink "
                                   "node.description=FX", "--playback-props=node.name=fx-out"], capture=False))
    # Every scenario but L2 has the PulseAudio game A from the start.
    if scenario != "L2":
        games.append(play("a", "pulse", f"{files}/a.wav"))
    if scenario == "L2":
        games.append(play("a2", "native", f"{files}/a2.wav"))
    if scenario == "L4":
        games.append(play("d", "pulse", f"{files}/d.wav", env={"PULSE_SINK": "rig-speakers-2"}))
    if scenario == "L6":
        games.append(play("mono", "pulse", f"{files}/mono.wav"))
        games.append(play("fc", "native", f"{files}/fc.wav", ["--channels", "6", "--channel-map", "FL,FR,FC,LFE,RL,RR"]))
    if scenario == "L7":
        # Someone records the mic, so the mic is live: its tone must still stay out of the share.
        helpers.append(Proc("mic-user", ["pw-record", "--target", "rig-mic", f"{files}/mic.wav"], capture=False))

    env = {"LOG_DEBUG": "1", "TONES": TONES_ARG, "CALL_HZ": str(CALL_HZ), "CALL_AMPLITUDE": str(AMPLITUDE),
           "DURATION_S": str(duration), "INCLUDE_OWN": "1" if scenario == "L9" else "0",
           "REOPEN_AT_S": "8" if scenario == "L5" else ""}
    procs = []
    if mode == "local":
        sharer = Proc("local", [binary], env={**env, "MODE": "local"})
        procs.append(sharer)
    else:
        viewer = Proc("viewer", [binary], env={**env, "MODE": "viewer", "LK_TOKEN": os.environ["LK_TOKEN_VIEW"],
                                              "DURATION_S": str(duration + 12)})
        procs.append(viewer)
        sharer = Proc("share", [binary], env={**env, "MODE": "share", "LK_TOKEN": os.environ["LK_TOKEN_SHARE"]})
        procs.append(sharer)
    try:
        sharer.wait_started(30)
        t0 = now_ms()
        if scenario == "L3":
            wait_until(t0 + 6000)
            games.append(play("a3", "pulse", f"{files}/a3.wav"))
        if scenario == "L4":
            wait_until(t0 + 8000)
            move_ours(sharer.proc.pid, "rig-speakers-2")
        if scenario == "L8":
            wait_until(t0 + 4000)
            move_ours(sharer.proc.pid, "fx-sink")
        for p in procs:
            p.proc.wait(duration + 60)
    finally:
        for p in procs + games + helpers:
            p.stop()
    # Our links are object.linger=false: with the rig gone, nothing of ours may be left.
    dump = json.loads(subprocess.run(["pw-dump"], capture_output=True, text=True).stdout or "[]")
    ours = {o["id"] for o in dump if o.get("info", {}).get("props", {}).get("node.name") == "semaphore-system-audio"}
    links = sum(1 for o in dump if o.get("type", "").endswith("Link") and o.get("info", {}).get("input-node-id") in ours)
    out({"ev": "leftover", "t": now_ms(), "src": "scenario", "nodes": len(ours), "links": links})
    if scenario == "L7":
        out({"ev": "decoy_mic", "t": now_ms(), "src": "scenario", "db": wav_tone_db(f"{files}/mic.wav", TONES["m"])})
    out({"ev": "scenario_done", "t": now_ms(), "src": "scenario",
         "exit": {p.tag: p.proc.returncode for p in procs}})


if __name__ == "__main__":
    main()
