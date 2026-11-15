import { contrastRatio, parseHex, toOklch, toRgb } from '../../theme/derive/oklch';

const TARGET = 4.5;
const STEPS = 501;
const STEP = 0.002;
const HEX = /^#[0-9a-fA-F]{6}$/;

function hex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The colour with its lightness nudged only as far as needed for one of two
 * inks to read on it at 4.5:1, plus that ink; the same search the palette
 * derivation uses for the accent. A colour that already passes comes back
 * unchanged (the original, not a round trip). The nudge goes lighter when the
 * darker ink reads better on the original, else darker, and keeps chroma and
 * hue (chroma only drops where the lightness leaves the gamut). Returns
 * `null` for anything that is not `#rrggbb`.
 */
export function readableBackground(
  colour: string,
  inks: readonly [string, string],
): { background: string; ink: string } | null {
  if (!HEX.test(colour)) {
    return null;
  }
  const original = parseHex(colour);
  const [first, second] = inks;
  const [darker, lighter] =
    contrastRatio(parseHex(first), [0, 0, 0]) <= contrastRatio(parseHex(second), [0, 0, 0])
      ? [first, second]
      : [second, first];
  const best = (rgb: readonly number[]) =>
    contrastRatio(parseHex(darker), rgb) >= contrastRatio(parseHex(lighter), rgb) ? darker : lighter;

  const [L, C, h] = toOklch(original);
  const direction = best(original) === darker ? 1 : -1;
  for (let i = 0; i < STEPS; i++) {
    const rgb = i === 0 ? original : toRgb(L + direction * STEP * i, C, h);
    const ink = best(rgb);
    if (contrastRatio(parseHex(ink), rgb) >= TARGET) {
      return { background: i === 0 ? colour : hex(rgb), ink };
    }
  }
  return { background: colour, ink: best(original) };
}
