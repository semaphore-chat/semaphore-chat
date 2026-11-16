/**
 * Whether a call bar is touch-first, so push-to-talk becomes a hold-to-talk control on the mic. The classic
 * bar's rule (`useResponsive().shouldUseTouchUI`: never in Electron; a touch device, or a phone or tablet
 * width), with the new shell's width ranges in place of the classic breakpoints: anything below wide counts
 * as a phone or tablet.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useSyncExternalStore } from 'react';
import { isElectron } from '../utils/platform';

/** The width ranges of the new shell's kit (`useWidthRange`), by name. */
export type TouchFirstRange = 'phone' | 'compact' | 'wide';

const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(TOUCH_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function readTouchDevice(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(TOUCH_QUERY).matches;
}

export function useTouchFirst(range: TouchFirstRange): boolean {
  const touchDevice = useSyncExternalStore(subscribe, readTouchDevice, () => false);
  return !isElectron() && (touchDevice || range !== 'wide');
}
