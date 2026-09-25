/**
 * Electron bridge adapter
 *
 * The ONLY module that reads `window.electronAPI`, the API the Electron
 * preload script (`electron/preload.ts`) exposes through `contextBridge`.
 * Everything else goes through it, so the bridge is one seam to fake:
 *
 * - Non-React code (utils, services): `getElectronAPI()`.
 * - Components and hooks: `useElectronAPI()` (`contexts/ElectronContext.ts`),
 *   which an `<ElectronProvider api={...}>` can override for a subtree.
 * - Platform checks: `isElectron()`, `hasElectronFeature()`, `isWayland()`
 *   (`utils/platform.ts`), which call `getElectronAPI()`.
 *
 * Tests and the Ladle sandbox swap the bridge with `setElectronAPIOverride()`
 * (see `__tests__/test-utils/fakeElectronAPI.ts` for a complete fake) instead
 * of assigning `window.electronAPI`. ESLint rejects `.electronAPI` member
 * access anywhere else (eslint.config.js).
 */

import type { ElectronAPI } from '../types/electron-api';

/** `undefined`: no override, read `window.electronAPI`. */
let override: ElectronAPI | null | undefined;

/**
 * An API object counts as the Electron bridge only when it says so
 * (`isElectron: true`, which the preload script always sets). So a non-null
 * result from `getElectronAPI()` / `useElectronAPI()` always means "running
 * in Electron".
 */
export function asElectronAPI(api: ElectronAPI | null | undefined): ElectronAPI | null {
  return api?.isElectron === true ? api : null;
}

/**
 * The Electron bridge, or `null` outside Electron (a web browser, SSR, or a
 * test/story that hasn't installed a fake).
 */
export function getElectronAPI(): ElectronAPI | null {
  if (override !== undefined) return asElectronAPI(override);
  if (typeof window === 'undefined') return null;
  return asElectronAPI(window.electronAPI);
}

/**
 * Replace the bridge that `getElectronAPI()` (and so `isElectron()` and
 * `useElectronAPI()` outside an `ElectronProvider`) returns, for tests and
 * the Ladle sandbox:
 *
 * - an `ElectronAPI` (e.g. `createFakeElectronAPI()`): behave as Electron
 *   with that API;
 * - `null`: behave as a web browser, even if `window.electronAPI` is set;
 * - `undefined`: remove the override and read `window.electronAPI` again.
 */
export function setElectronAPIOverride(api: ElectronAPI | null | undefined): void {
  override = api;
}
