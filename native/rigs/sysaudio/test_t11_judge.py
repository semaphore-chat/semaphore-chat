"""Unit tests for the T11 absent verdict, on synthetic 1 s windows.

    python3 -m unittest -v test_t11_judge        (from native/rigs/sysaudio)
"""
import unittest

import run
import t11_judge as j


def win(b, ref=-140.0, a=-12.04, t=0):
    return {"t": t, "db": {"a": a, "b": b, "ref": ref}}


def clean(n):
    return [win(-130.0, t=i) for i in range(n)]


class Classify(unittest.TestCase):
    def test_at_or_below_the_floor_is_clean(self):
        self.assertEqual(j.classify(-80.0, -140.0), "clean")
        self.assertEqual(j.classify(-130.0, -60.0), "clean")

    def test_above_the_floor_and_20_db_over_the_reference_is_a_leak(self):
        self.assertEqual(j.classify(-26.0, -138.0), "leak")
        self.assertEqual(j.classify(-79.0, -99.0), "leak")  # exactly 20 dB counts

    def test_above_the_floor_but_close_to_the_reference_is_a_glitch(self):
        self.assertEqual(j.classify(-76.08, -80.0), "glitch")
        self.assertEqual(j.classify(-60.0, -79.9), "glitch")

    def test_no_reference_falls_back_to_the_old_rule(self):
        self.assertEqual(j.classify(-76.0, None), "leak")

    def test_reference_is_away_from_every_tone_and_harmonic(self):
        played = [440, 523, 587, 659, 743, 880, 1013, 1109]
        nearest = min(abs(j.REF_HZ - hz * k) for hz in played for k in range(1, 7))
        self.assertGreaterEqual(nearest, 100)


class JudgeAbsent(unittest.TestCase):
    def test_clean(self):
        v = j.judge_absent(clean(28), "b")
        self.assertTrue(v["pass"])
        self.assertEqual((v["leaks"], v["glitches"]), (0, 0))

    def test_one_leak_fails(self):
        ws = clean(27) + [win(-60.0, ref=-135.0, t=99)]
        v = j.judge_absent(ws, "b")
        self.assertFalse(v["pass"])
        self.assertFalse(v["no_leak"])
        self.assertEqual(v["leaks"], 1)
        self.assertEqual(v["leak_windows"][0]["t"], 99)

    def test_one_glitch_in_28_is_counted_and_passes(self):
        # The Windows run-1 window: call at -76 dBFS while a dropout lifted everything.
        ws = clean(27) + [win(-76.08, ref=-78.0, a=-37.09)]
        v = j.judge_absent(ws, "b")
        self.assertTrue(v["pass"])
        self.assertEqual((v["leaks"], v["glitches"]), (0, 1))
        self.assertFalse(v["too_noisy"])

    def test_more_than_5_percent_glitches_is_too_noisy_to_judge(self):
        ws = clean(18) + [win(-60.0, ref=-62.0) for _ in range(2)]  # 10%
        v = j.judge_absent(ws, "b")
        self.assertFalse(v["pass"])
        self.assertTrue(v["no_leak"])
        self.assertTrue(v["too_noisy"])
        self.assertFalse(v["judgeable"])

    def test_exactly_5_percent_glitches_is_still_judgeable(self):
        ws = clean(19) + [win(-60.0, ref=-62.0)]
        self.assertTrue(j.judge_absent(ws, "b")["pass"])

    def test_no_windows_fails(self):
        self.assertFalse(j.judge_absent([], "b")["pass"])

    def test_negative_control_is_detected_as_a_leak(self):
        ws = [win(-26.02, ref=-137.0, a=-137.95) for _ in range(28)]
        self.assertTrue(j.judge_control(ws, "b")["detected"])
        self.assertFalse(j.judge_absent(ws, "b")["pass"])

    def test_a_control_that_is_only_noise_is_not_detected(self):
        ws = [win(-70.0, ref=-72.0) for _ in range(28)]
        self.assertFalse(j.judge_control(ws, "b")["detected"])


class RunJudgeAbsence(unittest.TestCase):
    def test_l1_glitch_is_not_a_leak(self):
        ws = clean(17) + [win(-58.0, ref=-55.0)]
        checks, _ = run.judge_absence("L1", ws, call_ref=-12.04)
        self.assertEqual(checks, {"absent_b": True, "judgeable_b": False})  # 1 in 18: too noisy

    def test_l7_judges_the_mic_tone_too(self):
        ws = [{"t": i, "db": {"a": -12.0, "b": -130.0, "m": -40.0 if i == 0 else -130.0, "ref": -140.0}} for i in range(20)]
        checks, _ = run.judge_absence("L7", ws, call_ref=-12.04)
        self.assertTrue(checks["absent_b"])
        self.assertFalse(checks["absent_m"])

    def test_l9_control_detected(self):
        ws = [win(-12.03, ref=-130.0) for _ in range(18)]
        checks, metrics = run.judge_absence("L9", ws, call_ref=-12.04)
        self.assertEqual(checks, {"control_detected": True})
        self.assertEqual(metrics["control_detected"]["leak_share"], 1.0)


if __name__ == "__main__":
    unittest.main()
