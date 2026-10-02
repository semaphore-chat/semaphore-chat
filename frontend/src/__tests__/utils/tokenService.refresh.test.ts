import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import { setElectronAPIOverride } from '../../utils/electronBridge';
import { createFakeElectronAPI } from '../test-utils/fakeElectronAPI';

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
  refreshToken,
  clearTokens,
  getAccessToken,
} from '../../utils/tokenService';

/** An axios error with an HTTP response of `status`. */
function httpError(status: number): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    undefined,
    undefined,
    { status, data: {}, statusText: '', headers: {}, config: {} } as AxiosResponse,
  );
}

describe('tokenService refresh outcome', () => {
  beforeEach(() => {
    setElectronAPIOverride(null);
    clearTokens();
    mockPost.mockReset();
  });

  it('returns the new token', async () => {
    mockPost.mockResolvedValue({ data: { accessToken: 'fresh' } });

    await expect(refreshSession()).resolves.toEqual({
      status: 'refreshed',
      token: 'fresh',
    });
    expect(getAccessToken()).toBe('fresh');
  });

  it.each([401, 403])('is rejected when the server refuses the session (%i)', async (status) => {
    mockPost.mockRejectedValue(httpError(status));

    await expect(refreshSession()).resolves.toEqual({ status: 'rejected' });
  });

  it.each([500, 502, 503, 429])(
    'is unavailable when the server fails (%i): trying again may work',
    async (status) => {
      mockPost.mockRejectedValue(httpError(status));

      await expect(refreshSession()).resolves.toEqual({ status: 'unavailable' });
    },
  );

  it('is unavailable on a network error (no response)', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error', AxiosError.ERR_NETWORK));

    await expect(refreshSession()).resolves.toEqual({ status: 'unavailable' });
  });

  it('is rejected when Electron has no refresh token to send', async () => {
    setElectronAPIOverride(createFakeElectronAPI({ getRefreshToken: vi.fn().mockResolvedValue(null) }));

    await expect(refreshSession()).resolves.toEqual({ status: 'rejected' });
    expect(mockPost).not.toHaveBeenCalled();
  });

  // #549: an install that ran on Chromium's plain-text `basic` store kept its
  // refresh token in localStorage. Once safeStorage becomes available (e.g. the
  // app now picks gnome-libsecret), the next refresh must still find that token
  // (no sign-out) and move the rotated one into encrypted storage.
  it('migrates a plain-text localStorage refresh token to secure storage on refresh', async () => {
    localStorage.setItem('refreshToken', 'plain-rt');
    const api = createFakeElectronAPI({
      getRefreshToken: vi.fn().mockResolvedValue(null), // nothing in secure-tokens/ yet
      storeRefreshToken: vi.fn().mockResolvedValue({ stored: true, availability: 'available' }),
    });
    setElectronAPIOverride(api);
    mockPost.mockResolvedValue({ data: { accessToken: 'fresh', refreshToken: 'rotated-rt' } });

    await expect(refreshSession()).resolves.toEqual({ status: 'refreshed', token: 'fresh' });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      { refreshToken: 'plain-rt' },
      expect.anything(),
    );
    expect(api.storeRefreshToken).toHaveBeenCalledWith('rotated-rt');
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('shares one request between concurrent callers', async () => {
    mockPost.mockResolvedValue({ data: { accessToken: 'fresh' } });

    const [a, b] = await Promise.all([refreshSession(), refreshToken()]);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ status: 'refreshed', token: 'fresh' });
    expect(b).toBe('fresh');
  });

  it('refreshToken still resolves null for any failure', async () => {
    mockPost.mockRejectedValue(httpError(503));
    await expect(refreshToken()).resolves.toBeNull();

    mockPost.mockRejectedValue(httpError(401));
    await expect(refreshToken()).resolves.toBeNull();
  });
});
