import type { ReactNode } from 'react';
import type { ElectronAPI } from '../types/electron-api';
import { asElectronAPI } from '../utils/electronBridge';
import { ElectronContext } from './ElectronContext';

interface ElectronProviderProps {
  /**
   * The bridge `useElectronAPI()` returns below this provider: a fake (see
   * `createFakeElectronAPI()`), or `null` for a web browser. Like
   * `getElectronAPI()`, an object without `isElectron: true` counts as null.
   */
  api: ElectronAPI | null;
  children: ReactNode;
}

/** Overrides the Electron bridge for a subtree (tests, stories). See ElectronContext.ts. */
export function ElectronProvider({ api, children }: ElectronProviderProps) {
  return <ElectronContext.Provider value={asElectronAPI(api)}>{children}</ElectronContext.Provider>;
}
