import Fade from '@mui/material/Fade';
import type { CSSObject } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import type { LoungeTheme } from '../theme/createLoungeTheme';
import { interactiveStates } from '../theme/states';
import { mix } from '../theme/mix';
import { shadow } from '../theme/shadow';

/**
 * The look every floating panel shares (a menu, a popover, a select's list):
 * the surface colour, a hairline edge, the card radius and the overlay shadow.
 * MUI's own paper tint (`backgroundImage`) is cleared.
 */
export function overlaySurface(lounge: LoungeTheme): CSSObject {
  const { palette } = lounge;
  return {
    background: palette.surface,
    backgroundImage: 'none',
    border: `${lounge.tokens.border.hairline}px solid ${palette.hairline}`,
    borderRadius: `${lounge.tokens.radius.card}px`,
    boxShadow: shadow(lounge, 'overlay'),
  };
}

/**
 * One row of a menu or a select list, for a styled MUI `MenuItem`. A
 * `.label` child takes the spare width and truncates.
 */
export function menuItemStyle(lounge: LoungeTheme): CSSObject {
  const { palette } = lounge;
  const states = interactiveStates({
    palette,
    under: palette.surface,
    hover: tokens.state.hover,
    pressed: tokens.state.pressed,
  });
  return {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: `${tokens.space.sm}px`,
    // MUI's MenuItem resets min-height (and sets its own padding) in a
    // `min-width: sm` media rule that ties with a plain declaration on specificity
    // and comes later. Doubling the class makes the row height hold at every width.
    '&&': {
      minHeight: `${tokens.control.md}px`,
      padding: `0 ${tokens.space.md}px`,
    },
    borderRadius: `${tokens.radius.md}px`,
    background: 'transparent',
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
    color: palette.text,
    ...states,
    // MUI tints a selected item (and its hover, and focus-visible) with the
    // primary colour. Selected reads as the accent label and a Check, so the
    // tint is cleared; the rules below are the kit's own hover and focus
    // states, and they match MUI's specificity so they win.
    '&.Mui-selected, &.Mui-selected:hover': { background: 'transparent', color: palette.accentText },
    '@media (hover: hover)': {
      ...states['@media (hover: hover)'],
      '&.Mui-selected:hover': { background: mix(palette.text, palette.surface, tokens.state.hover) },
    },
    '&.Mui-focusVisible, &.Mui-selected.Mui-focusVisible': {
      background: mix(palette.text, palette.surface, tokens.state.pressed),
    },
    '&.Mui-disabled': { opacity: tokens.state.disabled },
    '& > .label': { flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  };
}

/** The gap between an anchor and the panel that opens from it. */
export const ANCHOR_GAP = tokens.space.xs;

/**
 * A plain fade at the fast timing instead of MUI's Grow (which scales the
 * panel). Spread into a Menu, Popover or Dialog.
 */
export const fadeTransition = {
  slots: { transition: Fade },
} as const;

/** Motion is off when the user asks for less: a style to merge into whatever fades. */
export const reducedMotion: CSSObject = {
  '@media (prefers-reduced-motion: reduce)': { transition: 'none !important' },
};

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

/** Where a panel attaches to its anchor, as MUI Popover origins. */
export function placementOrigins(placement: Placement) {
  const [side, align] = placement.split('-') as ['bottom' | 'top', 'start' | 'end'];
  const horizontal = align === 'start' ? 'left' : 'right';
  return {
    anchorOrigin: { vertical: side, horizontal },
    transformOrigin: { vertical: side === 'bottom' ? 'top' : 'bottom', horizontal },
  } as const;
}
