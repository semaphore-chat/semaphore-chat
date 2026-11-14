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


class FmtNumTest(unittest.TestCase):
    def test_fmt_num(self):
        self.assertEqual(
            [gen.fmt_num(v) for v in (16, 16.0, 0.35, 0.6)], ["16", "16", "0.35", "0.6"]
        )


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
