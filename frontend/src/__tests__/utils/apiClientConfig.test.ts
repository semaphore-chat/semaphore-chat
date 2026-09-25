import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../msw/server';

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), dev: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/env')>();
  return {
    ...actual,
    getApiBaseUrl: () => 'http://localhost:3000/api',
    getApiUrl: (path: string) =>
      `http://localhost:3000/api${path.startsWith('/') ? path : `/${path}`}`,
  };
});

// The real tokenService, with refreshSessionWithRetry observable (and
// overridable, for outcomes that take the whole retry ladder).
const mockRefreshSessionWithRetry = vi.fn();
vi.mock('../../utils/tokenService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/tokenService')>();
  return {
    ...actual,
    refreshSessionWithRetry: (...args: unknown[]) => mockRefreshSessionWithRetry(...args),
  };
});

import { configureApiClient } from '../../api-client-config';
import { client } from '../../api-client/client.gen';
import * as tokenService from '../../utils/tokenService';

const API = 'http://localhost:3000';
const PROTECTED = '/api/test/protected';

/** A protected endpoint that only accepts `Bearer <validToken>`. */
function protectedEndpoint(validToken: string, onRequest?: (auth: string | null) => void) {
  return http.get(`${API}${PROTECTED}`, ({ request }) => {
    const auth = request.headers.get('Authorization');
    onRequest?.(auth);
    if (auth === `Bearer ${validToken}`) {
      return HttpResponse.json({ ok: true, auth });
    }
    return HttpResponse.json(
      { statusCode: 401, message: 'Unauthorized' },
      { status: 401 },
    );
  });
}

/** /api/auth/refresh answering with `status` (and `token` on 200). */
function refreshEndpoint(status: number, token = 'fresh', onRequest?: () => void) {
  return http.post(`${API}/api/auth/refresh`, async () => {
    onRequest?.();
    await delay(20);
    if (status === 200) return HttpResponse.json({ accessToken: token });
    return HttpResponse.json({ statusCode: status }, { status });
  });
}

describe('REST 401 interceptor (configureApiClient)', () => {
  const authFailure = vi.fn();
  let unsubscribe: () => void;

  beforeAll(() => {
    configureApiClient();
  });

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../../utils/tokenService')>(
      '../../utils/tokenService',
    );
    mockRefreshSessionWithRetry.mockReset();
    mockRefreshSessionWithRetry.mockImplementation(actual.refreshSessionWithRetry);
    authFailure.mockReset();
    unsubscribe = tokenService.onAuthFailure(authFailure);
    tokenService.setAccessToken('expired');
    window.location.hash = '#/community/abc';
  });

  afterEach(() => {
    unsubscribe();
    window.location.hash = '';
  });

  it('retries once with the refreshed token and returns the retry response', async () => {
    const seen: (string | null)[] = [];
    server.use(
      protectedEndpoint('fresh', (auth) => seen.push(auth)),
      refreshEndpoint(200, 'fresh'),
    );

    const result = await client.get({ url: PROTECTED });

    expect(result.response?.status).toBe(200);
    expect(result.data).toEqual({ ok: true, auth: 'Bearer fresh' });
    expect(seen).toEqual(['Bearer expired', 'Bearer fresh']);
    expect(mockRefreshSessionWithRetry).toHaveBeenCalledTimes(1);
    expect(authFailure).not.toHaveBeenCalled();
  });

  it('signs out and returns the 401 when the server refuses the session', async () => {
    server.use(protectedEndpoint('fresh'), refreshEndpoint(401));

    const result = await client.get({ url: PROTECTED });

    expect(result.response?.status).toBe(401);
    expect(result.error).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(authFailure).toHaveBeenCalledTimes(1);
  });

  it.each(['/login', '/register', '/join/abc', '/onboarding'])(
    'does not sign out on a public route (%s)',
    async (route) => {
      window.location.hash = `#${route}`;
      server.use(protectedEndpoint('fresh'), refreshEndpoint(401));

      const result = await client.get({ url: PROTECTED });

      expect(result.response?.status).toBe(401);
      expect(authFailure).not.toHaveBeenCalled();
    },
  );

  it('keeps the session and surfaces a retryable 503 when the refresh is unavailable', async () => {
    mockRefreshSessionWithRetry.mockResolvedValue({ status: 'unavailable' });
    server.use(protectedEndpoint('fresh'));

    const result = await client.get({ url: PROTECTED });

    expect(authFailure).not.toHaveBeenCalled();
    expect(result.response?.status).toBe(503);
    expect(result.response?.headers.get('Content-Type')).toContain('application/json');
    expect(result.error).toEqual({
      statusCode: 503,
      message: 'Could not refresh the session. Try again.',
      error: 'Service Unavailable',
    });
  });

  it('throws the 503 body for callers using throwOnError (TanStack Query)', async () => {
    mockRefreshSessionWithRetry.mockResolvedValue({ status: 'unavailable' });
    server.use(protectedEndpoint('fresh'));

    await expect(client.get({ url: PROTECTED, throwOnError: true })).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(authFailure).not.toHaveBeenCalled();
  });

  describe('requests with a body', () => {
    /** A protected POST endpoint that echoes what it received. */
    function protectedPost(validToken: string, seen: unknown[]) {
      return http.post(`${API}${PROTECTED}`, async ({ request }) => {
        const auth = request.headers.get('Authorization');
        const contentType = request.headers.get('Content-Type') ?? '';
        const body = contentType.startsWith('multipart/form-data')
          ? Object.fromEntries((await request.formData()).entries())
          : await request.json();
        seen.push({ auth, body });
        if (auth === `Bearer ${validToken}`) {
          return HttpResponse.json({ ok: true, body });
        }
        return HttpResponse.json({ statusCode: 401 }, { status: 401 });
      });
    }

    it('retries a JSON body after the refresh', async () => {
      const seen: unknown[] = [];
      server.use(protectedPost('fresh', seen), refreshEndpoint(200, 'fresh'));

      const result = await client.post({
        url: PROTECTED,
        body: { text: 'hello' },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(result.response?.status).toBe(200);
      expect(seen).toEqual([
        { auth: 'Bearer expired', body: { text: 'hello' } },
        { auth: 'Bearer fresh', body: { text: 'hello' } },
      ]);
    });

    it('retries a form body after the refresh', async () => {
      const seen: unknown[] = [];
      server.use(protectedPost('fresh', seen), refreshEndpoint(200, 'fresh'));
      const form = new FormData();
      form.append('name', 'avatar');

      const result = await client.post({
        url: PROTECTED,
        body: form,
        bodySerializer: null,
        headers: { 'Content-Type': null },
      });

      expect(result.response?.status).toBe(200);
      expect(seen).toEqual([
        { auth: 'Bearer expired', body: { name: 'avatar' } },
        { auth: 'Bearer fresh', body: { name: 'avatar' } },
      ]);
    });

    it('retries a JSON body with the current token when the token changed in flight', async () => {
      tokenService.setAccessToken('old');
      const seen: unknown[] = [];
      server.use(
        http.post(`${API}${PROTECTED}`, async ({ request }) => {
          const auth = request.headers.get('Authorization');
          seen.push({ auth, body: await request.json() });
          if (auth === 'Bearer old') {
            tokenService.setAccessToken('new');
            return HttpResponse.json({ statusCode: 401 }, { status: 401 });
          }
          return HttpResponse.json({ ok: true });
        }),
      );

      const result = await client.post({
        url: PROTECTED,
        body: { text: 'hello' },
        headers: { 'Content-Type': 'application/json' },
      });

      expect(result.response?.status).toBe(200);
      expect(seen).toEqual([
        { auth: 'Bearer old', body: { text: 'hello' } },
        { auth: 'Bearer new', body: { text: 'hello' } },
      ]);
      expect(mockRefreshSessionWithRetry).not.toHaveBeenCalled();
    });
  });

  it('shares one refresh request between concurrent 401s', async () => {
    let refreshRequests = 0;
    server.use(
      protectedEndpoint('fresh'),
      refreshEndpoint(200, 'fresh', () => refreshRequests++),
    );

    const results = await Promise.all([
      client.get({ url: PROTECTED }),
      client.get({ url: PROTECTED }),
      client.get({ url: PROTECTED }),
    ]);

    expect(results.map((r) => r.response?.status)).toEqual([200, 200, 200]);
    expect(refreshRequests).toBe(1);
  });

  it('leaves 401s from /api/auth/* alone', async () => {
    server.use(
      http.post(`${API}/api/auth/login`, () =>
        HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 }),
      ),
    );

    const result = await client.post({ url: '/api/auth/login', body: {} });

    expect(result.response?.status).toBe(401);
    expect(mockRefreshSessionWithRetry).not.toHaveBeenCalled();
    expect(authFailure).not.toHaveBeenCalled();
  });

  it('retries with the current token, without refreshing, when the token changed in flight', async () => {
    tokenService.setAccessToken('old');
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}${PROTECTED}`, ({ request }) => {
        const auth = request.headers.get('Authorization');
        seen.push(auth);
        if (auth === 'Bearer old') {
          // Another request refreshed the token while this one was in flight
          tokenService.setAccessToken('new');
          return HttpResponse.json({ statusCode: 401 }, { status: 401 });
        }
        return HttpResponse.json({ ok: true, auth });
      }),
    );

    const result = await client.get({ url: PROTECTED });

    expect(result.response?.status).toBe(200);
    expect(result.data).toEqual({ ok: true, auth: 'Bearer new' });
    expect(seen).toEqual(['Bearer old', 'Bearer new']);
    expect(mockRefreshSessionWithRetry).not.toHaveBeenCalled();
  });

  it('passes through responses that are not 401', async () => {
    server.use(
      http.get(`${API}${PROTECTED}`, () =>
        HttpResponse.json({ message: 'nope' }, { status: 403 }),
      ),
    );

    const result = await client.get({ url: PROTECTED });

    expect(result.response?.status).toBe(403);
    expect(mockRefreshSessionWithRetry).not.toHaveBeenCalled();
  });
});
