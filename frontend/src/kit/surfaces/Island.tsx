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
  /**
   * A block that stays at the island's foot (the user's own card): with `scroll`, only the content above it
   * scrolls. Inside the island's padding, a small gap below the content.
   */
  footer?: ReactNode;
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
  /** A footer is shown: the padding and the scrolling move to the body above it. */
  $split?: boolean;
}

const Root = styled('div', { shouldForwardProp: (prop) => prop !== 'as' && transientProps(prop) })<RootProps>(
  ({ theme, $padding, $scroll, $split = false }) => {
    const lounge = kitTheme(theme);
    const { palette } = lounge;
    return {
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      padding: $split ? 0 : `${tokens.space[$padding]}px`,
      background: palette.surface,
      color: palette.text,
      borderRadius: `${tokens.radius.island}px`,
      boxShadow: shadow(lounge, 'island'),
      border: 'none',
      ...($scroll && !$split
        ? { height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }
        : { overflow: 'hidden', ...($scroll && { height: '100%', minHeight: 0 }) }),
    } as const;
  },
);

/** With a footer: the content above it, which scrolls when the island does. */
const Body = styled('div', { shouldForwardProp: transientProps })<RootProps>(({ $padding, $scroll }) => ({
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: '1 1 auto',
  padding: `${tokens.space[$padding]}px`,
  ...($scroll && { minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }),
}));

/** The block at the island's foot: never scrolls away. */
const Foot = styled('div', { shouldForwardProp: transientProps })<{ $padding: 'none' | 'md' | 'lg' }>(({ $padding }) => ({
  boxSizing: 'border-box',
  flexShrink: 0,
  minWidth: 0,
  padding: `${tokens.space.sm}px ${tokens.space[$padding]}px ${tokens.space[$padding]}px`,
}));

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
  footer,
  id,
}: IslandProps): JSX.Element {
  const split = footer !== undefined && footer !== null && footer !== false;
  return (
    <Root as={as} id={id} aria-label={label} $padding={padding} $scroll={scroll} $split={split}>
      <SurfaceContext value="surface">
        {split ? (
          <>
            <Body $padding={padding} $scroll={scroll}>
              {children}
            </Body>
            <Foot $padding={padding}>{footer}</Foot>
          </>
        ) : (
          children
        )}
      </SurfaceContext>
    </Root>
  );
}
