import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
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
  /** DockItem, IconButton and DockDivider: the items that scroll when the bar overflows. */
  children: ReactNode;
  /**
   * Items fixed at the start of the bar (an Inbox IconButton, a DockDivider): they never scroll out of sight. The
   * children scroll between `start` and `end`.
   */
  start?: ReactNode;
  /** Items fixed at the end of the bar (an "All communities" IconButton): they never scroll out of sight. */
  end?: ReactNode;
  /**
   * The bar is the bottom edge of a phone screen: it keeps clear of the home indicator
   * (`env(safe-area-inset-bottom)` as a bottom margin). Leave it off when the bar sits mid-layout.
   */
  bottomBar?: boolean;
  /**
   * Makes the bar one keyboard list: `useListFocus({ orientation: 'horizontal', ... }).bar`, with each item's `focus`
   * set from `rowFocus(id)` (also the `start` and `end` items). One Tab stop; Left, Right, Home and End move between
   * items.
   */
  focus?: BarFocus;
}

/** A wheel "line" (deltaMode 1) in pixels, as browsers treat it. */
const LINE_HEIGHT = 16;

/** The fade at a scrolled edge, and the room kept beside an item scrolled into view. */
const FADE = tokens.space.xl;
/**
 * Room inside the scrolling region on each side: a badge or dot sits up to `space.xs` outside its item, plus its
 * surface ring, so the region keeps `space.sm` and never clips one at an edge.
 */
const INSET = tokens.space.sm;

const Root = styled('nav', { shouldForwardProp: transientProps })<{ $bottomBar: boolean }>(({ theme, $bottomBar }) => {
  const lounge = kitTheme(theme);
  return {
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
  };
});

const Fixed = styled('span')({
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: `${tokens.space.xs}px`,
});

/** A mask reads only alpha: any opaque palette colour stands for "shown", `transparent` for "faded out". */
const fadeMask = (opaque: string, start: boolean, end: boolean) =>
  start || end
    ? `linear-gradient(to right, ${start ? 'transparent' : opaque} 0, ${opaque} ${FADE}px, ${opaque} calc(100% - ${FADE}px), ${
        end ? 'transparent' : opaque
      } 100%)`
    : undefined;

const Scroller = styled('div', { shouldForwardProp: transientProps })<{ $fadeStart: boolean; $fadeEnd: boolean }>(
  ({ theme, $fadeStart, $fadeEnd }) => {
    const mask = fadeMask(kitTheme(theme).palette.surface, $fadeStart, $fadeEnd);
    return {
      // Positioned so an item's offsetLeft is measured from the scrolling region.
      position: 'relative',
      flex: '0 1 auto',
      minWidth: 0,
      boxSizing: 'border-box',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: `${tokens.space.xs}px`,
      padding: `0 ${INSET}px`,
      // A long row scrolls sideways inside the bar; no scrollbar is drawn.
      overflowX: 'auto',
      overflowY: 'hidden',
      overscrollBehaviorX: 'contain',
      scrollbarWidth: 'none',
      '&::-webkit-scrollbar': { display: 'none' },
      ...(mask !== undefined && { maskImage: mask, WebkitMaskImage: mask }),
    };
  },
);

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
 * The community switcher: a pill-shaped navigation bar of DockItems and icon buttons. `start` and `end` items stay
 * put; the children between them scroll sideways when they do not fit, with a fade at an edge that has more beyond
 * it. It keeps the current item (`aria-current="page"`) in view on mount and whenever that changes, and a focused
 * item in view; a scroll the user made is left alone otherwise.
 */
export function Dock({ label, children, start, end, bottomBar = false, focus }: DockProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const keys = barFocusProps(focus);
  const shown = useRef<Element | null>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  const measureFade = () => {
    const bar = ref.current;
    if (!bar) return;
    const next = { start: bar.scrollLeft > 1, end: bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1 };
    setFade((previous) => (previous.start === next.start && previous.end === next.end ? previous : next));
  };

  // scrollLeft, not scrollIntoView, which would scroll the page too.
  const bringIntoView = (item: HTMLElement) => {
    const bar = ref.current;
    if (!bar || !bar.contains(item) || item === bar) return;
    const left = item.offsetLeft - FADE;
    const right = item.offsetLeft + item.offsetWidth + FADE;
    if (left < bar.scrollLeft) {
      bar.scrollLeft = Math.max(0, left);
    } else if (right > bar.scrollLeft + bar.clientWidth) {
      bar.scrollLeft = right - bar.clientWidth;
    }
  };

  const reveal = () => {
    const bar = ref.current;
    const current = bar?.querySelector<HTMLElement>('[aria-current="page"]');
    if (bar && current && current !== shown.current) {
      shown.current = current;
      bringIntoView(current);
    }
    measureFade();
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
      }
      latest.current();
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // A mouse wheel turns vertically; the bar scrolls sideways. While the middle overflows, a vertical wheel with no
  // sideways part scrolls it sideways, as far as it can go; at its end (or when nothing overflows) the event is left
  // alone, so the page scrolls. Non-passive, so the sideways scroll can take the event from the page.
  useEffect(() => {
    const bar = ref.current;
    if (bar === null) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaX !== 0 || event.deltaY === 0 || event.ctrlKey) return;
      const room = bar.scrollWidth - bar.clientWidth;
      if (room <= 1) return;
      const step = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaMode === 2 ? event.deltaY * bar.clientWidth : event.deltaY;
      const canMove = step > 0 ? bar.scrollLeft < room - 1 : bar.scrollLeft > 1;
      if (!canMove) return;
      event.preventDefault();
      bar.scrollLeft = Math.max(0, Math.min(room, bar.scrollLeft + step));
    };
    bar.addEventListener('wheel', onWheel, { passive: false });
    return () => bar.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <Root
      aria-label={label}
      $bottomBar={bottomBar}
      onKeyDown={keys?.onKeyDown}
      onKeyUp={keys?.onKeyUp}
      onFocusCapture={keys?.onFocusCapture}
      onBlur={keys?.onBlur}
    >
      <SurfaceContext value="surface">
        {start !== undefined && <Fixed>{start}</Fixed>}
        <Scroller
          ref={ref}
          data-kit-dock-scroll=""
          $fadeStart={fade.start}
          $fadeEnd={fade.end}
          // Firefox makes a scrolling region a Tab stop of its own; as one keyboard list the bar must not have one.
          tabIndex={keys === undefined ? undefined : -1}
          onScroll={measureFade}
          onFocus={(event) => {
            if (event.target instanceof HTMLElement) bringIntoView(event.target);
          }}
        >
          {children}
        </Scroller>
        {end !== undefined && <Fixed>{end}</Fixed>}
      </SurfaceContext>
    </Root>
  );
}
