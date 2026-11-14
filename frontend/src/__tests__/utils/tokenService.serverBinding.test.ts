import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';
import { addServer, setActiveServer, clearAllServers } from '../../utils/serverStorage';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockPost = vi.fn();
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: { ...actual.default, post: (...args: unknown[]) => mockPost(...args) },
  };
});

import {
  refreshSession,
  clearTokens,
  getElectronRefreshToken,
  storeElectronRefreshToken,
} from '../../utils/tokenService';

/** A fake bridge whose secure storage keeps one value in memory. */
function fakeSecureStorage(initial: string | null = null) {
  let stored: string | null = initial;
  const api = createFakeElectronAPI({
    storeRefreshToken: vi.fn(async (value: string) => {
      stored = value;
      return { stored: true, availability: 'available' as const };
    }),
    getRefreshToken: vi.fn(async () => stored),
    deleteRefreshToken: vi.fn(async () => {
      stored = null;
    }),
  });
  setElectronAPIOverride(api);
  return { api, read: () => stored };
}

/**
 * A refresh token belongs to the server that issued it (WEB-1): it must never
 * be sent to a different server, e.g. after the active server's URL changed.
 */
describe('tokenService — refresh token bound to its server', () => {
  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    clearAllServers();
    mockPost.mockReset();
  });

  it('does not send server A\'s refresh token to server B', async () => {
    const a = addServer('A', 'https://a.example');
    const b = addServer('B', 'https://b.example');
    setActiveServer(a.id);
    const storage = fakeSecureStorage();
    await storeElectronRefreshToken('token-from-a');

    setActiveServer(b.id);
    const result = await refreshSession();

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'rejected' });
    expect(storage.read()).toBeNull();
  });

  it('does not hand a foreign server\'s token to logout either', async () => {
    const a = addServer('A', 'https://a.example');
    const b = addServer('B', 'https://b.example');
    setActiveServer(a.id);
    // No keyring: the token falls back to localStorage
    setElectronAPIOverride(createFakeElectronAPI({
      storeRefreshToken: vi.fn().mockResolvedValue({ stored: false, availability: 'unavailable' }),
      getRefreshToken: vi.fn().mockResolvedValue(null),
    }));
    await storeElectronRefreshToken('token-from-a');
    expect(localStorage.getItem('refreshToken')).not.toBeNull();

    setActiveServer(b.id);
    await expect(getElectronRefreshToken()).resolves.toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('sends a token bound to the active server, ignoring trailing slash and host case', async () => {
    const a = addServer('A', 'https://a.example');
    setActiveServer(a.id);
    fakeSecureStorage(JSON.stringify({ v: 1, api: 'https://A.Example/api/', token: 'tok' }));
    mockPost.mockResolvedValue({ data: { accessToken: 'access' } });

    await expect(refreshSession()).resolves.toEqual({ status: 'refreshed', token: 'access' });
    expect(mockPost).toHaveBeenCalledWith(
      'https://a.example/api/auth/refresh',
      { refreshToken: 'tok' },
      expect.anything(),
    );
  });

  it('accepts an older unbound token once, then stores the rotated one bound', async () => {
    const a = addServer('A', 'https://a.example');
    setActiveServer(a.id);
    const storage = fakeSecureStorage('legacy-plain-token');
    mockPost.mockResolvedValue({ data: { accessToken: 'access', refreshToken: 'rotated' } });

    await expect(refreshSession()).resolves.toEqual({ status: 'refreshed', token: 'access' });
    expect(mockPost).toHaveBeenCalledWith(
      'https://a.example/api/auth/refresh',
      { refreshToken: 'legacy-plain-token' },
      expect.anything(),
    );
    expect(JSON.parse(storage.read()!)).toEqual({
      v: 1,
      api: 'https://a.example/api',
      token: 'rotated',
    });
  });
});
