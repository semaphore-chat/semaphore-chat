import type { Palette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { mix } from './mix';

export interface InteractiveStateInput {
  palette: Palette;
  /** The colour the state tint sits on: the resting fill, or the page under a transparent fill. */
  under: string;
  /** How much of the text colour is mixed in on hover. */
  hover: number;
  /** How much of the text colour is mixed in while pressed. */
  pressed: number;
}

/**
 * The pointer and keyboard states every interactive surface shares.
 *
 * Hover sits inside a `(hover: hover)` media query, so a touch tap never
 * leaves a stuck hover layer; pressed stays outside it, so a touch press still
 * shows. The focus ring uses the kit's focus role and border tokens.
 */
export function interactiveStates({ palette, under, hover, pressed }: InteractiveStateInput) {
  return {
    '@media (hover: hover)': {
      '&:hover': { background: mix(palette.text, under, hover) },
    },
    '&:active': { background: mix(palette.text, under, pressed) },
    '&:focus-visible': {
      outline: `${tokens.border.focus}px solid ${palette.focus}`,
      outlineOffset: `${tokens.border.focusOffset}px`,
    },
  };
}
