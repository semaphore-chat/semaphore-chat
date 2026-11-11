"""The T11 "absent" verdict, shared by run.py, desk_judge.py and rejudge.py.

t11-sysaudio-windows.ps1 has the same rule in PowerShell; keep the two identical.

A tone that must be absent (our call tone) is judged per 1 s window:

  clean   level at or below the floor (-80 dBFS)
  leak    level above the floor AND at least 20 dB above the reference bin in the same window
  glitch  level above the floor but less than 20 dB above the reference bin

The reference bin (REF_HZ) is a frequency nobody plays, well away from every tone and its
harmonics, measured the same way (Hann-windowed Goertzel on the same window). A dropout or a
click spreads energy over the whole spectrum, so it lifts the reference with the call tone; a leak
lifts only the call tone. Exclusion fails on any leak window. Glitches don't fail it, but more
than 5% glitch windows fails the run as too noisy to judge. The negative control must be detected:
the tone it lets in must be a leak in at least 95% of windows.
"""

FLOOR_DB = -80.0
LEAK_ABOVE_REF_DB = 20.0
MAX_GLITCH_SHARE = 0.05
CONTROL_LEAK_SHARE = 0.95
# 110 Hz from any harmonic (to the 6th) of every tone the rigs play (440-1109 Hz), and 24 Hz from
# any sum or difference of two of them.
REF_HZ = 330
REF = "ref"


def classify(level, ref, floor=FLOOR_DB):
    """One window: "clean", "leak" or "glitch". No reference level means the old rule: a leak."""
    if level <= floor:
        return "clean"
    if ref is None or level - ref >= LEAK_ABOVE_REF_DB:
        return "leak"
    return "glitch"


def ref_bin(window):
    return window["db"].get(REF)


def judge_absent(windows, tone, floor=FLOOR_DB, ref_of=ref_bin):
    """Verdict for a tone that must be absent from every window in `windows`."""
    kinds, leaks, glitches = [], [], []
    for w in windows:
        level, ref = w["db"][tone], ref_of(w)
        kind = classify(level, ref, floor)
        kinds.append(kind)
        if kind != "clean":
            (leaks if kind == "leak" else glitches).append(
                {"t": w.get("t"), "db": level, "ref_db": None if ref is None else round(ref, 2)})
    n = len(windows)
    glitch_share = len(glitches) / n if n else 0.0
    too_noisy = glitch_share > MAX_GLITCH_SHARE
    levels = [w["db"][tone] for w in windows]
    return {
        "no_leak": n > 0 and not leaks,
        "judgeable": n > 0 and not too_noisy,
        "pass": n > 0 and not leaks and not too_noisy,
        "windows": n, "leaks": len(leaks), "glitches": len(glitches), "glitch_share": round(glitch_share, 3),
        "too_noisy": too_noisy, "max_db": max(levels) if levels else None,
        "leak_windows": leaks[:5], "glitch_windows": glitches[:5],
    }


def judge_control(windows, tone, floor=FLOOR_DB, ref_of=ref_bin):
    """The negative control lets `tone` in on purpose: the rule must call it a leak."""
    leaks = sum(1 for w in windows if classify(w["db"][tone], ref_of(w), floor) == "leak")
    share = leaks / len(windows) if windows else 0.0
    return {"detected": share >= CONTROL_LEAK_SHARE, "leak_share": round(share, 3), "windows": len(windows)}


def describe(tone, verdict):
    """One line for a person."""
    if verdict["windows"] == 0:
        return f"{tone}: no windows"
    word = "LEAK" if verdict["leaks"] else ("TOO NOISY TO JUDGE" if verdict["too_noisy"] else "absent")
    return (f"{tone}: {word}, {verdict['leaks']} leak and {verdict['glitches']} glitch windows of "
            f"{verdict['windows']} (glitch bar {MAX_GLITCH_SHARE:.0%}), max {verdict['max_db']} dBFS")
