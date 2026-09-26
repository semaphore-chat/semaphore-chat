import { decomposeColor } from '@mui/material/styles';

/**
 * `color` (any CSS colour MUI can parse, e.g. `rgba(139, 92, 246, 0.3)`)
 * composited over an opaque `surface`, as the browser paints it. Contrast
 * maths needs the painted colour, not a translucent one.
 */
export function compositeOver(color: string, surface: string): string {
  const [r, g, b, a = 1] = decomposeColor(color).values;
  const [sr, sg, sb] = decomposeColor(surface).values;
  const mix = (c: number, s: number) => Math.round(c * a + s * (1 - a));
  return `rgb(${mix(r, sr)}, ${mix(g, sg)}, ${mix(b, sb)})`;
}
