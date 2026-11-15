import { contrastRatio, parseHex, toOklch, toRgb } from '../../theme/derive/oklch';

const TARGET = 4.5;
const STEPS = 501;
const STEP = 0.002;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** Most answers kept; the oldest goes first. A list of avatars repeats a few colours, so this is generous. */
const CACHE_LIMIT = 256;

type Result = { background: string; ink: string } | null;
const cache = new Map<string, Result>();

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function search(colour: string, inks: readonly [string, string]): Result {
  const original = parseHex(colour);
  const [first, second] = [parseHex(inks[0]), parseHex(inks[1])];
  const firstIsDarker = contrastRatio(first, [0, 0, 0]) <= contrastRatio(second, [0, 0, 0]);
  const [darker, lighter] = firstIsDarker ? [first, second] : [second, first];
  const [darkerHex, lighterHex] = firstIsDarker ? inks : [inks[1], inks[0]];
  const best = (rgb: readonly number[]) =>
    contrastRatio(darker, rgb) >= contrastRatio(lighter, rgb) ? 'darker' : 'lighter';

  const [L, C, h] = toOklch(original);
  const direction = best(original) === 'darker' ? 1 : -1;
  for (let i = 0; i < STEPS; i++) {
    const lightness = Math.min(1, Math.max(0, L + direction * STEP * i));
    const rgb = i === 0 ? original : toRgb(lightness, C, h);
    const pick = best(rgb);
    const ink = pick === 'darker' ? darker : lighter;
    if (contrastRatio(ink, rgb) >= TARGET) {
      return { background: i === 0 ? colour : hex(rgb), ink: pick === 'darker' ? darkerHex : lighterHex };
    }
    if (i > 0 && (lightness === 0 || lightness === 1)) {
      break;
    }
  }
  return null;
}

/**
 * The colour with its lightness nudged only as far as needed for one of two
 * inks to read on it at 4.5:1, plus that ink; the same search the palette
 * derivation uses for the accent. A colour that already passes comes back
 * unchanged (the original, not a round trip). The nudge goes lighter when the
 * darker ink reads better on the original, else darker, and keeps chroma and
 * hue (chroma only drops where the lightness leaves the gamut); it stops at
 * black or white. Returns `null` for anything that is not `#rrggbb`, and for
 * a colour no lightness makes readable with these inks (never a failing
 * colour). Answers are cached per colour and inks.
 */
export function readableBackground(colour: string, inks: readonly [string, string]): Result {
  if (!HEX.test(colour)) {
    return null;
  }
  const key = `${colour}|${inks[0]}|${inks[1]}`;
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }
  const result = search(colour, inks);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  cache.set(key, result);
  return result;
}
