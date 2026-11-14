/**
 * The OKLCH colour maths behind the palette derivation: a direct port of
 * `design/gen/colour_ref.py`, the definition of the algorithm.
 *
 * The constants, the loop bounds and the rounding are the reference's, and every
 * gamut decision is taken on the rounded 8-bit colour (see `derivePalette.ts`),
 * so this port and the shared vectors cannot drift on a rounding difference.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb` (either case) to 8-bit sRGB channels; throws for anything else. */
export function parseHex(hex: string): [number, number, number] {
  if (!HEX.test(hex)) {
    throw new RangeError(`base: expected #rrggbb, got '${hex}'`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** One 8-bit sRGB channel to linear light. */
function lin(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light back to the sRGB scale, for a value in 0 to 1. */
function unlin(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** 8-bit sRGB to OKLCH: `[L, C, h]`, with the hue in radians. */
export function toOklch(rgb: readonly number[]): [number, number, number] {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
}

/** OKLCH to linear sRGB; the values may fall outside 0 to 1. */
function toLinear(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to an 8-bit sRGB colour; chroma is cut in 1% steps until it is in gamut. */
export function toRgb(L: number, C: number, h: number): [number, number, number] {
  const lightness = Math.min(1, Math.max(0, L));
  let rgb: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 101; k++) {
    rgb = toLinear(lightness, (C * (100 - k)) / 100, h);
    if (rgb.every((v) => v >= -0.0005 && v <= 1.0005)) break;
  }
  const channel = (v: number) => Math.floor(unlin(Math.min(1, Math.max(0, v))) * 255 + 0.5);
  return [channel(rgb[0]), channel(rgb[1]), channel(rgb[2])];
}

/** Relative luminance of an 8-bit sRGB colour. */
function luminance(rgb: readonly number[]): number {
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two 8-bit sRGB colours. */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
  let lighter = luminance(a);
  let darker = luminance(b);
  if (lighter < darker) {
    [lighter, darker] = [darker, lighter];
  }
  return (lighter + 0.05) / (darker + 0.05);
}
