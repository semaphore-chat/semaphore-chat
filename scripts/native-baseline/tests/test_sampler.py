"""Unit tests for sampler.py against a fake /proc. Run: python3 -m unittest discover -s tests"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sampler  # noqa: E402


def smaps(pss, rss, anon):
    return (f'55d0-7ffe ---p 00000000 00:00 0 [rollup]\nRss: {rss} kB\nPss: {pss} kB\n'
            f'Pss_Anon: {anon} kB\nPss_File: 1 kB\nPss_Shmem: 1 kB\nAnonymous: {anon} kB\nSwap: 0 kB\n')


class FakeProc:
    def __init__(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = self.dir.name
        self.fs = sampler.ProcFS(self.root, clk_tck=100)

    def cleanup(self):
        self.dir.cleanup()

    def add(self, pid, ppid, ticks=(0, 0), comm='app', args=(), memory=(1024, 2048, 512), exe=None, start=1000):
        path = f'{self.root}/{pid}'
        os.makedirs(path, exist_ok=True)
        fields = ['S', ppid] + [0] * 9 + [ticks[0], ticks[1]] + [0] * 6 + [start] + [0] * 5
        with open(f'{path}/stat', 'w', encoding='latin-1') as fh:
            fh.write(f'{pid} ({comm}) ' + ' '.join(str(f) for f in fields) + '\n')
        with open(f'{path}/cmdline', 'wb') as fh:
            fh.write(b'\0'.join(a.encode() for a in ('/app/x',) + tuple(args)) + b'\0')
        if memory is not None:
            with open(f'{path}/smaps_rollup', 'w', encoding='latin-1') as fh:
                fh.write(smaps(*memory))
        if exe:
            os.symlink(exe, f'{path}/exe')

    def set_ticks(self, pid, ppid, ticks, start=1000):
        self.add(pid, ppid, ticks=ticks, start=start)

    def remove(self, pid):
        import shutil
        shutil.rmtree(f'{self.root}/{pid}')


class ProcTestCase(unittest.TestCase):
    def fake_proc(self):
        proc = FakeProc()
        self.addCleanup(proc.cleanup)
        return proc


class TreeTest(ProcTestCase):
    def test_finds_descendants_and_reparented_exe_but_not_strangers(self):
        proc = self.fake_proc()
        proc.add(1, 0, comm='init')
        proc.add(10, 1, exe='/app/semaphore-chat')
        proc.add(11, 10, args=('--type=zygote',))
        proc.add(12, 11, args=('--type=renderer',))
        # crashpad double-forks: its parent is init, only the exe path ties it to us
        proc.add(20, 1, exe='/app/chrome_crashpad_handler')
        proc.add(30, 1, exe='/usr/bin/Xvfb', comm='Xvfb')
        # a directory whose name merely starts with the prefix is not ours
        proc.add(31, 1, exe='/application/other')
        self.assertEqual(sampler.find_tree(proc.fs, 10, '/app'), {10, 11, 12, 20})

    def test_dead_root_is_absent(self):
        proc = self.fake_proc()
        proc.add(1, 0)
        self.assertEqual(sampler.find_tree(proc.fs, 99), set())

    def test_comm_with_parens_and_spaces_parses(self):
        proc = self.fake_proc()
        proc.add(5, 1, comm='a) (b c', ticks=(7, 3))
        comm, ppid, ticks, _ = proc.fs.stat(5)
        self.assertEqual((comm, ppid, ticks), ('a) (b c', 1, 10))


class MemoryTest(ProcTestCase):
    def test_sums_pss_rss_anon_in_mib_and_splits_by_type(self):
        proc = self.fake_proc()
        proc.add(10, 1, memory=(1024, 4096, 512))
        proc.add(11, 10, args=('--type=renderer',), memory=(2048, 4096, 1024))
        mem = sampler.read_memory(proc.fs, {10, 11})
        self.assertEqual(mem['pss'], 3.0)
        self.assertEqual(mem['rss'], 8.0)
        self.assertEqual(mem['anon'], 1.5)
        self.assertEqual(mem['processes'], 2)
        self.assertEqual(mem['by_type']['renderer']['pss'], 2.0)
        self.assertEqual(mem['by_type']['main']['count'], 1)

    def test_type_read_from_a_rewritten_space_separated_cmdline(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        with open(f'{proc.root}/10/cmdline', 'wb') as fh:
            fh.write(b'/app/semaphore-chat --type=renderer --no-sandbox --lang=en\0\0\0')
        self.assertEqual(proc.fs.process_type(10), 'renderer')

    def test_vanished_process_is_skipped_silently(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        mem = sampler.read_memory(proc.fs, {10, 77})
        self.assertEqual(mem['processes'], 1)
        self.assertEqual(mem['unreadable'], [])

    def test_permission_denied_is_reported_not_counted_as_zero(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        real = proc.fs.memory

        def denied(pid):
            if pid == 11:
                raise PermissionError(13, 'denied')
            return real(pid)

        proc.fs.memory = denied
        self.assertEqual(sampler.read_memory(proc.fs, {10, 11})['unreadable'], [11])


class CpuTest(ProcTestCase):
    def test_ticks_before_the_window_do_not_count(self):
        proc = self.fake_proc()
        proc.add(10, 1, ticks=(500, 500))
        tracker = sampler.CpuTracker()
        self.assertEqual(tracker.update(proc.fs, {10}), 0)
        proc.set_ticks(10, 1, (505, 505))
        self.assertEqual(tracker.update(proc.fs, {10}), 10)

    def test_exited_process_keeps_its_last_ticks(self):
        proc = self.fake_proc()
        proc.add(10, 1, ticks=(0, 0))
        tracker = sampler.CpuTracker()
        tracker.update(proc.fs, {10})
        proc.set_ticks(10, 1, (40, 0))
        tracker.update(proc.fs, {10})
        proc.remove(10)
        self.assertEqual(tracker.update(proc.fs, set()), 40)

    def test_process_born_in_the_window_counts_fully(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        tracker = sampler.CpuTracker()
        tracker.update(proc.fs, {10})
        proc.add(11, 10, ticks=(30, 0))
        self.assertEqual(tracker.update(proc.fs, {10, 11}), 30)

    def test_reused_pid_is_a_new_process(self):
        proc = self.fake_proc()
        proc.add(10, 1, ticks=(100, 0), start=1)
        tracker = sampler.CpuTracker()
        tracker.update(proc.fs, {10})
        proc.set_ticks(10, 1, (5, 0), start=2)
        self.assertEqual(tracker.update(proc.fs, {10}), 5)


class FakeClock:
    """Each wait advances time and lets a test change the fake /proc."""

    def __init__(self, on_wait=None):
        self.now = 100.0
        self.on_wait = on_wait

    def clock(self):
        return self.now

    def wait(self, seconds):
        self.now += seconds
        if self.on_wait:
            self.on_wait(self.now - 100.0)


class SampleTest(ProcTestCase):
    def test_half_a_core_over_the_window(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        # 50 ticks per second at 100 Hz = 50% of one core
        fake = FakeClock(lambda t: proc.set_ticks(10, 1, (int(t * 50), 0)))
        result = sampler.sample(proc.fs, 10, 10, clock=fake.clock, wait=fake.wait,
                                cpu_interval=1, mem_interval=5)
        self.assertEqual(result['cpu_pct_core']['avg'], 50.0)
        self.assertEqual(result['cpu_pct_core']['p95'], 50.0)
        self.assertEqual(result['window_s'], 10.0)
        self.assertEqual(result['errors'], [])
        self.assertEqual(len(result['series']), 3)  # t = 0, 5, 10
        self.assertEqual(result['memory_mb']['primary_metric'], 'pss')
        self.assertEqual(result['memory_mb']['pss'], 1.0)
        self.assertIsNone(result['memory_mb']['private_working_set'])

    def test_root_exit_is_an_error(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        fake = FakeClock(lambda t: proc.remove(10) if t == 2 else None)
        result = sampler.sample(proc.fs, 10, 4, clock=fake.clock, wait=fake.wait)
        self.assertTrue(any('exited' in e for e in result['errors']))

    def test_unreadable_memory_is_an_error(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        real = proc.fs.memory

        def denied(pid):
            raise PermissionError(13, 'denied')

        proc.fs.memory = denied
        fake = FakeClock()
        result = sampler.sample(proc.fs, 10, 1, clock=fake.clock, wait=fake.wait)
        self.assertTrue(any('unreadable' in e for e in result['errors']))
        proc.fs.memory = real

    def test_aux_process_is_reported_apart_from_the_tree(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        proc.add(30, 1, comm='Xvfb', memory=(100, 2048, 10))
        fake = FakeClock(lambda t: proc.add(30, 1, comm='Xvfb', ticks=(int(t * 10), 0), memory=(100, 2048, 10)))
        result = sampler.sample(proc.fs, 10, 10, aux_names=('Xvfb',), clock=fake.clock, wait=fake.wait)
        self.assertEqual(result['aux']['Xvfb']['cpu_pct_core_avg'], 10.0)
        self.assertEqual(result['aux']['Xvfb']['rss_mb'], 2.0)
        self.assertEqual(result['cpu_pct_core']['avg'], 0.0)
        self.assertEqual(result['memory_mb']['rss'], 2.0)  # only the tree's


class LoadavgTest(ProcTestCase):
    def test_series_records_load(self):
        proc = self.fake_proc()
        proc.add(10, 1)
        with open(f'{proc.root}/loadavg', 'w', encoding='latin-1') as fh:
            fh.write('84.10 80.00 70.00 9/2000 1234\n')
        fake = FakeClock()
        result = sampler.sample(proc.fs, 10, 1, clock=fake.clock, wait=fake.wait)
        self.assertEqual(result['series'][0]['load1'], 84.1)
        self.assertEqual(proc.fs.loadavg(), '84.10 80.00 70.00 9/2000 1234')

    def test_missing_loadavg_is_none(self):
        proc = self.fake_proc()
        self.assertIsNone(proc.fs.loadavg())
        self.assertIsNone(sampler.load1(None))


class SlopeTest(unittest.TestCase):
    def test_slope_in_mib_per_hour(self):
        points = [(t, 100 + t / 60) for t in range(0, 1800, 30)]  # 1 MiB per minute
        self.assertAlmostEqual(sampler.slope_mb_per_hour(points), 60.0, places=6)

    def test_slope_needs_two_points(self):
        self.assertIsNone(sampler.slope_mb_per_hour([(0, 1)]))

    def test_percentile(self):
        self.assertEqual(sampler.percentile(list(range(101)), 95), 95)
        self.assertIsNone(sampler.percentile([], 95))


if __name__ == '__main__':
    unittest.main()
