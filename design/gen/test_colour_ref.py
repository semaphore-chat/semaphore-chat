"""Tests for `design/gen/colour_ref.py`, run with the Python standard library only.

`colour_ref.py` is the definition of the palette algorithm: the TypeScript and
Rust ports must reproduce the vectors generated from it, so these tests pin the
reference itself before any port exists.

    python3 -m unittest discover -s design/gen -p 'test_*.py' -v
"""

from __future__ import annotations

import colorsys
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import colour_ref as ref  # noqa: E402  (after the path fix above)

# The approved mock-up palette for #8E75FF, dark mode, minimal intensity.
DEFAULT = {
    "ground": "#121214",
    "surface": "#1b1b1f",
    "fill": "#26262c",
    "hairline": "#3a3a44",
    "text": "#f2f2f5",
    "textSecondary": "#a9a9b4",
    "textDim": "#8a8a96",
    "accent": "#8e75ff",
    "onAccent": "#121214",
    "accentText": "#afa5fe",
    "focus": "#8e75ff",
    "positive": "#3ddc84",
    "warning": "#ffb84d",
    "danger": "#ff6b7d",
    "onDanger": "#121214",
    "scrim": "#09081199",
}

# A copy of `gen_tokens.VECTOR_BASES`: this module pins the reference and must
# stay importable before the generator learns the colour renderers.
VECTOR_BASES = [
    "#8E75FF",
    "#0d9488",
    "#3b82f6",
    "#ef4444",
    "#f59e0b",
    "#22c55e",
    "#ec4899",
    "#8a5ce6",
    "#0a6638",
    "#000000",
    "#ffffff",
    "#808080",
    "#ff0000",
    "#ffff00",
    "#00ff00",
    "#0000ff",
]

MODES = ("dark", "light")
INTENSITIES = ("minimal", "balanced", "vibrant")


def _hex(rgb: tuple[float, float, float]) -> str:
    """An HSV triple from `colorsys` as `#rrggbb`, converted with `round()`."""
    channels = (int(round(value * 255)) for value in rgb)
    return "#%02x%02x%02x" % tuple(channels)


def sweep_bases() -> list[str]:
    """The vector bases plus a hue circle at four (saturation, value) levels."""
    bases = list(VECTOR_BASES)
    for hue in range(0, 360, 10):
        for saturation, value in ((1, 1), (0.6, 0.9), (0.9, 0.4), (0.2, 0.95)):
            bases.append(_hex(colorsys.hsv_to_rgb(hue / 360, saturation, value)))
    return bases


class DefaultPaletteTest(unittest.TestCase):
    def test_default_palette_is_the_mock_up(self):
        # Dict equality, any key order.
        self.assertEqual(ref.derive("#8E75FF", "dark", "minimal"), DEFAULT)

    def test_roles_are_complete(self):
        self.assertEqual(sorted(ref.derive("#808080", "light", "vibrant")), sorted(ref.ROLES))

    def test_hex_case_does_not_matter(self):
        self.assertEqual(
            ref.derive("#8e75ff", "dark", "minimal"), ref.derive("#8E75FF", "dark", "minimal")
        )

    def test_bad_base_rejected(self):
        for bad in ("", "#fff", "red", "#8E75FF00", "8E75FF"):
            with self.subTest(base=bad):
                with self.assertRaises(ValueError):
                    ref.derive(bad, "dark", "minimal")


class ContrastRulesTest(unittest.TestCase):
    def test_contrast_rules_hold_across_a_sweep(self):
        for base in sweep_bases():
            for mode in MODES:
                for intensity in INTENSITIES:
                    palette = ref.derive(base, mode, intensity)

                    def ratio(role: str, background: str) -> float:
                        return ref.contrast(
                            ref.parse(palette[role]), ref.parse(palette[background])
                        )

                    def check(role: str, background: str, target: float) -> None:
                        got = ratio(role, background)
                        message = (
                            f"{base} {mode} {intensity}: {role} {palette[role]} on "
                            f"{background} {palette[background]} is {got:.3f}:1, "
                            f"need {target}:1"
                        )
                        self.assertGreaterEqual(got, target, message)

                    for role in (
                        "text",
                        "textSecondary",
                        "accentText",
                        "positive",
                        "warning",
                        "danger",
                    ):
                        for background in ("ground", "surface", "fill"):
                            check(role, background, 4.5)
                    for background in ("ground", "surface"):
                        check("textDim", background, 4.5)
                        check("accent", background, 3.0)
                    for background in ("ground", "surface", "fill"):
                        check("accentText", background, ref.PARAMS["accentTextContrast"])
                        check("focus", background, 3.0)
                    check("onAccent", "accent", 4.5)
                    check("onDanger", "danger", 4.5)



class PersonColourTest(unittest.TestCase):
    def test_fnv1a32_published_values(self):
        self.assertEqual(ref.fnv1a32(b""), 0x811C9DC5)
        self.assertEqual(ref.fnv1a32(b"a"), 0xE40C292C)
        self.assertEqual(ref.fnv1a32(b"foobar"), 0xBF9CF968)

    def test_missing_or_empty_id_has_no_colour(self):
        self.assertIsNone(ref.person_colour(""))
        self.assertIsNone(ref.person_colour(None))

    def test_hashes_utf8_bytes(self):
        colours = ref.PARAMS["people"]["colours"]
        self.assertEqual(ref.person_colour("zoë"), colours[ref.fnv1a32("zoë".encode("utf-8")) % 9])

    def test_every_colour_reads_with_dark_ink_in_both_modes(self):
        # The avatar's inks are the palette's ground and text; the darker of the two must reach 4.5
        # on every person colour unchanged, in dark and in light, so the kit never nudges them.
        for colour in ref.PARAMS["people"]["colours"]:
            for mode in ("dark", "light"):
                palette = ref.derive("#8E75FF", mode, "minimal")
                inks = [ref.parse(palette["ground"]), ref.parse(palette["text"])]
                darker = min(inks, key=ref.luminance)
                with self.subTest(colour=colour, mode=mode):
                    self.assertGreaterEqual(ref.contrast(darker, ref.parse(colour)), 4.5)


if __name__ == "__main__":
    unittest.main()
