import {
  ClientEvents,
  ServerEvents,
  type ServerEventPayloads,
} from '@semaphore-chat/shared';
import { mkdirSync, writeFileSync } from 'fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { dirname, resolve } from 'path';
import { io, Socket } from 'socket.io-client';
import type { Server as IoServer } from 'socket.io';
import * as request from 'supertest';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { DatabaseService } from '@/database/database.service';
import { LinkPreviewsService } from '@/link-previews/link-previews.service';
import { ClipMessageListener } from '@/messages/clip-message.listener';
import { PresenceGateway } from '@/presence/presence.gateway';
import { RoomsService } from '@/rooms/rooms.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { SENSITIVE_USER_FIELDS } from '@/test-utils/helpers/user-dto.helper';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';
import { schemaErrors, serverEventComponent } from './helpers/wire-schema';

/**
 * Real responses and real socket payloads, validated against backend/openapi.json
 * and backend/socket-events.json with every object closed (helpers/wire-schema).
 * Every path that emits a message is driven at least once.
 *
 * Set RECORD_WIRE_PAYLOADS to write what the server sent to
 * test/fixtures/message-wire-payloads.json: the replay test in the frontend
 * feeds a copy of it through the socket handlers and the message renderer.
 */
describe('Message wire contract (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let url: string;

  const users = {
    owner: { username: 'wc-owner', password: 'Password123!' },
    author: { username: 'wc-author', password: 'Password123!' },
    mod: { username: 'wc-mod', password: 'Password123!' },
    member: { username: 'wc-member', password: 'Password123!' },
  };
  type Who = keyof typeof users;
  const token: Record<Who, string> = {} as never;
  const id: Record<Who, string> = {} as never;

  let communityId: string;
  let channelId: string;
  let dmId: string;
  let listener: Socket;

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const spans = (text: string) => [{ type: 'PLAINTEXT', text }];

  // What the listening socket received, in order, and every REST body seen.
  const events: { event: string; payload: unknown }[] = [];
  const responses: { component: string; label: string; body: unknown }[] = [];

  function expectConforms(component: string, label: string, body: unknown) {
    responses.push({ component, label, body });
    expect({ label, errors: schemaErrors(component, body) }).toEqual({
      label,
      errors: [],
    });
  }

  /** The message events; the others are in socket-events-contract.e2e-spec.ts. */
  const MESSAGE_EVENTS = new Set<string>([
    ServerEvents.NEW_MESSAGE,
    ServerEvents.NEW_DM,
    ServerEvents.UPDATE_MESSAGE,
    ServerEvents.DELETE_MESSAGE,
    ServerEvents.REACTION_ADDED,
    ServerEvents.REACTION_REMOVED,
    ServerEvents.NEW_THREAD_REPLY,
    ServerEvents.THREAD_REPLY_COUNT_UPDATED,
    ServerEvents.MESSAGE_PINNED,
    ServerEvents.MESSAGE_UNPINNED,
  ]);
  const messageEvents = () => events.filter((e) => MESSAGE_EVENTS.has(e.event));

  async function nextEvent<E extends keyof ServerEventPayloads>(
    event: E,
    match: (payload: ServerEventPayloads[E]) => boolean = () => true,
  ): Promise<ServerEventPayloads[E]> {
    const seen = events.find(
      (e) =>
        e.event === (event as string) &&
        match(e.payload as ServerEventPayloads[E]),
    );
    if (seen) return seen.payload as ServerEventPayloads[E];
    const name: string = event;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        listener.off(name, onEvent);
        reject(new Error(`no ${event as string} within 5s`));
      }, 5000);
      const onEvent = (payload: unknown) => {
        const typed = payload as ServerEventPayloads[E];
        if (!match(typed)) return;
        clearTimeout(timer);
        listener.off(name, onEvent);
        resolvePromise(typed);
      };
      listener.on(name, onEvent);
    });
  }

  async function open(who: Who): Promise<Socket> {
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: `Bearer ${token[who]}` },
    });
    await new Promise<void>((resolvePromise, reject) => {
      client.once('connect', () => resolvePromise());
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

  async function postMessage(who: Who, body: Record<string, unknown>) {
    const res = await http()
      .post('/api/messages')
      .set('Authorization', auth(who))
      .send({ channelId, attachments: [], ...body })
      .expect(201);
    expectConforms('MessageDto', 'POST /messages', res.body);
    return res.body as { id: string };
  }

  const handledDisconnects = new Set<string>();
  const opened: Socket[] = [];

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
      .send({ name: 'Contract', description: 'e2e' })
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
      .send({ name: 'contract', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    channelId = (channel.body as { id: string }).id;
    const dm = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth('author'))
      .send({ userIds: [id.member], isGroup: false })
      .expect(201);
    dmId = (dm.body as { id: string }).id;

    listener = await open('member');
    listener.onAny((event: string, payload: unknown) => {
      events.push({ event, payload });
    });
  });

  afterAll(async () => {
    if (process.env.RECORD_WIRE_PAYLOADS) {
      const out = resolve(__dirname, 'fixtures/message-wire-payloads.json');
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(
        out,
        `${JSON.stringify({ events: messageEvents(), responses }, null, 2)}\n`,
      );
    }
    for (const client of opened) {
      const socketId = client.id;
      client.close();
      const deadline = Date.now() + 5000;
      while (
        socketId &&
        !handledDisconnects.has(socketId) &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    await app?.close();
    jest.restoreAllMocks();
  });

  describe('the validator', () => {
    const valid = {
      messageId: 'm1',
      channelId: null,
      directMessageGroupId: 'd1',
    };

    it('accepts a conforming payload', () => {
      expect(schemaErrors('DeleteMessagePayloadDto', valid)).toEqual([]);
    });

    it.each([
      ['an undeclared field', { ...valid, hashedPassword: 'x' }],
      [
        'a missing required field',
        { channelId: null, directMessageGroupId: 'd' },
      ],
      ['null in a non-nullable field', { ...valid, messageId: null }],
      ['a wrong type', { ...valid, channelId: 42 }],
    ])('rejects %s', (_label, payload) => {
      expect(schemaErrors('DeleteMessagePayloadDto', payload)).not.toEqual([]);
    });

    it('accepts null and rejects a wrong shape for a nullable reference', () => {
      const message = {
        id: 'm1',
        channelId: null,
        directMessageGroupId: null,
        authorId: null,
        spans: [],
        attachments: [],
        pendingAttachments: null,
        reactions: [],
        linkPreviews: null,
        replyCount: 0,
        lastReplyAt: null,
        pinned: false,
        pinnedAt: null,
        pinnedBy: null,
        sentAt: '2026-01-01T00:00:00.000Z',
        editedAt: null,
        deletedAt: null,
        parentMessageId: null,
        replyToId: null,
        replyTo: null,
        webhook: null,
      };
      expect(schemaErrors('MessageDto', message)).toEqual([]);
      expect(
        schemaErrors('MessageDto', { ...message, webhook: { id: 1 } }),
      ).not.toEqual([]);
      expect(
        schemaErrors('MessageDto', { ...message, sentAt: 'not a date' }),
      ).not.toEqual([]);
    });
  });

  describe('paths that create and change messages', () => {
    let channelMessageId: string;

    it('channel send over the socket: NEW_MESSAGE', async () => {
      const author = await open('author');
      channelMessageId = (await author
        .timeout(5000)
        .emitWithAck(ClientEvents.SEND_MESSAGE, {
          channelId,
          spans: spans('from the socket'),
          attachments: [],
        })) as string;

      const payload = await nextEvent(
        ServerEvents.NEW_MESSAGE,
        (p) => p.message.id === channelMessageId,
      );
      expect(payload.message.spans[0].text).toBe('from the socket');
    });

    it('DM send over the socket: NEW_DM', async () => {
      const author = await open('author');
      const messageId: unknown = await author
        .timeout(5000)
        .emitWithAck(ClientEvents.SEND_DM, {
          directMessageGroupId: dmId,
          spans: spans('a direct message'),
          attachments: [],
        });

      await nextEvent(ServerEvents.NEW_DM, (p) => p.message.id === messageId);
    });

    it('a quote: replyTo on the event and the response', async () => {
      const quote = await postMessage('member', {
        spans: spans('quoting'),
        replyToId: channelMessageId,
      });
      const res = await http()
        .get(`/api/messages/${quote.id}`)
        .set('Authorization', auth('member'))
        .expect(200);

      expect((res.body as { replyTo: { id: string } }).replyTo.id).toBe(
        channelMessageId,
      );
      expectConforms('MessageDto', 'GET /messages/:id (quote)', res.body);
    });

    it('edit: UPDATE_MESSAGE', async () => {
      const res = await http()
        .patch(`/api/messages/${channelMessageId}`)
        .set('Authorization', auth('author'))
        .send({ spans: spans('edited') })
        .expect(200);

      expectConforms('MessageDto', 'PATCH /messages/:id', res.body);
      await nextEvent(
        ServerEvents.UPDATE_MESSAGE,
        (p) => !!p.message.editedAt && p.message.id === channelMessageId,
      );
    });

    it('a file landing on a message: UPDATE_MESSAGE with its metadata', async () => {
      const message = await postMessage('author', {
        spans: spans('one file coming'),
        pendingAttachments: 1,
      });
      const upload = await http()
        .post('/api/file-upload')
        .set('Authorization', auth('author'))
        .field('resourceType', 'MESSAGE_ATTACHMENT')
        .field('resourceId', message.id)
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);

      const res = await http()
        .post(`/api/messages/${message.id}/attachments`)
        .set('Authorization', auth('author'))
        .send({ fileId: (upload.body as { id: string }).id })
        .expect(201);

      expectConforms('MessageDto', 'POST /messages/:id/attachments', res.body);
      const event = await nextEvent(
        ServerEvents.UPDATE_MESSAGE,
        (p) => p.message.id === message.id && p.message.attachments.length > 0,
      );
      expect(event.message.attachments[0].filename).toBe('a.png');
    });

    it('reactions over REST and the socket', async () => {
      const added = await http()
        .post('/api/messages/reactions')
        .set('Authorization', auth('author'))
        .send({ messageId: channelMessageId, emoji: '👍' })
        .expect(201);
      expectConforms('MessageReactionsDto', 'POST reactions', added.body);
      await nextEvent(ServerEvents.REACTION_ADDED);

      const removed = await http()
        .delete('/api/messages/reactions')
        .set('Authorization', auth('author'))
        .send({ messageId: channelMessageId, emoji: '👍' })
        .expect(200);
      expectConforms('MessageReactionsDto', 'DELETE reactions', removed.body);
      await nextEvent(ServerEvents.REACTION_REMOVED);

      const author = await open('author');
      author.emit(ClientEvents.ADD_REACTION, {
        messageId: channelMessageId,
        emoji: '🎉',
      });
      await nextEvent(
        ServerEvents.REACTION_ADDED,
        (p) => p.reaction.emoji === '🎉',
      );
    });

    it('thread reply: NEW_THREAD_REPLY and THREAD_REPLY_COUNT_UPDATED', async () => {
      const author = await open('author');
      const replyId: unknown = await author
        .timeout(5000)
        .emitWithAck(ClientEvents.SEND_THREAD_REPLY, {
          parentMessageId: channelMessageId,
          spans: spans('a reply'),
          attachments: [],
        });

      await nextEvent(
        ServerEvents.NEW_THREAD_REPLY,
        (p) => p.reply.id === replyId,
      );
      const count = await nextEvent(ServerEvents.THREAD_REPLY_COUNT_UPDATED);
      expect(count.replyCount).toBe(1);
    });

    it('thread reply over REST', async () => {
      const res = await http()
        .post(`/api/threads/${channelMessageId}/replies`)
        .set('Authorization', auth('author'))
        .send({
          parentMessageId: channelMessageId,
          spans: spans('a REST reply'),
          attachments: [],
        })
        .expect(201);
      expectConforms('MessageDto', 'POST thread reply', res.body);
    });

    it('link previews: UPDATE_MESSAGE from the preview job', async () => {
      const message = await postMessage('author', {
        spans: spans('see https://example.test'),
      });
      await db.message.update({
        where: { id: message.id },
        data: {
          linkPreviews: [{ url: 'https://example.test', title: 'Example' }],
        },
      });

      await app
        .get(LinkPreviewsService)
        ['broadcastMessage'](
          message.id,
          channelId,
          ServerEvents.UPDATE_MESSAGE,
        );

      const event = await nextEvent(
        ServerEvents.UPDATE_MESSAGE,
        (p) => p.message.id === message.id && !!p.message.linkPreviews,
      );
      expect(event.message.linkPreviews?.[0].title).toBe('Example');
    });

    it('a shared clip: NEW_MESSAGE from the clip listener', async () => {
      const clip = await app.get(DatabaseService).file.create({
        data: {
          filename: 'clip.mp4',
          mimeType: 'video/mp4',
          fileType: 'VIDEO',
          size: 1,
          checksum: 'e2e',
          uploadedById: id.author,
          resourceType: 'REPLAY_CLIP',
          fileUserId: id.author,
          storagePath: 'e2e/clip.mp4',
        },
      });

      const { messageId } = await app
        .get(ClipMessageListener)
        .handleClipMessageCreate({
          authorId: id.author,
          fileId: clip.id,
          durationSeconds: 30,
          sizeMB: 1,
          destination: 'channel',
          targetChannelId: channelId,
        });

      await nextEvent(
        ServerEvents.NEW_MESSAGE,
        (p) => p.message.id === messageId,
      );
    });

    it('a webhook post: NEW_MESSAGE with attribution and no author', async () => {
      const webhook = await http()
        .post(`/api/channels/${channelId}/webhooks`)
        .set('Authorization', auth('owner'))
        .send({ name: 'CI' })
        .expect(201);
      const path = new URL((webhook.body as { url: string }).url, url).pathname;

      const res = await http()
        .post(path.startsWith('/api/') ? path : `/api${path}`)
        .send({ content: 'from a webhook' })
        .expect(201);
      const messageId = (res.body as { id?: string; messageId?: string }).id;

      const event = await nextEvent(
        ServerEvents.NEW_MESSAGE,
        (p) =>
          !!p.message.webhook && (!messageId || p.message.id === messageId),
      );
      expect(event.message.authorId).toBeNull();
      expect(event.message.webhook?.name).toBe('CI');
    });

    it('pin and unpin: MESSAGE_PINNED and MESSAGE_UNPINNED', async () => {
      await http()
        .post(`/api/moderation/pin/${channelMessageId}`)
        .set('Authorization', auth('owner'))
        .expect(200);
      const pinned = await http()
        .get(`/api/messages/${channelMessageId}`)
        .set('Authorization', auth('member'))
        .expect(200);
      expectConforms('MessageDto', 'GET /messages/:id (pinned)', pinned.body);
      const pins = await http()
        .get(`/api/moderation/pins/${channelId}`)
        .set('Authorization', auth('member'))
        .expect(200);
      expect(pins.body).toHaveLength(1);
      for (const pin of pins.body as unknown[]) {
        expectConforms('PinnedMessageDto', 'GET /moderation/pins', pin);
      }
      await nextEvent(ServerEvents.MESSAGE_PINNED);

      await http()
        .delete(`/api/moderation/pin/${channelMessageId}`)
        .set('Authorization', auth('owner'))
        .expect(200);
      await nextEvent(ServerEvents.MESSAGE_UNPINNED);
    });

    it('delete: DELETE_MESSAGE', async () => {
      const message = await postMessage('author', { spans: spans('going') });
      await http()
        .delete(`/api/messages/${message.id}`)
        .set('Authorization', auth('author'))
        .expect(204);
      await nextEvent(
        ServerEvents.DELETE_MESSAGE,
        (p) => p.messageId === message.id,
      );
    });

    it('a removed message: blank for readers, with the moderation fields for moderators', async () => {
      const message = await postMessage('author', {
        spans: spans('to be removed'),
        pendingAttachments: 1,
      });
      await http()
        .delete(`/api/moderation/message/${message.id}`)
        .set('Authorization', auth('mod'))
        .send({ reason: 'off topic' })
        .expect(200);
      await nextEvent(
        ServerEvents.DELETE_MESSAGE,
        (p) => p.messageId === message.id,
      );

      const asMember = await http()
        .get(`/api/messages/${message.id}`)
        .set('Authorization', auth('member'))
        .expect(200);
      expectConforms('MessageDto', 'GET removed, as a reader', asMember.body);
      expect(asMember.body).toMatchObject({
        spans: [],
        deletedBy: null,
        deletedByReason: null,
      });

      const asMod = await http()
        .get(`/api/messages/${message.id}`)
        .set('Authorization', auth('mod'))
        .expect(200);
      expectConforms('MessageDto', 'GET removed, as a moderator', asMod.body);
      expect(asMod.body).toMatchObject({
        deletedBy: id.mod,
        deletedByReason: 'off topic',
      });

      await http()
        .post(`/api/messages/${message.id}/attachments`)
        .set('Authorization', auth('author'))
        .send({})
        .expect(201);
      const event = await nextEvent(
        ServerEvents.UPDATE_MESSAGE,
        (p) => p.message.id === message.id,
      );
      expect(event.message.spans).toEqual([]);
    });
  });

  describe('paths that read messages', () => {
    it.each([
      [
        'PaginatedMessagesResponseDto',
        () => `/api/messages/channel/${channelId}`,
      ],
      ['PaginatedMessagesResponseDto', () => `/api/messages/group/${dmId}`],
      [
        'MessageListDto',
        () => `/api/messages/search/channel/${channelId}?q=edited`,
      ],
      ['MessageListDto', () => `/api/messages/search/group/${dmId}?q=direct`],
      [
        'CommunitySearchListDto',
        () => `/api/messages/search/community/${communityId}?q=edited`,
      ],
    ])('%s %#', async (component, path) => {
      const who = path().includes('/group/') ? 'author' : 'member';
      const res = await http()
        .get(path())
        .set('Authorization', auth(who))
        .expect(200);

      const body = res.body as unknown[];
      if (component === 'PaginatedMessagesResponseDto') {
        expectConforms(component, path(), body);
        expect(
          (res.body as { messages: unknown[] }).messages.length,
        ).toBeGreaterThan(0);
        return;
      }
      expect(body.length).toBeGreaterThan(0);
      const item =
        component === 'MessageListDto'
          ? 'MessageDto'
          : 'CommunitySearchResultDto';
      for (const row of body) expectConforms(item, path(), row);
    });

    it('around a message, in a channel and a DM', async () => {
      const list = await http()
        .get(`/api/messages/channel/${channelId}`)
        .set('Authorization', auth('member'))
        .expect(200);
      const anchor = (list.body as { messages: { id: string }[] }).messages[0]
        .id;
      const around = await http()
        .get(`/api/messages/channel/${channelId}/around/${anchor}`)
        .set('Authorization', auth('member'))
        .expect(200);
      expectConforms('AnchoredMessagesResponseDto', 'around', around.body);
    });

    it('thread replies', async () => {
      const parent = await db.message.findFirstOrThrow({
        where: { channelId, replyCount: { gt: 0 } },
      });
      const res = await http()
        .get(`/api/threads/${parent.id}/replies`)
        .set('Authorization', auth('member'))
        .expect(200);

      expect(
        (res.body as { replies: unknown[] }).replies.length,
      ).toBeGreaterThan(0);
      expectConforms('ThreadRepliesResponseDto', 'thread replies', res.body);
    });
  });

  describe('everything the server sent', () => {
    it('every socket payload conforms to its declared schema', () => {
      const problems = messageEvents().flatMap((e) =>
        schemaErrors(serverEventComponent(e.event), e.payload).map(
          (error) => `${e.event}: ${error}`,
        ),
      );

      expect(problems).toEqual([]);
    });

    it('drove every message event the server emits', () => {
      const seen = new Set(events.map((e) => e.event));
      const missing = [...MESSAGE_EVENTS].filter((event) => !seen.has(event));

      expect(missing).toEqual([]);
    });

    it('nothing carries a sensitive user field', () => {
      const raw = JSON.stringify({ events: messageEvents(), responses });
      const found = SENSITIVE_USER_FIELDS.filter((field) =>
        raw.includes(`"${field}"`),
      );

      expect(found).toEqual([]);
    });
  });
});
