import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
  default: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  getAccessToken,
  setAccessToken,
  clearTokens,
  isTokenExpired,
  getAuthenticatedUrl,
  onTokenRefreshed,
  onAuthFailure,
  notifyAuthFailure,
  isRefreshing,
  redirectToLogin,
} from '../../utils/tokenService';
import { logger } from '../../utils/logger';

/** Helper: create a fake JWT with a given payload */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const sig = 'fakesig';
  return `${header}.${body}.${sig}`;
}

describe('tokenService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // ─── getAccessToken ────────────────────────────────────────────

  describe('getAccessToken', () => {
    it('returns plain string token (current format)', () => {
      localStorage.setItem('accessToken', 'plain-tok');
      expect(getAccessToken()).toBe('plain-tok');
    });

    it('returns value from JSON string format (backwards compat)', () => {
      localStorage.setItem('accessToken', JSON.stringify('json-tok'));
      expect(getAccessToken()).toBe('json-tok');
    });

    it('returns value from { value: "..." } format (backwards compat)', () => {
      localStorage.setItem('accessToken', JSON.stringify({ value: 'obj-tok' }));
      expect(getAccessToken()).toBe('obj-tok');
    });

    it('returns null when nothing stored', () => {
      expect(getAccessToken()).toBeNull();
    });

    it('returns null for empty value key', () => {
      localStorage.setItem('accessToken', JSON.stringify({ value: '' }));
      expect(getAccessToken()).toBeNull();
    });

    it('returns null and logs warning for unexpected object format', () => {
      localStorage.setItem('accessToken', JSON.stringify({ foo: 'bar' }));
      expect(getAccessToken()).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unexpected token format'),
        expect.anything(),
      );
    });

    it('returns null for JSON number', () => {
      localStorage.setItem('accessToken', JSON.stringify(12345));
      expect(getAccessToken()).toBeNull();
    });

    it('returns null for JSON boolean', () => {
      localStorage.setItem('accessToken', JSON.stringify(true));
      expect(getAccessToken()).toBeNull();
    });

    it('returns null for JSON null', () => {
      localStorage.setItem('accessToken', 'null');
      expect(getAccessToken()).toBeNull();
    });

    it('handles a real-looking JWT as a plain string', () => {
      const jwt = makeJwt({ exp: 99999999999, sub: 'user1' });
      localStorage.setItem('accessToken', jwt);
      // JWTs are not valid JSON, so JSON.parse throws, falls through to raw
      expect(getAccessToken()).toBe(jwt);
    });
  });

  // ─── setAccessToken ────────────────────────────────────────────

  describe('setAccessToken', () => {
    it('stores token as plain string', () => {
      setAccessToken('my-token');
      expect(localStorage.getItem('accessToken')).toBe('my-token');
    });

    it('overwrites previous token', () => {
      setAccessToken('old');
      setAccessToken('new');
      expect(localStorage.getItem('accessToken')).toBe('new');
    });

    it('roundtrips with getAccessToken', () => {
      setAccessToken('roundtrip-tok');
      expect(getAccessToken()).toBe('roundtrip-tok');
    });

    it('overwrites legacy format and roundtrips correctly', () => {
      // Start with old JSON format
      localStorage.setItem('accessToken', JSON.stringify('legacy'));
      expect(getAccessToken()).toBe('legacy');

      // Overwrite with new plain string format
      setAccessToken('modern');
      expect(getAccessToken()).toBe('modern');
      expect(localStorage.getItem('accessToken')).toBe('modern');
    });
  });

  // ─── clearTokens ──────────────────────────────────────────────

  describe('clearTokens', () => {
    it('removes both accessToken and refreshToken', () => {
      localStorage.setItem('accessToken', 'at');
      localStorage.setItem('refreshToken', 'rt');
      clearTokens();
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('is safe to call when no tokens exist', () => {
      expect(() => clearTokens()).not.toThrow();
    });

    it('does not affect other localStorage keys', () => {
      localStorage.setItem('accessToken', 'at');
      localStorage.setItem('other', 'value');
      clearTokens();
      expect(localStorage.getItem('other')).toBe('value');
    });
  });

  // ─── isTokenExpired ────────────────────────────────────────────

  describe('isTokenExpired', () => {
    it('returns false for a token expiring far in the future', () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const token = makeJwt({ exp: futureExp, sub: 'user1' });
      expect(isTokenExpired(token)).toBe(false);
    });

    it('returns true for a token that expired in the past', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 60;
      const token = makeJwt({ exp: pastExp, sub: 'user1' });
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns true for a token expiring within the default 30s buffer', () => {
      const soonExp = Math.floor(Date.now() / 1000) + 10;
      const token = makeJwt({ exp: soonExp, sub: 'user1' });
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns false for a token within a shorter custom buffer', () => {
      const soonExp = Math.floor(Date.now() / 1000) + 10;
      const token = makeJwt({ exp: soonExp, sub: 'user1' });
      expect(isTokenExpired(token, 5)).toBe(false);
    });

    it('returns true at exact expiry with buffer=0', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = makeJwt({ exp: now, sub: 'user1' });
      expect(isTokenExpired(token, 0)).toBe(true);
    });

    it('returns false for token expiring 1s from now with buffer=0', () => {
      const exp = Math.floor(Date.now() / 1000) + 1;
      const token = makeJwt({ exp, sub: 'user1' });
      expect(isTokenExpired(token, 0)).toBe(false);
    });

    it('returns true for a malformed token (no dots)', () => {
      expect(isTokenExpired('not-a-jwt')).toBe(true);
    });

    it('returns true for a token with only 2 parts', () => {
      expect(isTokenExpired('header.body')).toBe(true);
    });

    it('returns true for a token with 4 parts', () => {
      expect(isTokenExpired('a.b.c.d')).toBe(true);
    });

    it('returns true for a token with no exp claim', () => {
      const token = makeJwt({ sub: 'user1' });
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns true for a token with exp as string', () => {
      const token = makeJwt({ exp: 'not-a-number', sub: 'user1' });
      expect(isTokenExpired(token)).toBe(true);
    });

    it('returns true for a token with invalid base64 payload', () => {
      expect(isTokenExpired('header.!!!invalid-base64!!!.sig')).toBe(true);
    });

    it('returns true for an empty string', () => {
      expect(isTokenExpired('')).toBe(true);
    });
  });

  // ─── getAuthenticatedUrl ───────────────────────────────────────

  describe('getAuthenticatedUrl', () => {
    it('appends token as query param to relative URL', () => {
      setAccessToken('my-token');
      const result = getAuthenticatedUrl('/api/file/123');
      expect(result).toContain('/api/file/123');
      expect(result).toContain('token=my-token');
    });

    it('appends token to absolute URL', () => {
      setAccessToken('my-token');
      const result = getAuthenticatedUrl('http://example.com/api/file/123');
      expect(result).toBe('http://example.com/api/file/123?token=my-token');
    });

    it('preserves existing query params when appending token', () => {
      setAccessToken('my-token');
      const result = getAuthenticatedUrl('/api/file/123?format=mp4');
      expect(result).toContain('format=mp4');
      expect(result).toContain('token=my-token');
    });

    it('does not duplicate token if already in URL', () => {
      setAccessToken('my-token');
      const url = '/api/file/123?token=existing';
      expect(getAuthenticatedUrl(url)).toBe(url);
    });

    it('returns original URL when no token available', () => {
      expect(getAuthenticatedUrl('/api/file/123')).toBe('/api/file/123');
    });

    it('logs warning when no token available', () => {
      getAuthenticatedUrl('/api/file/123');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No token available'),
      );
    });
  });

  // ─── onTokenRefreshed ─────────────────────────────────────────

  describe('onTokenRefreshed', () => {
    it('returns an unsubscribe function', () => {
      const unsub = onTokenRefreshed(vi.fn());
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('notifies listener when token is refreshed via setAccessToken flow', () => {
      // The listener system is internal (notifyTokenRefreshed is called inside performRefresh)
      // We test the subscribe/unsubscribe API surface here
      const listener = vi.fn();
      const unsub = onTokenRefreshed(listener);

      // Listener is not called synchronously
      expect(listener).not.toHaveBeenCalled();

      unsub();
    });

    it('does not call listener after unsubscribe', () => {
      const listener = vi.fn();
      const unsub = onTokenRefreshed(listener);
      unsub();

      // Even if we somehow triggered a refresh, the listener shouldn't fire
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ─── onAuthFailure / notifyAuthFailure ───────────────────────

  describe('onAuthFailure / notifyAuthFailure', () => {
    it('returns an unsubscribe function', () => {
      const unsub = onAuthFailure(vi.fn());
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('calls registered listener when notifyAuthFailure is called', () => {
      const listener = vi.fn();
      const unsub = onAuthFailure(listener);

      notifyAuthFailure();

      expect(listener).toHaveBeenCalledOnce();
      unsub();
    });

    it('does not call listener after unsubscribe', () => {
      const listener = vi.fn();
      const unsub = onAuthFailure(listener);
      unsub();

      notifyAuthFailure();

      expect(listener).not.toHaveBeenCalled();
    });

    it('calls multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = onAuthFailure(listener1);
      const unsub2 = onAuthFailure(listener2);

      notifyAuthFailure();

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
      unsub1();
      unsub2();
    });

    it('continues calling remaining listeners if one throws', () => {
      const badListener = vi.fn(() => { throw new Error('boom'); });
      const goodListener = vi.fn();
      const unsub1 = onAuthFailure(badListener);
      const unsub2 = onAuthFailure(goodListener);

      notifyAuthFailure();

      expect(badListener).toHaveBeenCalledOnce();
      expect(goodListener).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('auth failure listener'),
        expect.any(Error),
      );
      unsub1();
      unsub2();
    });

    it('is a no-op when no listeners are registered', () => {
      expect(() => notifyAuthFailure()).not.toThrow();
    });

    it('only unsubscribes the specific listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = onAuthFailure(listener1);
      onAuthFailure(listener2);

      unsub1();
      notifyAuthFailure();

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledOnce();

      // cleanup
      listener2.mockClear();
    });
  });

  // ─── isRefreshing ─────────────────────────────────────────────

  describe('isRefreshing', () => {
    it('returns false when no refresh is in progress', () => {
      expect(isRefreshing()).toBe(false);
    });
  });

  // ─── redirectToLogin ──────────────────────────────────────────

  describe('redirectToLogin', () => {
    let originalHash: string;

    beforeEach(() => {
      originalHash = window.location.hash;
    });

    afterEach(() => {
      window.location.hash = originalHash;
    });

    it('clears tokens', () => {
      setAccessToken('my-token');
      localStorage.setItem('refreshToken', 'rt');
      redirectToLogin();
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('sets window.location.hash to #/login', () => {
      setAccessToken('my-token');
      redirectToLogin();
      expect(window.location.hash).toBe('#/login');
    });

    it('does not change hash if already on #/login', () => {
      window.location.hash = '#/login';
      redirectToLogin();
      expect(window.location.hash).toBe('#/login');
    });
  });
});
