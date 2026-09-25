import * as request from 'supertest';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  extractCookie,
  getSetCookies,
  E2eApp,
  E2E_INVITE_CODE,
} from './helpers/e2e-app';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@/database/database.service';

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
    app = await createE2eApp();
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
});
