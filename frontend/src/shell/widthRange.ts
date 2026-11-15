/**
 * The kit's width range (phone / compact / wide) for the eager shell switch.
 *
 * The same ranges and queries as kit/layout/breakpoints.ts `useWidthRange`, but
 * without importing it: that module imports theme/generated/tokens whole, which
 * names the kit fonts and would put them in the first page load (bundle check
 * (d)). The two numbers are pinned to `tokens.breakpoint` by
 * __tests__/shell/widthRange.test.ts, so they cannot drift apart.
 */
import { useSyncExternalStore } from 'react';
import type { WidthRange } from '../kit/layout/breakpoints';

/** `tokens.breakpoint.phone` and `tokens.breakpoint.docked`. */
export const SHELL_BREAKPOINTS = { phone: 600, docked: 1200 } as const;

const WIDE = `(min-width: ${SHELL_BREAKPOINTS.docked}px)`;
const ABOVE_PHONE = `(min-width: ${SHELL_BREAKPOINTS.phone}px)`;

const supported = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

let lists: { source: typeof window.matchMedia; wide: MediaQueryList; abovePhone: MediaQueryList } | null = null;

function queries(): NonNullable<typeof lists> {
  if (lists === null || lists.source !== window.matchMedia) {
    lists = { source: window.matchMedia, wide: window.matchMedia(WIDE), abovePhone: window.matchMedia(ABOVE_PHONE) };
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

/** The viewport's width range, read synchronously; `'wide'` where `matchMedia` is not available. */
export function useShellWidthRange(): WidthRange {
  return useSyncExternalStore(subscribe, read, () => 'wide');
}
