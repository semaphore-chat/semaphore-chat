/**
 * Electron Main Process
 *
 * This is the main process for the Kraken Electron application.
 * It handles window creation, auto-updates, and IPC communication.
 */

import {
  app, BrowserWindow, ipcMain, session, desktopCapturer, Notification,
  Tray, Menu, nativeImage, screen, dialog,
} from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { initMain } from 'electron-audio-loopback';
import * as path from 'path';
import * as fs from 'fs';
import { loadSettings, getSetting, setSetting, AppSettings } from './settings';

// Enable PipeWire-based screen capture for Wayland (must be before initMain()
// so electron-audio-loopback picks it up in its feature flag merging)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
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
 * Get the path to the app icon, handling both development and packaged builds.
 * In production, electron-builder's extraResources copies pwa-512x512.png to
 * process.resourcesPath/icon.png. In development, we use public/ directly.
 */
function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(app.getAppPath(), 'public', 'pwa-512x512.png');
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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
  tray.setToolTip('Kraken');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide Kraken',
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

  tray.setContextMenu(contextMenu);

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
          label: 'About Kraken',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Kraken',
              message: `Kraken v${app.getVersion()}`,
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
    setSetting(key as keyof AppSettings, value as AppSettings[keyof AppSettings]);
    return loadSettings();
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
      // Enable preload script
      preload: path.join(__dirname, 'preload.cjs'),
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
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
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
}

/**
 * App lifecycle
 */

// When Electron has finished initialization
app.whenReady().then(() => {
  // Setup media permissions for camera, microphone, screen sharing, and fullscreen
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'display-capture', 'fullscreen'];

    if (allowedPermissions.includes(permission)) {
      console.log(`Granting permission: ${permission}`);
      callback(true);
    } else {
      console.log(`Denying permission: ${permission}`);
      callback(false);
    }
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
          const audioConfig = (DEBUG_VIDEO_ONLY || isLinux) ? undefined : (enableAudio ? 'loopback' : undefined);
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
});

// Tray keeps the app alive — don't quit when windows are hidden
app.on('window-all-closed', () => {
  // No-op: app stays alive in tray
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
  app.on('second-instance', () => {
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
  });
}
