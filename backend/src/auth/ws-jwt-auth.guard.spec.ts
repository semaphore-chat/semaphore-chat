import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { ServerEvents } from '@semaphore-chat/shared';
import { WsJwtAuthGuard } from './ws-jwt-auth.guard';
import { WsAuthError, WsAuthService } from './ws-auth.service';
import {
  UserFactory,
  createMockHttpExecutionContext,
  createMockWsExecutionContext,
} from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';

describe('WsJwtAuthGuard', () => {
  let guard: WsJwtAuthGuard;
  let wsAuthService: Mocked<WsAuthService>;

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  const createClient = (handshake: Record<string, unknown>, data = {}) => ({
    id: 'socket-123',
    handshake: { headers: {}, ...handshake },
    data,
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  const authResult = (user = UserFactory.build()) => ({
    user: new UserEntity(user),
    claims: { sub: user.id, jti: 'jti-1', exp: nowSeconds() + 3600 },
  });

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(WsJwtAuthGuard).compile();

    guard = unit;
    wsAuthService = unitRef.get(WsAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('non-WebSocket contexts', () => {
    it('allows HTTP contexts', async () => {
      const context = createMockHttpExecutionContext({});

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(wsAuthService.authenticate).not.toHaveBeenCalled();
    });

    it('allows other context types', async () => {
      const context = { getType: jest.fn().mockReturnValue('rpc') } as any;

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('socket authenticated by the connection middleware', () => {
    it('allows a socket whose token is still valid, without re-checking it', async () => {
      const client = createClient(
        { user: new UserEntity(UserFactory.build()) },
        { auth: { userId: 'u', exp: nowSeconds() + 60 } },
      );
      const context = createMockWsExecutionContext({ client });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(wsAuthService.authenticate).not.toHaveBeenCalled();
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('ends the session of a socket whose token has expired', async () => {
      const client = createClient(
        { user: new UserEntity(UserFactory.build()) },
        { auth: { userId: 'u', exp: nowSeconds() - 1 } },
      );
      const context = createMockWsExecutionContext({ client });
      const wsClient = context.switchToWs().getClient();

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(wsClient.emit).toHaveBeenCalledWith(
        ServerEvents.SESSION_TERMINATED,
        { reason: 'TOKEN_EXPIRED' },
      );
      expect(wsClient.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('fallback authentication from the handshake', () => {
    it('authenticates the auth.token and attaches the user', async () => {
      const result = authResult();
      wsAuthService.authenticate.mockResolvedValue(result);
      const client = createClient({ auth: { token: 'Bearer valid-token' } });
      const context = createMockWsExecutionContext({ client });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(wsAuthService.authenticate).toHaveBeenCalledWith('valid-token');
      expect((client.handshake as any).user).toBe(result.user);
    });

    it('falls back to the authorization header', async () => {
      wsAuthService.authenticate.mockResolvedValue(authResult());
      const client = createClient({
        auth: {},
        headers: { authorization: 'Bearer header-token' },
      });
      const context = createMockWsExecutionContext({ client });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(wsAuthService.authenticate).toHaveBeenCalledWith('header-token');
    });

    it('disconnects when no token is provided', async () => {
      const client = createClient({ auth: {} });
      const context = createMockWsExecutionContext({ client });

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(wsAuthService.authenticate).not.toHaveBeenCalled();
    });

    it.each([
      'INVALID_TOKEN',
      'TOKEN_REVOKED',
      'USER_NOT_FOUND',
      'USER_BANNED',
    ] as const)('disconnects when authentication fails (%s)', async (code) => {
      wsAuthService.authenticate.mockRejectedValue(new WsAuthError(code));
      const client = createClient({ auth: { token: 'token' } });
      const context = createMockWsExecutionContext({ client });

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect((client.handshake as any).user).toBeUndefined();
    });

    it('disconnects when authentication throws unexpectedly', async () => {
      wsAuthService.authenticate.mockRejectedValue(new Error('DB down'));
      const client = createClient({ auth: { token: 'token' } });
      const context = createMockWsExecutionContext({ client });

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });
});
