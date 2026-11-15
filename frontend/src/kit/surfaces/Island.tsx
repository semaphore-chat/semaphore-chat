import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';
import { shadow } from '../theme/shadow';
import { transientProps } from '../theme/transientProps';

interface IslandBase {
  children: ReactNode;
  padding?: 'none' | 'md' | 'lg';
  /** Fills its parent's height; the content scrolls inside the island, never the page. */
  scroll?: boolean;
  id?: string;
}

/**
 * The landmark element and its name. A `nav` or `aside` must be named (several unnamed landmarks of
 * one kind cannot be told apart); a `main` or `section` may be (a `section` is only a region once it
 * is); a `div` has no landmark role, and ARIA does not allow a name on it.
 */
export type IslandProps = IslandBase &
  (
    | { as: 'nav' | 'aside'; label: string }
    | { as?: 'section' | 'main'; label?: string }
    | { as: 'div'; label?: undefined }
  );

interface RootProps {
  $padding: 'none' | 'md' | 'lg';
  $scroll: boolean;
}

const Root = styled('div', { shouldForwardProp: (prop) => prop !== 'as' && transientProps(prop) })<RootProps>(
  ({ theme, $padding, $scroll }) => {
    const lounge = kitTheme(theme);
    const { palette } = lounge;
    return {
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      padding: `${tokens.space[$padding]}px`,
      background: palette.surface,
      color: palette.text,
      borderRadius: `${tokens.radius.island}px`,
      boxShadow: shadow(lounge, 'island'),
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
      <SurfaceContext value="surface">{children}</SurfaceContext>
    </Root>
  );
}
