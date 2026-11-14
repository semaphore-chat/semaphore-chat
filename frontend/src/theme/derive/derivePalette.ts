/**
 * The colour palette derivation: a direct port of `design/gen/colour_ref.py`,
 * the definition of the algorithm.
 *
 * `design/colour.json`, rendered to `colourParams.ts`, holds the parameters.
 * Decisions (gamut, contrast) are taken on the rounded 8-bit colour and on fixed
 * step grids, exactly as the reference does, so the web client, the Rust client
 * and the shared vectors cannot drift on a floating-point rounding difference.
 */

import { colourParams, colourRoles } from '../generated/colourParams';
import { contrastRatio, parseHex, toOklch, toRgb } from './oklch';

export type ModeName = 'dark' | 'light';
export type IntensityName = 'minimal' | 'balanced' | 'vibrant';
export type ColourRole = (typeof colourRoles)[number];
export type Palette = Record<ColourRole, string>;

/** The mode roles that are a `[lightness, chroma]` pair. */
type ModeRoleName =
  | 'ground'
  | 'surface'
  | 'fill'
  | 'hairline'
  | 'text'
  | 'textSecondary'
  | 'textDim';

type StatusName = 'positive' | 'warning' | 'danger';
type Rgb = [number, number, number];

/** `[r, g, b]` as `#rrggbb`, plus an optional alpha as `#rrggbbaa`. */
function hex(rgb: readonly number[], alpha?: number): string {
  const base = `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  if (alpha === undefined) {
    return base;
  }
  return base + Math.floor(alpha * 255 + 0.5).toString(16).padStart(2, '0');
}

/**
 * Move lightness in steps of 0.002 until the 8-bit colour reaches `target` on
 * every background and, when inks are given, until one of them reaches 4.5 on it.
 */
function ensure(
  L: number,
  C: number,
  h: number,
  against: readonly Rgb[],
  target: number,
  direction: number,
  inks?: readonly Rgb[],
): Rgb {
  let rgb: Rgb = [0, 0, 0];
  for (let i = 0; i < 501; i++) {
    rgb = toRgb(L + direction * 0.002 * i, C, h);
    if (
      against.every((bg) => contrastRatio(rgb, bg) >= target) &&
      (inks === undefined || inks.some((ink) => contrastRatio(ink, rgb) >= 4.5))
    ) {
      return rgb;
    }
  }
  return rgb;
}

/** The 16 roles of `base` in `mode` at `intensity`, as `#rrggbb` (scrim `#rrggbbaa`). */
export function derivePalette(
  base: string,
  mode: ModeName,
  intensity: IntensityName,
): Palette {
  const p = colourParams.modes[mode];
  const direction = mode === 'dark' ? 1 : -1;
  const [Lb, Cb, h] = toOklch(parseHex(base));
  const scale = Math.min(1, Cb / colourParams.chromaReference);
  const tint = colourParams.intensity[intensity];
  const neutral = (name: ModeRoleName, tinted: boolean): Rgb => {
    const [L, C] = p[name];
    return [L, C * scale * (tinted ? tint : 1), h];
  };

  const ground = toRgb(...neutral('ground', true));
  const surface = toRgb(...neutral('surface', true));
  const fill = toRgb(...neutral('fill', true));
  const hairline = toRgb(...neutral('hairline', true));
  const surfaces: Rgb[] = [ground, surface, fill];

  const text = ensure(...neutral('text', false), surfaces, 4.5, direction);
  const textSecondary = ensure(...neutral('textSecondary', false), surfaces, 4.5, direction);
  const textDim = ensure(...neutral('textDim', false), surfaces.slice(0, 2), 4.5, direction);

  const [lo, hi] = p.accentL;
  const accentL = Math.min(hi, Math.max(lo, Lb));
  const ink = toRgb(colourParams.ink[0], colourParams.ink[1] * scale, h);
  const paper = toRgb(colourParams.paper[0], colourParams.paper[1] * scale, h);
  const accent = ensure(accentL, Cb, h, surfaces.slice(0, 2), 3, direction, [ink, paper]);
  const focus = ensure(accentL, Cb, h, surfaces, 3, direction);
  const accentText = ensure(
    accentL,
    Cb,
    h,
    surfaces,
    colourParams.accentTextContrast,
    direction,
  );
  const onAccent = contrastRatio(ink, accent) >= contrastRatio(paper, accent) ? ink : paper;

  const status = (name: StatusName): Rgb => {
    const [Ls, Cs, hs] = toOklch(parseHex(colourParams.status[name]));
    return ensure(Ls, Cs, hs, surfaces, 4.5, direction, [ink, paper]);
  };
  const positive = status('positive');
  const warning = status('warning');
  const danger = status('danger');
  const onDanger = contrastRatio(ink, danger) >= contrastRatio(paper, danger) ? ink : paper;

  const [scrimL, scrimC, scrimAlpha] = p.scrim;
  return {
    ground: hex(ground),
    surface: hex(surface),
    fill: hex(fill),
    hairline: hex(hairline),
    text: hex(text),
    textSecondary: hex(textSecondary),
    textDim: hex(textDim),
    accent: hex(accent),
    onAccent: hex(onAccent),
    accentText: hex(accentText),
    focus: hex(focus),
    positive: hex(positive),
    warning: hex(warning),
    danger: hex(danger),
    onDanger: hex(onDanger),
    scrim: hex(toRgb(scrimL, scrimC * scale, h), scrimAlpha),
  };
}
