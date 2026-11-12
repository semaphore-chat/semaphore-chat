import { randomUUID } from 'crypto';
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
 * Raster image uploads get a JPEG thumbnail at upload time, and that
 * thumbnail is served through the same route and access checks as the
 * original file.
 *
 * owner    InstanceRole.OWNER, sees every community and channel
 * sender   Plain member of `community`; authors the public-channel file
 * member   Plain member of `community`; may read the public channel
 * outsider Not a member of `community`
 * dmA,dmB  Share a DM group that sender is not in
 *
 * The uploaded PNG is 640×480, so its longest side (640) is over the
 * 480-pixel bound and it must get a thumbnail.
 */
describe('Image attachment thumbnails (e2e)', () => {
  let app: E2eApp;

  const names = [
    'owner',
    'sender',
    'member',
    'outsider',
    'dmA',
    'dmB',
  ] as const;
  type Who = (typeof names)[number];
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;

  let community: string;
  let open: string;
  let hidden: string;
  let dmGroup: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const spans = () => [
    {
      type: 'PLAINTEXT',
      text: 'image',
      userId: null,
      specialKind: null,
      communityId: null,
      aliasId: null,
    },
  ];

  /** A real 640×480 truecolour PNG, solid blue — 1.6 KB. */
  const BIG_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAIAAAC6s0uzAAAF+klEQVR42u3VMQ0AAAgEsdeJ' +
      'EiQiCxewNKmCWy7VAwAciwQAYMAAYMAAgAEDgAEDAAYMAAYMABgwABgwAGDAAGDAAGDAAIAB' +
      'A4ABAwAGDAAGDAAYMAAYMABgwABgwABgwACAAQOAAQMABgwABgwAGDAAGDAAYMAAYMAAYMAA' +
      'gAEDgAEDAAYMAAYMABgwABgwAGDAAGDAAGDAAIABA4ABAwAGDAAGDAAYMAAYMABgwABgwABg' +
      'wACAAQOAAQMABgwABgwAGDAAGDAAYMAAYMAAYMAAgAEDgAEDAAYMAAYMABgwABgwAGDAAGDA' +
      'AGDAAIABA4ABAwAGDAAGDAAYMAAYMABgwABgwABgwACAAQOAAQMABgwABgwAGDAAGDAAYMAA' +
      'YMAAYMAqAIABA4ABAwAGDAAGDAAYMAAYMABgwABgwACAAQOAAQOAAQMABgwABgwAGDAAGDAA' +
      'YMAAYMAAgAEDgAEDgAEDAAYMAAYMABgwABgwAGDAAGDAAIABA4ABA4ABAwAGDAAGDAAYMAAY' +
      'MABgwABgwACAAQOAAQOAAQMABgwABgwAGDAAGDAAYMAAYMAAgAEDgAEDgAEDAAYMAAYMABgw' +
      'ABgwAGDAAGDAAIABA4ABA4ABAwAGDAAGDAAYMAAYMABgwABgwACAAQOAAQOAAQMABgwABgwA' +
      'GDAAGDAAYMAAYMAAgAEDgAEDgAEDAAYMAAYMABgwABgwAGDAAGDAAIABA4ABA4ABqwAABgwA' +
      'BgwAGDAAGDAAYMAAYMAAgAEDgAEDAAYMAAYMAAYMABgwABgwAGDAAGDAAIABA4ABAwAGDAAG' +
      'DAAGDAAYMAAYMABgwABgwACAAQOAAQMABgwABgwABgwAGDAAGDAAYMAAYMAAgAEDgAEDAAYM' +
      'AAYMAAYMABgwABgwAGDAAGDAAIABA4ABAwAGDAAGDAAGDAAYMAAYMABgwABgwACAAQOAAQMA' +
      'BgwABgwABgwAGDAAGDAAYMAAYMAAgAEDgAEDAAYMAAYMAAYMABgwABgwAGDAAGDAAIABA4AB' +
      'AwAGDAAGDAAGDAAYMAAYMABgwABgwACAAQOAAQMABgwABgwABgwAGDAAGDAAYMAAYMAAgAED' +
      'gAEDAAYMAAYMAAYsAQAYMAAYMABgwABgwACAAQOAAQMABgwABgwAGDAAGDAAGDAAYMAAYMAA' +
      'gAEDgAEDAAYMAAYMABgwABgwABgwAGDAAGDAAIABA4ABAwAGDAAGDAAYMAAYMAAYMABgwABg' +
      'wACAAQOAAQMABgwABgwAGDAAGDAAGDAAYMAAYMAAgAEDgAEDAAYMAAYMABgwABgwABgwAGDA' +
      'AGDAAIABA4ABAwAGDAAGDAAYMAAYMAAYMABgwABgwACAAQOAAQMABgwABgwAGDAAGDAAGDAA' +
      'YMAAYMAAgAEDgAEDAAYMAAYMABgwABgwABgwAGDAAGDAAIABA4ABAwAGDAAGDAAYMAAYMAAY' +
      'sAoAYMAAYMAAgAEDgAEDAAYMAAYMABgwABgwAGDAAGDAAGDAAIABA4ABAwAGDAAGDAAYMAAY' +
      'MABgwABgwABgwACAAQOAAQMABgwABgwAGDAAGDAAYMAAYMAAYMAAgAEDgAEDAAYMAAYMABgw' +
      'ABgwAGDAAGDAAGDAAIABA4ABAwAGDAAGDAAYMAAYMABgwABgwABgwACAAQOAAQMABgwABgwA' +
      'GDAAGDAAYMAAYMAAYMAAgAEDgAEDAAYMAAYMABgwABgwAGDAAGDAAGDAAIABA4ABAwAGDAAG' +
      'DAAYMAAYMABgwABgwABgwACAAQOAAQMABgwABgwAGDAAGDAAYMAAYMAAYMAqAIABA4ABAwAG' +
      'DAAGDAAYMAAYMABgwABgwACAAQOAAQOAAQMABgwABgwAGDAAGDAAYMAAYMAAgAEDgAEDgAED' +
      'AAYMAAYMABgwABgwAGDAAGDAAIABA4ABA4ABAwAGDAAGDAAYMAAYMABgwABgwACAAQOAAQOA' +
      'AQMABgwABgwAGDAAGDAAYMAAYMAAgAEDgAEDgAEDAAYMAAYMABgwABgwAGDAAGDAAIABA8C/' +
      'BRWSUJ9DBAjxAAAAAElFTkSuQmCC',
    'base64',
  );

  /** A 1×1 PNG: its longest side is under the bound, so no thumbnail is made. */
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  /** Reads a binary response body instead of supertest's text default. */
  function fetchThumbnail(who: Who, fileId: string) {
    return http()
      .get(`/api/file/${fileId}/thumbnail`)
      .set('Authorization', auth(who))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
  }

  async function postMessage(
    who: Who,
    place: { channelId?: string; directMessageGroupId?: string },
  ): Promise<string> {
    const res = await http()
      .post(place.directMessageGroupId ? '/api/messages/dm' : '/api/messages')
      .set('Authorization', auth(who))
      .send({ ...place, spans: spans(), attachments: [] });
    if (res.status !== 201) {
      throw new Error(
        `postMessage as ${who} failed with ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return (res.body as { id: string }).id;
  }

  function uploadImage(who: Who, messageId: string, image: Buffer = BIG_PNG) {
    return http()
      .post('/api/file-upload')
      .set('Authorization', auth(who))
      .field('resourceType', 'MESSAGE_ATTACHMENT')
      .field('resourceId', messageId)
      .attach('file', image, {
        filename: `${randomUUID()}.png`,
        contentType: 'image/png',
      });
  }

  /** Uploads an image for a message, then attaches it the way a client does. */
  async function imageOnMessage(
    who: Who,
    place: { channelId?: string; directMessageGroupId?: string },
    image: Buffer = BIG_PNG,
  ): Promise<string> {
    const messageId = await postMessage(who, place);
    const uploaded = await uploadImage(who, messageId, image).expect(201);
    const fileId = (uploaded.body as { id: string }).id;
    await http()
      .patch(`/api/messages/${messageId}`)
      .set('Authorization', auth(who))
      .send({ attachments: [fileId] })
      .expect(200);
    return fileId;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    await resetDatabase(app);
    await seedInstanceInvite(app);

    for (const who of names) {
      const creds = {
        username: `it-${who}`.toLowerCase(),
        password: 'Password123!',
      };
      id[who] = (await registerUser(app, creds)).id;
      token[who] = (
        await loginUser(app, creds.username, creds.password)
      ).accessToken;
    }

    const communityRes = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Thumbnails', description: 'e2e' })
      .expect(201);
    community = (communityRes.body as { id: string }).id;

    for (const who of ['sender', 'member', 'dmA', 'dmB'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId: community })
        .expect(201);
    }

    open = await channel('open', false);
    hidden = await channel('hidden', true);

    const dm = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth('dmA'))
      .send({ userIds: [id.dmB] })
      .expect(201);
    dmGroup = (dm.body as { id: string }).id;
  });

  async function channel(name: string, isPrivate: boolean): Promise<string> {
    const res = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name, communityId: community, type: 'TEXT', isPrivate })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  afterAll(async () => {
    await app.close();
  });

  describe('upload', () => {
    it('generates a thumbnail for an image larger than the bound and reports it', async () => {
      const messageId = await postMessage('sender', { channelId: open });
      const res = await uploadImage('sender', messageId).expect(201);
      const body = res.body as {
        id: string;
        hasThumbnail: boolean;
        width: number | null;
        height: number | null;
      };

      expect(body.hasThumbnail).toBe(true);
      expect(body.width).toBe(640);
      expect(body.height).toBe(480);

      const metadata = await http()
        .get(`/api/file/${body.id}/metadata`)
        .set('Authorization', auth('sender'))
        .expect(200);
      expect(metadata.body).toMatchObject({
        hasThumbnail: true,
        width: 640,
        height: 480,
      });

      // The message DTO clients actually render also carries the flag.
      const patched = await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ attachments: [body.id] })
        .expect(200);
      expect(
        (
          patched.body as {
            attachments: Array<{
              hasThumbnail: boolean;
              width: number | null;
              height: number | null;
            }>;
          }
        ).attachments[0],
      ).toMatchObject({ hasThumbnail: true, width: 640, height: 480 });

      // Real JPEG bytes, not just a row that claims a thumbnail exists.
      const thumb = await fetchThumbnail('sender', body.id).expect(200);
      expect(thumb.headers['content-type']).toBe('image/jpeg');
      expect(thumb.headers['cache-control']).toBe('private, max-age=86400');
      const bytes = thumb.body as Buffer;
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes[0]).toBe(0xff);
      expect(bytes[1]).toBe(0xd8);
    });

    it('makes no thumbnail for an image already within the bound', async () => {
      const messageId = await postMessage('sender', { channelId: open });
      const res = await uploadImage('sender', messageId, TINY_PNG).expect(201);

      expect((res.body as { hasThumbnail: boolean }).hasThumbnail).toBe(false);
      await fetchThumbnail('sender', (res.body as { id: string }).id).expect(
        404,
      );
    });
  });

  describe('serving', () => {
    let publicFile: string;
    let privateFile: string;
    let dmFile: string;

    beforeAll(async () => {
      publicFile = await imageOnMessage('sender', { channelId: open });
      privateFile = await imageOnMessage('owner', { channelId: hidden });
      dmFile = await imageOnMessage('dmA', {
        directMessageGroupId: dmGroup,
      });
    });

    it('serves the uploader their own thumbnail', async () => {
      const res = await fetchThumbnail('sender', publicFile).expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('serves a community member with access to the channel', async () => {
      await fetchThumbnail('member', publicFile).expect(200);
    });

    it('refuses a user outside the community', async () => {
      await fetchThumbnail('outsider', publicFile).expect(403);
    });

    it('refuses a community member who cannot see the private channel', async () => {
      await fetchThumbnail('sender', privateFile).expect(403);
    });

    it('refuses a user who is not in the direct-message group', async () => {
      await fetchThumbnail('sender', dmFile).expect(403);
    });

    it('answers 404 when the file has no thumbnail', async () => {
      const messageId = await postMessage('sender', { channelId: open });
      const res = await uploadImage('sender', messageId, TINY_PNG).expect(201);
      await fetchThumbnail('sender', (res.body as { id: string }).id).expect(
        404,
      );
    });
  });
});
