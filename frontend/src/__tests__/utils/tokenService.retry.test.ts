import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';

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

type TokenService = typeof import('../../utils/tokenService');

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

const ok = (token = 'fresh') => ({ data: { accessToken: token } });

/** Install a fake `navigator.locks`; returns the `request` mock. */
function installLocks(request: (...args: unknown[]) => unknown) {
  const mock = vi.fn(request);
  Object.defineProperty(navigator, 'locks', {
    value: { request: mock },
    configurable: true,
  });
  return mock;
}

function removeLocks() {
  // jsdom has no navigator.locks; drop our own property if a test added one
  delete (navigator as unknown as { locks?: unknown }).locks;
}

describe('tokenService refreshSessionWithRetry', () => {
  let ts: TokenService;
  let originalElectronAPI: typeof window.electronAPI;

  beforeEach(async () => {
    // Fresh module state (single-flight promises, cooldown) for every test
    vi.resetModules();
    ts = await import('../../utils/tokenService');
    originalElectronAPI = window.electronAPI;
    window.electronAPI = undefined;
    mockPost.mockReset();
    removeLocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.electronAPI = originalElectronAPI;
    removeLocks();
  });

  it('returns refreshed straight away when the first attempt works', async () => {
    mockPost.mockResolvedValue(ok());

    await expect(ts.refreshSessionWithRetry()).resolves.toEqual({
      status: 'refreshed',
      token: 'fresh',
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('retries an unavailable refresh after 1s, then 2s, until it works', async () => {
    mockPost
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(new AxiosError('Network Error', AxiosError.ERR_NETWORK))
      .mockResolvedValueOnce(ok('third-time'));

    const promise = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockPost).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(mockPost).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockPost).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(mockPost).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toEqual({ status: 'refreshed', token: 'third-time' });
    expect(mockPost).toHaveBeenCalledTimes(3);
  });

  it('stops at once when the server refuses the session', async () => {
    mockPost.mockRejectedValueOnce(httpError(503)).mockRejectedValueOnce(httpError(401));

    const promise = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toEqual({ status: 'rejected' });
    expect(mockPost).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('gives up as unavailable after MAX_SESSION_REFRESH_ATTEMPTS attempts', async () => {
    const { MAX_SESSION_REFRESH_ATTEMPTS } = await import('../../utils/sessionRefreshPolicy');
    mockPost.mockRejectedValue(httpError(502));

    const promise = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);

    await expect(promise).resolves.toEqual({ status: 'unavailable' });
    expect(MAX_SESSION_REFRESH_ATTEMPTS).toBe(4);
    expect(mockPost).toHaveBeenCalledTimes(MAX_SESSION_REFRESH_ATTEMPTS);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPost).toHaveBeenCalledTimes(MAX_SESSION_REFRESH_ATTEMPTS);
  });

  it('sends no retry later than the retry budget after the first attempt', async () => {
    // Every attempt hangs until the request timeout. The first one's
    // response may have been lost after the server rotated the token: a
    // retry must reach the server well inside its 30 s grace window, or it
    // ends the session itself.
    const { SESSION_REFRESH_RETRY_BUDGET_MS } = await import(
      '../../utils/sessionRefreshPolicy'
    );
    const sentAt: number[] = [];
    const start = Date.now();
    mockPost.mockImplementation(() => {
      sentAt.push(Date.now() - start);
      return new Promise((_, reject) =>
        setTimeout(
          () => reject(new AxiosError('timeout exceeded', AxiosError.ECONNABORTED)),
          ts.REFRESH_REQUEST_TIMEOUT_MS,
        ),
      );
    });

    const promise = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(promise).resolves.toEqual({ status: 'unavailable' });
    // One retry, 1 s after the first attempt timed out; the next would go
    // out past the budget
    expect(sentAt).toEqual([0, ts.REFRESH_REQUEST_TIMEOUT_MS + 1000]);
    expect(Math.max(...sentAt)).toBeLessThanOrEqual(SESSION_REFRESH_RETRY_BUDGET_MS);
    expect(SESSION_REFRESH_RETRY_BUDGET_MS).toBeLessThanOrEqual(15_000);
  });

  it('answers unavailable without a request during the cooldown after giving up', async () => {
    mockPost.mockRejectedValue(httpError(503));
    const first = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(7000);
    await expect(first).resolves.toEqual({ status: 'unavailable' });
    mockPost.mockClear();

    await expect(ts.refreshSessionWithRetry()).resolves.toEqual({ status: 'unavailable' });
    await vi.advanceTimersByTimeAsync(9_000);
    await expect(ts.refreshSessionWithRetry()).resolves.toEqual({ status: 'unavailable' });
    expect(mockPost).not.toHaveBeenCalled();

    // After the cooldown it tries the server again
    await vi.advanceTimersByTimeAsync(1_000);
    mockPost.mockResolvedValue(ok('back'));
    await expect(ts.refreshSessionWithRetry()).resolves.toEqual({
      status: 'refreshed',
      token: 'back',
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('clears the cooldown when any other refresh works (e.g. the socket)', async () => {
    mockPost.mockRejectedValue(httpError(503));
    const first = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(7000);
    await expect(first).resolves.toEqual({ status: 'unavailable' });

    // SocketProvider's own refreshSession() gets through
    mockPost.mockResolvedValue(ok('socket'));
    await expect(ts.refreshSession()).resolves.toEqual({ status: 'refreshed', token: 'socket' });
    mockPost.mockClear();

    mockPost.mockResolvedValue(ok('rest'));
    await expect(ts.refreshSessionWithRetry()).resolves.toEqual({
      status: 'refreshed',
      token: 'rest',
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('shares one ladder between concurrent callers', async () => {
    mockPost.mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce(ok('shared'));

    const a = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(500);
    // Joins while the ladder waits for its retry
    const b = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(500);

    await expect(a).resolves.toEqual({ status: 'refreshed', token: 'shared' });
    await expect(b).resolves.toEqual({ status: 'refreshed', token: 'shared' });
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('uses a token refreshed elsewhere during the backoff instead of refreshing again', async () => {
    mockPost.mockRejectedValueOnce(httpError(503));

    const promise = ts.refreshSessionWithRetry();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockPost).toHaveBeenCalledTimes(1);

    // The socket's refresh gets through while the ladder waits
    mockPost.mockResolvedValueOnce(ok('from-socket'));
    await ts.refreshSession();

    await expect(promise).resolves.toEqual({ status: 'refreshed', token: 'from-socket' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockPost).toHaveBeenCalledTimes(2);
  });
});

describe('tokenService refresh request', () => {
  let ts: TokenService;
  let originalElectronAPI: typeof window.electronAPI;

  beforeEach(async () => {
    vi.resetModules();
    ts = await import('../../utils/tokenService');
    originalElectronAPI = window.electronAPI;
    window.electronAPI = undefined;
    mockPost.mockReset();
    removeLocks();
  });

  afterEach(() => {
    window.electronAPI = originalElectronAPI;
    removeLocks();
  });

  it('times out after 10s so a hung request cannot hold the cross-tab lock', async () => {
    mockPost.mockResolvedValue(ok());
    await ts.refreshSession();

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      {},
      expect.objectContaining({ timeout: 10_000, withCredentials: true }),
    );
  });

  it('times out Electron refreshes too', async () => {
    window.electronAPI = { isElectron: true, getRefreshToken: vi.fn().mockResolvedValue('rt') };
    mockPost.mockResolvedValue(ok());
    await ts.refreshSession();

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/auth/refresh'),
      { refreshToken: 'rt' },
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it('treats a timed-out request as unavailable, not rejected', async () => {
    mockPost.mockRejectedValue(
      new AxiosError('timeout of 15000ms exceeded', AxiosError.ECONNABORTED),
    );
    await expect(ts.refreshSession()).resolves.toEqual({ status: 'unavailable' });

    mockPost.mockRejectedValue(new AxiosError('timeout exceeded', AxiosError.ETIMEDOUT));
    await expect(ts.refreshSession()).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('tokenService refreshSessionUntilAnswered', () => {
  let ts: TokenService;

  beforeEach(async () => {
    vi.resetModules();
    ts = await import('../../utils/tokenService');
    window.electronAPI = undefined;
    mockPost.mockReset();
    removeLocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps trying through the pauses until the server refreshes the session', async () => {
    mockPost.mockRejectedValue(httpError(429));
    const promise = ts.refreshSessionUntilAnswered();

    // A whole ladder, then the pause, then another ladder...
    await vi.advanceTimersByTimeAsync(7_000 + ts.REFRESH_COOLDOWN_MS + 1_000);
    expect(mockPost.mock.calls.length).toBeGreaterThan(4);
    mockPost.mockResolvedValue(ok('back'));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).resolves.toEqual({ status: 'refreshed', token: 'back' });
  });

  it('stops when the server refuses the session', async () => {
    mockPost.mockRejectedValueOnce(httpError(503)).mockRejectedValue(httpError(401));
    const promise = ts.refreshSessionUntilAnswered();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toEqual({ status: 'rejected' });
  });

  it('stops waiting when aborted', async () => {
    mockPost.mockRejectedValue(httpError(503));
    const abort = new AbortController();
    const promise = ts.refreshSessionUntilAnswered(abort.signal);
    await vi.advanceTimersByTimeAsync(8_000);

    abort.abort();
    await expect(promise).resolves.toEqual({ status: 'unavailable' });
    mockPost.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('sessionRefreshPolicy nextSessionRefreshDelayMs', () => {
  it('backs off 1s, 2s, 4s and stops after the last attempt', async () => {
    const { nextSessionRefreshDelayMs, MAX_SESSION_REFRESH_ATTEMPTS } = await import(
      '../../utils/sessionRefreshPolicy'
    );
    const start = 1_000_000;
    expect(nextSessionRefreshDelayMs(1, start, start)).toBe(1000);
    expect(nextSessionRefreshDelayMs(2, start, start + 1000)).toBe(2000);
    expect(nextSessionRefreshDelayMs(3, start, start + 3000)).toBe(4000);
    expect(nextSessionRefreshDelayMs(MAX_SESSION_REFRESH_ATTEMPTS, start, start + 7000)).toBeNull();
  });

  it('stops when the retry would go out past the budget', async () => {
    const { nextSessionRefreshDelayMs, SESSION_REFRESH_RETRY_BUDGET_MS } = await import(
      '../../utils/sessionRefreshPolicy'
    );
    const start = 1_000_000;
    expect(nextSessionRefreshDelayMs(1, start, start + SESSION_REFRESH_RETRY_BUDGET_MS - 1000)).toBe(1000);
    expect(nextSessionRefreshDelayMs(1, start, start + SESSION_REFRESH_RETRY_BUDGET_MS - 999)).toBeNull();
    expect(nextSessionRefreshDelayMs(2, start, start + 11_000)).toBeNull();
  });
});

describe('tokenService cross-tab refresh lock', () => {
  let ts: TokenService;
  let originalElectronAPI: typeof window.electronAPI;

  beforeEach(async () => {
    vi.resetModules();
    ts = await import('../../utils/tokenService');
    originalElectronAPI = window.electronAPI;
    window.electronAPI = undefined;
    mockPost.mockReset();
    removeLocks();
  });

  afterEach(() => {
    window.electronAPI = originalElectronAPI;
    removeLocks();
  });

  it('refreshes inside the semaphore:auth-refresh Web Lock when available', async () => {
    let holdingLock = false;
    let postedWhileHoldingLock: boolean | undefined;
    const request = installLocks(async (_name: unknown, callback: unknown) => {
      holdingLock = true;
      try {
        return await (callback as () => Promise<unknown>)();
      } finally {
        holdingLock = false;
      }
    });
    mockPost.mockImplementation(async () => {
      postedWhileHoldingLock = holdingLock;
      return ok('locked');
    });

    await expect(ts.refreshSession()).resolves.toEqual({ status: 'refreshed', token: 'locked' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('semaphore:auth-refresh', expect.any(Function));
    expect(postedWhileHoldingLock).toBe(true);
    expect(ts.getAccessToken()).toBe('locked');
  });

  it('keeps the lock until the refreshed token has been stored', async () => {
    const events: string[] = [];
    installLocks(async (_name: unknown, callback: unknown) => {
      const result = await (callback as () => Promise<unknown>)();
      events.push('lock released');
      return result;
    });
    ts.onTokenRefreshed(() => events.push('token stored'));
    mockPost.mockResolvedValue(ok());

    await ts.refreshSession();

    expect(events).toEqual(['token stored', 'lock released']);
  });

  it('refreshes without a lock when navigator.locks is missing', async () => {
    mockPost.mockResolvedValue(ok('no-lock'));

    await expect(ts.refreshSession()).resolves.toEqual({ status: 'refreshed', token: 'no-lock' });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('refreshes without the lock when the lock request fails before running', async () => {
    const request = installLocks(() =>
      Promise.reject(new DOMException('The request is not allowed', 'SecurityError')),
    );
    mockPost.mockResolvedValue(ok('fallback'));

    await expect(ts.refreshSession()).resolves.toEqual({ status: 'refreshed', token: 'fallback' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('refreshes without the lock when locks.request throws synchronously', async () => {
    installLocks(() => {
      throw new TypeError('locks unavailable');
    });
    mockPost.mockResolvedValue(ok('sync-fallback'));

    await expect(ts.refreshSession()).resolves.toEqual({
      status: 'refreshed',
      token: 'sync-fallback',
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('does not refresh twice when the refresh inside the lock fails', async () => {
    installLocks(async (_name: unknown, callback: unknown) =>
      (callback as () => Promise<unknown>)(),
    );
    mockPost.mockRejectedValue(httpError(503));

    await expect(ts.refreshSession()).resolves.toEqual({ status: 'unavailable' });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it('keeps a refused session rejected through the lock', async () => {
    installLocks(async (_name: unknown, callback: unknown) =>
      (callback as () => Promise<unknown>)(),
    );
    mockPost.mockRejectedValue(httpError(401));

    await expect(ts.refreshSession()).resolves.toEqual({ status: 'rejected' });
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
