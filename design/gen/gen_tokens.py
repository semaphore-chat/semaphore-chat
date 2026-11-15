#!/usr/bin/env python3
"""Generate the design token outputs from `design/tokens.json` and `design/colour.json`.

`design/tokens.json` is the single source of truth for spacing, radii,
control sizes, fonts, text styles, shadows, motion, breakpoints, layout, icon
sizes, border widths and state alphas; `design/colour.json` holds the
parameters of the palette derivation. This program validates both and renders
every registered output. Generated files are never edited by hand: fix the
source or the renderer and re-run

    python3 design/gen/gen_tokens.py

Only the Python standard library is used, so the staleness check needs no
install step.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Callable, NoReturn

# `colour_ref` lives beside this script, and the tests import from that folder too.
# It is imported inside `colour_vectors`, not here: importing it parses
# `design/colour.json`, so a broken parameter file has to reach `main` as one
# `error:` line instead of a traceback at module load.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# `gen_error` lives beside this script too; `gen_icons` raises the same class.
from gen_error import TokenError  # noqa: E402  (after the path fix above)

# The role names and the order every renderer emits them in. A copy of
# `colour_ref.ROLES`, which cannot be imported above; the tests pin them equal.
ROLES = [
    "ground",
    "surface",
    "fill",
    "hairline",
    "text",
    "textSecondary",
    "textDim",
    "accent",
    "onAccent",
    "accentText",
    "focus",
    "positive",
    "warning",
    "danger",
    "onDanger",
    "scrim",
]

ROOT = Path(__file__).resolve().parents[2]
# Relative to the repo root, so `run` can read it below any checkout.
SOURCE = Path("design") / "tokens.json"
COLOUR_SOURCE = Path("design") / "colour.json"

# Source order is the order the renderers emit.
GROUPS = (
    "space",
    "radius",
    "control",
    "font",
    "text",
    "shadow",
    "motion",
    "breakpoint",
    "layout",
    "icon",
    "border",
    "state",
)
SCALAR_GROUPS = (
    "space",
    "radius",
    "control",
    "motion",
    "breakpoint",
    "layout",
    "icon",
    "border",
    "state",
)
TEXT_FIELDS = ("font", "size", "line", "weight")
SHADOW_FIELDS = ("x", "y", "blur", "alpha", "alphaLight")
WEIGHTS = (400, 500, 600, 700)
# Motion is written to Rust as `u32` milliseconds.
MOTION_MAX = 2**32 - 1
KEY = re.compile(r"[a-z0-9][A-Za-z0-9]*")

# `design/colour.json`: the derivation parameters. `ROLES` order is the order
# every renderer emits the palette in.
COLOUR_FIELDS = (
    "chromaReference",
    "intensity",
    "accentTextContrast",
    "ink",
    "paper",
    "status",
    "modes",
)
COLOUR_INTENSITIES = ("minimal", "balanced", "vibrant")
COLOUR_STATUS = ("positive", "warning", "danger")
COLOUR_MODES = ("dark", "light")
COLOUR_MODE_ROLES = (
    "ground",
    "surface",
    "fill",
    "hairline",
    "text",
    "textSecondary",
    "textDim",
)
COLOUR_MODE_FIELDS = COLOUR_MODE_ROLES + ("accentL", "scrim")
COLOUR_HEX = re.compile(r"#[0-9a-fA-F]{6}")
# OKLab lightness and chroma bounds for a `[L, C]` pair.
LIGHTNESS_MAX = 1
CHROMA_MAX = 0.4

USAGE = "usage: gen_tokens.py [--check]"

# Output path relative to the repo root -> renderer taking the loaded source
# documents (`{"tokens": ..., "colour": ..., "icons": ...}`).
# The TypeScript and Rust renderers register themselves here; `run` merges in
# the icon set's outputs, whose paths depend on the loaded icons.
OUTPUTS: dict[Path, Callable[[dict], str]] = {}


def _icons_module() -> ModuleType:
    """The icon renderer, imported when `run` needs it rather than at module load."""
    import gen_icons

    return gen_icons


def _fail(path: str, message: str) -> NoReturn:
    raise TokenError(f"{path}: {message}")


def _mapping(path: str, value: object) -> dict:
    if not isinstance(value, dict):
        _fail(path, f"expected an object, got {value!r}")
    return value


def _key(path: str, key: object) -> None:
    if not isinstance(key, str) or not KEY.fullmatch(key):
        _fail(path, f"expected a name matching [a-z0-9][A-Za-z0-9]*, got {key!r}")


def _number(
    path: str,
    value: object,
    *,
    signed: bool = False,
    maximum: float | None = None,
    integer: bool = False,
) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(path, f"expected a number, got {value!r}")
    if not math.isfinite(value):
        _fail(path, f"expected a finite number, got {value!r}")
    # An int is whole by definition; only a float can carry a fraction.
    if integer and isinstance(value, float) and not value.is_integer():
        _fail(path, f"expected a whole number, got {value!r}")
    if not signed and value < 0:
        _fail(path, f"expected a non-negative number, got {value!r}")
    if maximum is not None and value > maximum:
        _fail(path, f"expected a number from 0 to {fmt_num(maximum)}, got {value!r}")


def _positive(path: str, value: object) -> None:
    _number(path, value)
    if value == 0:
        _fail(path, f"expected a positive number, got {value!r}")


def _hex_colour(path: str, value: object) -> None:
    if not isinstance(value, str) or not COLOUR_HEX.fullmatch(value):
        _fail(path, f"expected #rrggbb, got {value!r}")


def _numbers(path: str, value: object, maxima: tuple[float, ...]) -> None:
    """A fixed-length list of numbers, each from 0 to its maximum."""
    if not isinstance(value, list) or len(value) != len(maxima):
        _fail(path, f"expected a list of {len(maxima)} numbers, got {value!r}")
    for index, (item, maximum) in enumerate(zip(value, maxima)):
        _number(f"{path}[{index}]", item, maximum=maximum)


def _exact(path: str, value: object, expected: tuple[str, ...]) -> dict:
    """A mapping with exactly `expected` as its keys; name the key that is wrong."""
    value = _mapping(path, value)
    for key in value:
        if key not in expected:
            _fail(f"{path}.{key}", "unknown entry")
    for key in expected:
        if key not in value:
            _fail(f"{path}.{key}", "missing")
    return value


def _colour_mode(path: str, mode: object) -> None:
    mode = _exact(path, mode, COLOUR_MODE_FIELDS)
    for role in COLOUR_MODE_ROLES:
        _numbers(f"{path}.{role}", mode[role], (LIGHTNESS_MAX, CHROMA_MAX))
    accent = mode["accentL"]
    _numbers(f"{path}.accentL", accent, (LIGHTNESS_MAX, LIGHTNESS_MAX))
    if accent[0] >= accent[1]:
        _fail(f"{path}.accentL", f"expected lo < hi, got {accent!r}")
    _numbers(f"{path}.scrim", mode["scrim"], (LIGHTNESS_MAX, CHROMA_MAX, 1))


def validate_colour(data: object) -> dict:
    """Check the parsed colour parameters against the schema and return them unchanged."""
    data = _exact("colour", data, COLOUR_FIELDS)
    _positive("colour.chromaReference", data["chromaReference"])
    _positive("colour.accentTextContrast", data["accentTextContrast"])
    _numbers("colour.ink", data["ink"], (LIGHTNESS_MAX, CHROMA_MAX))
    _numbers("colour.paper", data["paper"], (LIGHTNESS_MAX, CHROMA_MAX))
    intensity = _exact("colour.intensity", data["intensity"], COLOUR_INTENSITIES)
    for name in COLOUR_INTENSITIES:
        _positive(f"colour.intensity.{name}", intensity[name])
    status = _exact("colour.status", data["status"], COLOUR_STATUS)
    for name in COLOUR_STATUS:
        _hex_colour(f"colour.status.{name}", status[name])
    modes = _exact("colour.modes", data["modes"], COLOUR_MODES)
    for name in COLOUR_MODES:
        _colour_mode(f"colour.modes.{name}", modes[name])
    return data


def _fields(path: str, value: object, expected: tuple[str, ...]) -> dict:
    value = _mapping(path, value)
    if set(value) != set(expected):
        found = ", ".join(sorted(value)) or "nothing"
        _fail(path, f"expected exactly {', '.join(expected)}, got {found}")
    return value


def _scalar_group(name: str, group: object) -> None:
    for key, value in _mapping(name, group).items():
        path = f"{name}.{key}"
        _key(path, key)
        if name == "motion":
            _number(path, value, maximum=MOTION_MAX, integer=True)
        elif name == "state":
            # A state layer is an alpha, from clear to solid.
            _number(path, value, maximum=1)
        else:
            _number(path, value)


def _font_group(group: object) -> None:
    for key, value in _mapping("font", group).items():
        path = f"font.{key}"
        _key(path, key)
        if not isinstance(value, str) or not value.strip():
            _fail(path, f"expected a non-empty font name, got {value!r}")
        # Both renderers write the family into a string literal.
        if any(
            ch in '"\\' or ord(ch) < 0x20 or 0x7F <= ord(ch) <= 0x9F for ch in value
        ):
            _fail(
                path,
                "expected a font name without control characters, double quotes or "
                f"backslashes, got {value!r}",
            )


def _text_group(group: object, fonts: dict) -> None:
    for key, style in _mapping("text", group).items():
        path = f"text.{key}"
        _key(path, key)
        style = _fields(path, style, TEXT_FIELDS)
        font = style["font"]
        if not isinstance(font, str) or font not in fonts:
            _fail(f"{path}.font", f"unknown font {font!r}")
        for field in ("size", "line"):
            _number(f"{path}.{field}", style[field])
        weight = style["weight"]
        if isinstance(weight, bool) or weight not in WEIGHTS:
            allowed = ", ".join(str(weight) for weight in WEIGHTS)
            _fail(f"{path}.weight", f"expected one of {allowed}, got {style['weight']!r}")


def _shadow_group(group: object) -> None:
    for key, shadow in _mapping("shadow", group).items():
        path = f"shadow.{key}"
        _key(path, key)
        shadow = _fields(path, shadow, SHADOW_FIELDS)
        # A shadow may be offset in any direction; blur and alpha stay bounded.
        for field in ("x", "y"):
            _number(f"{path}.{field}", shadow[field], signed=True)
        _number(f"{path}.blur", shadow["blur"])
        _number(f"{path}.alpha", shadow["alpha"], maximum=1)
        _number(f"{path}.alphaLight", shadow["alphaLight"], maximum=1)


def validate(data: object) -> dict:
    """Check the parsed source against the schema and return it unchanged."""
    data = _mapping("design/tokens.json", data)
    for name in data:
        if name not in GROUPS:
            _fail(str(name), "unknown group")
    for name in GROUPS:
        if name not in data:
            _fail(name, "missing group")
    for name in GROUPS:
        group = data[name]
        if name in SCALAR_GROUPS:
            _scalar_group(name, group)
        elif name == "font":
            _font_group(group)
        elif name == "text":
            _text_group(group, data["font"])
        else:
            _shadow_group(group)
    return data


class _Object(dict):
    """A parsed JSON object that remembers the keys it repeated."""

    repeated: list


def _object(pairs: list[tuple[str, object]]) -> dict:
    """`object_pairs_hook`: a repeated key would silently keep only the last value."""
    result = _Object()
    result.repeated = []
    for key, value in pairs:
        if key in result:
            result.repeated.append(key)
        result[key] = value
    return result


def _reject_duplicates(value: object, path: str = "") -> None:
    """Raise for the first repeated key, naming its dotted path."""
    if not isinstance(value, _Object):
        return
    for key in value.repeated:
        _fail(f"{path}{key}", "duplicate key")
    for key, child in value.items():
        _reject_duplicates(child, f"{path}{key}.")


def _read_json(path: Path) -> object:
    """Read and parse one JSON document; a repeated key is an error."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as error:
        raise TokenError(f"{path}: cannot read: {error.strerror}") from error
    try:
        data = json.loads(text, object_pairs_hook=_object)
    except json.JSONDecodeError as error:
        raise TokenError(
            f"{path}:{error.lineno}:{error.colno}: invalid JSON: {error.msg}"
        ) from error
    _reject_duplicates(data)
    return data


def load(path: Path) -> dict:
    """Parse and validate `design/tokens.json`; raise `TokenError` when it is wrong."""
    return validate(_read_json(path))


def load_colour(path: Path) -> dict:
    """Parse and validate `design/colour.json`; raise `TokenError` when it is wrong."""
    return validate_colour(_read_json(path))


def fmt_num(value: int | float) -> str:
    """`16`, `16.0` -> `"16"`; `0.35` -> `"0.35"` (shortest round-trip repr)."""
    if isinstance(value, int):
        return str(value)
    return str(int(value)) if value.is_integer() else repr(value)


TS_OUTPUT = Path("frontend/src/theme/generated/tokens.ts")
TS_HEADER = (
    "// @generated by design/gen/gen_tokens.py from design/tokens.json.\n"
    "// Do not edit by hand: change the source or the generator and re-run it."
)
TS_IDENTIFIER = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")


def _ts_key(key: str) -> str:
    """Quote keys that are not JavaScript identifiers (`2xs`, `2xl`)."""
    return key if TS_IDENTIFIER.fullmatch(key) else _ts_string(key)


def _ts_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _ts_scalar(value: object) -> str:
    return _ts_string(value) if isinstance(value, str) else fmt_num(value)


def _ts_text_style(style: dict, fonts: dict) -> str:
    """One line, with the font key resolved to the family name."""
    fields = (
        f"family: {_ts_string(fonts[style['font']])}",
        f"size: {fmt_num(style['size'])}",
        f"line: {fmt_num(style['line'])}",
        f"weight: {fmt_num(style['weight'])}",
    )
    return "{ " + ", ".join(fields) + " }"


def _ts_shadow_css(shadow: dict, alpha_field: str = "alpha") -> str:
    """The equivalent CSS `box-shadow` value (zero lengths carry no unit)."""
    lengths = " ".join(
        "0" if shadow[field] == 0 else f"{fmt_num(shadow[field])}px"
        for field in ("x", "y", "blur")
    )
    return f"{lengths} rgba(0, 0, 0, {fmt_num(shadow[alpha_field])})"


def _ts_group_lines(name: str, group: dict, fonts: dict) -> list[str]:
    """Entries of one token group at one level of nesting, trailing comma included."""
    if name == "shadow":
        lines = []
        for key, shadow in group.items():
            lines.append(f"    {_ts_key(key)}: {{")
            for field in SHADOW_FIELDS:
                lines.append(f"      {field}: {fmt_num(shadow[field])},")
            lines.append(f"      css: {_ts_string(_ts_shadow_css(shadow))},")
            lines.append(f"      cssLight: {_ts_string(_ts_shadow_css(shadow, 'alphaLight'))},")
            lines.append("    },")
        return lines
    lines = []
    for key, value in group.items():
        if name == "text":
            value = _ts_text_style(value, fonts)
        else:
            value = _ts_scalar(value)
        lines.append(f"    {_ts_key(key)}: {value},")
    return lines


def render_ts(tokens: dict) -> str:
    """Render the web client's token module: two-space indent, single quotes."""
    lines = [TS_HEADER, "", "export const tokens = {"]
    for name in GROUPS:
        lines.append(f"  {name}: {{")
        lines.extend(_ts_group_lines(name, tokens[name], tokens["font"]))
        lines.append("  },")
    lines.extend(
        [
            "} as const;",
            "",
            "export type Tokens = typeof tokens;",
            "export type TextStyleName = keyof typeof tokens.text;",
        ]
    )
    return "\n".join(lines) + "\n"


OUTPUTS[TS_OUTPUT] = lambda sources: render_ts(sources["tokens"])

RS_OUTPUT = Path("native/crates/semaphore-design/src/lounge.rs")
RS_HEADER = (
    "// @generated by design/gen/gen_tokens.py from design/tokens.json.\n"
    "// Do not edit by hand: change the source or the generator and re-run it."
)
# The unit each group's constants carry, for the doc comment.
RS_UNITS = {
    "space": "px",
    "radius": "px",
    "control": "px",
    "font": "font family",
    "text": "px size and line height, font weight",
    "shadow": "px offsets and blur, alpha of black",
    "motion": "ms",
    "breakpoint": "px",
    "layout": "px",
    "icon": "px",
    "border": "px",
    "state": "alpha, 0 to 1",
}
RS_STRUCTS = """\
/// A text style: the resolved font family, px size and line height, and weight.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextStyle {
    pub family: &'static str,
    pub size: f32,
    pub line_height: f32,
    pub weight: u16,
}

/// A black shadow: px offsets and blur, and an alpha from 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Shadow {
    pub x: f32,
    pub y: f32,
    pub blur: f32,
    pub alpha: f32,
    /// The alpha in light mode, where the same shadow is far less opaque.
    pub alpha_light: f32,
}"""


def _rs_float(value: int | float) -> str:
    """An `f32` literal: `fmt_num` drops the point after an integer, Rust requires it."""
    text = fmt_num(value)
    return text if "." in text or "e" in text else text + ".0"


def _rs_name(group: str, key: str) -> str:
    """`text.bodyStrong` -> `TEXT_BODY_STRONG`; motion carries its unit in the name."""
    name = re.sub(r"(?<!^)(?=[A-Z])", "_", key).upper()
    suffix = "_MS" if group == "motion" else ""
    return f"{group.upper()}_{name}{suffix}"


def _rs_group_lines(name: str, group: dict, fonts: dict) -> list[str]:
    """One group's constants, each with a doc comment and followed by a blank line."""
    lines = []
    for key, value in group.items():
        ident = _rs_name(name, key)
        doc = f"/// `{name}.{key}`, {RS_UNITS[name]}."
        if name == "font":
            lines += [doc, f'pub const {ident}: &str = "{value}";']
        elif name == "text":
            lines += [doc, f"pub const {ident}: TextStyle = TextStyle {{"]
            lines += [
                f'    family: "{fonts[value["font"]]}",',
                f"    size: {_rs_float(value['size'])},",
                f"    line_height: {_rs_float(value['line'])},",
                f"    weight: {fmt_num(value['weight'])},",
                "};",
            ]
        elif name == "shadow":
            lines += [doc, f"pub const {ident}: Shadow = Shadow {{"]
            lines += [
                f"    {'alpha_light' if field == 'alphaLight' else field}: {_rs_float(value[field])},"
                for field in SHADOW_FIELDS
            ]
            lines += ["};"]
        elif name == "motion":
            lines += [doc, f"pub const {ident}: u32 = {fmt_num(value)};"]
        else:
            lines += [doc, f"pub const {ident}: f32 = {_rs_float(value)};"]
        lines.append("")
    return lines


def render_rs(tokens: dict) -> str:
    """Render the Rust client's token module: four-space indent, `f32` literals."""
    lines = [
        RS_HEADER,
        "",
        "//! The design tokens, generated for the Rust client.",
        "//!",
        "//! Text styles resolve their font key to the family name; shadows are black with an",
        "//! alpha from 0 to 1.",
        "",
        RS_STRUCTS,
        "",
    ]
    for name in GROUPS:
        lines.extend(_rs_group_lines(name, tokens[name], tokens["font"]))
    return "\n".join(lines).rstrip("\n") + "\n"


OUTPUTS[RS_OUTPUT] = lambda sources: render_rs(sources["tokens"])


COLOUR_VECTORS_OUTPUT = Path("design") / "vectors" / "colour.json"
COLOUR_TS_OUTPUT = Path("frontend/src/theme/generated/colourVectors.ts")
COLOUR_PARAMS_OUTPUT = Path("frontend/src/theme/generated/colourParams.ts")
COLOUR_HEADER = (
    "// @generated by design/gen/gen_tokens.py from design/colour.json.\n"
    "// Do not edit by hand: change the source or the generator and re-run it."
)
# The vectors keep the base as written; the ports accept either hex case.
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


def colour_vectors(sources: dict) -> list[dict]:
    """Every base x mode x intensity, in that nesting order, with its derived palette.

    The palette comes from `colour_ref.derive`, the definition of the algorithm;
    `run` validates the same `design/colour.json` the reference reads.
    """
    # Imported here, not at module load: `colour_ref` parses `design/colour.json`
    # on import, and `run` has validated that file before any renderer runs.
    import colour_ref

    vectors = []
    for base in VECTOR_BASES:
        for mode in COLOUR_MODES:
            for intensity in COLOUR_INTENSITIES:
                palette = colour_ref.derive(base, mode, intensity)
                vectors.append(
                    {
                        "base": base,
                        "mode": mode,
                        "intensity": intensity,
                        "roles": {role: palette[role] for role in ROLES},
                    }
                )
    return vectors


def render_colour_vectors(sources: dict) -> str:
    """Render the shared vectors as JSON: two-space indent, `roles` in ROLES order."""
    return json.dumps(colour_vectors(sources), indent=2) + "\n"


def render_colour_vectors_ts(sources: dict) -> str:
    """Render the same vectors for the web client: single quotes, `as const`."""
    lines = [COLOUR_HEADER, "", "export const colourVectors = ["]
    for vector in colour_vectors(sources):
        lines.append("  {")
        lines.append(f"    base: {_ts_string(vector['base'])},")
        lines.append(f"    mode: {_ts_string(vector['mode'])},")
        lines.append(f"    intensity: {_ts_string(vector['intensity'])},")
        lines.append("    roles: {")
        for role, value in vector["roles"].items():
            lines.append(f"      {role}: {_ts_string(value)},")
        lines.append("    },")
        lines.append("  },")
    lines.append("] as const;")
    return "\n".join(lines) + "\n"


OUTPUTS[COLOUR_VECTORS_OUTPUT] = render_colour_vectors
OUTPUTS[COLOUR_TS_OUTPUT] = render_colour_vectors_ts


def _number_list(values: list[int | float]) -> str:
    """A tuple literal: `[0.183, 0.004]`."""
    return "[" + ", ".join(fmt_num(value) for value in values) + "]"


def _rs_number_list(values: list[int | float]) -> str:
    """An `[f64; N]` literal: every element a float, `[0.2, 0.0]`."""
    return "[" + ", ".join(_rs_float(value) for value in values) + "]"


def render_colour_params_ts(sources: dict) -> str:
    """Render the derivation parameters for the web client: tuples, `as const`."""
    colour = sources["colour"]
    lines = [COLOUR_HEADER, "", "export const colourRoles = ["]
    lines.extend(f"  {_ts_string(role)}," for role in ROLES)
    lines.extend(["] as const;", ""])
    lines.append(
        "export const colourModes = [" + ", ".join(_ts_string(m) for m in COLOUR_MODES) + "] as const;"
    )
    lines.append(
        "export const colourIntensities = ["
        + ", ".join(_ts_string(i) for i in COLOUR_INTENSITIES)
        + "] as const;"
    )
    lines.extend(["", "export const colourParams = {"])
    lines.append(f"  chromaReference: {fmt_num(colour['chromaReference'])},")
    lines.append("  intensity: {")
    lines.extend(
        f"    {name}: {fmt_num(colour['intensity'][name])}," for name in COLOUR_INTENSITIES
    )
    lines.append("  },")
    lines.append(f"  accentTextContrast: {fmt_num(colour['accentTextContrast'])},")
    for name in ("ink", "paper"):
        lines.append(f"  {name}: {_number_list(colour[name])},")
    lines.append("  status: {")
    lines.extend(
        f"    {name}: {_ts_string(colour['status'][name])}," for name in COLOUR_STATUS
    )
    lines.append("  },")
    lines.append("  modes: {")
    for mode in COLOUR_MODES:
        lines.append(f"    {mode}: {{")
        lines.extend(
            f"      {field}: {_number_list(colour['modes'][mode][field])},"
            for field in COLOUR_MODE_FIELDS
        )
        lines.append("    },")
    lines.append("  },")
    lines.append("} as const;")
    return "\n".join(lines) + "\n"


OUTPUTS[COLOUR_PARAMS_OUTPUT] = render_colour_params_ts

COLOUR_RS_PARAMS_OUTPUT = Path("native/crates/semaphore-design/src/colour_params.rs")
COLOUR_RS_VECTORS_OUTPUT = Path("native/crates/semaphore-design/src/colour_vectors.rs")
RS_MODE_VARIANTS = {"dark": "Dark", "light": "Light"}
RS_INTENSITY_VARIANTS = {"minimal": "Minimal", "balanced": "Balanced", "vibrant": "Vibrant"}
# Rust field -> source field, with the doc comment the struct carries.
RS_MODE_PARAMS = (
    ("ground", "ground", "The window background: OKLab lightness and chroma."),
    ("surface", "surface", "Islands and panels."),
    ("fill", "fill", "Cards, fields and hover."),
    ("hairline", "hairline", "Borders and dividers."),
    ("text", "text", "Primary text."),
    ("text_secondary", "textSecondary", "Secondary text."),
    ("text_dim", "textDim", "Dim text."),
    ("accent_l", "accentL", "The accent's allowed lightness range, low to high."),
    ("scrim", "scrim", "Scrim OKLab lightness and chroma, and its alpha."),
)


def _rs_rgb(value: str) -> str:
    """`#RRGGBB` -> `0xrrggbb`, the `STATUS` form."""
    return f"0x{int(value[1:], 16):06x}"


def _rs_rgba(value: str) -> str:
    """`#rrggbb` -> `0xrrggbbff`; `#rrggbbaa` -> `0xrrggbbaa`, the vector form."""
    digits = value[1:]
    if len(digits) == 6:
        digits += "ff"
    return "0x" + digits.lower()


def render_colour_params_rs(sources: dict) -> str:
    """Render the derivation parameters for the Rust client: `f64`, `u32` hex."""
    colour = sources["colour"]
    ink = _rs_number_list(colour["ink"])
    paper = _rs_number_list(colour["paper"])
    status = ", ".join(_rs_rgb(colour["status"][name]) for name in COLOUR_STATUS)
    lines = [
        COLOUR_HEADER,
        "",
        "//! The palette derivation parameters, generated for the Rust client.",
        "//!",
        "//! `design/gen/colour_ref.py` holds the same numbers; `derive` reads these.",
        "",
        "/// `colour.chromaReference`: the chroma a fully saturated base is scaled to.",
        f"pub const CHROMA_REFERENCE: f64 = {_rs_float(colour['chromaReference'])};",
        "",
        "/// `colour.intensity`: minimal, balanced, vibrant.",
        "pub const INTENSITY: [f64; 3] = ["
        + ", ".join(_rs_float(colour["intensity"][name]) for name in COLOUR_INTENSITIES)
        + "];",
        "",
        "/// `colour.accentTextContrast`: the contrast accent text must reach on every surface.",
        f"pub const ACCENT_TEXT_CONTRAST: f64 = {_rs_float(colour['accentTextContrast'])};",
        "",
        "/// `colour.ink`: the OKLab lightness and chroma of the dark ink.",
        f"pub const INK: [f64; 2] = {ink};",
        "/// `colour.paper`: the OKLab lightness and chroma of the light paper.",
        f"pub const PAPER: [f64; 2] = {paper};",
        "",
        "/// `colour.status`: positive, warning and danger as `0xRRGGBB`.",
        f"pub const STATUS: [u32; 3] = [{status}];",
        "",
        "/// One mode's derivation parameters.",
        "#[derive(Debug, Clone, Copy, PartialEq)]",
        "pub struct ModeParams {",
    ]
    for field, source, doc in RS_MODE_PARAMS:
        lines.append(f"    /// `{source}`: {doc}")
        length = 3 if source == "scrim" else 2
        lines.append(f"    pub {field}: [f64; {length}],")
    lines.append("}")
    for name, constant in (("dark", "DARK"), ("light", "LIGHT")):
        mode = colour["modes"][name]
        lines.extend(
            [
                "",
                f"/// The {name} mode's parameters.",
                f"pub const {constant}: ModeParams = ModeParams {{",
            ]
        )
        lines.extend(
            f"    {field}: {_rs_number_list(mode[source])}," for field, source, _ in RS_MODE_PARAMS
        )
        lines.append("};")
    return "\n".join(lines) + "\n"


OUTPUTS[COLOUR_RS_PARAMS_OUTPUT] = render_colour_params_rs


def render_colour_vectors_rs(sources: dict) -> str:
    """Render the shared vectors for the Rust client: one `0xRRGGBBAA` row each.

    `#[rustfmt::skip]` keeps the base, mode and intensity on one line with the
    role array they belong to; rustfmt would otherwise split every row.
    """
    lines = [
        COLOUR_HEADER,
        "",
        "//! The shared palette vectors, generated from `design/colour.json`.",
        "//!",
        "//! Each row is a base, a mode, an intensity and its 16 roles in `ROLES` order.",
        "",
        "/// Every base x mode x intensity, in `design/vectors/colour.json` order.",
        "#[rustfmt::skip]",
        "pub(crate) const VECTORS: "
        "&[(&str, crate::Mode, crate::Intensity, [u32; 16])] = &[",
    ]
    for vector in colour_vectors(sources):
        lines.append(
            f'    ("{vector["base"]}", crate::Mode::{RS_MODE_VARIANTS[vector["mode"]]}, '
            f'crate::Intensity::{RS_INTENSITY_VARIANTS[vector["intensity"]]}, ['
        )
        values = [_rs_rgba(vector["roles"][role]) + "," for role in ROLES]
        for start in range(0, len(values), 8):
            lines.append("        " + " ".join(values[start : start + 8]))
        lines.append("    ]),")
    lines.append("];")
    return "\n".join(lines) + "\n"


OUTPUTS[COLOUR_RS_VECTORS_OUTPUT] = render_colour_vectors_rs


def _encoded(text: str) -> bytes:
    """UTF-8 with `\\n` line endings and exactly one trailing newline."""
    return text.replace("\r\n", "\n").encode("utf-8").rstrip(b"\r\n") + b"\n"


def run(root: Path, check: bool) -> int:
    """Render every output below `root`; with `check`, only report drift."""
    root = Path(root)
    sources = {
        "tokens": load(root / SOURCE),
        "colour": load_colour(root / COLOUR_SOURCE),
    }
    # Imported after the token and colour sources: a broken one must reach `main`
    # as one `error:` line, whatever state the icon module is in.
    icons = _icons_module()
    sources["icons"] = icons.load_icons(root)
    outputs = dict(OUTPUTS)
    outputs.update(icons.renderers(sources["icons"]))
    # Render everything first so a failing renderer leaves no half-written output.
    rendered = [
        (Path(path), _encoded(render(sources))) for path, render in sorted(outputs.items())
    ]
    problems = 0
    for path, content in rendered:
        target = root / path
        if not check:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            continue
        try:
            current = target.read_bytes()
        except FileNotFoundError:
            print(f"missing: {path.as_posix()}", file=sys.stderr)
            problems += 1
            continue
        if current != content:
            print(f"stale: {path.as_posix()}", file=sys.stderr)
            problems += 1
    # One asset per icon: a file left below the asset directory that is no longer
    # an output belongs to a removed icon, so it is stale too.
    for target in sorted(path for path in (root / icons.ASSET_ROOT).rglob("*") if path.is_file()):
        path = target.relative_to(root)
        if path in outputs:
            continue
        if check:
            print(f"stale: {path.as_posix()}", file=sys.stderr)
            problems += 1
        else:
            target.unlink()
    return 1 if problems else 0


def main(argv: list[str]) -> int:
    if argv not in ([], ["--check"]):
        print(USAGE, file=sys.stderr)
        return 2
    try:
        return run(ROOT, check=bool(argv))
    except (TokenError, OSError, OverflowError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
