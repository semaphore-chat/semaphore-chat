import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '@/user/user.service';
import { TokenBlacklistService } from '@/auth/token-blacklist.service';
import { UserFactory } from '@/test-utils';
import { UserEntity } from '@/user/dto/user-response.dto';
import { Socket, Server } from 'socket.io';

describe('RoomsGateway', () => {
  let gateway: RoomsGateway;
  let roomsService: Mocked<RoomsService>;
  let websocketService: Mocked<WebsocketService>;
  let jwtService: Mocked<JwtService>;
  let userService: Mocked<UserService>;
  let tokenBlacklistService: Mocked<TokenBlacklistService>;

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
    jwtService = unitRef.get(JwtService);
    userService = unitRef.get(UserService);
    tokenBlacklistService = unitRef.get(TokenBlacklistService);
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

    beforeEach(() => {
      const mockServer = { use: jest.fn() } as unknown as Server;
      gateway.afterInit(mockServer);
      // Second middleware registered is the auth middleware
      authMiddleware = (mockServer.use as jest.Mock).mock.calls[1][0];
    });

    it('should authenticate with valid token from auth.token', async () => {
      const user = UserFactory.build();
      const socket = {
        handshake: {
          auth: { token: 'valid-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest.spyOn(jwtService, 'verify').mockReturnValue({ sub: user.id });
      jest.spyOn(userService, 'findById').mockResolvedValue(user);
      tokenBlacklistService.isBlacklisted.mockResolvedValue(false);

      authMiddleware(socket, next);
      await flushPromises();

      expect(next).toHaveBeenCalledWith();
      expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
      expect((socket.handshake as any).user).toBeInstanceOf(UserEntity);
      expect((socket.handshake as any).user.id).toBe(user.id);
    });

    it('should strip Bearer prefix from token', async () => {
      const user = UserFactory.build();
      const socket = {
        handshake: {
          auth: { token: 'Bearer my-jwt-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest.spyOn(jwtService, 'verify').mockReturnValue({ sub: user.id });
      jest.spyOn(userService, 'findById').mockResolvedValue(user);
      tokenBlacklistService.isBlacklisted.mockResolvedValue(false);

      authMiddleware(socket, next);
      await flushPromises();

      expect(jwtService.verify).toHaveBeenCalledWith('my-jwt-token');
      expect(next).toHaveBeenCalledWith();
    });

    it('should fall back to authorization header', async () => {
      const user = UserFactory.build();
      const socket = {
        handshake: {
          auth: {},
          headers: { authorization: 'header-token' },
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest.spyOn(jwtService, 'verify').mockReturnValue({ sub: user.id });
      jest.spyOn(userService, 'findById').mockResolvedValue(user);
      tokenBlacklistService.isBlacklisted.mockResolvedValue(false);

      authMiddleware(socket, next);
      await flushPromises();

      expect(jwtService.verify).toHaveBeenCalledWith('header-token');
      expect(next).toHaveBeenCalledWith();
    });

    it('should reject when no token is provided', () => {
      const socket = {
        handshake: {
          auth: {},
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('AUTH_FAILED');
    });

    it('should reject when JWT verification fails', () => {
      const socket = {
        handshake: {
          auth: { token: 'invalid-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest.spyOn(jwtService, 'verify').mockImplementation(() => {
        throw new Error('Invalid token');
      });

      authMiddleware(socket, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('AUTH_FAILED');
    });

    it('should reject when user is not found in database', async () => {
      const socket = {
        handshake: {
          auth: { token: 'valid-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest
        .spyOn(jwtService, 'verify')
        .mockReturnValue({ sub: 'deleted-user-id' });
      jest.spyOn(userService, 'findById').mockResolvedValue(null);
      tokenBlacklistService.isBlacklisted.mockResolvedValue(false);

      authMiddleware(socket, next);
      await flushPromises();

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('AUTH_FAILED');
    });

    it('should reject when user is banned', async () => {
      const bannedUser = UserFactory.build({ banned: true });
      const socket = {
        handshake: {
          auth: { token: 'valid-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest
        .spyOn(jwtService, 'verify')
        .mockReturnValue({ sub: bannedUser.id });
      jest.spyOn(userService, 'findById').mockResolvedValue(bannedUser);
      tokenBlacklistService.isBlacklisted.mockResolvedValue(false);

      authMiddleware(socket, next);
      await flushPromises();

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('AUTH_FAILED');
    });

    it('should reject when token jti is blacklisted', async () => {
      const user = UserFactory.build();
      const socket = {
        handshake: {
          auth: { token: 'valid-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest
        .spyOn(jwtService, 'verify')
        .mockReturnValue({ sub: user.id, jti: 'blacklisted-jti' });
      tokenBlacklistService.isBlacklisted.mockResolvedValue(true);

      authMiddleware(socket, next);
      await flushPromises();

      expect(tokenBlacklistService.isBlacklisted).toHaveBeenCalledWith(
        'blacklisted-jti',
      );
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect((next.mock.calls[0][0] as Error).message).toBe('AUTH_FAILED');
      expect(userService.findById).not.toHaveBeenCalled();
    });

    it('should skip blacklist check when token has no jti', async () => {
      const user = UserFactory.build();
      const socket = {
        handshake: {
          auth: { token: 'valid-token' },
          headers: {},
          address: '127.0.0.1',
        },
      };
      const next = jest.fn();

      jest.spyOn(jwtService, 'verify').mockReturnValue({ sub: user.id });
      jest.spyOn(userService, 'findById').mockResolvedValue(user);

      authMiddleware(socket, next);
      await flushPromises();

      expect(tokenBlacklistService.isBlacklisted).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });
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
});
