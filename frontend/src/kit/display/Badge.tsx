import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import { dotStyle } from './dot';

export interface BadgeProps {
  count?: number;
  /** The largest number shown; above it the badge reads "<max>+". Default 99. */
  max?: number;
  /** A small dot with no number. */
  dot?: boolean;
  tone?: 'accent' | 'danger';
  /** What it means, e.g. "3 unread": the accessible name. */
  label: string;
}

const DEFAULT_MAX = 99;

interface RootProps {
  $tone: 'accent' | 'danger';
  $dot: boolean;
}

const Root = styled('span', { shouldForwardProp: transientProps })<RootProps>(
  ({ theme, $tone, $dot }) => {
    const { palette } = kitTheme(theme);
    const background = $tone === 'accent' ? palette.accent : palette.danger;
    const ink = $tone === 'accent' ? palette.onAccent : palette.onDanger;
    if ($dot) {
      return { display: 'inline-block', ...dotStyle(background) };
    }
    const type = tokens.text.tag;
    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      boxSizing: 'border-box',
      height: `${tokens.icon.lg}px`,
      minWidth: `${tokens.icon.lg}px`,
      padding: `0 ${tokens.space.xs}px`,
      borderRadius: `${tokens.radius.full}px`,
      background,
      color: ink,
      fontFamily: theme.typography.fontFamily,
      fontSize: `${type.size}px`,
      lineHeight: `${tokens.icon.lg}px`,
      fontWeight: type.weight,
      whiteSpace: 'nowrap',
    };
  },
);

/**
 * A count (or a dot) on an item. Renders nothing for a count that is 0,
 * negative or NaN, unless it is a dot. Named by `label`, because the number
 * alone ("3") does not say what it counts.
 */
export function Badge({ count, max, dot = false, tone = 'danger', label }: BadgeProps): JSX.Element | null {
  const cap = max === undefined || Number.isNaN(max) || max < 1 ? DEFAULT_MAX : Math.floor(max);
  const whole = count === undefined || Number.isNaN(count) ? 0 : Math.floor(count);
  if (!dot && whole < 1) {
    return null;
  }
  return (
    <Root role="img" aria-label={label} $tone={tone} $dot={dot}>
      {dot ? null : whole > cap ? `${cap}+` : whole}
    </Root>
  );
}
