import type { CSSProperties, JSX, ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { ToastRegion } from '../display/ToastRegion';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';
import { isPresent } from './present';
import { useKeyboardInset } from './useKeyboardInset';

export interface AppFrameProps {
  children: ReactNode;
  /**
   * A row above everything, for a notice about the whole app such as "reconnecting" or "update available".
   * Put a kit Alert in it. It takes its natural height inside the safe area; the layout below fills the rest.
   */
  banner?: ReactNode;
}

const inset = (side: 'top' | 'right' | 'bottom' | 'left') =>
  `calc(${tokens.layout.gutter}px + env(safe-area-inset-${side}))`;

/** Set from the visual viewport while the on-screen keyboard is up; the frame ends where the keyboard starts. */
const KEYBOARD = '--kit-keyboard-inset';

const Frame = styled('div')(({ theme }) => {
  const lounge = kitTheme(theme);
  return {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    // `vh` where `dvh` (the height with the browser bars out of the way) is unknown.
    height: `calc(100vh - var(${KEYBOARD}))`,
    '@supports (height: 100dvh)': { height: `calc(100dvh - var(${KEYBOARD}))` },
    padding: `${inset('top')} ${inset('right')} ${inset('bottom')} ${inset('left')}`,
    // With the keyboard up the bottom edge is the keyboard, not the home indicator: the gutter is enough.
    '&[data-keyboard]': { paddingBottom: `${tokens.layout.gutter}px` },
    // Nothing scrolls the page: each island scrolls inside itself.
    overflow: 'hidden',
    background: lounge.palette.ground,
    color: lounge.palette.text,
    fontFamily: theme.typography.fontFamily,
    fontSize: `${tokens.text.body.size}px`,
    lineHeight: `${tokens.text.body.line}px`,
  };
});

const Banner = styled('div')({
  flex: '0 0 auto',
  minWidth: 0,
  marginBottom: `${tokens.layout.gutter}px`,
});

/**
 * The ground every layout sits on. It is exactly the viewport's height (`100dvh`), insets its
 * content by the gutter plus the safe areas, and never scrolls: islands scroll inside themselves.
 * Render one layout template inside it. It adds no landmark.
 *
 * `banner` is an optional row above the layout. On a phone, while the on-screen keyboard is up, the frame is
 * shortened to end at the keyboard's top edge and gives up the home-indicator padding.
 *
 * It renders the toast region (`useToasts`): at the bottom centre of the template's main island, which the
 * template marks with `data-kit-toast-anchor`, or of the frame when no template marks one.
 */
export function AppFrame({ children, banner }: AppFrameProps): JSX.Element {
  const keyboard = useKeyboardInset();
  const style = { [KEYBOARD]: `${keyboard}px` } as CSSProperties;
  return (
    <Frame style={style} data-keyboard={keyboard > 0 ? '' : undefined} data-kit-toast-frame="">
      <SurfaceContext value="ground">
        {isPresent(banner) && <Banner data-slot="banner">{banner}</Banner>}
        {children}
      </SurfaceContext>
      <ToastRegion />
    </Frame>
  );
}
