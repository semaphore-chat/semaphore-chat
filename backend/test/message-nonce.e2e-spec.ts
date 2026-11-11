import { randomUUID } from 'crypto';
import { ClientEvents, ErrorCode, ServerEvents } from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { DatabaseService } from '@/database/database.service';
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
 * A client that lost an ack, or was suspended mid-send, retries with the same
 * clientNonce and must get the same message rather than a second one. Clients
 * opt in to the richer ack with `auth.protocol: 2`; everything else keeps
 * working as it did for clients that don't.
 *
 * owner   InstanceRole.OWNER
 * sender  Member of the community, the user under test
 * reader  Member of the community, shares `group` with sender
 */
describe('Client nonce and send acks (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let url: string;
  // Shared across tests: the gateway limits connection attempts per address.
  const sockets = new Map<string, Socket>();

  const names = ['owner', 'sender', 'reader'] as const;
  type Who = (typeof names)[number];
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;

  let channelId: string;
  let otherChannelId: string;
  let group: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const spans = (text = randomUUID()) => [
    {
      type: 'PLAINTEXT',
      text,
      userId: null,
      specialKind: null,
      communityId: null,
      aliasId: null,
    },
  ];
  const message = (extra: Record<string, unknown> = {}) => ({
    channelId,
    spans: spans(),
    attachments: [],
    ...extra,
  });
  const rows = (clientNonce: string) =>
    db.message.count({ where: { clientNonce } });

  async function connect(who: Who, protocol?: number): Promise<Socket> {
    const key = `${who}:${protocol ?? 1}`;
    const open = sockets.get(key);
    if (open) return open;
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: token[who], ...(protocol ? { protocol } : {}) },
    });
    sockets.set(key, client);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    return client;
  }

  async function subscribed(who: Who): Promise<Socket> {
    const client = await connect(who);
    const server: IoServer = app.get(WebsocketService)['server'];
    await app
      .get(RoomsService)
      .joinAllUserRooms(
        server.of('/').sockets.get(client.id!) as AuthenticatedSocket,
      );
    return client;
  }

  /** Waits for whichever comes first: the ack or an `exception` event. */
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

  /** The ack alone, for a protocol 2 client. Ignores the `exception` event. */
  function ackOf(
    client: Socket,
    event: ClientEvents,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return client.timeout(5000).emitWithAck(event, payload) as Promise<
      Record<string, unknown>
    >;
  }

  function collect(client: Socket, event: string) {
    const events: { message: { id: string; clientNonce?: string } }[] = [];
    client.on(event, (payload: (typeof events)[number]) => {
      events.push(payload);
    });
    return events;
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
        username: `mn-${who}`.toLowerCase(),
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
      .send({ name: 'Nonce', description: 'e2e' })
      .expect(201);
    const communityId = (community.body as { id: string }).id;
    for (const who of ['sender', 'reader'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: id[who], communityId })
        .expect(201);
    }
    const channel = async (name: string) =>
      (
        (
          await http()
            .post('/api/channels')
            .set('Authorization', auth('owner'))
            .send({ name, communityId, type: 'TEXT', isPrivate: false })
            .expect(201)
        ).body as { id: string }
      ).id;
    channelId = await channel('nonce');
    otherChannelId = await channel('nonce-other');

    const dm = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth('sender'))
      .send({ userIds: [id.reader] })
      .expect(201);
    group = (dm.body as { id: string }).id;
  });

  afterAll(async () => {
    sockets.forEach((client) => client.close());
    await app.close();
  });

  describe('the nonce', () => {
    it('comes back on the message and on its broadcast', async () => {
      const reader = await subscribed('reader');
      const received = collect(reader, ServerEvents.NEW_MESSAGE);
      const clientNonce = randomUUID();

      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send(message({ clientNonce }))
        .expect(201);

      expect((res.body as { clientNonce: string }).clientNonce).toBe(
        clientNonce,
      );
      for (let i = 0; i < 50 && received.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(received[0].message.clientNonce).toBe(clientNonce);
    });

    it('must be a UUID', async () => {
      await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send(message({ clientNonce: 'not-a-uuid' }))
        .expect(400);
    });

    it('is optional, and sends without one stay separate', async () => {
      const text = randomUUID();
      for (let i = 0; i < 2; i++) {
        await http()
          .post('/api/messages')
          .set('Authorization', auth('sender'))
          .send(message({ spans: spans(text) }))
          .expect(201);
      }
      expect(await db.message.count({ where: { searchText: text } })).toBe(2);
    });
  });

  describe('retrying', () => {
    it('REST: the same message, and one row', async () => {
      const clientNonce = randomUUID();
      const send = () =>
        http()
          .post('/api/messages')
          .set('Authorization', auth('sender'))
          .send(message({ clientNonce }))
          .expect(201);

      const first = await send();
      const second = await send();

      expect((second.body as { id: string }).id).toBe(
        (first.body as { id: string }).id,
      );
      expect(await rows(clientNonce)).toBe(1);
    });

    it('SEND_MESSAGE: the same id, one row, one broadcast', async () => {
      const reader = await subscribed('reader');
      const received = collect(reader, ServerEvents.NEW_MESSAGE);
      const client = await connect('sender');
      const clientNonce = randomUUID();

      const first = await send(
        client,
        ClientEvents.SEND_MESSAGE,
        message({ clientNonce }),
      );
      const second = await send(
        client,
        ClientEvents.SEND_MESSAGE,
        message({ clientNonce }),
      );

      expect(typeof first.ack).toBe('string');
      expect(second.ack).toBe(first.ack);
      expect(await rows(clientNonce)).toBe(1);
      // A later send proves the retry's broadcast, if any, had time to arrive.
      await send(client, ClientEvents.SEND_MESSAGE, message());
      for (let i = 0; i < 50 && received.length < 2; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(received).toHaveLength(2);
    });

    it('SEND_DM and across transports', async () => {
      const client = await connect('sender');
      const clientNonce = randomUUID();
      const body = {
        directMessageGroupId: group,
        spans: spans(),
        attachments: [],
        clientNonce,
      };

      const { ack } = await send(client, ClientEvents.SEND_DM, body);
      const rest = await http()
        .post('/api/messages/dm')
        .set('Authorization', auth('sender'))
        .send(body)
        .expect(201);

      expect((rest.body as { id: string }).id).toBe(ack);
      expect(await rows(clientNonce)).toBe(1);
    });

    it('a thread reply: the same id, one row, one count', async () => {
      const client = await connect('sender');
      const parent = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send(message())
        .expect(201);
      const parentMessageId = (parent.body as { id: string }).id;
      const clientNonce = randomUUID();
      const reply = {
        parentMessageId,
        spans: spans(),
        attachments: [],
        clientNonce,
      };

      const first = await send(client, ClientEvents.SEND_THREAD_REPLY, reply);
      const second = await send(client, ClientEvents.SEND_THREAD_REPLY, reply);
      const rest = await http()
        .post(`/api/threads/${parentMessageId}/replies`)
        .set('Authorization', auth('sender'))
        .send(reply)
        .expect(201);

      expect(second.ack).toBe(first.ack);
      expect((rest.body as { id: string }).id).toBe(first.ack);
      expect(await rows(clientNonce)).toBe(1);
      const row = await db.message.findUniqueOrThrow({
        where: { id: parentMessageId },
      });
      expect(row.replyCount).toBe(1);
    });

    it('still works in slowmode, which a new message would not', async () => {
      await db.message.deleteMany({ where: { authorId: id.sender } });
      const clientNonce = randomUUID();
      await db.channel.update({
        where: { id: channelId },
        data: { slowmodeSeconds: 600 },
      });
      try {
        const send = (extra: Record<string, unknown>) =>
          http()
            .post('/api/messages')
            .set('Authorization', auth('sender'))
            .send(message(extra));

        const first = await send({ clientNonce }).expect(201);
        const retry = await send({ clientNonce }).expect(201);
        expect((retry.body as { id: string }).id).toBe(
          (first.body as { id: string }).id,
        );
        await send({ clientNonce: randomUUID() }).expect(403);
      } finally {
        await db.channel.update({
          where: { id: channelId },
          data: { slowmodeSeconds: 0 },
        });
      }
    });

    it('concurrent sends make one row and agree on the id', async () => {
      const clientNonce = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          http()
            .post('/api/messages')
            .set('Authorization', auth('sender'))
            .send(message({ clientNonce })),
        ),
      );

      expect(results.map((res) => res.status)).toEqual([
        201, 201, 201, 201, 201,
      ]);
      expect(
        new Set(results.map((res) => (res.body as { id: string }).id)).size,
      ).toBe(1);
      expect(await rows(clientNonce)).toBe(1);
    });

    it('nonces belong to their sender', async () => {
      const clientNonce = randomUUID();
      const as = (who: Who) =>
        http()
          .post('/api/messages')
          .set('Authorization', auth(who))
          .send(message({ clientNonce }))
          .expect(201);

      const mine = await as('sender');
      const theirs = await as('reader');

      expect((theirs.body as { id: string }).id).not.toBe(
        (mine.body as { id: string }).id,
      );
      expect(await rows(clientNonce)).toBe(2);
    });

    it('a nonce reused for another place is refused', async () => {
      const clientNonce = randomUUID();
      await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send(message({ clientNonce }))
        .expect(201);

      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send(message({ clientNonce, channelId: otherChannelId }))
        .expect(409);

      expect(res.body).toMatchObject({
        errorCode: ErrorCode.NONCE_CONFLICT,
        retryable: false,
      });
      expect(await rows(clientNonce)).toBe(1);
    });
  });

  describe('retrying a message that was since deleted', () => {
    async function sent(clientNonce: string) {
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send(message({ clientNonce }))
        .expect(201);
      return (res.body as { id: string }).id;
    }
    const retry = (clientNonce: string) =>
      http()
        .post('/api/messages')
        .set('Authorization', auth('sender'))
        .send(message({ clientNonce }));
    const deleted = {
      errorCode: ErrorCode.MESSAGE_DELETED,
      retryable: false,
    };

    it('deleted by its author: refused, not sent again', async () => {
      const clientNonce = randomUUID();
      const messageId = await sent(clientNonce);
      await http()
        .delete(`/api/messages/${messageId}`)
        .set('Authorization', auth('sender'))
        .expect(204);

      const res = await retry(clientNonce).expect(410);

      expect(res.body).toMatchObject(deleted);
      expect(await rows(clientNonce)).toBe(0);
    });

    it('deleted by a moderator: refused, not sent again', async () => {
      const clientNonce = randomUUID();
      const messageId = await sent(clientNonce);
      await http()
        .delete(`/api/messages/${messageId}`)
        .set('Authorization', auth('owner'))
        .expect(204);

      const res = await retry(clientNonce).expect(410);

      expect(res.body).toMatchObject(deleted);
      expect(await rows(clientNonce)).toBe(0);
    });

    it('removed by moderation, row kept: refused', async () => {
      const clientNonce = randomUUID();
      const messageId = await sent(clientNonce);
      await db.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedBy: id.owner },
      });

      const res = await retry(clientNonce).expect(410);

      expect(res.body).toMatchObject(deleted);
    });

    it('a reply deleted with its parent: refused, not sent again', async () => {
      const client = await connect('sender');
      const parentMessageId = await sent(randomUUID());
      const clientNonce = randomUUID();
      const reply = {
        parentMessageId,
        spans: spans(),
        attachments: [],
        clientNonce,
      };
      await send(client, ClientEvents.SEND_THREAD_REPLY, reply);
      await http()
        .delete(`/api/messages/${parentMessageId}`)
        .set('Authorization', auth('sender'))
        .expect(204);

      expect(await rows(clientNonce)).toBe(0);
      const tombstones = await db.messageNonceTombstone.count({
        where: { authorId: id.sender, clientNonce },
      });
      expect(tombstones).toBe(1);
    });
  });

  describe('acks', () => {
    it('a client without a protocol keeps the plain id', async () => {
      const client = await connect('sender');
      const { ack } = await send(client, ClientEvents.SEND_MESSAGE, message());
      expect(typeof ack).toBe('string');
    });

    it('a client without a protocol gets no ack on failure, only the event', async () => {
      const client = await connect('sender');
      const result = await send(
        client,
        ClientEvents.SEND_MESSAGE,
        message({ channelId: randomUUID() }),
      );
      expect(result.ack).toBeUndefined();
      expect(result.exception).toMatchObject({
        message: 'Forbidden resource',
      });
    });

    it.each([
      ['SEND_MESSAGE', ClientEvents.SEND_MESSAGE],
      ['SEND_DM', ClientEvents.SEND_DM],
    ])('protocol 2, %s: success is typed', async (_label, event) => {
      const client = await connect('sender', 2);
      const ack = await ackOf(
        client,
        event,
        event === ClientEvents.SEND_DM
          ? {
              directMessageGroupId: group,
              spans: spans(),
              attachments: [],
            }
          : message(),
      );
      expect(ack).toEqual({
        ok: true,
        messageId: expect.any(String) as string,
      });
    });

    it('protocol 2, thread reply: success is typed', async () => {
      const client = await connect('sender', 2);
      const parent = await ackOf(client, ClientEvents.SEND_MESSAGE, message());
      const ack = await ackOf(client, ClientEvents.SEND_THREAD_REPLY, {
        parentMessageId: parent.messageId,
        spans: spans(),
        attachments: [],
      });
      expect(ack).toEqual({
        ok: true,
        messageId: expect.any(String) as string,
      });
    });

    it('protocol 2: a guard refusal fails the ack at once', async () => {
      const client = await connect('sender', 2);
      const ack = await ackOf(
        client,
        ClientEvents.SEND_MESSAGE,
        message({ channelId: randomUUID() }),
      );
      expect(ack).toEqual({
        ok: false,
        error: {
          errorCode: ErrorCode.FORBIDDEN,
          message: 'Forbidden resource',
          retryable: false,
        },
      });
    });

    it('protocol 2: a validation failure fails the ack, and has a code', async () => {
      const client = await connect('sender', 2);
      const ack = await ackOf(
        client,
        ClientEvents.SEND_MESSAGE,
        message({ clientNonce: 'not-a-uuid' }),
      );
      expect(ack).toMatchObject({
        ok: false,
        error: {
          errorCode: ErrorCode.VALIDATION_FAILED,
          retryable: false,
        },
      });
    });

    it('protocol 2: slowmode says when to retry', async () => {
      await db.message.deleteMany({ where: { authorId: id.sender } });
      await db.channel.update({
        where: { id: channelId },
        data: { slowmodeSeconds: 600 },
      });
      try {
        const client = await connect('sender', 2);
        await ackOf(client, ClientEvents.SEND_MESSAGE, message());
        const ack = (await ackOf(
          client,
          ClientEvents.SEND_MESSAGE,
          message(),
        )) as { ok: boolean; error: Record<string, unknown> };
        expect(ack.ok).toBe(false);
        expect(ack.error.errorCode).toBe(ErrorCode.SLOWMODE);
        expect(ack.error.retryable).toBe(true);
        expect(ack.error.retryAfterMs).toBeGreaterThan(0);
      } finally {
        await db.channel.update({
          where: { id: channelId },
          data: { slowmodeSeconds: 0 },
        });
      }
    });

    it('protocol 2: other events keep their acks', async () => {
      const client = await connect('sender', 2);
      await expect(
        client.timeout(5000).emitWithAck(ClientEvents.PRESENCE_ONLINE, {}),
      ).resolves.toBe('ACK');
    });

    it('protocol 2: the exception event still fires, for logging', async () => {
      const client = await connect('sender', 2);
      const exception = new Promise((resolve) =>
        client.once('exception', resolve),
      );
      await ackOf(
        client,
        ClientEvents.SEND_MESSAGE,
        message({ channelId: randomUUID() }),
      );
      await expect(exception).resolves.toMatchObject({
        errorCode: ErrorCode.FORBIDDEN,
      });
    });
  });
});
