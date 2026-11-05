#!/usr/bin/env python3
"""Turn the web client's theme and icon exports into `crates/semaphore-design`.

    scripts/export-web.sh theme      # tools/web-export/out/theme/tokens.json
    scripts/export-web.sh icons      # tools/web-export/out/icons/{icons,manifest.json}
    python3 tools/gen-design/gen_design.py [--check]

`--check` writes nothing: it compares what the generator would write with what is
committed and exits non-zero on any difference, including a stale or extra asset.

What is not a colour, and is therefore not in `Tokens`:
  * `palette.mode` - the `Mode` enum already carries it;
  * `palette.background.ground` and `palette.background.canvas` - CSS `background`
    shorthands, a gradient or `transparent` rather than a colour (themeConfig.ts
    says the same);
  * numbers - opacities, `contrastThreshold`, `tonalOffset`.
Every other palette leaf is a colour and is parsed; an unparseable one fails the
run with its path and value rather than being guessed at.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

NATIVE = Path(__file__).resolve().parents[2]
CRATE = NATIVE / "crates" / "semaphore-design"
THEME_EXPORT = NATIVE / "tools" / "web-export" / "out" / "theme" / "tokens.json"
ICON_EXPORT = NATIVE / "tools" / "web-export" / "out" / "icons"

# Theme order in the enums and in `THEMES`. Mode as the U2 spec names it.
MODES = ["light", "dark"]
INTENSITIES = ["minimal", "balanced", "vibrant"]
EXPECTED_THEMES = 72

NON_COLOUR_LEAVES = {"mode", "background.ground", "background.canvas"}

HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
FUNCTION = re.compile(
    r"^rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*(?:,\s*([0-9]*\.?[0-9]+)\s*)?\)$"
)


def parse_color(value: str, path: str) -> int:
    """`#rgb`/`#rrggbb`/`#rrggbbaa`/`rgb(...)`/`rgba(...)` as 0xRRGGBBAA."""
    hex_match = HEX.match(value)
    if hex_match:
        digits = hex_match.group(1)
        if len(digits) == 3:
            r, g, b = (int(digit * 2, 16) for digit in digits)
            return (r << 24) | (g << 16) | (b << 8) | 255
        channels = [int(digits[i : i + 2], 16) for i in range(0, len(digits), 2)]
        if len(channels) == 3:
            channels.append(255)
        r, g, b, a = channels
        return (r << 24) | (g << 16) | (b << 8) | a

    function_match = FUNCTION.match(value)
    if function_match:
        r, g, b = (int(function_match.group(i)) for i in (1, 2, 3))
        alpha = function_match.group(4)
        # Alpha 0..1 to the nearest of 256 steps; channels are kept exactly.
        a = 255 if alpha is None else min(255, max(0, math.floor(float(alpha) * 255 + 0.5)))
        if not all(0 <= channel <= 255 for channel in (r, g, b)):
            fail(path, value)
        return (r << 24) | (g << 16) | (b << 8) | a

    fail(path, value)


def fail(path: str, value: str) -> None:
    raise SystemExit(f"gen-design: {path}: {value!r} is not a colour this generator understands")


def flatten(path: str, value: object, out: dict[str, object]) -> None:
    if isinstance(value, dict):
        for key, member in value.items():
            flatten(f"{path}.{key}" if path else key, member, out)
    else:
        out[path] = value


def snake(segment: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", segment).lower()


def field_name(path: str) -> str:
    """`semantic.overlay.light` -> `semantic_overlay_light`, `grey.A100` -> `grey_a100`."""
    return "_".join(snake(segment) for segment in path.split("."))


def pascal(name: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in re.split(r"[-_ ]+", name))


def px(rem: str, html_font_size: int) -> str:
    value = float(rem.removesuffix("rem")) * html_font_size
    text = f"{value:.4f}".rstrip("0")
    return text + "0" if text.endswith(".") else text


class Theme:
    def __init__(self, key: str, palette: dict) -> None:
        self.key = key
        self.palette = palette

    def colors(self) -> dict[str, int]:
        leaves: dict[str, object] = {}
        flatten("", self.palette, leaves)
        colors: dict[str, int] = {}
        for path, value in leaves.items():
            if path in NON_COLOUR_LEAVES:
                continue
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                continue
            if not isinstance(value, str):
                fail(path, repr(value))
            colors[path] = parse_color(value, path)
        return colors


def load_themes() -> dict[str, Theme]:
    data = json.loads(THEME_EXPORT.read_text())
    themes = {key: Theme(key, palette) for key, palette in data["themes"].items()}
    if len(themes) != EXPECTED_THEMES:
        raise SystemExit(f"gen-design: {len(themes)} themes in {THEME_EXPORT}, expected {EXPECTED_THEMES}")
    return data, themes


def theme_grid(themes: dict[str, Theme]) -> tuple[list[str], list[str]]:
    accents: list[str] = []
    for key in themes:
        parts = key.split("-")
        if len(parts) != 3:
            raise SystemExit(f"gen-design: theme key {key!r} is not <mode>-<accent>-<intensity>")
        accent = parts[1]
        if accent not in accents:
            accents.append(accent)
    expected = {f"{mode}-{accent}-{intensity}" for mode in MODES for accent in accents for intensity in INTENSITIES}
    if expected != set(themes):
        missing = sorted(expected - set(themes))
        extra = sorted(set(themes) - expected)
        raise SystemExit(f"gen-design: themes are not the 2x{len(accents)}x3 grid; missing {missing}, extra {extra}")
    return accents, [f"{mode}-{accent}-{intensity}" for mode in MODES for accent in accents for intensity in INTENSITIES]


def render_all(enum: str, variants: list[str]) -> str:
    """`pub const ALL` as rustfmt would lay it out: one line when it fits, otherwise one per line."""
    inline = f"    pub const ALL: &'static [{enum}] = &[{', '.join('Self::' + v for v in variants)}];"
    if len(inline) <= 100:
        return inline
    lines = [f"    pub const ALL: &'static [{enum}] = &["]
    lines += [f"        Self::{variant}," for variant in variants]
    lines.append("    ];")
    return "\n".join(lines)


def render_generated(data: dict, themes: dict[str, Theme], accents: list[str], order: list[str]) -> str:
    colors = {key: theme.colors() for key, theme in themes.items()}
    every = set().union(*(set(theme_colors) for theme_colors in colors.values()))
    common = set.intersection(*(set(theme_colors) for theme_colors in colors.values()))
    fields = [(path, path not in common) for path in sorted(every)]

    out: list[str] = []
    w = out.append
    w("// @generated by tools/gen-design/gen_design.py from the web client's theme.")
    w("// Do not edit: change frontend/src/theme and run native/scripts/gen-design.sh.")
    w("//")
    w("// Resolved by native/tools/web-export/theme.test.ts at the commit in native/contract/PIN.")
    w("")
    w("use crate::Rgba;")
    w("")
    w("/// One theme's palette, flattened to one field per colour: `primary.main` is")
    w("/// [`Tokens::primary_main`]. Colour values are exactly the web's own.")
    w("#[derive(Debug, Clone, Copy, PartialEq, Eq)]")
    w("pub struct Tokens {")
    for path, optional in fields:
        w(f"    /// `{path}`" + (" (absent from some of the web's palettes)" if optional else ""))
        ty = "Option<Rgba>" if optional else "Rgba"
        w(f"    pub {field_name(path)}: {ty},")
    w("}")
    w("")
    w("/// The web's theme mode (`theme.palette.mode`).")
    w("#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]")
    w("pub enum Mode {")
    for mode in MODES:
        w(f"    {pascal(mode)},")
    w("}")
    w("")
    w("impl Mode {")
    w("    /// Every mode, in the order `THEMES` indexes them.")
    w(render_all("Mode", [pascal(mode) for mode in MODES]))
    w("}")
    w("")
    w("/// The 12 accent colours (`theme/constants.ts`, `accentColors`).")
    w("#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]")
    w("pub enum Accent {")
    for accent in accents:
        w(f"    {pascal(accent)},")
    w("}")
    w("")
    w("impl Accent {")
    w("    /// Every accent, in `accentColors` order.")
    w(render_all("Accent", [pascal(accent) for accent in accents]))
    w("}")
    w("")
    w("/// The theme intensity (`theme/constants.ts`, `ThemeIntensity`).")
    w("#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]")
    w("pub enum Intensity {")
    for intensity in INTENSITIES:
        w(f"    {pascal(intensity)},")
    w("}")
    w("")
    w("impl Intensity {")
    w("    /// Every intensity, weakest first.")
    w(render_all("Intensity", [pascal(intensity) for intensity in INTENSITIES]))
    w("}")
    w("")
    w(f"/// All {len(order)} resolved palettes, indexed `THEMES[mode][accent][intensity]`.")
    w(
        f"static THEMES: [[[Tokens; {len(INTENSITIES)}]; {len(accents)}]; {len(MODES)}] = ["
    )
    for mode in MODES:
        w(f"    // {pascal(mode)}")
        w("    [")
        for accent in accents:
            w(f"        // {pascal(accent)}")
            w("        [")
            for intensity in INTENSITIES:
                theme = themes[f"{mode}-{accent}-{intensity}"]
                w(f"            // {pascal(intensity)}")
                w("            Tokens {")
                for path, optional in fields:
                    if path not in colors[theme.key]:
                        w(f"                {field_name(path)}: None,")
                    elif optional:
                        w(f"                {field_name(path)}: Some(Rgba(0x{colors[theme.key][path]:08x})),")
                    else:
                        w(f"                {field_name(path)}: Rgba(0x{colors[theme.key][path]:08x}),")
                w("            },")
            w("        ],")
        w("    ],")
    w("];")
    w("")
    w("/// The resolved palette for one theme combination.")
    w("pub fn tokens(mode: Mode, accent: Accent, intensity: Intensity) -> &'static Tokens {")
    w("    &THEMES[mode as usize][accent as usize][intensity as usize]")
    w("}")
    w("")
    w("#[cfg(test)]")
    w("impl Tokens {")
    w("    /// Every field as its web palette path, for comparing with `data/tokens.json`.")
    w(f"    pub(crate) fn fields(&self) -> [(&'static str, Option<Rgba>); {len(fields)}] {{")
    w("        [")
    for path, optional in fields:
        value = f"self.{field_name(path)}" if optional else f"Some(self.{field_name(path)})"
        # rustfmt keeps the tuple inline while its arguments fit `fn_call_width` (60).
        if len(f'"{path}", {value}') <= 60:
            w(f'            ("{path}", {value}),')
        else:
            # rustfmt's own layout for a tuple that does not fit on one line.
            w("            (")
            w(f'                "{path}",')
            w(f"                {value},")
            w("            ),")
    w("        ]")
    w("    }")
    w("}")

    manifest = load_icons_manifest()
    w("")
    w("/// Every MUI icon the web client imports, named as the web names it.")
    w("#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]")
    w("pub enum Icon {")
    for name in manifest.values():
        w(f"    {name},")
    w("}")
    w("")
    w("impl Icon {")
    w("    /// Every icon, in enum order.")
    w("    pub const ALL: &'static [Icon] = &[")
    for name in manifest.values():
        w(f"        Icon::{name},")
    w("    ];")
    w("")
    w("    /// The SVG's path inside the crate's `assets` directory.")
    w("    pub fn asset_path(self) -> &'static str {")
    w("        match self {")
    for file, name in manifest.items():
        w(f'            Icon::{name} => "icons/{file}",')
    w("        }")
    w("    }")
    w("")
    w("    /// The SVG bytes (`assets/icons/<snake_case>.svg`), compiled in.")
    w("    pub fn svg(self) -> &'static [u8] {")
    w("        match self {")
    for file, name in manifest.items():
        arm = f'Icon::{name} => include_bytes!("../assets/icons/{file}"),'
        if len("            " + arm) <= 100:
            w(f"            {arm}")
        else:
            # rustfmt's layout for an arm that does not fit on one line (no trailing comma).
            w(f"            Icon::{name} => {{")
            w(f'                include_bytes!("../assets/icons/{file}")')
            w("            }")
    w("        }")
    w("    }")
    w("}")
    w("")
    return "\n".join(out)


def render_type_scale(data: dict) -> str:
    html_font_size = data["HTML_FONT_SIZE"]
    out = [
        "// @generated by tools/gen-design/gen_design.py from the web client's theme.",
        "// Do not edit: change frontend/src/theme and run native/scripts/gen-design.sh.",
        "",
        "//! Named font sizes from the web's `TYPE_SCALE`, in px.",
        "//!",
        f"//! The web stores them in rem against a {html_font_size}px root.",
    ]
    for name, rem in data["TYPE_SCALE"].items():
        out.append("")
        out.append(f"/// `{name}`, {rem} at a {html_font_size}px root.")
        out.append(f"pub const SIZE_{name.upper()}: f32 = {px(rem, html_font_size)};")
    out.append("")
    return "\n".join(out)


def load_icons_manifest() -> dict[str, str]:
    manifest_path = ICON_EXPORT / "manifest.json"
    if not manifest_path.is_file():
        raise SystemExit(f"gen-design: no {manifest_path}; run scripts/export-web.sh icons")
    manifest: dict[str, str] = json.loads(manifest_path.read_text())
    for file, name in manifest.items():
        source = ICON_EXPORT / "icons" / file
        if not source.is_file():
            raise SystemExit(f"gen-design: no {source}")
        if not source.read_text().startswith("<svg"):
            raise SystemExit(f"gen-design: {source} does not begin with <svg")
        if not re.fullmatch(r"[A-Z][A-Za-z0-9]*", name):
            raise SystemExit(f"gen-design: {file}: {name!r} is not a PascalCase icon name")
    if len(manifest) == 0:
        raise SystemExit("gen-design: the icon manifest is empty")
    return dict(sorted(manifest.items()))


def expected_files(data: dict, themes: dict[str, Theme], accents: list[str], order: list[str]) -> dict[Path, bytes]:
    files: dict[Path, bytes] = {}
    files[CRATE / "data" / "tokens.json"] = THEME_EXPORT.read_bytes()
    manifest = load_icons_manifest()
    for file in manifest:
        files[CRATE / "assets" / "icons" / file] = (ICON_EXPORT / "icons" / file).read_bytes()
    files[CRATE / "assets" / "icons" / "manifest.json"] = (ICON_EXPORT / "manifest.json").read_bytes()
    files[CRATE / "src" / "generated.rs"] = render_generated(data, themes, accents, order).encode()
    files[CRATE / "src" / "type_scale.rs"] = render_type_scale(data).encode()
    return files


def main(argv: list[str]) -> int:
    check = argv[1:] == ["--check"]
    if argv[1:] not in ([], ["--check"]):
        raise SystemExit("usage: gen_design.py [--check]")

    data, themes = load_themes()
    accents, order = theme_grid(themes)
    files = expected_files(data, themes, accents, order)

    if check:
        differing = [
            str(path.relative_to(NATIVE))
            for path, content in files.items()
            if not path.is_file() or path.read_bytes() != content
        ]
        icons_dir = CRATE / "assets" / "icons"
        known = {path for path in files if path.parent == icons_dir}
        stale = sorted(path.name for path in icons_dir.glob("*.svg") if path not in known) if icons_dir.is_dir() else []
        if differing or stale:
            for path in differing:
                print(f"gen-design: differs: {path}", file=sys.stderr)
            for name in stale:
                print(f"gen-design: stale: assets/icons/{name}", file=sys.stderr)
            print("gen-design: run native/scripts/gen-design.sh", file=sys.stderr)
            return 1
        print(f"gen-design: up to date ({len(files)} files)")
        return 0

    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    icons_dir = CRATE / "assets" / "icons"
    for path in icons_dir.glob("*.svg"):
        if path not in files:
            path.unlink()
    print(f"gen-design: wrote {len(files)} files ({len(themes)} themes, {len(load_icons_manifest())} icons)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
