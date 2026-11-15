import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { shadow } from '../theme/shadow';
import { transientProps } from '../theme/transientProps';

export interface IslandProps {
  children: ReactNode;
  /** The landmark element; default `section`, which is only a region once it has a `label`. */
  as?: 'section' | 'aside' | 'nav' | 'main' | 'div';
  /** Names the landmark. */
  label?: string;
  padding?: 'none' | 'md' | 'lg';
  /** Fills its parent's height; the content scrolls inside the island, never the page. */
  scroll?: boolean;
  id?: string;
}

interface RootProps {
  $padding: 'none' | 'md' | 'lg';
  $scroll: boolean;
}

const Root = styled('div', { shouldForwardProp: (prop) => prop !== 'as' && transientProps(prop) })<RootProps>(
  ({ theme, $padding, $scroll }) => {
    const { palette } = kitTheme(theme);
    return {
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      padding: `${tokens.space[$padding === 'none' ? 'none' : $padding]}px`,
      background: palette.surface,
      color: palette.text,
      borderRadius: `${tokens.radius.island}px`,
      boxShadow: shadow(kitTheme(theme), 'island'),
      border: 'none',
      ...($scroll
        ? { height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }
        : { overflow: 'hidden' }),
    } as const;
  },
);

/**
 * The Lounge's big surface: a rounded panel on the ground, with the island shadow and no border.
 * Pick the landmark with `as` and name it with `label`. With `scroll` it fills the height its
 * parent gives it and scrolls its own content. The layout, not the island, sets the gap between islands.
 */
export function Island({
  children,
  as = 'section',
  label,
  padding = 'lg',
  scroll = false,
  id,
}: IslandProps): JSX.Element {
  return (
    <Root as={as} id={id} aria-label={label} $padding={padding} $scroll={scroll}>
      {children}
    </Root>
  );
}
