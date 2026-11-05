"""Tests for the pass/fail rules and the result schema. Run: python3 -m unittest discover -s tests

A failed scenario must read as failed: these pin that it reports no metrics and
that the schema rejects a failed scenario carrying numbers.
"""
import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import baseline  # noqa: E402

with open(os.path.join(HERE, 'scenarios.json'), encoding='utf-8') as fh:
    SCENARIOS = json.load(fh)['scenarios']

D = SCENARIOS['d_video_grid']


CAMERA_BPS = D['publishers']['camera_spec']['max_bitrate']
SCREEN_BPS = D['publishers']['screen_spec']['max_bitrate']


def stream(sid, width, height, frames, ts, codec='video/VP8', bps=0):
    return {'id': sid, 'width': width, 'height': height, 'frames_received': frames, 'frames_decoded': frames,
            'frames_dropped': 0, 'bytes': bps * ts // 8000, 'codec': codec, 'decoder': 'libvpx', 'ts': ts}


def grid(width=1280, height=720, cam_frames=1800, screen=(1920, 1080), screen_frames=3600, ts=60000,
         cam_bps=CAMERA_BPS, screen_bps=SCREEN_BPS):
    video = [stream(f'cam{i}', width, height, cam_frames, ts, bps=cam_bps) for i in range(9)]
    video.append(stream('screen', screen[0], screen[1], screen_frames, ts, bps=screen_bps))
    return {'video': video}


def report(cam_fps=30, screen_fps=60, streams=None):
    specs = D['publishers']
    rows = [{'kind': 'camera', 'requested': specs['camera_spec'], 'captured_fps': cam_fps} for _ in range(9)]
    rows.append({'kind': 'screen', 'requested': specs['screen_spec'], 'captured_fps': screen_fps})
    return {'streams': rows if streams is None else streams, 'failures': []}


BEFORE = {'video': [stream(f'cam{i}', 1280, 720, 0, 0) for i in range(9)] + [stream('screen', 1920, 1080, 0, 0)]}


class VideoValidationTest(unittest.TestCase):
    def test_exact_specs_pass(self):
        measured, errors = baseline.validate_video(D, BEFORE, grid(), report())
        self.assertEqual(errors, [])
        self.assertEqual(len(measured), 10)
        self.assertEqual(measured[0]['fps'], 30.0)

    def test_lower_received_resolution_fails_and_reports_what_was_measured(self):
        measured, errors = baseline.validate_video(D, BEFORE, grid(width=640, height=360), report())
        self.assertEqual(sum('no received stream at 1280x720' in e for e in errors), 9)
        self.assertEqual(sum('unexpected stream 640x360' in e for e in errors), 9)
        self.assertEqual(measured[0]['width'], 640)

    def test_decoding_under_the_rate_fails(self):
        _, errors = baseline.validate_video(D, BEFORE, grid(cam_frames=900), report())
        self.assertEqual(sum('decoded at 15.0 fps' in e for e in errors), 9)

    def test_scenario_is_the_agreed_spec(self):
        pubs = D['publishers']
        self.assertEqual((pubs['camera'], pubs['camera_spec']['fps'], pubs['camera_spec']['max_bitrate']), (9, 30, 1700000))
        self.assertEqual((pubs['screen'], pubs['screen_spec']['fps'], pubs['screen_spec']['max_bitrate']), (1, 60, 9000000))

    def test_light_stream_fails_even_at_exact_size_and_rate(self):
        _, errors = baseline.validate_video(D, BEFORE, grid(cam_bps=800000), report())
        self.assertEqual(sum('received at 800000 bps' in e for e in errors), 9)

    def test_screen_at_half_its_rate_fails(self):
        _, errors = baseline.validate_video(D, BEFORE, grid(screen_frames=1800), report())
        self.assertTrue(any('decoded at 30.0 fps' in e for e in errors))

    def test_missing_stream_fails(self):
        after = grid()
        after['video'].pop()
        _, errors = baseline.validate_video(D, BEFORE, after, report())
        self.assertTrue(any('1920x1080' in e for e in errors))

    def test_slow_publisher_fails_even_if_the_client_kept_up(self):
        _, errors = baseline.validate_video(D, BEFORE, grid(), report(screen_fps=12))
        self.assertTrue(any('publisher screen captured at 12' in e for e in errors))

    def test_no_publisher_report_fails(self):
        _, errors = baseline.validate_video(D, BEFORE, grid(), None)
        self.assertIn('no publisher report', errors)

    def test_wrong_codec_fails(self):
        after = grid()
        after['video'][0]['codec'] = 'video/H264'
        _, errors = baseline.validate_video(D, BEFORE, after, report())
        self.assertTrue(any('H264' in e for e in errors))

    def test_stream_with_no_earlier_stats_has_no_rate_and_fails(self):
        _, errors = baseline.validate_video(D, {'video': []}, grid(), report())
        self.assertTrue(any('decoded at None fps' in e for e in errors))


class AudioValidationTest(unittest.TestCase):
    C = SCENARIOS['c_voice_audio']
    BEFORE = {'audio': [{'id': str(i), 'bytes': 0, 'energy': 0} for i in range(3)], 'outbound_audio_bytes': 0, 'video': []}

    def after(self, energy=1.0, out=100):
        return {'audio': [{'id': str(i), 'bytes': 100, 'energy': energy} for i in range(3)],
                'outbound_audio_bytes': out, 'video': []}

    def test_ok(self):
        self.assertEqual(baseline.validate_audio(self.C, self.BEFORE, self.after()), [])

    def test_silent_remote_audio_fails(self):
        self.assertTrue(baseline.validate_audio(self.C, self.BEFORE, self.after(energy=0)))

    def test_silent_local_mic_fails(self):
        self.assertTrue(baseline.validate_audio(self.C, self.BEFORE, self.after(out=0)))


class ScrollValidationTest(unittest.TestCase):
    B = SCENARIOS['b_scroll']

    def test_ok(self):
        self.assertEqual(baseline.validate_scroll(self.B, {'top_seq': 4900}, {'top_seq': 4000}), (900, []))

    def test_wheel_had_no_effect_fails(self):
        self.assertEqual(baseline.validate_scroll(self.B, {'top_seq': 4900}, {'top_seq': 4900})[0], 0)
        self.assertTrue(baseline.validate_scroll(self.B, {'top_seq': 4900}, {'top_seq': 4900})[1])

    def test_unreadable_positions_fail(self):
        moved, errors = baseline.validate_scroll(self.B, {'top_seq': None}, {'top_seq': 1})
        self.assertIsNone(moved)
        self.assertTrue(errors)


MEASUREMENT = {
    'window_s': 60.0, 'cpu_pct_core': {'avg': 12.0, 'p95': 20.0},
    'memory_mb': {'primary_metric': 'pss', 'pss': 400.0, 'rss': 900.0, 'anon': 300.0,
                  'private_working_set': None, 'pss_peak': 410.0},
    'pss_slope_mb_per_hour': 1.0, 'series': [{'t': 0, 'pss_mb': 400, 'by_type': {}}], 'errors': [], 'aux': {},
}


class FinalizeTest(unittest.TestCase):
    def test_success_carries_metrics(self):
        result = baseline.finalize({'title': 't'}, copy.deepcopy(MEASUREMENT), [])
        self.assertTrue(result['ok'])
        self.assertEqual(result['memory_mb']['pss'], 400.0)
        self.assertNotIn('invalid_measurements', result)
        self.assertNotIn('by_type', result['series'][0])

    def test_failure_nulls_metrics_and_keeps_them_aside(self):
        result = baseline.finalize({'title': 't'}, copy.deepcopy(MEASUREMENT), ['bad stream'])
        self.assertFalse(result['ok'])
        self.assertIsNone(result['memory_mb'])
        self.assertIsNone(result['cpu_pct_core'])
        self.assertEqual(result['invalid_measurements']['memory_mb']['pss'], 400.0)

    def test_sampler_error_fails_too(self):
        measurement = dict(copy.deepcopy(MEASUREMENT), errors=['smaps_rollup unreadable'])
        self.assertFalse(baseline.finalize({'title': 't'}, measurement, [])['ok'])


class LoadTest(unittest.TestCase):
    QUIET = '1.20 1.00 0.90 1/900 1234'
    BUSY = '84.00 80.00 70.00 9/2000 1234'

    def report(self, start, end, series=(), self_load=0):
        return baseline.load_report(start, end, list(series), 32, 0.25, self_load)

    def test_quiet_run_is_not_provisional_and_keeps_the_raw_lines(self):
        load = self.report(self.QUIET, self.QUIET)
        self.assertFalse(load['provisional'])
        self.assertEqual((load['start'], load['end'], load['threshold_load1']), (self.QUIET, self.QUIET, 8.0))

    def test_busy_at_either_end_is_provisional(self):
        self.assertTrue(self.report(self.BUSY, self.QUIET)['provisional'])
        self.assertTrue(self.report(self.QUIET, self.BUSY)['provisional'])

    def test_contamination_mid_window_is_caught_with_clean_ends(self):
        load = self.report(self.QUIET, self.QUIET, [{'load1': 2.0}, {'load1': 40.0}, {'load1': 2.0}])
        self.assertTrue(load['provisional'])
        self.assertEqual(load['peak_load1'], 40.0)

    def test_a_scenarios_own_load_is_allowed_for(self):
        self.assertFalse(self.report(self.QUIET, self.QUIET, [{'load1': 12.0}], self_load=6)['provisional'])

    def test_unreadable_load_is_provisional_not_assumed_quiet(self):
        self.assertTrue(self.report(None, None)['provisional'])

    def test_run_reasons_name_the_scenario(self):
        busy = self.report(self.BUSY, self.BUSY)
        reasons = baseline.overall_provisional({'a': {'load': busy}, 'b': {'load': self.report(self.QUIET, self.QUIET)}},
                                               {'load': busy})
        self.assertEqual(len(reasons), 2)
        self.assertTrue(reasons[0].startswith('a: '))
        self.assertTrue(reasons[1].startswith('cold start: '))


class OverallTest(unittest.TestCase):
    def test_failed_probe_does_not_fail_the_run(self):
        self.assertTrue(baseline.overall_ok({'a': {'ok': True}, 'p': {'ok': False, 'best_effort': True}}, {'ok': True}))

    def test_failed_scenario_fails_the_run(self):
        self.assertFalse(baseline.overall_ok({'d': {'ok': False, 'best_effort': False}}, {'ok': True}))

    def test_failed_cold_start_fails_the_run(self):
        self.assertFalse(baseline.overall_ok({}, {'ok': False}))


class ReadingTest(unittest.TestCase):
    def test_nearest_sample_and_trailing_cpu(self):
        settle = {'series': [{'t': 0, 'pss_mb': 1, 'rss_mb': 2, 'anon_mb': 3}, {'t': 25.1, 'pss_mb': 4, 'rss_mb': 5, 'anon_mb': 6}],
                  'cpu_series': [(10, 100.0), (20, 10.0), (25, 20.0)]}
        reading = baseline.reading_at(settle, 25)
        self.assertEqual(reading['pss_mb'], 4)
        self.assertEqual(reading['cpu_pct_core'], 15.0)

    def test_summary(self):
        self.assertEqual(baseline.summarize_runs([100, 200, None, 300])['median'], 200)
        self.assertIsNone(baseline.summarize_runs([None]))


def base_result(scenarios):
    return {
        'schema_version': 1, 'client': 'electron', 'ok': True, 'provisional': False, 'provisional_reasons': [],
        'build': {'version': '0.7.0', 'commit': 'abc', 'stripped': True},
        'env': {'platform': 'linux', 'display': 'xvfb', 'mode': 'container', 'cpus': 4, 'sandbox': False,
                'window': {'width': 1920, 'height': 1080, 'device_scale_factor': 1}, 'renderer': {}},
        'disk': {'unpacked_bytes': 1, 'top_level': [], 'binary': {'bytes': 1, 'stripped': True}, 'artifacts': []},
        'scenarios': scenarios, 'comparability_notes': [],
    }


class SchemaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import jsonschema
        with open(os.path.join(HERE, 'result.schema.json'), encoding='utf-8') as fh:
            schema = json.load(fh)
        jsonschema.Draft202012Validator.check_schema(schema)
        cls.validator = jsonschema.Draft202012Validator(schema)

    def errors(self, data):
        return list(self.validator.iter_errors(data))

    LOAD = baseline.load_report('1.0 1.0 1.0 1/1 1', '1.0 1.0 1.0 1/1 1', [], 32, 0.25)

    def good(self):
        return baseline.finalize({'title': 't', 'load': self.LOAD, 'provisional': False}, copy.deepcopy(MEASUREMENT), [])

    def bad(self):
        return baseline.finalize({'title': 't', 'load': self.LOAD, 'provisional': False}, copy.deepcopy(MEASUREMENT), ['measured 640x360'])

    def test_scenario_without_load_is_rejected(self):
        scenario = self.good()
        del scenario['load']
        self.assertTrue(self.errors(base_result({'a': scenario})))

    def test_run_without_a_provisional_flag_is_rejected(self):
        data = base_result({'a': self.good()})
        del data['provisional']
        self.assertTrue(self.errors(data))

    def test_success_and_honest_failure_validate(self):
        self.assertEqual(self.errors(base_result({'a': self.good(), 'd': self.bad()})), [])

    def test_failed_scenario_with_a_number_is_rejected(self):
        tampered = self.bad()
        tampered['memory_mb'] = MEASUREMENT['memory_mb']
        self.assertTrue(self.errors(base_result({'d': tampered})))

    def test_ok_scenario_without_numbers_is_rejected(self):
        tampered = self.good()
        tampered['memory_mb'] = None
        self.assertTrue(self.errors(base_result({'a': tampered})))

    def test_ok_scenario_with_errors_is_rejected(self):
        tampered = self.good()
        tampered['errors'] = ['oops']
        self.assertTrue(self.errors(base_result({'a': tampered})))

    def test_windows_shape_is_representable(self):
        result = self.good()
        result['memory_mb'] = {'primary_metric': 'private_working_set', 'pss': None, 'rss': None, 'anon': None,
                               'private_working_set': 512.0}
        data = base_result({'a': result})
        data['env'].update({'platform': 'windows', 'display': 'windows', 'mode': 'runner'})
        self.assertEqual(self.errors(data), [])

    def test_windows_without_its_metric_is_rejected(self):
        result = self.good()
        result['memory_mb'] = {'primary_metric': 'private_working_set', 'pss': None, 'rss': None, 'anon': None,
                               'private_working_set': None}
        self.assertTrue(self.errors(base_result({'a': result})))


if __name__ == '__main__':
    unittest.main()
