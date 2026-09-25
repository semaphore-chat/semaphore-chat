/**
 * ElectronContext
 *
 * Gives components and hooks the Electron bridge (`window.electronAPI`, as
 * exposed by the preload script) through React, so a test or story can hand
 * a subtree a fake without touching globals:
 *
 *   renderWithProviders(
 *     <ElectronProvider api={createFakeElectronAPI({ quitAndInstall })}>
 *       <AutoUpdater />
 *     </ElectronProvider>,
 *   );
 *
 * Without a provider, `useElectronAPI()` returns `getElectronAPI()`, i.e. the
 * real bridge (or the `setElectronAPIOverride()` fake). The app doesn't mount
 * a provider. Note that the provider only reaches `useElectronAPI()`:
 * `isElectron()` and other non-React checks still see the global bridge, so
 * code that needs both (layout, `useResponsive`) is faked with
 * `setElectronAPIOverride()` instead.
 *
 * The provider component lives in ElectronProvider.tsx so each module only
 * exports components or non-components (React Fast Refresh).
 */

import { createContext, useContext } from 'react';
import type { ElectronAPI } from '../types/electron-api';
import { getElectronAPI } from '../utils/electronBridge';

/** `undefined` (the default): no provider, use `getElectronAPI()`. */
export const ElectronContext = createContext<ElectronAPI | null | undefined>(undefined);

/**
 * The Electron bridge, or `null` outside Electron. Non-null always means
 * Electron (`isElectron: true`); individual methods can still be missing on
 * older desktop builds, so optional-call them (`api?.checkForUpdates?.()`).
 */
export function useElectronAPI(): ElectronAPI | null {
  const provided = useContext(ElectronContext);
  return provided !== undefined ? provided : getElectronAPI();
}
