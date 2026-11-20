import type { Palette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';

/** Marks the element that wears the speaking ring (a hook for tests and browser specs, not a style). */
export const SPEAKING_ATTRIBUTE = 'data-kit-speaking';

/**
 * The speaking ring, defined once for Avatar and MediaTile: a gap in the colour of the layer behind,
 * then a ring in the positive colour. A shadow, so the box never grows.
 */
export function speakingRing(palette: Palette, behind: string): string {
  const gap = tokens.border.selected;
  return `0 0 0 ${gap}px ${behind}, 0 0 0 ${gap * 2}px ${palette.positive}`;
}
