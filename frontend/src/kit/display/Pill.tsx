import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { transientProps } from '../theme/transientProps';
import type { IconName } from '../icons/generated';
import { dotStyle } from './dot';
import { Icon } from './Icon';

export type PillTone = 'neutral' | 'accent' | 'danger' | 'positive' | 'warning';
export type PillSize = 'sm' | 'md';

export interface PillProps {
  children: string;
  tone?: PillTone;
  /** A leading dot in the tone colour. */
  dot?: boolean;
  icon?: IconName;
  size?: PillSize;
}

interface RootProps {
  $tone: PillTone;
  $size: PillSize;
}

const Root = styled('span', { shouldForwardProp: transientProps })<RootProps>(
  ({ theme, $tone, $size }) => {
    const { palette } = kitTheme(theme);
    const type = $size === 'sm' ? tokens.text.tag : { ...tokens.text.small, weight: tokens.text.bodyStrong.weight };
    const height = $size === 'sm' ? tokens.icon.lg : tokens.icon.xl;
    const looks: Record<PillTone, { background: string; color: string }> = {
      neutral: { background: palette.fill, color: palette.textSecondary },
      accent: { background: palette.accent, color: palette.onAccent },
      danger: { background: palette.fill, color: palette.danger },
      positive: { background: palette.fill, color: palette.positive },
      warning: { background: palette.fill, color: palette.warning },
    };
    return {
      display: 'inline-flex',
      alignItems: 'center',
      flexShrink: 0,
      maxWidth: '100%',
      gap: `${tokens.space.xs}px`,
      boxSizing: 'border-box',
      height: `${height}px`,
      padding: `0 ${tokens.space.sm}px`,
      borderRadius: `${tokens.radius.full}px`,
      fontFamily: theme.typography.fontFamily,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      fontWeight: type.weight,
      whiteSpace: 'nowrap',
      ...looks[$tone],
    };
  },
);

// The same colour as the text, so the dot always matches its tone.
const Dot = styled('span')(dotStyle('currentColor'));

/** The label gives way (an ellipsis) before the pill outgrows its row. */
const Label = styled('span')({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

/**
 * A small rounded tag: a role, a status, or the selected item. Always text;
 * the tone colours it, and `dot` or `icon` add a leading mark (decorative:
 * the text carries the meaning).
 */
export function Pill({ children, tone = 'neutral', dot = false, icon, size = 'md' }: PillProps): JSX.Element {
  return (
    <Root $tone={tone} $size={size}>
      {dot && <Dot aria-hidden="true" />}
      {icon !== undefined && <Icon name={icon} size={size === 'sm' ? 'xs' : 'sm'} />}
      <Label>{children}</Label>
    </Root>
  );
}
