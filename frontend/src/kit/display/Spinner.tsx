import type { JSX } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import type { IconSize } from './Icon';

export interface SpinnerProps {
  size?: IconSize;
  /** Names the busy state for assistive technology; without it the spinner is decorative. */
  label?: string;
}

const Root = styled(CircularProgress)({
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
    '& .MuiCircularProgress-circle': { animation: 'none' },
  },
});

/**
 * A busy indicator that inherits the text colour. Decorative (hidden from
 * assistive technology) unless given a `label`, then a named `status`.
 */
export function Spinner({ size = 'sm', label }: SpinnerProps): JSX.Element {
  const accessibility = label
    ? ({ role: 'status', 'aria-label': label } as const)
    : ({ 'aria-hidden': true } as const);
  // thickness is an SVG stroke ratio (of the circle's radius), not a pixel size.
  return <Root {...accessibility} color="inherit" size={tokens.icon[size]} thickness={5} />;
}
