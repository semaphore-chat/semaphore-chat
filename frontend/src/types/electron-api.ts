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
