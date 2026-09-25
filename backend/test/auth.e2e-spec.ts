import * as request from 'supertest';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  extractCookie,
  getSetCookies,
  registerUser,
  E2eApp,
  E2E_INVITE_CODE,
} from './helpers/e2e-app';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@/database/database.service';
import { RefreshThrottlerGuard } from '@/auth/refresh-throttler.guard';

/**
 * Full authentication lifecycle against real Postgres + Redis:
 * invite-gated registration → login (access token + refresh cookie) →
 * refresh rotation (+ grace window and reuse detection) → protected route
 * access.
 */
describe('Auth flow (e2e)', () => {
  let app: E2eApp;

  const creds = {
    username: 'e2e-auth-user',
    password: 'Password123!',
    email: 'e2e-auth-user@test.local',
  };

  // State threaded through the sequential flow below
  let accessToken: string;
  let refreshCookie: string;

  beforeAll(async () => {
    // Requests can pose as other clients (X-Forwarded-For)
    app = await createE2eApp({ trustProxy: 'loopback' });
    await resetDatabase(app);
    await seedInstanceInvite(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('registration', () => {
    it('rejects registration without a valid instance invite', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .send({ code: 'not-a-real-invite', ...creds })
        .expect(404);
    });

    it('registers a user with the seeded invite and returns a sanitized user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/users')
        .send({ code: E2E_INVITE_CODE, ...creds })
        .expect(201);

      const body = res.body as { id: string; username: string; role: string };
      expect(body).toMatchObject({
        username: creds.username,
        // First user registered on a fresh instance becomes OWNER
        role: 'OWNER',
      });
      expect(typeof body.id).toBe('string');
      // UserEntity @Exclude() fields must not survive serialization
      expect(res.body).not.toHaveProperty('hashedPassword');
      expect(res.body).not.toHaveProperty('email');
    });
  });

  describe('login', () => {
    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: creds.username, password: 'WrongPassword123!' })
        .expect(401);
    });

    it('returns an access token and sets an httpOnly refresh cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: creds.username, password: creds.password })
        .expect(200);

      const body = res.body as { accessToken: string };
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken.length).toBeGreaterThan(0);
      // Non-Electron clients must not receive the refresh token in the body
      expect(res.body).not.toHaveProperty('refreshToken');

      const setCookies = getSetCookies(res);
      const refreshHeader = setCookies.find((c) =>
        c.startsWith('refresh_token='),
      );
      expect(refreshHeader).toBeDefined();
      expect(refreshHeader).toContain('HttpOnly');

      accessToken = body.accessToken;
      refreshCookie = extractCookie(setCookies, 'refresh_token')!;
    });
  });

  describe('refresh rotation', () => {
    let rotatedRefreshCookie: string;

    it('rotates the refresh token and issues a new access token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(200);

      const body = res.body as { accessToken: string };
      expect(typeof body.accessToken).toBe('string');

      rotatedRefreshCookie = extractCookie(
        getSetCookies(res),
        'refresh_token',
      )!;
      expect(rotatedRefreshCookie).toBeDefined();
      expect(rotatedRefreshCookie).not.toEqual(refreshCookie);

      // The freshly issued access token is immediately usable
      await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
    });

    it('answers a retry with the consumed token within the grace window with the same new token', async () => {
      // A second tab (or a retry after a lost response) presenting the token
      // the first refresh just rotated
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(200);

      expect(extractCookie(getSetCookies(res), 'refresh_token')).toEqual(
        rotatedRefreshCookie,
      );
    });

    it('rejects reuse of the consumed (pre-rotation) refresh token and invalidates the family', async () => {
      // Past the grace window, the consumed token is a stolen one
      const consumed = refreshCookie.slice(refreshCookie.indexOf('=') + 1);
      const { jti } = app.get(JwtService).decode<{ jti: string }>(consumed);
      await app.get(DatabaseService).refreshToken.update({
        where: { id: jti },
        data: { consumedAt: new Date(Date.now() - 60_000) },
      });

      // Reusing the consumed token is rejected...
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie)
        .expect(401);

      // ...and reuse detection revokes the whole token family: the rotated
      // token (valid until this point) must now be rejected too. This is the
      // assertion that distinguishes family invalidation from a naive
      // "token not found" rejection.
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', rotatedRefreshCookie)
        .expect(401);

      // The session is revoked, not just its refresh tokens: its access
      // tokens stop working too
      await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });

    it('rejects refresh without any token', async () => {
      await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
    });

    // A token that fails verification is a refused session: 401, so the
    // client goes to the login page. A 5xx here would read as "server
    // unavailable" and keep the client retrying (e.g. after an admin rotates
    // JWT_REFRESH_SECRET, or an Electron app's stored token expires).
    describe('with a token that fails verification', () => {
      const unverifiable = async (): Promise<[string, string][]> => {
        const user = await app
          .get(DatabaseService)
          .user.findFirstOrThrow({ where: { username: creds.username } });
        // Not the app's JwtService: its default sign options set expiresIn
        const jwt = new JwtService({});
        const secret = app.get(ConfigService).get<string>('JWT_REFRESH_SECRET');
        const now = Math.floor(Date.now() / 1000);
        return [
          [
            'expired',
            jwt.sign(
              {
                sub: user.id,
                jti: randomUUID(),
                iat: now - 3600,
                exp: now - 60,
              },
              { secret },
            ),
          ],
          [
            'signed with another secret',
            jwt.sign(
              { sub: user.id, jti: randomUUID() },
              { secret: 'not-the-refresh-secret', expiresIn: '30d' },
            ),
          ],
          ['malformed', 'garbage.x.y'],
        ];
      };

      it('answers 401 for a web cookie', async () => {
        for (const [kind, token] of await unverifiable()) {
          const res = await request(app.getHttpServer())
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${token}`);
          expect({ kind, status: res.status }).toEqual({ kind, status: 401 });
        }
      });

      it("answers 401 for an Electron client's body token", async () => {
        for (const [kind, token] of await unverifiable()) {
          const res = await request(app.getHttpServer())
            .post('/api/auth/refresh')
            .set('User-Agent', 'SemaphoreChat/1.0 Electron/37.0.0')
            .send({ refreshToken: token });
          expect({ kind, status: res.status }).toEqual({ kind, status: 401 });
        }
      });
    });
  });

  describe('protected routes', () => {
    beforeAll(async () => {
      // A new session: reuse detection above ended the previous one
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: creds.username, password: creds.password })
        .expect(200);
      accessToken = (res.body as { accessToken: string }).accessToken;
    });

    it('allows access with a valid bearer token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({ username: creds.username });
      expect(res.body).not.toHaveProperty('hashedPassword');
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/users/profile').expect(401);
    });

    it('returns 401 with a malformed token', async () => {
      await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', 'Bearer definitely-not-a-jwt')
        .expect(401);
    });
  });

  /**
   * RefreshThrottlerGuard (skipped under NODE_ENV=test elsewhere, enabled
   * here) limits refreshes per presented token. Keyed by the token's user,
   * anyone holding one of a victim's validly signed tokens (even one that
   * was logged out, rotated or revoked) could use up the victim's quota and
   * lock their live sessions out (the security review's probe).
   */
  describe('refresh rate limit', () => {
    let skip: jest.SpyInstance;

    beforeEach(() => {
      skip = jest
        .spyOn(
          RefreshThrottlerGuard.prototype as unknown as {
            shouldSkip(): Promise<boolean>;
          },
          'shouldSkip',
        )
        .mockResolvedValue(false);
    });

    afterEach(() => {
      skip.mockRestore();
    });

    it("a stolen, logged-out token doesn't lock out the victim's live session", async () => {
      const username = 'e2e-throttle-victim';
      await registerUser(app, {
        username,
        password: creds.password,
        email: `${username}@test.local`,
      });
      /** Log in as a device of its own (sessions are per user agent). */
      const loginAs = async (userAgent: string) => {
        const res = await request(app.getHttpServer())
          .post('/api/auth/login')
          .set('User-Agent', userAgent)
          .send({ username, password: creds.password })
          .expect(200);
        return {
          accessToken: (res.body as { accessToken: string }).accessToken,
          refreshCookie: extractCookie(getSetCookies(res), 'refresh_token')!,
        };
      };
      const laptop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0';
      const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari';
      const laptopSession = await loginAs(laptop);
      const stolen = laptopSession.refreshCookie;
      const live = (await loginAs(phone)).refreshCookie;
      // The stolen token's session has ended; its token is still validly
      // signed for 30 days
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('User-Agent', laptop)
        .set('Authorization', `Bearer ${laptopSession.accessToken}`)
        .set('Cookie', stolen)
        .expect(201);

      // The thief replays it from another address until throttled
      const replays = await Promise.all(
        Array.from({ length: 15 }, () =>
          request(app.getHttpServer())
            .post('/api/auth/refresh')
            .set('X-Forwarded-For', '198.51.100.7')
            .set('User-Agent', 'curl/8.0')
            .set('Cookie', stolen),
        ),
      );
      const statuses = replays.map((res) => res.status);
      expect(statuses).toContain(429);
      expect(statuses.filter((status) => status !== 429)).toEqual(
        Array(10).fill(401),
      );

      // The victim's live session, on another device and address, still
      // refreshes
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('X-Forwarded-For', '203.0.113.9')
        .set('User-Agent', phone)
        .set('Cookie', live)
        .expect(200);
    });
  });
});
