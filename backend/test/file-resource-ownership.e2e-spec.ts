import { randomUUID } from 'crypto';
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
 * Who may upload a file for a resource, and who may point a profile or a
 * community at a file.
 *
 * owner    InstanceRole.OWNER
 * manager  Admin of `managed` only
 * sender   Plain member of `managed`, the user under test
 * other    Member of `managed`, has private files, sender isn't in their DM
 * peer     Shares a DM group with `other`
 *
 * `outside` is a community sender and manager aren't in.
 */
describe('File resource ownership (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;

  const names = ['owner', 'manager', 'sender', 'other', 'peer'] as const;
  type Who = (typeof names)[number];
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;

  let managed: string;
  let outside: string;
  let dmGroup: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  /** A mono 8-bit PCM WAV of `seconds`, small enough for the 1 MiB size cap. */
  function wav(seconds: number): Buffer {
    const sampleRate = 8000;
    const dataSize = sampleRate * seconds;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate, 28); // byte rate
    buffer.writeUInt16LE(1, 32); // block align
    buffer.writeUInt16LE(8, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    buffer.fill(0x80, 44); // 8-bit PCM silence
    return buffer;
  }

  const soundboardUpload = (who: Who, resourceId: string, seconds: number) =>
    http()
      .post('/api/file-upload')
      .set('Authorization', auth(who))
      .field('resourceType', 'SOUNDBOARD_SOUND')
      .field('resourceId', resourceId)
      .attach('file', wav(seconds), {
        filename: `${randomUUID()}.wav`,
        contentType: 'audio/wav',
      });

  function upload(who: Who, resourceType: string, resourceId?: string) {
    const req = http()
      .post('/api/file-upload')
      .set('Authorization', auth(who))
      .field('resourceType', resourceType);
    if (resourceId !== undefined) void req.field('resourceId', resourceId);
    return resourceType === 'SOUNDBOARD_SOUND'
      ? req.attach('file', Buffer.from('audio'), {
          filename: `${randomUUID()}.mp3`,
          contentType: 'audio/mpeg',
        })
      : req.attach('file', PNG, {
          filename: `${randomUUID()}.png`,
          contentType: 'image/png',
        });
  }

  const message = async (who: Who, place: Record<string, string>) =>
    (
      await db.message.create({
        data: { authorId: id[who], searchText: 'seed', ...place },
      })
    ).id;

  /** A file row without going through the upload route. */
  async function storedFile(
    uploader: Who,
    resourceType: string,
    extra: Record<string, string> = {},
  ) {
    const file = await db.file.create({
      data: {
        filename: `${randomUUID()}.png`,
        mimeType: 'image/png',
        fileType: 'IMAGE',
        size: 1,
        checksum: 'e2e',
        uploadedById: id[uploader],
        resourceType: resourceType as never,
        storagePath: `e2e/${randomUUID()}.png`,
        ...extra,
      },
    });
    return file.id;
  }

  const fileCount = (where: Record<string, string>) =>
    db.file.count({ where: { deletedAt: null, ...where } });
  const deletedAt = async (fileId: string) =>
    (await db.file.findUniqueOrThrow({ where: { id: fileId } })).deletedAt;
  const used = async (who: Who) =>
    Number(
      (await db.user.findUniqueOrThrow({ where: { id: id[who] } }))
        .storageUsedBytes,
    );

  async function community(name: string) {
    const res = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name, description: 'e2e' })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);

    for (const who of names) {
      const creds = {
        username: `fr-${who}`.toLowerCase(),
        password: 'Password123!',
      };
      id[who] = (await registerUser(app, creds)).id;
      token[who] = (
        await loginUser(app, creds.username, creds.password)
      ).accessToken;
    }

    managed = await community('Managed');
    outside = await community('Outside');
    for (const who of ['manager', 'sender', 'other', 'peer'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId: managed })
        .expect(201);
    }
    const admin = await db.role.findFirstOrThrow({
      where: { communityId: managed, actions: { has: 'UPDATE_COMMUNITY' } },
    });
    await http()
      .post(`/api/roles/community/${managed}/assign`)
      .set('Authorization', auth('owner'))
      .send({ userId: id.manager, roleId: admin.id })
      .expect(204);

    const dm = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth('other'))
      .send({ userIds: [id.peer] })
      .expect(201);
    dmGroup = (dm.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('uploading for a resource', () => {
    it("a message in someone else's DM", async () => {
      const messageId = await message('other', {
        directMessageGroupId: dmGroup,
      });
      const res = await upload('sender', 'MESSAGE_ATTACHMENT', messageId);
      expect(await fileCount({ fileMessageId: messageId })).toBe(0);
      expect(res.status).toBe(403);
    });

    it("someone else's message in a channel the sender can read", async () => {
      const channel = await db.channel.findFirstOrThrow({
        where: { communityId: managed },
      });
      const messageId = await message('other', { channelId: channel.id });
      const res = await upload('sender', 'MESSAGE_ATTACHMENT', messageId);
      expect(await fileCount({ fileMessageId: messageId })).toBe(0);
      expect(res.status).toBe(403);
    });

    it('REPLAY_CLIP has no upload path, for anyone', async () => {
      await upload('sender', 'REPLAY_CLIP', id.sender).expect(422);
      const res = await upload('sender', 'REPLAY_CLIP', id.other);
      expect([403, 422]).toContain(res.status);
    });

    it.each(['USER_AVATAR', 'USER_BANNER'])(
      '%s for another user',
      async (resourceType) => {
        const before = await used('other');
        const res = await upload('sender', resourceType, id.other);
        expect(
          await fileCount({ fileUserId: id.other, uploadedById: id.sender }),
        ).toBe(0);
        expect(await used('other')).toBe(before);
        expect(res.status).toBe(403);
      },
    );

    it.each(['COMMUNITY_AVATAR', 'COMMUNITY_BANNER', 'CUSTOM_EMOJI'])(
      '%s for a community the member does not manage',
      async (resourceType) => {
        const res = await upload('sender', resourceType, managed);
        expect(res.status).toBe(403);
      },
    );

    it.each([
      'COMMUNITY_AVATAR',
      'COMMUNITY_BANNER',
      'CUSTOM_EMOJI',
      'SOUNDBOARD_SOUND',
    ])('%s for a community the user is not in', async (resourceType) => {
      const res = await upload('manager', resourceType, outside);
      expect(res.status).toBe(403);
    });

    it('an unknown message gets the same answer as a foreign one', async () => {
      const res = await upload('sender', 'MESSAGE_ATTACHMENT', randomUUID());
      expect(res.status).toBe(403);
    });

    it('a rejected upload costs the sender no quota and stores nothing', async () => {
      const before = await used('sender');
      const rows = await db.file.count({
        where: { uploadedById: id.sender },
      });
      await upload('sender', 'USER_AVATAR', id.other).expect(403);
      expect(await used('sender')).toBe(before);
      expect(await db.file.count({ where: { uploadedById: id.sender } })).toBe(
        rows,
      );
    });

    it('accepts what the clients upload', async () => {
      const channel = await db.channel.findFirstOrThrow({
        where: { communityId: managed },
      });
      const own = await message('sender', { channelId: channel.id });
      await upload('sender', 'MESSAGE_ATTACHMENT', own).expect(201);
      await upload('sender', 'USER_AVATAR', id.sender).expect(201);
      await upload('sender', 'USER_BANNER', id.sender).expect(201);
      await upload('sender', 'USER_AVATAR', '').expect(201);
      await upload('sender', 'MESSAGE_ATTACHMENT').expect(201);
      await upload('manager', 'COMMUNITY_AVATAR', managed).expect(201);
      await upload('manager', 'COMMUNITY_BANNER', managed).expect(201);
      await upload('manager', 'CUSTOM_EMOJI', managed).expect(201);
      await soundboardUpload('manager', managed, 5).expect(201);
      await upload('owner', 'COMMUNITY_AVATAR', outside).expect(201);
    });

    it('rejects a soundboard sound longer than 30 seconds', async () => {
      const before = await fileCount({
        uploadedById: id.manager,
        resourceType: 'SOUNDBOARD_SOUND',
      });

      const res = await soundboardUpload('manager', managed, 31);

      expect(res.status).toBe(400);
      const body = res.body as { message: string };
      expect(body.message).toContain('30 seconds');
      expect(
        await fileCount({
          uploadedById: id.manager,
          resourceType: 'SOUNDBOARD_SOUND',
        }),
      ).toBe(before);
    });
  });

  describe('pointing a profile at a file', () => {
    const privateFile = async () =>
      storedFile('other', 'MESSAGE_ATTACHMENT', {
        fileMessageId: await message('other', {
          directMessageGroupId: dmGroup,
        }),
      });
    const profile = (body: Record<string, unknown>) =>
      http()
        .patch('/api/users/profile')
        .set('Authorization', auth('sender'))
        .send(body);
    const pointers = () =>
      db.user.findUniqueOrThrow({
        where: { id: id.sender },
        select: { avatarUrl: true, bannerUrl: true },
      });

    it.each(['avatar', 'banner'])("%s: another user's file", async (field) => {
      const before = await pointers();
      const res = await profile({ [field]: await privateFile() });
      expect(await pointers()).toEqual(before);
      expect(res.status).toBe(403);
    });

    it('avatar: own file of the wrong type', async () => {
      const fileId = await storedFile('sender', 'MESSAGE_ATTACHMENT');
      await profile({ avatar: fileId }).expect(403);
    });

    it('a pointer gives no access to a private file', async () => {
      const fileId = await privateFile();
      await db.user.update({
        where: { id: id.sender },
        data: { avatarUrl: fileId },
      });
      await http()
        .get(`/api/file/${fileId}/metadata`)
        .set('Authorization', auth('sender'))
        .expect(403);
      await db.user.update({
        where: { id: id.sender },
        data: { avatarUrl: null },
      });
    });

    it('own files work, and repeating the current one is fine', async () => {
      const avatar = await storedFile('sender', 'USER_AVATAR', {
        fileUserId: id.sender,
      });
      const banner = await storedFile('sender', 'USER_BANNER', {
        fileUserId: id.sender,
      });
      await profile({ avatar, banner }).expect(200);
      expect(await pointers()).toEqual({
        avatarUrl: avatar,
        bannerUrl: banner,
      });
      await db.user.update({
        where: { id: id.sender },
        data: { avatarUrl: await privateFile() },
      });
      const legacy = (await pointers()).avatarUrl;
      await profile({ avatar: legacy, displayName: 'Same' }).expect(200);
      await profile({ avatar: null, banner: null }).expect(200);
    });
  });

  describe('pointing a community at a file', () => {
    const privateFile = async () =>
      storedFile('other', 'MESSAGE_ATTACHMENT', {
        fileMessageId: await message('other', {
          directMessageGroupId: dmGroup,
        }),
      });
    const patch = (who: Who, body: Record<string, unknown>) =>
      http()
        .patch(`/api/community/${managed}`)
        .set('Authorization', auth(who))
        .send(body);
    const managerAvatar = () =>
      storedFile('manager', 'COMMUNITY_AVATAR', { fileCommunityId: managed });

    it.each(['avatar', 'banner'])("%s: another user's file", async (field) => {
      const res = await patch('manager', { [field]: await privateFile() });
      const row = await db.community.findUniqueOrThrow({
        where: { id: managed },
      });
      expect(row.avatar).toBeNull();
      expect(row.banner).toBeNull();
      expect(res.status).toBe(403);
    });

    it('creating with a foreign file', async () => {
      const res = await http()
        .post('/api/community')
        .set('Authorization', auth('owner'))
        .send({
          name: `c-${randomUUID()}`,
          description: 'e2e',
          avatar: await privateFile(),
        });
      expect(res.status).toBe(403);
    });

    it('setting then replacing cannot delete a foreign file', async () => {
      const fileId = await privateFile();
      await patch('manager', { avatar: fileId });
      await patch('manager', { avatar: await managerAvatar() });
      expect(await deletedAt(fileId)).toBeNull();
      await db.community.update({
        where: { id: managed },
        data: { avatar: null },
      });
    });

    it('replacing a foreign file left on the community leaves it alone', async () => {
      const fileId = await privateFile();
      await db.community.update({
        where: { id: managed },
        data: { avatar: fileId },
      });
      await patch('manager', { avatar: await managerAvatar() }).expect(200);
      expect(await deletedAt(fileId)).toBeNull();
      await db.community.update({
        where: { id: managed },
        data: { avatar: null },
      });
    });

    it('replacing the community image still deletes the old one', async () => {
      const first = await managerAvatar();
      await patch('manager', { avatar: first }).expect(200);
      await patch('manager', { avatar: first }).expect(200);
      const second = await managerAvatar();
      await patch('manager', { avatar: second }).expect(200);
      expect(await deletedAt(first)).not.toBeNull();
      expect(await deletedAt(second)).toBeNull();
      await db.community.update({
        where: { id: managed },
        data: { avatar: null },
      });
    });
  });
});
