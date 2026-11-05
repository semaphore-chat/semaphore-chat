#!/usr/bin/env python3
"""Sample CPU and memory of a process tree from /proc (stdlib only).

Client-neutral: the native spike's harness can run this unchanged against its
own binary, so both clients are counted by the same rules:

- Tree: the root PID and every descendant, plus any process whose executable
  lives under --exe-prefix. Chromium's crashpad handler double-forks and is
  reparented to init, so a plain descendant walk would miss it.
- Memory: /proc/<pid>/smaps_rollup. PSS is what the tree costs (shared pages
  are split among their users). Summed RSS double counts them and is kept only
  for comparison. A smaps_rollup we may not read makes the sample invalid: it
  is reported in `unreadable`, never silently treated as zero.
- CPU: utime+stime from /proc/<pid>/stat. Ticks of a process that exits during
  the window are kept at their last seen value, so at most one interval of a
  short-lived process is lost.

Usage: sampler.py --root-pid P --duration S [--exe-prefix DIR] [--aux Xvfb]
                  [--cpu-interval 1] [--mem-interval 5] [--out FILE]
"""
import argparse
import json
import os
import re
import statistics
import time

STAT_MEMORY_FIELDS = {
    'Pss': 'pss',
    'Rss': 'rss',
    'Anonymous': 'anon',
    'Pss_Anon': 'pss_anon',
    'Pss_File': 'pss_file',
    'Pss_Shmem': 'pss_shmem',
    'Swap': 'swap',
}
TYPE_SWITCH = re.compile(rb'--type=([^\s\0]+)')
MB = 1024.0  # smaps_rollup is in kB; we report MiB


class ProcFS:
    """Reads the few /proc files we need; `root` is replaceable for tests."""

    def __init__(self, root='/proc', clk_tck=None):
        self.root = root
        self.clk_tck = clk_tck or os.sysconf('SC_CLK_TCK')

    def loadavg(self):
        """The raw /proc/loadavg line, or None. System-wide: not namespaced in a container."""
        try:
            with open(f'{self.root}/loadavg', encoding='latin-1') as fh:
                return fh.read().strip()
        except OSError:
            return None

    def pids(self):
        return [int(name) for name in os.listdir(self.root) if name.isdigit()]

    def stat(self, pid):
        """(comm, ppid, cpu_ticks, starttime), or None if the process is gone."""
        try:
            with open(f'{self.root}/{pid}/stat', encoding='latin-1') as fh:
                raw = fh.read()
        except (FileNotFoundError, ProcessLookupError):
            return None
        # comm can hold spaces and parens: split around the LAST ')'.
        comm = raw[raw.index('(') + 1:raw.rindex(')')]
        rest = raw[raw.rindex(')') + 2:].split()
        # rest[0] is field 3 (state), so field N is rest[N - 3].
        return comm, int(rest[1]), int(rest[11]) + int(rest[12]), int(rest[19])

    def exe(self, pid):
        try:
            return os.readlink(f'{self.root}/{pid}/exe')
        except OSError:
            return None

    def process_type(self, pid):
        """Chromium's --type= switch; 'main' for a process without one.

        Zygote children rewrite their title, so arguments can be separated by
        spaces instead of NULs.
        """
        try:
            with open(f'{self.root}/{pid}/cmdline', 'rb') as fh:
                match = TYPE_SWITCH.search(fh.read())
        except OSError:
            return 'unknown'
        return match.group(1).decode('latin-1') if match else 'main'

    def memory(self, pid):
        """kB per field; None if the process is gone; raises PermissionError if unreadable."""
        out = {}
        try:
            with open(f'{self.root}/{pid}/smaps_rollup', encoding='latin-1') as fh:
                for line in fh:
                    key, _, value = line.partition(':')
                    if key in STAT_MEMORY_FIELDS:
                        out[STAT_MEMORY_FIELDS[key]] = int(value.split()[0])
        except (FileNotFoundError, ProcessLookupError):
            return None
        except OSError as err:
            # Kernel threads and exiting processes give ESRCH/EIO-ish errors;
            # only access problems undercount a live process.
            if isinstance(err, PermissionError):
                raise
            return None
        return out or None


def load1(raw):
    """The 1-minute figure of a /proc/loadavg line, or None."""
    try:
        return float(raw.split()[0])
    except (AttributeError, IndexError, ValueError):
        return None


def find_tree(proc, root_pid, exe_prefix=None):
    """PIDs of root_pid, its descendants, and anything run from exe_prefix."""
    children = {}
    extra = set()
    for pid in proc.pids():
        stat = proc.stat(pid)
        if stat is None:
            continue
        children.setdefault(stat[1], []).append(pid)
        if exe_prefix:
            exe = proc.exe(pid)
            if exe and exe.startswith(exe_prefix.rstrip('/') + '/'):
                extra.add(pid)
    found = set()
    stack = [root_pid] + list(extra)
    while stack:
        pid = stack.pop()
        if pid in found:
            continue
        found.add(pid)
        stack.extend(children.get(pid, []))
    return {pid for pid in found if proc.stat(pid) is not None}


def read_memory(proc, pids):
    """Totals (MiB) over pids, split by process type; unreadable PIDs are listed."""
    totals = {name: 0.0 for name in STAT_MEMORY_FIELDS.values()}
    by_type = {}
    unreadable = []
    counted = 0
    for pid in sorted(pids):
        try:
            mem = proc.memory(pid)
        except PermissionError:
            unreadable.append(pid)
            continue
        if mem is None:
            continue
        counted += 1
        for key, value in mem.items():
            totals[key] += value / MB
        kind = proc.process_type(pid)
        entry = by_type.setdefault(kind, {'pss': 0.0, 'rss': 0.0, 'count': 0})
        entry['pss'] += mem.get('pss', 0) / MB
        entry['rss'] += mem.get('rss', 0) / MB
        entry['count'] += 1
    return {**totals, 'processes': counted, 'by_type': by_type, 'unreadable': unreadable}


class CpuTracker:
    """Cumulative ticks of a changing set of processes since the first update."""

    def __init__(self):
        self.last = {}
        self.baseline = None

    def update(self, proc, pids):
        for pid in pids:
            stat = proc.stat(pid)
            if stat is not None:
                self.last[(pid, stat[3])] = stat[2]
        if self.baseline is None:
            # Ticks before the window aren't ours. A process that first shows
            # up later started inside the window: all of its ticks count.
            self.baseline = dict(self.last)
        return sum(ticks - self.baseline.get(key, 0) for key, ticks in self.last.items())


def percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))]


def slope_mb_per_hour(points):
    """Least-squares slope of (seconds, MiB) points, in MiB per hour."""
    if len(points) < 2:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    mean_x, mean_y = statistics.fmean(xs), statistics.fmean(ys)
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom == 0:
        return None
    return sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom * 3600


def sample(proc, root_pid, duration, exe_prefix=None, aux_names=(), cpu_interval=1.0,
           mem_interval=5.0, clock=time.monotonic, wait=time.sleep):
    """Measure for `duration` seconds. The waits are the measurement window itself."""
    start = clock()
    tracker = CpuTracker()
    aux_trackers = {name: CpuTracker() for name in aux_names}
    aux_rss = {name: [] for name in aux_names}
    tracker.update(proc, find_tree(proc, root_pid, exe_prefix))
    for name in aux_names:
        aux_trackers[name].update(proc, _by_comm(proc, name))

    series = []
    cpu_rates = []
    cpu_times = []
    last_ticks, last_time = 0, start
    next_mem = start
    root_exited_at = None
    errors = set()

    while True:
        now = clock()
        pids = find_tree(proc, root_pid, exe_prefix)
        ticks = tracker.update(proc, pids)
        if now > last_time:
            cpu_rates.append((ticks - last_ticks) / proc.clk_tck / (now - last_time) * 100)
            cpu_times.append(now - start)
            last_ticks, last_time = ticks, now
        if root_pid not in pids and root_exited_at is None:
            root_exited_at = now - start
            errors.add(f'root process {root_pid} exited {now - start:.1f}s into the window')
        if now >= next_mem and pids:
            mem = read_memory(proc, pids)
            if mem['unreadable']:
                errors.add(f'smaps_rollup unreadable for PIDs {mem["unreadable"]}: memory would undercount')
            series.append({
                't': round(now - start, 2),
                'load1': load1(proc.loadavg()),
                'pss_mb': round(mem['pss'], 1),
                'rss_mb': round(mem['rss'], 1),
                'anon_mb': round(mem['anon'], 1),
                'processes': mem['processes'],
                'cpu_pct': round(cpu_rates[-1], 1) if cpu_rates else None,
                'by_type': _round_types(mem['by_type']),
                'unreadable': len(mem['unreadable']),
            })
            for name in aux_names:
                aux_rss[name].append(_rss_of(proc, _by_comm(proc, name)))
            next_mem += mem_interval
        if now - start >= duration:
            break
        wait(min(cpu_interval, duration - (now - start)))

    elapsed = clock() - start
    total_ticks = tracker.update(proc, find_tree(proc, root_pid, exe_prefix))
    aux = {}
    for name in aux_names:
        ticks = aux_trackers[name].update(proc, _by_comm(proc, name))
        rss = [r for r in aux_rss[name] if r is not None]
        aux[name] = {
            'cpu_pct_core_avg': round(ticks / proc.clk_tck / elapsed * 100, 2) if elapsed else None,
            'rss_mb': round(statistics.median(rss), 1) if rss else None,
        }
    return {
        'window_s': round(elapsed, 2),
        'cpu_pct_core': {
            'avg': round(total_ticks / proc.clk_tck / elapsed * 100, 2) if elapsed else None,
            'p95': _rounded(percentile(cpu_rates[1:], 95)),
        },
        'memory_mb': _memory_summary(series),
        'pss_slope_mb_per_hour': _rounded(
            slope_mb_per_hour([(s['t'], s['pss_mb']) for s in series])),
        'by_type_last': series[-1]['by_type'] if series else {},
        'series': series,
        'cpu_series': [(round(t, 2), round(r, 1)) for t, r in zip(cpu_times, cpu_rates)],
        'aux': aux,
        'errors': sorted(errors),
    }


def _memory_summary(series):
    if not series:
        return {'primary_metric': 'pss', 'pss': None, 'rss': None, 'anon': None,
                'private_working_set': None, 'pss_peak': None}
    return {
        'primary_metric': 'pss',
        'pss': round(statistics.median(s['pss_mb'] for s in series), 1),
        'rss': round(statistics.median(s['rss_mb'] for s in series), 1),
        'anon': round(statistics.median(s['anon_mb'] for s in series), 1),
        'private_working_set': None,
        'pss_peak': max(s['pss_mb'] for s in series),
    }


def _round_types(by_type):
    return {kind: {'pss': round(v['pss'], 1), 'rss': round(v['rss'], 1), 'count': v['count']}
            for kind, v in by_type.items()}


def _rounded(value):
    return None if value is None else round(value, 2)


def _by_comm(proc, name):
    out = set()
    for pid in proc.pids():
        stat = proc.stat(pid)
        if stat is not None and stat[0] == name:
            out.add(pid)
    return out


def _rss_of(proc, pids):
    if not pids:
        return None
    try:
        return round(read_memory(proc, pids)['rss'], 1)
    except OSError:
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--root-pid', type=int, required=True)
    parser.add_argument('--duration', type=float, required=True)
    parser.add_argument('--exe-prefix')
    parser.add_argument('--aux', action='append', default=[])
    parser.add_argument('--cpu-interval', type=float, default=1.0)
    parser.add_argument('--mem-interval', type=float, default=5.0)
    parser.add_argument('--out')
    args = parser.parse_args()
    result = sample(ProcFS(), args.root_pid, args.duration, args.exe_prefix, args.aux,
                    args.cpu_interval, args.mem_interval)
    text = json.dumps(result, indent=1)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text)
    else:
        print(text)


if __name__ == '__main__':
    main()
