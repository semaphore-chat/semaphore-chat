import { createHash, randomBytes, randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import {
  ClientEvents,
  ServerEvents,
  type ChannelCreatedPayloadDto,
  type NewNotificationPayload,
  type VoiceChannelUserJoinedPayload,
} from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Server as IoServer } from 'socket.io';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { PresenceGateway } from '@/presence/presence.gateway';
import { RoomsService } from '@/rooms/rooms.service';
import { SENSITIVE_USER_FIELDS } from '@/test-utils/helpers/user-dto.helper';
import { VoicePresenceService } from '@/voice-presence/voice-presence.service';
import { WebsocketService } from '@/websocket/websocket.service';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
  RegisteredUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';
import {
  declaredServerEvents,
  schemaErrors,
  serverEventComponent,
} from './helpers/wire-schema';

/**
 * The socket events outside messaging (those are in
 * message-wire-contract.e2e-spec.ts), driven through the app and validated
 * against socket-events.json with every object closed, plus the REST previews
 * of a message: notifications and the DM list.
 */
describe('Socket event contract (e2e)', () => {
  let app: E2eApp;
  let url: string;

  const names = ['owner', 'member', 'target', 'extra'] as const;
  type Who = (typeof names)[number];
  const token: Record<Who, string> = {} as never;
  const account: Record<Who, RegisteredUser> = {} as never;
  const socket: Partial<Record<Who, Socket>> = {};

  let communityId: string;
  let channelId: string;
  let dmId: string;
  let messageId: string;

  const http = () => request(app.getHttpServer());
  const auth = (who: Who) => `Bearer ${token[who]}`;
  const spans = (text: string) => [{ type: 'PLAINTEXT', text }];

  const events: { event: string; payload: unknown; who: string }[] = [];
  const handledDisconnects = new Set<string>();
  const opened: Socket[] = [];

  /** Bounded poll over what the sockets have received. */
  async function seen<T = Record<string, unknown>>(
    event: string,
    match: (payload: Record<string, unknown>) => boolean = () => true,
  ): Promise<T> {
    const deadline = Date.now() + 10000;
    for (;;) {
      const found = events.find(
        (e) => e.event === event && match(e.payload as Record<string, unknown>),
      );
      if (found) return found.payload as T;
      if (Date.now() > deadline) throw new Error(`no ${event} within 10s`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function connect(who: string, accessToken: string): Promise<Socket> {
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { token: `Bearer ${accessToken}` },
    });
    client.onAny((event: string, payload: unknown) => {
      events.push({ event, payload, who });
    });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.once('connect_error', reject);
    });
    opened.push(client);
    return client;
  }

  async function subscribe(client: Socket) {
    const server: IoServer = app.get(WebsocketService)['server'];
    await app
      .get(RoomsService)
      .joinAllUserRooms(
        server.of('/').sockets.get(client.id!) as AuthenticatedSocket,
      );
  }

  function expectConforms(component: string, label: string, body: unknown) {
    expect({ label, errors: schemaErrors(component, body) }).toEqual({
      label,
      errors: [],
    });
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
    await resetDatabase(app);
    await seedInstanceInvite(app);

    for (const who of names) {
      const creds = { username: `se-${who}`, password: 'Password123!' };
      account[who] = await registerUser(app, creds);
      token[who] = (
        await loginUser(app, creds.username, creds.password)
      ).accessToken;
    }

    const community = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Events', description: 'e2e' })
      .expect(201);
    communityId = (community.body as { id: string }).id;
    for (const who of ['member', 'target'] as const) {
      await http()
        .post('/api/membership')
        .set('Authorization', auth('owner'))
        .send({ userId: account[who].id, communityId })
        .expect(201);
    }
    const channel = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name: 'events', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    channelId = (channel.body as { id: string }).id;
    const dm = await http()
      .post('/api/direct-messages')
      .set('Authorization', auth('member'))
      .send({ userIds: [account.target.id], isGroup: false })
      .expect(201);
    dmId = (dm.body as { id: string }).id;
    const message = await http()
      .post('/api/messages')
      .set('Authorization', auth('member'))
      .send({ channelId, spans: spans('hello'), attachments: [] })
      .expect(201);
    messageId = (message.body as { id: string }).id;

    for (const who of ['owner', 'member', 'target'] as const) {
      socket[who] = await connect(who, token[who]);
      await subscribe(socket[who]);
    }
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
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    await app?.close();
    jest.restoreAllMocks();
  });

  it('presence: USER_ONLINE and USER_OFFLINE', async () => {
    const extra = await connect('extra', token.extra);
    await extra.timeout(5000).emitWithAck(ClientEvents.PRESENCE_ONLINE, {});
    await seen(ServerEvents.USER_ONLINE, (p) => p.userId === account.extra.id);

    extra.close();
    await seen(ServerEvents.USER_OFFLINE, (p) => p.userId === account.extra.id);
  });

  it('typing: USER_TYPING', async () => {
    socket.target!.emit(ClientEvents.TYPING_START, { channelId });
    socket.target!.emit(ClientEvents.TYPING_STOP, { channelId });
    await seen(ServerEvents.USER_TYPING, (p) => p.isTyping === false);
  });

  it('read receipts: self-sync, and the DM room with who read it', async () => {
    socket.member!.emit(ClientEvents.MARK_AS_READ, {
      channelId,
      lastReadMessageId: messageId,
    });
    await seen(
      ServerEvents.READ_RECEIPT_UPDATED,
      (p) => p.lastReadMessageId === messageId,
    );

    const dmMessageId: unknown = await socket
      .member!.timeout(5000)
      .emitWithAck(ClientEvents.SEND_DM, {
        directMessageGroupId: dmId,
        spans: spans('a preview'),
        attachments: [],
      });
    socket.target!.emit(ClientEvents.MARK_AS_READ, {
      directMessageGroupId: dmId,
      lastReadMessageId: dmMessageId,
    });
    const receipt = await seen(
      ServerEvents.READ_RECEIPT_UPDATED,
      (p) => p.userId === account.target.id,
    );
    expect(receipt.username).toBe('se-target');
  });

  it('a mention: NEW_NOTIFICATION through the fan-out, then NOTIFICATION_READ', async () => {
    const id: unknown = await socket
      .member!.timeout(5000)
      .emitWithAck(ClientEvents.SEND_MESSAGE, {
        channelId,
        spans: [
          { type: 'USER_MENTION', userId: account.target.id, text: '@target' },
        ],
        attachments: [],
      });

    const payload = await seen<NewNotificationPayload>(
      ServerEvents.NEW_NOTIFICATION,
      (p) => p.messageId === id,
    );
    expect(payload.message?.spans[0].userId).toBe(account.target.id);

    await http()
      .post(`/api/notifications/${payload.notificationId}/read`)
      .set('Authorization', auth('target'))
      .expect(200);
    await seen(ServerEvents.NOTIFICATION_READ);
  });

  it('REST: the notification list', async () => {
    const res = await http()
      .get('/api/notifications')
      .set('Authorization', auth('target'))
      .expect(200);

    const { notifications } = res.body as {
      notifications: { message: { spans: unknown[] } }[];
    };
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].message.spans.length).toBeGreaterThan(0);
    expectConforms('NotificationListResponseDto', 'notifications', res.body);
  });

  it('REST: the DM list, with its last message', async () => {
    const res = await http()
      .get('/api/direct-messages')
      .set('Authorization', auth('member'))
      .expect(200);

    const groups = res.body as { lastMessage: { spans: unknown[] } | null }[];
    expect(groups[0].lastMessage?.spans.length).toBeGreaterThan(0);
    for (const group of groups) {
      expectConforms('DmGroupResponseDto', 'DM list', group);
    }
  });

  it('voice in a channel: joined, updated, left', async () => {
    const voice = app.get(VoicePresenceService);

    await voice.joinVoiceChannelDirect(channelId, account.member.id);
    const joined = await seen<VoiceChannelUserJoinedPayload>(
      ServerEvents.VOICE_CHANNEL_USER_JOINED,
    );
    expect(joined.user).not.toHaveProperty('sid');
    expect(joined.user.joinedAt).toEqual(expect.any(String));

    await voice.updateDeafenState(channelId, account.member.id, true);
    await seen(ServerEvents.VOICE_CHANNEL_USER_UPDATED);

    await voice.leaveVoiceChannel(channelId, account.member.id);
    await seen(ServerEvents.VOICE_CHANNEL_USER_LEFT);
  });

  it('voice in a DM: call started, joined, left', async () => {
    const voice = app.get(VoicePresenceService);

    await voice['handleWebhookDmParticipantJoined'](dmId, account.member.id);
    await seen(ServerEvents.DM_VOICE_CALL_STARTED);

    await voice['handleWebhookDmParticipantJoined'](dmId, account.target.id);
    await seen(ServerEvents.DM_VOICE_USER_JOINED);

    await voice.leaveDmVoice(dmId, account.target.id);
    await seen(ServerEvents.DM_VOICE_USER_LEFT);
    await voice.leaveDmVoice(dmId, account.member.id);
  });

  it('channels: created, updated, permissions, reordered, deleted', async () => {
    const created = await http()
      .post('/api/channels')
      .set('Authorization', auth('owner'))
      .send({ name: 'second', communityId, type: 'TEXT', isPrivate: false })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const payload = await seen<ChannelCreatedPayloadDto>(
      ServerEvents.CHANNEL_CREATED,
      (p) => (p.channel as { id: string }).id === id,
    );
    expect(payload.channel.createdAt).toEqual(expect.any(String));

    await http()
      .patch(`/api/channels/${id}`)
      .set('Authorization', auth('owner'))
      .send({ name: 'renamed' })
      .expect(200);
    await seen(ServerEvents.CHANNEL_UPDATED);

    await http()
      .post(`/api/channels/${id}/move-up`)
      .set('Authorization', auth('owner'))
      .send({ communityId })
      .expect(200);
    await seen(ServerEvents.CHANNELS_REORDERED);

    await http()
      .patch(`/api/channels/${id}`)
      .set('Authorization', auth('owner'))
      .send({ isPrivate: true })
      .expect(200);
    await seen(ServerEvents.CHANNEL_PERMISSIONS_UPDATED);

    await http()
      .delete(`/api/channels/${id}`)
      .set('Authorization', auth('owner'))
      .expect(204);
    await seen(ServerEvents.CHANNEL_DELETED, (p) => p.channelId === id);
  });

  it('roles: created, updated, assigned, unassigned, deleted', async () => {
    const created = await http()
      .post(`/api/roles/community/${communityId}`)
      .set('Authorization', auth('owner'))
      .send({ name: 'Helper', actions: ['READ_MESSAGE'] })
      .expect(201);
    const roleId = (created.body as { id: string }).id;
    await seen(ServerEvents.ROLE_CREATED, (p) => p.roleId === roleId);

    await http()
      .put(`/api/roles/community/${communityId}/${roleId}`)
      .set('Authorization', auth('owner'))
      .send({ name: 'Helper 2', actions: ['READ_MESSAGE'] })
      .expect(200);
    await seen(ServerEvents.ROLE_UPDATED, (p) => p.roleId === roleId);

    await http()
      .post(`/api/roles/community/${communityId}/assign`)
      .set('Authorization', auth('owner'))
      .send({ userId: account.member.id, roleId })
      .expect(204);
    await seen(ServerEvents.ROLE_ASSIGNED, (p) => p.roleId === roleId);

    await http()
      .delete(
        `/api/roles/community/${communityId}/users/${account.member.id}/roles/${roleId}`,
      )
      .set('Authorization', auth('owner'))
      .expect(204);
    await seen(ServerEvents.ROLE_UNASSIGNED, (p) => p.roleId === roleId);

    await http()
      .delete(`/api/roles/community/${communityId}/${roleId}`)
      .set('Authorization', auth('owner'))
      .expect(204);
    await seen(ServerEvents.ROLE_DELETED, (p) => p.roleId === roleId);
  });

  it('a profile change: USER_PROFILE_UPDATED', async () => {
    await http()
      .patch('/api/users/profile')
      .set('Authorization', auth('member'))
      .send({ displayName: 'Member' })
      .expect(200);
    const payload = await seen(ServerEvents.USER_PROFILE_UPDATED);
    expect(payload.displayName).toBe('Member');
  });

  it('membership and moderation: added, timed out, kicked, banned', async () => {
    socket.extra = await connect('extra', token.extra);
    await subscribe(socket.extra);
    await http()
      .post('/api/membership')
      .set('Authorization', auth('owner'))
      .send({ userId: account.extra.id, communityId })
      .expect(201);
    await seen(
      ServerEvents.MEMBER_ADDED_TO_COMMUNITY,
      (p) => p.userId === account.extra.id,
    );

    await http()
      .post(`/api/moderation/timeout/${communityId}/${account.target.id}`)
      .set('Authorization', auth('owner'))
      .send({ durationSeconds: 60, reason: 'cool down' })
      .expect(200);
    await seen(ServerEvents.USER_TIMED_OUT);
    await http()
      .delete(`/api/moderation/timeout/${communityId}/${account.target.id}`)
      .set('Authorization', auth('owner'))
      .send({})
      .expect(200);
    await seen(ServerEvents.TIMEOUT_REMOVED);

    await http()
      .post(`/api/moderation/kick/${communityId}/${account.extra.id}`)
      .set('Authorization', auth('owner'))
      .send({})
      .expect(200);
    await seen(ServerEvents.USER_KICKED);

    await http()
      .post(`/api/moderation/ban/${communityId}/${account.target.id}`)
      .set('Authorization', auth('owner'))
      .send({ reason: 'enough' })
      .expect(200);
    await seen(ServerEvents.USER_BANNED);
  });

  it('a community: updated, deleted', async () => {
    const created = await http()
      .post('/api/community')
      .set('Authorization', auth('owner'))
      .send({ name: 'Short lived', description: 'e2e' })
      .expect(201);
    const id = (created.body as { id: string }).id;
    await subscribe(socket.owner!);

    await http()
      .patch(`/api/community/${id}`)
      .set('Authorization', auth('owner'))
      .send({ name: 'Renamed' })
      .expect(200);
    const updated = await seen(
      ServerEvents.COMMUNITY_UPDATED,
      (p) => p.communityId === id,
    );
    expect(updated.name).toBe('Renamed');

    await http()
      .delete(`/api/community/${id}`)
      .set('Authorization', auth('owner'))
      .expect(204);
    await seen(ServerEvents.COMMUNITY_DELETED, (p) => p.communityId === id);
  });

  it('a session: TOKEN_EXPIRING, then SESSION_TERMINATED', async () => {
    const shortLived = app.get(JwtService).sign(
      {
        sub: account.owner.id,
        username: account.owner.username,
        role: account.owner.role,
        jti: randomUUID(),
      },
      { expiresIn: 2 },
    );
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      auth: { token: `Bearer ${shortLived}` },
    });
    client.onAny((event: string, payload: unknown) => {
      events.push({ event, payload, who: 'short-lived' });
    });
    opened.push(client);
    client.connect();

    await seen(ServerEvents.TOKEN_EXPIRING);
    const ended = await seen(ServerEvents.SESSION_TERMINATED);
    expect(ended.reason).toBe('TOKEN_EXPIRED');
  });

  it('a desktop sign-in: DESKTOP_SIGN_IN to the other sessions', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorized = await http()
      .post('/api/auth/desktop/authorize')
      .set('Authorization', auth('member'))
      .send({
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        password: 'Password123!',
      })
      .expect(200);
    await http()
      .post('/api/auth/desktop/token')
      .set(
        'User-Agent',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 SemaphoreChat/0.6.0 Chrome/140.0.0.0 Electron/39.0.0',
      )
      .set('X-Device-Id', randomUUID())
      .send({
        code: (authorized.body as { code: string }).code,
        codeVerifier: verifier,
      })
      .expect(200);

    const signedIn = await seen(ServerEvents.DESKTOP_SIGN_IN);
    expect(typeof signedIn.signedInAt).toBe('string');
  });

  it('the reauthenticate acknowledgement', async () => {
    const result: unknown = await socket
      .member!.timeout(5000)
      .emitWithAck(ClientEvents.REAUTHENTICATE, { token: auth('member') });
    expectConforms('ReauthenticateResultDto', 'reauth ok', result);
    expect(result).toMatchObject({ ok: true });

    const refused: unknown = await socket
      .member!.timeout(5000)
      .emitWithAck(ClientEvents.REAUTHENTICATE, { token: 'Bearer nonsense' });
    expectConforms('ReauthenticateResultDto', 'reauth refused', refused);
    expect(refused).toEqual({ ok: false, error: 'AUTH_FAILED' });
  });

  describe('everything the sockets received', () => {
    const declared = () => new Set(declaredServerEvents());

    it('every payload conforms to its declared schema', () => {
      const problems = events
        .filter((e) => declared().has(e.event))
        .flatMap((e) =>
          schemaErrors(serverEventComponent(e.event), e.payload).map(
            (error) => `${e.event}: ${error}`,
          ),
        );

      expect(problems).toEqual([]);
    });

    it('every event the server sends is declared', () => {
      const undeclared = new Set(
        events
          .map((e) => e.event)
          .filter((event) => !declared().has(event))
          // The ack of a voice or presence call goes back through Socket.IO
          .filter((event) => event !== 'exception'),
      );

      expect([...undeclared]).toEqual([]);
    });

    it('drove every declared event, except those it can name a reason for', () => {
      const elsewhere = new Set<string>([
        // message-wire-contract.e2e-spec.ts
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
      const notDriven = new Set<string>([
        // Need a running LiveKit egress: the compiler checks these against the
        // generated types instead
        ServerEvents.REPLAY_BUFFER_STOPPED,
        ServerEvents.REPLAY_BUFFER_FAILED,
        ServerEvents.EGRESS_SEGMENTS_READY,
      ]);
      const received = new Set(events.map((e) => e.event));
      const missing = declaredServerEvents().filter(
        (event) =>
          !received.has(event) &&
          !elsewhere.has(event) &&
          !notDriven.has(event),
      );

      expect(missing).toEqual([]);
    });

    it('nothing carries a sensitive user field', () => {
      const raw = JSON.stringify(events.filter((e) => declared().has(e.event)));
      const found = SENSITIVE_USER_FIELDS.filter(
        // Not a user's field on these payloads: a notification's own timestamp
        (field) => field !== 'createdAt' && raw.includes(`"${field}"`),
      );

      expect(found).toEqual([]);
    });
  });
});
