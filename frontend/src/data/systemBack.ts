/**
 * Whether the system Back closes the Lounge's top layer (kit `useSystemBack`): on a touch device (Android's Back
 * gesture or button, a tablet's too, as on Discord), never in Electron, and not with a mouse, where a browser's
 * Back should keep its plain meaning and history stays free of layer entries.
 *
 * Headless: no UI imports (see the `src/data` lint block in eslint.config.js).
 */
import { useSyncExternalStore } from 'react';
import { isElectron } from '../utils/platform';

export const SYSTEM_BACK_QUERY = '(pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const list = window.matchMedia(SYSTEM_BACK_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function readCoarse(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_BACK_QUERY).matches;
}

/**
 * Where a navigation from inside a closing layer waits for that layer's history entry to be stepped back over
 * (the kit's `useSystemBack` returns it; the Lounge registers it). Without that, a replace would rewrite the layer's
 * entry and leave the screen's old entry under it. Kit-free on purpose: the classic shell shares the hooks that call
 * `navigateAfterLayers`, and with nothing registered the navigation runs at once.
 */
let layerEntryRunner: ((run: () => void) => void) | null = null;

export function setLayerEntryRunner(runner: ((run: () => void) => void) | null): void {
  layerEntryRunner = runner;
}

/** Runs a route navigation once the entries of layers that just closed are gone (at once outside the Lounge). */
export function navigateAfterLayers(run: () => void): void {
  if (layerEntryRunner === null) run();
  else layerEntryRunner(run);
}

export function useSystemBackEnabled(): boolean {
  const coarse = useSyncExternalStore(subscribe, readCoarse, () => false);
  return coarse && !isElectron();
}
