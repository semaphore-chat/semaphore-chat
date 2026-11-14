import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';

/** Clips content to nothing while keeping it in the accessibility tree. */
export const visuallyHidden = {
  position: 'absolute',
  width: `${tokens.border.hairline}px`,
  height: `${tokens.border.hairline}px`,
  margin: `${-tokens.border.hairline}px`,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

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
