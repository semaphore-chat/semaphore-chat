import { ServerEvents } from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import type { Server as IoServer } from 'socket.io';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { DatabaseService } from '@/database/database.service';
import { PresenceGateway } from '@/presence/presence.gateway';
import { RoomsService } from '@/rooms/rooms.service';
import { WebsocketService } from '@/websocket/websocket.service';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';

/**
 * What each kind of reader receives for a message removed through
 * DELETE /api/moderation/message/:id, which keeps the row and only sets
 * deletedAt, deletedBy and deletedByReason.
 *
 * owner   InstanceRole.OWNER
 * author  Member, wrote the removed message
 * mod     Member + Moderator (DELETE_ANY_MESSAGE)
 * member  Member only
 */
describe('Moderator-removed message visibility (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let url: string;

  const TEXT = 'canary-original-text';
  const REPLY_TEXT = 'canary-reply-text';
  const REASON = 'canary-moderation-reason';
  const FILENAME = 'canary-attachment.png';
  const PREVIEW_URL = 'https://canary-preview.test/page';
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  const users = {
    owner: { username: 'mv-owner', password: 'Password123!' },
    author: { username: 'mv-author', password: 'Password123!' },
    mod: { username: 'mv-mod', password: 'Password123!' },
    member: { username: 'mv-member', password: 'Password123!' },
  };
  type Who = keyof typeof users;
  const token: Record<Who, string> = {} as never;
  const id: Record<Who, string> = {} as never;

  let communityId: string;
  let channelId: string;
  let removedId: string;
  let fileId: string;
  let quotingId: string;
  let threadParentId: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const spans = (text: string) => [
    {
      type: 'PLAINTEXT',
      text,
      userId: null,
      specialKind: null,
      communityId: null,
      aliasId: null,
    },
  ];
  const get = (who: Who, path: string) =>
    http().get(path).set('Authorization', auth(who));

  /** Every removed value found in a response or event, by name. */
  function leaks(payload: unknown): string[] {
    const raw = JSON.stringify(payload);
    const secrets: Record<string, string> = {
      text: TEXT,
      replyText: REPLY_TEXT,
      reason: REASON,
      moderatorId: id.mod,
      attachment: FILENAME,
      linkPreview: PREVIEW_URL,
    };
    return Object.entries(secrets)
      .filter(([, value]) => raw.includes(value))
      .map(([name]) => name);
  }

  async function post(who: Who, body: Record<string, unknown>) {
    const res = await http()
      .post('/api/messages')
      .set('Authorization', auth(who))
      .send({ channelId, attachments: [], ...body })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function moderate(messageId: string) {
    await http()
      .delete(`/api/moderation/message/${messageId}`)
      .set('Authorization', auth('mod'))
      .send({ reason: REASON })
      .expect(200);
  }

  // Sockets
  const handledDisconnects = new Set<string>();
  const opened: Socket[] = [];

  async function openSubscribed(who: Who): Promise<Socket> {
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: `Bearer ${token[who]}` },
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    opened.push(client);
    const server: IoServer = app.get(WebsocketService)['server'];
    await app
      .get(RoomsService)
      .joinAllUserRooms(
        server.of('/').sockets.get(client.id!) as AuthenticatedSocket,
      );
    return client;
  }

  function nextMessageUpdate(client: Socket, messageId: string) {
    return new Promise<{ message: Record<string, unknown> }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no UPDATE_MESSAGE within 5s')),
          5000,
        );
        const listener = (payload: {
          message: Record<string, unknown> & { id: string };
        }) => {
          if (payload.message.id !== messageId) return;
          clearTimeout(timer);
          client.off(ServerEvents.UPDATE_MESSAGE, listener);
          resolve(payload);
        };
        client.on(ServerEvents.UPDATE_MESSAGE, listener);
      },
    );
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the gateway as `this` below
    const handleDisconnect = PresenceGateway.prototype.handleDisconnect;
    jest
      .spyOn(PresenceGateway.prototype, 'handleDisconnect')
      .mockImplementation(async function (this: PresenceGateway, client) {
        try {
          await handleDisconnect.call(this, client);
        } finally {
          handledDisconnects.add(client.id);
        }
      });

    app = await createE2eApp();
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as unknown as Server;
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    db = app.get(DatabaseService);
    await resetDatabase(app);
    await seedInstanceInvite(app);

    for (const who of Object.keys(users) as Who[]) {
      id[who] = (await registerUser(app, users[who])).id;
      token[who] = (
        await loginUser(app, users[who].username, users[who].password)
      ).accessToken;
    }

    const community = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Visibility', description: 'e2e' })
      .expect(201);
    communityId = (community.body as { id: string }).id;
    for (const who of ['author', 'mod', 'member'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId })
        .expect(201);
    }
    const moderator = await db.role.findFirstOrThrow({
      where: { communityId, name: 'Moderator' },
    });
    await http()
      .post(`/api/roles/community/${communityId}/assign`)
      .set('Authorization', auth('owner'))
      .send({ userId: id.mod, roleId: moderator.id })
      .expect(204);
    const channel = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name: 'visibility', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    channelId = (channel.body as { id: string }).id;

    // The message under test: text, attachment, link preview, reaction, pin,
    // a notification, a live message quoting it, and one upload still pending.
    removedId = await post('author', {
      spans: spans(TEXT),
      pendingAttachments: 3,
    });
    const upload = await http()
      .post('/api/file-upload')
      .set('Authorization', auth('author'))
      .field('resourceType', 'MESSAGE_ATTACHMENT')
      .field('resourceId', removedId)
      .attach('file', PNG, { filename: FILENAME, contentType: 'image/png' })
      .expect(201);
    fileId = (upload.body as { id: string }).id;
    await http()
      .post(`/api/messages/${removedId}/attachments`)
      .set('Authorization', auth('author'))
      .send({ fileId })
      .expect(201);
    await db.message.update({
      where: { id: removedId },
      data: { linkPreviews: [{ url: PREVIEW_URL, title: 'preview' }] },
    });
    await http()
      .post('/api/messages/reactions')
      .set('Authorization', auth('owner'))
      .send({ messageId: removedId, emoji: '👍' })
      .expect(201);
    await http()
      .post(`/api/moderation/pin/${removedId}`)
      .set('Authorization', auth('owner'))
      .expect(200);
    await db.notification.create({
      data: {
        userId: id.member,
        type: 'USER_MENTION',
        messageId: removedId,
        channelId,
        authorId: id.author,
      },
    });
    quotingId = await post('member', {
      spans: spans('quoting it'),
      replyToId: removedId,
    });
    await moderate(removedId);

    // A removed thread reply under a live parent
    threadParentId = await post('author', { spans: spans('thread parent') });
    const reply = await http()
      .post(`/api/threads/${threadParentId}/replies`)
      .set('Authorization', auth('author'))
      .send({
        parentMessageId: threadParentId,
        spans: spans(REPLY_TEXT),
        attachments: [],
      })
      .expect(201);
    await moderate((reply.body as { id: string }).id);
  });

  afterAll(async () => {
    for (const client of opened) {
      const socketId = client.id;
      client.close();
      const deadline = Date.now() + 5000;
      while (
        socketId &&
        !handledDisconnects.has(socketId) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    await app?.close();
    jest.restoreAllMocks();
  });

  describe.each(['member', 'author'] as const)('as %s', (who) => {
    it.each([
      ['channel list', () => `/api/messages/channel/${channelId}`],
      [
        'around the removed message',
        () => `/api/messages/channel/${channelId}/around/${removedId}`,
      ],
      ['fetch by id', () => `/api/messages/${removedId}`],
      [
        'channel search',
        () => `/api/messages/search/channel/${channelId}?q=canary`,
      ],
      [
        'community search',
        () => `/api/messages/search/community/${communityId}?q=canary`,
      ],
      ['thread replies', () => `/api/threads/${threadParentId}/replies`],
      ['pinned messages', () => `/api/moderation/pins/${channelId}`],
      ['quote of the removed message', () => `/api/messages/${quotingId}`],
    ])('REST %s carries none of it', async (_label, path) => {
      const res = await get(who, path()).expect(200);
      expect(leaks(res.body)).toEqual([]);
    });

    it('the attachment cannot be downloaded', async () => {
      const res = await get(who, `/api/file/${fileId}`);
      expect(res.status).toBe(403);
    });
  });

  it('REST notification list carries none of it', async () => {
    const res = await get('member', '/api/notifications').expect(200);
    const { notifications } = res.body as { notifications: unknown[] };
    expect(notifications).toHaveLength(1);
    expect(leaks(res.body)).toEqual([]);
  });

  it('the reaction endpoints carry none of it', async () => {
    const added = await http()
      .post('/api/messages/reactions')
      .set('Authorization', auth('member'))
      .send({ messageId: removedId, emoji: '🎉' })
      .expect(201);
    expect(leaks(added.body)).toEqual([]);

    const removed = await http()
      .delete('/api/messages/reactions')
      .set('Authorization', auth('member'))
      .send({ messageId: removedId, emoji: '🎉' })
      .expect(200);
    expect(leaks(removed.body)).toEqual([]);
  });

  it('a removed message stays in the list as a blank row', async () => {
    const res = await get('member', `/api/messages/${removedId}`).expect(200);
    expect(res.body).toMatchObject({
      id: removedId,
      authorId: id.author,
      spans: [],
      attachments: [],
      reactions: [],
      linkPreviews: null,
      replyTo: null,
      deletedBy: null,
      deletedByReason: null,
    });
    expect((res.body as { deletedAt: unknown }).deletedAt).toEqual(
      expect.any(String),
    );
  });

  /**
   * Runs a refused request, then a real edit: events reach a socket in order,
   * so once the later edit's arrives, one for this message would have too.
   */
  async function expectNoRebroadcast(
    messageId: string,
    refused: () => Promise<unknown>,
  ) {
    const member = await openSubscribed('member');
    const seen: string[] = [];
    member.on(
      ServerEvents.UPDATE_MESSAGE,
      (payload: { message: { id: string } }) => seen.push(payload.message.id),
    );

    await refused();

    const laterId = await post('author', { spans: spans('later') });
    const later = nextMessageUpdate(member, laterId);
    await http()
      .patch(`/api/messages/${laterId}`)
      .set('Authorization', auth('author'))
      .send({ spans: spans('later, edited') })
      .expect(200);
    await later;
    expect(seen).not.toContain(messageId);
  }

  it('a late upload is refused, so nothing is rebroadcast', async () => {
    await expectNoRebroadcast(removedId, async () => {
      const res = await http()
        .post(`/api/messages/${removedId}/attachments`)
        .set('Authorization', auth('author'))
        .send({})
        .expect(403);
      expect(leaks(res.body)).toEqual([]);
    });
  });

  it('an edit after removal is refused, changes nothing and is not rebroadcast', async () => {
    const messageId = await post('author', { spans: spans('to be removed') });
    await moderate(messageId);

    await expectNoRebroadcast(messageId, async () => {
      const res = await http()
        .patch(`/api/messages/${messageId}`)
        .set('Authorization', auth('author'))
        .send({ spans: spans('edited after removal') })
        .expect(403);
      expect(leaks(res.body)).toEqual([]);
    });

    const stored = await db.messageSpan.findMany({ where: { messageId } });
    expect(stored.map((span) => span.text)).toEqual(['to be removed']);
  });

  describe.each(['mod', 'owner'] as const)('as %s', (who) => {
    it('still sees the original in the channel list', async () => {
      const res = await get(who, `/api/messages/${removedId}`).expect(200);
      const body = res.body as {
        spans: { text: string }[];
        attachments: { filename: string }[];
      };
      expect(body.spans[0]?.text).toBe(TEXT);
      expect(body.attachments[0]?.filename).toBe(FILENAME);

      const list = await get(who, `/api/messages/channel/${channelId}`).expect(
        200,
      );
      expect(leaks(list.body)).toEqual(
        expect.arrayContaining(['text', 'attachment']),
      );
    });

    it('can still download the attachment', async () => {
      await get(who, `/api/file/${fileId}`).expect(200);
    });
  });

  it('the moderation log still records the reason', async () => {
    const res = await get(
      'owner',
      `/api/moderation/logs/${communityId}`,
    ).expect(200);
    expect(JSON.stringify(res.body)).toContain(REASON);
  });
});
