#!/usr/bin/env python3
"""Runs one measurement step on the machine that hosts the app (run.sh calls this).

Runs next to the app, in the Arch container or (--mode host) on the desktop, and
only needs the stdlib plus the driver command. Writes step results to --out;
`assemble` merges them into results.json and validates it against the schema.

  baseline.py prep | env | cold-start | scenario ID | assemble
"""
import argparse
import datetime
import json
import os
import platform
import signal
import statistics
import subprocess
import sys
import threading
import time

import sampler

HERE = os.path.dirname(os.path.abspath(__file__))
CDP_PORT = 19222
WINDOW = (1920, 1080)
USER = {'username': 'testuser', 'password': 'Test123!@#'}
BINARY = 'semaphore-chat'
# Long-running measurement windows carry their own state; everything else is a condition wait.
POLL_S = 0.05

SCHEMA_VERSION = 1


# ------------------------------------------------------------------ pure logic (unit tested)

def scaled(value, scale):
    """A window length under --window-scale (dev runs); keep at least one second."""
    return max(1.0, value * scale) if value else 0.0


def validate_video(spec, before, after, publisher_report):
    """Scenario d: is the app really receiving exactly what the scenario says?

    Returns (measured streams, errors). Any error fails the scenario: it reports
    what was measured, never a number under a label it did not meet.
    """
    errors = []
    before_by_id = {s['id']: s for s in before.get('video', [])}
    measured = []
    for stream in after.get('video', []):
        prev = before_by_id.get(stream['id'])
        fps = None
        received_fps = None
        bitrate = None
        if prev and stream['ts'] > prev['ts']:
            seconds = (stream['ts'] - prev['ts']) / 1000
            if stream.get('frames_received') is not None and prev.get('frames_received') is not None:
                received_fps = round((stream['frames_received'] - prev['frames_received']) / seconds, 1)
            fps = round((stream['frames_decoded'] - prev['frames_decoded']) / seconds, 1)
            bitrate = round((stream['bytes'] - prev['bytes']) * 8 / seconds)
        measured.append({
            'width': stream['width'], 'height': stream['height'], 'fps': fps, 'received_fps': received_fps,
            'bitrate_bps': bitrate, 'codec': stream.get('codec'), 'decoder': stream.get('decoder'),
            'frames_dropped': stream.get('frames_dropped'),
        })

    wanted = []
    pubs = spec['publishers']
    wanted += [('camera', pubs['camera_spec'])] * pubs.get('camera', 0)
    wanted += [('screen', pubs['screen_spec'])] * pubs.get('screen', 0)
    ratio = spec.get('min_fps_ratio', 0.8)
    low_rate, high_rate = spec.get('bitrate_ratio', (0, float('inf')))

    remaining = list(measured)
    for kind, want in wanted:
        match = next((m for m in remaining
                      if m['width'] == want['width'] and m['height'] == want['height']), None)
        if match is None:
            errors.append(f'no received stream at {want["width"]}x{want["height"]} for a {kind}')
            continue
        remaining.remove(match)
        if match['fps'] is None or match['fps'] < want['fps'] * ratio:
            errors.append(f'{kind} {want["width"]}x{want["height"]} decoded at {match["fps"]} fps, '
                          f'under {ratio:.0%} of {want["fps"]}')
        # Decode work follows bitrate: a light stream isn't the same load at any resolution.
        if match['bitrate_bps'] is None or not (
                want['max_bitrate'] * low_rate <= match['bitrate_bps'] <= want['max_bitrate'] * high_rate):
            errors.append(f'{kind} {want["width"]}x{want["height"]} received at {match["bitrate_bps"]} bps, '
                          f'outside {low_rate:.0%}-{high_rate:.0%} of {want["max_bitrate"]}')
        if match['codec'] and want['codec'] not in match['codec'].lower():
            errors.append(f'{kind} received as {match["codec"]}, wanted {want["codec"]}')
    for extra in remaining:
        errors.append(f'unexpected stream {extra["width"]}x{extra["height"]}')

    streams = (publisher_report or {}).get('streams', [])
    if publisher_report is None:
        errors.append('no publisher report')
    elif len(streams) != len(wanted):
        errors.append(f'{len(streams)} publisher streams, wanted {len(wanted)}')
    for stream in streams:
        req = stream.get('requested')
        if req and stream['captured_fps'] < req['fps'] * ratio:
            errors.append(f'publisher {stream["kind"]} captured at {stream["captured_fps"]} fps, '
                          f'under {ratio:.0%} of {req["fps"]}')
    errors.extend(f'publisher: {f}' for f in (publisher_report or {}).get('failures', []))
    return measured, errors


def validate_audio(spec, before, after):
    """Scenario c: remote audio arriving with energy, local mic going out."""
    errors = []
    wanted = spec['publishers']['audio']
    before_by_id = {s['id']: s for s in before.get('audio', [])}
    arriving = 0
    for stream in after.get('audio', []):
        prev = before_by_id.get(stream['id'])
        if prev and stream['bytes'] > prev['bytes'] and stream['energy'] > prev['energy']:
            arriving += 1
    if arriving < wanted:
        errors.append(f'{arriving} remote audio streams with rising bytes and energy, wanted {wanted}')
    if after.get('outbound_audio_bytes', 0) <= before.get('outbound_audio_bytes', 0):
        errors.append('local microphone sent no audio during the window')
    if after.get('video'):
        errors.append(f'{len(after["video"])} video streams in an audio-only scenario')
    return errors


def validate_scroll(spec, before, after):
    """Scenario b: returns (messages scrolled or None, errors)."""
    if before.get('top_seq') is None or after.get('top_seq') is None:
        return None, [f'could not read message positions: before={before.get("top_seq")} after={after.get("top_seq")}']
    moved = before['top_seq'] - after['top_seq']
    if moved < spec['min_messages_scrolled']:
        return moved, [f'scrolled past {moved} messages, wanted at least {spec["min_messages_scrolled"]}']
    return moved, []


def load_report(start, end, series, cpus, low_load_per_cpu, expected_self_load=0):
    """Was the machine quiet? Separate from `ok`: a contaminated run is valid but provisional.

    Compares the 1-minute load, at both ends and at every sample in the window
    (a 30-minute run can be contaminated in the middle), with low_load_per_cpu
    of the machine's CPUs plus the load the scenario causes itself.
    """
    points = [sampler.load1(start), sampler.load1(end)] + [s.get('load1') for s in series]
    points = [p for p in points if p is not None]
    threshold = round(low_load_per_cpu * cpus + expected_self_load, 2)
    peak = max(points) if points else None
    if peak is None:
        provisional, reason = True, 'load could not be read'
    elif peak > threshold:
        provisional, reason = True, f'1-minute load peaked at {peak}, above the low-load limit of {threshold}'
    else:
        provisional, reason = False, None
    return {
        'start': start, 'end': end, 'peak_load1': peak, 'threshold_load1': threshold,
        'provisional': provisional, 'reason': reason,
    }


def finalize(result, measurement, errors):
    """Merge a measurement into a scenario result. A failed scenario reports no metrics.

    Its numbers stay under invalid_measurements for debugging; the metric fields
    are null, so a consumer can't read a failed run as a result.
    """
    errors = sorted(set(list(errors) + measurement.get('errors', [])))
    summary = {
        'window_s': measurement['window_s'],
        'cpu_pct_core': measurement['cpu_pct_core'],
        'memory_mb': measurement['memory_mb'],
        'pss_slope_mb_per_hour': measurement.get('pss_slope_mb_per_hour'),
    }
    result.update({
        'ok': not errors,
        'errors': errors,
        'aux': measurement.get('aux', {}),
        'by_type': measurement.get('by_type_last', {}),
        'series': [{k: v for k, v in s.items() if k != 'by_type'} for s in measurement.get('series', [])],
    })
    if errors:
        result.update({'window_s': summary['window_s'], 'cpu_pct_core': None, 'memory_mb': None,
                       'pss_slope_mb_per_hour': None, 'invalid_measurements': summary})
    else:
        result.update(summary)
    return result


def reading_at(settle, at_s):
    """Memory at the sample nearest at_s, CPU averaged over the preceding 10 s."""
    series = settle.get('series') or []
    if not series:
        return None
    nearest = min(series, key=lambda s: abs(s['t'] - at_s))
    rates = [r for t, r in settle.get('cpu_series', []) if at_s - 10 <= t <= at_s]
    return {
        'at_s': at_s,
        'sample_t': nearest['t'],
        'pss_mb': nearest['pss_mb'],
        'rss_mb': nearest['rss_mb'],
        'anon_mb': nearest['anon_mb'],
        'cpu_pct_core': round(statistics.fmean(rates), 2) if rates else None,
    }


def summarize_runs(values):
    values = [v for v in values if v is not None]
    if not values:
        return None
    return {
        'median': round(statistics.median(values), 1),
        'min': round(min(values), 1),
        'max': round(max(values), 1),
        'p90': round(sampler.percentile(values, 90), 1),
        'n': len(values),
    }


def overall_provisional(scenarios, cold_start):
    """Reasons the run's timing numbers can't stand as the baseline; empty when they can."""
    reasons = [f'{name}: {s["load"]["reason"]}' for name, s in scenarios.items()
               if s.get('load', {}).get('provisional')]
    if cold_start and cold_start.get('load', {}).get('provisional'):
        reasons.append(f'cold start: {cold_start["load"]["reason"]}')
    return reasons


def overall_ok(scenarios, cold_start):
    """Best-effort probes don't count. A missing cold start isn't a failure, a failed one is."""
    required = [s for s in scenarios.values() if not s.get('best_effort')]
    return all(s['ok'] for s in required) and (cold_start is None or cold_start.get('ok', False))


# ------------------------------------------------------------------ app and driver

class Harness:
    def __init__(self, args):
        self.args = args
        self.mode = args.mode
        self.scale = args.window_scale
        with open(os.path.join(HERE, 'scenarios.json'), encoding='utf-8') as fh:
            self.spec = json.load(fh)
        manifest = os.path.join(args.out, 'seed.json')
        self.seed = None
        if os.path.exists(manifest):
            with open(manifest, encoding='utf-8') as fh:
                self.seed = json.load(fh)
        self.proc = sampler.ProcFS()
        self.aux = ['Xvfb'] if self.mode == 'container' else []
        self.log_no = 0

    @property
    def binary(self):
        return os.path.join(self.args.app, BINARY)

    def deep_link(self):
        return f'semaphore://community/{self.seed["community"]}/channel/{self.seed["general"]}'

    def spawn(self, debug=True, deep_link=True, extra_args=(), extra_env=None):
        argv = [
            self.binary,
            f'--user-data-dir={self.args.profile}',
            '--password-store=basic',
            '--use-fake-device-for-media-stream',
        ]
        if self.args.no_sandbox:
            argv.append('--no-sandbox')
        if self.mode == 'container':
            argv.append('--force-device-scale-factor=1')
        elif os.environ.get('WAYLAND_DISPLAY'):
            argv.append('--ozone-platform=wayland')
        if debug:
            argv.append(f'--remote-debugging-port={CDP_PORT}')
        argv.extend(extra_args)
        if deep_link:
            argv.append(self.deep_link())
        env = dict(os.environ)
        env.update(extra_env or {})
        self.log_no += 1
        log = open(os.path.join(self.args.out, f'app-{self.args.step}-{self.log_no}.log'), 'wb')
        return subprocess.Popen(argv, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def stop(self, app):
        if app.poll() is not None:
            return
        # The main process only: it quits gracefully, and its storage service
        # flushes localStorage. Signalling the group kills that service first,
        # which loses the session, and a rotated refresh token with it (the
        # next launch then trips reuse detection).
        os.kill(app.pid, signal.SIGTERM)
        try:
            app.wait(timeout=30)
        except subprocess.TimeoutExpired:
            print(f'app {app.pid} ignored SIGTERM; killing it', file=sys.stderr)
            os.killpg(app.pid, signal.SIGKILL)
            app.wait(timeout=15)
        # Stragglers in the group; the next launch needs the profile free.
        try:
            os.killpg(app.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def driver_cmd(self):
        return self.args.driver.split()

    def driver(self, action, args=None, timeout=120):
        cmd = self.driver_cmd() + [action, json.dumps(args or {})]
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        if done.returncode != 0:
            raise RuntimeError(f'driver {action} failed: {done.stderr.strip()[-1500:]}')
        return json.loads(done.stdout.strip().splitlines()[-1])

    def start_wait_interactive(self):
        """Start the waiter before the app exists; returns once it is listening."""
        cmd = self.driver_cmd() + ['wait-interactive', '{}']
        waiter = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        line = waiter.stderr.readline()
        if 'READY' not in line:
            waiter.kill()
            raise RuntimeError(f'driver did not start: {line} {waiter.stderr.read()[-800:]}')
        stderr_tail = []
        thread = threading.Thread(target=lambda: stderr_tail.extend(waiter.stderr.readlines()), daemon=True)
        thread.start()
        waiter.stderr_tail = stderr_tail
        return waiter

    def finish_wait_interactive(self, waiter, timeout=120):
        out = waiter.stdout.read() if waiter.wait(timeout=timeout) == 0 else ''
        if waiter.returncode != 0:
            raise RuntimeError(f'app never became interactive: {"".join(waiter.stderr_tail)[-1500:]}')
        return json.loads(out.strip().splitlines()[-1])

    def launch_interactive(self, **kwargs):
        waiter = self.start_wait_interactive()
        app = self.spawn(**kwargs)
        try:
            self.finish_wait_interactive(waiter)
            self.fit_window()
        except Exception:
            self.stop(app)
            raise
        return app

    def windows(self):
        done = subprocess.run(['xdotool', 'search', '--onlyvisible', '--class', 'semaphore'],
                              capture_output=True, text=True, check=False)
        return done.stdout.split()

    def fit_window(self):
        """No window manager under Xvfb: put the window at the scenario's size ourselves."""
        if self.mode != 'container':
            return
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            ids = self.windows()
            if ids:
                for win in ids:
                    subprocess.run(['xdotool', 'windowmove', win, '0', '0'], check=True)
                    subprocess.run(['xdotool', 'windowsize', win, str(WINDOW[0]), str(WINDOW[1])], check=True)
                return
            time.sleep(POLL_S)
        raise RuntimeError('no visible window')

    def wait_window_size(self):
        """Bounded wait until the renderer reports the size we asked for."""
        if self.mode != 'container':
            return self.driver('state')
        deadline = time.monotonic() + 15
        while True:
            state = self.driver('state')
            if state['inner_width'] == WINDOW[0] or time.monotonic() > deadline:
                return state
            time.sleep(0.2)

    def measure(self, app, duration, mem_interval=5.0):
        return sampler.sample(self.proc, app.pid, duration, exe_prefix=self.args.app,
                              aux_names=self.aux, mem_interval=mem_interval)

    def window_checks(self, state):
        """A run at the wrong size isn't the scenario's run."""
        if self.mode == 'container' and state.get('inner_width') != WINDOW[0]:
            return [f'window width {state.get("inner_width")}, wanted {WINDOW[0]}']
        return []

    # ---------------------------------------------------------- steps

    def wait_for_low_load(self, expected_self_load=0):
        """Load average is a decaying mean: let the previous step's load (or our own start-up) drain.

        Bounded: a machine that stays busy is reported as provisional, not waited for.
        """
        limit = self.spec['load']['low_load_per_cpu'] * os.cpu_count() + expected_self_load
        deadline = time.monotonic() + self.args.load_wait
        while time.monotonic() < deadline:
            value = sampler.load1(self.proc.loadavg())
            if value is not None and value <= limit:
                return
            time.sleep(2)

    def load(self, start, series, expected_self_load=0):
        return load_report(start, self.proc.loadavg(), series, os.cpu_count(),
                           self.spec['load']['low_load_per_cpu'], expected_self_load)

    def write(self, name, data):
        path = os.path.join(self.args.out, name)
        with open(f'{path}.tmp', 'w', encoding='utf-8') as fh:
            json.dump(data, fh, indent=1)
        os.replace(f'{path}.tmp', path)

    def prep(self):
        """Sign in once on a fresh profile; every later launch reuses it."""
        waiter_app = self.spawn(deep_link=False)
        try:
            self.driver('login', {
                'server': self.args.server, **USER,
                'community': self.seed['community'], 'channel': self.seed['general'],
            }, timeout=180)
        finally:
            self.stop(waiter_app)
        # Prove the session survives a restart; every later step depends on it.
        self.stop(self.launch_interactive())

    def env_step(self):
        app = self.launch_interactive()
        try:
            state = self.wait_window_size()
            gpu = self.driver('gpu')
        finally:
            self.stop(app)
        data = {
            'platform': 'linux',
            'kernel': platform.release(),
            'distro': _os_release(),
            'display': 'xvfb' if self.mode == 'container' else ('wayland' if os.environ.get('WAYLAND_DISPLAY') else 'x11'),
            'mode': self.mode,
            'cpu_model': _cpu_model(),
            'cpus': os.cpu_count(),
            'mem_total_mb': _mem_total_mb(),
            'sandbox': not self.args.no_sandbox,
            'window': {'width': state['inner_width'], 'height': state['inner_height'],
                       'device_scale_factor': state['device_pixel_ratio']},
            'renderer': gpu,
            'browser_version': state['browser_version'],
            'user_agent': state['user_agent'],
            'packages': _packages(),
        }
        self.write('env.json', data)

    def cold_start(self):
        plan = self.spec['cold_start']
        runs = max(1, self.args.cold_runs or plan['runs'])
        out = {'ok': True, 'definition': self.spec['interactive'], 'errors': [], 'variants': {}}
        self.wait_for_low_load()
        load_start = self.proc.loadavg()
        # One discarded launch first: a fresh container's first launch pays for
        # things later ones don't. Then alternate, so drift hits both variants.
        self.stop(self.launch_interactive())
        rows = {variant: [] for variant in plan['variants']}
        for _ in range(runs):
            for variant in rows:
                try:
                    rows[variant].append(self.cold_run(variant == 'evicted_cache'))
                except (RuntimeError, subprocess.TimeoutExpired) as err:
                    out['ok'] = False
                    out['errors'].append(f'{variant}: {err}')
        for variant, description in plan['variants'].items():
            done = rows[variant]
            out['variants'][variant] = {
                'description': description,
                'interactive_ms': summarize_runs([r['interactive_ms'] for r in done]),
                'window_mapped_ms': summarize_runs([r['window_mapped_ms'] for r in done]),
                'first_contentful_paint_ms': summarize_runs([r['first_contentful_paint_ms'] for r in done]),
                'runs': done,
            }
        out['load'] = self.load(load_start, [])
        self.write('cold_start.json', out)

    def cold_run(self, evict):
        resident = None
        if evict:
            import disk
            disk.evict(self.args.app)
            resident = _resident_bytes(self.binary)
        waiter = self.start_wait_interactive()
        mapped = {}
        stop_poll = threading.Event()

        def poll_window():
            while self.mode == 'container' and not stop_poll.is_set():
                if self.windows():
                    mapped['at'] = time.time() * 1000
                    return
                time.sleep(POLL_S)

        poller = threading.Thread(target=poll_window, daemon=True)
        start = time.time() * 1000
        app = self.spawn()
        poller.start()
        try:
            result = self.finish_wait_interactive(waiter)
        finally:
            stop_poll.set()
            self.stop(app)
        poller.join(timeout=2)
        fcp = next((p[1] for p in result.get('paints', []) if p[0] == 'first-contentful-paint'), None)
        return {
            'interactive_ms': round(result['interactive_wall_ms'] - start, 1),
            'window_mapped_ms': round(mapped['at'] - start, 1) if 'at' in mapped else None,
            'first_contentful_paint_ms': round(result['time_origin'] + fcp - start, 1) if fcp is not None else None,
            'binary_resident_bytes_after_evict': resident,
        }

    def scenario(self, name):
        spec = self.spec['scenarios'][name]
        result = {'title': spec['title'], 'ok': False, 'errors': [], 'best_effort': bool(spec.get('best_effort'))}
        handler = getattr(self, f'run_{name}', None) or self.run_idle
        self.wait_for_low_load(spec.get('expected_self_load', 0))
        load_start = self.proc.loadavg()
        try:
            handler(name, spec, result)
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError, ValueError, KeyError) as err:
            # Nothing was measured under valid conditions, so there is nothing to report.
            result.update({'ok': False, 'cpu_pct_core': None, 'memory_mb': None, 'window_s': None,
                           'errors': sorted(set(result['errors'] + [f'{type(err).__name__}: {err}']))})
        series = result.get('series', [])
        result['load'] = self.load(load_start, series, spec.get('expected_self_load', 0))
        result['provisional'] = result['load']['provisional']
        self.write(f'scenario-{name}.json', result)
        print(f'{name}: {"ok" if result["ok"] else "FAILED " + "; ".join(result["errors"])}'
              f'{" (PROVISIONAL: " + result["load"]["reason"] + ")" if result["provisional"] else ""}')

    def run_idle(self, name, spec, result):
        """a_idle, e_idle_growth, probe_angle_lavapipe: launch, then leave it alone."""
        settle = scaled(spec.get('settle_s', 0), self.scale)
        window = scaled(spec['window_s'], self.scale)
        interval = spec.get('mem_interval_s', 5.0) if self.scale >= 1 else 5.0
        app = self.launch_interactive(extra_args=spec.get('extra_args', ()), extra_env=spec.get('extra_env'))
        errors = []
        try:
            state = self.wait_window_size()
            errors += self.window_checks(state)
            if spec.get('extra_args'):
                result['renderer'] = self.driver('gpu')
            settled = self.measure(app, settle) if settle else None
            measurement = self.measure(app, window, mem_interval=interval)
            final = self.driver('state')
            errors += self.window_checks(final)
        finally:
            self.stop(app)
        if settled:
            errors += settled['errors']
            result['readings'] = [r for r in (reading_at(settled, at * self.scale)
                                              for at in spec.get('readings_at_s', [])) if r]
        finalize(result, measurement, errors)
        if name == 'e_idle_growth' and result['ok']:
            series = [(s['t'], s['pss_mb']) for s in result['series'] if s['t'] >= 600 * self.scale]
            slope = sampler.slope_mb_per_hour(series)
            result['pss_slope_after_10min_mb_per_hour'] = None if slope is None else round(slope, 2)

    def run_a_noinstrument(self, _name, spec, result):
        """No debug port, so no driver and no interactive signal: time counts from launch."""
        settle = scaled(spec['settle_s'], self.scale)
        window = scaled(spec['window_s'], self.scale)
        app = self.spawn(debug=False)
        try:
            self.fit_window()
            settled = self.measure(app, settle)
            measurement = self.measure(app, window)
        finally:
            self.stop(app)
        result['readings'] = [r for r in (reading_at(settled, at * self.scale)
                                          for at in spec['readings_at_s']) if r]
        finalize(result, measurement, settled['errors'])

    def run_b_scroll(self, _name, spec, result):
        settle = scaled(spec['settle_s'], self.scale)
        window = scaled(spec['window_s'], self.scale)
        notches = int(window * spec['wheel']['notches_per_s'])
        delay_ms = round(1000 / spec['wheel']['notches_per_s'])
        app = self.launch_interactive()
        errors = []
        try:
            state = self.wait_window_size()
            errors += self.window_checks(state)
            if settle:
                time.sleep(settle)  # the settling period is part of the scenario
            before = self.driver('state')
            x, y = state['inner_width'] // 2, state['inner_height'] // 2
            wheel = threading.Thread(target=self._wheel, args=(x, y, notches, delay_ms), daemon=True)
            wheel.start()
            measurement = self.measure(app, window)
            wheel.join(timeout=window + 30)
            after = self.driver('state')
        finally:
            self.stop(app)
        wanted = max(1, int(spec['min_messages_scrolled'] * self.scale))
        moved, scroll_errors = validate_scroll({**spec, 'min_messages_scrolled': wanted}, before, after)
        errors += scroll_errors
        if wheel.is_alive():
            errors.append('wheel input was still running after the window')
        result['scroll'] = {
            'input': 'xdotool' if self.mode == 'container' else 'cdp (driver attached during the window)',
            'notches': notches, 'from_seq': before.get('top_seq'), 'to_seq': after.get('top_seq'),
            'messages_scrolled': moved, 'rendered_at_end': after.get('rendered'),
            'history_messages': self.seed['messages'],
        }
        finalize(result, measurement, errors)

    def _wheel(self, x, y, notches, delay_ms):
        if self.mode == 'container':
            subprocess.run(['xdotool', 'mousemove', str(x), str(y)], check=True)
            subprocess.run(['xdotool', 'click', '--repeat', str(notches), '--delay', str(delay_ms), '4'], check=False)
        else:
            self.driver('wheel', {'x': x, 'y': y, 'notches': notches, 'delay_ms': delay_ms},
                        timeout=notches * delay_ms / 1000 + 60)

    def join_call(self, spec):
        app = self.launch_interactive()
        try:
            self.wait_window_size()
            self.driver('install-stats-hook')
            self.driver('join-voice', {'channel': spec['channel']})
        except Exception:
            self.stop(app)
            raise
        return app

    def wait_stats(self, predicate, timeout=90):
        """Bounded poll: returns the last stats whether or not the condition held."""
        deadline = time.monotonic() + timeout
        stats = self.driver('stats')
        while not predicate(stats) and time.monotonic() < deadline:
            time.sleep(1)
            stats = self.driver('stats')
        return stats

    def run_c_voice_audio(self, _name, spec, result):
        settle = scaled(spec['settle_s'], self.scale)
        window = scaled(spec['window_s'], self.scale)
        wanted = spec['publishers']['audio']
        app = self.join_call(spec)
        errors = []
        try:
            self.wait_stats(lambda s: len(s['audio']) >= wanted)
            state = self.driver('state')
            errors += self.window_checks(state)
            if settle:
                time.sleep(settle)
            before = self.driver('stats')
            measurement = self.measure(app, window)
            after = self.driver('stats')
        finally:
            self.stop(app)
        errors += validate_audio(spec, before, after)
        result['audio'] = {'remote_streams': len(after['audio']), 'outbound_audio_bytes': after['outbound_audio_bytes']}
        result['publisher_report'] = self._publisher_report()
        finalize(result, measurement, errors)

    def run_d_video_grid(self, _name, spec, result):
        settle = scaled(spec['settle_s'], self.scale)
        window = scaled(spec['window_s'], self.scale)
        pubs = spec['publishers']
        wanted = pubs['camera'] + pubs['screen']
        app = self.join_call(spec)
        errors = []
        try:
            self.driver('watch-all', {'expect': wanted}, timeout=150)
            self.wait_stats(lambda s: sum(1 for v in s['video'] if v['frames_decoded'] > 0) >= wanted)
            state = self.driver('state')
            errors += self.window_checks(state)
            if settle:
                time.sleep(settle)
            before = self.driver('stats')
            measurement = self.measure(app, window)
            after = self.driver('stats')
        finally:
            self.stop(app)
        report = self._publisher_report()
        measured, stream_errors = validate_video(spec, before, after, report)
        errors += stream_errors
        result['stream_specs'] = {
            'requested': {'camera': {**pubs['camera_spec'], 'count': pubs['camera']},
                          'screen': {**pubs['screen_spec'], 'count': pubs['screen']}},
            'measured_received': measured,
            'publisher_report': report,
        }
        finalize(result, measurement, errors)

    def _publisher_report(self):
        path = os.path.join(self.args.out, f'publishers-{self.args.step}.json')
        if not os.path.exists(path):
            return None
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)

    def assemble(self):
        import jsonschema
        out = self.args.out
        scenarios = {}
        for name in self.spec['scenarios']:
            path = os.path.join(out, f'scenario-{name}.json')
            if os.path.exists(path):
                with open(path, encoding='utf-8') as fh:
                    scenarios[name] = json.load(fh)
        disk_data = _load(os.path.join(out, 'disk.json'))
        env = _load(os.path.join(out, 'env.json'))
        cold = _load(os.path.join(out, 'cold_start.json'))
        provisional = overall_provisional(scenarios, cold)
        renderer = (env or {}).get('renderer') or {}
        mode = (env or {}).get('mode', self.mode)
        notes = [
            f'Rendering: gpu_compositing={(renderer.get("feature_status") or {}).get("gpu_compositing")!s}, '
            f'rasterization={(renderer.get("feature_status") or {}).get("rasterization")!s}, '
            f'GL {renderer.get("gl_renderer")!s}. The native spike used lavapipe (Vulkan). Without a GPU, compositing and '
            'raster run on the CPU, so CPU figures compare two software paths and predict neither on a GPU.',
            'Native reading: compare scenarios.a_idle.readings[at_s=25] with the spike\'s ~25 s idle reading; the settled '
            'window is later than anything the spike measured.',
            'Feature parity: this is the full app (autoupdater, tray, notifications, LiveKit screen capture and so on); '
            'the spike implements a subset.',
            'Scenario d publishes one layer per stream instead of the simulcast the real app publishes for screen shares, '
            'so the tile size cannot lower what is received.',
            'Measured windows run with no driver attached, except scroll on --host. a_noinstrument gives the cost of '
            'having the debug port open at all.',
            'Cold start evicts app files only; system libraries stay cached (see binary_resident_bytes_after_evict).',
        ]
        if mode == 'container':
            notes.append('--no-sandbox in the container: renderer processes are not sandboxed, unlike a real install.')
        if provisional:
            notes.append('PROVISIONAL: the machine was not quiet during part of this run (provisional_reasons), so CPU, '
                         'cold-start and frame-rate figures are contaminated. Memory and disk are affected far less.')
        if self.scale < 1:
            notes.append(f'DEV RUN: windows scaled by {self.scale}; not a baseline.')
        data = {
            'schema_version': SCHEMA_VERSION,
            'client': 'electron',
            'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'ok': overall_ok(scenarios, cold),
            'provisional': bool(provisional),
            'provisional_reasons': provisional,
            'build': {
                'version': self.args.build_version,
                'commit': self.args.build_commit,
                'stripped': ((disk_data or {}).get('binary') or {}).get('stripped'),
            },
            'history_messages': (self.seed or {}).get('messages'),
            'seed': {k: (self.seed or {}).get(k) for k in ('prng_seed', 'mix_actual', 'attachments')},
            'window_scale': self.scale,
            'env': env,
            'disk': disk_data,
            'cold_start_ms': cold,
            'scenarios': scenarios,
            'comparability_notes': notes,
        }
        with open(os.path.join(HERE, 'result.schema.json'), encoding='utf-8') as fh:
            schema = json.load(fh)
        path = os.path.join(out, 'results.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(data, fh, indent=1)
        problems = sorted(jsonschema.Draft202012Validator(schema).iter_errors(data), key=lambda e: list(e.path))
        for problem in problems:
            print(f'schema: {"/".join(str(p) for p in problem.path)}: {problem.message[:300]}', file=sys.stderr)
        if problems:
            sys.exit(2)
        print(f'results.json validates against result.schema.json; ok={data["ok"]} provisional={data["provisional"]}')
        for reason in provisional:
            print(f'  PROVISIONAL {reason}')
        for name, scenario in scenarios.items():
            print(f'  {name}: {"ok" if scenario["ok"] else "FAILED: " + "; ".join(scenario["errors"])}')
        if not data['ok']:
            sys.exit(3)


def _load(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def _os_release():
    try:
        with open('/etc/os-release', encoding='utf-8') as fh:
            for line in fh:
                if line.startswith('PRETTY_NAME='):
                    return line.split('=', 1)[1].strip().strip('"')
    except OSError:
        pass
    return None


def _cpu_model():
    try:
        with open('/proc/cpuinfo', encoding='utf-8') as fh:
            for line in fh:
                if line.startswith('model name'):
                    return line.split(':', 1)[1].strip()
    except OSError:
        pass
    return None


def _mem_total_mb():
    with open('/proc/meminfo', encoding='utf-8') as fh:
        return int(fh.readline().split()[1]) // 1024


def _packages():
    try:
        done = subprocess.run(['pacman', '-Q', 'mesa', 'vulkan-swrast', 'xorg-server-xvfb', 'glibc'],
                              capture_output=True, text=True, check=False)
    except OSError:
        return {}
    return dict(line.split(' ', 1) for line in done.stdout.splitlines() if ' ' in line)


def _resident_bytes(path):
    """Page-cache bytes of a file (fincore), to show whether an eviction took effect."""
    try:
        done = subprocess.run(['fincore', '-nbo', 'RES', path], capture_output=True, text=True, check=True)
        return int(done.stdout.strip())
    except (OSError, ValueError, subprocess.CalledProcessError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('step')
    parser.add_argument('name', nargs='?')
    parser.add_argument('--app', default='/app')
    parser.add_argument('--out', default='/out')
    parser.add_argument('--profile', default='/out/profile')
    parser.add_argument('--server', default='')
    parser.add_argument('--mode', choices=['container', 'host'], default='container')
    parser.add_argument('--no-sandbox', action='store_true')
    parser.add_argument('--driver', default='node /opt/baseline/src/driver.ts')
    parser.add_argument('--window-scale', type=float, default=1.0)
    parser.add_argument('--cold-runs', type=int, default=0)
    parser.add_argument('--load-wait', type=float, default=180.0)
    parser.add_argument('--build-version', default='unknown')
    parser.add_argument('--build-commit', default='unknown')
    args = parser.parse_args()
    if args.step == 'scenario':
        args.step = args.name
        Harness(args).scenario(args.name)
        return
    harness = Harness(args)
    {'prep': harness.prep, 'env': harness.env_step, 'cold-start': harness.cold_start,
     'assemble': harness.assemble}[args.step]()


if __name__ == '__main__':
    main()
