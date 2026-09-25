import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asElectronAPI, getElectronAPI, setElectronAPIOverride } from '../../utils/electronBridge';
import { isElectron } from '../../utils/platform';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

// The one test (with electronBridge.ts itself) that touches window.electronAPI:
// it checks the adapter reads the real preload bridge. Everything else fakes
// the bridge with setElectronAPIOverride() or <ElectronProvider>.
describe('electronBridge', () => {
  beforeEach(() => {
    delete window.electronAPI;
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  describe('getElectronAPI (no override)', () => {
    it('returns null when the preload bridge is absent (web browser)', () => {
      expect(getElectronAPI()).toBeNull();
      expect(isElectron()).toBe(false);
    });

    it("returns window.electronAPI when it's the Electron bridge", () => {
      const api = { isElectron: true, platform: 'darwin' };
      window.electronAPI = api;
      expect(getElectronAPI()).toBe(api);
      expect(isElectron()).toBe(true);
    });

    it('returns null for an object that does not say isElectron: true', () => {
      window.electronAPI = { platform: 'linux' };
      expect(getElectronAPI()).toBeNull();
    });
  });

  describe('setElectronAPIOverride', () => {
    it('replaces the bridge with the given API', () => {
      window.electronAPI = { isElectron: true };
      const fake = createFakeElectronAPI();
      setElectronAPIOverride(fake);
      expect(getElectronAPI()).toBe(fake);
    });

    it('null behaves as a web browser even when window.electronAPI is set', () => {
      window.electronAPI = { isElectron: true };
      setElectronAPIOverride(null);
      expect(getElectronAPI()).toBeNull();
      expect(isElectron()).toBe(false);
    });

    it('undefined removes the override and reads window.electronAPI again', () => {
      const real = { isElectron: true };
      window.electronAPI = real;
      setElectronAPIOverride(createFakeElectronAPI());
      setElectronAPIOverride(undefined);
      expect(getElectronAPI()).toBe(real);
    });

    it('an override without isElectron: true counts as no bridge', () => {
      setElectronAPIOverride({ platform: 'win32' });
      expect(getElectronAPI()).toBeNull();
    });
  });

  describe('asElectronAPI', () => {
    it('keeps an Electron bridge and maps anything else to null', () => {
      const api = createFakeElectronAPI();
      expect(asElectronAPI(api)).toBe(api);
      expect(asElectronAPI({ isElectron: false })).toBeNull();
      expect(asElectronAPI(null)).toBeNull();
      expect(asElectronAPI(undefined)).toBeNull();
    });
  });

  describe('createFakeElectronAPI', () => {
    it('implements every bridge method with harmless defaults', async () => {
      const api = createFakeElectronAPI();
      expect(api.isElectron).toBe(true);
      expect(api.platform).toBe('linux');
      expect(api.onUpdateAvailable(() => {})).toBeTypeOf('function');
      expect(api.onDeepLink(() => {})).toBeTypeOf('function');
      await expect(api.getDesktopSources(['screen'])).resolves.toEqual([]);
      await expect(api.getRefreshToken()).resolves.toBeNull();
      await expect(api.storeRefreshToken('t')).resolves.toEqual({ stored: true, availability: 'available' });
      expect(() => api.quitAndInstall()).not.toThrow();
    });

    it('applies overrides', () => {
      const api = createFakeElectronAPI({ platform: 'win32', isWayland: true });
      expect(api.platform).toBe('win32');
      expect(api.isWayland).toBe(true);
    });
  });
});
