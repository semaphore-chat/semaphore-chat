import * as request from 'supertest';
import { DatabaseService } from '@/database/database.service';
import { MessagesService } from '@/messages/messages.service';
import { MessageDispatchService } from '@/messages/message-dispatch.service';
import { ServerEvents } from '@semaphore-chat/shared';
import {
  createE2eApp,
  resetDatabase,
  seedInstanceInvite,
  registerUser,
  loginUser,
  E2eApp,
} from './helpers/e2e-app';

/**
 * Community → channel → message lifecycle against real Postgres + Redis,
 * including default role bootstrap and RBAC enforcement through the real
 * guard chain (JwtAuthGuard → RbacGuard).
 *
 * owner: first registered user → InstanceRole.OWNER (may create communities;
 *        rbac.guard.ts short-circuits OWNER).
 * outsider: second registered user → InstanceRole.USER with NO membership in
 *        the community — must be denied by RbacGuard.
 */
describe('Community messaging flow (e2e)', () => {
  let app: E2eApp;

  const owner = {
    username: 'e2e-owner',
    password: 'Password123!',
    email: 'e2e-owner@test.local',
  };
  const outsider = {
    username: 'e2e-outsider',
    password: 'Password123!',
    email: 'e2e-outsider@test.local',
  };

  let ownerToken: string;
  let outsiderToken: string;
  let ownerId: string;
  let outsiderId: string;
  let communityId: string;
  let channelId: string;

  const MESSAGE_TEXT = 'hello from the e2e suite';

  beforeAll(async () => {
    app = await createE2eApp();
    await resetDatabase(app);
    await seedInstanceInvite(app);

    const ownerUser = await registerUser(app, owner); // first → OWNER
    const outsiderUser = await registerUser(app, outsider); // second → USER
    ownerId = ownerUser.id;
    outsiderId = outsiderUser.id;

    ownerToken = (await loginUser(app, owner.username, owner.password))
      .accessToken;
    outsiderToken = (await loginUser(app, outsider.username, outsider.password))
      .accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a community', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/community')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'E2E Community', description: 'Created by e2e tests' })
      .expect(201);

    const body = res.body as { id: string; name: string };
    expect(body).toMatchObject({
      name: 'E2E Community',
      description: 'Created by e2e tests',
    });
    expect(typeof body.id).toBe('string');
    communityId = body.id;
  });

  it('bootstraps the default community roles with positions 10/20/100', async () => {
    const db = app.get(DatabaseService);
    const roles = await db.role.findMany({
      where: { communityId },
      orderBy: { position: 'asc' },
    });

    expect(roles.map((r) => ({ name: r.name, position: r.position }))).toEqual([
      { name: 'Community Admin', position: 10 },
      { name: 'Moderator', position: 20 },
      { name: 'Member', position: 100 },
    ]);
    expect(roles.every((r) => r.isDefault)).toBe(true);
  });

  it('creates a text channel in the community', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/channels')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'e2e-general',
        communityId,
        type: 'TEXT',
        isPrivate: false,
      })
      .expect(201);

    const body = res.body as { id: string; name: string };
    expect(body).toMatchObject({
      name: 'e2e-general',
      communityId,
      type: 'TEXT',
      isPrivate: false,
    });
    expect(typeof body.id).toBe('string');
    channelId = body.id;
  });

  it('sends a message to the channel', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        channelId,
        spans: [
          {
            type: 'PLAINTEXT',
            text: MESSAGE_TEXT,
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
      })
      .expect(201);

    const body = res.body as {
      id: string;
      spans: Array<{ type: string; text: string | null }>;
    };
    expect(body).toMatchObject({
      channelId,
      pinned: false,
      reactions: [],
    });
    expect(typeof body.id).toBe('string');
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0]).toMatchObject({
      type: 'PLAINTEXT',
      text: MESSAGE_TEXT,
    });
  });

  it('lists channel messages with span content', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/messages/channel/${channelId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const body = res.body as {
      messages: Array<{
        channelId: string | null;
        spans: Array<{ type: string; text: string | null }>;
      }>;
    };
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages).toHaveLength(1);

    const message = body.messages[0];
    expect(message).toMatchObject({ channelId });
    expect(message.spans).toHaveLength(1);
    expect(message.spans[0]).toMatchObject({
      type: 'PLAINTEXT',
      text: MESSAGE_TEXT,
    });
  });

  it('denies channel message reads to a non-member through the real guard chain', async () => {
    await request(app.getHttpServer())
      .get(`/api/messages/channel/${channelId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .expect(403);
  });

  it('denies message creation to a non-member', async () => {
    await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({
        channelId,
        spans: [
          {
            type: 'PLAINTEXT',
            text: 'should never land',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
      })
      .expect(403);
  });

  /**
   * Issue B1: notification fan-out moved off the request path onto a BullMQ
   * queue (message-fanout), consumed in-process by
   * NotificationsFanoutProcessor. This is a black-box check of the whole
   * pipeline against real Postgres + Redis: enqueue (MessageDispatchService)
   * -> worker pickup -> processMessageForNotifications -> Notification row.
   *
   * NOTE: exercised via MessagesService.create() + MessageDispatchService
   * .dispatch() directly (the exact calls messages.gateway.ts's SEND_MESSAGE
   * handler makes) rather than POST /api/messages — that REST endpoint does
   * not call MessageDispatchService at all (broadcast/notifications/link
   * previews are WS-only), so it wouldn't exercise the queue either before
   * or after this change. A full transport-level test would need a
   * socket.io-client harness this test suite doesn't have yet.
   *
   * Polls briefly since processing is now asynchronous relative to
   * dispatch() returning (dispatch() awaits the *enqueue*, not the job).
   * Placed last so the extra message it creates doesn't disturb the
   * channel-message-count assertions above.
   */
  it('delivers a mention notification asynchronously via the message-fanout queue', async () => {
    const messagesService = app.get(MessagesService);
    const messageDispatchService = app.get(MessageDispatchService);
    const db = app.get(DatabaseService);

    // Only the fields the create flow actually consumes — the DTO's
    // remaining @Exclude()'d bookkeeping fields are irrelevant here.
    const createInput = {
      channelId,
      authorId: ownerId,
      sentAt: new Date(),
      spans: [
        {
          type: 'USER_MENTION',
          text: null,
          userId: outsiderId,
          specialKind: null,
          communityId: null,
          aliasId: null,
        },
      ],
      attachments: [],
    } as unknown as Parameters<MessagesService['create']>[0];
    const message = await messagesService.create(createInput);

    await messageDispatchService.dispatch(message, {
      room: channelId,
      event: ServerEvents.NEW_MESSAGE,
      notifications: true,
      linkPreviews: false,
    });

    let notification: {
      id: string;
      authorId: string;
      channelId: string | null;
    } | null = null;
    for (let attempt = 0; attempt < 40 && !notification; attempt++) {
      notification = await db.notification.findFirst({
        where: {
          userId: outsiderId,
          messageId: message.id,
          type: 'USER_MENTION',
        },
      });
      if (!notification) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    expect(notification).not.toBeNull();
    expect(notification).toMatchObject({
      authorId: ownerId,
      channelId,
    });
  });

  it('attaches a file once however often (or concurrently) the attach is retried', async () => {
    const db = app.get(DatabaseService);
    const created = await request(app.getHttpServer())
      .post('/api/messages')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        channelId,
        spans: [
          {
            type: 'PLAINTEXT',
            text: 'two files coming',
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
        pendingAttachments: 2,
      })
      .expect(201);
    const messageId = (created.body as { id: string }).id;
    const file = await db.file.create({
      data: {
        filename: 'photo.png',
        mimeType: 'image/png',
        fileType: 'IMAGE',
        size: 3,
        checksum: 'e2e',
        uploadedById: ownerId,
        resourceType: 'MESSAGE_ATTACHMENT',
        fileMessageId: messageId,
        storagePath: 'e2e/photo.png',
      },
    });

    const attach = () =>
      request(app.getHttpServer())
        .post(`/api/messages/${messageId}/attachments`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ fileId: file.id });

    // Two racing attaches (a retry overlapping the original), then a late one.
    const racing = await Promise.all([attach(), attach()]);
    expect(racing.map((r) => r.status)).toEqual([201, 201]);
    await attach().expect(201);

    const rows = await db.messageAttachment.findMany({ where: { messageId } });
    expect(rows).toHaveLength(1);
    const message = await db.message.findUniqueOrThrow({
      where: { id: messageId },
    });
    // One slot released for the one file; the other file is still pending.
    expect(message.pendingAttachments).toBe(1);
  });
});
