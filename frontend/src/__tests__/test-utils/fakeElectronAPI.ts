/**
 * A complete, harmless fake of the Electron bridge (`ElectronAPI`, what
 * `electron/preload.ts` exposes as `window.electronAPI`), for Vitest and the
 * Ladle sandbox. No test-runner imports, so stories can use it too; the app
 * itself never imports it.
 *
 * Every method exists: queries resolve to neutral values, actions do nothing,
 * and `on*` subscriptions never fire and return an unsubscribe function.
 * Override what the test or story cares about:
 *
 *   // Non-React code (tokenService, notifications, isElectron()):
 *   const api = createFakeElectronAPI({ getRefreshToken: vi.fn().mockResolvedValue('rt') });
 *   setElectronAPIOverride(api);          // undo: setElectronAPIOverride(undefined)
 *   expect(api.getRefreshToken).toHaveBeenCalled();
 *
 *   // A component or hook that uses useElectronAPI():
 *   render(<ElectronProvider api={createFakeElectronAPI({ quitAndInstall })}>...</ElectronProvider>);
 *
 * `src/__tests__/setup.ts` clears the override after every test.
 */

import type {
  DesktopSource,
  ElectronAPI,
  SecureStorageStoreResult,
} from '../../types/electron-api';

/** `ElectronAPI` with every member present (and no index signature). */
export type CompleteElectronAPI = {
  [K in keyof ElectronAPI as string extends K ? never : K]-?: Exclude<ElectronAPI[K], undefined>;
};

const noop = () => {};
const subscribe = () => noop;

/**
 * A fake Electron bridge (`isElectron: true`, Linux, X11). Overrides replace
 * the defaults and keep their own types, so `vi.fn()` overrides can be
 * asserted on through the returned object.
 */
export function createFakeElectronAPI<O extends Partial<ElectronAPI> = Record<never, never>>(
  overrides?: O,
): CompleteElectronAPI & O {
  const defaults: CompleteElectronAPI = {
    platform: 'linux',
    isElectron: true,
    isWayland: false,
    onUpdateAvailable: subscribe,
    onUpdateNotAvailable: subscribe,
    onUpdateDownloaded: subscribe,
    onDownloadProgress: subscribe,
    onUpdateError: subscribe,
    checkForUpdates: noop,
    quitAndInstall: noop,
    getAppVersion: () => Promise.resolve('0.0.0'),
    getDesktopSources: () => Promise.resolve<DesktopSource[]>([]),
    getScreenStream: () => Promise.resolve(null),
    writeClipboard: noop,
    showNotification: noop,
    clearNotifications: noop,
    onNotificationClick: subscribe,
    getSettings: () => Promise.resolve({}),
    setSetting: () => Promise.resolve(undefined),
    storeRefreshToken: () =>
      Promise.resolve<SecureStorageStoreResult>({ stored: true, availability: 'available' }),
    getRefreshToken: () => Promise.resolve(null),
    deleteRefreshToken: () => Promise.resolve(),
    getSecureStorageAvailability: () => Promise.resolve('available' as const),
    requestPowerSaveBlock: () => Promise.resolve(1),
    releasePowerSaveBlock: () => Promise.resolve(),
    onDeepLink: subscribe,
    notifyDeepLinkReady: noop,
  };
  return { ...defaults, ...overrides } as CompleteElectronAPI & O;
}

/**
 * An `on*` subscription that calls its callback with `value` as soon as it's
 * subscribed (synchronously), e.g. to show the "update downloaded" state:
 *
 *   createFakeElectronAPI({ onUpdateDownloaded: emitOnSubscribe({ version: '2.0.0' }) })
 */
export function emitOnSubscribe<T>(value: T): (callback: (value: T) => void) => () => void {
  return (callback) => {
    callback(value);
    return noop;
  };
}
