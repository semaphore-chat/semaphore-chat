import { useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { barFocusProps, type BarFocus } from '../behaviour/hosts/listFocus';
import { kitTheme } from '../theme/KitProvider';
import { SurfaceContext } from '../theme/onSurface';
import { shadow } from '../theme/shadow';
import { transientProps } from '../theme/transientProps';

export interface DockProps {
  /** Names the navigation landmark. */
  label: string;
  /** DockItem, IconButton and DockDivider. */
  children: ReactNode;
  /**
   * The bar is the bottom edge of a phone screen: it keeps clear of the home indicator
   * (`env(safe-area-inset-bottom)` as a bottom margin). Leave it off when the bar sits mid-layout.
   */
  bottomBar?: boolean;
  /**
   * Makes the bar one keyboard list: `useListFocus({ orientation: 'horizontal', ... }).bar`, with each item's `focus`
   * set from `rowFocus(id)`. One Tab stop; Left, Right, Home and End move between items.
   */
  focus?: BarFocus;
}

const Root = styled('nav', { shouldForwardProp: transientProps })<{ $bottomBar: boolean }>(({ theme, $bottomBar }) => {
  const lounge = kitTheme(theme);
  return {
    // Positioned so an item's offsetLeft is measured from the bar.
    position: 'relative',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    // Centred while it fits; the start edge once it overflows, so nothing is cut off the left.
    justifyContent: 'safe center',
    gap: `${tokens.space.xs}px`,
    maxWidth: '100%',
    ...($bottomBar && { marginBottom: 'env(safe-area-inset-bottom)' }),
    height: `${tokens.layout.dock}px`,
    padding: `0 ${tokens.space.sm}px`,
    background: lounge.palette.surface,
    borderRadius: `${tokens.radius.full}px`,
    boxShadow: shadow(lounge, 'island'),
    // A long row scrolls sideways inside the bar; no scrollbar is drawn.
    overflowX: 'auto',
    overflowY: 'hidden',
    overscrollBehaviorX: 'contain',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
  };
});

const Divider = styled('span')(({ theme }) => ({
  flex: '0 0 auto',
  width: `${tokens.border.hairline}px`,
  height: `${tokens.icon.xl}px`,
  background: kitTheme(theme).palette.fill,
}));

/** A vertical hairline between groups in a Dock. Decorative. */
export function DockDivider(): JSX.Element {
  return <Divider aria-hidden="true" />;
}

/**
 * The community switcher: a pill-shaped navigation bar of DockItems and icon
 * buttons. When it holds more than fits it scrolls sideways, and it keeps the
 * current item (`aria-current="page"`) in view on mount and whenever that
 * changes; a scroll the user made is left alone otherwise.
 */
export function Dock({ label, children, bottomBar = false, focus }: DockProps): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const keys = barFocusProps(focus);
  const shown = useRef<Element | null>(null);

  // scrollLeft, not scrollIntoView, which would scroll the page too.
  const reveal = () => {
    const bar = ref.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !current || current === shown.current) {
      return;
    }
    shown.current = current;
    const left = current.offsetLeft - tokens.space.sm;
    const right = current.offsetLeft + current.offsetWidth + tokens.space.sm;
    if (left < bar.scrollLeft) {
      bar.scrollLeft = Math.max(0, left);
    } else if (right > bar.scrollLeft + bar.clientWidth) {
      bar.scrollLeft = right - bar.clientWidth;
    }
  };
  const latest = useRef(reveal);
  latest.current = reveal;
  useLayoutEffect(reveal);

  // A first layout at zero width (a hidden bar) or a rotation changes what is in view: when the
  // bar's own size changes, centre the current item again. A scroll the user made is otherwise left alone.
  useLayoutEffect(() => {
    const bar = ref.current;
    if (bar === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let width = bar.clientWidth;
    const observer = new ResizeObserver(() => {
      if (bar.clientWidth !== width) {
        width = bar.clientWidth;
        shown.current = null;
        latest.current();
      }
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <Root
      ref={ref}
      aria-label={label}
      $bottomBar={bottomBar}
      // Firefox makes a scrolling bar a Tab stop of its own; as one keyboard list the bar must not be.
      tabIndex={keys === undefined ? undefined : -1}
      onKeyDown={keys?.onKeyDown}
      onKeyUp={keys?.onKeyUp}
      onFocusCapture={keys?.onFocusCapture}
      onBlur={keys?.onBlur}
    >
      <SurfaceContext value="surface">{children}</SurfaceContext>
    </Root>
  );
}
