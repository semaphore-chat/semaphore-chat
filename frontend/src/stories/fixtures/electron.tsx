/**
 * Renders a story as the Electron desktop app sees it: `isElectron()` is true
 * (a minimal `window.electronAPI` stub, as the preload script would expose),
 * so the story shows what an Electron window at that width renders — e.g. the
 * desktop layout in an 820px window, where a browser gets the tablet layout.
 *
 *   export const ChannelChat = asElectron(defineScreen(scenario, path));
 *   ChannelChat.meta = { viewports: ['tablet'] };
 *
 * Electron's minimum window width is 800px (electron/main.ts), so these
 * stories only make sense at tablet width and up.
 *
 * The stub has no methods, so every `window.electronAPI?.foo?.()` call and
 * `hasElectronFeature()` check sees an Electron without that feature. In
 * Electron the API base URL comes from the active saved server
 * (`config/env.ts`), so this also saves one at this page's own origin: API
 * and file requests keep going to `<origin>/api/...`, where MSW answers them.
 * Both are restored when the story unmounts, so the next story in an
 * interactive Ladle tab is a browser again.
 */
import { useEffect } from 'react';
import type { ElectronAPI } from '../../types/electron-api';
import type { LadleStoryComponent } from './screenStory';

const SERVERS_KEY = 'semaphore:servers';
const ACTIVE_SERVER_KEY = 'semaphore:activeServerId';
const SERVER_ID = 'ladle-electron-server';

interface Saved {
  electronAPI: ElectronAPI | undefined;
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
function installElectron(): void {
  if (saved) return;
  saved = {
    electronAPI: window.electronAPI,
    servers: readStorage(SERVERS_KEY),
    activeServerId: readStorage(ACTIVE_SERVER_KEY),
  };
  window.electronAPI = { isElectron: true, platform: 'linux' };
  writeStorage(
    SERVERS_KEY,
    JSON.stringify([{ id: SERVER_ID, name: 'Ladle', url: window.location.origin, isActive: true }]),
  );
  writeStorage(ACTIVE_SERVER_KEY, SERVER_ID);
}

function uninstallElectron(): void {
  if (!saved) return;
  if (saved.electronAPI === undefined) delete window.electronAPI;
  else window.electronAPI = saved.electronAPI;
  writeStorage(SERVERS_KEY, saved.servers);
  writeStorage(ACTIVE_SERVER_KEY, saved.activeServerId);
  saved = null;
}

function useElectronPlatform(): void {
  // In place before the story's first render: useResponsive reads
  // isElectron() while rendering. The effect re-installs after a StrictMode
  // unmount/remount and restores the browser on the real unmount.
  installElectron();
  useEffect(() => {
    installElectron();
    return uninstallElectron;
  }, []);
}

/** Wraps a story (keeping its MSW handlers) so it renders as in Electron. */
export function asElectron(Story: LadleStoryComponent): LadleStoryComponent {
  const ElectronStory: LadleStoryComponent = () => {
    useElectronPlatform();
    return <Story />;
  };
  ElectronStory.msw = Story.msw;
  return ElectronStory;
}
