#!/usr/bin/env python3
"""Generate the design token outputs from `design/tokens.json`.

`design/tokens.json` is the single source of truth for spacing, radii,
control sizes, fonts, text styles, shadows, motion, breakpoints and layout.
This program validates it and renders every registered output. Generated
files are never edited by hand: fix the source or the renderer and re-run

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
from typing import Callable, NoReturn

ROOT = Path(__file__).resolve().parents[2]
# Relative to the repo root, so `run` can read it below any checkout.
SOURCE = Path("design") / "tokens.json"

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
)
SCALAR_GROUPS = ("space", "radius", "control", "motion", "breakpoint", "layout")
TEXT_FIELDS = ("font", "size", "line", "weight")
SHADOW_FIELDS = ("x", "y", "blur", "alpha")
WEIGHTS = (400, 500, 600, 700)
KEY = re.compile(r"[a-z0-9][A-Za-z0-9]*")

USAGE = "usage: gen_tokens.py [--check]"

# Output path relative to the repo root -> renderer taking the loaded tokens.
# The TypeScript and Rust renderers register themselves here.
OUTPUTS: dict[Path, Callable[[dict], str]] = {}


class TokenError(ValueError):
    """`design/tokens.json` does not match the schema; the message starts with the dotted path."""


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
    path: str, value: object, *, signed: bool = False, maximum: float | None = None
) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(path, f"expected a number, got {value!r}")
    if not math.isfinite(value):
        _fail(path, f"expected a finite number, got {value!r}")
    if not signed and value < 0:
        _fail(path, f"expected a non-negative number, got {value!r}")
    if maximum is not None and value > maximum:
        _fail(path, f"expected a number from 0 to {fmt_num(maximum)}, got {value!r}")


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
        _number(path, value)


def _font_group(group: object) -> None:
    for key, value in _mapping("font", group).items():
        path = f"font.{key}"
        _key(path, key)
        if not isinstance(value, str) or not value.strip():
            _fail(path, f"expected a non-empty font name, got {value!r}")


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


def load(path: Path) -> dict:
    """Parse and validate `design/tokens.json`; raise `TokenError` when it is wrong."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError as error:
        raise TokenError(f"{path}: cannot read: {error.strerror}") from error
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise TokenError(
            f"{path}:{error.lineno}:{error.colno}: invalid JSON: {error.msg}"
        ) from error
    return validate(data)


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


def _ts_shadow_css(shadow: dict) -> str:
    """The equivalent CSS `box-shadow` value (zero lengths carry no unit)."""
    lengths = " ".join(
        "0" if shadow[field] == 0 else f"{fmt_num(shadow[field])}px"
        for field in ("x", "y", "blur")
    )
    return f"{lengths} rgba(0, 0, 0, {fmt_num(shadow['alpha'])})"


def _ts_group_lines(name: str, group: dict, fonts: dict) -> list[str]:
    """Entries of one token group at one level of nesting, trailing comma included."""
    if name == "shadow":
        lines = []
        for key, shadow in group.items():
            lines.append(f"    {_ts_key(key)}: {{")
            for field in SHADOW_FIELDS:
                lines.append(f"      {field}: {fmt_num(shadow[field])},")
            lines.append(f"      css: {_ts_string(_ts_shadow_css(shadow))},")
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


OUTPUTS[TS_OUTPUT] = render_ts


def _encoded(text: str) -> bytes:
    """UTF-8 with `\\n` line endings and exactly one trailing newline."""
    return text.replace("\r\n", "\n").encode("utf-8").rstrip(b"\r\n") + b"\n"


def run(root: Path, check: bool) -> int:
    """Render every output below `root`; with `check`, only report drift."""
    root = Path(root)
    tokens = load(root / SOURCE)
    # Render everything first so a failing renderer leaves no half-written output.
    rendered = [
        (Path(path), _encoded(render(tokens))) for path, render in sorted(OUTPUTS.items())
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
    return 1 if problems else 0


def main(argv: list[str]) -> int:
    if argv not in ([], ["--check"]):
        print(USAGE, file=sys.stderr)
        return 2
    return run(ROOT, check=bool(argv))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
