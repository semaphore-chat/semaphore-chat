# Desk kit: the spike's real-desktop runs

One command per test, for Mike's Hyprland desktop. The earlier numbers for these tests are
provisional because they came from headless sway, lavapipe or a loaded host. Each script builds in
Docker (`scripts/in-image.sh`, never cargo, pnpm or node on the host), runs the binary in a real
window on this session, and writes `native/results/desk/<test>/<UTC time>/`:

- `result.json`: the baseline result schema (`scripts/native-baseline/result.schema.json`), checked
  with `scripts/validate-result.py` before the script ends
- `host.json`: load1 before and after, GPU and driver, Hyprland version, every monitor with its
  refresh rate, which one was focused
- `raw/`: the rig's own output, logs, and per-second samples (load1, PSS, GPU %)

Then it prints a five-line summary against the bar in `docs/spike-results.md`.

## Before any of them

- **Quiet machine.** Each script refuses to measure if load1 is above 2.0 at start (a loaded host
  is what made the earlier numbers provisional). Stop other agents' builds and stacks
  (`scripts/test-stack.sh ls`), close browsers, Electron apps, games and video. `--force` runs
  anyway and marks the result provisional.
- **An empty workspace on the monitor you want measured**, focused, so the window gets the whole
  monitor and stays visible. The summary records which monitor and its refresh rate.
- Run from a terminal on the Hyprland session (`WAYLAND_DISPLAY` set), from the repo root or anywhere.
- First run of each builds first: a few minutes for the video image and rig, about a minute for rig-list,
  several minutes to package the Electron app. Later runs reuse all of it.
- Ctrl-C at any point stops the windows and containers the script started.
- `--dry-run` on any script does everything except open the window and measure. Its output goes
  to `native/results/desk/<test>/dry-run/` (gitignored).

## T2: message list fling

```bash
native/scripts/desk/t2-list.sh
```

- **Takes:** about 3 minutes (three runs of about 50 s, plus image generation on the first).
- **You see:** a 1920x1080 message list window opens and scrolls itself up fast, down, jumps to the
  middle and scrolls up again; it closes, and the next run opens.
- **You do:** nothing. Don't touch the mouse or keyboard and don't switch workspaces until the
  summary prints. Input is injected in-process; a real pointer over the window only adds noise.
- **Pass:** `bar: presented frame p99 <= 16.7 ms, worst of 3 runs` says `pass`. The present-to-present
  interval is measured, so on a 144 or 165 Hz monitor the intervals are shorter than 16.7 ms when
  the list keeps up; the bar is absolute. `provisional` means the host was busy: rerun when quiet.

## T3: selection across scrolled-out messages, real Wayland clipboard

```bash
native/scripts/desk/t3-selection.sh
```

- **Takes:** about 1 minute.
- **Overwrites your clipboard** with about 65 KB of generated messages.
- **You see:** the message list opens, a selection drags itself down past the bottom edge over about
  150 messages, the list scrolls far away and back.
- **You do:** nothing, usually. If the script prints `ACTION NEEDED`, the compositor ignored the
  rig's own copy (Wayland can refuse a clipboard write without a real input event). Then move the
  pointer onto the rig window **without clicking** (a click starts a new selection) and press
  **Ctrl+C** once. The script polls `wl-paste` for 120 s and records `trigger: manual_ctrl_c`.
- **Pass:** `wl-paste ... exact match: True` and the bar line says `pass`: the text read back by
  another client is byte-identical to what the rig expected (`raw/expected.txt` against
  `raw/wl-paste.txt`). `rig_copy` versus `manual_ctrl_c` is worth noting in the results: a real app
  copies on a key press anyway, so either trigger answers the question.

## T1: video

```bash
native/scripts/desk/t1-video.sh
```

- **Takes:** about 10 minutes: 7 configurations x 3 runs, 25 s each plus start-up (`--runs`,
  `--duration` change it). The first run also builds the video image and generates two raw clips
  (about 1.3 GB under `native/scripts/desk/.cache/`).
- **You see:** a 1920x1080 window of 9 test-pattern tiles and a large share tile, or an empty UI for
  the baseline runs, 21 times in a row.
- **You do:** nothing until the summary prints. Don't move windows or switch workspaces: a hidden
  window is throttled and ruins the frame times.
- **Pass:** all four summary bars say `pass`: frame p99 at or under 16.7 ms for 9x 720p30 + 1x 1080p60
  on all cores and on 4 pinned cores (median and worst of 3), CPU per 720p30 stream under 40% of a
  core above the UI-only baseline, and the 1080p60 share under 150%. **The CPU bars here exclude
  decode:** the rig replays raw frames. The brief's CPU bar includes decode, so add the decode rig's
  figure (container runs, `gpui-results.json`, `decode` rows) before calling them.

## Electron baseline

```bash
native/scripts/desk/baseline.sh            # about 50 minutes
native/scripts/desk/baseline.sh --short    # about 20 minutes, without the 30-minute idle-growth scenario
```

- **Takes:** as above, plus packaging the app the first time (`--rebuild` repackages).
- **Close first,** as `scripts/native-baseline/README.md` says: Semaphore itself, every
  Chromium-based browser and Electron app, games, video, screen capture, anything in Docker.
- **You see:** the packaged Semaphore app opens with a throwaway profile (not yours, not your keyring),
  signs in, sits idle, scrolls, joins a call, then a 10-tile video grid, closing and reopening for
  cold starts.
- **You do:** nothing. Keep it visible and unobscured, and keep the pointer off it.
- **Pass:** there is no bar: this is the comparison for the native client. The run is usable when
  the summary's first line says `provisional: False` and every scenario is valid. The harness exits
  3 if a scenario failed its own validation (for example, a video stream that didn't arrive at full
  resolution). If Chromium's sandbox can't start, pass the harness's `--no-sandbox` by running
  `scripts/native-baseline/run.sh --host --no-sandbox ...` directly.

## What the kit adds to the rigs

- `rigs/video`: the T1 GPUI video rig, moved from the video agent's notes (`gpui-rig/rig`), outside
  the workspace with its own lockfile. It builds against `third_party/vendor` plus its own rig-only
  telemetry patch (`prepare.sh` makes `.vendor/`), in the pinned image plus libyuv and ffmpeg.
- `rig-list select`: `--expected-out` writes the text the selection should copy, `--wait-secs` holds the
  window (and so the clipboard) for the external check, and Ctrl+C is bound to copy.
- `scripts/in-image.sh --print-image` and `NATIVE_IMAGE`, for the layered video image.
- `scripts/native-baseline/run.sh --dry-run`.
