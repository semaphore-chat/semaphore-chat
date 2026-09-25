/**
 * Renders a story as the Electron desktop app sees it: `isElectron()` is true
 * (the Electron bridge is `createFakeElectronAPI()`, installed with
 * `setElectronAPIOverride()`), so the story shows what an Electron window at
 * that width renders — e.g. the desktop layout in an 820px window, where a
 * browser gets the tablet layout.
 *
 *   export const ChannelChat = asElectron(defineScreen(scenario, path));
 *   ChannelChat.meta = { viewports: ['tablet'] };
 *
 * Electron's minimum window width is 800px (electron/main.ts), so these
 * stories only make sense at tablet width and up.
 *
 * The fake has every bridge method, with neutral results: no update events,
 * no desktop sources, secure storage available. Pass overrides to show
 * Electron-only UI, e.g. the auto-updater's download snackbar:
 *
 *   asElectron(Story, { onUpdateAvailable: emitOnSubscribe({ version: '2.0.0' }) })
 *
 * In Electron the API base URL comes from the active saved server
 * (`config/env.ts`), so this also saves one at this page's own origin: API
 * and file requests keep going to `<origin>/api/...`, where MSW answers them.
 * Both are restored when the story unmounts, so the next story in an
 * interactive Ladle tab is a browser again.
 */
import { useEffect } from 'react';
import type { ElectronAPI } from '../../types/electron-api';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../../__tests__/test-utils/fakeElectronAPI';
import type { LadleStoryComponent } from './screenStory';

const SERVERS_KEY = 'semaphore:servers';
const ACTIVE_SERVER_KEY = 'semaphore:activeServerId';
const SERVER_ID = 'ladle-electron-server';

interface Saved {
  servers: string | null;
  activeServerId: string | null;
}

let saved: Saved | null = null;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: API URLs fall back to '' (Electron with no server).
  }
}

/** Idempotent: a second call while installed is a no-op. */
function installElectron(overrides: Partial<ElectronAPI> | undefined): void {
  if (saved) return;
  saved = {
    servers: readStorage(SERVERS_KEY),
    activeServerId: readStorage(ACTIVE_SERVER_KEY),
  };
  setElectronAPIOverride(createFakeElectronAPI(overrides));
  writeStorage(
    SERVERS_KEY,
    JSON.stringify([{ id: SERVER_ID, name: 'Ladle', url: window.location.origin, isActive: true }]),
  );
  writeStorage(ACTIVE_SERVER_KEY, SERVER_ID);
}

function uninstallElectron(): void {
  if (!saved) return;
  setElectronAPIOverride(undefined);
  writeStorage(SERVERS_KEY, saved.servers);
  writeStorage(ACTIVE_SERVER_KEY, saved.activeServerId);
  saved = null;
}

function useElectronPlatform(overrides: Partial<ElectronAPI> | undefined): void {
  // In place before the story's first render: useResponsive reads
  // isElectron() while rendering. The effect re-installs after a StrictMode
  // unmount/remount and restores the browser on the real unmount.
  installElectron(overrides);
  useEffect(() => {
    installElectron(overrides);
    return uninstallElectron;
  }, [overrides]);
}

/**
 * Wraps a story (keeping its MSW handlers) so it renders as in Electron,
 * with `overrides` replacing the fake bridge's defaults.
 */
export function asElectron(
  Story: LadleStoryComponent,
  overrides?: Partial<ElectronAPI>,
): LadleStoryComponent {
  const ElectronStory: LadleStoryComponent = () => {
    useElectronPlatform(overrides);
    return <Story />;
  };
  ElectronStory.msw = Story.msw;
  return ElectronStory;
}
