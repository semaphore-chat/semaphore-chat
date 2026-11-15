import type { JSX } from 'react';
import { keyframes, styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';

export type LinearProgressTone = 'accent' | 'positive' | 'danger';

export interface LinearProgressProps {
  /** The accessible name: what is in progress. */
  label: string;
  /** 0 to 100, clamped; leave it out for an indeterminate bar. */
  value?: number;
  tone?: LinearProgressTone;
}

/** The share of the track the sliding bar covers (and the static bar under reduced motion). */
const INDETERMINATE_SHARE = 40;
/** The bar travels from just off the left edge to just past the right, as a share of its own width. */
const TRAVEL_FROM = -100;
const TRAVEL_TO = (100 / INDETERMINATE_SHARE) * 100;

const slide = keyframes({
  from: { transform: `translateX(${TRAVEL_FROM}%)` },
  to: { transform: `translateX(${TRAVEL_TO}%)` },
});

const Track = styled('div')(({ theme }) => {
  const { palette } = kitTheme(theme);
  return {
    boxSizing: 'border-box',
    width: '100%',
    height: `${tokens.space.xs}px`,
    overflow: 'hidden',
    borderRadius: `${tokens.radius.full}px`,
    background: palette.hairline,
  };
});

interface BarProps {
  $tone: LinearProgressTone;
  /** A ratio 0..1, or undefined for indeterminate. */
  $ratio: number | undefined;
}

const Bar = styled('div', { shouldForwardProp: transientProps })<BarProps>(
  ({ theme, $tone, $ratio }) => {
    const { palette } = kitTheme(theme);
    const colours: Record<LinearProgressTone, string> = {
      accent: palette.accent,
      positive: palette.positive,
      danger: palette.danger,
    };
    const base = {
      height: '100%',
      borderRadius: `${tokens.radius.full}px`,
      background: colours[$tone],
    };
    if ($ratio === undefined) {
      return {
        ...base,
        width: `${INDETERMINATE_SHARE}%`,
        animation: `${slide} ${4 * tokens.motion.slow}ms linear infinite`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      };
    }
    return {
      ...base,
      width: '100%',
      transformOrigin: 'left center',
      transform: `scaleX(${$ratio})`,
      transition: `transform ${tokens.motion.base}ms`,
      '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
    };
  },
);

/** A thin progress bar. Determinate with `value`, indeterminate without. */
export function LinearProgress({ label, value, tone = 'accent' }: LinearProgressProps): JSX.Element {
  const percent = value === undefined ? undefined : Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, value));
  return (
    <Track
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <Bar $tone={tone} $ratio={percent === undefined ? undefined : percent / 100} />
    </Track>
  );
}
