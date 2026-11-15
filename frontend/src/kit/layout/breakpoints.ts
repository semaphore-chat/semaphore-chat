import { useSyncExternalStore } from 'react';
import { tokens } from '../../theme/generated/tokens';

/**
 * The three width ranges a layout has:
 * - `phone`: below `tokens.breakpoint.phone`.
 * - `compact`: from `phone` up to, not including, `tokens.breakpoint.docked`.
 * - `wide`: `tokens.breakpoint.docked` and above.
 */
export type WidthRange = 'phone' | 'compact' | 'wide';

const { phone, docked } = tokens.breakpoint;

/**
 * Media query strings for the ranges, built from the tokens. They are plain queries so one set serves
 * `matchMedia` and CSS: in a style object write `` [`@media ${media.wide}`]: {...} ``. The "below"
 * forms use `not all and (min-width)`, so a fractional width falls in exactly one range.
 */
export const media = {
  phone: `not all and (min-width: ${phone}px)`,
  compact: `(min-width: ${phone}px) and (not (min-width: ${docked}px))`,
  wide: `(min-width: ${docked}px)`,
  belowWide: `not all and (min-width: ${docked}px)`,
  abovePhone: `(min-width: ${phone}px)`,
} as const;

/** The CSS at-rule for one of the queries above, for use as a key in a style object. */
export function atMedia(query: string): string {
  return `@media ${query}`;
}

const supported = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** The two lists everything is read from, made once for a given `window.matchMedia`. */
let lists: { source: typeof window.matchMedia; wide: MediaQueryList; abovePhone: MediaQueryList } | null = null;

function queries(): NonNullable<typeof lists> {
  if (lists === null || lists.source !== window.matchMedia) {
    lists = {
      source: window.matchMedia,
      wide: window.matchMedia(media.wide),
      abovePhone: window.matchMedia(media.abovePhone),
    };
  }
  return lists;
}

function read(): WidthRange {
  if (!supported()) {
    return 'wide';
  }
  const { wide, abovePhone } = queries();
  if (wide.matches) {
    return 'wide';
  }
  return abovePhone.matches ? 'compact' : 'phone';
}

function subscribe(onChange: () => void): () => void {
  if (!supported()) {
    return () => undefined;
  }
  const { wide, abovePhone } = queries();
  wide.addEventListener('change', onChange);
  abovePhone.addEventListener('change', onChange);
  return () => {
    wide.removeEventListener('change', onChange);
    abovePhone.removeEventListener('change', onChange);
  };
}

/**
 * The width range of the viewport, for the few things CSS cannot do: which subtree to mount, which
 * pane is hidden from assistive technology. It is read synchronously, so the first render is right.
 * `'wide'` where `matchMedia` is not available.
 */
export function useWidthRange(): WidthRange {
  return useSyncExternalStore(subscribe, read, () => 'wide');
}
