import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env')>();
  return {
    ...actual,
    getApiUrl: (path: string) => `http://localhost:3000/api${path}`,
  };
});

vi.mock('../../api-client/client.gen', async (importOriginal) => {
  const { createClient, createConfig } = await import('../../api-client/client');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    client: createClient(createConfig({ baseUrl: 'http://localhost:3000' })),
  };
});

import {
  settleOwedServerSignOut,
  whenServerSignOutSettled,
} from '../../utils/serverSignOut';
import {
  clearTokens,
  isServerSignOutOwed,
  markServerSignOutOwed,
} from '../../utils/tokenService';

const API = 'http://localhost:3000/api/auth';

describe('settleOwedServerSignOut (retrying a web logout that never reached the server)', () => {
  const logoutAuth: (string | null)[] = [];
  let refreshes = 0;

  beforeEach(() => {
    clearTokens();
    localStorage.clear();
    logoutAuth.length = 0;
    refreshes = 0;
  });

  function logoutAnswers(...statuses: number[]) {
    server.use(
      http.post(`${API}/logout`, ({ request }) => {
        logoutAuth.push(request.headers.get('Authorization'));
        const status = statuses.shift() ?? 201;
        return HttpResponse.json({ message: 'x' }, { status });
      }),
    );
  }

  function refreshAnswers(status: number) {
    server.use(
      http.post(`${API}/refresh`, () => {
        refreshes++;
        return status === 200
          ? HttpResponse.json({ accessToken: 'one-off' })
          : HttpResponse.json({ message: 'no' }, { status });
      }),
    );
  }

  it('does nothing when nothing is owed', async () => {
    logoutAnswers(201);
    await expect(settleOwedServerSignOut()).resolves.toBe(true);
    expect(logoutAuth).toEqual([]);
  });

  it('clears the flag once the server confirms the logout', async () => {
    markServerSignOutOwed();
    logoutAnswers(201);
    await expect(settleOwedServerSignOut()).resolves.toBe(true);
    expect(isServerSignOutOwed()).toBe(false);
    expect(refreshes).toBe(0);
  });

  it('keeps the flag when the server still cannot be reached', async () => {
    markServerSignOutOwed();
    server.use(http.post(`${API}/logout`, () => HttpResponse.error()));
    await expect(settleOwedServerSignOut()).resolves.toBe(false);
    expect(isServerSignOutOwed()).toBe(true);
    expect(refreshes).toBe(0);
  });

  it('keeps the flag on a server error', async () => {
    markServerSignOutOwed();
    logoutAnswers(503);
    await expect(settleOwedServerSignOut()).resolves.toBe(false);
    expect(isServerSignOutOwed()).toBe(true);
  });

  it('logout needs an access token (401): gets a one-off one from the cookie and logs out with it', async () => {
    markServerSignOutOwed();
    logoutAnswers(401, 201);
    refreshAnswers(200);
    await expect(settleOwedServerSignOut()).resolves.toBe(true);
    expect(logoutAuth).toEqual([null, 'Bearer one-off']);
    expect(isServerSignOutOwed()).toBe(false);
  });

  it('logout 401 and the server has no session for the cookie: nothing left to sign out', async () => {
    markServerSignOutOwed();
    logoutAnswers(401);
    refreshAnswers(401);
    await expect(settleOwedServerSignOut()).resolves.toBe(true);
    expect(isServerSignOutOwed()).toBe(false);
  });

  it('logout 401 and the refresh cannot be answered: still owed', async () => {
    markServerSignOutOwed();
    logoutAnswers(401);
    refreshAnswers(503);
    await expect(settleOwedServerSignOut()).resolves.toBe(false);
    expect(isServerSignOutOwed()).toBe(true);
  });

  it('shares one attempt between concurrent callers, and whenServerSignOutSettled waits for it', async () => {
    markServerSignOutOwed();
    logoutAnswers(201);
    const first = settleOwedServerSignOut();
    const second = settleOwedServerSignOut();
    expect(second).toBe(first);
    let waited = false;
    const waiting = whenServerSignOutSettled().then(() => {
      waited = true;
    });
    expect(waited).toBe(false);
    await first;
    await waiting;
    expect(waited).toBe(true);
    expect(logoutAuth).toHaveLength(1);
  });
});
