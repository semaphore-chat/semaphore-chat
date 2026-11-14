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
        self.assertEqual(len(self.document["icons"]), 54)

    def test_real_mic_loads_with_its_licence_comment_and_class(self):
        mic = next(icon for icon in self.document["icons"] if icon["name"] == "Mic")
        self.assertEqual(mic["file"], "mic")
        self.assertTrue(mic["svg"].startswith("<!-- @license lucide-static v1.71.0 - ISC -->"))
        self.assertIn('class="lucide lucide-mic"', mic["svg"])
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

    def test_rs_enum_and_lookups(self):
        rendered = icons.render_icons_rs(self.document)
        self.assertIn("pub enum LoungeIcon {", rendered)
        self.assertIn('Self::Mic => "lucide/mic.svg",', rendered)
        self.assertIn('include_bytes!("../assets/lucide/mic.svg")', rendered)
        self.assertIn("pub const ALL: [LoungeIcon; 54]", rendered)

    def test_rs_is_deterministic_and_headed(self):
        rendered = icons.render_icons_rs(self.document)
        self.assertEqual(rendered, icons.render_icons_rs(self.document))
        self.assertTrue(rendered.startswith("// @generated by design/gen/gen_tokens.py"))

    def test_native_svg_only_replaces_the_stroke_colour(self):
        mic = self.by_name("Mic")
        rendered = icons.render_native_svg(mic)
        self.assertIn('stroke="#000"', rendered)
        self.assertNotIn("currentColor", rendered)
        self.assertEqual(rendered, mic["svg"].replace("currentColor", "#000"))

    def test_web_and_rust_list_the_same_names_in_the_same_order(self):
        ts_names = re.findall(r"^  '([A-Za-z0-9]+)',$", icons.render_icons_ts(self.document), re.M)
        rs_names = re.findall(r"^    ([A-Za-z0-9]+),$", icons.render_icons_rs(self.document), re.M)
        self.assertEqual(ts_names, NAMES)
        self.assertEqual(rs_names, NAMES)


if __name__ == "__main__":
    unittest.main()
