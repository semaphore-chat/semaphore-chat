"""Tests for `design/gen/gen_icons.py`, run with the Python standard library only.

    python3 -m unittest discover -s design/gen -p 'test_*.py' -v
"""

from __future__ import annotations

import json
import pathlib
import re
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import gen_icons as icons  # noqa: E402  (after the path fix above)
import gen_tokens as gen  # noqa: E402  (the error type and the generator under test)

REPO = pathlib.Path(__file__).resolve().parents[2]
REAL_ICONS = REPO / "design" / "icons"
NAMES = list(json.loads((REAL_ICONS / "icons.json").read_text(encoding="utf-8"))["icons"])


class TempIcons(unittest.TestCase):
    """A temporary repo root holding a copy of the real icon sources."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.dir = self.root / "design" / "icons"
        shutil.copytree(REAL_ICONS, self.dir)

    def load(self) -> dict:
        return icons.load_icons(self.root)

    def edit_json(self, change) -> None:
        """Change the icon map (`{"Name": "file"}`) in the copied `icons.json`."""
        document = json.loads((self.dir / "icons.json").read_text(encoding="utf-8"))
        change(document["icons"])
        (self.dir / "icons.json").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    def edit_svg(self, name: str, old: str, new: str) -> None:
        path = self.dir / "lucide" / f"{name}.svg"
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text)
        path.write_text(text.replace(old, new), encoding="utf-8")

    def insert_before_root(self, name: str, text: str) -> None:
        """Put `text` between the licence line and the root element."""
        self.edit_svg(name, "\n<svg", f"\n{text}\n<svg")

    def assert_invalid(self, *needles: str) -> None:
        """`load_icons` must reject the copy, naming the file or the icon."""
        with self.assertRaises(gen.TokenError) as caught:
            self.load()
        message = str(caught.exception)
        self.assertTrue(message.startswith("icons"), message)
        self.assertTrue(any(needle in message for needle in needles), message)


class RealSetTest(unittest.TestCase):
    def setUp(self) -> None:
        self.document = icons.load_icons(REPO)

    def test_loads_the_real_set_in_icons_json_order(self):
        self.assertEqual(self.document["version"], "1.71.0")
        self.assertEqual([icon["name"] for icon in self.document["icons"]], NAMES)
        self.assertEqual(len(self.document["icons"]), 62)

    def test_real_mic_loads_with_its_shapes(self):
        mic = next(icon for icon in self.document["icons"] if icon["name"] == "Mic")
        self.assertEqual(mic["file"], "mic")
        self.assertEqual(
            mic["nodes"],
            [
                ("path", {"d": "M12 19v3"}),
                ("path", {"d": "M19 10v2a7 7 0 0 1-14 0v-2"}),
                ("rect", {"x": "9", "y": "2", "width": "6", "height": "13", "rx": "3"}),
            ],
        )


class SvgValidationTest(TempIcons):
    def test_wrong_view_box(self):
        self.edit_svg("mic", 'viewBox="0 0 24 24"', 'viewBox="0 0 16 16"')
        self.assert_invalid("mic")

    def test_script_child(self):
        self.edit_svg("mic", "</svg>", "<script>alert(1)</script></svg>")
        self.assert_invalid("mic")

    def test_group_wrapper(self):
        self.edit_svg("mic", '<path d="M12 19v3" />', '<g><path d="M12 19v3" /></g>')
        self.assert_invalid("mic")

    def test_child_fill(self):
        self.edit_svg("mic", '<path d="M12 19v3" />', '<path d="M12 19v3" fill="red" />')
        self.assert_invalid("mic")

    def test_child_event_handler(self):
        self.edit_svg("mic", '<path d="M12 19v3" />', '<path d="M12 19v3" onclick="go()" />')
        self.assert_invalid("mic")

    def test_root_stroke_width(self):
        self.edit_svg("mic", 'stroke-width="2"', 'stroke-width="1.5"')
        self.assert_invalid("mic")

    def test_root_class_must_be_lucide_tokens(self):
        self.edit_svg("mic", 'class="lucide lucide-mic"', 'class="lucide icon"')
        self.assert_invalid("mic")

    def test_root_extra_attribute(self):
        self.edit_svg("mic", 'stroke-linejoin="round"', 'stroke-linejoin="round" data-x="1"')
        self.assert_invalid("mic")

    def test_doctype_with_an_internal_entity(self):
        self.insert_before_root("mic", '<!DOCTYPE svg [<!ENTITY e "M12 19v3">]>')
        self.edit_svg("mic", 'd="M12 19v3"', 'd="&e;"')
        self.assert_invalid("mic")

    def test_processing_instruction_before_the_root(self):
        self.insert_before_root("mic", '<?xml-stylesheet href="x"?>')
        self.assert_invalid("mic")

    def test_second_comment_inside_the_svg(self):
        self.edit_svg("mic", '<path d="M12 19v3" />', '<!-- second --><path d="M12 19v3" />')
        self.assert_invalid("mic")

    def test_child_in_a_foreign_namespace(self):
        self.edit_svg("mic", '<path d="M12 19v3" />', '<x:path xmlns:x="http://evil" d="M0 0"/>')
        self.assert_invalid("mic")

    def test_root_in_a_foreign_namespace(self):
        self.edit_svg("mic", 'xmlns="http://www.w3.org/2000/svg"', 'xmlns="http://evil"')
        self.assert_invalid("mic")

    def test_script_url_in_path_data(self):
        self.edit_svg("mic", 'd="M12 19v3"', 'd="javascript:alert(1)"')
        self.assert_invalid("mic")

    def test_exponent_in_a_number(self):
        self.edit_svg("mic", '<rect x="9"', '<rect cx="1e3x" x="9"')
        self.assert_invalid("mic")

    def test_licence_version_must_match_icons_json(self):
        self.edit_svg("mic", "lucide-static v1.71.0", "lucide-static v1.70.0")
        self.assert_invalid("mic")

    def test_class_token_must_be_exactly_lucide(self):
        self.edit_svg("mic", 'class="lucide lucide-mic"', 'class="lucidefoo"')
        self.assert_invalid("mic")


class SetValidationTest(TempIcons):
    def test_name_must_be_pascal_case(self):
        def rename(icon_map: dict) -> None:
            icon_map["mic"] = icon_map.pop("Mic")

        self.edit_json(rename)
        self.assert_invalid("mic")

    def test_duplicate_file(self):
        def reuse_the_mic_file(icon_map: dict) -> None:
            icon_map["MicOff"] = "mic"

        self.edit_json(reuse_the_mic_file)
        self.assert_invalid("MicOff")

    def test_name_without_a_file(self):
        def point_at_a_missing_file(icon_map: dict) -> None:
            icon_map["Mic"] = "mic-missing"

        self.edit_json(point_at_a_missing_file)
        self.assert_invalid("mic-missing")

    def test_file_without_a_name(self):
        shutil.copy(self.dir / "lucide" / "mic.svg", self.dir / "lucide" / "extra.svg")
        self.assert_invalid("extra")

    def test_duplicate_icon_key(self):
        # A dict cannot hold a duplicate key, so write the raw document twice.
        path = self.dir / "icons.json"
        text = path.read_text(encoding="utf-8")
        self.assertIn('"Mic": "mic",', text)
        path.write_text(
            text.replace('"Mic": "mic",', '"Mic": "mic",\n    "Mic": "mic",', 1),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(gen.TokenError, r"^icons\.Mic"):
            self.load()


class RenderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.document = icons.load_icons(REPO)

    def by_name(self, name: str) -> dict:
        return next(icon for icon in self.document["icons"] if icon["name"] == name)

    def test_ts_nodes_and_types(self):
        rendered = icons.render_icons_ts(self.document)
        self.assertIn("Mic: [", rendered)
        self.assertIn("['path', { d: 'M12 19v3' }]", rendered)
        self.assertIn("export type IconName = keyof typeof iconNodes;", rendered)
        self.assertIn("export const iconNames = [", rendered)
        self.assertIn("  'TriangleAlert',", rendered)

    def test_ts_is_deterministic_and_headed(self):
        rendered = icons.render_icons_ts(self.document)
        self.assertEqual(rendered, icons.render_icons_ts(self.document))
        self.assertTrue(
            rendered.startswith(
                "// @generated by design/gen/gen_tokens.py from design/icons/icons.json.\n"
                "// Do not edit by hand"
            )
        )

    def test_ts_names_the_lucide_licence(self):
        rendered = icons.render_icons_ts(self.document)
        self.assertIn(
            "/*! Icons: Lucide v1.71.0, ISC licence (parts MIT, from Feather). "
            "See design/icons/LICENSE. */",
            rendered,
        )

    def test_rs_enum_and_lookups(self):
        rendered = icons.render_icons_rs(self.document)
        self.assertIn("pub enum LoungeIcon {", rendered)
        self.assertIn('Self::Mic => "lucide/mic.svg",', rendered)
        self.assertIn('include_bytes!("../assets/lucide/mic.svg")', rendered)
        self.assertIn("pub const ALL: [LoungeIcon; 62]", rendered)

    def test_rs_is_deterministic_and_headed(self):
        rendered = icons.render_icons_rs(self.document)
        self.assertEqual(rendered, icons.render_icons_rs(self.document))
        self.assertTrue(rendered.startswith("// @generated by design/gen/gen_tokens.py"))

    def test_native_svg_is_rebuilt_from_the_validated_shapes(self):
        mic = self.by_name("Mic")
        rendered = icons.render_native_svg(mic, self.document["version"])
        self.assertEqual(
            rendered.splitlines(),
            [
                "<!-- @license lucide-static v1.71.0 - ISC -->",
                '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" '
                'viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" '
                'stroke-linecap="round" stroke-linejoin="round">',
                '  <path d="M12 19v3" />',
                '  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />',
                '  <rect x="9" y="2" width="6" height="13" rx="3" />',
                "</svg>",
            ],
        )
        self.assertEqual(rendered.count('stroke="#000"'), 1)
        self.assertNotIn("currentColor", rendered)
        self.assertTrue(rendered.endswith("</svg>\n"))
        self.assertEqual(rendered, icons.render_native_svg(mic, self.document["version"]))

    def test_native_svg_draws_every_node_and_nothing_else(self):
        for icon in self.document["icons"]:
            rendered = icons.render_native_svg(icon, self.document["version"])
            children = [line for line in rendered.splitlines() if line.startswith("  <")]
            self.assertEqual(len(children), len(icon["nodes"]), icon["name"])

    def test_web_and_rust_list_the_same_names_in_the_same_order(self):
        ts_names = re.findall(r"^  '([A-Za-z0-9]+)',$", icons.render_icons_ts(self.document), re.M)
        rs_names = re.findall(r"^    ([A-Za-z0-9]+),$", icons.render_icons_rs(self.document), re.M)
        self.assertEqual(ts_names, NAMES)
        self.assertEqual(rs_names, NAMES)


class RenderKotlinTest(unittest.TestCase):
    def setUp(self) -> None:
        self.document = icons.load_icons(REPO)
        self.rendered = icons.render_icons_kt(self.document)

    def icon(self, name: str) -> str:
        """One icon's argument list in the generated object."""
        match = re.search(
            rf"^    val {name}: ImageVector = strokeIcon\(\n(.*?)^    \)$",
            self.rendered,
            re.MULTILINE | re.DOTALL,
        )
        self.assertIsNotNone(match, name)
        return match.group(1)

    def test_every_icon_is_an_image_vector(self):
        names = re.findall(
            r"^    val (\w+): ImageVector = strokeIcon\(", self.rendered, re.MULTILINE
        )
        self.assertEqual(names, NAMES)

    def test_path_data_survives_the_conversion(self):
        mic = self.icon("Mic")
        self.assertIn('"M12 19v3",', mic)
        self.assertIn('"M19 10v2a7 7 0 0 1-14 0v-2",', mic)
        # The source's <rect> is the same outline as path data.
        self.assertIn(
            '"M12 2 H12 A3 3 0 0 1 15 5 V12 A3 3 0 0 1 12 15 H12 '
            'A3 3 0 0 1 9 12 V5 A3 3 0 0 1 12 2 Z",',
            mic,
        )

    def test_other_shapes_become_paths(self):
        self.assertIn(
            '"M9 12 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 Z"', self.icon("Settings")
        )
        self.assertIn('"M4 9 L20 9"', self.icon("Hash"))
        self.assertIn('"M22 12 L16 12 L14 15 L10 15 L8 12 L2 12"', self.icon("Inbox"))
        self.assertIn(
            '"M10 8 H20 A2 2 0 0 1 22 10 V20 A2 2 0 0 1 20 22 H10 '
            'A2 2 0 0 1 8 20 V10 A2 2 0 0 1 10 8 Z"',
            self.icon("Copy"),
        )

    def test_icons_stroke_and_never_fill(self):
        self.assertIn("fill = null,", self.rendered)
        self.assertIn("stroke = SolidColor(Color.Black),", self.rendered)
        self.assertIn("strokeLineWidth = 2f,", self.rendered)
        self.assertIn("strokeLineCap = StrokeCap.Round,", self.rendered)
        self.assertIn("strokeLineJoin = StrokeJoin.Round,", self.rendered)
        self.assertNotIn("currentColor", self.rendered)

    def test_kt_is_deterministic_and_headed(self):
        self.assertEqual(self.rendered, icons.render_icons_kt(icons.load_icons(REPO)))
        self.assertTrue(
            self.rendered.startswith(
                "// @generated by design/gen/gen_tokens.py from design/icons/icons.json.\n"
                "// Do not edit by hand: change the source or the generator and re-run it.\n"
                "// Regenerate with: python3 design/gen/gen_tokens.py\n"
            )
        )
        self.assertIn("package app.semaphorechat.android.design\n", self.rendered)
        self.assertIn("Lucide v1.71.0, ISC licence", self.rendered)

    def test_kt_is_a_registered_output(self):
        outputs = icons.renderers(self.document)
        self.assertIn(icons.KT_OUTPUT, outputs)
        self.assertEqual(outputs[icons.KT_OUTPUT]({"icons": self.document}), self.rendered)


class RenderKotlinMissingShapeTest(TempIcons):
    def test_a_shape_without_its_geometry_fails_the_generator(self):
        self.edit_svg(
            "settings", '<circle cx="12" cy="12" r="3" />', '<circle cx="12" cy="12" />'
        )
        with self.assertRaisesRegex(
            gen.TokenError, r"^icons/settings\.svg: <circle> is missing r$"
        ):
            icons.render_icons_kt(self.load())


if __name__ == "__main__":
    unittest.main()
