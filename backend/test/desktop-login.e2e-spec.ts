import * as request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  extractCookie,
  getSetCookies,
  E2eApp,
  E2E_INVITE_CODE,
} from './helpers/e2e-app';

/**
 * Sign in with browser (desktop app) against real Postgres + Redis: the
 * browser session approves a PKCE-bound code (POST /auth/desktop/authorize),
 * the desktop app redeems it once (POST /auth/desktop/token) for a session
 * of its own, which lists and revokes like any other.
 */
describe('Desktop sign-in with browser (e2e)', () => {
  let app: E2eApp;

  const creds = {
    username: 'e2e-desktop-login',
    password: 'Password123!',
    email: 'e2e-desktop-login@test.local',
  };
  const browserUa =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0';
  const desktopUa =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 SemaphoreChat/0.6.0 Chrome/140.0.0.0 Electron/39.0.0';

  const server = () => app.getHttpServer();

  function pkce() {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  async function browserSignIn() {
    const res = await request(server())
      .post('/api/auth/login')
      .set('User-Agent', browserUa)
      .set('X-Device-Id', randomUUID())
      .send({ username: creds.username, password: creds.password })
      .expect(200);
    return {
      accessToken: (res.body as { accessToken: string }).accessToken,
      refreshCookie: extractCookie(getSetCookies(res), 'refresh_token')!,
    };
  }

  const authorize = (accessToken: string, codeChallenge: string) =>
    request(server())
      .post('/api/auth/desktop/authorize')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ codeChallenge, codeChallengeMethod: 'S256' });

  const redeem = (
    code: string,
    codeVerifier: string,
    deviceId = randomUUID(),
  ) =>
    request(server())
      .post('/api/auth/desktop/token')
      .set('User-Agent', desktopUa)
      .set('X-Device-Id', deviceId)
      .send({ code, codeVerifier });

  beforeAll(async () => {
    app = await createE2eApp();
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

  it('advertises the feature in the public settings', async () => {
    const res = await request(server())
      .get('/api/instance/settings/public')
      .expect(200);
    expect(res.body).toMatchObject({ desktopBrowserLogin: true });
  });

  it('signs the desktop app in with a session of its own, once', async () => {
    const browser = await browserSignIn();
    const { verifier, challenge } = pkce();

    const authorized = await authorize(browser.accessToken, challenge).expect(
      200,
    );
    const { code } = authorized.body as { code: string };
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const res = await redeem(code, verifier).expect(200);
    const tokens = res.body as { accessToken: string; refreshToken: string };
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');

    // The desktop session works and refreshes like an Electron login
    await request(server())
      .get('/api/users/profile')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    await request(server())
      .post('/api/auth/refresh')
      .set('User-Agent', desktopUa)
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    // Listed as the desktop app's session, next to the browser's
    const sessions = await request(server())
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${browser.accessToken}`)
      .expect(200);
    expect(
      (sessions.body as { deviceName: string }[]).map((s) => s.deviceName),
    ).toContain('Semaphore Chat Desktop (Linux)');

    // Single use
    await redeem(code, verifier).expect(401);
  });

  it('refuses a wrong verifier and burns the code', async () => {
    const browser = await browserSignIn();
    const { verifier, challenge } = pkce();
    const { code } = (
      await authorize(browser.accessToken, challenge).expect(200)
    ).body as { code: string };

    await redeem(code, pkce().verifier).expect(401);
    await redeem(code, verifier).expect(401);
  });

  it('refuses a code whose approving browser session logged out since', async () => {
    const browser = await browserSignIn();
    const { verifier, challenge } = pkce();
    const { code } = (
      await authorize(browser.accessToken, challenge).expect(200)
    ).body as { code: string };

    await request(server())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${browser.accessToken}`)
      .set('Cookie', browser.refreshCookie)
      .expect(201);

    await redeem(code, verifier).expect(401);
  });

  it('refuses to approve with the cookie alone', async () => {
    const browser = await browserSignIn();
    await request(server())
      .post('/api/auth/desktop/authorize')
      .set('Cookie', `access_token=${browser.accessToken}`)
      .send({ codeChallenge: pkce().challenge, codeChallengeMethod: 'S256' })
      .expect(401);
  });

  it('refuses a garbage bearer token even with a valid cookie', async () => {
    const browser = await browserSignIn();
    await request(server())
      .post('/api/auth/desktop/authorize')
      .set('Authorization', 'Bearer garbage')
      .set('Cookie', `access_token=${browser.accessToken}`)
      .send({ codeChallenge: pkce().challenge, codeChallengeMethod: 'S256' })
      .expect(401);
  });

  it('rejects malformed requests', async () => {
    const browser = await browserSignIn();
    await authorize(browser.accessToken, 'too-short').expect(400);
    await request(server())
      .post('/api/auth/desktop/authorize')
      .set('Authorization', `Bearer ${browser.accessToken}`)
      .send({ codeChallenge: pkce().challenge, codeChallengeMethod: 'plain' })
      .expect(400);
    await redeem('x'.repeat(43), 'not a verifier').expect(400);
  });
});
