import { TestBed } from '@suites/unit';
import type { Mocked } from '@suites/doubles.jest';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import {
  createMockHttpExecutionContext,
  createMockWsExecutionContext,
} from '@/test-utils';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Mocked<Reflector>;

  beforeEach(async () => {
    const { unit, unitRef } = await TestBed.solitary(JwtAuthGuard).compile();

    guard = unit;
    reflector = unitRef.get(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Public routes', () => {
    it('should allow access to public routes', async () => {
      const context = createMockHttpExecutionContext({});

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('should allow access when @Public decorator is on handler', async () => {
      const context = createMockHttpExecutionContext({});

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow access when @Public decorator is on class', async () => {
      const context = createMockHttpExecutionContext({});

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });

  describe('HTTP context - getRequest', () => {
    it('should return HTTP request for HTTP context', () => {
      const context = createMockHttpExecutionContext({
        headers: { authorization: 'Bearer token123' },
      });

      const result = guard.getRequest(context) as { headers?: unknown };

      expect(result.headers).toEqual({ authorization: 'Bearer token123' });
    });

    it('should handle HTTP requests with no authorization header', () => {
      const context = createMockHttpExecutionContext({ headers: {} });

      const result = guard.getRequest(context) as { headers?: unknown };

      expect(result.headers).toEqual({});
    });
  });

  describe('WebSocket context - getRequest', () => {
    it('should extract token from authorization header', () => {
      const mockClient = {
        id: 'socket-123',
        handshake: {
          headers: { authorization: 'Bearer ws-token-123' },
          query: {},
        },
      };
      const context = createMockWsExecutionContext({ client: mockClient });

      const result = guard.getRequest(context) as {
        headers?: { authorization?: string };
      };

      expect(result).toBe(mockClient.handshake);
      expect(result.headers?.authorization).toBe('Bearer ws-token-123');
    });

    it('should extract token from query parameter', () => {
      const mockClient = {
        id: 'socket-456',
        handshake: {
          headers: {},
          query: { token: 'query-token-456' },
        },
      };
      const context = createMockWsExecutionContext({ client: mockClient });

      const result = guard.getRequest(context) as {
        headers?: { authorization?: string };
      };

      expect(result).toBe(mockClient.handshake);
      expect(result.headers?.authorization).toBe('Bearer query-token-456');
    });

    it('should prioritize authorization header over query token', () => {
      const mockClient = {
        id: 'socket-789',
        handshake: {
          headers: { authorization: 'Bearer header-token' },
          query: { token: 'query-token' },
        },
      };
      const context = createMockWsExecutionContext({ client: mockClient });

      const result = guard.getRequest(context) as {
        headers?: { authorization?: string };
      };

      expect(result.headers?.authorization).toBe('Bearer header-token');
    });

    it('should return handshake when no token provided', () => {
      const mockClient = {
        id: 'socket-notok',
        handshake: {
          headers: {},
          query: {},
        },
      };
      const context = createMockWsExecutionContext({ client: mockClient });

      const result = guard.getRequest(context);

      expect(result).toBe(mockClient.handshake);
    });

    it('should handle malformed authorization header', () => {
      const mockClient = {
        id: 'socket-malformed',
        handshake: {
          headers: { authorization: 'InvalidFormat token123' },
          query: {},
        },
      };
      const context = createMockWsExecutionContext({ client: mockClient });

      const result = guard.getRequest(context);

      expect(result).toBe(mockClient.handshake);
    });

    it('should handle non-string authorization header', () => {
      const mockClient = {
        id: 'socket-invalid',
        handshake: {
          headers: { authorization: 12345 as any },
          query: {},
        },
      };
      const context = createMockWsExecutionContext({ client: mockClient });

      const result = guard.getRequest(context);

      expect(result).toBe(mockClient.handshake);
    });

    it('should handle non-string query token', () => {
      const mockClient = {
        id: 'socket-invalid-query',
        handshake: {
          headers: {},
          query: { token: 12345 as any },
        },
      };
      const context = createMockWsExecutionContext({ client: mockClient });

      const result = guard.getRequest(context);

      expect(result).toBe(mockClient.handshake);
    });
  });

  describe('Edge cases', () => {
    it('should return empty object for unknown context type', () => {
      const mockContext = {
        getType: jest.fn().mockReturnValue('rpc'),
        getHandler: jest.fn(),
        getClass: jest.fn(),
        switchToHttp: jest.fn(),
        switchToWs: jest.fn(),
      } as any;

      const result = guard.getRequest(mockContext);

      expect(result).toEqual({});
    });

    it('should handle WebSocket client without handshake', () => {
      const mockClient = {
        id: 'socket-no-handshake',
      };
      const context = createMockWsExecutionContext({
        client: mockClient as any,
      });

      const result = guard.getRequest(context);

      expect(result).toEqual({});
    });

    it('should handle WebSocket client with non-object handshake', () => {
      const mockClient = {
        id: 'socket-invalid-handshake',
        handshake: 'not-an-object',
      };
      const context = createMockWsExecutionContext({
        client: mockClient as any,
      });

      const result = guard.getRequest(context);

      expect(result).toEqual({});
    });

    it('should handle null client', () => {
      const context = {
        getType: jest.fn().mockReturnValue('ws'),
        switchToWs: jest.fn().mockReturnValue({
          getClient: jest.fn().mockReturnValue(null),
        }),
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as any;

      const result = guard.getRequest(context);

      expect(result).toEqual({});
    });
  });

  describe('canActivate integration', () => {
    it('should bypass authentication for public routes', async () => {
      const context = createMockHttpExecutionContext({});
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should call parent canActivate for protected routes', async () => {
      const context = createMockHttpExecutionContext({});
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // Mock the parent's canActivate to return true
      const superCanActivate = jest.spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype),
        'canActivate',
      );
      superCanActivate.mockReturnValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).toHaveBeenCalledWith(context);

      superCanActivate.mockRestore();
    });
  });

  describe('WebSocket handlers (Nest 12 runs global guards there too)', () => {
    let superCanActivate: jest.SpyInstance;

    beforeEach(() => {
      superCanActivate = jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
        .mockReturnValue(false);
    });

    afterEach(() => {
      superCanActivate.mockRestore();
    });

    it('accepts sockets the connection middleware authenticated', async () => {
      const context = createMockWsExecutionContext({
        client: { id: 'socket-1', handshake: { user: { id: 'user-1' } } },
      });

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).not.toHaveBeenCalled();
    });

    it('falls back to Passport for sockets without an authenticated user', async () => {
      const context = createMockWsExecutionContext({
        client: { id: 'socket-1', handshake: { headers: {} } },
      });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const result = await guard.canActivate(context);

      expect(result).toBe(false);
      expect(superCanActivate).toHaveBeenCalledWith(context);
    });
  });
});
