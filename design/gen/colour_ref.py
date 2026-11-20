"""Reference implementation of the palette derivation. The TypeScript and Rust
implementations must give the same result; design/vectors/colour.json is generated from this file.

Every decision (gamut, contrast) is taken on the rounded 8-bit colour, on fixed integer step
grids, so the three implementations cannot drift by a floating-point rounding difference.
"""
import json
import math
import re
from pathlib import Path

PARAMS = json.loads((Path(__file__).resolve().parents[1] / "colour.json").read_text(encoding="utf-8"))
ROLES = ['ground','surface','fill','hairline','text','textSecondary','textDim','accent','onAccent','accentText','focus','positive','warning','danger','onDanger','scrim']


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def unlin(v):
    return 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
def parse(h):
    if not re.fullmatch(r'#[0-9a-fA-F]{6}', h): raise ValueError(f'base: expected #rrggbb, got {h!r}')
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
def to_oklch(rgb):
    r, g, b = (lin(c) for c in rgb)
    l = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, math.hypot(a, bb), math.atan2(bb, a)
def to_linear(L, C, h):
    a, b = C * math.cos(h), C * math.sin(h)
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
def to_rgb(L, C, h):
    """OKLCH to 8-bit sRGB; chroma is cut in 1% steps until the colour is in gamut."""
    L = min(1.0, max(0.0, L))
    for k in range(101):
        rgb = to_linear(L, C * (100 - k) / 100, h)
        if all(-0.0005 <= v <= 1.0005 for v in rgb): break
    return tuple(int(math.floor(unlin(min(1.0, max(0.0, v))) * 255 + 0.5)) for v in rgb)
def luminance(rgb):
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
def contrast(x, y):
    a, b = luminance(x), luminance(y)
    if a < b: a, b = b, a
    return (a + 0.05) / (b + 0.05)
def ensure(L, C, h, against, target, direction, inks=None):
    """Move lightness in steps of 0.002 until the 8-bit colour reaches the target on every
    background and, when inks are given, until one of them reaches 4.5 on it."""
    for i in range(501):
        rgb = to_rgb(L + direction * 0.002 * i, C, h)
        if all(contrast(rgb, bg) >= target for bg in against) and (
                inks is None or any(contrast(ink, rgb) >= 4.5 for ink in inks)):
            return rgb
    return rgb
def hexs(rgb, alpha=None):
    s = '#%02x%02x%02x' % rgb
    return s if alpha is None else s + '%02x' % int(math.floor(alpha * 255 + 0.5))
def derive(base, mode, intensity):
    p = PARAMS['modes'][mode]
    direction = 1 if mode == 'dark' else -1
    Lb, Cb, h = to_oklch(parse(base))
    scale = min(1.0, Cb / PARAMS['chromaReference'])
    tint = PARAMS['intensity'][intensity]
    def neutral(name, tinted):
        L, C = p[name]
        return L, C * scale * (tint if tinted else 1.0), h
    out = {}
    for name in ('ground', 'surface', 'fill', 'hairline'):
        out[name] = to_rgb(*neutral(name, True))
    surfaces = [out['ground'], out['surface'], out['fill']]
    out['text'] = ensure(*neutral('text', False), surfaces, 4.5, direction)
    out['textSecondary'] = ensure(*neutral('textSecondary', False), surfaces, 4.5, direction)
    out['textDim'] = ensure(*neutral('textDim', False), surfaces[:2], 4.5, direction)
    lo, hi = p['accentL']
    La = min(hi, max(lo, Lb))
    ink = to_rgb(PARAMS['ink'][0], PARAMS['ink'][1] * scale, h)
    paper = to_rgb(PARAMS['paper'][0], PARAMS['paper'][1] * scale, h)
    out['accent'] = ensure(La, Cb, h, surfaces[:2], 3.0, direction, (ink, paper))
    out['focus'] = ensure(La, Cb, h, surfaces, 3.0, direction)
    out['accentText'] = ensure(La, Cb, h, surfaces, PARAMS['accentTextContrast'], direction)
    def on(bg): return ink if contrast(ink, bg) >= contrast(paper, bg) else paper
    out['onAccent'] = on(out['accent'])
    for name in ('positive', 'warning', 'danger'):
        Ls, Cs, hs = to_oklch(parse(PARAMS['status'][name]))
        out[name] = ensure(Ls, Cs, hs, surfaces, 4.5, direction, (ink, paper))
    out['onDanger'] = on(out['danger'])
    res = {k: hexs(v) for k, v in out.items()}
    L, C, a = p['scrim']
    res['scrim'] = hexs(to_rgb(L, C * scale, h), a)
    return res


# A person's avatar colour. The definition both clients port; design/vectors/person-colour.json is
# generated from it. `people.colours` is frozen (see design/colour.json).
FNV_OFFSET = 0x811C9DC5
FNV_PRIME = 0x01000193


def fnv1a32(data: bytes) -> int:
    """32-bit FNV-1a: XOR each byte in, then multiply by the prime, modulo 2**32."""
    h = FNV_OFFSET
    for b in data:
        h = ((h ^ b) * FNV_PRIME) & 0xFFFFFFFF
    return h


def person_colour(user_id):
    """`people.colours[fnv1a32(utf8(id)) mod len]`, the id used exactly as given; None for a missing
    or empty id (the avatar keeps the neutral fill)."""
    if not user_id:
        return None
    colours = PARAMS['people']['colours']
    return colours[fnv1a32(user_id.encode('utf-8')) % len(colours)]
