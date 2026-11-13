import * as request from 'supertest';
import { DatabaseService } from '@/database/database.service';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';

/**
 * Concurrent uploads must not all pass the quota check before any of them
 * is counted: the reservation is one conditional update.
 */
describe('Storage quota under concurrent uploads (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let userId: string;
  let token: string;

  const FILE_SIZE = 100 * 1024;
  const CONCURRENT = 5;

  const upload = () =>
    request(app.getHttpServer())
      .post('/api/file-upload')
      .set('Authorization', `Bearer ${token}`)
      .field('resourceType', 'MESSAGE_ATTACHMENT')
      .attach('file', Buffer.alloc(FILE_SIZE, 0x61), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

  const usage = async () =>
    Number(
      (await db.user.findUniqueOrThrow({ where: { id: userId } }))
        .storageUsedBytes,
    );

  beforeAll(async () => {
    app = await createE2eApp();
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);

    const creds = { username: 'quota-racer', password: 'Password123!' };
    userId = (await registerUser(app, creds)).id;
    token = (await loginUser(app, creds.username, creds.password)).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets exactly one of several concurrent uploads into 1.5x its size', async () => {
    await db.user.update({
      where: { id: userId },
      data: {
        storageUsedBytes: 0,
        storageQuotaBytes: Math.floor(FILE_SIZE * 1.5),
      },
    });

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () => upload()),
    );
    const statuses = results.map((res) => res.status).sort();

    expect(statuses).toEqual([201, ...Array<number>(CONCURRENT - 1).fill(413)]);
    expect(await usage()).toBe(FILE_SIZE);
    expect(
      await db.file.count({ where: { uploadedById: userId, deletedAt: null } }),
    ).toBe(1);
  });

  it('a refused upload leaves the usage unchanged', async () => {
    const before = await usage();
    await upload().expect(413);
    expect(await usage()).toBe(before);
  });
});
