import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getElectronRefreshToken,
  storeElectronRefreshToken,
  clearTokens,
  setAccessToken,
  getAccessToken,
} from '../../utils/tokenService';

describe('tokenService — Electron secure storage', () => {
  let originalElectronAPI: typeof window.electronAPI;

  beforeEach(() => {
    originalElectronAPI = window.electronAPI;
    clearTokens();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.electronAPI = originalElectronAPI;
    localStorage.clear();
  });

  // ─── getElectronRefreshToken ──────────────────────────────────

  describe('getElectronRefreshToken', () => {
    it('should return token from secure storage when available', async () => {
      window.electronAPI = {
        getRefreshToken: vi.fn().mockResolvedValue('secure-token'),
      };

      const token = await getElectronRefreshToken();
      expect(token).toBe('secure-token');
      expect(window.electronAPI.getRefreshToken).toHaveBeenCalled();
    });

    it('should fall back to localStorage when secure storage returns null', async () => {
      window.electronAPI = {
        getRefreshToken: vi.fn().mockResolvedValue(null),
      };
      localStorage.setItem('refreshToken', 'legacy-token');

      const token = await getElectronRefreshToken();
      expect(token).toBe('legacy-token');
    });

    it('should fall back to localStorage when getRefreshToken is not available', async () => {
      window.electronAPI = {};
      localStorage.setItem('refreshToken', 'legacy-token');

      const token = await getElectronRefreshToken();
      expect(token).toBe('legacy-token');
    });

    it('should fall back to localStorage when electronAPI is undefined', async () => {
      window.electronAPI = undefined;
      localStorage.setItem('refreshToken', 'legacy-token');

      const token = await getElectronRefreshToken();
      expect(token).toBe('legacy-token');
    });

    it('should return null when no token exists anywhere', async () => {
      window.electronAPI = {
        getRefreshToken: vi.fn().mockResolvedValue(null),
      };

      const token = await getElectronRefreshToken();
      expect(token).toBeNull();
    });

    it('should return null when electronAPI is undefined and localStorage is empty', async () => {
      window.electronAPI = undefined;

      const token = await getElectronRefreshToken();
      expect(token).toBeNull();
    });
  });

  // ─── storeElectronRefreshToken ────────────────────────────────

  describe('storeElectronRefreshToken', () => {
    it('should store in secure storage when available', async () => {
      const mockStore = vi.fn().mockResolvedValue(undefined);
      window.electronAPI = {
        storeRefreshToken: mockStore,
      };

      await storeElectronRefreshToken('new-token');

      expect(mockStore).toHaveBeenCalledWith('new-token');
    });

    it('should remove localStorage entry after storing in secure storage', async () => {
      localStorage.setItem('refreshToken', 'legacy-token');
      window.electronAPI = {
        storeRefreshToken: vi.fn().mockResolvedValue(undefined),
      };

      await storeElectronRefreshToken('new-token');

      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('should fall back to localStorage when storeRefreshToken is not available', async () => {
      window.electronAPI = {};

      await storeElectronRefreshToken('fallback-token');

      expect(localStorage.getItem('refreshToken')).toBe('fallback-token');
    });

    it('should fall back to localStorage when electronAPI is undefined', async () => {
      window.electronAPI = undefined;

      await storeElectronRefreshToken('fallback-token');

      expect(localStorage.getItem('refreshToken')).toBe('fallback-token');
    });
  });

  // ─── clearTokens (Electron integration) ──────────────────────

  describe('clearTokens with Electron', () => {
    it('should call deleteRefreshToken when available', () => {
      const mockDelete = vi.fn().mockResolvedValue(undefined);

      // Mock isElectron to return true
      window.electronAPI = {
        isElectron: true,
        deleteRefreshToken: mockDelete,
      };

      setAccessToken('some-token');
      clearTokens();

      expect(getAccessToken()).toBeNull();
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should clear localStorage refreshToken even without electronAPI', () => {
      window.electronAPI = undefined;
      localStorage.setItem('refreshToken', 'rt');

      clearTokens();

      expect(localStorage.getItem('refreshToken')).toBeNull();
    });
  });
});
