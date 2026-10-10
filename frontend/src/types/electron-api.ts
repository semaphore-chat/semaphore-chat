export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id?: string;
  appIcon?: string;
}

export interface ElectronNotificationOptions {
  title: string;
  body?: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
}

/**
 * Whether the OS keychain (via Electron's `safeStorage`) is available for
 * encrypting values on this system. Mirrors `electron/secure-storage.types.ts`
 * — kept in sync manually since preload.ts and this file are compiled
 * separately (see other duplicated types below, e.g. UpdateInfo).
 */
export type SecureStorageAvailability = 'available' | 'unavailable';

/** Result of a `storeRefreshToken` call. Mirrors `electron/secure-storage.types.ts`. */
export interface SecureStorageStoreResult {
  stored: boolean;
  availability: SecureStorageAvailability;
}

/**
 * A parsed `semaphore://` deep link, as produced (and validated) by
 * `electron/deep-link-parser.ts` in the main process. Mirrored here —
 * data shape only, no parsing logic — since main.ts and this file are
 * compiled separately, same as the other duplicated types above.
 */
export type DeepLinkRoute =
  | { type: 'community'; communityId: string }
  | { type: 'channel'; communityId: string; channelId: string }
  | { type: 'dm-inbox' }
  | { type: 'dm'; dmGroupId: string }
  | { type: 'invite'; inviteCode: string };

export type SystemResumeEvent = 'resume' | 'unlock-screen';

export interface ElectronAPI {
  platform?: string;
  isElectron?: boolean;
  isWayland?: boolean;
  onUpdateAvailable?: (callback: (info: UpdateInfo) => void) => (() => void);
  onUpdateNotAvailable?: (callback: () => void) => (() => void);
  onUpdateDownloaded?: (callback: (info: UpdateInfo) => void) => (() => void);
  onDownloadProgress?: (
    callback: (progress: DownloadProgress) => void,
  ) => (() => void);
  onUpdateError?: (callback: (error: Error) => void) => (() => void);
  checkForUpdates?: () => void;
  quitAndInstall?: () => void;
  getAppVersion?: () => Promise<string>;
  getDesktopSources?: (types: string[]) => Promise<DesktopSource[]>;
  getScreenStream?: (sourceId: string) => Promise<MediaStream | null>;
  writeClipboard?: (text: string) => void;
  showNotification?: (options: ElectronNotificationOptions) => void;
  clearNotifications?: (tag: string) => void;
  onNotificationClick?: (
    callback: (notificationId: string) => void,
  ) => (() => void);
  getSettings?: () => Promise<Record<string, unknown>>;
  setSetting?: (key: string, value: unknown) => Promise<unknown>;
  storeRefreshToken?: (token: string) => Promise<SecureStorageStoreResult>;
  getRefreshToken?: () => Promise<string | null>;
  deleteRefreshToken?: () => Promise<void>;
  getSecureStorageAvailability?: () => Promise<SecureStorageAvailability>;
  requestPowerSaveBlock?: () => Promise<number>;
  releasePowerSaveBlock?: (id: number) => Promise<void>;
  // Deep links (semaphore://)
  onDeepLink?: (callback: (route: DeepLinkRoute) => void) => (() => void);
  notifyDeepLinkReady?: () => void;
  /**
   * The system woke from sleep or the screen was unlocked (Electron
   * powerMonitor `resume` / `unlock-screen`). Missing on older desktop builds.
   */
  onSystemResume?: (callback: (event: SystemResumeEvent) => void) => (() => void);
  [key: string]: unknown;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __selectedScreenSourceId?: string;
    __screenShareSettings?: {
      resolution: string;
      fps: number;
      enableAudio: boolean;
    };
  }
}
