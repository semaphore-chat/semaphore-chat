import type { JSX } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { standOutFill, useSurface, type Surface } from '../theme/onSurface';
import { transientProps } from '../theme/transientProps';

export interface KeyCapProps {
  children: string;
}

const Root = styled('kbd', { shouldForwardProp: transientProps })<{ $on: Surface }>(({ theme, $on }) => {
  const { palette } = kitTheme(theme);
  const type = tokens.text.tag;
  return {
    display: 'inline-block',
    boxSizing: 'border-box',
    padding: `${tokens.space['2xs']}px ${tokens.space.sm}px`,
    border: `${tokens.border.hairline}px solid ${palette.hairline}`,
    borderRadius: `${tokens.radius.sm}px`,
    background: standOutFill(palette, $on),
    color: palette.textSecondary,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${type.size}px`,
    lineHeight: `${type.line}px`,
    fontWeight: type.weight,
    whiteSpace: 'nowrap',
  };
});

/** A keyboard key as a small outlined tag: "Ctrl", "K", "Esc". */
export function KeyCap({ children }: KeyCapProps): JSX.Element {
  return <Root $on={useSurface()}>{children}</Root>;
}
