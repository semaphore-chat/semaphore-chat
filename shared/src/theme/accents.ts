/**
 * The named accents, shared by the web client (the old shell's picker and
 * palette) and the backend (keeping `accentColor` consistent with `baseColor`).
 */

import { parseHex, toOklch } from './oklch';

/** The accent names, in the order the picker shows them (ties go to the earlier name). */
export const ACCENT_NAMES = [
  'teal',
  'blue',
  'indigo',
  'purple',
  'rose',
  'red',
  'orange',
  'amber',
  'lime',
  'emerald',
  'cyan',
  'slate',
] as const;

export type AccentName = (typeof ACCENT_NAMES)[number];

/** Each accent's primary colour, lowercase `#rrggbb`. */
export const ACCENT_PRIMARY: Readonly<Record<AccentName, string>> = {
  teal: '#0d9488',
  blue: '#3b82f6',
  indigo: '#6366f1',
  purple: '#8b5cf6',
  rose: '#f43f5e',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  lime: '#84cc16',
  emerald: '#10b981',
  cyan: '#06b6d4',
  slate: '#64748b',
};

/**
 * Chroma below which a base colour counts as a grey. A near-grey has no
 * meaningful hue, so it maps to `slate` whatever its lightness; slate's own
 * primary (C ≈ 0.041) is above it and still maps to itself by distance.
 */
export const LOW_CHROMA = 0.03;

/** `#rrggbb` to OKLab `[L, a, b]`; throws RangeError for anything else. */
function toOklab(hex: string): [number, number, number] {
  const [L, C, h] = toOklch(parseHex(hex));
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

// Computed on first use rather than at module load, so importing the shared
// package (which re-exports this module) stays free of side effects.
let accentLab: readonly [number, number, number][] | undefined;

function accentLabCoordinates(): readonly [number, number, number][] {
  accentLab ??= ACCENT_NAMES.map((name) => toOklab(ACCENT_PRIMARY[name]));
  return accentLab;
}

/**
 * The accent whose primary is nearest `base` in OKLab (Euclidean distance on
 * L, a, b). A base without a meaningful chroma is `slate`; ties go to the
 * earlier name in `ACCENT_NAMES`; an invalid colour throws `RangeError`.
 */
export function nearestAccent(base: string): AccentName {
  const [L, a, b] = toOklab(base);
  if (Math.hypot(a, b) < LOW_CHROMA) return 'slate';
  const accents = accentLabCoordinates();
  let nearest: AccentName = ACCENT_NAMES[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ACCENT_NAMES.length; i++) {
    const [l, aa, bb] = accents[i];
    const distance = (L - l) ** 2 + (a - aa) ** 2 + (b - bb) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = ACCENT_NAMES[i];
    }
  }
  return nearest;
}
