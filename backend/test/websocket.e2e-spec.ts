import { randomUUID } from 'crypto';
import {
  ClientEvents,
  ServerEvents,
  type ReauthenticateResult,
  type SessionTerminatedPayload,
} from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PresenceGateway } from '@/presence/presence.gateway';
import { RoomsGateway } from '@/rooms/rooms.gateway';
import { RoomsService } from '@/rooms/rooms.service';
import { WebsocketService } from '@/websocket/websocket.service';
import type { Server as IoServer } from 'socket.io';
import type { AuthenticatedSocket } from '@/common/utils/socket.utils';
import { UserService } from '@/user/user.service';
import { AuthService } from '@/auth/auth.service';
import { DatabaseService } from '@/database/database.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import type Redis from 'ioredis';
import {
  createE2eApp,
  E2eApp,
  extractCookie,
  getSetCookies,
  loginUser,
  registerUser,
  RegisteredUser,
  resetDatabase,
  seedInstanceInvite,
} from './helpers/e2e-app';

/**
 * WebSocket messages through the full gateway pipeline (connection auth
 * middleware, global and gateway guards, global pipes, gateway filters),
 * with a real Socket.IO client against the booted AppModule.
 *
 * Since Nest 12 the app's global enhancers run on gateway handlers too. An
 * invalid payload must still reach the client as the class-validator errors
 * (what the gateways' own ValidationPipe sent before Nest 12), not as
 * "Internal server error".
 */
describe('WebSocket gateways (e2e)', () => {
  let app: E2eApp;
  let url: string;
  let token: string;
  let socket: Socket | undefined;
  let owner: RegisteredUser;

  const user = {
    username: 'e2e-ws-user',
    password: 'Password123!',
    email: 'e2e-ws-user@test.local',
  };

  function connect(auth: Record<string, unknown>): Promise<Socket> {
    const client = io(url, {
      transports: ['websocket'],
      reconnection: false,
      auth,
    });
    return new Promise((resolve, reject) => {
      client.once('connect', () => resolve(client));
      client.once('connect_error', (err) => {
        client.close();
        reject(err);
      });
    });
  }

  // PresenceGateway.handleDisconnect updates Redis after the client has
  // gone. Wait for it before the next test and before app.close() (which
  // closes Redis), or it fails with "Connection is closed".
  const handledDisconnects = new Set<string>();

  async function waitForHandledDisconnect(id: string): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!handledDisconnects.has(id)) {
      if (Date.now() > deadline) {
        throw new Error(`server did not handle the disconnect of ${id}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function closeSocket(client: Socket): Promise<void> {
    const id = client.id;
    client.close();
    if (!id) return;
    await waitForHandledDisconnect(id);
  }

  function nextException(client: Socket): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('no "exception" event within 5s')),
        5000,
      );
      client.once('exception', (payload: unknown) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  beforeAll(async () => {
    // Before the app boots: Nest binds the handler at init.
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
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;

    await resetDatabase(app);
    await seedInstanceInvite(app);
    // First user registered after the reset: the instance OWNER
    owner = await registerUser(app, user);
    token = (await loginUser(app, user.username, user.password)).accessToken;
  });

  afterEach(async () => {
    if (socket) await closeSocket(socket);
    socket = undefined;
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('rejects a connection without a valid token', async () => {
    await expect(connect({ token: 'garbage' })).rejects.toThrow('AUTH_FAILED');
  });

  it('runs a handler for an authenticated socket', async () => {
    socket = await connect({ token });

    await expect(
      socket.timeout(5000).emitWithAck(ClientEvents.PRESENCE_ONLINE, {}),
    ).resolves.toBe('ACK');
  });

  it('answers an invalid payload with the validation errors, not "Internal server error"', async () => {
    socket = await connect({ token });

    const exception = nextException(socket);
    socket.emit(ClientEvents.TYPING_START, { channelId: 42 });

    expect(await exception).toEqual([
      {
        property: 'channelId',
        children: [],
        constraints: { isString: 'channelId must be a string' },
      },
    ]);
  });

  /**
   * Live sockets end when their session does: logout, instance ban, password
   * reset, session revocation, token expiry. A community ban only takes the
   * socket out of that community's rooms.
   */
  describe('session revocation', () => {
    const password = 'Password123!';
    /** Every socket a test opened, by the id it connected with. */
    const opened = new Map<string, Socket>();

    let communityId: string;
    let channelId: string;

    async function register(username: string): Promise<RegisteredUser> {
      return registerUser(app, {
        username,
        password,
        email: `${username}@test.local`,
      });
    }

    /**
     * Sign in as a device of its own: sessions are deduplicated per device
     * (user agent), so two logins with the same agent share nothing.
     */
    // Distinct device names: a login replaces the user's other sessions on
    // the same device (see AuthService.generateRefreshToken)
    const userAgents = {
      Laptop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      Phone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari',
    };
    type Device = keyof typeof userAgents;

    async function login(
      username: string,
      device: Device,
    ): Promise<{ accessToken: string; refreshCookie: string }> {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('User-Agent', userAgents[device])
        .send({ username, password })
        .expect(200);
      return {
        accessToken: (res.body as { accessToken: string }).accessToken,
        refreshCookie: extractCookie(getSetCookies(res), 'refresh_token')!,
      };
    }

    /** A second tab of the same session: refresh with the session cookie. */
    async function refresh(
      refreshCookie: string,
      device: Device,
    ): Promise<{ accessToken: string; refreshCookie: string }> {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('User-Agent', userAgents[device])
        .set('Cookie', refreshCookie)
        .expect(200);
      return {
        accessToken: (res.body as { accessToken: string }).accessToken,
        refreshCookie: extractCookie(getSetCookies(res), 'refresh_token')!,
      };
    }

    /**
     * Connect a socket. `beforeConnect` adds listeners before the connection
     * exists, for events the server sends right away.
     */
    async function open(
      accessToken: string,
      beforeConnect?: (client: Socket) => void,
    ): Promise<Socket> {
      const client = io(url, {
        transports: ['websocket'],
        reconnection: false,
        autoConnect: false,
        auth: { token: `Bearer ${accessToken}` },
      });
      beforeConnect?.(client);
      await new Promise<void>((resolve, reject) => {
        client.once('connect', () => resolve());
        client.once('connect_error', (err) => {
          client.close();
          reject(err);
        });
        client.connect();
      });
      opened.set(client.id!, client);
      return client;
    }

    /** The server side of a client's socket. */
    function serverSocket(client: Socket): AuthenticatedSocket {
      // Private: tests only
      const server: IoServer = app.get(WebsocketService)['server'];
      const found = server.of('/').sockets.get(client.id!);
      if (!found) throw new Error(`no server socket for ${client.id}`);
      return found as AuthenticatedSocket;
    }

    /**
     * What SUBSCRIBE_ALL does, awaited (the event has no acknowledgement to
     * wait for).
     */
    async function subscribeAll(client: Socket): Promise<void> {
      await app.get(RoomsService).joinAllUserRooms(serverSocket(client));
    }

    /** Open a socket and subscribe it to all of its rooms. */
    async function openSubscribed(accessToken: string): Promise<Socket> {
      const client = await open(accessToken);
      await subscribeAll(client);
      return client;
    }

    /** Resolves with the SESSION_TERMINATED reason and the disconnect reason. */
    function sessionEnd(
      client: Socket,
      timeoutMs = 5000,
    ): Promise<{ terminated?: string; disconnect: string }> {
      return new Promise((resolve, reject) => {
        let terminated: string | undefined;
        const timer = setTimeout(
          () => reject(new Error(`socket not disconnected in ${timeoutMs}ms`)),
          timeoutMs,
        );
        client.on(
          ServerEvents.SESSION_TERMINATED,
          (payload: SessionTerminatedPayload) => {
            terminated = payload.reason;
          },
        );
        client.once('disconnect', (reason) => {
          clearTimeout(timer);
          resolve({ terminated, disconnect: reason });
        });
      });
    }

    /** Whether the socket is still connected and served. */
    async function isServed(client: Socket): Promise<boolean> {
      if (!client.connected) return false;
      const ack: unknown = await client
        .timeout(5000)
        .emitWithAck(ClientEvents.PRESENCE_ONLINE, {});
      return ack === 'ACK';
    }

    function received(client: Socket, event: string): unknown[] {
      const payloads: unknown[] = [];
      client.on(event, (payload: unknown) => payloads.push(payload));
      return payloads;
    }

    async function waitFor(check: () => boolean, what: string): Promise<void> {
      const deadline = Date.now() + 5000;
      while (!check()) {
        if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }

    async function sendMessage(client: Socket, text: string): Promise<void> {
      await client.timeout(5000).emitWithAck(ClientEvents.SEND_MESSAGE, {
        channelId,
        spans: [
          {
            type: 'PLAINTEXT',
            text,
            userId: null,
            specialKind: null,
            communityId: null,
            aliasId: null,
          },
        ],
        attachments: [],
      });
    }

    beforeAll(async () => {
      const server = app.getHttpServer();
      const community = await request(server)
        .post('/api/community')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'WS revocation', description: 'e2e' })
        .expect(201);
      communityId = (community.body as { id: string }).id;

      const channel = await request(server)
        .post('/api/channels')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'revocation',
          communityId,
          type: 'TEXT',
          isPrivate: false,
        })
        .expect(201);
      channelId = (channel.body as { id: string }).id;
    });

    beforeEach(() => {
      // Every test opens several sockets from 127.0.0.1; the per-IP
      // connection rate limit (10/min) is not what's under test here.
      app.get(RoomsGateway)['connectionAttempts'].clear();
    });

    afterEach(async () => {
      const ids = [...opened.keys()];
      for (const client of opened.values()) client.close();
      opened.clear();
      await Promise.all(ids.map((id) => waitForHandledDisconnect(id)));
    });

    it('logout disconnects the sockets of that session only', async () => {
      await register('ws-logout');
      const laptop = await login('ws-logout', 'Laptop');
      // A second tab of the laptop session, and another device
      const laptopTab2 = await refresh(laptop.refreshCookie, 'Laptop');
      const phone = await login('ws-logout', 'Phone');

      const tab1 = await open(laptop.accessToken);
      const tab2 = await open(laptopTab2.accessToken);
      const phoneSocket = await open(phone.accessToken);
      const tab1End = sessionEnd(tab1);
      const tab2End = sessionEnd(tab2);

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${laptopTab2.accessToken}`)
        .set('Cookie', laptopTab2.refreshCookie)
        .expect(201);

      await expect(tab1End).resolves.toEqual({
        terminated: 'LOGGED_OUT',
        disconnect: 'io server disconnect',
      });
      await expect(tab2End).resolves.toEqual({
        terminated: 'LOGGED_OUT',
        disconnect: 'io server disconnect',
      });
      // The phone's session is unaffected
      await expect(isServed(phoneSocket)).resolves.toBe(true);

      // The logged-out session's tokens can't reconnect
      await expect(connect({ token: laptop.accessToken })).rejects.toThrow(
        'AUTH_FAILED',
      );
      await expect(connect({ token: laptopTab2.accessToken })).rejects.toThrow(
        'AUTH_FAILED',
      );
    });

    it('an instance ban disconnects all sockets of the user', async () => {
      const target = await register('ws-banned');
      const a = await login('ws-banned', 'Laptop');
      const b = await login('ws-banned', 'Phone');
      const socketA = await open(a.accessToken);
      const socketB = await open(b.accessToken);
      const endA = sessionEnd(socketA);
      const endB = sessionEnd(socketB);

      await request(app.getHttpServer())
        .patch(`/api/users/admin/${target.id}/ban`)
        .set('Authorization', `Bearer ${token}`)
        .send({ banned: true })
        .expect(200);

      await expect(endA).resolves.toEqual({
        terminated: 'ACCOUNT_BANNED',
        disconnect: 'io server disconnect',
      });
      await expect(endB).resolves.toMatchObject({
        terminated: 'ACCOUNT_BANNED',
      });
      await expect(connect({ token: a.accessToken })).rejects.toThrow(
        'AUTH_FAILED',
      );
      // Nor can the session be renewed
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', a.refreshCookie)
        .expect(401);
    });

    it('a password reset disconnects all sockets and revokes the access tokens', async () => {
      const target = await register('ws-password');
      const session = await login('ws-password', 'Laptop');
      const client = await open(session.accessToken);
      const end = sessionEnd(client);

      await request(app.getHttpServer())
        .patch(`/api/users/admin/${target.id}/password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'BrandNewPassword1!' })
        .expect(200);

      await expect(end).resolves.toEqual({
        terminated: 'PASSWORD_CHANGED',
        disconnect: 'io server disconnect',
      });
      await expect(connect({ token: session.accessToken })).rejects.toThrow(
        'AUTH_FAILED',
      );
      // REST rejects the old access token too
      await request(app.getHttpServer())
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);
    });

    it('revoking a session disconnects its sockets, not the current ones', async () => {
      await register('ws-sessions');
      const current = await login('ws-sessions', 'Laptop');
      const other = await login('ws-sessions', 'Phone');
      const currentSocket = await open(current.accessToken);
      const otherSocket = await open(other.accessToken);
      const otherEnd = sessionEnd(otherSocket);

      await request(app.getHttpServer())
        .delete('/api/auth/sessions')
        .set('Authorization', `Bearer ${current.accessToken}`)
        .set('Cookie', current.refreshCookie)
        .expect(200);

      await expect(otherEnd).resolves.toEqual({
        terminated: 'SESSION_REVOKED',
        disconnect: 'io server disconnect',
      });
      await expect(isServed(currentSocket)).resolves.toBe(true);
    });

    it('a community ban stops community events but keeps the socket', async () => {
      const member = await register('ws-community-ban');
      await request(app.getHttpServer())
        .post('/api/membership')
        .set('Authorization', `Bearer ${token}`)
        .send({ userId: member.id, communityId })
        .expect(201);
      const session = await login('ws-community-ban', 'Laptop');

      const ownerSocket = await openSubscribed(token);
      const memberSocket = await openSubscribed(session.accessToken);
      const ownerMessages = received(ownerSocket, ServerEvents.NEW_MESSAGE);
      const memberMessages = received(memberSocket, ServerEvents.NEW_MESSAGE);
      const memberBans = received(memberSocket, ServerEvents.USER_BANNED);

      // Before the ban the member gets the channel's messages
      await sendMessage(ownerSocket, 'before the ban');
      await waitFor(() => memberMessages.length === 1, 'message before ban');

      await request(app.getHttpServer())
        .post(`/api/moderation/ban/${communityId}/${member.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);
      await waitFor(() => memberBans.length > 0, 'ban notification');
      // The rooms are left asynchronously (a domain event handler)
      await waitFor(
        () => !serverSocket(memberSocket).rooms.has(channelId),
        'member left the channel room',
      );
      expect(
        serverSocket(memberSocket).rooms.has(`community:${communityId}`),
      ).toBe(false);

      // Re-subscribing must not bring the community back either
      await subscribeAll(memberSocket);
      expect(serverSocket(memberSocket).rooms.has(channelId)).toBe(false);

      await sendMessage(ownerSocket, 'after the ban');
      await waitFor(() => ownerMessages.length === 2, 'owner got 2 messages');
      // Give the member's copy, if any, time to arrive
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(memberMessages).toHaveLength(1);

      // Still connected: a community ban isn't a sign-out
      await expect(isServed(memberSocket)).resolves.toBe(true);
    });

    it('an expired token disconnects the socket with TOKEN_EXPIRED', async () => {
      const shortLived = app.get(JwtService).sign(
        {
          sub: owner.id,
          username: owner.username,
          role: owner.role,
          jti: randomUUID(),
        },
        { expiresIn: 2 },
      );
      let expiring: unknown[] = [];
      let end!: Promise<{ terminated?: string; disconnect: string }>;
      await open(shortLived, (client) => {
        expiring = received(client, ServerEvents.TOKEN_EXPIRING);
        end = sessionEnd(client, 6000);
      });

      await expect(end).resolves.toEqual({
        terminated: 'TOKEN_EXPIRED',
        disconnect: 'io server disconnect',
      });
      // It was warned first (its token was always within the warning window)
      expect(expiring).toHaveLength(1);
    });

    it('re-authenticating with a fresh token keeps the socket past the old expiry', async () => {
      const jwtService = app.get(JwtService);
      const claims = {
        sub: owner.id,
        username: owner.username,
        role: owner.role,
      };
      const shortLived = jwtService.sign(
        { ...claims, jti: randomUUID() },
        { expiresIn: 2 },
      );
      const client = await open(shortLived);
      let disconnected = false;
      client.on('disconnect', () => {
        disconnected = true;
      });

      const result = (await client
        .timeout(5000)
        .emitWithAck(ClientEvents.REAUTHENTICATE, {
          token: `Bearer ${token}`,
        })) as ReauthenticateResult;
      expect(result).toMatchObject({ ok: true });

      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(disconnected).toBe(false);
      await expect(isServed(client)).resolves.toBe(true);
    });

    it('rejects re-authenticating as another user or with a revoked token', async () => {
      const other = await register('ws-reauth-other');
      const otherSession = await login(other.username, 'Laptop');
      const client = await open(token);

      await expect(
        client.timeout(5000).emitWithAck(ClientEvents.REAUTHENTICATE, {
          token: otherSession.accessToken,
        }),
      ).resolves.toEqual({ ok: false, error: 'AUTH_FAILED' });

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${otherSession.accessToken}`)
        .expect(201);
      await expect(
        client.timeout(5000).emitWithAck(ClientEvents.REAUTHENTICATE, {
          token: otherSession.accessToken,
        }),
      ).resolves.toEqual({ ok: false, error: 'AUTH_FAILED' });

      // The socket itself is fine
      await expect(isServed(client)).resolves.toBe(true);
    });

    /**
     * Refresh token reuse: tabs sharing one cookie may present the same
     * refresh token at the same time. Within the grace window that is the
     * same session and gets the token the first refresh rotated to; after
     * it, it's a stolen token and the whole session ends.
     */
    describe('refresh token reuse', () => {
      /** The raw refresh token of a `refresh_token=<jwt>` cookie. */
      function tokenOf(refreshCookie: string): string {
        return refreshCookie.slice(refreshCookie.indexOf('=') + 1);
      }

      function jtiOf(refreshCookie: string): string {
        return app
          .get(JwtService)
          .decode<{ jti: string }>(tokenOf(refreshCookie)).jti;
      }

      function refreshRequest(refreshCookie: string): request.Test {
        return request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('User-Agent', userAgents.Laptop)
          .set('Cookie', refreshCookie);
      }

      /** Move a consumed refresh token's rotation back in time. */
      async function rotatedAgo(refreshCookie: string, ms: number) {
        await app.get(DatabaseService).refreshToken.update({
          where: { id: jtiOf(refreshCookie) },
          data: { consumedAt: new Date(Date.now() - ms) },
        });
      }

      /** The session's refresh tokens that can still be used. */
      async function liveTokensOf(accessToken: string) {
        const { sid } = app
          .get(JwtService)
          .decode<{ sid: string }>(accessToken);
        return app.get(DatabaseService).refreshToken.findMany({
          where: { familyId: sid, consumed: false },
        });
      }

      it('concurrent refreshes with one cookie all succeed with the same new token', async () => {
        await register('ws-reuse-concurrent');
        const session = await login('ws-reuse-concurrent', 'Laptop');
        const client = await open(session.accessToken);

        // Ten restored tabs refresh at once with the shared cookie
        const responses = await Promise.all(
          Array.from({ length: 10 }, () =>
            refreshRequest(session.refreshCookie).then((res) => res),
          ),
        );

        expect(responses.map((res) => res.status)).toEqual(Array(10).fill(200));
        const cookies = new Set(
          responses.map((res) =>
            extractCookie(getSetCookies(res), 'refresh_token'),
          ),
        );
        // One rotation: every tab got the same successor, no fork
        expect(cookies.size).toBe(1);
        const [successor] = [...cookies] as string[];
        expect(successor).not.toEqual(session.refreshCookie);
        const accessTokens = responses.map(
          (res) => (res.body as { accessToken: string }).accessToken,
        );
        const live = await liveTokensOf(accessTokens[0]);
        expect(live.map((t) => t.id)).toEqual([jtiOf(successor)]);

        // Every tab's access token works and the session lives on
        for (const accessToken of accessTokens) {
          await request(app.getHttpServer())
            .get('/api/users/profile')
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);
        }
        await expect(isServed(client)).resolves.toBe(true);
        await refreshRequest(successor).expect(200);
      });

      it('a retry with the rotated cookie gets the latest token of the session', async () => {
        await register('ws-reuse-retry');
        const session = await login('ws-reuse-retry', 'Laptop');
        const first = await refresh(session.refreshCookie, 'Laptop');
        const second = await refresh(first.refreshCookie, 'Laptop');

        // The first response got lost; the client retries with the old
        // cookie a moment later
        const retried = await refreshRequest(session.refreshCookie).expect(200);

        expect(extractCookie(getSetCookies(retried), 'refresh_token')).toEqual(
          second.refreshCookie,
        );
        const retriedAccessToken = (retried.body as { accessToken: string })
          .accessToken;
        await request(app.getHttpServer())
          .get('/api/users/profile')
          .set('Authorization', `Bearer ${retriedAccessToken}`)
          .expect(200);
        await refreshRequest(second.refreshCookie).expect(200);
      });

      it('reuse after the grace window ends the whole session', async () => {
        await register('ws-reuse-late');
        const session = await login('ws-reuse-late', 'Laptop');
        const rotated = await refresh(session.refreshCookie, 'Laptop');
        const phone = await login('ws-reuse-late', 'Phone');
        const client = await open(rotated.accessToken);
        const phoneSocket = await open(phone.accessToken);
        const end = sessionEnd(client);

        await rotatedAgo(session.refreshCookie, 60_000);
        await refreshRequest(session.refreshCookie).expect(401);

        // The holder of the rotated token is signed out everywhere
        await expect(end).resolves.toEqual({
          terminated: 'SESSION_REVOKED',
          disconnect: 'io server disconnect',
        });
        await request(app.getHttpServer())
          .get('/api/users/profile')
          .set('Authorization', `Bearer ${rotated.accessToken}`)
          .expect(401);
        await refreshRequest(rotated.refreshCookie).expect(401);
        await expect(connect({ token: rotated.accessToken })).rejects.toThrow(
          'AUTH_FAILED',
        );
        // Other sessions are not affected
        await expect(isServed(phoneSocket)).resolves.toBe(true);
      });

      it('the grace window does not bring back a revoked session', async () => {
        await register('ws-reuse-revoked');
        const session = await login('ws-reuse-revoked', 'Laptop');
        const rotated = await refresh(session.refreshCookie, 'Laptop');

        await request(app.getHttpServer())
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${rotated.accessToken}`)
          .set('Cookie', rotated.refreshCookie)
          .expect(201);

        await refreshRequest(session.refreshCookie).expect(401);
      });

      it('the grace window does not outlive a password reset', async () => {
        const target = await register('ws-reuse-reset');
        const session = await login('ws-reuse-reset', 'Laptop');
        await refresh(session.refreshCookie, 'Laptop');

        await request(app.getHttpServer())
          .patch(`/api/users/admin/${target.id}/password`)
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'BrandNewPassword1!' })
          .expect(200);
        // Even once the cutoff is gone
        await app
          .get<Redis>(REDIS_CLIENT)
          .del(`token:revoked-user:${target.id}`);

        await refreshRequest(session.refreshCookie).expect(401);
      });
    });

    /**
     * The security review's race probes, made deterministic: the next call
     * of a service method is held, so a revocation lands in its window.
     */
    describe('races', () => {
      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

      /**
       * Hold the next call of `target[method]`: `before` ms before it runs
       * the original, `after` ms after. Resolves once that call started.
       */
      function holdNextCall(
        target: object,
        method: string,
        { before = 0, after = 0 }: { before?: number; after?: number },
      ): Promise<void> {
        const methods = target as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >;
        const originalMethod = methods[method];
        const original = (...args: unknown[]) =>
          Reflect.apply(originalMethod, target, args);
        return new Promise((entered) => {
          jest
            .spyOn(methods, method)
            .mockImplementationOnce(async (...args: unknown[]) => {
              entered();
              await sleep(before);
              const result = await original(...args);
              await sleep(after);
              return result;
            });
        });
      }

      /** Send a request now (supertest only sends once awaited). */
      function send(test: request.Test): Promise<request.Response> {
        return test.then((res) => res);
      }

      function sessionIdOf(accessToken: string): string {
        const { sid } = app
          .get(JwtService)
          .decode<{ sid: string }>(accessToken);
        return sid;
      }

      it('a logout during the handshake still ends the socket', async () => {
        await register('ws-race-connect-logout');
        const session = await login('ws-race-connect-logout', 'Laptop');
        // The user lookup has run (not revoked yet) but the socket hasn't
        // joined its rooms: the logout's disconnect can't reach it
        const held = holdNextCall(app.get(UserService), 'findAuthUserById', {
          after: 300,
        });
        let end!: ReturnType<typeof sessionEnd>;
        const opening = open(session.accessToken, (client) => {
          end = sessionEnd(client, 3000);
        }).catch((err: Error) => err);
        await held;

        await request(app.getHttpServer())
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${session.accessToken}`)
          .set('Cookie', session.refreshCookie)
          .expect(201);

        await opening;
        await expect(end).resolves.toEqual({
          terminated: 'LOGGED_OUT',
          disconnect: 'io server disconnect',
        });
      });

      it('an instance ban during the handshake still ends the socket', async () => {
        const target = await register('ws-race-connect-ban');
        const session = await login('ws-race-connect-ban', 'Laptop');
        const held = holdNextCall(app.get(UserService), 'findAuthUserById', {
          after: 300,
        });
        let end!: ReturnType<typeof sessionEnd>;
        const opening = open(session.accessToken, (client) => {
          end = sessionEnd(client, 3000);
        }).catch((err: Error) => err);
        await held;

        await request(app.getHttpServer())
          .patch(`/api/users/admin/${target.id}/ban`)
          .set('Authorization', `Bearer ${token}`)
          .send({ banned: true })
          .expect(200);

        await opening;
        await expect(end).resolves.toEqual({
          terminated: 'ACCOUNT_BANNED',
          disconnect: 'io server disconnect',
        });
      });

      it('a session revoked while re-authenticating with its token ends the socket', async () => {
        await register('ws-race-reauth');
        const laptop = await login('ws-race-reauth', 'Laptop');
        const phone = await login('ws-race-reauth', 'Phone');
        const client = await open(laptop.accessToken);
        const end = sessionEnd(client, 3000);

        // Re-authenticate with the phone session's token while the laptop
        // revokes the phone session
        const held = holdNextCall(app.get(UserService), 'findAuthUserById', {
          after: 300,
        });
        const reauth = client
          .timeout(5000)
          .emitWithAck(ClientEvents.REAUTHENTICATE, {
            token: `Bearer ${phone.accessToken}`,
          })
          .catch((err: Error) => err);
        await held;
        await request(app.getHttpServer())
          .delete('/api/auth/sessions')
          .set('Authorization', `Bearer ${laptop.accessToken}`)
          .set('Cookie', laptop.refreshCookie)
          .expect(200);

        await expect(end).resolves.toEqual({
          terminated: 'SESSION_REVOKED',
          disconnect: 'io server disconnect',
        });
        await expect(reauth).resolves.not.toEqual(
          expect.objectContaining({ ok: true }),
        );
      });

      it('a refresh racing a password reset leaves no working token', async () => {
        const target = await register('ws-race-refresh-reset');
        const session = await login('ws-race-refresh-reset', 'Laptop');

        // The refresh has consumed its token and is about to insert the next
        // one when the reset runs
        const held = holdNextCall(
          app.get(AuthService),
          'generateRefreshToken',
          {
            before: 300,
          },
        );
        const refreshing = send(
          request(app.getHttpServer())
            .post('/api/auth/refresh')
            .set('User-Agent', userAgents.Laptop)
            .set('Cookie', session.refreshCookie),
        );
        await held;
        await request(app.getHttpServer())
          .patch(`/api/users/admin/${target.id}/password`)
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'BrandNewPassword1!' })
          .expect(200);
        const raced = await refreshing;
        // It went first (see session-lock.util) and got new tokens
        expect(raced.status).toBe(200);

        // Its access token is revoked like every other one of the user
        const racedAccessToken = (raced.body as { accessToken: string })
          .accessToken;
        await request(app.getHttpServer())
          .get('/api/users/profile')
          .set('Authorization', `Bearer ${racedAccessToken}`)
          .expect(401);
        await expect(connect({ token: racedAccessToken })).rejects.toThrow(
          'AUTH_FAILED',
        );

        // And its refresh token is gone, not just refused while the
        // password-reset cutoff lives (an hour, an access token's lifetime)
        await app
          .get<Redis>(REDIS_CLIENT)
          .del(`token:revoked-user:${target.id}`);
        const racedCookie = extractCookie(
          getSetCookies(raced),
          'refresh_token',
        )!;
        await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('User-Agent', userAgents.Laptop)
          .set('Cookie', racedCookie)
          .expect(401);
      });

      it('a login racing a password reset leaves no working token', async () => {
        const target = await register('ws-race-login-reset');

        // The login has checked the old password when the reset runs
        const held = holdNextCall(app.get(AuthService), 'validateUser', {
          after: 300,
        });
        const loggingIn = send(
          request(app.getHttpServer())
            .post('/api/auth/login')
            .set('User-Agent', userAgents.Laptop)
            .send({ username: 'ws-race-login-reset', password }),
        );
        await held;
        await request(app.getHttpServer())
          .patch(`/api/users/admin/${target.id}/password`)
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'BrandNewPassword1!' })
          .expect(200);
        const raced = await loggingIn;

        // The password it checked is no longer the account's password
        expect(raced.status).toBe(401);
        expect(extractCookie(getSetCookies(raced), 'refresh_token')).toBe(
          undefined,
        );
        // It left no session behind
        await expect(
          app
            .get(DatabaseService)
            .refreshToken.count({ where: { userId: target.id } }),
        ).resolves.toBe(0);
      });

      it('a login that goes before a password reset loses its tokens to the reset', async () => {
        const target = await register('ws-race-login-first');

        // The login is issuing its tokens when the reset runs
        const held = holdNextCall(
          app.get(AuthService),
          'generateRefreshToken',
          { before: 300 },
        );
        const loggingIn = send(
          request(app.getHttpServer())
            .post('/api/auth/login')
            .set('User-Agent', userAgents.Laptop)
            .send({ username: 'ws-race-login-first', password }),
        );
        await held;
        await request(app.getHttpServer())
          .patch(`/api/users/admin/${target.id}/password`)
          .set('Authorization', `Bearer ${token}`)
          .send({ password: 'BrandNewPassword1!' })
          .expect(200);
        const raced = await loggingIn;
        expect(raced.status).toBe(200);

        // Its access token is revoked with the user's other tokens
        const racedAccessToken = (raced.body as { accessToken: string })
          .accessToken;
        await request(app.getHttpServer())
          .get('/api/users/profile')
          .set('Authorization', `Bearer ${racedAccessToken}`)
          .expect(401);
        // And its refresh token is gone, not just refused while the cutoff
        // (an hour) lives
        await app
          .get<Redis>(REDIS_CLIENT)
          .del(`token:revoked-user:${target.id}`);
        await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('User-Agent', userAgents.Laptop)
          .set('Cookie', extractCookie(getSetCookies(raced), 'refresh_token')!)
          .expect(401);
      });

      it('a refresh racing a logout leaves no working token, even once the session marker expires', async () => {
        await register('ws-race-refresh-logout');
        const session = await login('ws-race-refresh-logout', 'Laptop');

        const held = holdNextCall(
          app.get(AuthService),
          'generateRefreshToken',
          {
            before: 300,
          },
        );
        const refreshing = send(
          request(app.getHttpServer())
            .post('/api/auth/refresh')
            .set('User-Agent', userAgents.Laptop)
            .set('Cookie', session.refreshCookie),
        );
        await held;
        // Another tab of the session logs out
        await request(app.getHttpServer())
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${session.accessToken}`)
          .set('Cookie', session.refreshCookie)
          .expect(201);
        const raced = await refreshing;
        // It went first (see session-lock.util) and got new tokens
        expect(raced.status).toBe(200);

        const racedAccessToken = (raced.body as { accessToken: string })
          .accessToken;
        await request(app.getHttpServer())
          .get('/api/users/profile')
          .set('Authorization', `Bearer ${racedAccessToken}`)
          .expect(401);

        // The revoked-session marker lives an hour (an access token's
        // lifetime); the session's refresh tokens must not outlive it
        await app
          .get<Redis>(REDIS_CLIENT)
          .del(`token:revoked-session:${sessionIdOf(racedAccessToken)}`);
        const racedCookie = extractCookie(
          getSetCookies(raced),
          'refresh_token',
        )!;
        await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('User-Agent', userAgents.Laptop)
          .set('Cookie', racedCookie)
          .expect(401);
      });
    });
  });
});
