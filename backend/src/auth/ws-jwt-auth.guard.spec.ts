import { ServerEvents } from '@semaphore-chat/shared';
import { WsJwtAuthGuard } from './ws-jwt-auth.guard';
import {
  UserFactory,
  createMockHttpExecutionContext,
  createMockWsExecutionContext,
} from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';

describe('WsJwtAuthGuard', () => {
  const guard = new WsJwtAuthGuard();
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const createClient = (
    handshake: Record<string, unknown>,
    data: Record<string, unknown> = {},
  ) => ({
    id: 'socket-123',
    handshake: { headers: {}, ...handshake },
    data,
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  const contextFor = (client: ReturnType<typeof createClient>) => {
    const context = createMockWsExecutionContext({ client });
    // The helper copies the client; assert on what the guard received
    const wsClient = context.switchToWs().getClient<typeof client>();
    // It also adds `user` to data; keep data as the test set it
    wsClient.data = client.data;
    return { context, wsClient };
  };

  const user = () => new UserEntity(UserFactory.build());

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('non-WebSocket contexts', () => {
    it('allows HTTP contexts', () => {
      expect(guard.canActivate(createMockHttpExecutionContext({}))).toBe(true);
    });

    it('allows other context types', () => {
      const context = { getType: jest.fn().mockReturnValue('rpc') } as any;

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  it('allows a socket with a live session', () => {
    const { context, wsClient } = contextFor(
      createClient(
        { user: user() },
        { auth: { userId: 'u', exp: nowSeconds() + 60 } },
      ),
    );

    expect(guard.canActivate(context)).toBe(true);
    expect(wsClient.disconnect).not.toHaveBeenCalled();
  });

  it('ends the session of a socket whose token has expired', () => {
    const { context, wsClient } = contextFor(
      createClient(
        { user: user() },
        { auth: { userId: 'u', exp: nowSeconds() - 1 } },
      ),
    );

    expect(guard.canActivate(context)).toBe(false);
    expect(wsClient.emit).toHaveBeenCalledWith(
      ServerEvents.SESSION_TERMINATED,
      { reason: 'TOKEN_EXPIRED' },
    );
    expect(wsClient.disconnect).toHaveBeenCalledWith(true);
  });

  it('refuses a socket with a user but no session binding', () => {
    // e.g. a handshake.user set without going through the connection
    // middleware: it would have no revocation rooms and no expiry
    const { context, wsClient } = contextFor(createClient({ user: user() }));

    expect(guard.canActivate(context)).toBe(false);
    expect(wsClient.disconnect).toHaveBeenCalledWith(true);
  });

  it('refuses an unauthenticated socket, even with a token in the handshake', () => {
    const { context, wsClient } = contextFor(
      createClient({ auth: { token: 'Bearer some-token' } }),
    );

    expect(guard.canActivate(context)).toBe(false);
    expect(wsClient.disconnect).toHaveBeenCalledWith(true);
  });
});
