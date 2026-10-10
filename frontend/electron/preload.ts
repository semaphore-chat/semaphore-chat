/**
 * Preload script for Electron
 *
 * This script runs in a sandboxed context with access to both Node.js APIs
 * and the web page. It uses contextBridge to securely expose APIs to the renderer.
 *
 * Security: nodeIntegration is disabled, contextIsolation is enabled
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { SecureStorageAvailability, SecureStorageStoreResult } from './secure-storage.types';
import type { DeepLinkRoute } from './deep-link-parser';

/**
 * Update information passed from main process
 */
export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

/**
 * Download progress information
 */
export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

/**
 * Desktop source information for screen capture
 */
export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id?: string;
  appIcon?: string;
}

/**
 * Notification options for Electron notifications
 */
export interface ElectronNotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
}

/**
 * API exposed to renderer process via window.electronAPI
 */
const electronAPI = {
  // Platform information
  platform: process.platform,
  isElectron: true,
  isWayland: process.platform === 'linux' && (
    !!process.env.WAYLAND_DISPLAY ||
    process.env.XDG_SESSION_TYPE === 'wayland'
  ),

  // Auto-updater events
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => {
    const subscription = (_event: IpcRendererEvent, info: UpdateInfo) => callback(info);
    ipcRenderer.on('update-available', subscription);

    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('update-available', subscription);
    };
  },

  onUpdateNotAvailable: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('update-not-available', subscription);

    return () => {
      ipcRenderer.removeListener('update-not-available', subscription);
    };
  },

  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => {
    const subscription = (_event: IpcRendererEvent, info: UpdateInfo) => callback(info);
    ipcRenderer.on('update-downloaded', subscription);

    return () => {
      ipcRenderer.removeListener('update-downloaded', subscription);
    };
  },

  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const subscription = (_event: IpcRendererEvent, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on('download-progress', subscription);

    return () => {
      ipcRenderer.removeListener('download-progress', subscription);
    };
  },

  onUpdateError: (callback: (error: Error) => void) => {
    const subscription = (_event: IpcRendererEvent, error: Error) => callback(error);
    ipcRenderer.on('update-error', subscription);

    return () => {
      ipcRenderer.removeListener('update-error', subscription);
    };
  },

  // Auto-updater actions
  checkForUpdates: () => {
    ipcRenderer.send('check-for-updates');
  },

  quitAndInstall: () => {
    ipcRenderer.send('quit-and-install');
  },

  // App version
  getAppVersion: () => {
    return ipcRenderer.invoke('get-app-version');
  },

  // Desktop capture for screen sharing
  getDesktopSources: async (types: string[] = ['window', 'screen']): Promise<DesktopSource[]> => {
    try {
      const sources = await ipcRenderer.invoke('desktop-capturer:get-sources', types);
      return sources;
    } catch (error) {
      console.error('Failed to get desktop sources:', error);
      return [];
    }
  },

  // Get screen media stream for screen sharing
  getScreenStream: async (sourceId: string): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-expect-error - Electron-specific constraint
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            maxWidth: 3840,
            minHeight: 720,
            maxHeight: 2160
          }
        }
      });
      return stream;
    } catch (error) {
      console.error('Failed to get screen stream:', error);
      return null;
    }
  },

  // Clipboard
  writeClipboard: (text: string) => {
    ipcRenderer.send('clipboard:write', text);
  },

  // Notifications
  showNotification: (options: ElectronNotificationOptions) => {
    ipcRenderer.send('notification:show', options);
  },

  clearNotifications: (tag: string) => {
    ipcRenderer.send('notification:clear', tag);
  },

  onNotificationClick: (callback: (notificationId: string) => void) => {
    const subscription = (_event: IpcRendererEvent, notificationId: string) => callback(notificationId);
    ipcRenderer.on('notification:click', subscription);

    return () => {
      ipcRenderer.removeListener('notification:click', subscription);
    };
  },

  // Settings
  getSettings: () => {
    return ipcRenderer.invoke('settings:get');
  },

  setSetting: (key: string, value: unknown) => {
    return ipcRenderer.invoke('settings:set', key, value);
  },

  // Secure token storage (OS keychain via safeStorage)
  storeRefreshToken: (token: string): Promise<SecureStorageStoreResult> => {
    return ipcRenderer.invoke('secure-storage:store', 'refreshToken', token);
  },

  getRefreshToken: (): Promise<string | null> => {
    return ipcRenderer.invoke('secure-storage:get', 'refreshToken');
  },

  deleteRefreshToken: (): Promise<void> => {
    return ipcRenderer.invoke('secure-storage:delete', 'refreshToken');
  },

  // Lets the renderer proactively check whether the OS keychain is available
  // (e.g. to surface a one-time warning) without performing a store/read.
  getSecureStorageAvailability: (): Promise<SecureStorageAvailability> => {
    return ipcRenderer.invoke('secure-storage:availability');
  },

  // Power save blocker for voice calls
  requestPowerSaveBlock: (): Promise<number> => {
    return ipcRenderer.invoke('voice:request-power-save-block');
  },

  releasePowerSaveBlock: (id: number): Promise<void> => {
    return ipcRenderer.invoke('voice:release-power-save-block', id);
  },

  // Deep links (semaphore://) — subscribe to parsed, validated routes
  // forwarded by main (see electron/deep-link-parser.ts). Main never sends
  // the raw URL, only the typed result of parsing it.
  onDeepLink: (callback: (route: DeepLinkRoute) => void) => {
    const subscription = (_event: IpcRendererEvent, route: DeepLinkRoute) => callback(route);
    ipcRenderer.on('deep-link', subscription);

    return () => {
      ipcRenderer.removeListener('deep-link', subscription);
    };
  },

  // Tell main the renderer's onDeepLink listener is now mounted, so any
  // URL that arrived before this (cold start / second-instance racing
  // startup) can be flushed. See the 'deep-link:ready' handler in main.ts.
  notifyDeepLinkReady: () => {
    ipcRenderer.send('deep-link:ready');
  },

  // Voice events into the app's log file (validated by main, see voiceLog.ts).
  logVoiceEvent: (entry: { level: 'info' | 'warn' | 'error'; event: string; data?: Record<string, unknown> }) => {
    ipcRenderer.send('voice:log', entry);
  },

  // Wake from sleep / screen unlock (powerMonitor in main): the renderer
  // re-checks its voice connection, since a lid close doesn't change the
  // window's visibility.
  onSystemResume: (callback: (event: 'resume' | 'unlock-screen') => void) => {
    const subscription = (_event: IpcRendererEvent, kind: 'resume' | 'unlock-screen') => callback(kind);
    ipcRenderer.on('system:resume', subscription);

    return () => {
      ipcRenderer.removeListener('system:resume', subscription);
    };
  },
};

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type definitions for TypeScript
export type ElectronAPI = typeof electronAPI;

// Extend Window interface
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
