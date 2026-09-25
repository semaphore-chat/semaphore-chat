import { ClientEvents } from '@semaphore-chat/shared';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { PresenceGateway } from '@/presence/presence.gateway';
import {
  createE2eApp,
  E2eApp,
  loginUser,
  registerUser,
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

  async function closeSocket(client: Socket): Promise<void> {
    const id = client.id;
    client.close();
    if (!id) return;
    const deadline = Date.now() + 5000;
    while (!handledDisconnects.has(id)) {
      if (Date.now() > deadline) {
        throw new Error(`server did not handle the disconnect of ${id}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
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
    await registerUser(app, user);
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
});
