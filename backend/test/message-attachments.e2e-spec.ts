import { randomUUID } from 'crypto';
import { ClientEvents } from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
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
 * A message may only carry files its author uploaded, and changing a message
 * may only delete files its author uploaded.
 *
 * owner   InstanceRole.OWNER
 * sender  Plain member of the community, the user under test
 * friend  Shares `ownGroup` with sender
 * dmA,dmB Share `otherGroup`, which sender is not in
 *
 * Channels: `open` (sender may post and attach), `noFiles` (ATTACH_FILES
 * denied for everyone), `hidden` (private, sender isn't a member).
 */
describe('Message attachments (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let url: string;
  let socket: Socket | undefined;

  const names = ['owner', 'sender', 'friend', 'dmA', 'dmB'] as const;
  type Who = (typeof names)[number];
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;

  let open: string;
  let noFiles: string;
  let hidden: string;
  let ownGroup: string;
  let otherGroup: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const spans = (text = 'text') => [
    {
      type: 'PLAINTEXT',
      text,
      userId: null,
      specialKind: null,
      communityId: null,
      aliasId: null,
    },
  ];

  /** A stored file, attached to a real message in `place` when given. */
  async function storedFile(
    uploader: Who,
    place?: { channelId?: string; directMessageGroupId?: string },
    resourceType: 'MESSAGE_ATTACHMENT' | 'USER_AVATAR' = 'MESSAGE_ATTACHMENT',
  ) {
    const filename = `private-${randomUUID()}.png`;
    const message = place
      ? await db.message.create({
          data: { authorId: id[uploader], searchText: 'seed', ...place },
        })
      : null;
    const file = await db.file.create({
      data: {
        filename,
        mimeType: 'image/png',
        fileType: 'IMAGE',
        size: 1,
        checksum: 'e2e',
        uploadedById: id[uploader],
        resourceType,
        fileMessageId: message?.id,
        fileUserId: resourceType === 'USER_AVATAR' ? id[uploader] : undefined,
        storagePath: `e2e/${filename}`,
      },
    });
    if (message) {
      await db.messageAttachment.create({
        data: { messageId: message.id, fileId: file.id, position: 0 },
      });
    }
    return { fileId: file.id, filename };
  }

  const dmFile = () => storedFile('dmA', { directMessageGroupId: otherGroup });
  const hiddenFile = () => storedFile('owner', { channelId: hidden });

  async function ownMessage(
    place: Record<string, string> = { channelId: open },
  ) {
    const message = await db.message.create({
      data: { authorId: id.sender, searchText: 'mine', ...place },
    });
    return message.id;
  }

  /** A foreign file already attached to sender's message, as old data may have. */
  async function messageCarrying(fileId: string) {
    const messageId = await ownMessage();
    await db.messageAttachment.create({
      data: { messageId, fileId, position: 0 },
    });
    return messageId;
  }

  const deletedAt = async (fileId: string) =>
    (
      await db.file.findUniqueOrThrow({
        where: { id: fileId },
        select: { deletedAt: true },
      })
    ).deletedAt;
  const links = (fileId: string, messageId?: string) =>
    db.messageAttachment.count({
      where: { fileId, ...(messageId ? { messageId } : {}) },
    });

  async function connect(who: Who): Promise<Socket> {
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: token[who] },
    });
    socket = client;
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    return client;
  }

  function send(
    client: Socket,
    event: ClientEvents,
    payload: Record<string, unknown>,
  ): Promise<{ ack?: unknown; exception?: unknown }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no answer to ${event}`)),
        5000,
      );
      const onException = (exception: unknown) => {
        clearTimeout(timer);
        resolve({ exception });
      };
      client.once('exception', onException);
      client.emit(event, payload, (ack: unknown) => {
        clearTimeout(timer);
        client.off('exception', onException);
        resolve({ ack });
      });
    });
  }

  async function channel(
    communityId: string,
    name: string,
    isPrivate: boolean,
  ) {
    const res = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name, communityId, type: 'TEXT', isPrivate })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function dmGroup(who: Who, other: Who) {
    const res = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth(who))
      .send({ userIds: [id[other]] })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    app = await createE2eApp();
    await app.listen(0);
    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);

    for (const who of names) {
      const creds = {
        username: `at-${who}`.toLowerCase(),
        password: 'Password123!',
      };
      id[who] = (await registerUser(app, creds)).id;
      token[who] = (
        await loginUser(app, creds.username, creds.password)
      ).accessToken;
    }

    const community = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Attachments', description: 'e2e' })
      .expect(201);
    const communityId = (community.body as { id: string }).id;
    for (const who of ['sender', 'friend', 'dmA', 'dmB'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId })
        .expect(201);
    }

    open = await channel(communityId, 'open', false);
    noFiles = await channel(communityId, 'nofiles', false);
    hidden = await channel(communityId, 'hidden', true);
    await http()
      .put(`/api/channels/${noFiles}/overwrites`)
      .set('Authorization', auth('owner'))
      .send({
        preset: 'NORMAL',
        overwrites: [
          { targetType: 'EVERYONE', allow: [], deny: ['ATTACH_FILES'] },
        ],
      })
      .expect(200);

    ownGroup = await dmGroup('sender', 'friend');
    otherGroup = await dmGroup('dmA', 'dmB');
  });

  afterEach(() => {
    socket?.close();
    socket = undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("attaching another user's file", () => {
    it.each([
      ['a DM', dmFileOf],
      ['a private channel', hiddenFileOf],
    ])('REST create, file from %s', async (_label, source) => {
      const { fileId, filename } = await source();
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({ channelId: open, spans: spans(), attachments: [fileId] });
      expect(JSON.stringify(res.body)).not.toContain(filename);
      expect(await links(fileId)).toBe(1);
      expect(res.status).toBe(403);
    });

    it('SEND_MESSAGE', async () => {
      const { fileId } = await dmFile();
      const result = await send(
        await connect('sender'),
        ClientEvents.SEND_MESSAGE,
        { channelId: open, spans: spans(), attachments: [fileId] },
      );
      expect(await links(fileId)).toBe(1);
      expect(result.ack).toBeUndefined();
    });

    it('SEND_DM', async () => {
      const { fileId } = await hiddenFile();
      const result = await send(await connect('sender'), ClientEvents.SEND_DM, {
        directMessageGroupId: ownGroup,
        spans: spans(),
        attachments: [fileId],
      });
      expect(await links(fileId)).toBe(1);
      expect(result.ack).toBeUndefined();
    });

    it('thread reply, REST', async () => {
      const { fileId, filename } = await dmFile();
      const parent = await ownMessage();
      const res = await http()
        .post(`/api/threads/${parent}/replies`)
        .set('Authorization', auth('sender'))
        .send({ spans: spans(), attachments: [fileId] });
      expect(JSON.stringify(res.body)).not.toContain(filename);
      expect(await links(fileId)).toBe(1);
      expect(res.status).toBe(403);
    });

    it('thread reply, socket', async () => {
      const { fileId } = await dmFile();
      const parentMessageId = await ownMessage();
      const result = await send(
        await connect('sender'),
        ClientEvents.SEND_THREAD_REPLY,
        { parentMessageId, spans: spans(), attachments: [fileId] },
      );
      expect(await links(fileId)).toBe(1);
      expect(result.ack).toBeUndefined();
    });

    it('edit', async () => {
      const { fileId, filename } = await dmFile();
      const messageId = await ownMessage();
      const res = await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ attachments: [fileId] });
      expect(JSON.stringify(res.body)).not.toContain(filename);
      expect(await links(fileId, messageId)).toBe(0);
      expect(res.status).toBe(403);
    });

    it('POST :id/attachments', async () => {
      const { fileId, filename } = await dmFile();
      const messageId = await ownMessage();
      const res = await http()
        .post(`/api/messages/${messageId}/attachments`)
        .set('Authorization', auth('sender'))
        .send({ fileId });
      expect(JSON.stringify(res.body)).not.toContain(filename);
      expect(await links(fileId, messageId)).toBe(0);
      expect(res.status).toBe(403);
    });

    it("another user's avatar", async () => {
      const { fileId } = await storedFile('dmA', undefined, 'USER_AVATAR');
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({ channelId: open, spans: spans(), attachments: [fileId] });
      expect(await links(fileId)).toBe(0);
      expect(res.status).toBe(403);
    });

    it('an id that does not exist gets the same answer', async () => {
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({
          channelId: open,
          spans: spans(),
          attachments: [randomUUID()],
        });
      expect(res.status).toBe(403);
    });
  });

  describe('deleting files through a message', () => {
    it('an edit that drops a foreign file leaves the file alone', async () => {
      const { fileId } = await dmFile();
      const messageId = await messageCarrying(fileId);
      await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ attachments: [] })
        .expect(200);
      expect(await links(fileId, messageId)).toBe(0);
      expect(await deletedAt(fileId)).toBeNull();
    });

    it('deleting a message leaves a foreign file alone', async () => {
      const { fileId } = await hiddenFile();
      const messageId = await messageCarrying(fileId);
      await http()
        .delete(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .expect(204);
      expect(await deletedAt(fileId)).toBeNull();
    });

    it('deleting a thread parent leaves a foreign file on a reply alone', async () => {
      const { fileId } = await dmFile();
      const parentMessageId = await ownMessage();
      const reply = await db.message.create({
        data: {
          authorId: id.sender,
          channelId: open,
          parentMessageId,
          searchText: 'reply',
        },
      });
      await db.messageAttachment.create({
        data: { messageId: reply.id, fileId, position: 0 },
      });
      await http()
        .delete(`/api/messages/${parentMessageId}`)
        .set('Authorization', auth('sender'))
        .expect(204);
      expect(await deletedAt(fileId)).toBeNull();
    });
  });

  describe('reading a file', () => {
    it('attachment rows give no access to the file itself', async () => {
      const { fileId } = await dmFile();
      await messageCarrying(fileId);
      for (const path of ['metadata', 'signed-url', 'thumbnail', '']) {
        const res = await http()
          .get(`/api/file/${fileId}/${path}`.replace(/\/$/, ''))
          .set('Authorization', auth('sender'));
        expect([path, res.status]).toEqual([path, 403]);
      }
    });
  });

  describe('ATTACH_FILES', () => {
    it('blocks new files on create and on edit', async () => {
      const { fileId } = await storedFile('sender');
      await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({ channelId: noFiles, spans: spans(), attachments: [fileId] })
        .expect(403);

      const messageId = await ownMessage({ channelId: noFiles });
      await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ attachments: [fileId] })
        .expect(403);
      expect(await links(fileId)).toBe(0);
    });
  });

  describe('own files', () => {
    it('attach on every path and are deleted when removed', async () => {
      const onCreate = await storedFile('sender');
      const created = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({
          channelId: open,
          spans: spans(),
          attachments: [onCreate.fileId],
        })
        .expect(201);
      const messageId = (created.body as { id: string }).id;
      expect(JSON.stringify(created.body)).toContain(onCreate.filename);

      const onAttach = await storedFile('sender');
      await http()
        .post(`/api/messages/${messageId}/attachments`)
        .set('Authorization', auth('sender'))
        .send({ fileId: onAttach.fileId })
        .expect(201);

      const onEdit = await storedFile('sender');
      await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({
          attachments: [onCreate.fileId, onAttach.fileId, onEdit.fileId],
        })
        .expect(200);
      expect(await links(onEdit.fileId, messageId)).toBe(1);

      await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ attachments: [onAttach.fileId, onEdit.fileId] })
        .expect(200);
      expect(await deletedAt(onCreate.fileId)).not.toBeNull();

      await http()
        .delete(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .expect(204);
      expect(await deletedAt(onAttach.fileId)).not.toBeNull();
      expect(await deletedAt(onEdit.fileId)).not.toBeNull();
    });

    it('an edit may repeat a foreign file already on the message', async () => {
      const { fileId } = await dmFile();
      const messageId = await messageCarrying(fileId);
      await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .send({ spans: spans('edited'), attachments: [fileId] })
        .expect(200);
      expect(await links(fileId, messageId)).toBe(1);
    });

    it('a deleted own file cannot be attached', async () => {
      const { fileId } = await storedFile('sender');
      await db.file.update({
        where: { id: fileId },
        data: { deletedAt: new Date() },
      });
      await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send({ channelId: open, spans: spans(), attachments: [fileId] })
        .expect(403);
    });
  });

  function dmFileOf() {
    return dmFile();
  }
  function hiddenFileOf() {
    return hiddenFile();
  }
});
