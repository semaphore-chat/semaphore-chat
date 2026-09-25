import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isElectron,
  isWeb,
  isWayland,
  isMobile,
  isDesktopBrowser,
  getPlatform,
  hasElectronFeature,
  getElectronAPI,
  supportsScreenCapture,
  supportsSystemAudio,
  supportsMediaDevices,
  isSecureContext,
  Platform,
} from '../../utils/platform';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

describe('platform utilities', () => {
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    // A web browser unless a test installs a bridge (setup.ts clears it after each test).
    setElectronAPIOverride(null);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  describe('isElectron', () => {
    it('returns true when the Electron bridge is present', () => {
      setElectronAPIOverride({ isElectron: true });
      expect(isElectron()).toBe(true);
    });

    it('returns false when electronAPI is undefined', () => {
      expect(isElectron()).toBe(false);
    });
  });

  describe('isWeb', () => {
    it('returns true when no electronAPI is present', () => {
      expect(isWeb()).toBe(true);
    });

    it('returns false when running in electron', () => {
      setElectronAPIOverride({ isElectron: true });
      expect(isWeb()).toBe(false);
    });
  });

  describe('isWayland', () => {
    it('returns true when electron and isWayland is true', () => {
      setElectronAPIOverride({ isElectron: true, isWayland: true });
      expect(isWayland()).toBe(true);
    });

    it('returns false when not electron', () => {
      expect(isWayland()).toBe(false);
    });

    it('returns false when electron but isWayland is not set', () => {
      setElectronAPIOverride({ isElectron: true });
      expect(isWayland()).toBe(false);
    });
  });

  describe('isMobile', () => {
    it('returns true for iPhone user agent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        configurable: true,
      });
      expect(isMobile()).toBe(true);
    });

    it('returns false for desktop user agent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        configurable: true,
      });
      expect(isMobile()).toBe(false);
    });
  });

  describe('isDesktopBrowser', () => {
    it('returns true for desktop web (not electron, not mobile)', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        configurable: true,
      });
      expect(isDesktopBrowser()).toBe(true);
    });
  });

  describe('getPlatform', () => {
    it('returns Platform.ELECTRON when electron', () => {
      setElectronAPIOverride({ isElectron: true });
      expect(getPlatform()).toBe(Platform.ELECTRON);
    });

    it('returns Platform.WEB when web browser', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        configurable: true,
      });
      expect(getPlatform()).toBe(Platform.WEB);
    });

    it('returns Platform.MOBILE when mobile user agent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        configurable: true,
      });
      expect(getPlatform()).toBe(Platform.MOBILE);
    });
  });

  describe('hasElectronFeature', () => {
    it('returns true when electron and the feature function exists', () => {
      setElectronAPIOverride({
        isElectron: true,
        getDesktopSources: async () => [],
      });
      expect(hasElectronFeature('getDesktopSources')).toBe(true);
    });

    it('returns false when not electron', () => {
      expect(hasElectronFeature('getDesktopSources')).toBe(false);
    });

    it('returns false when electron but feature does not exist', () => {
      setElectronAPIOverride({ isElectron: true });
      expect(hasElectronFeature('getDesktopSources')).toBe(false);
    });
  });

  describe('getElectronAPI', () => {
    it('returns the electronAPI when in electron', () => {
      const api = createFakeElectronAPI();
      setElectronAPIOverride(api);
      expect(getElectronAPI()).toBe(api);
    });

    it('returns null when not in electron', () => {
      expect(getElectronAPI()).toBeNull();
    });
  });

  describe('supportsScreenCapture', () => {
    it('returns true in electron with getDesktopSources', () => {
      setElectronAPIOverride({
        isElectron: true,
        getDesktopSources: async () => [],
      });
      expect(supportsScreenCapture()).toBe(true);
    });

    it('returns true in web with getDisplayMedia', () => {
      // jsdom may not provide navigator.mediaDevices, so we stub the entire chain
      const originalMediaDevices = navigator.mediaDevices;
      const fakeMediaDevices = {
        getDisplayMedia: () => Promise.resolve(null),
      } as unknown as MediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', {
        value: fakeMediaDevices,
        configurable: true,
      });
      expect(supportsScreenCapture()).toBe(true);
      // restore
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
      });
    });
  });

  describe('supportsSystemAudio', () => {
    it('returns false when not in electron (web browser)', () => {
      expect(supportsSystemAudio()).toBe(false);
    });

    it('checks the bridge it is given instead of the global one', () => {
      expect(supportsSystemAudio(createFakeElectronAPI({ platform: 'win32' }))).toBe(true);
      expect(supportsSystemAudio(createFakeElectronAPI({ platform: 'linux' }))).toBe(false);
      expect(supportsSystemAudio(null)).toBe(false);
    });

    it('returns true in electron on non-linux platform', () => {
      setElectronAPIOverride({ isElectron: true, platform: 'win32' });
      expect(supportsSystemAudio()).toBe(true);
    });

    it('returns true in electron on macOS', () => {
      setElectronAPIOverride({ isElectron: true, platform: 'darwin' });
      expect(supportsSystemAudio()).toBe(true);
    });

    it('returns false in electron on linux', () => {
      setElectronAPIOverride({ isElectron: true, platform: 'linux' });
      expect(supportsSystemAudio()).toBe(false);
    });
  });

  describe('supportsMediaDevices', () => {
    it('returns true when navigator.mediaDevices.getUserMedia exists', () => {
      // jsdom may not provide navigator.mediaDevices, so we stub the entire chain
      const originalMediaDevices = navigator.mediaDevices;
      const fakeMediaDevices = {
        getUserMedia: () => Promise.resolve(null),
      } as unknown as MediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', {
        value: fakeMediaDevices,
        configurable: true,
      });
      expect(supportsMediaDevices()).toBe(true);
      // restore
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
      });
    });
  });

  describe('isSecureContext', () => {
    it('returns true when window.isSecureContext is true', () => {
      // jsdom typically sets isSecureContext based on the URL
      // localhost is considered secure context
      expect(isSecureContext()).toBe(true);
    });
  });
});
