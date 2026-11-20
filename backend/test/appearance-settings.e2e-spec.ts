import * as request from 'supertest';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  registerUser,
  loginUser,
  E2eApp,
} from './helpers/e2e-app';

/**
 * GET/PATCH /api/appearance-settings against the real database, for the
 * `loadRemoteContent` switch: on for a new user, a partial PATCH turns it off
 * and leaves the other fields alone, and a non-boolean is refused.
 */
describe('Appearance settings: loadRemoteContent (e2e)', () => {
  let app: E2eApp;
  let token: string;

  const get = () =>
    request(app.getHttpServer())
      .get('/api/appearance-settings')
      .set('Authorization', `Bearer ${token}`);
  const patch = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/api/appearance-settings')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    app = await createE2eApp();
    await resetDatabase(app);
    await seedInstanceInvite(app);
    await registerUser(app, { username: 'rcs-user', password: 'Password123!' });
    token = (await loginUser(app, 'rcs-user', 'Password123!')).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('is on for a new user', async () => {
    const res = await get().expect(200);
    expect(res.body).toMatchObject({ loadRemoteContent: true });
  });

  it('a PATCH of only loadRemoteContent turns it off and keeps the rest', async () => {
    const before = (await get().expect(200)).body as Record<string, unknown>;
    const res = await patch({ loadRemoteContent: false }).expect(200);
    expect(res.body).toMatchObject({
      loadRemoteContent: false,
      themeMode: before.themeMode,
      baseColor: before.baseColor,
      newDesign: before.newDesign,
    });
    expect((await get().expect(200)).body).toMatchObject({
      loadRemoteContent: false,
    });
  });

  it('refuses a non-boolean', async () => {
    await patch({ loadRemoteContent: 'no' }).expect(400);
    expect((await get().expect(200)).body).toMatchObject({
      loadRemoteContent: false,
    });
  });
});
