# Desktop client resource baseline

A repeatable measurement of the packaged Electron app (disk, memory, CPU, cold
start) to compare with the native Rust/GPUI spike. `scenarios.json` defines the
scenarios without reference to Electron; `result.schema.json` is the output both
harnesses emit.

## Run it

```bash
# Package this checkout and run everything (about 45 minutes, 30 of them scenario e)
scripts/native-baseline/run.sh --build

# Again without rebuilding, matching the native list test's history size
scripts/native-baseline/run.sh --messages 100000 --out /tmp/baseline-100k

# Some steps only, shortened: for working on the harness, not for numbers
scripts/native-baseline/run.sh --steps a_idle,d_video_grid --window-scale 0.1 --keep

scripts/test-stack.sh native-baseline down   # after --keep
```

`scripts/native-baseline/run.sh --help` lists every option. Everything runs in
Docker on the shared `semaphore-test` network; no network is created or removed.
Results go to `scripts/native-baseline/out/` (`--out`): `results.json`, one JSON
per step, and the app's output per launch.

The script exits 0 if every scenario passed, 2 if `results.json` doesn't match
the schema, and 3 if it does but a scenario failed validation.

## What it measures

| Metric | How |
|---|---|
| Disk | Apparent bytes (`/home` is btrfs: `du` depends on compression). Top contributors from the `app.asar` index. Download sizes from the GitHub release |
| Memory | `/proc/<pid>/smaps_rollup` across the process tree: **PSS** is the number to compare; RSS and anonymous RSS are there for comparison with the spike, and summed RSS double counts Chromium's shared pages |
| CPU | `utime+stime` across the tree, as percent of one core. 100 means one full core |
| Cold start | Spawn to window mapped, first contentful paint, and interactive (the `#general` composer accepts input and a message has rendered), with app files cached and evicted |

| Scenario | What happens |
|---|---|
| `a_idle` | Idle in `#general`: readings 25 s and 120 s after interactive, then a 60 s window |
| `a_noinstrument` | The same with no debug port and no driver: the cost of the instrumentation |
| `b_scroll` | 60 s of wheel input, 10 notches per second, upward through the history |
| `c_voice_audio` | In a call: fake microphone out, 3 remote audio publishers in |
| `d_video_grid` | 9x 720p30 cameras and 1x 1080p30 screen share, all watched |
| `e_idle_growth` | 30 minutes idle, PSS slope in MiB per hour |
| `probe_angle_lavapipe` | Best effort: idle with ANGLE forced onto lavapipe. Reported separately; can't fail the run |

### A failed scenario has no numbers

A scenario that doesn't meet its own definition has `ok: false`, its `errors`,
and null `cpu_pct_core` and `memory_mb`. Its figures are under
`invalid_measurements`, for debugging only, and the schema rejects a failed
scenario that carries metrics.

`d_video_grid` validates what the app really received, from WebRTC `getStats`:
every stream at exact resolution, decoded at 80% or more of its frame rate, VP8,
and each publisher capturing at 80% or more. `stream_specs` has requested and
measured values side by side. Nothing downgrades a stream to make this pass.

### A busy machine makes a run provisional

CPU, cold-start and frame figures mean little while other work is running, so
every scenario and the cold start record raw `/proc/loadavg` at both ends, and
the 1-minute load at each sample in between. If any of those exceed the low-load
limit (`load.low_load_per_cpu` x CPUs, 8 on 32 cores, plus the scenario's own
`expected_self_load`), the scenario is `provisional` with a `load.reason`, and
the run gets `provisional: true` and `provisional_reasons`.

Each step first waits up to 3 minutes for the load average to drain from the step
before it (`--no-load-wait` skips that on a machine that's busy anyway).

This is separate from `ok`: a run can pass validation and still be provisional.
Provisional doesn't change the exit code. Check `provisional` before quoting a
number, and **take baseline numbers only from a run where it is false.**

### Synthetic publishers

`publishers/publish.ts` is one `@livekit/rtc-node` process, with tokens signed
with the test LiveKit key. Frames are precomputed and deterministic. Publishers
send one layer per stream: the app's `adaptiveStream` would otherwise pick a
layer to fit each tile, and "receiving 720p" would not hold. Video is opt-in in
the app (`autoSubscribe: false`), so the driver clicks every "Watch ..." tile.

### Seed data

`seed:e2e`, then `seed/gen-history.ts` (fixed PRNG; `--messages N`). Images go
through the real upload API once per pool image; the rest is `COPY` over SQL,
which is why 100k messages take seconds. Each message starts with `#<seq>`, so
any client can report how far it scrolled.

## Comparability

`results.json` carries these in `comparability_notes`, and `env` records the
details of the run.

- **Software rendering.** Under Xvfb with no GPU, compositing and raster run on
  the CPU. Container CPU figures compare two software paths and predict neither
  on a GPU, so **take CPU decisions from a `--host` run**. `env.renderer` records
  what really rendered. By default Chromium falls back to its own software
  compositor (`gpu_compositing: disabled_software`), not to Vulkan, so
  `probe_angle_lavapipe` tries forcing the spike's rasterizer.
- **Same base.** Same Arch image (`Dockerfile`), 1920x1080 at scale 1 under Xvfb.
- **Timing.** The spike read after about 25 s idle: compare with
  `a_idle.readings[at_s=25]`, not with the settled window.
- **Sandbox.** The container uses `--no-sandbox`; a real install doesn't.
- **Features.** This is the whole app; the spike implements a subset.
- **Driver.** Windows run with no debugger attached (each action connects, acts
  and exits), except scrolling on `--host`. `a_noinstrument` measures what's left.
- **Evicted cold start.** Only app files are evicted. System libraries stay
  cached, so it's a lower bound on a true cold boot.

## On the real desktop (`--host`)

This needs Mike at the machine: it's the one run that says something true about
CPU with a real GPU. It uses a throwaway profile (`--user-data-dir` under `--out`)
and `--password-store=basic`, so it touches neither your Semaphore profile nor
your keyring. It opens a real window and takes about 45 minutes, or about 12
without scenario e.

**Close first:** Semaphore itself, every Chromium-based browser and Electron app
(Chrome, Discord, VS Code), games and video, anything building or running in
Docker, including other agents' test stacks (`scripts/test-stack.sh ls`), and
OBS or anything else that captures the screen. Then leave the machine alone:
don't move the pointer over the window, and keep it on an active workspace,
visible and unobscured, because a hidden window throttles differently.

```bash
scripts/native-baseline/run.sh --host --out /tmp/baseline-host \
  --steps disk,cold,a_idle,a_noinstrument,b_scroll,c_voice_audio,d_video_grid,e_idle_growth
```

Skip `e_idle_growth` for the 12-minute version. Without Xvfb the differences are:

- Window size is whatever Hyprland gives it; `env.window` records it.
- Wheel input goes over CDP, with the driver attached (`xdotool` can't reach
  Wayland windows); `scroll.input` says so.
- `window_mapped_ms` is null: there's no X11 window to poll.
- If Chromium's sandbox can't start, add `--no-sandbox`; `env.sandbox` records it.
- If a sandboxed renderer's `smaps_rollup` can't be read, the scenario fails
  rather than undercounting. Say so in the results: don't re-run as root.

## Windows (not implemented)

The schema can hold it: `memory_mb.primary_metric` becomes `private_working_set`,
with PSS, RSS and anon null, and `env.platform` is `windows`. Windows has no PSS;
private working set is the nearest honest figure, but it isn't the same number.

A GitHub `windows-latest` runner can give:

- **Installer and unpacked size:** reliable, and the installer is already built
  there by `electron-build.yml`.
- **Idle memory:** plausible, on a runner with no GPU (WARP or software).
- **Cold start:** indicative only. The disk and shared VM are noisy, so it needs
  many runs.

It can't give:

- **CPU worth comparing:** no GPU and 4 shared vCPUs.
- **Scenarios c and d, as they stand:** runners don't run Linux containers, so the
  backend and LiveKit need another home, either installed natively on the runner
  or reachable over a tunnel from outside (which would make latency part of the
  test), and the publishers would have to share those 4 vCPUs with the client.

So real Windows numbers need a real Windows machine or a GPU VM. The cheap,
useful subset is size and idle memory on a runner, labelled `env.mode: runner`.

## Tests

```bash
docker run --rm --network none -v "$PWD/scripts/native-baseline:/src:ro" -w /src \
  -e PYTHONDONTWRITEBYTECODE=1 "native-baseline:$(sha256sum scripts/native-baseline/Dockerfile | cut -c1-12)" \
  python3 -m unittest discover -s tests
```

(The image exists after a first `run.sh`.) They cover the sampler against a fake
`/proc`, the asar parser, the pass/fail rules and the schema.

## For the native harness

Emit `result.schema.json` with `client: "native"`, against the same backend, seed
and `scenarios.json`. `sampler.py` and `disk.py` are stdlib-only and take any
binary (`--root-pid`, `--exe-prefix`; `disk.py analyze --binary`), so both clients
are counted by the same rules.
