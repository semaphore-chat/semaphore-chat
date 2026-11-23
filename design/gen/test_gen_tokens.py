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
import gen_icons  # noqa: E402  (the icon outputs, which `run` merges in)
import gen_tokens as gen  # noqa: E402  (after the path fix above)
from test_colour_ref import DEFAULT  # noqa: E402  (the approved mock-up palette)

REPO = pathlib.Path(__file__).resolve().parents[2]
GEN_DIR = REPO / "design" / "gen"
REAL = REPO / "design" / "tokens.json"
REAL_COLOUR = REPO / "design" / "colour.json"
REAL_ICONS = REPO / "design" / "icons"
REAL_BEHAVIOUR = REPO / "design" / "behaviour"


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
        shutil.copytree(REAL_BEHAVIOUR, self.root / "design" / "behaviour")

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
        self.assertEqual(
            list(t)[-5:], ["icon", "avatar", "border", "state", "density"]
        )  # after the old groups
        self.assertEqual(t["avatar"], {"xs": 20, "sm": 28, "md": 36, "lg": 44, "xl": 64})


class MotionTokensTest(unittest.TestCase):
    def test_behaviour_durations_are_motion_tokens(self):
        # The toast and typeahead timings the behaviour patterns refer to.
        motion = gen.load(REAL)["motion"]
        self.assertEqual(
            (motion["typeahead"], motion["toast"], motion["toastAction"]), (1000, 4000, 8000)
        )
        self.assertIn("pub const MOTION_TOAST_ACTION_MS: u32 = 8000;", gen.render_rs(gen.load(REAL)))
        self.assertIn("toastAction: 8000,", gen.render_ts(gen.load(REAL)))


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

    def test_people_colours_must_be_hex(self):
        self.edit_colour(set_value("people.colours", ["pink"]))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.people\.colours\[0\]"):
            self.load_colour()

    def test_people_colours_are_frozen(self):
        for changed in (
            list(gen.FROZEN_PEOPLE[1:]),  # one removed
            list(gen.FROZEN_PEOPLE) + ["#123456"],  # one added
            list(reversed(gen.FROZEN_PEOPLE)),  # reordered
            ["#FF8FB9"] + list(gen.FROZEN_PEOPLE[1:]),  # one changed
        ):
            with self.subTest(changed=changed):
                self.edit_colour(set_value("people.colours", changed))
                with self.assertRaisesRegex(gen.TokenError, r"^colour\.people\.colours: the list is frozen"):
                    self.load_colour()

    def test_people_needs_the_frozen_note(self):
        self.edit_colour(delete("people.frozen"))
        with self.assertRaisesRegex(gen.TokenError, r"^colour\.people\.frozen"):
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


class DensityTest(TempSource):
    """`density.touch`: a second value set for the control names, for touch clients."""

    def test_real_touch_density(self):
        touch = gen.load(REAL)["density"]["touch"]
        self.assertEqual(touch["control"], {"sm": 40, "md": 48, "lg": 56})
        self.assertEqual(touch["listRow"], {"md": 56, "lg": 72})
        self.assertEqual(touch["hitArea"], 48)

    def test_control_keys_must_match_the_control_group(self):
        self.edit(delete("density.touch.control.lg"))
        with self.assertRaisesRegex(gen.TokenError, r"^density\.touch\.control"):
            self.load()
        self.edit(set_value("density.touch.control.lg", 56))
        self.edit(set_value("density.touch.control.xl", 64))
        with self.assertRaisesRegex(gen.TokenError, r"^density\.touch\.control"):
            self.load()

    def test_fields_are_exact(self):
        self.edit(set_value("density.touch.spacing", 4))
        with self.assertRaisesRegex(gen.TokenError, r"^density\.touch"):
            self.load()

    def test_list_row_sizes_are_exact(self):
        self.edit(set_value("density.touch.listRow.sm", 40))
        with self.assertRaisesRegex(gen.TokenError, r"^density\.touch\.listRow"):
            self.load()

    def test_values_are_lengths(self):
        self.edit(set_value("density.touch.hitArea", -48))
        with self.assertRaisesRegex(gen.TokenError, r"^density\.touch\.hitArea"):
            self.load()
        self.edit(set_value("density.touch.hitArea", 48))
        self.edit(set_value("density.touch.control.md", "48"))
        with self.assertRaisesRegex(gen.TokenError, r"^density\.touch\.control\.md"):
            self.load()

    def test_rendered_in_every_client(self):
        tokens = gen.load(REAL)
        ts = gen.render_ts(tokens)
        self.assertIn("  density: {\n    touch: {\n      control: { sm: 40, md: 48, lg: 56 },", ts)
        self.assertIn("      listRow: { md: 56, lg: 72 },\n      hitArea: 48,", ts)
        rs = gen.render_rs(tokens)
        for line in (
            "pub const DENSITY_TOUCH_CONTROL_SM: f32 = 40.0;",
            "pub const DENSITY_TOUCH_CONTROL_LG: f32 = 56.0;",
            "pub const DENSITY_TOUCH_LIST_ROW_MD: f32 = 56.0;",
            "pub const DENSITY_TOUCH_LIST_ROW_LG: f32 = 72.0;",
            "pub const DENSITY_TOUCH_HIT_AREA: f32 = 48.0;",
        ):
            self.assertIn(line, rs)
        kt = gen.render_kt(tokens, gen.load_colour(REAL_COLOUR))
        density = kt[kt.index("    object Density {") :]
        self.assertIn("        object Touch {\n            object Control {", density)
        self.assertIn("                val Md: Dp = 48.dp", density)
        self.assertIn("            object ListRow {", density)
        self.assertIn("                val Lg: Dp = 72.dp", density)
        self.assertIn("            val HitArea: Dp = 48.dp", density)


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


# The object each source group becomes inside `object Tokens`.
KT_OBJECTS = {group: gen._kt_pascal(group) for group in gen.GROUPS}


class RenderKtTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tokens = gen.load(REAL)
        self.colour = gen.load_colour(REAL_COLOUR)
        self.rendered = gen.render_kt(self.tokens, self.colour)

    def block(self, name: str) -> str:
        """The body of one nested group object."""
        match = re.search(
            rf"^    object {name} \{{\n(.*?)^    \}}",
            self.rendered,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(match, name)
        return match.group(1)

    def members(self, name: str) -> list[str]:
        return re.findall(r"^        val (\w+):", self.block(name), re.MULTILINE)

    def test_kt_covers_every_rust_token(self):
        # Every constant the Rust client gets, under its group's object in Kotlin style.
        # Densities nest one level deeper; DensityTest covers them.
        rust = gen.render_rs(self.tokens)
        pairs = re.findall(r"^/// `([a-z]+)\.([A-Za-z0-9]+)`, ", rust, re.MULTILINE)
        densities = re.findall(r"^/// `density\.", rust, re.MULTILINE)
        self.assertEqual(
            len(pairs) + len(densities), len(re.findall(r"^pub const ", rust, re.MULTILINE))
        )
        for group, key in pairs:
            self.assertIn(
                gen._kt_name(group, key), self.members(KT_OBJECTS[group]), f"{group}.{key}"
            )
        self.assertTrue(all(pair[0] in KT_OBJECTS for pair in pairs))

    def test_kt_dimensions_are_dp_and_text_is_sp(self):
        space = self.block("Space")
        self.assertIn("val Lg: Dp = 16.dp", space)
        self.assertIn("val TwoXs: Dp = 2.dp", space)
        self.assertIn("val ThreeXl: Dp = 48.dp", space)
        self.assertIn("val Full: Dp = 9999.dp", self.block("Radius"))
        self.assertIn("val Phone: Dp = 600.dp", self.block("Breakpoint"))
        self.assertIn("val Gutter: Dp = 16.dp", self.block("Layout"))
        self.assertIn("size = 15.sp,", self.block("Text"))
        self.assertIn("lineHeight = 22.sp,", self.block("Text"))

    def test_kt_motion_is_milliseconds_and_state_is_alpha(self):
        motion = self.block("Motion")
        self.assertIn("val FastMs: Long = 120L", motion)
        self.assertIn("val ToastActionMs: Long = 8000L", motion)
        state = self.block("State")
        self.assertIn("val Hover: Float = 0.04f", state)
        self.assertIn("val Disabled: Float = 0.5f", state)

    def test_kt_text_styles_resolve_font_and_weight(self):
        text = self.block("Text")
        self.assertIn('family = "Figtree",', text)
        self.assertIn('family = "Bricolage Grotesque",', text)
        self.assertIn("weight = FontWeight.W400,", text)
        self.assertIn('val Heading: String = "Bricolage Grotesque"', self.block("Font"))

    def test_kt_shadows_are_dp_and_alpha(self):
        island = self.block("Shadow")
        self.assertIn("y = 6.dp,", island)
        self.assertIn("blur = 24.dp,", island)
        self.assertIn("alpha = 0.35f,", island)
        self.assertIn("alphaLight = 0.08f,", island)

    def test_kt_colours_are_compose_colours(self):
        self.assertIn("val Danger: Color = Color(0xFFFF6B7D)", self.block("Status"))
        people = self.block("People")
        self.assertIn("Color(0xFF6FB1F5)", people)
        self.assertEqual(people.count("Color(0xFF"), len(self.colour["people"]["colours"]))

    def test_kt_is_registered_for_the_check_mode(self):
        self.assertEqual(
            gen.OUTPUTS[gen.KT_OUTPUT]({"tokens": self.tokens, "colour": self.colour}),
            self.rendered,
        )

    def test_kt_output_path_is_the_android_tokens_file(self):
        self.assertEqual(
            gen.KT_OUTPUT,
            pathlib.Path(
                "native/android/kit/src/main/java/app/semaphorechat/android/design/Tokens.kt"
            ),
        )

    def test_kt_is_deterministic_and_headed(self):
        self.assertEqual(
            self.rendered, gen.render_kt(gen.load(REAL), gen.load_colour(REAL_COLOUR))
        )
        self.assertTrue(
            self.rendered.startswith(
                "// @generated by design/gen/gen_tokens.py from design/tokens.json "
                "and design/colour.json.\n"
                "// Do not edit by hand: change the source or the generator and re-run it.\n"
                "// Regenerate with: python3 design/gen/gen_tokens.py\n"
            )
        )
        self.assertIn("package app.semaphorechat.android.design\n", self.rendered)


class KotlinLiteralTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tokens = gen.load(REAL)
        self.colour = gen.load_colour(REAL_COLOUR)

    def render(self) -> str:
        return gen.render_kt(self.tokens, self.colour)

    def test_two_keys_with_the_same_kotlin_name_fail(self):
        self.tokens["space"]["twoXs"] = 3
        with self.assertRaisesRegex(
            gen.TokenError,
            r"^space\.twoXs: Kotlin member 'TwoXs' is already used by 'space\.2xs'$",
        ):
            self.render()

    def test_kt_string_escapes_the_kotlin_metacharacters(self):
        self.assertEqual(gen._kt_string('a"b\\c$d'), '"a\\"b\\\\c\\$d"')

    def test_a_dollar_in_a_font_is_escaped_in_both_places(self):
        self.tokens["font"]["body"] = "Fig$tree"
        rendered = self.render()
        self.assertIn('val Body: String = "Fig\\$tree"', rendered)
        self.assertIn('family = "Fig\\$tree",', rendered)

    def test_a_whole_number_past_int_is_a_float_literal(self):
        self.tokens["space"]["huge"] = 3000000000
        self.assertIn("val Huge: Dp = 3000000000f.dp", self.render())

    def test_a_number_beyond_float_range_is_an_error(self):
        self.tokens["space"]["huge"] = 10**39
        with self.assertRaisesRegex(gen.TokenError, r"^space\.huge: .*Float range"):
            self.render()


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

    def test_ts_params_carry_the_people_colours(self):
        self.assertIn("  people: ['#FF8FB8', '#FFA366',", self.rendered)

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


class KotlinOutputCheckTest(TempSource):
    def test_run_writes_then_check_covers_the_kotlin_outputs(self):
        self.assertEqual(gen.run(self.root, check=False), 0)
        for path in (gen.KT_OUTPUT, gen_icons.KT_OUTPUT):
            self.assertTrue((self.root / path).is_file(), path)
        self.assertEqual(gen.run(self.root, check=True), 0)

        target = self.root / gen.KT_OUTPUT
        target.write_text("stale\n", encoding="utf-8")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(gen.run(self.root, check=True), 1)
        self.assertIn(f"stale: {gen.KT_OUTPUT.as_posix()}", stderr.getvalue())


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


class PersonVectorsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.vectors = gen.person_vectors()

    def test_known_fnv1a_values(self):
        by_id = {v["id"]: v for v in self.vectors}
        # The published FNV-1a 32-bit test values.
        self.assertEqual(by_id[""]["fnv1a32"], "0x811c9dc5")
        self.assertEqual(by_id["a"]["fnv1a32"], "0xe40c292c")
        self.assertEqual(by_id["foobar"]["fnv1a32"], "0xbf9cf968")

    def test_empty_id_has_no_colour(self):
        self.assertEqual(self.vectors[0], {"id": "", "fnv1a32": "0x811c9dc5", "index": None, "colour": None})

    def test_colour_is_the_indexed_frozen_entry(self):
        for v in self.vectors[1:]:
            with self.subTest(id=v["id"]):
                self.assertEqual(v["colour"], gen.FROZEN_PEOPLE[v["index"]])
                self.assertEqual(v["index"], int(v["fnv1a32"], 16) % 9)

    def test_ts_copy_carries_the_same_vectors(self):
        rendered = gen.render_person_vectors_ts({})
        self.assertIn(json.dumps(self.vectors, indent=2, ensure_ascii=False), rendered)
        self.assertIn('"id": "名前"', rendered)


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
