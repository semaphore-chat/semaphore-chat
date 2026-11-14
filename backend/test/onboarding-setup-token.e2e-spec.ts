import * as request from 'supertest';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { createE2eApp, resetDatabase, E2eApp } from './helpers/e2e-app';

/**
 * First-run setup must not hand the setup token to whoever asks first. By
 * default (REQUIRE_SETUP_TOKEN unset) the public status endpoint never
 * returns it: the backend logs it, and the operator pastes it into the
 * wizard. REQUIRE_SETUP_TOKEN=false keeps the old zero-friction flow.
 */
type StatusBody = {
  needsSetup: boolean;
  hasUsers: boolean;
  setupTokenRequired: boolean;
  setupToken?: string;
};

describe('Onboarding setup token (e2e)', () => {
  let app: E2eApp;
  let redis: Redis;

  const setupBody = {
    adminUsername: 'e2e-owner',
    adminPassword: 'Password123!',
    instanceName: 'E2E Instance',
    createDefaultCommunity: false,
  };

  beforeAll(async () => {
    app = await createE2eApp();
    redis = app.get<Redis>(REDIS_CLIENT);
  });

  beforeEach(async () => {
    delete process.env.REQUIRE_SETUP_TOKEN;
    delete process.env.SETUP_TOKEN;
    await resetDatabase(app);
    await redis.del('onboarding:setup-token');
  });

  afterAll(async () => {
    delete process.env.REQUIRE_SETUP_TOKEN;
    delete process.env.SETUP_TOKEN;
    await redis.del('onboarding:setup-token');
    await app.close();
  });

  it('does not return the setup token on a fresh instance', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/onboarding/status')
      .expect(200);

    expect(res.body).toEqual({
      needsSetup: true,
      hasUsers: false,
      setupTokenRequired: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(
      (await redis.get('onboarding:setup-token')) as string,
    );
  });

  it('refuses setup with a token the client never saw in the logs', async () => {
    await request(app.getHttpServer()).get('/api/onboarding/status');

    await request(app.getHttpServer())
      .post('/api/onboarding/setup')
      .send({ ...setupBody, setupToken: 'guessed-token' })
      .expect(409);

    const status = await request(app.getHttpServer())
      .get('/api/onboarding/status')
      .expect(200);
    expect((status.body as StatusBody).needsSetup).toBe(true);
  });

  it('completes setup with the logged token, pasted with whitespace', async () => {
    await request(app.getHttpServer()).get('/api/onboarding/status');
    const token = await redis.get('onboarding:setup-token');
    expect(token).toBeTruthy();
    // Stored without expiry: the operator may read the log hours later
    expect(await redis.ttl('onboarding:setup-token')).toBe(-1);

    await request(app.getHttpServer())
      .post('/api/onboarding/setup')
      .send({ ...setupBody, setupToken: `  ${token}\n` })
      .expect(200);

    const status = await request(app.getHttpServer())
      .get('/api/onboarding/status')
      .expect(200);
    expect((status.body as StatusBody).needsSetup).toBe(false);
    expect(status.body).not.toHaveProperty('setupToken');
  });

  it('accepts the operator-set SETUP_TOKEN and nothing else', async () => {
    process.env.SETUP_TOKEN = 'operator-chosen-token-123';
    await request(app.getHttpServer()).get('/api/onboarding/status');
    const redisToken = await redis.get('onboarding:setup-token');

    if (redisToken) {
      await request(app.getHttpServer())
        .post('/api/onboarding/setup')
        .send({ ...setupBody, setupToken: redisToken })
        .expect(409);
    }

    await request(app.getHttpServer())
      .post('/api/onboarding/setup')
      .send({ ...setupBody, setupToken: 'operator-chosen-token-123' })
      .expect(200);
  });

  it('returns the token as before when REQUIRE_SETUP_TOKEN=false', async () => {
    process.env.REQUIRE_SETUP_TOKEN = 'false';

    const res = await request(app.getHttpServer())
      .get('/api/onboarding/status')
      .expect(200);

    const body = res.body as StatusBody;
    expect(body.setupTokenRequired).toBe(false);
    expect(typeof body.setupToken).toBe('string');

    await request(app.getHttpServer())
      .post('/api/onboarding/setup')
      .send({ ...setupBody, setupToken: body.setupToken })
      .expect(200);
  });

  it('never returns a configured SETUP_TOKEN, even with REQUIRE_SETUP_TOKEN=false', async () => {
    process.env.REQUIRE_SETUP_TOKEN = 'false';
    process.env.SETUP_TOKEN = 'operator-chosen-token-123';

    const res = await request(app.getHttpServer())
      .get('/api/onboarding/status')
      .expect(200);

    expect(res.body).toEqual({
      needsSetup: true,
      hasUsers: false,
      setupTokenRequired: true,
    });
  });

  it('replaces a token an older version stored (with its 15-minute expiry)', async () => {
    // The old version's token: its status endpoint returned it to anyone
    await redis.set('onboarding:setup-token', 'old-public-token', 'EX', 900);

    await request(app.getHttpServer()).get('/api/onboarding/status');

    const token = await redis.get('onboarding:setup-token');
    expect(token).toBeTruthy();
    expect(token).not.toBe('old-public-token');
    expect(await redis.ttl('onboarding:setup-token')).toBe(-1);
    await request(app.getHttpServer())
      .post('/api/onboarding/setup')
      .send({ ...setupBody, setupToken: 'old-public-token' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/onboarding/setup')
      .send({ ...setupBody, setupToken: token })
      .expect(200);
  });
});
