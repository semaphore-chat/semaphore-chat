#!/usr/bin/env python3
"""List every `design-exception:` comment in the clients' source code.

A screen may use a value or a piece outside the design system if the line
carries a comment `design-exception: <reason>`. This program scans

    frontend/src/**/*.{ts,tsx,css}   (not api-client/ or __tests__/)
    native/crates/**/*.rs            (not `target` folders)

skips any file whose first line is a `// @generated` header, and writes the
exceptions it finds to `design/guide/exceptions.md`, sorted by path and line.
The page is generated: never edit it by hand. Re-run

    python3 design/gen/list_exceptions.py          # rewrite the page
    python3 design/gen/list_exceptions.py --check  # print `stale:` and exit 1 if it differs

Only the Python standard library is used, so the check needs no install step.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# Relative to the repo root, so `run` can work below any checkout.
OUTPUT = Path("design") / "guide" / "exceptions.md"

MARKER = "design-exception:"
USAGE = "usage: list_exceptions.py [--check]"

# (folder, suffixes, folders to skip, relative to the repo root)
FRONTEND = Path("frontend") / "src"
FRONTEND_SKIP = (FRONTEND / "api-client", FRONTEND / "__tests__")
NATIVE = Path("native") / "crates"

# A comment opens before the marker: `//`, `/*`, a leading `*` of a block
# comment, or `<!--`.
COMMENT_BEFORE = re.compile(r"(//|/\*|<!--|^\s*\*)")

HEADER = """\
# Design exceptions

This page lists every place where a screen leaves the design system on
purpose. A line that needs a value or a piece the system does not have may
carry a comment `design-exception: <reason>`. The comment names the reason.

An exception is not a permanent home. Each one either joins the system or is
removed, so this list is meant to stay short. How to add to the system instead
is in [Extending the system](extending.md).

This page is generated from the source code by `design/gen/list_exceptions.py`.
Do not edit it by hand: add or remove the comment in the code, then run
`python3 design/gen/list_exceptions.py`.
"""


def is_generated(text: str) -> bool:
    """True when the first line is a `// @generated` header."""
    first = text.split("\n", 1)[0].lstrip("﻿").strip()
    return first.startswith("// @generated")


def reason_of(line: str) -> str | None:
    """The reason in a `design-exception:` comment on this line, or None."""
    at = line.find(MARKER)
    if at < 0 or not COMMENT_BEFORE.search(line[:at]):
        return None
    reason = line[at + len(MARKER) :]
    # Cut the end of a block or HTML comment, and a JSX `}` after it.
    for end in ("*/", "-->"):
        reason = reason.split(end, 1)[0]
    reason = " ".join(reason.split())
    return reason or "(no reason given)"


def source_files(root: Path):
    """Every file to scan, as paths relative to the repo root."""
    frontend = root / FRONTEND
    if frontend.is_dir():
        for path in frontend.rglob("*"):
            rel = path.relative_to(root)
            if path.suffix in (".ts", ".tsx", ".css") and path.is_file():
                if not any(skip in rel.parents for skip in FRONTEND_SKIP):
                    yield rel
    native = root / NATIVE
    if native.is_dir():
        for path in native.rglob("*.rs"):
            rel = path.relative_to(root)
            if path.is_file() and "target" not in rel.parts:
                yield rel


def find_exceptions(root: Path) -> list[tuple[str, int, str]]:
    """(path, line, reason) for every exception, sorted by path then line."""
    found = []
    for rel in source_files(root):
        text = (root / rel).read_text(encoding="utf-8", errors="replace")
        if is_generated(text):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            reason = reason_of(line)
            if reason is not None:
                found.append((rel.as_posix(), number, reason))
    found.sort(key=lambda item: (item[0], item[1]))
    return found


def cell(text: str) -> str:
    """Make text safe for one table cell."""
    return text.replace("\\", "\\\\").replace("|", "\\|")


def render(found: list[tuple[str, int, str]]) -> str:
    if not found:
        return HEADER + "\nThere are no exceptions.\n"
    rows = ["", "|Where|Reason|", "|---|---|"]
    for path, number, reason in found:
        rows.append(f"|`{path}:{number}`|{cell(reason)}|")
    return HEADER + "\n".join(rows) + "\n"


def run(root: Path, check: bool) -> int:
    expected = render(find_exceptions(root))
    target = root / OUTPUT
    current = target.read_text(encoding="utf-8") if target.is_file() else None
    if current == expected:
        return 0
    if check:
        print(f"stale: {OUTPUT.as_posix()}")
        return 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(expected, encoding="utf-8")
    return 0


def main(argv: list[str]) -> int:
    if argv not in ([], ["--check"]):
        print(USAGE, file=sys.stderr)
        return 2
    try:
        return run(ROOT, check=bool(argv))
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
