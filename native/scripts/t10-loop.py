#!/usr/bin/env python3
"""T10 agent loop, run inside the pinned image: 20 one-line edits of the story source,
each rebuilt, rendered twice on lavapipe, hashed and timed.

    bash native/scripts/t10-run.sh [--iterations 20]      # from the host
    python3 scripts/t10-loop.py --out results/t10.json    # inside the image

The bar is the brief's and is not adjusted here: 20 iterations, every one under 60 s,
two renders of the same source byte-identical, and a real edit that changes the hash.
Two variants of the same line alternate, so each variant's hash can be compared across
ten separate iterations, not just the two renders of one. The edited file is restored
on exit, including on SIGINT and SIGTERM.

The machine is expected to be busy (other agents work in this repo). Load is recorded
in the result and never used to relax a check: `provisional` says the timings can't
stand as a baseline, `ok` says the bar was met.
"""
import argparse
import atexit
import hashlib
import json
import os
import re
import shutil
import signal
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_ITERATIONS = 20
MAX_ITERATION_MS = 60_000
STORY = "shell-connected"
WIDTH, HEIGHT = 800, 480
LAVAPIPE_ICD = "/usr/share/vulkan/icd.d/lvp_icd.json"
EDIT_FILE = Path("crates/semaphore-ui/src/lib.rs")
# The one line the loop owns. Matched by shape, so it still finds itself after a variant
# has replaced the pristine text.
EDIT_LINE = re.compile(r'^(?P<indent>[ \t]*)\.child\(Button::new\("retry"\)[^\n]*$', re.M)
VARIANT_LABELS = {"A": "Reconnect now", "B": "Reconnect later"}
SHOT_DIR = Path("results/t10")

_original = None
_restored = False


def read_loadavg():
    return Path("/proc/loadavg").read_text().strip()


def load1():
    return float(read_loadavg().split()[0])


def percentile(values, pct):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))]


def child_cpu_s():
    times = os.times()
    return times.children_user + times.children_system


def png_size(path):
    """Width and height from the PNG IHDR, without an image library."""
    header = Path(path).read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"{path} is not a PNG")
    return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")


def variant_source(text, label):
    """Return `text` with its one retry-button line relabelled, or None if the anchor moved."""
    matches = list(EDIT_LINE.finditer(text))
    if len(matches) != 1:
        return None
    match = matches[0]
    line = f'{match.group("indent")}.child(Button::new("retry").primary().label("{label}"))'
    return text[: match.start()] + line + text[match.end() :]


def restore():
    global _restored
    if _original is not None and not _restored:
        EDIT_FILE.write_text(_original)
        _restored = True


def on_signal(number, _frame):
    restore()
    raise SystemExit(128 + number)


def cargo_build():
    started = time.perf_counter()
    proc = subprocess.run(
        ["cargo", "build", "--locked", "-q", "-p", "rig-shot"],
        capture_output=True,
        text=True,
    )
    return (time.perf_counter() - started) * 1000, proc.returncode, (proc.stderr or "")[-2000:]


class MemorySampler(threading.Thread):
    """Peak PSS/RSS/anon of the rig process, polled while it renders."""

    def __init__(self, pid):
        super().__init__(daemon=True)
        self.pid = pid
        self.stop_event = threading.Event()
        self.peak = {"Pss": 0.0, "Rss": 0.0, "Anonymous": 0.0, "hwm": 0.0}

    def run(self):
        while not self.stop_event.is_set():
            try:
                rollup = Path(f"/proc/{self.pid}/smaps_rollup").read_text()
                status = Path(f"/proc/{self.pid}/status").read_text()
            except (FileNotFoundError, ProcessLookupError):
                return
            for line in rollup.splitlines():
                key, _, rest = line.partition(":")
                if key in self.peak:
                    self.peak[key] = max(self.peak[key], int(rest.split()[0]) / 1024)
            for line in status.splitlines():
                if line.startswith("VmHWM:"):
                    self.peak["hwm"] = max(self.peak["hwm"], int(line.split()[1]) / 1024)
            self.stop_event.wait(0.05)

    def stop(self):
        self.stop_event.set()
        self.join(timeout=5)


def render_once(out_png, rig, env):
    """One rig-shot process. Returns (ms, sha256, peak memory in MiB)."""
    started = time.perf_counter()
    proc = subprocess.Popen(
        [rig, STORY, str(WIDTH), str(HEIGHT), str(out_png)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    sampler = MemorySampler(proc.pid)
    sampler.start()
    try:
        _, stderr = proc.communicate()
    finally:
        sampler.stop()
    elapsed_ms = (time.perf_counter() - started) * 1000
    if proc.returncode != 0:
        raise RuntimeError(f"rig-shot exited {proc.returncode}: {stderr[-800:]}")
    digest = hashlib.sha256(Path(out_png).read_bytes()).hexdigest()
    peak = dict(sampler.peak)
    if not peak["Rss"]:
        peak["Rss"] = peak["hwm"]
    return elapsed_ms, digest, peak


def is_stripped(binary):
    if not shutil.which("file"):
        return None
    output = subprocess.run(["file", str(binary)], capture_output=True, text=True)
    if output.returncode != 0:
        return None
    return "not stripped" not in output.stdout


def main():
    global _original

    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="results/t10.json")
    parser.add_argument("--iterations", type=int, default=REQUIRED_ITERATIONS)
    parser.add_argument("--commit", default=os.environ.get("GIT_COMMIT", "unknown"))
    args = parser.parse_args()

    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, on_signal)

    _original = EDIT_FILE.read_text()
    atexit.register(restore)
    if variant_source(_original, "Reconnect") is None:
        sys.exit(f"t10: cannot find exactly one retry-button line in {EDIT_FILE}")

    target_dir = Path(os.environ.get("CARGO_TARGET_DIR", "target"))
    rig = target_dir / "debug" / "rig-shot"
    env = dict(os.environ, VK_ICD_FILENAMES=LAVAPIPE_ICD, XDG_RUNTIME_DIR="/tmp")
    env.pop("DISPLAY", None)
    env.pop("WAYLAND_DISPLAY", None)
    SHOT_DIR.mkdir(parents=True, exist_ok=True)

    load_start = read_loadavg()
    peak_load = load1()
    warmup_ms, warmup_rc, warmup_err = cargo_build()
    if warmup_rc != 0:
        restore()
        sys.exit(f"t10: warm-up build failed:\n{warmup_err}")

    iterations, peak_memory = [], {"Pss": 0.0, "Rss": 0.0, "Anonymous": 0.0}
    cpu_series = []
    for number in range(1, args.iterations + 1):
        variant = "A" if number % 2 else "B"
        before = EDIT_FILE.read_text()
        edited = variant_source(before, VARIANT_LABELS[variant])
        if edited is None:
            iterations.append({"iteration": number, "variant": variant, "error": "edit anchor not found", "ok": False})
            continue

        peak_load = max(peak_load, load1())
        cpu_before = child_cpu_s()
        iteration_started = time.perf_counter()

        edit_started = time.perf_counter()
        EDIT_FILE.write_text(edited)
        edit_ms = (time.perf_counter() - edit_started) * 1000
        record = {
            "iteration": number,
            "variant": variant,
            "label": VARIANT_LABELS[variant],
            "edit_changed_source": edited != before,
            "edit_ms": round(edit_ms, 1),
        }
        if not record["edit_changed_source"]:
            record.update({"error": "edit left the source unchanged", "ok": False})
            iterations.append(record)
            continue

        build_ms, build_rc, build_err = cargo_build()
        record["build_ms"] = round(build_ms, 1)
        if build_rc != 0:
            record.update({"ok": False, "error": f"build failed: {build_err[-800:]}"})
            iterations.append(record)
            continue

        first_png = SHOT_DIR / f"iteration-{number:02d}-{variant}.png"
        second_png = SHOT_DIR / f".iteration-{number:02d}-{variant}.second.png"
        try:
            render1_ms, sha1, peak1 = render_once(first_png, rig, env)
            render2_ms, sha2, peak2 = render_once(second_png, rig, env)
        except RuntimeError as error:
            record.update({"ok": False, "error": str(error)})
            iterations.append(record)
            continue
        finally:
            second_png.unlink(missing_ok=True)

        for key in peak_memory:
            peak_memory[key] = max(peak_memory[key], peak1[key], peak2[key])

        render_ms = render1_ms + render2_ms
        total_ms = (time.perf_counter() - iteration_started) * 1000
        cpu_pct = 100 * (child_cpu_s() - cpu_before) / (total_ms / 1000)
        cpu_series.append(cpu_pct)
        width, height = png_size(first_png)
        record.update(
            {
                "ok": True,
                "render_ms": round(render_ms, 1),
                "render1_ms": round(render1_ms, 1),
                "render2_ms": round(render2_ms, 1),
                "total_ms": round(total_ms, 1),
                "sha256": sha1,
                "sha256_second_process": sha2,
                "identical_across_processes": sha1 == sha2,
                "png": str(first_png),
                "png_size": {"width": width, "height": height},
                "cpu_pct_core": round(cpu_pct, 1),
                "peak_memory_mb": {
                    "pss": round(peak1["Pss"], 1),
                    "rss": round(peak1["Rss"], 1),
                    "anon": round(peak1["Anonymous"], 1),
                },
                "loadavg": read_loadavg(),
            }
        )
        iterations.append(record)

    # Restore before anything else can go wrong with the result file.
    restore()

    completed = [row for row in iterations if row.get("ok")]
    hashes = {}
    for row in completed:
        hashes.setdefault(row["variant"], []).append(row["sha256"])
    distinct = {variant: sorted(set(values)) for variant, values in hashes.items()}

    checks = {
        "iterations_completed": len(completed) == args.iterations,
        "every_iteration_under_60s": bool(completed) and all(row["total_ms"] < MAX_ITERATION_MS for row in completed),
        "two_renders_identical_each_iteration": bool(completed)
        and all(row["identical_across_processes"] for row in completed),
        "variant_hash_stable_across_iterations": bool(distinct)
        and all(len(values) == 1 for values in distinct.values())
        and len(hashes.get("A", [])) + len(hashes.get("B", [])) == len(completed),
        "edit_changes_hash": set(distinct.get("A", [])) != set(distinct.get("B", []))
        and bool(distinct.get("A"))
        and bool(distinct.get("B")),
    }
    if args.iterations != REQUIRED_ITERATIONS:
        checks["iteration_count_is_20"] = False

    ok = all(checks.values())
    smoke = args.iterations != REQUIRED_ITERATIONS
    errors = [f"iteration {row['iteration']}: {row['error']}" for row in iterations if not row.get("ok")]
    errors += [f"check failed: {name}" for name, passed in checks.items() if not passed]

    cpus = os.cpu_count() or 1
    threshold = cpus * 0.5
    provisional = peak_load > threshold
    load = {
        "start": load_start,
        "end": read_loadavg(),
        "peak_load1": round(peak_load, 2),
        "threshold_load1": threshold,
        "provisional": provisional,
        "reason": f"load1 peaked at {peak_load:.1f}, above {threshold:.1f}" if provisional else None,
    }

    if ok:
        cpu_block = {
            "avg": round(statistics.fmean(cpu_series), 2) if cpu_series else 0.0,
            "p95": round(percentile(cpu_series, 95), 2) if cpu_series else 0.0,
        }
        memory_block = {
            "primary_metric": "pss",
            "pss": round(peak_memory["Pss"], 1),
            "rss": round(peak_memory["Rss"], 1),
            "anon": round(peak_memory["Anonymous"], 1),
            "private_working_set": None,
            "pss_peak": round(peak_memory["Pss"], 1),
        }
    else:
        cpu_block, memory_block = None, None

    totals = [row["total_ms"] for row in completed]
    builds = [row["build_ms"] for row in completed]
    renders = [row["render_ms"] for row in completed]
    aux = {
        "smoke_run": smoke,
        "verdict": "smoke" if smoke else ("pass" if ok else "fail"),
        "bar": {
            "iterations_required": REQUIRED_ITERATIONS,
            "iterations_run": args.iterations,
            "max_iteration_ms": MAX_ITERATION_MS,
            "deterministic_pixels": "two renders of the same source, in separate processes, hash equal",
            "edit_must_change_hash": "variant A and variant B hashes differ",
        },
        "story": STORY,
        "window": {"width": WIDTH, "height": HEIGHT, "device_scale_factor": 2},
        "edit": {
            "file": str(EDIT_FILE),
            "anchor": EDIT_LINE.pattern,
            "variants": {name: f'.child(Button::new("retry").primary().label("{label}"))'
                         for name, label in VARIANT_LABELS.items()},
            "restored_at_end": True,
        },
        "warm_up": {"build_ms": round(warmup_ms, 1), "counted_in_iterations": False},
        "timings_ms": {
            "total": {"min": round(min(totals), 1), "median": round(statistics.median(totals), 1),
                      "max": round(max(totals), 1)} if totals else None,
            "build": {"min": round(min(builds), 1), "median": round(statistics.median(builds), 1),
                      "max": round(max(builds), 1)} if builds else None,
            "render": {"min": round(min(renders), 1), "median": round(statistics.median(renders), 1),
                       "max": round(max(renders), 1)} if renders else None,
        },
        "hashes_by_variant": distinct,
        "checks": checks,
        "iterations": iterations,
        "screenshots_dir": str(SHOT_DIR),
    }

    scenario = {
        "title": "T10 agent loop: 20 edit-build-render iterations of one story line",
        "ok": ok,
        "provisional": provisional,
        "load": load,
        "errors": errors,
        "window_s": round(sum(totals) / 1000, 3) if totals else None,
        "cpu_pct_core": cpu_block,
        "memory_mb": memory_block,
        "aux": aux,
    }

    binary = rig if rig.exists() else Path("")
    binary_bytes = binary.stat().st_size if binary else 0
    stripped = is_stripped(binary) if binary else None
    packages = subprocess.run(["pacman", "-Q", "mesa", "clang"], capture_output=True, text=True).stdout
    result = {
        "schema_version": 1,
        "client": "native",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        "provisional": provisional,
        "provisional_reasons": [load["reason"]] if load["reason"] else [],
        "build": {"version": "0.0.0", "commit": args.commit, "stripped": stripped},
        "window_scale": 1,
        "env": {
            "platform": "linux",
            "display": "xvfb",
            "mode": "container",
            "cpus": cpus,
            "sandbox": False,
            "window": {"width": WIDTH, "height": HEIGHT, "device_scale_factor": 2},
            "renderer": {"name": "lavapipe", "icd": LAVAPIPE_ICD},
            "packages": dict(line.split(" ", 1) for line in packages.splitlines()),
        },
        "disk": {
            "unpacked_bytes": binary_bytes,
            "file_count": 1,
            "top_level": [{"path": str(binary), "bytes": binary_bytes}],
            "binary": {"bytes": binary_bytes, "stripped": stripped},
            "artifacts": [],
        },
        "cold_start_ms": None,
        "scenarios": {"t10_agent_loop": scenario},
        "comparability_notes": [
            "T10 measures an agent's edit-render-look loop, not client performance: the timing is build plus two lavapipe renders of one story.",
            "rig-shot renders through GPUI's headless WGPU path with no display server; env.display is the schema's nearest allowed value (xvfb) because its enum has no headless member.",
            "The warm-up build of the cold target directory is reported in aux.warm_up and is not an iteration.",
            "cpu_pct_core and memory_mb cover the loop's process tree: cargo, rustc and the two rig-shot renders per iteration.",
        ],
    }

    schema = os.environ.get("RESULT_SCHEMA")
    validation = None
    if schema:
        try:
            import jsonschema

            schema_doc = json.loads(Path(schema).read_text())
            validator = jsonschema.Draft202012Validator(schema_doc)
            violations = sorted(validator.iter_errors(result), key=lambda error: list(error.path))
            validation = {
                "schema": schema,
                "valid": not violations,
                "errors": [f"/{'/'.join(map(str, error.path))}: {error.message}" for error in violations],
            }
        except (OSError, ImportError, json.JSONDecodeError) as error:
            validation = {"schema": schema, "valid": None, "errors": [str(error)]}
        aux["schema_validation"] = validation

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1) + "\n")

    print(f"{'#':>2} {'var':>3} {'edit_ms':>8} {'build_ms':>9} {'render_ms':>10} {'total_ms':>9} "
          f"{'sha256':>16} {'same':>5} {'cpu%':>6}  loadavg")
    for row in iterations:
        if row.get("ok"):
            print(f"{row['iteration']:>2} {row['variant']:>3} {row['edit_ms']:>8.1f} {row['build_ms']:>9.1f} "
                  f"{row['render_ms']:>10.1f} {row['total_ms']:>9.1f} {row['sha256'][:16]:>16} "
                  f"{str(row['identical_across_processes']):>5} {row['cpu_pct_core']:>6.1f}  {row['loadavg']}")
        else:
            print(f"{row['iteration']:>2} {row['variant']:>3} FAILED: {row.get('error', 'unknown')}")
    if totals:
        print(f"total ms: min {min(totals):.1f} median {statistics.median(totals):.1f} max {max(totals):.1f}; "
              f"build median {statistics.median(builds):.1f}; render median {statistics.median(renders):.1f}")
    print(f"hashes: A {distinct.get('A')} B {distinct.get('B')}")
    print(f"load: start {load['start']} | end {load['end']}")
    for name, passed in checks.items():
        print(f"check {name}: {passed}")
    verdict = "SMOKE RUN (not the T10 verdict)" if smoke else ("PASS" if ok else "FAIL")
    print(f"T10 {verdict}: wrote {out}")
    if validation is not None:
        print(f"schema: {validation['schema']} valid={validation['valid']} {validation['errors']}")
        if validation["valid"] is False:
            return 2
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
