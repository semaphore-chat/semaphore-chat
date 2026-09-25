import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { WsAuthError, WsAuthService } from '@/auth/ws-auth.service';
import { SocketSessionService } from './socket-session.service';
import { UserFactory } from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';
import { Socket, Server } from 'socket.io';

describe('RoomsGateway', () => {
  let gateway: RoomsGateway;
  let roomsService: Mocked<RoomsService>;
  let websocketService: Mocked<WebsocketService>;
  let wsAuthService: Mocked<WsAuthService>;
  let socketSessionService: Mocked<SocketSessionService>;

  const mockUser = UserFactory.build();

  const createMockSocket = (
    user = mockUser,
  ): Socket & { handshake: { user: typeof mockUser } } => {
    return {
      id: 'socket-123',
      handshake: {
        user,
      },
    } as Socket & { handshake: { user: typeof mockUser } };
  };

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(RoomsGateway).compile();

    gateway = unit;
    roomsService = unitRef.get(RoomsService);
    websocketService = unitRef.get(WebsocketService);
    wsAuthService = unitRef.get(WsAuthService);
    socketSessionService = unitRef.get(SocketSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('afterInit', () => {
    it('should set server on websocket service', () => {
      const mockServer = { use: jest.fn() } as unknown as Server;

      gateway.afterInit(mockServer);

      expect(websocketService.setServer).toHaveBeenCalledWith(mockServer);
    });

    it('should register two middlewares on the server', () => {
      const mockServer = { use: jest.fn() } as unknown as Server;

      gateway.afterInit(mockServer);

      // Rate-limiter + auth middleware
      expect(mockServer.use).toHaveBeenCalledTimes(2);
    });
  });

  describe('connection auth middleware', () => {
    let authMiddleware: (socket: any, next: jest.Mock) => void;
    const flushPromises = () =>
      new Promise<void>((resolve) => setImmediate(resolve));

    const authResult = () => {
      const user = UserFactory.build();
      return {
        user: new UserEntity(user),
        claims: {
          sub: user.id,
          jti: 'jti-1',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      };
    };

    beforeEach(() => {
      const mockServer = { use: jest.fn() } as unknown as Server;
      gateway.afterInit(mockServer);
      // Second middleware registered is the auth middleware
      authMiddleware = (mockServer.use as jest.Mock).mock.calls[1][0];
    });

    it('authenticates the auth.token and binds the socket to it', async () => {
      const auth = authResult();
      wsAuthService.authenticate.mockResolvedValue(auth);
      const socket = {
        handshake: {
          auth: { token: 'valid-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      authMiddleware(socket, next);
      await flushPromises();

      expect(wsAuthService.authenticate).toHaveBeenCalledWith('valid-token');
      expect(socketSessionService.attach).toHaveBeenCalledWith(socket, auth);
      expect(next).toHaveBeenCalledWith();
    });

    it('strips the Bearer prefix from the token', async () => {
      wsAuthService.authenticate.mockResolvedValue(authResult());
      const socket = {
        handshake: {
          auth: { token: 'Bearer my-jwt-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      authMiddleware(socket, next);
      await flushPromises();

      expect(wsAuthService.authenticate).toHaveBeenCalledWith('my-jwt-token');
      expect(next).toHaveBeenCalledWith();
    });

    it('falls back to the authorization header', async () => {
      wsAuthService.authenticate.mockResolvedValue(authResult());
      const socket = {
        handshake: {
          auth: {},
          headers: { authorization: 'header-token' },
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      authMiddleware(socket, next);
      await flushPromises();

      expect(wsAuthService.authenticate).toHaveBeenCalledWith('header-token');
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects when no token is provided', () => {
      const socket = {
        handshake: { auth: {}, headers: {}, address: '127.0.0.1' },
      };
      const next = jest.fn();

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('AUTH_FAILED');
      expect(wsAuthService.authenticate).not.toHaveBeenCalled();
    });

    it.each([
      'INVALID_TOKEN',
      'TOKEN_REVOKED',
      'USER_NOT_FOUND',
      'USER_BANNED',
    ] as const)(
      'rejects with AUTH_FAILED when authentication fails (%s)',
      async (code) => {
        wsAuthService.authenticate.mockRejectedValue(new WsAuthError(code));
        const socket = {
          handshake: {
            auth: { token: 'token' },
            headers: {},
            address: '127.0.0.1',
          },
        };
        const next = jest.fn();

        authMiddleware(socket, next);
        await flushPromises();

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect((next.mock.calls[0][0] as Error).message).toBe('AUTH_FAILED');
        expect(socketSessionService.attach).not.toHaveBeenCalled();
      },
    );
  });

  describe('rate limiter middleware', () => {
    let rateLimitMiddleware: (socket: any, next: jest.Mock) => void;

    beforeEach(() => {
      const mockServer = { use: jest.fn() } as unknown as Server;
      gateway.afterInit(mockServer);
      // First middleware registered is the rate limiter
      rateLimitMiddleware = (mockServer.use as jest.Mock).mock.calls[0][0];
    });

    it('should allow connections under the limit', () => {
      const socket = {
        handshake: { address: '10.0.0.1' },
      };

      for (let i = 0; i < RoomsGateway.RATE_LIMIT_MAX; i++) {
        const next = jest.fn();
        rateLimitMiddleware(socket, next);
        expect(next).toHaveBeenCalledWith();
      }
    });

    it('should reject connections over the limit', () => {
      const socket = {
        handshake: { address: '10.0.0.2' },
      };

      // Fill up to the limit
      for (let i = 0; i < RoomsGateway.RATE_LIMIT_MAX; i++) {
        const next = jest.fn();
        rateLimitMiddleware(socket, next);
        expect(next).toHaveBeenCalledWith();
      }

      // Next connection should be rejected
      const next = jest.fn();
      rateLimitMiddleware(socket, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('RATE_LIMITED');
    });

    it('should reset after the time window expires', () => {
      const socket = {
        handshake: { address: '10.0.0.3' },
      };

      // Fill up to the limit
      for (let i = 0; i < RoomsGateway.RATE_LIMIT_MAX; i++) {
        const next = jest.fn();
        rateLimitMiddleware(socket, next);
      }

      // Advance time past the window
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + RoomsGateway.RATE_LIMIT_WINDOW_MS + 1);

      const next = jest.fn();
      rateLimitMiddleware(socket, next);
      expect(next).toHaveBeenCalledWith();

      jest.restoreAllMocks();
    });

    it('should track different IPs independently', () => {
      const socket1 = { handshake: { address: '10.0.0.4' } };
      const socket2 = { handshake: { address: '10.0.0.5' } };

      // Fill up IP 1
      for (let i = 0; i < RoomsGateway.RATE_LIMIT_MAX; i++) {
        const next = jest.fn();
        rateLimitMiddleware(socket1, next);
      }

      // IP 1 is now rate limited
      const next1 = jest.fn();
      rateLimitMiddleware(socket1, next1);
      expect(next1).toHaveBeenCalledWith(expect.any(Error));

      // IP 2 should still be allowed
      const next2 = jest.fn();
      rateLimitMiddleware(socket2, next2);
      expect(next2).toHaveBeenCalledWith();
    });
  });

  describe('handleDisconnect', () => {
    it('should not emit any presence events (handled by PresenceGateway)', () => {
      const client = createMockSocket();

      gateway.handleDisconnect(client);

      expect(websocketService.sendToAll).not.toHaveBeenCalled();
    });

    it('should handle disconnect for unauthenticated sockets without error', () => {
      const client = {
        id: 'socket-unauthenticated',
        handshake: {},
      } as Socket;

      expect(() => gateway.handleDisconnect(client)).not.toThrow();
      expect(websocketService.sendToAll).not.toHaveBeenCalled();
    });
  });

  describe('subscribeAll', () => {
    it('should call joinAllUserRooms on the service', async () => {
      const client = createMockSocket();

      roomsService.joinAllUserRooms.mockResolvedValue(undefined);

      await gateway.subscribeAll(client);

      expect(roomsService.joinAllUserRooms).toHaveBeenCalledWith(client);
    });
  });

  describe('reauthenticate', () => {
    it('re-authenticates the socket with the new token', async () => {
      const client = createMockSocket();
      const expiresAt = new Date().toISOString();
      socketSessionService.reauthenticate.mockResolvedValue({
        ok: true,
        expiresAt,
      });

      await expect(
        gateway.reauthenticate(client, { token: 'Bearer new-token' }),
      ).resolves.toEqual({ ok: true, expiresAt });
      expect(socketSessionService.reauthenticate).toHaveBeenCalledWith(
        client,
        'new-token',
      );
    });

    it('fails without a token', async () => {
      const client = createMockSocket();

      await expect(
        gateway.reauthenticate(client, { token: 'Bearer ' }),
      ).resolves.toEqual({ ok: false, error: 'AUTH_FAILED' });
      expect(socketSessionService.reauthenticate).not.toHaveBeenCalled();
    });
  });
});
