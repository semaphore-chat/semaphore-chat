import * as request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  extractCookie,
  getSetCookies,
  E2eApp,
  E2E_INVITE_CODE,
} from './helpers/e2e-app';
import { DatabaseService } from '@/database/database.service';

/**
 * The client-type contract (docs-site/docs/architecture/auth-clients.md)
 * against real Postgres + Redis: who gets a refresh token in a response body.
 * Requests here only simulate a browser's headers; what real browsers send and
 * get is in frontend/e2e/auth-token-delivery.spec.ts.
 */
describe('Auth client-type contract (e2e)', () => {
  let app: E2eApp;

  const creds = {
    username: 'e2e-client-type',
    password: 'Password123!',
    email: 'e2e-client-type@test.local',
  };
  const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0';
  const ELECTRON_UA =
    'Mozilla/5.0 (X11; Linux x86_64) SemaphoreChat/0.6.0 Chrome/140.0.0.0 Electron/39.0.0';
  const NATIVE_UA = 'SemaphoreChat-Desktop/0.1.0 (linux)';
  const WEB_ORIGIN = 'https://chat.example.com';

  const server = () => app.getHttpServer();
  const login = (headers: Record<string, string>) =>
    request(server())
      .post('/api/auth/login')
      .set(headers)
      .send({ username: creds.username, password: creds.password });
  const nativeHeaders = (extra: Record<string, string> = {}) => ({
    'User-Agent': NATIVE_UA,
    'X-Client-Type': 'desktop-native',
    'X-Device-Id': randomUUID(),
    ...extra,
  });

  function without(headers: Record<string, string>, name: string) {
    return Object.fromEntries(
      Object.entries(headers).filter(([key]) => key !== name),
    );
  }

  async function webSession() {
    const res = await login({ 'User-Agent': BROWSER_UA }).expect(200);
    return extractCookie(getSetCookies(res), 'refresh_token')!;
  }
  async function nativeSession(extra: Record<string, string> = {}) {
    const headers = nativeHeaders(extra);
    const res = await login(headers).expect(200);
    const body = res.body as { accessToken: string; refreshToken: string };
    return { headers, ...body };
  }
  const tokenRow = (refreshToken: string) => {
    const { jti } = app.get(JwtService).decode<{ jti: string }>(refreshToken);
    return app
      .get(DatabaseService)
      .refreshToken.findUniqueOrThrow({ where: { id: jti } });
  };

  beforeAll(async () => {
    app = await createE2eApp({
      trustProxy: 'loopback',
      corsOrigin: `${WEB_ORIGIN},null`,
    });
    await resetDatabase(app);
    await seedInstanceInvite(app);
    await request(server())
      .post('/api/users')
      .send({ code: E2E_INVITE_CODE, ...creds })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/refresh', () => {
    it.each([
      ['a forged Electron user agent', { 'User-Agent': ELECTRON_UA }],
      [
        'a declared native type',
        { 'User-Agent': BROWSER_UA, 'X-Client-Type': 'desktop-native' },
      ],
      [
        'a forged user agent, type and Origin: null, as Firefox page script can send',
        {
          'User-Agent': ELECTRON_UA,
          'X-Client-Type': 'electron',
          Origin: 'null',
          'Sec-Fetch-Site': 'same-origin',
        },
      ],
      [
        'a request that looks like a native client in every way',
        { ...nativeHeaders() },
      ],
    ])(
      'never answers a cookie in the body, with %s',
      async (_name, headers) => {
        const cookie = await webSession();

        const res = await request(server())
          .post('/api/auth/refresh')
          .set(headers)
          .set('Cookie', cookie)
          .send({})
          .expect(200);

        expect(res.body).not.toHaveProperty('refreshToken');
        expect(typeof (res.body as { accessToken: string }).accessToken).toBe(
          'string',
        );
        // It rotates like any cookie refresh
        const rotated = extractCookie(getSetCookies(res), 'refresh_token');
        expect(rotated).toBeDefined();
        expect(rotated).not.toEqual(cookie);
      },
    );

    it('acts on a valid body token when a cookie comes with it', async () => {
      const cookie = await webSession();
      const native = await nativeSession();

      const res = await request(server())
        .post('/api/auth/refresh')
        .set(native.headers)
        .set('Cookie', cookie)
        .send({ refreshToken: native.refreshToken })
        .expect(200);

      const { refreshToken } = res.body as { refreshToken: string };
      expect(typeof refreshToken).toBe('string');
      // The new token is the body token's session's...
      expect((await tokenRow(refreshToken)).familyId).toEqual(
        (await tokenRow(native.refreshToken)).familyId,
      );
      // ...and the cookie's session wasn't rotated
      const cookieToken = cookie.slice(cookie.indexOf('=') + 1);
      expect((await tokenRow(cookieToken)).consumed).toBe(false);
    });

    it.each([
      ['garbage', 'garbage.x.y'],
      ['the wrong type', 123],
      ['empty', ''],
    ])(
      'refuses an invalid body token (%s) without falling back to the cookie',
      async (_name, refreshToken) => {
        const cookie = await webSession();

        await request(server())
          .post('/api/auth/refresh')
          .set('User-Agent', BROWSER_UA)
          .set('Cookie', cookie)
          .send({ refreshToken })
          .expect(401);

        // The cookie's session wasn't touched, and still works
        const cookieToken = cookie.slice(cookie.indexOf('=') + 1);
        expect((await tokenRow(cookieToken)).consumed).toBe(false);
        await request(server())
          .post('/api/auth/refresh')
          .set('User-Agent', BROWSER_UA)
          .set('Cookie', cookie)
          .expect(200);
      },
    );

    it('keeps an Electron build from before the header working', async () => {
      const signIn = await login({ 'User-Agent': ELECTRON_UA }).expect(200);
      const { refreshToken } = signIn.body as { refreshToken: string };
      expect(typeof refreshToken).toBe('string');

      const res = await request(server())
        .post('/api/auth/refresh')
        .set('User-Agent', ELECTRON_UA)
        .send({ refreshToken })
        .expect(200);

      expect(typeof (res.body as { refreshToken: string }).refreshToken).toBe(
        'string',
      );
    });

    it('rotates a native session in the body, with no cookies', async () => {
      const native = await nativeSession();

      const res = await request(server())
        .post('/api/auth/refresh')
        .set(native.headers)
        .send({ refreshToken: native.refreshToken })
        .expect(200);

      expect(getSetCookies(res)).toEqual([]);
      expect((res.body as { refreshToken: string }).refreshToken).not.toEqual(
        native.refreshToken,
      );
    });
  });

  describe('replay detection', () => {
    const fromAddress = { 'X-Forwarded-For': '203.0.113.50' };

    it('hands a retry of a native client the same successor', async () => {
      const headers = nativeHeaders(fromAddress);
      const signIn = await login(headers).expect(200);
      const { refreshToken } = signIn.body as { refreshToken: string };
      const refresh = () =>
        request(server())
          .post('/api/auth/refresh')
          .set(headers)
          .send({ refreshToken })
          .expect(200);

      const first = await refresh();
      const retry = await refresh();

      expect((retry.body as { refreshToken: string }).refreshToken).toEqual(
        (first.body as { refreshToken: string }).refreshToken,
      );
    });

    it.each([
      [
        'another device id',
        (headers: Record<string, string>) => ({
          ...headers,
          'X-Device-Id': randomUUID(),
        }),
      ],
      [
        'no device id',
        (headers: Record<string, string>) => without(headers, 'X-Device-Id'),
      ],
      [
        'another user agent',
        (headers: Record<string, string>) => ({
          ...headers,
          'User-Agent': 'curl/8.0',
        }),
      ],
      [
        'another address',
        (headers: Record<string, string>) => ({
          ...headers,
          'X-Forwarded-For': '198.51.100.9',
        }),
      ],
    ])(
      'ends the session on a replay within the grace window with %s',
      async (_name, thief) => {
        const headers = nativeHeaders(fromAddress);
        const signIn = await login(headers).expect(200);
        const { refreshToken, accessToken } = signIn.body as {
          refreshToken: string;
          accessToken: string;
        };
        const rotation = await request(server())
          .post('/api/auth/refresh')
          .set(headers)
          .send({ refreshToken })
          .expect(200);

        await request(server())
          .post('/api/auth/refresh')
          .set(thief(headers))
          .send({ refreshToken })
          .expect(401);

        await request(server())
          .post('/api/auth/refresh')
          .set(headers)
          .send({
            refreshToken: (rotation.body as { refreshToken: string })
              .refreshToken,
          })
          .expect(401);
        await request(server())
          .get('/api/users/profile')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(401);
      },
    );
  });

  describe('POST /auth/login', () => {
    it('is cookies for a web client', async () => {
      const res = await login({ 'User-Agent': BROWSER_UA }).expect(200);
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(extractCookie(getSetCookies(res), 'refresh_token')).toBeDefined();
    });

    it('is cookies for an unknown client type', async () => {
      const res = await login({
        'User-Agent': BROWSER_UA,
        'X-Client-Type': 'toaster',
      }).expect(200);
      expect(res.body).not.toHaveProperty('refreshToken');
    });

    it('is the body, with no cookies, for a native client', async () => {
      const res = await login(nativeHeaders()).expect(200);
      expect(typeof (res.body as { refreshToken: string }).refreshToken).toBe(
        'string',
      );
      expect(getSetCookies(res)).toEqual([]);
    });

    it.each([
      ['no device id', { 'X-Device-Id': '' }],
      ['a malformed device id', { 'X-Device-Id': 'not-a-uuid' }],
      ['no user agent', { 'User-Agent': '' }],
    ])('refuses a native client with %s', async (_name, override) => {
      await login(nativeHeaders(override)).expect(400);
    });

    it.each([
      ['a native type with a web Origin', { Origin: WEB_ORIGIN }],
      ['a native type with Origin: null', { Origin: 'null' }],
      ['a native type with fetch metadata', { 'Sec-Fetch-Mode': 'cors' }],
    ])('is cookies for %s', async (_name, page) => {
      const res = await login(nativeHeaders(page)).expect(200);
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(extractCookie(getSetCookies(res), 'refresh_token')).toBeDefined();
    });

    it.each([
      ['a web Origin', { Origin: WEB_ORIGIN }],
      ['same-origin fetch metadata', { 'Sec-Fetch-Site': 'same-origin' }],
      [
        'Origin: null with same-origin fetch metadata',
        { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
      ],
    ])(
      'is cookies for an Electron user agent or type with %s',
      async (_name, page) => {
        const clients: Record<string, string>[] = [
          { 'User-Agent': ELECTRON_UA },
          { 'User-Agent': ELECTRON_UA, 'X-Client-Type': 'electron' },
        ];
        for (const client of clients) {
          const headers: Record<string, string> = { ...client, ...page };
          const res = await login(headers).expect(200);
          expect(res.body).not.toHaveProperty('refreshToken');
        }
      },
    );

    it.each([
      ['an Electron build from before the header', {}],
      ['a build that declares it', { 'X-Client-Type': 'electron' }],
      [
        'the packaged app with its fetch metadata',
        { 'X-Client-Type': 'electron', 'Sec-Fetch-Site': 'cross-site' },
      ],
      ['a build that sends Origin: null', { Origin: 'null' }],
    ])('is the body for %s', async (_name, extra) => {
      const res = await login({ 'User-Agent': ELECTRON_UA, ...extra }).expect(
        200,
      );
      expect(typeof (res.body as { refreshToken: string }).refreshToken).toBe(
        'string',
      );
    });
  });

  describe('POST /auth/desktop/token', () => {
    function pkce() {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      return { verifier, challenge };
    }
    async function approvedCode() {
      const signIn = await login({ 'User-Agent': BROWSER_UA }).expect(200);
      const { accessToken } = signIn.body as { accessToken: string };
      const { verifier, challenge } = pkce();
      const authorized = await request(server())
        .post('/api/auth/desktop/authorize')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          codeChallenge: challenge,
          codeChallengeMethod: 'S256',
          password: creds.password,
        })
        .expect(200);
      return { code: (authorized.body as { code: string }).code, verifier };
    }
    const redeem = (
      headers: Record<string, string>,
      grant: { code: string; verifier: string },
    ) =>
      request(server())
        .post('/api/auth/desktop/token')
        .set(headers)
        .send({ code: grant.code, codeVerifier: grant.verifier });

    it.each([
      ['a native client', 'desktop-native'],
      ['a mobile client', 'mobile-native'],
    ])('is the body for %s', async (_name, clientType) => {
      const res = await redeem(
        nativeHeaders({ 'X-Client-Type': clientType }),
        await approvedCode(),
      ).expect(200);

      const { refreshToken } = res.body as { refreshToken: string };
      expect(typeof refreshToken).toBe('string');
      expect(getSetCookies(res)).toEqual([]);
      expect((await tokenRow(refreshToken)).clientType).toBe(clientType);
    });

    it('is cookies for a page declaring a native type', async () => {
      const res = await redeem(
        nativeHeaders({ Origin: WEB_ORIGIN }),
        await approvedCode(),
      ).expect(200);
      expect(res.body).not.toHaveProperty('refreshToken');
    });

    it("refuses a native client that can't identify itself, keeping the code", async () => {
      const grant = await approvedCode();

      await redeem(
        { 'User-Agent': NATIVE_UA, 'X-Client-Type': 'desktop-native' },
        grant,
      ).expect(400);

      await redeem(nativeHeaders(), grant).expect(200);
    });
  });

  describe('POST /auth/logout', () => {
    it('ends a native session from its body token', async () => {
      const native = await nativeSession();

      await request(server())
        .post('/api/auth/logout')
        .set(native.headers)
        .set('Authorization', `Bearer ${native.accessToken}`)
        .send({ refreshToken: native.refreshToken })
        .expect(201);

      await request(server())
        .post('/api/auth/refresh')
        .set(native.headers)
        .send({ refreshToken: native.refreshToken })
        .expect(401);
      await request(server())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${native.accessToken}`)
        .expect(401);
    });
  });

  describe('session metadata', () => {
    const sessions = (accessToken: string) =>
      request(server())
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    type Listed = { id: string; deviceName: string; isCurrent: boolean };

    it('stores the type and a sanitized, capped device name', async () => {
      const native = await nativeSession({
        'X-Client-Type': 'mobile-native',
        'X-Device-Name': encodeURIComponent(
          `Zoë's <b>iPhone</b>\r\n‮${'x'.repeat(200)}`,
        ),
      });

      const row = await tokenRow(native.refreshToken);
      expect(row.clientType).toBe('mobile-native');
      expect(row.deviceName).toMatch(/^Zoë's b iPhone \/b x+$/);
      expect(Array.from(row.deviceName!).length).toBeLessThanOrEqual(64);
    });

    it('falls back to a generic name, and keeps both through a rotation', async () => {
      const unnamed = await nativeSession();
      expect((await tokenRow(unnamed.refreshToken)).deviceName).toBe(
        'Semaphore Chat Desktop',
      );

      const named = await nativeSession({ 'X-Device-Name': 'Work laptop' });
      const res = await request(server())
        .post('/api/auth/refresh')
        .set(without(named.headers, 'X-Device-Name'))
        .send({ refreshToken: named.refreshToken })
        .expect(200);

      const rotated = await tokenRow(
        (res.body as { refreshToken: string }).refreshToken,
      );
      expect(rotated.deviceName).toBe('Work laptop');
      expect(rotated.clientType).toBe('desktop-native');
    });

    it('takes no device name from a web client', async () => {
      const res = await login({
        'User-Agent': BROWSER_UA,
        'X-Device-Name': 'Forged',
      }).expect(200);
      const cookie = extractCookie(getSetCookies(res), 'refresh_token')!;
      const row = await tokenRow(cookie.slice(cookie.indexOf('=') + 1));
      expect(row.clientType).toBe('web');
      expect(row.deviceName).toBe('Firefox on Linux');
    });

    it("knows a client's current session without a cookie", async () => {
      const native = await nativeSession();

      const listed = (await sessions(native.accessToken)).body as Listed[];
      const current = listed.filter((s) => s.isCurrent);

      expect(current).toHaveLength(1);
      expect(current[0].id).toEqual(
        (await tokenRow(native.refreshToken)).familyId,
      );
    });

    it('revokes the other sessions of a client without a cookie', async () => {
      const other = await nativeSession();
      const native = await nativeSession();

      await request(server())
        .delete('/api/auth/sessions')
        .set('Authorization', `Bearer ${native.accessToken}`)
        .expect(200);

      await request(server())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${native.accessToken}`)
        .expect(200);
      await request(server())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${other.accessToken}`)
        .expect(401);
    });
  });

  describe('CORS', () => {
    const preflight = (origin: string) =>
      request(server())
        .options('/api/auth/login')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-client-type');

    it.each([
      ['a configured web origin', WEB_ORIGIN],
      ['an Origin: null client, if allowed', 'null'],
    ])('lets %s send X-Client-Type', async (_name, origin) => {
      const res = await preflight(origin).expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-headers']).toContain(
        'x-client-type',
      );
    });

    it('allows no other origin', async () => {
      const res = await preflight('https://evil.example');
      expect(res.headers).not.toHaveProperty('access-control-allow-origin');
    });
  });
});
