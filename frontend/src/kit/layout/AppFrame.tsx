import type { JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';

export interface AppFrameProps {
  children: ReactNode;
}

const inset = (side: 'top' | 'right' | 'bottom' | 'left') =>
  `calc(${tokens.layout.gutter}px + env(safe-area-inset-${side}))`;

const Frame = styled('div')(({ theme }) => {
  const lounge = kitTheme(theme);
  return {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    // `vh` where `dvh` (the height with the browser bars out of the way) is unknown.
    height: '100vh',
    '@supports (height: 100dvh)': { height: '100dvh' },
    padding: `${inset('top')} ${inset('right')} ${inset('bottom')} ${inset('left')}`,
    // Nothing scrolls the page: each island scrolls inside itself.
    overflow: 'hidden',
    background: lounge.palette.ground,
    color: lounge.palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
  };
});

/**
 * The ground every layout sits on. It is exactly the viewport's height (`100dvh`), insets its
 * content by the gutter plus the safe areas, and never scrolls: islands scroll inside themselves.
 * Render one layout template inside it. It adds no landmark.
 */
export function AppFrame({ children }: AppFrameProps): JSX.Element {
  return (
    <Frame>
      <SurfaceContext value="ground">{children}</SurfaceContext>
    </Frame>
  );
}
