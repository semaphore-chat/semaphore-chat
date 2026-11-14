"""Tests for `design/gen/gen_tokens.py`, run with the Python standard library only.

    python3 -m unittest discover -s design/gen -p 'test_*.py' -v
"""

from __future__ import annotations

import contextlib
import io
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gen_tokens as gen  # noqa: E402  (after the path fix above)

REPO = pathlib.Path(__file__).resolve().parents[2]
REAL = REPO / "design" / "tokens.json"


def set_value(path: str, value: object):
    """Change one dotted entry of the source document."""

    def change(data: dict) -> None:
        *parents, leaf = path.split(".")
        target = data
        for key in parents:
            target = target[key]
        target[leaf] = value

    return change


def delete(path: str):
    """Remove one dotted entry of the source document."""

    def change(data: dict) -> None:
        *parents, leaf = path.split(".")
        target = data
        for key in parents:
            target = target[key]
        del target[leaf]

    return change


class TempSource(unittest.TestCase):
    """A temporary repo root holding a copy of the real `design/tokens.json`."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.source = self.root / "design" / "tokens.json"
        self.source.parent.mkdir()
        self.source.write_text(REAL.read_text(encoding="utf-8"), encoding="utf-8")

    def edit(self, change) -> None:
        data = json.loads(self.source.read_text(encoding="utf-8"))
        change(data)
        self.source.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    def load(self) -> dict:
        return gen.load(self.source)


class RealFileTest(unittest.TestCase):
    def test_load_real_file(self):
        t = gen.load(REPO / "design" / "tokens.json")
        self.assertEqual(t["radius"]["island"], 24)
        self.assertEqual(list(t["space"])[:3], ["none", "2xs", "xs"])  # source order kept


class LoadValidationTest(TempSource):
    def test_string_where_number_belongs(self):
        self.edit(set_value("space.lg", "16"))
        with self.assertRaisesRegex(gen.TokenError, r"^space\.lg"):
            self.load()

    def test_unknown_font_in_text_style(self):
        self.edit(set_value("text.body.font", "bodyy"))
        with self.assertRaisesRegex(gen.TokenError, r"^text\.body\.font"):
            self.load()

    def test_missing_group(self):
        self.edit(delete("radius"))
        with self.assertRaisesRegex(gen.TokenError, r"^radius"):
            self.load()

    def test_negative_or_bool_number_rejected(self):
        self.edit(set_value("control.sm", -1))
        with self.assertRaisesRegex(gen.TokenError, r"^control\.sm"):
            self.load()

        self.edit(set_value("control.sm", True))
        with self.assertRaisesRegex(gen.TokenError, r"^control\.sm"):
            self.load()

    def test_alpha_out_of_range(self):
        self.edit(set_value("shadow.island.alpha", 1.5))
        with self.assertRaisesRegex(gen.TokenError, r"^shadow\.island\.alpha"):
            self.load()

    def test_shadow_offset_may_be_negative(self):
        # A shadow can be offset upwards; only blur and alpha are bounded.
        self.edit(set_value("shadow.island.y", -2))
        self.assertEqual(self.load()["shadow"]["island"]["y"], -2)

    def test_negative_shadow_blur_rejected(self):
        self.edit(set_value("shadow.island.blur", -1))
        with self.assertRaisesRegex(gen.TokenError, r"^shadow\.island\.blur"):
            self.load()

    def test_motion_must_be_whole_milliseconds(self):
        # The Rust renderer writes motion as u32: whole numbers, 0 to 2^32-1.
        self.edit(set_value("motion.fast", 120.5))
        with self.assertRaisesRegex(gen.TokenError, r"^motion\.fast"):
            self.load()

        self.edit(set_value("motion.fast", 2**32))
        with self.assertRaisesRegex(gen.TokenError, r"^motion\.fast"):
            self.load()

    def test_motion_accepts_a_whole_float(self):
        self.edit(set_value("motion.fast", 120.0))
        self.assertEqual(self.load()["motion"]["fast"], 120.0)

    def test_font_name_with_control_character_rejected(self):
        self.edit(set_value("font.body", "Fig\ntree"))
        with self.assertRaisesRegex(gen.TokenError, r"^font\.body"):
            self.load()

    def test_font_name_with_quote_or_backslash_rejected(self):
        # Both renderers write the family into a string literal.
        for bad in ('Fig"tree', "Fig\\tree"):
            with self.subTest(name=bad):
                self.edit(set_value("font.body", bad))
                with self.assertRaisesRegex(gen.TokenError, r"^font\.body"):
                    self.load()


class FmtNumTest(unittest.TestCase):
    def test_fmt_num(self):
        self.assertEqual(
            [gen.fmt_num(v) for v in (16, 16.0, 0.35, 0.6)], ["16", "16", "0.35", "0.6"]
        )

    def test_fmt_num_keeps_large_ints_exact(self):
        # No float round-trip: 9007199254740993 is not representable as a float.
        self.assertEqual(gen.fmt_num(9007199254740993), "9007199254740993")
        self.assertEqual(gen.fmt_num(16.0), "16")


class RenderTsTest(unittest.TestCase):
    def test_ts_quotes_non_identifier_keys(self):
        out = gen.render_ts(gen.load(REAL))
        self.assertIn("'2xs': 2", out)
        self.assertIn("leftColumn: 288", out)

    def test_ts_resolves_font_and_shadow_css(self):
        out = gen.render_ts(gen.load(REAL))
        self.assertIn("body: { family: 'Figtree', size: 15, line: 22, weight: 400 }", out)
        self.assertIn("css: '0 6px 24px rgba(0, 0, 0, 0.35)'", out)

    def test_ts_shadow_with_negative_offset(self):
        tokens = gen.load(REAL)
        tokens["shadow"]["island"]["y"] = -2
        self.assertIn("css: '0 -2px 24px rgba(0, 0, 0, 0.35)'", gen.render_ts(tokens))

    def test_ts_is_deterministic_and_headed(self):
        a = gen.render_ts(gen.load(REAL)); b = gen.render_ts(gen.load(REAL))
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("// @generated by design/gen/gen_tokens.py from design/tokens.json."))
        self.assertTrue(a.endswith("} as const;\n\nexport type Tokens = typeof tokens;\nexport type TextStyleName = keyof typeof tokens.text;\n"))


class RenderRsTest(unittest.TestCase):
    def test_rs_constant_names(self):
        out = gen.render_rs(gen.load(REAL))
        for line in ("pub const SPACE_2XS: f32 = 2.0;", "pub const LAYOUT_LEFT_COLUMN: f32 = 288.0;",
                     "pub const MOTION_FAST_MS: u32 = 120;", 'pub const FONT_HEADING: &str = "Bricolage Grotesque";'):
            self.assertIn(line, out)

    def test_rs_text_and_shadow(self):
        out = gen.render_rs(gen.load(REAL))
        self.assertIn("pub const TEXT_BODY_STRONG: TextStyle = TextStyle {", out)
        self.assertIn("alpha: 0.35,", out)

    def test_rs_is_deterministic_and_headed(self):
        a = gen.render_rs(gen.load(REAL))
        self.assertEqual(a, gen.render_rs(gen.load(REAL)))
        self.assertTrue(a.startswith("// @generated by design/gen/gen_tokens.py from design/tokens.json.\n// Do not edit"))


class RunTest(TempSource):
    def setUp(self) -> None:
        super().setUp()
        patcher = mock.patch.object(
            gen, "OUTPUTS", {pathlib.Path("out.txt"): lambda tokens: "x\n"}
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_run_writes_then_check_passes(self):
        self.assertEqual(gen.run(self.root, check=False), 0)
        self.assertEqual((self.root / "out.txt").read_text(encoding="utf-8"), "x\n")
        self.assertEqual(gen.run(self.root, check=True), 0)

    def test_check_reports_stale_and_missing(self):
        self.assertEqual(gen.run(self.root, check=False), 0)

        (self.root / "out.txt").write_text("y\n", encoding="utf-8")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.run(self.root, check=True), 1)
        self.assertIn("stale: out.txt", stderr.getvalue())
        self.assertEqual(
            (self.root / "out.txt").read_text(encoding="utf-8"), "y\n"
        )  # check writes nothing

        (self.root / "out.txt").unlink()
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.run(self.root, check=True), 1)
        self.assertIn("missing: out.txt", stderr.getvalue())
        self.assertFalse((self.root / "out.txt").exists())

    def test_invalid_source_writes_nothing(self):
        self.edit(set_value("radius.card", "18"))
        with self.assertRaisesRegex(gen.TokenError, r"^radius\.card"):
            gen.run(self.root, check=False)
        self.assertFalse((self.root / "out.txt").exists())


class MainTest(unittest.TestCase):
    def test_main_usage(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.main(["--bogus"]), 2)
        self.assertIn("usage", stderr.getvalue().lower())


if __name__ == "__main__":
    unittest.main()
