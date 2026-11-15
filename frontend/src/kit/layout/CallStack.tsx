import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { isPresent } from './present';

export interface CallStackProps {
  /** The call bar (the room, the mic, Leave): always whole, never shrunk, clipped or scrolled. */
  bar: ReactNode;
  /**
   * The call's video and what it offers, above the bar. It takes at most two fifths of the frame's height and
   * scrolls inside itself beyond that, so the bar and the screen's composer always keep their room.
   */
  surface?: ReactNode;
  /**
   * One line that stands in for `surface` while the on-screen keyboard is up (the frame is short then): what
   * the surface holds and a way to it. Without it the surface is left out while the keyboard is up.
   */
  summary?: ReactNode;
}

/** The frame's height (`AppFrame`: the viewport less the on-screen keyboard), as CSS. */
const FRAME = (unit: 'vh' | 'dvh') => `(100${unit} - var(--kit-keyboard-inset, 0px))`;
/** The share of the frame's height the surface may take. */
const SURFACE_SHARE = '2 / 5';

/** Set by `AppFrame` while the on-screen keyboard is up. */
const KEYBOARD_UP = '[data-keyboard] &';

const Root = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: `${tokens.space.sm}px`,
  minWidth: 0,
});

const Surface = styled('div')({
  flex: '0 1 auto',
  minWidth: 0,
  minHeight: 0,
  maxHeight: `calc(${FRAME('vh')} * ${SURFACE_SHARE})`,
  '@supports (height: 100dvh)': { maxHeight: `calc(${FRAME('dvh')} * ${SURFACE_SHARE})` },
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  // The card inside has rounded corners; the scroll keeps them.
  borderRadius: `${tokens.radius.card}px`,
  [KEYBOARD_UP]: { display: 'none' },
});

const Summary = styled('div')({
  display: 'none',
  minWidth: 0,
  [KEYBOARD_UP]: { display: 'block' },
});

const Bar = styled('div')({ flex: 'none', minWidth: 0 });

/**
 * What the three-islands call slot holds while a call has video: the bounded `surface` above the `bar`, or its
 * one-line `summary` while the on-screen keyboard is up. The bar never gives up height: the surface scrolls.
 * Layout only: no surface colour, no padding, no landmark (the pieces bring their own).
 */
export function CallStack({ bar, surface, summary }: CallStackProps): JSX.Element {
  return (
    <Root data-kit-call-stack="">
      {isPresent(surface) && <Surface data-kit-call-surface="">{surface}</Surface>}
      {isPresent(surface) && isPresent(summary) && <Summary data-kit-call-summary="">{summary}</Summary>}
      <Bar data-kit-call-bar="">{bar}</Bar>
    </Root>
  );
}
