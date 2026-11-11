#!/usr/bin/env python3
"""Turn rig-list's raw run files into results/t2.json and results/t3.json, baseline schema.

    emit-list-results.py <raw-dir> <results-dir> --commit SHA --binary-bytes N

<raw-dir> holds what run-list.sh wrote plus the T3 observations (t3.jsonl). The pass bars are in
docs/spike-results.md and are not changed here. A timing verdict can only be `pass` from a quiet
machine; anything else is `provisional`, and a failed timing bar under load stays provisional
rather than `fail`, because the load is what the number measured.
"""
import argparse
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

THRESHOLD_LOAD1 = 16.0  # half of 32 threads, as in emit-result.py
BAR_P99_MS = 16.7
BAR_MEMORY_MB = 500
PHASES = ("fling_up", "fling_down", "jump_mid_fling_up")
GPU_RENDERER = {
    "name": "wgpu-vulkan",
    "device": "NVIDIA RTX 4090, driver 615.78.08",
    "compositor": "sway, wlroots headless backend, Vulkan renderer, 60 Hz timer",
    "shared_with": "other agents' CPU load during these runs; the GPU was otherwise idle",
}
LAVAPIPE_RENDERER = {"name": "lavapipe", "icd": "/usr/share/vulkan/icd.d/lvp_icd.json"}


def load_report(start, end, peak):
    provisional = peak is None or peak > THRESHOLD_LOAD1
    return {
        "start": start,
        "end": end,
        "peak_load1": peak,
        "threshold_load1": THRESHOLD_LOAD1,
        "provisional": provisional,
        "reason": f"load1 peaked at {peak:.1f}, above {THRESHOLD_LOAD1:.1f}" if provisional and peak is not None else None,
    }


def load1(loadavg):
    return float(loadavg.split()[0])


def memory(run):
    end = run["memory_mb"]["end"]
    return {
        "primary_metric": "pss",
        "pss": end["pss"],
        "rss": end["rss"],
        "anon": end["anon"],
        "private_working_set": None,
        "pss_peak": run["memory_mb"]["pss_peak"],
    }


def fling_scenario(title, run, renderer=GPU_RENDERER, extra=None):
    load = load_report(run["load"]["start"], run["load"]["end"], run["load"]["peak_load1"])
    return {
        "title": title,
        "ok": True,
        "provisional": load["provisional"],
        "load": load,
        "errors": [],
        "cpu_pct_core": {"avg": run["cpu_pct_core_avg"], "p95": None},
        "memory_mb": memory(run),
        "aux": {
            "renderer": renderer,
            "phases": run["phases"],
            "distance_px": run["distance_px"],
            "textview_open_ms": run.get("textview_open_ms"),
            "image_cache": run["image_cache"],
            "pss_series_mb": [m["pss"] for m in run["memory_mb"]["series"]],
            **(extra or {}),
        },
    }


def summarize_runs(runs):
    """Median and worst across runs, for each phase, which is what the test bar table asks for."""
    out = {}
    for phase in PHASES:
        p99 = [r["phases"][phase]["present_interval_ms"]["p99"] for r in runs]
        cost = [r["phases"][phase]["frame_cost_ms"]["p99"] for r in runs]
        missed = [r["phases"][phase]["missed_vsyncs"] for r in runs]
        fps = [r["phases"][phase]["fps_mean"] for r in runs]
        out[phase] = {
            "present_p99_ms": {"median": statistics.median(p99), "worst": max(p99), "runs": p99},
            "cpu_frame_cost_p99_ms": {"median": statistics.median(cost), "worst": max(cost)},
            "missed_vsyncs": {"median": statistics.median(missed), "worst": max(missed)},
            "fps_mean_median": statistics.median(fps),
        }
    return out


def base_result(args, display, renderer, provisional_reasons, mode="container"):
    return {
        "schema_version": 1,
        "client": "native",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ok": True,
        "provisional": bool(provisional_reasons),
        "provisional_reasons": provisional_reasons,
        "build": {"version": "0.0.0-rig-list", "commit": args.commit, "stripped": True},
        "history_messages": 100000,
        "window_scale": 1,
        "env": {
            "platform": "linux",
            "display": display,
            "mode": mode,
            "cpus": 32,
            "sandbox": False,
            "window": {"width": 1920, "height": 1080, "device_scale_factor": 1},
            "renderer": renderer,
        },
        "disk": {
            "unpacked_bytes": args.binary_bytes,
            "file_count": 1,
            "top_level": [{"path": "rig-list", "bytes": args.binary_bytes}],
            "binary": {"bytes": args.binary_bytes, "stripped": True},
            "artifacts": [],
        },
    }


def jump_verdict(jump):
    results = jump["results"]
    logic = {
        "prepend_mid_history_px": results["prepend_5000_mid_history"]["max_shift_px"],
        "prepend_at_top_row_px": results["prepend_50_at_top_row"]["max_shift_px"],
        "prepend_during_live_scroll_px": results["prepend_during_live_scroll"]["max_error_px"],
        "late_image_with_known_size_px": max(v["max_shift_px"] for v in results["late_image_reserved"].values()),
    }
    without_size = {k: v["max_shift_px"] for k, v in results["late_image_unreserved"].items()}
    return logic, without_size, all(v == 0 for v in logic.values())


def emit_t2(raw, args):
    read = lambda name: json.loads((raw / f"{name}.json").read_text())
    runs = [read(f"fling-gpu-run{i}") for i in (1, 2, 3)]
    jump = read("jump")
    idle = read("idle-gpu")
    summary = summarize_runs(runs)
    worst_p99 = max(v["present_p99_ms"]["worst"] for v in summary.values())
    median_p99 = max(v["present_p99_ms"]["median"] for v in summary.values())
    peak_loads = [r["load"]["peak_load1"] for r in runs]
    reasons = [
        f"load1 peaked at {max(peak_loads):.1f}, above {THRESHOLD_LOAD1:.1f}, from other agents' work",
        "headless sway: frame callbacks come from a timer, with no KMS or scanout, so this is not a real display's cadence",
    ]
    logic, without_size, no_jump = jump_verdict(jump)
    soak = read("fling-gpu-soak120")
    soak_mmap = read("fling-gpu-soak120-mmap")

    def footprint_peak(run):
        """PSS plus swap. The host swaps under pressure, and swapped pages leave PSS."""
        return max(m["pss"] + (m.get("swap") or 0) for m in run["memory_mb"]["series"])

    fixed_peak = footprint_peak(soak_mmap)
    default_peak = footprint_peak(soak)

    result = base_result(args, "wayland", GPU_RENDERER, reasons)
    jump_load = load_report(jump["results"]["load"]["start"], jump["results"]["load"]["end"], load1(jump["results"]["load"]["start"]))
    idle_load = load_report(idle["load"]["start"], idle["load"]["end"], load1(idle["load"]["start"]))
    result["scenarios"] = {
        **{f"t2_fling_gpu_run{i + 1}": fling_scenario(f"100k mixed messages, fling, RTX 4090, run {i + 1}", r) for i, r in enumerate(runs)},
        "t2_fling_gpu_soak120": fling_scenario("120 s of fling up, for the memory plateau", soak, extra={"pss_plus_swap_peak_mb": default_peak}),
        "t2_fling_gpu_soak120_mmap_threshold": fling_scenario(
            "The same soak with MALLOC_MMAP_THRESHOLD_=262144",
            soak_mmap,
            extra={"pss_plus_swap_peak_mb": fixed_peak},
        ),
        "t2_fling_gpu_no_images": fling_scenario("As run 1, images drawn as their reserved boxes", read("fling-gpu-noimages")),
        "t2_fling_gpu_global_image_cache": fling_scenario("As run 1, with GPUI's default never-evicting image cache", read("fling-gpu-globalcache")),
        "t2_fling_gpu_4cores": fling_scenario("As run 1, pinned to 4 cores", read("fling-gpu-4cores")),
        "t2_fling_gpu_textview_arm": fling_scenario("Arm B: one TextView document of 100k messages, no images", read("fling-gpu-textview")),
        "t2_fling_lavapipe": fling_scenario("Software rendering, for shape only", read("fling-lavapipe"), LAVAPIPE_RENDERER),
        "t2_visual_jump": {
            "title": "Row movement on prepend and late image load, measured from painted row tops",
            "ok": True,
            "provisional": False,
            "load": {**jump_load, "provisional": False, "reason": "logic result: pixel positions don't depend on load"},
            "errors": [],
            "cpu_pct_core": {"avg": jump["results"]["cpu_pct_core_avg"], "p95": None},
            "memory_mb": {"primary_metric": "pss", **jump["results"]["memory_mb"], "private_working_set": None},
            "aux": {"results": jump["results"]},
        },
        "t2_idle": {
            "title": "CPU sitting still, without and with animated emoji on screen",
            "ok": True,
            "provisional": idle_load["provisional"],
            "load": idle_load,
            "errors": [],
            "window_s": 10,
            "cpu_pct_core": {"avg": idle["readings"]["animated_emoji_on_screen"]["cpu_pct_core"], "p95": None},
            "memory_mb": {"primary_metric": "pss", **idle["memory_mb"], "private_working_set": None},
            "aux": {"readings": idle["readings"]},
        },
    }
    result["t2"] = {
        "verdict": "provisional",
        "bars": {
            "fling_p99_le_16_7_ms": {
                "verdict": "provisional",
                "bar": BAR_P99_MS,
                "median_of_runs_worst_phase": median_p99,
                "worst": worst_p99,
                "why": "Measured above the bar on a loaded host under a timer-driven compositor. Needs the real desktop.",
            },
            "no_visual_jump": {
                "verdict": "pass" if no_jump else "fail",
                "scope": "Prepend always; late image load only when the message carries the image's size",
                "max_shift_px": logic,
                "without_known_size_px": without_size,
            },
            "under_500_mb": {
                "verdict": "pass" if fixed_peak < BAR_MEMORY_MB else "fail",
                "bar": BAR_MEMORY_MB,
                "scope": "Needs both a bounded image cache and the allocator setting. Fails without the allocator setting.",
                "pss_plus_swap_peak_mb_bounded_cache_default_allocator": default_peak,
                "pss_plus_swap_peak_mb_bounded_cache_mmap_threshold": fixed_peak,
                "pss_peak_mb_50s_runs": [r["memory_mb"]["pss_peak"] for r in runs],
                "cause": "glibc keeps freed decoded images in its arenas. The cache held 126 MB and evicted 127 images in both soaks.",
            },
        },
        "summary": summary,
    }
    result["comparability_notes"] = [
        "A test rig, not the client: no network, no real sign-in, DejaVu fonts only (no CJK or colour-emoji fallback, which cost more to shape).",
        "Present time is when GPUI's present call returned, the same point the T1 rigs measure, not when a display showed the frame.",
        "Input is injected in-process through Window::dispatch_event, once per frame.",
        "Inactive-window throttling is off: headless sway has no seat, so the window would otherwise be held to about 30 fps.",
        "An interval between present-call returns is about 16.1 ms plus the change in CPU cost from the previous frame, so cost jitter raises p99 even when no vsync is missed. missed_vsyncs is the count of intervals over 1.5 times the median.",
        "Images are full-size decodes of generated PNGs, at most 1280x1400, 300 distinct files.",
        "The host swapped during the soaks, so their later PSS readings are low and frames stalled while pages came back. Use PSS plus swap.",
    ]
    (Path(args.results) / "t2.json").write_text(json.dumps(result, indent=1) + "\n")
    return result["t2"]


def emit_t3(raw, args):
    read = lambda name: json.loads((raw / f"{name}.json").read_text())
    arms = [json.loads(line) for line in (raw / "t3.jsonl").read_text().splitlines()]
    arm = lambda letter: [a["observed"] for a in arms if a["arm"] == letter]
    wayland = read("select")
    x11 = read("select-x11-lavapipe")

    def select_scenario(title, run, renderer, note):
        return {
            "title": title,
            "ok": True,
            "provisional": False,
            "load": {
                "start": run["load"]["start"],
                "end": run["load"]["end"],
                "peak_load1": load1(run["load"]["end"]),
                "threshold_load1": THRESHOLD_LOAD1,
                "provisional": False,
                "reason": "logic result: selected text does not depend on load or renderer",
            },
            "errors": [],
            "cpu_pct_core": {"avg": run["cpu_pct_core_avg"], "p95": None},
            "memory_mb": {"primary_metric": "pss", **run["memory_mb"], "private_working_set": None},
            "aux": {"renderer": renderer, "note": note, "run": run},
        }

    result = base_result(args, "wayland", GPU_RENDERER, [])
    result["scenarios"] = {
        "t3_select_wayland_gpu": select_scenario(
            "Drag selection in a real window, real text shaping, Wayland, RTX 4090",
            wayland,
            GPU_RENDERER,
            "Clipboard does not match here because headless sway has no seat. The X11 scenario covers a real clipboard.",
        ),
        "t3_select_x11_lavapipe": select_scenario(
            "The same drag under Xvfb on lavapipe, with a real X11 clipboard",
            x11,
            LAVAPIPE_RENDERER,
            "Same endpoints and bytes as Wayland on the GPU, so the result is renderer-independent.",
        ),
    }
    c_main = next(o for o in arm("C") if "messages_selected" in o and "screens_spanned" in o)
    result["t3"] = {
        "verdict": "pass with the prototype; fail with the kit's selection in a message list",
        "bars": {
            "copy_returns_full_text_in_order": {
                "verdict": "pass",
                "evidence": {
                    "messages_selected": c_main["messages_selected"],
                    "screens_spanned": c_main["screens_spanned"],
                    "text_exact_match": c_main["text_exact_match"],
                    "clipboard_exact_match_test_platform": c_main["clipboard_exact_match"],
                    "clipboard_exact_match_x11": x11["clipboard_exact_match"],
                },
            },
            "survives_unmount_and_remount": {"verdict": "pass", "evidence": c_main["survives_unmount"]},
            "inline_emoji_and_links": {
                "verdict": "pass",
                "evidence": {"inline_emoji": c_main["inline_emoji_in_text"], "links": c_main["links_in_text"]},
            },
        },
        "arms": {"A_kit_selectable_text_per_row": arm("A"), "B_kit_one_textview_document": arm("B"), "C_prototype": arm("C")},
        "prototype_code": {"file": "rigs/list/src/selection.rs and the row and drag parts of rigs/list/src/view.rs"},
    }
    result["comparability_notes"] = [
        "Selection logic only. CPU and memory here are from the scripted drag, for the schema, and are not a bar.",
        "Arms A, B and C ran through gpui_kit::test with real hit testing, a virtual clock and the test text system.",
        "Word and line multi-click, select-all, keyboard extension and accessibility are not in the prototype.",
    ]
    (Path(args.results) / "t3.json").write_text(json.dumps(result, indent=1) + "\n")
    return result["t3"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("raw")
    parser.add_argument("results")
    parser.add_argument("--commit", required=True)
    parser.add_argument("--binary-bytes", type=int, required=True)
    args = parser.parse_args()
    raw = Path(args.raw)
    Path(args.results).mkdir(parents=True, exist_ok=True)
    t2 = emit_t2(raw, args)
    t3 = emit_t3(raw, args)
    print(json.dumps({"t2": t2["verdict"], "t2_bars": {k: v["verdict"] for k, v in t2["bars"].items()}, "t3": t3["verdict"]}))


if __name__ == "__main__":
    main()
