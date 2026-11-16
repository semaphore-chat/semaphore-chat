import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { standOutFill, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';

export type ListSeparatorVariant = 'day' | 'unread';

export interface ListSeparatorProps {
  /**
   * `day`: a centred tag that starts a day ("Today", "Monday 3 March"). `unread`: an accent line with its tag at
   * the end, above the first message not read yet ("New").
   */
  variant: ListSeparatorVariant;
  /** The visible tag, and the separator's name. */
  label: string;
}

const Root = styled('div', { shouldForwardProp: transientProps })<{ $variant: ListSeparatorVariant }>(
  ({ theme, $variant }) => {
    const { palette } = kitTheme(theme);
    return {
      display: 'flex',
      alignItems: 'center',
      gap: `${tokens.space.sm}px`,
      minWidth: 0,
      padding: `${tokens.space.sm}px ${tokens.space.md}px`,
      // The unread line runs the full width up to its tag; the day tag is centred on its own.
      justifyContent: $variant === 'day' ? 'center' : 'flex-end',
      ...($variant === 'unread' && {
        '&::before': {
          content: '""',
          flex: '1 1 auto',
          height: `${tokens.border.hairline}px`,
          background: palette.accent,
        },
      }),
    };
  },
);

const Tag = styled('span', { shouldForwardProp: transientProps })<{ $variant: ListSeparatorVariant; $on: Surface }>(
  ({ theme, $variant, $on }) => {
    const { palette } = kitTheme(theme);
    const type = $variant === 'day' ? tokens.text.meta : tokens.text.tag;
    return {
      flex: '0 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      boxSizing: 'border-box',
      padding: `${$variant === 'day' ? tokens.space.xs : 0}px ${tokens.space.md}px`,
      borderRadius: `${tokens.radius.full}px`,
      fontFamily: theme.typography.fontFamily,
      fontSize: `${type.size}px`,
      lineHeight: `${type.line}px`,
      fontWeight: tokens.text.bodyStrong.weight,
      ...($variant === 'day'
        ? { background: standOutFill(palette, $on), color: palette.textSecondary }
        : { background: palette.accent, color: palette.onAccent }),
    };
  },
);

/**
 * A break in a list of messages: where a new day starts, or where the unread messages start. It is a
 * `separator` named by its label, so a screen reader moving through the list hears "Today" or "New".
 */
export function ListSeparator({ variant, label }: ListSeparatorProps): JSX.Element {
  const on = useSurface();
  return (
    <Root role="separator" aria-label={label} $variant={variant}>
      <Tag aria-hidden="true" $variant={variant} $on={on}>
        {label}
      </Tag>
    </Root>
  );
}
