import { randomUUID } from 'crypto';
import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import { DatabaseService } from '@/database/database.service';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { RoomsService } from '@/rooms/rooms.service';
import { WebsocketService } from '@/websocket/websocket.service';
import type { Server as IoServer } from 'socket.io';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';

/**
 * Sending a message does the same thing on every transport: the same checks,
 * then the broadcast, read receipt and notifications.
 *
 * owner   InstanceRole.OWNER
 * sender  Member of the community, the user under test
 * reader  Member of the community, shares `group` with sender
 * outsider Member of the community, not in `group`
 */
describe('Sending a message (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let url: string;
  const sockets: Socket[] = [];

  const names = ['owner', 'sender', 'reader', 'outsider'] as const;
  type Who = (typeof names)[number];
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;

  let communityId: string;
  let channelId: string;
  let group: string;

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
  const restSend = (who: Who, body: Record<string, unknown>) =>
    http()
      .post('/api/messages')
      .set('Authorization', auth(who))
      .send({ attachments: [], ...body });
  const restDm = (who: Who, body: Record<string, unknown>) =>
    http()
      .post('/api/messages/dm')
      .set('Authorization', auth(who))
      .send({ attachments: [], ...body });

  async function connect(who: Who): Promise<Socket> {
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: token[who] },
    });
    sockets.push(client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    return client;
  }

  /** A socket in every room its user belongs to, ready to hear broadcasts. */
  async function subscribed(who: Who): Promise<Socket> {
    const client = await connect(who);
    // SUBSCRIBE_ALL has no acknowledgement to wait for, so do what it does.
    const server: IoServer = app.get(WebsocketService)['server'];
    await app
      .get(RoomsService)
      .joinAllUserRooms(
        server.of('/').sockets.get(client.id!) as AuthenticatedSocket,
      );
    return client;
  }

  function nextEvent<T>(client: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${event} event`)),
        5000,
      );
      client.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function socketSend(
    client: Socket,
    event: ClientEvents,
    payload: Record<string, unknown>,
  ): Promise<{ ack?: unknown; exception?: { message?: unknown } }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no answer to ${event}`)),
        5000,
      );
      const onException = (exception: { message?: unknown }) => {
        clearTimeout(timer);
        resolve({ exception });
      };
      client.once('exception', onException);
      client.emit(event, { attachments: [], ...payload }, (ack: unknown) => {
        clearTimeout(timer);
        client.off('exception', onException);
        resolve({ ack });
      });
    });
  }

  /** Polls for something done after the response, like a queued job. */
  async function eventually<T>(
    read: () => Promise<T>,
    done: (v: T) => boolean,
  ) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const value = await read();
      if (done(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return read();
  }

  const withSlowmode = async (run: () => Promise<void>) => {
    await db.message.deleteMany({ where: { authorId: id.sender } });
    await db.channel.update({
      where: { id: channelId },
      data: { slowmodeSeconds: 600 },
    });
    try {
      await run();
    } finally {
      await db.channel.update({
        where: { id: channelId },
        data: { slowmodeSeconds: 0 },
      });
      await db.message.deleteMany({ where: { authorId: id.sender } });
    }
  };

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
        username: `ms-${who}`.toLowerCase(),
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
      .send({ name: 'Send', description: 'e2e' })
      .expect(201);
    communityId = (community.body as { id: string }).id;
    for (const who of ['sender', 'reader', 'outsider'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId })
        .expect(201);
    }
    const channel = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name: 'send', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    channelId = (channel.body as { id: string }).id;

    const dm = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth('sender'))
      .send({ userIds: [id.reader] })
      .expect(201);
    group = (dm.body as { id: string }).id;
  });

  afterEach(() => {
    sockets.splice(0).forEach((client) => client.close());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /messages', () => {
    it('broadcasts to the channel', async () => {
      const reader = await subscribed('reader');
      const event = nextEvent<{ message: { id: string } }>(
        reader,
        ServerEvents.NEW_MESSAGE,
      );
      const res = await restSend('sender', {
        channelId,
        spans: spans(randomUUID()),
      }).expect(201);
      expect((await event).message.id).toBe((res.body as { id: string }).id);
    });

    it('marks the message read for its sender', async () => {
      const res = await restSend('sender', {
        channelId,
        spans: spans(randomUUID()),
      }).expect(201);
      const messageId = (res.body as { id: string }).id;
      const receipt = await eventually(
        () =>
          db.readReceipt.findFirst({
            where: { userId: id.sender, channelId },
          }),
        (row) => row?.lastReadMessageId === messageId,
      );
      expect(receipt?.lastReadMessageId).toBe(messageId);
    });

    it('notifies a mentioned user', async () => {
      await restSend('sender', {
        channelId,
        spans: [
          {
            type: 'USER_MENTION',
            text: null,
            userId: id.reader,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
      }).expect(201);
      const notes = await eventually(
        () =>
          db.notification.count({
            where: { userId: id.reader, type: 'USER_MENTION', channelId },
          }),
        (count) => count > 0,
      );
      expect(notes).toBeGreaterThan(0);
    });

    it('enforces slowmode', async () => {
      await withSlowmode(async () => {
        await restSend('sender', {
          channelId,
          spans: spans('first'),
        }).expect(201);
        const res = await restSend('sender', {
          channelId,
          spans: spans('second'),
        }).expect(403);
        expect((res.body as { message: string }).message).toMatch(/slowmode/i);
      });
    });

    it('enforces a timeout, for an instance owner too', async () => {
      await db.communityTimeout.create({
        data: {
          communityId,
          userId: id.owner,
          moderatorId: id.owner,
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      try {
        const res = await restSend('owner', {
          channelId,
          spans: spans('timed out'),
        }).expect(403);
        expect((res.body as { message: string }).message).toMatch(/timed out/i);
      } finally {
        await db.communityTimeout.deleteMany({ where: { userId: id.owner } });
      }
    });
  });

  describe('POST /messages/dm', () => {
    it('sends to a group the sender is in, and broadcasts', async () => {
      const reader = await subscribed('reader');
      const event = nextEvent<{ message: { id: string } }>(
        reader,
        ServerEvents.NEW_DM,
      );
      const res = await restDm('sender', {
        directMessageGroupId: group,
        spans: spans(randomUUID()),
      }).expect(201);
      const body = res.body as {
        id: string;
        channelId: string | null;
        directMessageGroupId: string;
      };
      expect(body).toMatchObject({
        channelId: null,
        directMessageGroupId: group,
      });
      expect((await event).message.id).toBe(body.id);
    });

    it('rejects a group the sender is not in', async () => {
      const text = randomUUID();
      await restDm('outsider', {
        directMessageGroupId: group,
        spans: spans(text),
      }).expect(403);
      expect(await db.message.count({ where: { searchText: text } })).toBe(0);
    });

    it('rejects a second target', async () => {
      const text = randomUUID();
      await restDm('sender', {
        directMessageGroupId: group,
        channelId,
        spans: spans(text),
      }).expect(400);
      expect(await db.message.count({ where: { searchText: text } })).toBe(0);
    });

    it('rejects no target, even for an instance owner', async () => {
      await restDm('owner', { spans: spans('nowhere') }).expect(400);
      await restDm('sender', { spans: spans('nowhere') }).expect(403);
    });
  });

  describe('sockets', () => {
    it('SEND_MESSAGE still acks the id and broadcasts', async () => {
      const reader = await subscribed('reader');
      const event = nextEvent<{ message: { id: string } }>(
        reader,
        ServerEvents.NEW_MESSAGE,
      );
      const client = await connect('sender');
      const { ack } = await socketSend(client, ClientEvents.SEND_MESSAGE, {
        channelId,
        spans: spans(randomUUID()),
      });
      expect((await event).message.id).toBe(ack);
    });

    it('SEND_DM still acks the id and broadcasts', async () => {
      const reader = await subscribed('reader');
      const event = nextEvent<{ message: { id: string } }>(
        reader,
        ServerEvents.NEW_DM,
      );
      const client = await connect('sender');
      const { ack } = await socketSend(client, ClientEvents.SEND_DM, {
        directMessageGroupId: group,
        spans: spans(randomUUID()),
      });
      expect((await event).message.id).toBe(ack);
    });

    it('keeps the slowmode message on the exception event', async () => {
      await withSlowmode(async () => {
        const client = await connect('sender');
        await socketSend(client, ClientEvents.SEND_MESSAGE, {
          channelId,
          spans: spans('first'),
        });
        const { exception } = await socketSend(
          client,
          ClientEvents.SEND_MESSAGE,
          { channelId, spans: spans('second') },
        );
        expect(String(exception?.message)).toMatch(/slowmode/i);
      });
    });
  });
});
