import { useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import { tokens } from '../../theme/generated/tokens';
import { kitTheme } from '../theme/KitProvider';
import { shadow } from '../theme/shadow';

export interface DockProps {
  /** Names the navigation landmark. */
  label: string;
  /** DockItem, IconButton and DockDivider. */
  children: ReactNode;
}

const Root = styled('nav')(({ theme }) => {
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
export function Dock({ label, children }: DockProps): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const shown = useRef<Element | null>(null);

  // scrollLeft, not scrollIntoView, which would scroll the page too.
  useLayoutEffect(() => {
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
  });

  return (
    <Root ref={ref} aria-label={label}>
      {children}
    </Root>
  );
}
