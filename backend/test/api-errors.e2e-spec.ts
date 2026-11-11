import { randomUUID } from 'crypto';
import { ClientEvents, ErrorCode } from '@semaphore-chat/shared';
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
 * Error responses are a contract: clients on old versions read `message` and
 * `statusCode` as they always did, and newer ones read `errorCode`. These pin
 * whole bodies, so anything removed or renamed fails here.
 */
describe('Error responses (e2e)', () => {
  let app: E2eApp;
  let db: DatabaseService;
  let url: string;
  let socket: Socket | undefined;

  const names = ['owner', 'member'] as const;
  type Who = (typeof names)[number];
  const token = {} as Record<Who, string>;
  const id = {} as Record<Who, string>;
  let communityId: string;
  let channelId: string;

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

  function exceptionFrom(
    client: Socket,
    event: ClientEvents,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no exception from ${event}`)),
        5000,
      );
      client.once('exception', (exception: unknown) => {
        clearTimeout(timer);
        resolve(exception);
      });
      client.emit(event, payload);
    });
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
        username: `ae-${who}`.toLowerCase(),
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
      .send({ name: 'Errors', description: 'e2e' })
      .expect(201);
    communityId = (community.body as { id: string }).id;
    await http()
      .post('/api/membership')
      .set('Authorization', auth('owner'))
      .send({ userId: id.member, communityId })
      .expect(201);
    const channel = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name: 'errors', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    channelId = (channel.body as { id: string }).id;
  });

  afterEach(() => {
    socket?.close();
    socket = undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('REST: existing fields stay, a code is added', () => {
    it('401, no token', async () => {
      const res = await http().get('/api/users/profile').expect(401);
      expect(res.body).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
        errorCode: ErrorCode.UNAUTHENTICATED,
        retryable: false,
      });
    });

    it('403, a guard says no', async () => {
      const res = await http()
        .post('/api/community')
        .set('Authorization', auth('member'))
        .send({ name: 'Nope', description: 'e2e' })
        .expect(403);
      expect(res.body).toEqual({
        statusCode: 403,
        message: 'Forbidden resource',
        error: 'Forbidden',
        errorCode: ErrorCode.FORBIDDEN,
        retryable: false,
      });
    });

    it('404, thrown by a service with a message', async () => {
      const res = await http()
        .get(`/api/users/${randomUUID()}`)
        .set('Authorization', auth('owner'))
        .expect(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        errorCode: ErrorCode.NOT_FOUND,
        retryable: false,
      });
    });

    it('404, no such route', async () => {
      const res = await http()
        .get('/api/no-such-route')
        .set('Authorization', auth('owner'))
        .expect(404);
      expect(res.body).toEqual({
        statusCode: 404,
        message: 'Cannot GET /api/no-such-route',
        error: 'Not Found',
        errorCode: ErrorCode.NOT_FOUND,
        retryable: false,
      });
    });

    it('400, a pipe rejects a parameter', async () => {
      const res = await http()
        .get('/api/messages/not-a-uuid')
        .set('Authorization', auth('owner'))
        .expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message: 'Validation failed (uuid is expected)',
        error: 'Bad Request',
        errorCode: ErrorCode.BAD_REQUEST,
        retryable: false,
      });
    });

    it('400, DTO validation keeps its message array', async () => {
      const res = await http()
        .post('/api/community')
        .set('Authorization', auth('owner'))
        .send({ name: 42 })
        .expect(400);
      const { message, ...rest } = res.body as { message: unknown };
      expect(Array.isArray(message)).toBe(true);
      expect(rest).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        errorCode: ErrorCode.VALIDATION_FAILED,
        retryable: false,
      });
    });
  });

  describe('REST: send failures have their own codes', () => {
    it('two targets', async () => {
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('member'))
        .send({
          channelId,
          directMessageGroupId: randomUUID(),
          spans: spans('x'),
          attachments: [],
        })
        .expect(400);
      expect(res.body).toEqual({
        statusCode: 400,
        message:
          'Must provide exactly one of channelId or directMessageGroupId',
        error: 'Bad Request',
        errorCode: ErrorCode.MESSAGE_TARGET_INVALID,
        retryable: false,
      });
    });

    it('slowmode says when to retry', async () => {
      await db.channel.update({
        where: { id: channelId },
        data: { slowmodeSeconds: 600 },
      });
      try {
        await http()
          .post('/api/messages')
          .set('Authorization', auth('member'))
          .send({ channelId, spans: spans('first'), attachments: [] })
          .expect(201);
        const res = await http()
          .post('/api/messages')
          .set('Authorization', auth('member'))
          .send({ channelId, spans: spans('second'), attachments: [] })
          .expect(403);
        const { message, retryAfterMs, ...rest } = res.body as {
          message: string;
          retryAfterMs: number;
        };
        expect(message).toMatch(/slowmode/i);
        expect(retryAfterMs).toBeGreaterThan(0);
        expect(rest).toEqual({
          statusCode: 403,
          error: 'Forbidden',
          errorCode: ErrorCode.SLOWMODE,
          retryable: true,
        });
      } finally {
        await db.channel.update({
          where: { id: channelId },
          data: { slowmodeSeconds: 0 },
        });
      }
    });

    describe('a moderation timeout', () => {
      const timeOut = (who: Who) =>
        db.communityTimeout.create({
          data: {
            communityId,
            userId: id[who],
            moderatorId: id.owner,
            expiresAt: new Date(Date.now() + 600_000),
          },
        });

      afterEach(async () => {
        await db.communityTimeout.deleteMany({});
      });

      it('is not retryable, and says how long', async () => {
        // An instance owner skips RBAC, so this reaches the send pipeline.
        await timeOut('owner');
        const res = await http()
          .post('/api/messages')
          .set('Authorization', auth('owner'))
          .send({ channelId, spans: spans('x'), attachments: [] })
          .expect(403);
        const { message, retryAfterMs, ...rest } = res.body as {
          message: string;
          retryAfterMs: number;
        };
        expect(message).toMatch(/timed out/i);
        expect(retryAfterMs).toBeGreaterThan(0);
        expect(rest).toEqual({
          statusCode: 403,
          error: 'Forbidden',
          errorCode: ErrorCode.TIMED_OUT,
          retryable: false,
        });
      });

      it('reaches other members as RBAC refusing them', async () => {
        await timeOut('member');
        const res = await http()
          .post('/api/messages')
          .set('Authorization', auth('member'))
          .send({ channelId, spans: spans('x'), attachments: [] })
          .expect(403);
        expect(res.body).toEqual({
          statusCode: 403,
          message: 'Forbidden resource',
          error: 'Forbidden',
          errorCode: ErrorCode.FORBIDDEN,
          retryable: false,
        });
      });
    });

    it('a file that is not yours', async () => {
      const res = await http()
        .post('/api/messages')
        .set('Authorization', auth('member'))
        .send({
          channelId,
          spans: spans('x'),
          attachments: [randomUUID()],
        })
        .expect(403);
      expect(res.body).toEqual({
        statusCode: 403,
        message: 'You can only attach files you uploaded',
        error: 'Forbidden',
        errorCode: ErrorCode.FILE_NOT_OWNED,
        retryable: false,
      });
    });
  });

  describe('sockets', () => {
    it('a service error reports its message, not "Internal server error"', async () => {
      const client = await connect('member');
      const exception = await exceptionFrom(client, ClientEvents.SEND_MESSAGE, {
        channelId,
        replyToId: randomUUID(),
        spans: spans('x'),
        attachments: [],
      });
      expect(exception).toMatchObject({
        status: 'error',
        message: 'Quoted message not found',
        errorCode: ErrorCode.QUOTE_NOT_FOUND,
        retryable: false,
      });
    });

    it('a guard refusal keeps its shape and gains a code', async () => {
      const client = await connect('member');
      const exception = await exceptionFrom(client, ClientEvents.SEND_MESSAGE, {
        channelId: randomUUID(),
        spans: spans('x'),
        attachments: [],
      });
      expect(exception).toMatchObject({
        status: 'error',
        message: 'Forbidden resource',
        errorCode: ErrorCode.FORBIDDEN,
        retryable: false,
        cause: { pattern: ClientEvents.SEND_MESSAGE },
      });
    });

    it('validation errors stay a plain array for old clients', async () => {
      const client = await connect('member');
      const exception = await exceptionFrom(client, ClientEvents.TYPING_START, {
        channelId: 42,
      });
      expect(exception).toEqual([
        {
          property: 'channelId',
          children: [],
          constraints: { isString: 'channelId must be a string' },
        },
      ]);
    });
  });
});
