/**
 * The desktop app's update, as a store both shells read. Headless.
 *
 * AutoUpdater (App, above both shells) holds the one subscription to the Electron updater and
 * feeds this store through `connectAppUpdates`; the old shell's snackbars and the new shell's
 * banner render from `useAppUpdate()`. Outside Electron nothing connects and the state stays `none`.
 *
 * The updater downloads as soon as it finds an update (electron-updater's auto-download), so an
 * update goes `none` → `downloading` → `ready`; `error` when a download fails. The flags behind
 * `state` are kept as the old AutoUpdater kept them, so its snackbars show exactly what they did.
 */
import { useSyncExternalStore } from 'react';
import type { ElectronAPI } from '../types/electron-api';
import { logger } from '../utils/logger';

export type AppUpdateState = 'none' | 'downloading' | 'ready' | 'error';

export interface AppUpdateSnapshot {
  /** One word for the new shell's banner: `ready`, else `error`, else `downloading`, else `none`. */
  state: AppUpdateState;
  /** Downloading now (the old shell's progress snackbar). */
  downloading: boolean;
  /** Downloaded and ready to install (the old shell's restart snackbar). */
  ready: boolean;
  /** The version being downloaded or ready, when the updater said. */
  version: string | null;
  /** Download progress, 0 to 100. */
  progress: number;
  /** What went wrong, until dismissed. */
  errorMessage: string | null;
}

export interface AppUpdate extends AppUpdateSnapshot {
  /** Restarts into the downloaded update. */
  install(): void;
  /** Puts a failed update's message away. */
  dismissError(): void;
}

const INITIAL: AppUpdateSnapshot = Object.freeze({
  state: 'none',
  downloading: false,
  ready: false,
  version: null,
  progress: 0,
  errorMessage: null,
});

function stateOf({ ready, errorMessage, downloading }: Omit<AppUpdateSnapshot, 'state'>): AppUpdateState {
  if (ready) return 'ready';
  if (errorMessage !== null) return 'error';
  return downloading ? 'downloading' : 'none';
}

let snapshot: AppUpdateSnapshot = INITIAL;
let api: ElectronAPI | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<Omit<AppUpdateSnapshot, 'state'>>): void {
  const merged = { ...snapshot, ...next };
  snapshot = { ...merged, state: stateOf(merged) };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): AppUpdateSnapshot {
  return snapshot;
}

function install(): void {
  api?.quitAndInstall?.();
}

function dismissError(): void {
  if (snapshot.errorMessage !== null) set({ errorMessage: null });
}

/** Back to `none` when the subscriber goes, so the next one's first render starts fresh, as a new AutoUpdater did. */
function disconnect(electronAPI: ElectronAPI): void {
  if (api !== electronAPI) return;
  api = null;
  snapshot = INITIAL;
  listeners.forEach((listener) => listener());
}

/**
 * Subscribes the store to the Electron updater (AutoUpdater's effect). Starts from `none`, as a fresh
 * AutoUpdater did; returns the function that unsubscribes. An older desktop build without the
 * updater's events connects nothing.
 */
export function connectAppUpdates(electronAPI: ElectronAPI): () => void {
  api = electronAPI;
  snapshot = INITIAL;
  listeners.forEach((listener) => listener());
  if (
    !electronAPI.onUpdateAvailable ||
    !electronAPI.onDownloadProgress ||
    !electronAPI.onUpdateDownloaded ||
    !electronAPI.onUpdateError
  ) {
    return () => disconnect(electronAPI);
  }

  const unsubUpdateAvailable = electronAPI.onUpdateAvailable((info) => {
    logger.dev('Update available:', info);
    set({ downloading: true, version: info.version ?? null });
  });

  const unsubDownloadProgress = electronAPI.onDownloadProgress((progress) => {
    logger.dev('Download progress:', progress.percent);
    set({ progress: progress.percent });
  });

  const unsubUpdateDownloaded = electronAPI.onUpdateDownloaded((info) => {
    logger.dev('Update downloaded:', info);
    // Carries the version too: the renderer may have missed
    // update-available (e.g. it reloaded mid-download)
    set({ downloading: false, ready: true, version: info.version ?? snapshot.version });
  });

  const unsubUpdateError = electronAPI.onUpdateError((err) => {
    logger.error('Update error:', err);
    set({ downloading: false, errorMessage: err.message || 'Failed to download update' });
  });

  return () => {
    unsubUpdateAvailable();
    unsubDownloadProgress();
    unsubUpdateDownloaded();
    unsubUpdateError();
    disconnect(electronAPI);
  };
}

/** The update as it stands, with its actions. */
export function useAppUpdate(): AppUpdate {
  const current = useSyncExternalStore(subscribe, read, () => INITIAL);
  return { ...current, install, dismissError };
}
