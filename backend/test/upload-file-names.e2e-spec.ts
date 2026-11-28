import * as request from 'supertest';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';

/**
 * A browser sends a non-ASCII file name as plain UTF-8 in the multipart
 * `filename` parameter. It is stored as written (not garbled), with bidi
 * control characters removed, and read back the same way.
 */
describe('Upload file names (e2e)', () => {
  let app: E2eApp;
  let token: string;
  let channelId: string;

  const http = () => request(app.getHttpServer());
  const auth = () => `Bearer ${token}`;

  /** A 1×1 PNG. */
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  async function uploadAs(filename: string): Promise<string> {
    const message = await http()
      .post('/api/messages')
      .set('Authorization', auth())
      .send({
        channelId,
        spans: [
          {
            type: 'PLAINTEXT',
            text: 'file',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
      })
      .expect(201);
    const res = await http()
      .post('/api/file-upload')
      .set('Authorization', auth())
      .field('resourceType', 'MESSAGE_ATTACHMENT')
      .field('resourceId', (message.body as { id: string }).id)
      .attach('file', TINY_PNG, { filename, contentType: 'image/png' })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function storedName(fileId: string): Promise<string> {
    const res = await http()
      .get(`/api/file/${fileId}/metadata`)
      .set('Authorization', auth())
      .expect(200);
    return (res.body as { filename: string }).filename;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    await resetDatabase(app);
    await seedInstanceInvite(app);
    const creds = { username: 'it-names', password: 'Password123!' };
    await registerUser(app, creds);
    token = (await loginUser(app, creds.username, creds.password)).accessToken;
    const community = await http()
      .post('/api/community')
      .set('Authorization', auth())
      .send({ name: 'Names', description: 'e2e' })
      .expect(201);
    const channel = await http()
      .post('/api/channels')
      .set('Authorization', auth())
      .send({
        name: 'files',
        communityId: (community.body as { id: string }).id,
        type: 'TEXT',
        isPrivate: false,
      })
      .expect(201);
    channelId = (channel.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores a non-ASCII name as written, not garbled', async () => {
    const id = await uploadAs('отчёт-日本語.png');
    expect(await storedName(id)).toBe('отчёт-日本語.png');
  });

  it('stores the name without bidi controls', async () => {
    const id = await uploadAs('re‮port-ö⁦.png');
    expect(await storedName(id)).toBe('report-ö.png');
  });
});
