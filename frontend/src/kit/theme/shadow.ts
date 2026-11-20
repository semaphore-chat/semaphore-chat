import { tokens } from '../../theme/generated/tokens';
import type { LoungeTheme } from './createLoungeTheme';

/**
 * The CSS `box-shadow` of a shadow token for the theme's mode. One alpha cannot
 * suit both: black at the dark-mode alpha is far too heavy on a light surface.
 */
export function shadow(lounge: LoungeTheme, name: keyof typeof tokens.shadow): string {
  const entry = lounge.tokens.shadow[name];
  return lounge.mode === 'light' ? entry.cssLight : entry.css;
}
