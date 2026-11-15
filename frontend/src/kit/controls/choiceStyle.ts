import { styled } from '@mui/material/styles';
import type { Palette } from '../../theme/derive/derivePalette';
import { tokens } from '../../theme/generated/tokens';
import { focusRing } from '../theme/states';
import { mix } from '../theme/mix';

/** Vertical room that lifts a one-line choice row to the touch minimum. */
export const ROW_PADDING = (tokens.control.md - tokens.text.body.line) / 2;

/** Offset that centres a control of `height` on the first text line. */
export function firstLineOffset(height: number): number {
  return (tokens.text.body.line - height) / 2;
}

/** The clickable row: the whole label, control and text, activates the control. */
export const ChoiceRow = styled('label')({
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'flex-start',
  gap: `${tokens.space.md}px`,
  maxWidth: '100%',
  minWidth: 0,
  padding: `${ROW_PADDING}px 0`,
  cursor: 'pointer',
  '&:has(:disabled)': { cursor: 'default' },
});

/** The box that holds a choice's real input and its drawn mark (checkbox box, radio circle). */
export const ChoiceSlot = styled('span')({
  position: 'relative',
  display: 'block',
  flexShrink: 0,
  width: `${tokens.icon.lg}px`,
  height: `${tokens.icon.lg}px`,
  marginTop: `${firstLineOffset(tokens.icon.lg)}px`,
});

/** The real input covers the drawn mark: invisible, but focusable and clickable. */
export const ChoiceInput = styled('input')({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  opacity: 0,
  cursor: 'inherit',
});

export interface ChoiceMarkStatesInput {
  palette: Palette;
  /** The colour the state tint sits on: the mark's fill, or the surface under a clear one. */
  under: string;
  hover: number;
  pressed: number;
}

/**
 * Hover, pressed, disabled and focus-visible for a drawn mark that follows its
 * real input. The mark is the input's next sibling inside a slot inside a
 * `ChoiceRow` label, so these selectors depend on exactly that structure
 * (`label > span > input ~ mark`); keep them in this one place.
 */
export function choiceMarkStates({ palette, under, hover, pressed }: ChoiceMarkStatesInput) {
  return {
    'label:hover > span > input:not(:disabled) ~ &': {
      '@media (hover: hover)': { background: mix(palette.text, under, hover) },
    },
    'input:active:not(:disabled) ~ &': { background: mix(palette.text, under, pressed) },
    'input:disabled ~ &': { opacity: tokens.state.disabled },
    'input:focus-visible ~ &': focusRing(palette),
  };
}
