#!/usr/bin/env python3
"""Build the bundled TTFs in crates/semaphore-ui/assets/fonts from the web kit's @fontsource files.

    python3 build_fonts.py <dir with figtree/ and bricolage-grotesque/ unpacked npm packages> <out dir>

The web kit (frontend/src/kit/fonts.ts) imports @fontsource/figtree and
@fontsource/bricolage-grotesque at the versions in frontend/package.json. Each weight's CSS
covers several Unicode subsets (Figtree: latin, latin-ext; Bricolage Grotesque: latin,
latin-ext, vietnamese), and a browser loads whichever a page needs. GPUI takes one TTF per
face, so this merges each face's subsets into one file. It also rewrites the name table:
fontsource's files carry the variable font's instance names ("Figtree Light"), and GPUI
looks fonts up by family name. Needs fonttools and brotli (pip install fonttools brotli).
"""

import sys
from pathlib import Path

from fontTools.merge import Merger
from fontTools.ttLib import TTFont

FACES = {
    "Figtree-400": ("figtree", ["latin", "latin-ext"], "400-normal"),
    "Figtree-400-italic": ("figtree", ["latin", "latin-ext"], "400-italic"),
    "Figtree-500": ("figtree", ["latin", "latin-ext"], "500-normal"),
    "Figtree-600": ("figtree", ["latin", "latin-ext"], "600-normal"),
    "BricolageGrotesque-600": ("bricolage-grotesque", ["latin", "latin-ext", "vietnamese"], "600-normal"),
    "BricolageGrotesque-700": ("bricolage-grotesque", ["latin", "latin-ext", "vietnamese"], "700-normal"),
}
STYLE = {"400-normal": "Regular", "400-italic": "Italic", "500-normal": "Medium", "600-normal": "SemiBold", "700-normal": "Bold"}
FAMILY = {"figtree": "Figtree", "bricolage-grotesque": "Bricolage Grotesque"}


def main(source: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    work = out / ".work"
    work.mkdir(exist_ok=True)
    for name, (package, subsets, face) in FACES.items():
        parts = []
        for subset in subsets:
            font = TTFont(source / package / "package" / "files" / f"{package}-{subset}-{face}.woff2")
            font.flavor = None
            part = work / f"{name}-{subset}.ttf"
            font.save(part)
            parts.append(str(part))
        merged = Merger().merge(parts)
        family, style = FAMILY[package], STYLE[face]
        ribbi = style if style in ("Regular", "Italic", "Bold") else "Regular"
        names = merged["name"]
        for name_id in (1, 2, 4, 6, 16, 17):
            names.removeNames(nameID=name_id)
        for name_id, value in (
            (1, family),
            (2, ribbi),
            (4, f"{family} {style}"),
            (6, f"{family.replace(' ', '')}-{style}"),
            (16, family),
            (17, style),
        ):
            names.setName(value, name_id, 3, 1, 0x409)
        merged.save(out / f"{name}.ttf")
        print(name, len(merged.getBestCmap()), "code points")
    for part in work.iterdir():
        part.unlink()
    work.rmdir()


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
