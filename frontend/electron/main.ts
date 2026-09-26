/**
 * Electron Main Process
 *
 * This is the main process for the Semaphore Chat Electron application.
 * It handles window creation, auto-updates, and IPC communication.
 */

import {
  app, BrowserWindow, ipcMain, session, desktopCapturer, Notification,
  Tray, Menu, nativeImage, screen, dialog, safeStorage, shell,
  powerSaveBlocker, clipboard,
} from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { initMain } from 'electron-audio-loopback';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import type { SecureStorageAvailability, SecureStorageStoreResult } from './secure-storage.types';
import { parseDeepLink, extractDeepLinkUrls, DEEP_LINK_PROTOCOL, type DeepLinkRoute } from './deep-link-parser';

// ─── App Settings (single JSON file in userData) ────────────────────────────

interface AppSettings {
  closeToTray: boolean;
}

const settingsDefaults: AppSettings = { closeToTray: true };

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): AppSettings {
  try {
    return { ...settingsDefaults, ...JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')) };
  } catch {
    return { ...settingsDefaults };
  }
}

function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key];
}

function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  const settings = loadSettings();
  settings[key] = value;
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

// Enable PipeWire-based screen capture for Wayland and hardware-accelerated
// video decoding (VA-API) for HEVC/H.265 playback on Linux.
// Must be before initMain() so electron-audio-loopback picks it up in its
// feature flag merging.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features',
    'WebRTCPipeWireCapturer,VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,PlatformHEVCDecoderSupport');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
} else {
  // macOS (VideoToolbox) and Windows (DXVA) have platform HEVC decoders
  app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
}

// Initialize audio loopback for cross-platform system audio capture
// This sets up Chromium feature flags for Linux/macOS audio loopback
// Windows uses native WASAPI loopback - but initMain() must still be called
// (it was working before electron-vite when initMain() was called unconditionally)
initMain();
console.log('Electron audio loopback initialized for', process.platform);
console.log('Enable-features:', app.commandLine.getSwitchValue('enable-features'));
console.log('Disable-features:', app.commandLine.getSwitchValue('disable-features'));
console.log('Audio service flags:', {
  hasAudioServiceOutOfProcess: app.commandLine.getSwitchValue('enable-features')?.includes('AudioServiceOutOfProcess'),
  hasWebRtcAllow: app.commandLine.getSwitchValue('enable-features')?.includes('WebRtcAllow'),
});

/**
 * Detect if running on Wayland display server.
 * On Wayland, desktopCapturer.getSources() triggers the PipeWire/XDG Desktop Portal
 * dialog and returns only the user-selected source, making the custom picker redundant.
 */
function isWayland(): boolean {
  return process.platform === 'linux' && (
    !!process.env.WAYLAND_DISPLAY ||
    process.env.XDG_SESSION_TYPE === 'wayland'
  );
}

/**
 * Resolve a filesystem path to its real path (following symlinks), falling
 * back to the normalized path when it can't be resolved (e.g. doesn't exist).
 */
function toRealPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Whether a filesystem path lives inside the app's `dist` directory — the
 * directory `createWindow()` loads `index.html` from via `loadFile()` in
 * production. Compared on resolved real paths so symlinks, `..` segments and
 * Windows drive-letter casing can't bypass the check (Node's win32
 * `path.relative` compares case-insensitively).
 */
function isPathInsideAppDist(fsPath: string): boolean {
  const distDir = toRealPath(path.join(app.getAppPath(), 'dist'));
  const target = toRealPath(fsPath);
  const rel = path.relative(distDir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Determine whether a URL belongs to the app itself, as opposed to a remote
 * page loaded via window-open/will-navigate. Used to gate
 * media/display-capture/fullscreen permission grants so an unexpected
 * remote origin can never silently acquire camera/mic/screen access.
 *
 * Matches exactly how the app loads in each mode:
 * - Production: `mainWindow.loadFile(<appPath>/dist/index.html)` → a `file://`
 *   URL whose path must resolve inside the app's `dist` directory. An
 *   arbitrary `file:` URL (or a bare `file://` origin, which carries no
 *   path) is NOT the app — callers must pass the full URL for file: loads.
 * - Development: `mainWindow.loadURL('http://localhost:5173/')`.
 */
function isAppOrigin(urlOrOrigin: string): boolean {
  if (!urlOrOrigin) return false;
  try {
    const parsed = new URL(urlOrOrigin);
    if (parsed.protocol === 'file:') {
      // fileURLToPath handles platform normalization (Windows drive letters,
      // percent-decoding). It throws for a pathless origin like 'file://',
      // which correctly fails closed below.
      return isPathInsideAppDist(fileURLToPath(parsed));
    }
    if (parsed.protocol === 'http:' && parsed.hostname === 'localhost' && parsed.port === '5173') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get the path to the app icon, handling both development and packaged builds.
 * In production, electron-builder's extraResources copies build/icon.png to
 * process.resourcesPath/icon.png. In development, we use build/ directly.
 */
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(app.getAppPath(), 'build', 'icon.png');
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ─── Smoke Test Mode (CI PR builds, electron-smoke.yml) ────────────────────
// With --smoke-test, quit as soon as the main window fires ready-to-show
// instead of staying open, so CI can verify the app launches without keeping
// a headless runner alive. If ready-to-show never fires (e.g. a packaging or
// main-process regression), exit non-zero after a 15s safety timeout.
const isSmokeTest = process.argv.includes('--smoke-test');
if (isSmokeTest) {
  // Default to a failing exit code up front so ANY exit before the explicit
  // ready-to-show success path (e.g. a clean quit via window-all-closed)
  // reports failure instead of a false-green 0.
  process.exitCode = 1;
  // Intentionally not .unref()'d: this timer must keep the process alive so
  // a hung app (ready-to-show never fires) is still forcibly exited 1 at
  // 15s instead of running past CI's step timeout.
  setTimeout(() => {
    console.error('[smoke-test] ready-to-show did not fire within 15s, exiting 1');
    app.exit(1);
  }, 15000);
}

// Track active notifications
const activeNotifications = new Map<string, Notification>();

// ─── Window State Persistence ───────────────────────────────────────────────

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  const defaults: WindowState = { width: 1280, height: 800, isMaximized: false };
  try {
    const data = fs.readFileSync(getWindowStatePath(), 'utf-8');
    const state: WindowState = JSON.parse(data);

    // Validate that the stored position is on a visible display
    if (state.x !== undefined && state.y !== undefined) {
      const displays = screen.getAllDisplays();
      const visible = displays.some(display => {
        const { x, y, width, height } = display.bounds;
        return (
          state.x! >= x &&
          state.x! < x + width &&
          state.y! >= y &&
          state.y! < y + height
        );
      });
      if (!visible) {
        // Position is off-screen, reset to default (centered)
        delete state.x;
        delete state.y;
      }
    }

    return { ...defaults, ...state };
  } catch {
    return defaults;
  }
}

function saveWindowState(): void {
  if (!mainWindow) return;
  const isMaximized = mainWindow.isMaximized();
  // Save the normal (non-maximized) bounds so restore works properly
  const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  };
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

// ─── System Tray ────────────────────────────────────────────────────────────

/**
 * Rebuild both app menu and tray context menu to reflect current settings.
 * Called after any setting change so all menus stay in sync.
 */
function rebuildMenus(): void {
  setupApplicationMenu();
  if (tray) {
    tray.setContextMenu(buildTrayContextMenu());
  }
}

function buildTrayContextMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Show/Hide Semaphore Chat',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Close to Tray',
      type: 'checkbox',
      checked: getSetting('closeToTray'),
      click: (menuItem: Electron.MenuItem) => {
        setSetting('closeToTray', menuItem.checked);
        rebuildMenus();
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => {
        autoUpdater.checkForUpdates().catch((err: Error) => {
          console.error('Failed to check for updates:', err);
        });
      },
    },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function setupTray(): void {
  const iconPath = getIconPath();
  let trayIcon: Electron.NativeImage;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    const traySize = process.platform === 'linux' ? 22 : 16;
    trayIcon = trayIcon.resize({ width: traySize, height: traySize });
  } catch {
    // Fallback to empty icon if file not found
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Semaphore Chat');
  tray.setContextMenu(buildTrayContextMenu());

  // On Linux/Windows, clicking the tray icon toggles window visibility
  // macOS uses the dock icon for this (via 'activate' event)
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }
}

// ─── Application Menu ───────────────────────────────────────────────────────

function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        {
          label: 'Close to Tray',
          type: 'checkbox' as const,
          checked: getSetting('closeToTray'),
          click: (menuItem: Electron.MenuItem) => {
            setSetting('closeToTray', menuItem.checked);
            rebuildMenus();
          },
        },
        { type: 'separator' as const },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => { isQuitting = true; app.quit(); },
        },
      ],
    }] : []),
    // File menu (non-macOS)
    ...(!isMac ? [{
      label: 'File',
      submenu: [
        {
          label: 'Close to Tray',
          type: 'checkbox' as const,
          checked: getSetting('closeToTray'),
          click: (menuItem: Electron.MenuItem) => {
            setSetting('closeToTray', menuItem.checked);
            rebuildMenus();
          },
        },
        { type: 'separator' as const },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => { isQuitting = true; app.quit(); },
        },
      ],
    }] : []),
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Semaphore Chat',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Semaphore Chat',
              message: `Semaphore Chat v${app.getVersion()}`,
              detail: 'Self-hosted voice and text chat.',
            });
          },
        },
        {
          label: 'Check for Updates',
          click: () => {
            autoUpdater.checkForUpdates().catch((err: Error) => {
              console.error('Failed to check for updates:', err);
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Configure auto-updater
 */
function setupAutoUpdater() {
  // Don't check for updates in development
  if (process.env.NODE_ENV === 'development') {
    console.log('Auto-updater disabled in development mode');
    return;
  }

  // Configure auto-updater logging
  autoUpdater.logger = console;

  // Explicitly set feed URL to ensure correct GitHub owner (with hyphen)
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'semaphore-chat',
    repo: 'semaphore-chat',
  });

  // Auto-updater events
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('Update available:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('Update not available:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available');
    }
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('Error in auto-updater:', err);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', err);
    }
  });

  autoUpdater.on('download-progress', (progressObj: ProgressInfo) => {
    console.log(`Download progress: ${progressObj.percent}%`);
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('Update downloaded:', info);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  // Check for updates on startup (after 3 seconds to let app initialize)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('Failed to check for updates:', err);
    });
  }, 3000);

  // Check for updates every hour
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error('Failed to check for updates:', err);
    });
  }, 60 * 60 * 1000);
}

/**
 * Setup IPC handlers
 */
function setupIpcHandlers() {
  // Check for updates manually
  ipcMain.on('check-for-updates', () => {
    if (process.env.NODE_ENV !== 'development') {
      autoUpdater.checkForUpdates().catch((err: Error) => {
        console.error('Failed to check for updates:', err);
      });
    }
  });

  // Quit and install update
  ipcMain.on('quit-and-install', () => {
    if (process.env.NODE_ENV !== 'development') {
      autoUpdater.quitAndInstall();
    }
  });

  // Get app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Desktop capture handlers for screen sharing
  ipcMain.handle('desktop-capturer:get-sources', async (_event, types: string[]) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: types as ('window' | 'screen')[],
        thumbnailSize: { width: 320, height: 240 },
        fetchWindowIcons: true
      });

      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        display_id: source.display_id,
        appIcon: source.appIcon ? source.appIcon.toDataURL() : undefined
      }));
    } catch (error) {
      console.error('Failed to get desktop sources:', error);
      throw error;
    }
  });

  // Notification handlers
  ipcMain.on('notification:show', (_event, options: {
    title: string;
    body?: string;
    icon?: string;
    tag?: string;
    silent?: boolean;
  }) => {
    try {
      const notification = new Notification({
        title: options.title,
        body: options.body,
        icon: options.icon,
        silent: options.silent || false,
      });

      // Store notification by tag for management
      if (options.tag) {
        activeNotifications.set(options.tag, notification);
      }

      // Handle notification click
      notification.on('click', () => {
        // Show and focus the main window (may be hidden to tray)
        if (mainWindow) {
          if (!mainWindow.isVisible()) {
            mainWindow.show();
          }
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.focus();

          // Send click event to renderer with notification ID
          if (options.tag) {
            mainWindow.webContents.send('notification:click', options.tag);
          }
        }
      });

      // Show the notification
      notification.show();

      // Clean up after notification is closed
      notification.on('close', () => {
        if (options.tag) {
          activeNotifications.delete(options.tag);
        }
      });
    } catch (error) {
      console.error('Failed to show notification:', error);
    }
  });

  // Clear notifications by tag
  ipcMain.on('notification:clear', (_event, tag: string) => {
    const notification = activeNotifications.get(tag);
    if (notification) {
      notification.close();
      activeNotifications.delete(tag);
    }
  });

  // Settings handlers
  ipcMain.handle('settings:get', () => {
    return loadSettings();
  });

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    const current = loadSettings();
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      throw new Error(`Invalid settings key: ${key}`);
    }
    setSetting(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
    rebuildMenus();
    return loadSettings();
  });

  // Secure storage handlers — encrypt refresh token via OS keychain
  const secureStoragePath = path.join(app.getPath('userData'), 'secure-tokens');

  // Lets the renderer proactively check encryption availability (e.g. to
  // surface a warning) without performing a store/read operation.
  ipcMain.handle('secure-storage:availability', (): SecureStorageAvailability => {
    return safeStorage.isEncryptionAvailable() ? 'available' : 'unavailable';
  });

  ipcMain.handle('secure-storage:store', async (_event, key: string, value: string): Promise<SecureStorageStoreResult> => {
    const availability: SecureStorageAvailability = safeStorage.isEncryptionAvailable()
      ? 'available'
      : 'unavailable';

    if (availability === 'unavailable') {
      console.warn('safeStorage encryption not available, falling back to renderer localStorage');
      return { stored: false, availability };
    }

    try {
      const encrypted = safeStorage.encryptString(value);
      if (!fs.existsSync(secureStoragePath)) {
        fs.mkdirSync(secureStoragePath, { recursive: true });
      }
      fs.writeFileSync(path.join(secureStoragePath, key), encrypted);
      return { stored: true, availability };
    } catch (error) {
      console.error('Failed to store secure token:', error);
      return { stored: false, availability };
    }
  });

  // Note: get/delete deliberately keep their original null/void contract
  // (unlike `store` above, which now returns a typed SecureStorageStoreResult).
  // Callers already treat a null/failed read or delete as "nothing to do"
  // and don't need availability detail here — only `store` needed a typed
  // result, since that's the operation that decides whether to fall back to
  // localStorage and warn the user.
  ipcMain.handle('secure-storage:get', async (_event, key: string) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }
      const filePath = path.join(secureStoragePath, key);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const encrypted = fs.readFileSync(filePath);
      return safeStorage.decryptString(encrypted);
    } catch (error) {
      console.error('Failed to read secure token:', error);
      return null;
    }
  });

  ipcMain.handle('secure-storage:delete', async (_event, key: string) => {
    try {
      const filePath = path.join(secureStoragePath, key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error('Failed to delete secure token:', error);
    }
  });

  // Power save blocker for voice calls — prevents OS-level suspension
  let activePowerSaveId: number | null = null;

  ipcMain.handle('voice:request-power-save-block', () => {
    if (activePowerSaveId !== null && powerSaveBlocker.isStarted(activePowerSaveId)) {
      return activePowerSaveId;
    }
    activePowerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    return activePowerSaveId;
  });

  ipcMain.handle('voice:release-power-save-block', (_event, id: number) => {
    if (typeof id === 'number' && powerSaveBlocker.isStarted(id)) {
      powerSaveBlocker.stop(id);
      if (activePowerSaveId === id) {
        activePowerSaveId = null;
      }
    }
  });

  // Clipboard. Electron 44 made clipboard.writeText async (Promise<void>);
  // catch a rejection so it can't surface as an unhandled rejection in main.
  ipcMain.on('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text).catch((error: unknown) => {
      console.error('Failed to write to clipboard:', error);
    });
  });

  // Deep links: renderer signals once its `onDeepLink` listener is mounted
  // so any URL that arrived before then (cold start, second-instance) can
  // be delivered without being lost to a race. Idempotent — once flushed,
  // the queue is empty, so a later resend (e.g. dev HMR remount) is a no-op.
  ipcMain.on('deep-link:ready', () => {
    flushPendingDeepLinks();
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(windowState.x !== undefined && windowState.y !== undefined
      ? { x: windowState.x, y: windowState.y }
      : {}),
    minWidth: 800,
    minHeight: 600,
    icon: getIconPath(),
    webPreferences: {
      // Security: disable node integration
      nodeIntegration: false,
      // Security: enable context isolation
      contextIsolation: true,
      // Security: explicitly enable the OS-level renderer sandbox (Chromium's
      // process sandbox). Electron defaults to sandbox: true already when
      // nodeIntegration is false, but pin it explicitly so this doesn't
      // silently change if Electron's defaults ever do. The preload script
      // only uses contextBridge/ipcRenderer plus the polyfilled `process`
      // global (platform/env), all of which remain available under sandbox.
      sandbox: true,
      // Enable preload script
      preload: path.join(__dirname, 'preload.cjs'),
      // Keep timers and audio running when window is hidden/minimized
      backgroundThrottling: false,
    },
    // Enable fullscreen for HTML5 video elements
    fullscreenable: true,
    // Better default window style
    backgroundColor: '#1a1a1a',
    show: false, // Don't show until ready
  });

  // Restore maximized state after window is created
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // Show window when ready to prevent flashing
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isSmokeTest) {
      console.log('[smoke-test] ready-to-show fired, exiting 0');
      app.exit(0);
    }
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    // `pnpm run electron-dev` binds Vite to 127.0.0.1 so its wait-on (an IPv4
    // probe) can't miss a server Node put on ::1. Chromium resolves
    // `localhost` to both loopback addresses, and this origin is the one
    // isAppOrigin() trusts and the backend's default CORS origin.
    const devUrl = 'http://localhost:5173/';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built files directly
    const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  // Debounced window state save for resize/move events
  let saveTimeout: NodeJS.Timeout | null = null;
  const debouncedSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveWindowState, 500);
  };

  mainWindow.on('resize', debouncedSave);
  mainWindow.on('move', debouncedSave);

  // Hide to tray instead of closing (unless quitting or closeToTray is disabled)
  mainWindow.on('close', (event) => {
    saveWindowState();
    if (!isQuitting && getSetting('closeToTray')) {
      event.preventDefault();
      mainWindow!.hide();
    }
  });

  // Handle window destroyed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open target="_blank" links in the OS default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        void shell.openExternal(url);
      }
    } catch { /* ignore invalid URLs */ }
    return { action: 'deny' };
  });

  // Catch in-page navigation to external URLs and open them in the default browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      // Allow navigation to the app's own URLs (localhost in dev, file:// in prod)
      if (parsedUrl.protocol === 'file:') return;
      if (parsedUrl.hostname === 'localhost') return;
      event.preventDefault();
      if (['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol)) {
        void shell.openExternal(url);
      }
    } catch { /* ignore invalid URLs */ }
  });
}

// ─── Deep Links (semaphore://) ──────────────────────────────────────────────
//
// URLs arriving before the renderer confirms its `onDeepLink` listener is
// mounted (cold start; a second-instance launch that races window/renderer
// startup) are queued here and flushed on the explicit 'deep-link:ready'
// IPC sent by useDeepLinks (see setupIpcHandlers below) rather than on
// `did-finish-load` — did-finish-load fires once the page's scripts have
// loaded, which is before React has mounted and useDeepLinks has actually
// subscribed, so flushing there risks losing the very first link.
let rendererDeepLinkReady = false;
const pendingDeepLinks: DeepLinkRoute[] = [];

/** Forward a parsed route to the renderer and surface the window. Never navigates the BrowserWindow itself. */
function deliverDeepLink(route: DeepLinkRoute): void {
  if (!mainWindow) return;
  mainWindow.webContents.send('deep-link', route);
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/** Parse+validate a raw URL and either deliver it now or queue it until the renderer is ready. */
function handleDeepLinkUrl(rawUrl: string): void {
  const route = parseDeepLink(rawUrl);
  if (!route) {
    console.warn('[deep-link] dropped malformed/hostile URL:', String(rawUrl).slice(0, 200));
    return;
  }
  if (rendererDeepLinkReady) {
    deliverDeepLink(route);
    return;
  }
  pendingDeepLinks.push(route);
  // Surface the (still-loading) window so the user sees the app respond.
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
}

function flushPendingDeepLinks(): void {
  rendererDeepLinkReady = true;
  while (pendingDeepLinks.length > 0) {
    deliverDeepLink(pendingDeepLinks.shift()!);
  }
}

// Register the OS protocol handler as early as possible (before
// whenReady — macOS can fire 'open-url' prior to it). In dev, Electron is
// launched as `electron .`, so the OS needs the interpreter path
// (execPath) plus the resolved script arg to relaunch this app correctly;
// without that form, dev-mode registration silently no-ops on
// Windows/Linux.
if (!app.isPackaged && process.argv[1]) {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
}

// macOS delivers the URL via this event.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
});

/**
 * App lifecycle
 */

// When Electron has finished initialization
app.whenReady().then(() => {
  // Setup media permissions for camera, microphone, screen sharing, and fullscreen.
  // Origin-checked: only the app's own page (file:// in packaged prod,
  // http://localhost:5173 in dev) may be granted these — never a remote
  // origin that ended up loaded via window-open/will-navigate edge cases.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowedPermissions = ['media', 'display-capture', 'fullscreen'];
    const requestingUrl = details.requestingUrl || webContents.getURL();

    if (allowedPermissions.includes(permission) && isAppOrigin(requestingUrl)) {
      console.log(`Granting permission: ${permission} (origin: ${requestingUrl})`);
      callback(true);
    } else {
      console.log(`Denying permission: ${permission} (origin: ${requestingUrl})`);
      callback(false);
    }
  });

  // Permission checks (synchronous, used e.g. for already-granted-permission
  // queries) must apply the same origin policy as the request handler above —
  // otherwise a check could report "allowed" for a permission the request
  // handler would actually deny.
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowedPermissions = ['media', 'display-capture', 'fullscreen'];
    // A file: *origin* carries no path, but isAppOrigin's file: branch needs
    // the path to verify the page actually lives in the app's dist directory.
    // For file: loads, evaluate the webContents' full URL instead, so this
    // handler applies exactly the same policy as the request handler above.
    // If no webContents is available the bare file:// origin fails closed.
    let requestingUrl = requestingOrigin || webContents?.getURL() || '';
    if (requestingUrl.startsWith('file:') && webContents) {
      requestingUrl = webContents.getURL() || requestingUrl;
    }
    const allowed = allowedPermissions.includes(permission) && isAppOrigin(requestingUrl);

    if (!allowed) {
      console.log(`Denying permission check: ${permission} (origin: ${requestingOrigin || requestingUrl})`);
    }

    return allowed;
  });

  // Handle screen sharing requests from LiveKit
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // Helper to log to both main process and renderer DevTools
    const log = (msg: string, ...args: unknown[]) => {
      console.log(msg, ...args);
      mainWindow?.webContents.executeJavaScript(
        `console.log('[Electron Main]', ${JSON.stringify(msg)}, ${args.map(a => JSON.stringify(a)).join(', ')})`
      );
    };

    log('=== Screen Share Request ===');
    log('Platform:', process.platform);
    log('Electron version:', process.versions.electron);
    log('Chrome version:', process.versions.chrome);
    log('Request videoRequested:', request.videoRequested);
    log('Request audioRequested:', request.audioRequested);
    log('Request securityOrigin:', request.securityOrigin);
    log('Request frame:', request.frame ? 'present' : 'null');

    try {
      if (isWayland()) {
        // On Wayland, desktopCapturer.getSources() triggers the PipeWire portal
        // and returns the single source the user selected — no custom picker needed
        log('Wayland detected, using PipeWire portal for source selection');
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        if (sources.length > 0) {
          log('PipeWire portal returned source:', sources[0].name, sources[0].id);
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          log('PipeWire portal returned no sources (user cancelled or no PipeWire)');
          callback({});
        }
        return;
      }

      // Check if the renderer has pre-selected a sourceId and settings (from React UI)
      const selectedSourceId = await mainWindow?.webContents.executeJavaScript(
        'window.__selectedScreenSourceId'
      );

      const settings = await mainWindow?.webContents.executeJavaScript(
        'window.__screenShareSettings'
      );

      log('Pre-selected source ID:', selectedSourceId);
      log('Screen share settings:', JSON.stringify(settings, null, 2));

      if (selectedSourceId) {
        // Clear the selected sourceId and settings
        mainWindow?.webContents.executeJavaScript('delete window.__selectedScreenSourceId');
        mainWindow?.webContents.executeJavaScript('delete window.__screenShareSettings');

        // Get all sources to find the selected one
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 240 },
          fetchWindowIcons: true
        });

        log('Available sources:', sources.map(s => ({ id: s.id, name: s.name })));

        const selectedSource = sources.find(s => s.id === selectedSourceId);

        if (selectedSource) {
          log('Selected source:', selectedSource.name, selectedSource.id);

          // Use settings to determine audio configuration
          const enableAudio = settings?.enableAudio !== false; // Default to true if not specified

          // DEBUG: Set to true to test video-only capture (bypasses audio loopback)
          const DEBUG_VIDEO_ONLY = false;

          // Safety net: never attempt loopback on Linux (restrictOwnAudio not supported by OS)
          const isLinux = process.platform === 'linux';
          const audioConfig = (DEBUG_VIDEO_ONLY || isLinux) ? undefined : (enableAudio ? 'loopbackWithoutChrome' as 'loopback' : undefined);
          log('Audio enabled from settings:', enableAudio);
          log('DEBUG_VIDEO_ONLY:', DEBUG_VIDEO_ONLY);
          log('Final audio config:', audioConfig);
          log('Source type:', selectedSource.id.startsWith('screen:') ? 'screen' : 'window');

          try {
            callback({
              video: selectedSource,
              audio: audioConfig,
            });
            log('Callback invoked successfully');
          } catch (callbackError) {
            log('ERROR: Callback threw:', String(callbackError));
            callback({});
          }
        } else {
          log('ERROR: Selected source not found:', selectedSourceId);
          callback({});
        }
      } else {
        // No source was pre-selected - fallback: auto-select the primary screen
        log('No source pre-selected, auto-selecting primary screen');

        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 240 },
          fetchWindowIcons: true
        });

        log('Available sources:', sources.map(s => ({ id: s.id, name: s.name })));

        // Prefer a screen source over a window
        const primaryScreen = sources.find(s => s.id.startsWith('screen:')) || sources[0];

        if (primaryScreen) {
          log('Auto-selected source:', primaryScreen.name, primaryScreen.id);
          log('Audio config: loopback');
          log('Source type:', primaryScreen.id.startsWith('screen:') ? 'screen' : 'window');

          try {
            callback({
              video: primaryScreen,
              audio: 'loopback',
            });
            log('Callback invoked successfully');
          } catch (callbackError) {
            log('ERROR: Callback threw:', String(callbackError));
            callback({});
          }
        } else {
          log('ERROR: No screen sources available');
          callback({});
        }
      }
    } catch (error) {
      log('ERROR: Failed to get screen source:', String(error));
      callback({});
    }
  });

  createWindow();
  setupTray();
  setupApplicationMenu();
  setupAutoUpdater();
  setupIpcHandlers();

  // Cold start: Windows/Linux deliver a semaphore:// URL as an argv entry
  // on the process that just launched (rather than a second-instance
  // relaunch). The renderer isn't ready yet, so this queues.
  extractDeepLinkUrls(process.argv).forEach(handleDeepLinkUrl);

  // CI smoke test (electron-build.yml): print a readiness marker and exit.
  // CI must assert this positive signal rather than process liveness — an
  // uncaught main-process exception leaves the process alive behind
  // Electron's error dialog (how the v0.4.0-v0.4.2 Windows startup crash
  // shipped despite green builds).
  if (process.env.ELECTRON_SMOKE === '1') {
    console.log('ELECTRON_SMOKE_OK');
    app.exit(0);
  }
});

// Tray keeps the app alive — don't quit when windows are hidden
app.on('window-all-closed', () => {
  if (!getSetting('closeToTray')) {
    app.quit();
  }
});

// Set isQuitting flag before the app starts closing windows
app.on('before-quit', () => {
  isQuitting = true;
});

// On macOS, show existing window when dock icon is clicked
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Show and focus the main window if user tries to open another instance
    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    // Windows/Linux deliver semaphore:// URLs as an argv entry on relaunch.
    extractDeepLinkUrls(argv).forEach(handleDeepLinkUrl);
  });
}
