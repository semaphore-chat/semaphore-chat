#!/usr/bin/env python3
"""Desk kit helper: host facts, result JSON in the baseline schema, and the summary lines.

Stdlib only, so it runs on the host. Subcommands:

    host-info --out host.json --load-start "<loadavg>" --max-load1 2.0 --dry-run true|false
    host-end  --host host.json --load-end "<loadavg>"
    t1 --raw DIR --host host.json --out result.json --commit SHA --binary BIN
    t2 --raw DIR --host host.json --out result.json --commit SHA --binary BIN
    t3 --raw DIR --host host.json --out result.json --commit SHA --binary BIN
    dry-result --test NAME --host host.json --out result.json --commit SHA --binary BIN

Each tN prints five summary lines against the bar (docs/spike-results.md) and writes the result.
The verdict is `pass` or `fail` only from a quiet host on a real compositor; a loaded start, a
load peak above the limit plus the rig's own load, or --force makes it `provisional`.
"""
import argparse
import json
import os
import platform
import statistics
import subprocess
from datetime import datetime, timezone
from pathlib import Path

BAR_FRAME_P99_MS = 16.7
BAR_720P_STREAM_PCT = 40.0
BAR_1080P_SHARE_PCT = 150.0


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def load1(raw):
    return float(raw.split()[0]) if raw else None


# ------------------------------------------------------------------ host facts


def host_info(args):
    gpu = run(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"])
    gpu_name, _, driver = gpu.partition(", ")
    vulkan = run(["sh", "-c", "vulkaninfo --summary 2>/dev/null | grep -m3 -E 'deviceName|driverInfo'"])
    monitors = []
    try:
        monitors = json.loads(run(["hyprctl", "monitors", "-j"]) or "[]")
    except json.JSONDecodeError:
        pass
    hypr = {}
    try:
        hypr = json.loads(run(["hyprctl", "version", "-j"]) or "{}")
    except json.JSONDecodeError:
        pass
    focused = next((m for m in monitors if m.get("focused")), monitors[0] if monitors else {})
    info = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": args.dry_run == "true",
        "kernel": platform.release(),
        "cpus": os.cpu_count(),
        "cpu_model": next((l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")), None),
        "gpu": {"name": gpu_name or None, "driver": driver or None, "vulkan_summary": vulkan or None},
        "compositor": {
            "name": "Hyprland" if hypr else os.environ.get("XDG_CURRENT_DESKTOP"),
            "version": hypr.get("version") or hypr.get("tag"),
            "wayland_display": os.environ.get("WAYLAND_DISPLAY"),
        },
        "monitors": [
            {k: m.get(k) for k in ("name", "width", "height", "refreshRate", "scale", "focused", "vrr")} for m in monitors
        ],
        "focused_monitor": {k: focused.get(k) for k in ("name", "width", "height", "refreshRate", "scale")} if focused else None,
        "load": {"start": args.load_start, "end": None, "max_load1_at_start": float(args.max_load1)},
        "forced": os.environ.get("DESK_FORCE") == "true",
    }
    Path(args.out).write_text(json.dumps(info, indent=1) + "\n")
    m = info["focused_monitor"] or {}
    print(
        f"desk: host load1 {load1(args.load_start)} | GPU {gpu_name or '?'} driver {driver or '?'} | "
        f"{info['compositor']['name']} {info['compositor']['version'] or ''} | "
        f"focused monitor {m.get('name')} {m.get('width')}x{m.get('height')} @ {m.get('refreshRate')} Hz",
        flush=True,
    )


def host_end(args):
    path = Path(args.host)
    info = json.loads(path.read_text())
    info["load"]["end"] = args.load_end
    path.write_text(json.dumps(info, indent=1) + "\n")


# ------------------------------------------------------------------ shared result parts


def samples(path):
    """load1, PSS kB and GPU % per second, from desk_poll_proc."""
    out = []
    p = Path(path)
    if not p.exists():
        return out
    for line in p.read_text().splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        num = lambda s: float(s) if s not in ("", "-") else None
        out.append({"load1": num(parts[0]), "pss_kb": num(parts[1]), "gpu_pct": num(parts[2])})
    return out


def load_block(host, peak, self_load, run_load=None):
    start = (run_load or {}).get("start") or host["load"]["start"]
    end = (run_load or {}).get("end") or host["load"].get("end")
    limit = host["load"]["max_load1_at_start"]
    reasons = []
    if load1(start) is not None and load1(start) > limit:
        reasons.append(f"load1 {load1(start):.2f} at start, above {limit}")
    if peak is not None and peak > limit + self_load:
        reasons.append(f"load1 peaked at {peak:.2f}, above {limit} plus the rig's own {self_load}")
    if host.get("forced"):
        reasons.append("run with --force")
    return {
        "start": start,
        "end": end,
        "peak_load1": peak,
        "threshold_load1": limit + self_load,
        "provisional": bool(reasons),
        "reason": "; ".join(reasons) or None,
    }


def renderer(host):
    m = host.get("focused_monitor") or {}
    return {
        "name": "wgpu-vulkan",
        "device": f"{host['gpu']['name']}, driver {host['gpu']['driver']}",
        "compositor": f"{host['compositor']['name']} {host['compositor']['version']}, real display",
        "refresh_hz": m.get("refreshRate"),
        "monitor": m,
    }


def base_result(args, host, version, scenarios, notes):
    binary = Path(args.binary)
    size = binary.stat().st_size if binary.exists() else 0
    m = host.get("focused_monitor") or {}
    reasons = sorted({s["load"]["reason"] for s in scenarios.values() if s["load"]["reason"]})
    if host.get("dry_run"):
        reasons.insert(0, "dry run: no measurement")
    return {
        "schema_version": 1,
        "client": "native",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ok": all(s["ok"] for s in scenarios.values()),
        "provisional": bool(reasons),
        "provisional_reasons": reasons,
        "build": {"version": version, "commit": args.commit, "stripped": False},
        "history_messages": 100000,
        "window_scale": 1,
        "env": {
            "platform": "linux",
            "display": "wayland",
            "mode": "host",
            "cpus": host["cpus"],
            "sandbox": False,
            "window": {"width": m.get("width") or 0, "height": m.get("height") or 0, "device_scale_factor": m.get("scale") or 1},
            "renderer": renderer(host),
            "packages": {"host": {k: host[k] for k in ("kernel", "cpu_model", "gpu", "compositor", "monitors", "load")}},
        },
        "disk": {
            "unpacked_bytes": size,
            "file_count": 1,
            "top_level": [{"path": binary.name, "bytes": size}],
            "binary": {"bytes": size, "stripped": False},
            "artifacts": [],
        },
        "scenarios": scenarios,
        "comparability_notes": notes,
    }


def mem_from(pss_kb_series, rss_mb=None):
    pss = [s for s in pss_kb_series if s is not None]
    return {
        "primary_metric": "pss",
        "pss": round(pss[-1] / 1024, 1) if pss else 0.0,
        "rss": rss_mb,
        "anon": None,
        "private_working_set": None,
        "pss_peak": round(max(pss) / 1024, 1) if pss else None,
    }


def verdict(ok, provisional):
    return "provisional" if provisional else ("pass" if ok else "fail")


def write(args, result, lines):
    Path(args.out).write_text(json.dumps(result, indent=1) + "\n")
    for line in (lines + [""] * 5)[:5]:
        print(line)


# ------------------------------------------------------------------ T1


def t1(args):
    host = json.loads(Path(args.host).read_text())
    raw = Path(args.raw)
    runs = []
    for f in sorted(raw.glob("t1-*.json")):
        r = json.loads(f.read_text().strip().splitlines()[-1])
        meta = json.loads(f.with_suffix(".meta").read_text())
        s = samples(f.with_suffix(".samples"))
        r["_meta"], r["_samples"] = meta, s
        runs.append(r)
    scenarios, groups = {}, {}
    for r in runs:
        meta = r["_meta"]
        key = f"{meta['arm']}_{meta['tiles']}x720p30_{meta['share']}x1080p60_{meta['cores']}"
        groups.setdefault(key, []).append(r)
        s = r["_samples"]
        peak = max((x["load1"] for x in s if x["load1"] is not None), default=None)
        load = load_block(host, peak, 4.0, meta.get("load"))
        gpu = [x["gpu_pct"] for x in s if x["gpu_pct"] is not None]
        scenarios[f"t1_{key}_run{meta['run']}"] = {
            "title": f"Video rig, arm {meta['arm']}, {meta['tiles']}x 720p30 + {meta['share']}x 1080p60, {meta['cores']} cores, run {meta['run']}",
            "ok": True,
            "provisional": load["provisional"],
            "load": load,
            "errors": [],
            "window_s": r.get("duration_s"),
            "cpu_pct_core": {"avg": r["cpu_pct_core_total"], "p95": None},
            "memory_mb": mem_from([x["pss_kb"] for x in s], r.get("rss_mb")),
            "aux": {
                "renderer": renderer(host),
                "gpu_pct_avg": round(sum(gpu) / len(gpu), 1) if gpu else None,
                "rig": {k: v for k, v in r.items() if not k.startswith("_")},
            },
        }

    def med(key, field):
        vals = [r[field] for r in groups.get(key, [])]
        return (statistics.median(vals), max(vals)) if vals else (None, None)

    full, base = "surface_9x720p30_1x1080p60_all", "none_0x720p30_0x1080p60_all"
    p99_med, p99_worst = med(full, "frame_ms_p99")
    p99_4_med, p99_4_worst = med("surface_9x720p30_1x1080p60_4", "frame_ms_p99")
    cpu_base, _ = med(base, "cpu_pct_core_total")
    cpu_9, _ = med("surface_9x720p30_0x1080p60_all", "cpu_pct_core_total")
    cpu_share, _ = med("surface_0x720p30_1x1080p60_all", "cpu_pct_core_total")
    per_stream = (cpu_9 - cpu_base) / 9 if cpu_9 is not None and cpu_base is not None else None
    share_above = cpu_share - cpu_base if cpu_share is not None and cpu_base is not None else None
    prov = any(s["provisional"] for s in scenarios.values()) or host.get("dry_run")
    bars = {
        "frame_p99_le_16_7_ms": {"bar": BAR_FRAME_P99_MS, "median": p99_med, "worst": p99_worst,
                                 "verdict": verdict(p99_worst is not None and p99_worst <= BAR_FRAME_P99_MS, prov)},
        "frame_p99_le_16_7_ms_4_cores": {"bar": BAR_FRAME_P99_MS, "median": p99_4_med, "worst": p99_4_worst,
                                         "verdict": verdict(p99_4_worst is not None and p99_4_worst <= BAR_FRAME_P99_MS, prov)},
        "per_720p30_stream_cpu_above_baseline_lt_40_pct": {"bar": BAR_720P_STREAM_PCT, "measured": per_stream,
                                                           "scope": "render path only: the rig replays raw frames, no decode",
                                                           "verdict": verdict(per_stream is not None and per_stream < BAR_720P_STREAM_PCT, prov)},
        "share_1080p60_cpu_above_baseline_lt_150_pct": {"bar": BAR_1080P_SHARE_PCT, "measured": share_above,
                                                        "scope": "render path only: no decode",
                                                        "verdict": verdict(share_above is not None and share_above < BAR_1080P_SHARE_PCT, prov)},
    }
    notes = [
        "The GPUI video rig (rigs/video), arm 'surface' is the vendored video patch; 'today' is Zed's per-frame image path, 'none' the UI alone.",
        "Frames are replayed from raw I420 clips in memory: no LiveKit and no decode. The T1 CPU bars include decode; add the decode rig's figure before calling those bars.",
        "Frame time is the interval between present-call returns (telemetry patch), the same point as the container runs, on the real Hyprland display at its refresh rate.",
        "4-core runs use taskset -c 0-3 on the host, where the container runs used --cpuset-cpus.",
    ]
    result = base_result(args, host, "0.0.0-gpui-video-rig", scenarios, notes)
    result["t1"] = {"bars": bars, "runs_per_config": {k: len(v) for k, v in groups.items()}}
    f = lambda x: "n/a" if x is None else f"{x:.1f}"
    hz = (host.get("focused_monitor") or {}).get("refreshRate")
    write(args, result, [
        f"T1 video on {host['compositor']['name']} {host['compositor']['version']} @ {hz} Hz, load1 at start {load1(host['load']['start'])}{' (PROVISIONAL)' if prov else ''}",
        f"  frame p99, 9x720p30+1080p60:   median {f(p99_med)} ms, worst {f(p99_worst)} ms   bar <= 16.7   {bars['frame_p99_le_16_7_ms']['verdict']}",
        f"  the same on 4 cores:           median {f(p99_4_med)} ms, worst {f(p99_4_worst)} ms   bar <= 16.7   {bars['frame_p99_le_16_7_ms_4_cores']['verdict']}",
        f"  CPU per 720p30 stream:         {f(per_stream)}% of a core above baseline   bar < 40 (no decode)   {bars['per_720p30_stream_cpu_above_baseline_lt_40_pct']['verdict']}",
        f"  CPU for the 1080p60 share:     {f(share_above)}% of a core above baseline   bar < 150 (no decode)   {bars['share_1080p60_cpu_above_baseline_lt_150_pct']['verdict']}",
    ])


# ------------------------------------------------------------------ T2


PHASES = ("fling_up", "fling_down", "jump_mid_fling_up")


def t2(args):
    host = json.loads(Path(args.host).read_text())
    raw = Path(args.raw)
    runs = [json.loads(p.read_text()) for p in sorted(raw.glob("fling-run*.json"))]
    scenarios = {}
    for i, r in enumerate(runs, 1):
        load = load_block(host, r["load"]["peak_load1"], 2.0, r["load"])
        end = r["memory_mb"]["end"]
        scenarios[f"t2_fling_desk_run{i}"] = {
            "title": f"100k mixed messages, fling, real desktop, run {i}",
            "ok": True,
            "provisional": load["provisional"],
            "load": load,
            "errors": [],
            "cpu_pct_core": {"avg": r["cpu_pct_core_avg"], "p95": None},
            "memory_mb": {"primary_metric": "pss", "pss": end["pss"], "rss": end["rss"], "anon": end["anon"],
                          "private_working_set": None, "pss_peak": r["memory_mb"]["pss_peak"]},
            "aux": {"renderer": renderer(host), "phases": r["phases"], "distance_px": r.get("distance_px"),
                    "image_cache": r.get("image_cache"), "pss_series_mb": [m["pss"] for m in r["memory_mb"]["series"]]},
        }
    summary = {}
    for phase in PHASES:
        p99 = [r["phases"][phase]["present_interval_ms"]["p99"] for r in runs]
        missed = [r["phases"][phase]["missed_vsyncs"] for r in runs]
        fps = [r["phases"][phase]["fps_mean"] for r in runs]
        summary[phase] = {"present_p99_ms": {"median": statistics.median(p99), "worst": max(p99), "runs": p99},
                          "missed_vsyncs": {"median": statistics.median(missed), "worst": max(missed)},
                          "fps_mean_median": statistics.median(fps)}
    prov = any(s["provisional"] for s in scenarios.values()) or host.get("dry_run") or len(runs) < 3
    median_worst_phase = max(v["present_p99_ms"]["median"] for v in summary.values())
    worst = max(v["present_p99_ms"]["worst"] for v in summary.values())
    pss_peak = max(r["memory_mb"]["pss_peak"] for r in runs)
    v = verdict(worst <= BAR_FRAME_P99_MS, prov)
    notes = [
        "rig-list fling on the real Hyprland display, MALLOC_MMAP_THRESHOLD_=262144 as the memory bar needs.",
        "Present time is when GPUI's present call returned, as in results/t2.json. On a display faster than 60 Hz the intervals are shorter; the bar is absolute.",
        "Input is injected in-process, once per frame; the pointer is not used.",
        "Only the fling bar is rerun here; no-jump and memory are final in results/t2.json.",
    ]
    result = base_result(args, host, "0.0.0-rig-list", scenarios, notes)
    result["t2"] = {"verdict": v, "bars": {"fling_p99_le_16_7_ms": {"verdict": v, "bar": BAR_FRAME_P99_MS,
                    "median_of_runs_worst_phase": median_worst_phase, "worst": worst}}, "summary": summary}
    hz = (host.get("focused_monitor") or {}).get("refreshRate")
    by = lambda ph: summary[ph]["present_p99_ms"]
    write(args, result, [
        f"T2 fling on {host['compositor']['name']} {host['compositor']['version']} @ {hz} Hz, {len(runs)} runs, load1 at start {load1(host['load']['start'])}{' (PROVISIONAL)' if prov else ''}",
        f"  fling up:        p99 median {by('fling_up')['median']:.1f} ms, worst {by('fling_up')['worst']:.1f} ms, missed vsyncs worst {summary['fling_up']['missed_vsyncs']['worst']}",
        f"  fling down:      p99 median {by('fling_down')['median']:.1f} ms, worst {by('fling_down')['worst']:.1f} ms, missed vsyncs worst {summary['fling_down']['missed_vsyncs']['worst']}",
        f"  jump, fling up:  p99 median {by('jump_mid_fling_up')['median']:.1f} ms, worst {by('jump_mid_fling_up')['worst']:.1f} ms; PSS peak {pss_peak:.0f} MB",
        f"  bar: presented frame p99 <= 16.7 ms, worst of 3 runs: {worst:.1f} ms -> {v}",
    ])


# ------------------------------------------------------------------ T3


def t3(args):
    host = json.loads(Path(args.host).read_text())
    raw = Path(args.raw)
    run_ = json.loads((raw / "select.json").read_text())
    clip = json.loads((raw / "clipboard.json").read_text())
    load = load_block(host, load1(run_["load"]["end"]), 2.0, run_["load"])
    load["provisional"] = bool(host.get("forced") or host.get("dry_run"))
    load["reason"] = "logic result: the copied text does not depend on load" if not load["provisional"] else load["reason"]
    ok_in_process = run_["text_exact_match"] and run_["while_unmounted_exact_match"] and run_["after_remount_exact_match"]
    ok = ok_in_process and clip["wl_paste_exact_match"]
    scenarios = {"t3_select_desk_wayland_clipboard": {
        "title": "Drag selection across scrolled-out messages, copied to the real Wayland clipboard, read back with wl-paste",
        "ok": True,
        "provisional": load["provisional"],
        "load": load,
        "errors": [],
        "cpu_pct_core": {"avg": run_["cpu_pct_core_avg"], "p95": None},
        "memory_mb": {"primary_metric": "pss", **{k: run_["memory_mb"].get(k) for k in ("pss", "rss", "anon")},
                      "private_working_set": None},
        "aux": {"renderer": renderer(host), "run": run_, "clipboard": clip},
    }}
    v = "provisional" if load["provisional"] else ("pass" if ok else "fail")
    notes = [
        "The drag is scripted in-process (rig-list select); the copy goes through GPUI's Wayland clipboard and is read by wl-paste, another client.",
        f"Copy trigger: {clip['trigger']}.",
    ]
    result = base_result(args, host, "0.0.0-rig-list", scenarios, notes)
    result["t3"] = {"verdict": v, "bars": {"wayland_clipboard_exact": {"verdict": v, "evidence": clip}}}
    write(args, result, [
        f"T3 selection on {host['compositor']['name']} {host['compositor']['version']}{' (PROVISIONAL)' if load['provisional'] else ''}",
        f"  selected {run_['messages_selected']} messages, {run_['copied_bytes']} bytes; in-process text exact: {run_['text_exact_match']}",
        f"  survives scroll-out: {run_['while_unmounted_exact_match']}, after remount: {run_['after_remount_exact_match']}",
        f"  wl-paste: {clip['wl_paste_bytes']} bytes, exact match: {clip['wl_paste_exact_match']} (trigger: {clip['trigger']})",
        f"  bar: copy returns the full text in order, through the real clipboard -> {v}",
    ])


def dry_result(args):
    """A schema-valid stand-in, so a dry run proves the emit and validate path."""
    host = json.loads(Path(args.host).read_text())
    load = load_block(host, load1(host["load"]["start"]), 0.0)
    load["provisional"], load["reason"] = True, "dry run: no measurement"
    scenarios = {f"{args.test}_dry_run": {"title": "dry run", "ok": False, "provisional": True, "load": load,
                                          "errors": ["dry run: the windowed binary was not started"],
                                          "cpu_pct_core": None, "memory_mb": None}}
    result = base_result(args, host, f"0.0.0-{args.test}", scenarios, ["dry run"])
    Path(args.out).write_text(json.dumps(result, indent=1) + "\n")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("host-info")
    a.add_argument("--out", required=True)
    a.add_argument("--load-start", required=True)
    a.add_argument("--max-load1", required=True)
    a.add_argument("--dry-run", default="false")
    a = sub.add_parser("host-end")
    a.add_argument("--host", required=True)
    a.add_argument("--load-end", required=True)
    for name in ("t1", "t2", "t3", "dry-result"):
        a = sub.add_parser(name)
        a.add_argument("--raw")
        a.add_argument("--test")
        a.add_argument("--host", required=True)
        a.add_argument("--out", required=True)
        a.add_argument("--commit", required=True)
        a.add_argument("--binary", required=True)
    args = p.parse_args()
    {"host-info": host_info, "host-end": host_end, "t1": t1, "t2": t2, "t3": t3, "dry-result": dry_result}[args.cmd](args)


if __name__ == "__main__":
    main()
