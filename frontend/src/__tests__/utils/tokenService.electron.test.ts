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
  onSecureStorageWarning,
  consumePendingSecureStorageWarning,
} from '../../utils/tokenService';
import { logger } from '../../utils/logger';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

describe('tokenService — Electron secure storage', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ─── getElectronRefreshToken ──────────────────────────────────

  describe('getElectronRefreshToken', () => {
    it('should return token from secure storage when available', async () => {
      const api = createFakeElectronAPI({
        getRefreshToken: vi.fn().mockResolvedValue('secure-token'),
      });
      setElectronAPIOverride(api);

      const token = await getElectronRefreshToken();
      expect(token).toBe('secure-token');
      expect(api.getRefreshToken).toHaveBeenCalled();
    });

    it('should fall back to localStorage when secure storage returns null', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        getRefreshToken: vi.fn().mockResolvedValue(null),
      }));
      localStorage.setItem('refreshToken', 'legacy-token');

      const token = await getElectronRefreshToken();
      expect(token).toBe('legacy-token');
    });

    it('should fall back to localStorage when getRefreshToken is not available', async () => {
      setElectronAPIOverride({ isElectron: true });
      localStorage.setItem('refreshToken', 'legacy-token');

      const token = await getElectronRefreshToken();
      expect(token).toBe('legacy-token');
    });

    it('should fall back to localStorage when electronAPI is undefined', async () => {
      setElectronAPIOverride(null);
      localStorage.setItem('refreshToken', 'legacy-token');

      const token = await getElectronRefreshToken();
      expect(token).toBe('legacy-token');
    });

    it('should return null when no token exists anywhere', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        getRefreshToken: vi.fn().mockResolvedValue(null),
      }));

      const token = await getElectronRefreshToken();
      expect(token).toBeNull();
    });

    it('should return null when electronAPI is undefined and localStorage is empty', async () => {
      setElectronAPIOverride(null);

      const token = await getElectronRefreshToken();
      expect(token).toBeNull();
    });
  });

  // ─── storeElectronRefreshToken ────────────────────────────────

  describe('storeElectronRefreshToken', () => {
    it('should store in secure storage when available', async () => {
      const mockStore = vi.fn().mockResolvedValue({ stored: true, availability: 'available' });
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: mockStore,
      }));

      await storeElectronRefreshToken('new-token');

      expect(mockStore).toHaveBeenCalledWith('new-token');
    });

    it('should remove localStorage entry after storing in secure storage', async () => {
      localStorage.setItem('refreshToken', 'legacy-token');
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: true, availability: 'available' }),
      }));

      await storeElectronRefreshToken('new-token');

      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('should fall back to localStorage when safeStorage is unavailable', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'unavailable' }),
      }));

      await storeElectronRefreshToken('fallback-token');

      expect(localStorage.getItem('refreshToken')).toBe('fallback-token');
    });

    it('should fall back to localStorage when the write fails despite encryption being available', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'available' }),
      }));

      await storeElectronRefreshToken('fallback-token');

      expect(localStorage.getItem('refreshToken')).toBe('fallback-token');
    });

    it('should fall back to localStorage when storeRefreshToken rejects', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockRejectedValue(new Error('IPC error')),
      }));

      await storeElectronRefreshToken('fallback-token');

      expect(localStorage.getItem('refreshToken')).toBe('fallback-token');
    });

    it('should fall back to localStorage when storeRefreshToken is not available', async () => {
      setElectronAPIOverride({ isElectron: true });

      await storeElectronRefreshToken('fallback-token');

      expect(localStorage.getItem('refreshToken')).toBe('fallback-token');
    });

    it('should fall back to localStorage when electronAPI is undefined', async () => {
      setElectronAPIOverride(null);

      await storeElectronRefreshToken('fallback-token');

      expect(localStorage.getItem('refreshToken')).toBe('fallback-token');
    });
  });

  // ─── clearTokens (Electron integration) ──────────────────────

  describe('clearTokens with Electron', () => {
    it('should call deleteRefreshToken when available', () => {
      const mockDelete = vi.fn().mockResolvedValue(true);

      setElectronAPIOverride(createFakeElectronAPI({
        deleteRefreshToken: mockDelete,
      }));

      setAccessToken('some-token');
      clearTokens();

      expect(getAccessToken()).toBeNull();
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should clear localStorage refreshToken even without electronAPI', () => {
      setElectronAPIOverride(null);
      localStorage.setItem('refreshToken', 'rt');

      clearTokens();

      expect(localStorage.getItem('refreshToken')).toBeNull();
    });
  });

  // ─── Secure storage warning (one-time) ────────────────────────

  describe('secure storage unavailable warning', () => {
    const WARNING_KEY = 'semaphore:secureStorageWarningShown';
    const PENDING_KEY = 'semaphore:secureStorageWarningPending';

    it('logs on every unavailable store, but notifies a registered listener only once (live path)', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'unavailable' }),
      }));

      const warningListener = vi.fn();
      const unsubscribe = onSecureStorageWarning(warningListener);

      try {
        await storeElectronRefreshToken('token-1');
        await storeElectronRefreshToken('token-2');

        expect(warningListener).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem(WARNING_KEY)).toBe('true');
        expect(localStorage.getItem(PENDING_KEY)).toBeNull();
      } finally {
        unsubscribe();
      }
    });

    it('notifies the listener and logs a distinct write-failure message when the write fails despite available encryption', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'available' }),
      }));

      const warningListener = vi.fn();
      const unsubscribe = onSecureStorageWarning(warningListener);

      try {
        await storeElectronRefreshToken('token-1');
        await storeElectronRefreshToken('token-2');

        // Same one-time user-visible warning mechanism as the unavailable path...
        expect(warningListener).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(WARNING_KEY)).toBe('true');
        expect(localStorage.getItem(PENDING_KEY)).toBeNull();
        // ...but the log line must distinguish write-failure from unavailability.
        expect(logger.warn).toHaveBeenCalledTimes(2);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('write failed'));
        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('unavailable on this'));
      } finally {
        unsubscribe();
      }
    });

    it('logs different messages for write-failure vs unavailable-encryption fallbacks', async () => {
      const store = vi.fn()
        .mockResolvedValueOnce({ stored: false, availability: 'unavailable' })
        .mockResolvedValueOnce({ stored: false, availability: 'available' });
      setElectronAPIOverride(createFakeElectronAPI({ storeRefreshToken: store }));

      await storeElectronRefreshToken('token-1');
      await storeElectronRefreshToken('token-2');

      const messages = vi.mocked(logger.warn).mock.calls.map((call) => String(call[0]));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain('unavailable on this');
      expect(messages[1]).toContain('write failed');
      expect(messages[0]).not.toBe(messages[1]);
    });

    it('sets the durable pending marker for a write-failure with no listener registered', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'available' }),
      }));

      await storeElectronRefreshToken('token-1');

      expect(localStorage.getItem(WARNING_KEY)).toBeNull();
      expect(localStorage.getItem(PENDING_KEY)).toBe('true');
    });

    it('does not notify listeners when secure storage is available', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: true, availability: 'available' }),
      }));

      const warningListener = vi.fn();
      const unsubscribe = onSecureStorageWarning(warningListener);

      try {
        await storeElectronRefreshToken('token');

        expect(warningListener).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(localStorage.getItem(WARNING_KEY)).toBeNull();
        expect(localStorage.getItem(PENDING_KEY)).toBeNull();
      } finally {
        unsubscribe();
      }
    });

    it('sets a durable pending marker (not the shown flag) when no listener is registered', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'unavailable' }),
      }));

      // No listener registered yet — this is the common real-world case:
      // AuthGate's pre-mount silent refresh on cold launch, or
      // login/register/onboarding, all persist a token before
      // NotificationProvider/SecureStorageWarning mount.
      await storeElectronRefreshToken('token-1');

      expect(localStorage.getItem(WARNING_KEY)).toBeNull();
      expect(localStorage.getItem(PENDING_KEY)).toBe('true');
    });

    it('live listener registered later still delivers and consumes any pending marker', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'unavailable' }),
      }));

      // First call, no listener: sets pending.
      await storeElectronRefreshToken('token-1');
      expect(localStorage.getItem(PENDING_KEY)).toBe('true');

      const warningListener = vi.fn();
      const unsubscribe = onSecureStorageWarning(warningListener);

      try {
        await storeElectronRefreshToken('token-2');

        expect(warningListener).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(WARNING_KEY)).toBe('true');
        expect(localStorage.getItem(PENDING_KEY)).toBeNull();
      } finally {
        unsubscribe();
      }
    });

    it('unsubscribe stops further notifications', async () => {
      setElectronAPIOverride(createFakeElectronAPI({
        storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'unavailable' }),
      }));

      const warningListener = vi.fn();
      const unsubscribe = onSecureStorageWarning(warningListener);
      unsubscribe();

      await storeElectronRefreshToken('token');

      expect(warningListener).not.toHaveBeenCalled();
    });
  });

  // ─── consumePendingSecureStorageWarning (mount-time consumption) ─────

  describe('consumePendingSecureStorageWarning', () => {
    const WARNING_KEY = 'semaphore:secureStorageWarningShown';
    const PENDING_KEY = 'semaphore:secureStorageWarningPending';

    it('returns true and marks shown when pending is set and not dismissed', () => {
      localStorage.setItem(PENDING_KEY, 'true');

      expect(consumePendingSecureStorageWarning()).toBe(true);
      expect(localStorage.getItem(WARNING_KEY)).toBe('true');
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    });

    it('returns false when no pending marker exists', () => {
      expect(consumePendingSecureStorageWarning()).toBe(false);
      expect(localStorage.getItem(WARNING_KEY)).toBeNull();
    });

    it('returns false and clears pending when already shown/dismissed', () => {
      localStorage.setItem(WARNING_KEY, 'true');
      localStorage.setItem(PENDING_KEY, 'true');

      expect(consumePendingSecureStorageWarning()).toBe(false);
      expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    });

    it('pending marker set before "mount" is consumed exactly once by a later mount-time check', () => {
      // Simulates the real sequence: trigger fires pre-mount (no listener),
      // then the component mounts and calls consumePendingSecureStorageWarning.
      localStorage.setItem(PENDING_KEY, 'true');

      expect(consumePendingSecureStorageWarning()).toBe(true);
      // A subsequent "remount" (e.g. navigating away and back) must not
      // show it again.
      expect(consumePendingSecureStorageWarning()).toBe(false);
    });
  });
});
