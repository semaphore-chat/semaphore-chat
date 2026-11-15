"""Tests for `design/gen/gen_tokens.py`, run with the Python standard library only.

    python3 -m unittest discover -s design/gen -p 'test_*.py' -v
"""

from __future__ import annotations

import contextlib
import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import colour_ref  # noqa: E402  (the definition of the algorithm)
import gen_tokens as gen  # noqa: E402  (after the path fix above)
from test_colour_ref import DEFAULT  # noqa: E402  (the approved mock-up palette)

REPO = pathlib.Path(__file__).resolve().parents[2]
GEN_DIR = REPO / "design" / "gen"
REAL = REPO / "design" / "tokens.json"
REAL_COLOUR = REPO / "design" / "colour.json"
REAL_ICONS = REPO / "design" / "icons"


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
    """A temporary repo root holding copies of the real source documents."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.source = self.root / "design" / "tokens.json"
        self.source.parent.mkdir()
        self.source.write_text(REAL.read_text(encoding="utf-8"), encoding="utf-8")
        self.colour_source = self.root / "design" / "colour.json"
        self.colour_source.write_text(REAL_COLOUR.read_text(encoding="utf-8"), encoding="utf-8")
        shutil.copytree(REAL_ICONS, self.root / "design" / "icons")
        self.icons_source = self.root / "design" / "icons" / "icons.json"

    def edit(self, change) -> None:
        data = json.loads(self.source.read_text(encoding="utf-8"))
        change(data)
        self.source.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    def edit_colour(self, change) -> None:
        data = json.loads(self.colour_source.read_text(encoding="utf-8"))
        change(data)
        self.colour_source.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    def load(self) -> dict:
        return gen.load(self.source)

    def load_colour(self) -> dict:
        return gen.load_colour(self.colour_source)

    def remove_icon(self, name: str) -> None:
        """Drop one icon from the set: its entry and its source file."""
        document = json.loads(self.icons_source.read_text(encoding="utf-8"))
        file = document["icons"].pop(name)
        self.icons_source.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        (self.root / "design" / "icons" / "lucide" / f"{file}.svg").unlink()


class RealFileTest(unittest.TestCase):
    def test_load_real_file(self):
        t = gen.load(REPO / "design" / "tokens.json")
        self.assertEqual(t["radius"]["island"], 24)
        self.assertEqual(list(t["space"])[:3], ["none", "2xs", "xs"])  # source order kept

    def test_load_real_file_kit_groups(self):
        # The kit's groups: small radii, icon sizes, border widths, state alphas.
        t = gen.load(REAL)
        self.assertEqual(list(t["radius"]), ["sm", "md", "field", "card", "island", "full"])
        self.assertEqual(t["radius"]["sm"], 6)
        self.assertEqual(t["radius"]["md"], 10)
        self.assertEqual(t["icon"], {"xs": 14, "sm": 16, "md": 18, "lg": 20, "xl": 24})
        self.assertEqual(
            t["border"], {"hairline": 1, "selected": 2, "focus": 2, "focusOffset": 2}
        )
        self.assertEqual(
            t["state"],
            {
                "hover": 0.04,
                "pressed": 0.08,
                "hoverOnFill": 0.16,
                "pressedOnFill": 0.24,
                "disabled": 0.5,
            },
        )
        self.assertEqual(list(t)[-4:], ["icon", "avatar", "border", "state"])  # after the old groups
        self.assertEqual(t["avatar"], {"xs": 20, "sm": 28, "md": 36, "lg": 44, "xl": 64})


class RolesTest(unittest.TestCase):
    def test_generator_roles_match_the_reference(self):
        # The generator keeps its own copy so importing it cannot parse
        # `design/colour.json`; the copy must never drift from the reference.
        self.assertEqual(gen.ROLES, colour_ref.ROLES)


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

    def test_light_alpha_out_of_range(self):
        self.edit(set_value("shadow.island.alphaLight", 1.5))
        with self.assertRaisesRegex(gen.TokenError, r"^shadow\.island\.alphaLight"):
            self.load()

    def test_shadow_requires_exactly_its_fields(self):
        self.edit(delete("shadow.island.alphaLight"))
        with self.assertRaisesRegex(gen.TokenError, r"^shadow\.island"):
            self.load()

        self.edit(set_value("shadow.island.spread", 1))
        with self.assertRaisesRegex(gen.TokenError, r"^shadow\.island"):
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

    def test_key_pattern_rejected(self):
        for bad in ("foo-bar", "Foo"):
            with self.subTest(key=bad):
                self.edit(set_value(f"space.{bad}", 1))
                with self.assertRaisesRegex(gen.TokenError, r"^space\."):
                    self.load()

    def test_unknown_group_rejected(self):
        self.edit(set_value("colour", {}))
        with self.assertRaisesRegex(gen.TokenError, r"^colour"):
            self.load()

    def test_weight_must_be_allowed(self):
        for bad in (450, True):
            with self.subTest(weight=bad):
                self.edit(set_value("text.body.weight", bad))
                with self.assertRaisesRegex(gen.TokenError, r"^text\.body\.weight"):
                    self.load()

    def test_non_finite_number_rejected(self):
        self.edit(set_value("space.lg", float("nan")))  # json.dumps writes NaN
        with self.assertRaisesRegex(gen.TokenError, r"^space\.lg"):
            self.load()

    def test_blank_font_name_rejected(self):
        self.edit(set_value("font.body", "  "))
        with self.assertRaisesRegex(gen.TokenError, r"^font\.body"):
            self.load()

    def test_text_style_fields_exact(self):
        self.edit(delete("text.tag.line"))
        with self.assertRaisesRegex(gen.TokenError, r"^text\.tag"):
            self.load()

        self.edit(set_value("text.tag.extra", 1))
        with self.assertRaisesRegex(gen.TokenError, r"^text\.tag"):
            self.load()

    def test_motion_u32_maximum_loads(self):
        self.edit(set_value("motion.fast", 4294967295))
        self.assertEqual(self.load()["motion"]["fast"], 4294967295)

    def test_state_alpha_out_of_range(self):
        self.edit(set_value("state.hover", 1.5))
        with self.assertRaisesRegex(gen.TokenError, r"^state\.hover"):
            self.load()

    def test_state_alpha_must_be_a_number(self):
        self.edit(set_value("state.hover", "x"))
        with self.assertRaisesRegex(gen.TokenError, r"^state\.hover"):
            self.load()

    def test_negative_icon_size_rejected(self):
        self.edit(set_value("icon.md", -1))
        with self.assertRaisesRegex(gen.TokenError, r"^icon\.md"):
            self.load()

    def test_negative_avatar_size_rejected(self):
        self.edit(set_value("avatar.md", -1))
        with self.assertRaisesRegex(gen.TokenError, r"^avatar\.md"):
            self.load()

    def test_negative_border_width_rejected(self):
        self.edit(set_value("border.hairline", -1))
        with self.assertRaisesRegex(gen.TokenError, r"^border\.hairline"):
            self.load()

    def test_duplicate_key_rejected(self):
        text = REAL.read_text(encoding="utf-8")
        self.assertIn('"md"', text)
        text = text.replace('"space": {', '"space": {\n    "md": 1,', 1)
        self.source.write_text(text, encoding="utf-8")
        with self.assertRaisesRegex(gen.TokenError, r"^space\.md"):
            self.load()


class ColourLoadTest(TempSource):
    def test_load_real_file(self):
        colour = gen.load_colour(REAL_COLOUR)
        self.assertEqual(colour["chromaReference"], 0.197)
        self.assertEqual(list(colour["modes"]), ["dark", "light"])  # source order kept

    def test_mode_role_must_be_a_lightness_chroma_pair(self):
        self.edit_colour(set_value("modes.dark.ground", [0.2]))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.modes\.dark\.ground"):
            self.load_colour()

    def test_status_must_be_hex(self):
        self.edit_colour(set_value("status.danger", "red"))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.status\.danger"):
            self.load_colour()

    def test_missing_mode_rejected(self):
        self.edit_colour(delete("modes.light"))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.modes\.light"):
            self.load_colour()

    def test_intensity_must_be_positive(self):
        self.edit_colour(set_value("intensity.balanced", 0))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.intensity\.balanced"):
            self.load_colour()

    def test_accent_lightness_range_must_be_ordered(self):
        self.edit_colour(set_value("modes.dark.accentL", [0.8, 0.6]))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.modes\.dark\.accentL"):
            self.load_colour()

    def test_lightness_and_chroma_bounds(self):
        self.edit_colour(set_value("modes.light.text", [1.2, 0.01]))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.modes\.light\.text"):
            self.load_colour()

        self.edit_colour(set_value("modes.light.text", [0.2, 0.5]))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.modes\.light\.text"):
            self.load_colour()


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
        self.assertIn("cssLight: '0 6px 24px rgba(0, 0, 0, 0.08)'", out)
        self.assertIn("alphaLight: 0.18,", out)

    def test_ts_shadow_with_negative_offset(self):
        tokens = gen.load(REAL)
        tokens["shadow"]["island"]["y"] = -2
        self.assertIn("css: '0 -2px 24px rgba(0, 0, 0, 0.35)'", gen.render_ts(tokens))

    def test_ts_renders_kit_tokens(self):
        out = gen.render_ts(gen.load(REAL))
        self.assertIn("  radius: {\n    sm: 6,\n    md: 10,\n    field: 14,", out)
        self.assertIn("hoverOnFill: 0.16,", out)
        self.assertIn("  avatar: {\n    xs: 20,", out)
        self.assertIn("focusOffset: 2,", out)
        self.assertIn("dialogSm: 400,", out)
        self.assertIn("dialogMd: 560,", out)
        # The new groups follow the old ones, in source order.
        for earlier, later in (("layout", "icon"), ("icon", "avatar"), ("avatar", "border"), ("border", "state")):
            self.assertLess(out.index(f"  {earlier}: {{"), out.index(f"  {later}: {{"))

    def test_ts_is_deterministic_and_headed(self):
        a = gen.render_ts(gen.load(REAL)); b = gen.render_ts(gen.load(REAL))
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("// @generated by design/gen/gen_tokens.py from design/tokens.json."))
        self.assertTrue(a.endswith("} as const;\n\nexport type Tokens = typeof tokens;\nexport type TextStyleName = keyof typeof tokens.text;\n"))


class RenderRsTest(unittest.TestCase):
    def test_rs_constant_names(self):
        out = gen.render_rs(gen.load(REAL))
        for line in ("pub const SPACE_2XS: f32 = 2.0;", "pub const LAYOUT_LEFT_COLUMN: f32 = 288.0;",
                     "pub const LAYOUT_DIALOG_SM: f32 = 400.0;", "pub const LAYOUT_DIALOG_MD: f32 = 560.0;",
                     "pub const MOTION_FAST_MS: u32 = 120;", 'pub const FONT_HEADING: &str = "Bricolage Grotesque";'):
            self.assertIn(line, out)

    def test_rs_text_and_shadow(self):
        out = gen.render_rs(gen.load(REAL))
        self.assertIn("pub const TEXT_BODY_STRONG: TextStyle = TextStyle {", out)
        self.assertIn("alpha: 0.35,", out)
        self.assertIn("alpha_light: 0.08,", out)
        self.assertIn("pub alpha_light: f32,", out)

    def test_rs_kit_constants(self):
        out = gen.render_rs(gen.load(REAL))
        for line in (
            "pub const STATE_HOVER: f32 = 0.04;",
            "pub const BORDER_FOCUS_OFFSET: f32 = 2.0;",
            "pub const ICON_XL: f32 = 24.0;",
            "pub const AVATAR_XL: f32 = 64.0;",
            "pub const RADIUS_SM: f32 = 6.0;",
        ):
            self.assertIn(line, out)
        self.assertIn("/// `state.hover`, alpha, 0 to 1.", out)

    def test_rs_is_deterministic_and_headed(self):
        a = gen.render_rs(gen.load(REAL))
        self.assertEqual(a, gen.render_rs(gen.load(REAL)))
        self.assertTrue(a.startswith("// @generated by design/gen/gen_tokens.py from design/tokens.json.\n// Do not edit"))

    def test_rs_camel_case_with_consecutive_capitals(self):
        tokens = gen.load(REAL)
        tokens["layout"]["bodyXL"] = 5
        self.assertIn("pub const LAYOUT_BODY_X_L: f32 = 5.0;", gen.render_rs(tokens))

    def test_rs_motion_whole_float_renders_as_integer(self):
        tokens = gen.load(REAL)
        tokens["motion"]["fast"] = 120.0
        self.assertIn("pub const MOTION_FAST_MS: u32 = 120;", gen.render_rs(tokens))


COLOUR_ENTRY = re.compile(
    r"^  \{\n"
    r"    base: '([^']+)',\n"
    r"    mode: '([^']+)',\n"
    r"    intensity: '([^']+)',\n"
    r"    roles: \{\n"
    r"((?:      [A-Za-z]+: '#[0-9a-f]+',\n)+)"
    r"    \},\n"
    r"  \},",
    re.MULTILINE,
)
COLOUR_ROLE = re.compile(r"^      ([A-Za-z]+): '([^']+)',$", re.MULTILINE)


def parse_colour_vectors_ts(text: str) -> list[tuple[str, str, str, dict]]:
    """The entries of the generated TypeScript module, for comparison with the JSON."""
    return [
        (match.group(1), match.group(2), match.group(3), dict(COLOUR_ROLE.findall(match.group(4))))
        for match in COLOUR_ENTRY.finditer(text)
    ]


class RenderColourVectorsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sources = {"tokens": gen.load(REAL), "colour": gen.load_colour(REAL_COLOUR)}
        self.rendered = gen.render_colour_vectors(self.sources)

    def test_vectors_cover_every_base_mode_and_intensity(self):
        vectors = json.loads(self.rendered)
        self.assertEqual(len(vectors), 96)
        self.assertEqual(
            [(vector["base"], vector["mode"], vector["intensity"]) for vector in vectors],
            [
                (base, mode, intensity)
                for base in gen.VECTOR_BASES
                for mode in ("dark", "light")
                for intensity in ("minimal", "balanced", "vibrant")
            ],
        )

    def test_first_vector_is_the_approved_default_palette(self):
        first = json.loads(self.rendered)[0]
        self.assertEqual(
            (first["base"], first["mode"], first["intensity"]), ("#8E75FF", "dark", "minimal")
        )
        self.assertEqual(first["roles"], DEFAULT)
        self.assertEqual(list(first["roles"]), gen.ROLES)  # ROLES order, not DEFAULT order

    def test_render_is_deterministic(self):
        self.assertEqual(self.rendered, gen.render_colour_vectors(self.sources))

    def test_ts_renderer_lists_the_same_vectors(self):
        parsed = parse_colour_vectors_ts(gen.render_colour_vectors_ts(self.sources))
        self.assertEqual(len(parsed), 96)
        self.assertEqual(
            [
                (vector["base"], vector["mode"], vector["intensity"], vector["roles"])
                for vector in json.loads(self.rendered)
            ],
            parsed,
        )
        for base, mode, intensity, roles in parsed:
            self.assertEqual(list(roles), gen.ROLES, f"{base} {mode} {intensity}")

    def test_ts_render_is_headed_and_exported(self):
        out = gen.render_colour_vectors_ts(self.sources)
        self.assertTrue(
            out.startswith(
                "// @generated by design/gen/gen_tokens.py from design/colour.json.\n"
                "// Do not edit by hand"
            )
        )
        self.assertIn(
            "export const colourVectors = [\n"
            "  {\n"
            "    base: '#8E75FF',\n"
            "    mode: 'dark',\n"
            "    intensity: 'minimal',\n"
            "    roles: {\n"
            "      ground: '#121214',\n",
            out,
        )
        self.assertTrue(out.endswith("  },\n] as const;\n"))


class RenderColourParamsTsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sources = {"tokens": gen.load(REAL), "colour": gen.load_colour(REAL_COLOUR)}
        self.rendered = gen.render_colour_params_ts(self.sources)

    def test_ts_params_are_headed_with_the_roles_in_order(self):
        self.assertTrue(
            self.rendered.startswith(
                "// @generated by design/gen/gen_tokens.py from design/colour.json.\n"
                "// Do not edit by hand"
            )
        )
        self.assertIn("export const colourRoles = [\n  'ground',", self.rendered)
        self.assertIn("  'scrim',\n] as const;", self.rendered)

    def test_ts_params_carry_the_scalars_and_mode_pairs(self):
        self.assertIn("export const colourParams = {", self.rendered)
        self.assertIn("accentTextContrast: 6.9,", self.rendered)
        self.assertIn("ground: [0.183, 0.004],", self.rendered)
        self.assertIn("scrim: [0.142, 0.0178, 0.6],", self.rendered)
        self.assertTrue(self.rendered.endswith("} as const;\n"))

    def test_ts_params_export_the_valid_mode_and_intensity_names(self):
        self.assertIn("export const colourModes = ['dark', 'light'] as const;", self.rendered)
        self.assertIn(
            "export const colourIntensities = ['minimal', 'balanced', 'vibrant'] as const;",
            self.rendered,
        )

    def test_ts_params_are_deterministic(self):
        self.assertEqual(self.rendered, gen.render_colour_params_ts(self.sources))


RS_VECTOR_ENTRY = re.compile(
    r'^    \("([^"]+)", crate::Mode::(Dark|Light), '
    r"crate::Intensity::(Minimal|Balanced|Vibrant), \[\n"
    r"((?:        [^\n]+\n)+)"
    r"    \]\),$",
    re.MULTILINE,
)
RS_ROLE_VALUE = re.compile(r"0x([0-9a-f]{8}),")


def rust_role_literal(value: str) -> str:
    """`#rrggbb` -> `0xrrggbbff`; `#rrggbbaa` stays as it is."""
    digits = value[1:]
    if len(digits) == 6:
        digits += "ff"
    return "0x" + digits.lower()


def parse_colour_vectors_rs(text: str) -> list[tuple[str, str, str, list[str]]]:
    """The entries of the generated Rust module, for comparison with the JSON."""
    return [
        (
            match.group(1),
            match.group(2).lower(),
            match.group(3).lower(),
            [f"0x{value}" for value in RS_ROLE_VALUE.findall(match.group(4))],
        )
        for match in RS_VECTOR_ENTRY.finditer(text)
    ]


class RenderColourVectorsRsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sources = {"tokens": gen.load(REAL), "colour": gen.load_colour(REAL_COLOUR)}
        self.rendered = gen.render_colour_vectors_rs(self.sources)

    def test_rs_lists_the_same_vectors_as_the_json(self):
        parsed = parse_colour_vectors_rs(self.rendered)
        vectors = json.loads(gen.render_colour_vectors(self.sources))
        self.assertEqual(len(parsed), 96)
        self.assertEqual(
            [
                (
                    vector["base"],
                    vector["mode"],
                    vector["intensity"],
                    [rust_role_literal(vector["roles"][role]) for role in gen.ROLES],
                )
                for vector in vectors
            ],
            parsed,
        )

    def test_rs_first_row_is_the_approved_default_palette(self):
        head = '("#8E75FF", crate::Mode::Dark, crate::Intensity::Minimal, ['
        self.assertIn(head, self.rendered)
        start = self.rendered.index(head)
        row = self.rendered[start : self.rendered.index("]),", start)]
        self.assertIn("0x121214ff,", row)
        self.assertTrue(row.rstrip().endswith("0x09081199,"), row)

    def test_rs_render_is_deterministic_and_headed(self):
        self.assertEqual(self.rendered, gen.render_colour_vectors_rs(self.sources))
        self.assertTrue(
            self.rendered.startswith(
                "// @generated by design/gen/gen_tokens.py from design/colour.json.\n"
                "// Do not edit by hand"
            )
        )
        self.assertIn(
            "pub(crate) const VECTORS: "
            "&[(&str, crate::Mode, crate::Intensity, [u32; 16])] = &[",
            self.rendered,
        )


class RenderColourParamsRsWholeNumberTest(TempSource):
    def test_whole_numbers_render_as_rust_floats(self):
        self.edit_colour(set_value("ink", [0.2, 0]))
        self.edit_colour(set_value("modes.dark.scrim", [0.142, 0.0178, 1]))
        rendered = gen.render_colour_params_rs(
            {"tokens": gen.load(REAL), "colour": self.load_colour()}
        )
        self.assertIn("pub const INK: [f64; 2] = [0.2, 0.0];", rendered)
        self.assertIn("scrim: [0.142, 0.0178, 1.0],", rendered)


class RenderColourParamsRsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sources = {"tokens": gen.load(REAL), "colour": gen.load_colour(REAL_COLOUR)}
        self.rendered = gen.render_colour_params_rs(self.sources)

    def test_rs_scalars(self):
        for line in (
            "pub const CHROMA_REFERENCE: f64 = 0.197;",
            "pub const ACCENT_TEXT_CONTRAST: f64 = 6.9;",
            "pub const INTENSITY: [f64; 3] = [1.0, 2.5, 5.0];",
            "pub const INK: [f64; 2] = [0.183, 0.004];",
            "pub const PAPER: [f64; 2] = [0.985, 0.003];",
            "pub const STATUS: [u32; 3] = [0x3ddc84, 0xffb84d, 0xff6b7d];",
        ):
            self.assertIn(line, self.rendered)

    def test_rs_mode_params(self):
        self.assertIn("pub struct ModeParams {", self.rendered)
        for field in (
            "pub ground: [f64; 2],",
            "pub surface: [f64; 2],",
            "pub fill: [f64; 2],",
            "pub hairline: [f64; 2],",
            "pub text: [f64; 2],",
            "pub text_secondary: [f64; 2],",
            "pub text_dim: [f64; 2],",
            "pub accent_l: [f64; 2],",
            "pub scrim: [f64; 3],",
        ):
            self.assertIn(field, self.rendered)
        self.assertIn("ground: [0.183, 0.004],", self.rendered)
        self.assertIn("accent_l: [0.62, 0.8],", self.rendered)
        self.assertIn("scrim: [0.142, 0.0178, 0.6],", self.rendered)
        self.assertIn("pub const DARK: ModeParams = ModeParams {", self.rendered)
        self.assertIn("pub const LIGHT: ModeParams = ModeParams {", self.rendered)

    def test_rs_render_is_deterministic_and_headed(self):
        self.assertEqual(self.rendered, gen.render_colour_params_rs(self.sources))
        self.assertTrue(
            self.rendered.startswith(
                "// @generated by design/gen/gen_tokens.py from design/colour.json.\n"
                "// Do not edit by hand"
            )
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

    def test_removed_icon_leaves_a_stale_asset(self):
        self.assertEqual(gen.run(self.root, check=False), 0)
        asset = self.root / "native/crates/semaphore-design/assets/lucide/mic.svg"
        self.assertTrue(asset.is_file())

        self.remove_icon("Mic")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.run(self.root, check=True), 1)
        self.assertIn(
            "stale: native/crates/semaphore-design/assets/lucide/mic.svg", stderr.getvalue()
        )
        self.assertTrue(asset.is_file())  # check writes nothing

        self.assertEqual(gen.run(self.root, check=False), 0)
        self.assertFalse(asset.exists())


class RunInvalidIconsTest(TempSource):
    def test_invalid_icons_after_a_run_leave_every_output_alone(self):
        self.assertEqual(gen.run(self.root, check=False), 0)
        generated = self.root / "frontend/src/kit/icons/generated.ts"
        asset = self.root / "native/crates/semaphore-design/assets/lucide/volume-2.svg"
        self.assertTrue(asset.is_file())
        before = generated.read_bytes()

        mic = self.root / "design" / "icons" / "lucide" / "mic.svg"
        mic.write_text(
            mic.read_text(encoding="utf-8").replace('viewBox="0 0 24 24"', 'viewBox="0 0 16 16"'),
            encoding="utf-8",
        )
        self.remove_icon("Volume2")

        with self.assertRaisesRegex(gen.TokenError, r"^icons/mic\.svg"):
            gen.run(self.root, check=False)
        # Nothing was written or deleted by the failed run.
        self.assertTrue(asset.is_file())
        self.assertEqual(generated.read_bytes(), before)


class MainTest(TempSource):
    def run_main(self, argv):
        stderr = io.StringIO()
        with mock.patch.object(gen, "ROOT", self.root), contextlib.redirect_stderr(stderr):
            code = gen.main(argv)
        return code, stderr.getvalue()

    def test_main_reports_token_error_on_one_line(self):
        self.edit(set_value("space.lg", "16"))
        for argv in ([], ["--check"]):
            with self.subTest(argv=argv):
                code, err = self.run_main(argv)
                self.assertEqual(code, 1)
                self.assertTrue(err.startswith("error: "), err)
                self.assertIn("space.lg", err)
                self.assertNotIn("Traceback", err)
                self.assertEqual(len(err.strip().splitlines()), 1)

    def test_main_usage(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.main(["--bogus"]), 2)
        self.assertIn("usage", stderr.getvalue().lower())

    def test_main_reports_broken_colour_source_on_one_line(self):
        self.colour_source.write_text("{ bad", encoding="utf-8")
        for argv in ([], ["--check"]):
            with self.subTest(argv=argv):
                code, err = self.run_main(argv)
                self.assertEqual(code, 1)
                self.assertTrue(err.startswith("error: "), err)
                self.assertNotIn("Traceback", err)
                self.assertEqual(len(err.strip().splitlines()), 1)


class BrokenColourSourceTest(unittest.TestCase):
    """Running the generator must report a bad `design/colour.json` as one error line.

    This runs the script in a subprocess over a temporary repo tree: the bug is in
    the module's *import* of `colour_ref`, which parses the file before `main` can
    catch anything, so an in-process test cannot see it.
    """

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        (self.root / "design" / "gen").mkdir(parents=True)
        for name in ("gen_tokens.py", "gen_error.py", "colour_ref.py"):
            shutil.copy(GEN_DIR / name, self.root / "design" / "gen" / name)
        shutil.copy(REAL, self.root / "design" / "tokens.json")
        self.colour = self.root / "design" / "colour.json"
        self.colour.write_text(REAL_COLOUR.read_text(encoding="utf-8"), encoding="utf-8")

    def run_generator(self) -> tuple[int, str]:
        result = subprocess.run(
            [sys.executable, "-B", str(self.root / "design" / "gen" / "gen_tokens.py")],
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stderr

    def assert_one_error_line(self) -> None:
        code, err = self.run_generator()
        self.assertEqual(code, 1)
        self.assertTrue(err.startswith("error: "), err)
        self.assertNotIn("Traceback", err)
        self.assertEqual(len(err.strip().splitlines()), 1)

    def test_broken_colour_source(self):
        self.colour.write_text("{ bad", encoding="utf-8")
        self.assert_one_error_line()

    def test_missing_colour_source(self):
        self.colour.unlink()
        self.assert_one_error_line()


if __name__ == "__main__":
    unittest.main()
