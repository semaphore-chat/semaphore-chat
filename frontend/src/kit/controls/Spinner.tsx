import type { JSX } from 'react';
import CircularProgress from '@mui/material/CircularProgress';

export interface SpinnerProps {
  /** Diameter in px: pass a `tokens.icon` size. */
  size: number;
}

/** The busy indicator of Button and IconButton: inherits the text colour, hidden from assistive technology. */
export function Spinner({ size }: SpinnerProps): JSX.Element {
  // thickness is an SVG stroke ratio (of the circle's radius), not a pixel size.
  return <CircularProgress aria-hidden="true" color="inherit" size={size} thickness={5} />;
}
