import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ThrottlerException,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { RefreshThrottlerGuard } from './refresh-throttler.guard';

describe('RefreshThrottlerGuard', () => {
  const refreshSecret = 'test-refresh-secret';
  const jwt = new JwtService({});
  const originalEnv = process.env.NODE_ENV;
  let guard: RefreshThrottlerGuard;
  let storage: jest.Mocked<ThrottlerStorage>;

  /** Counts hits per key and blocks past the limit, like the real storage. */
  function createFakeStorage(): jest.Mocked<ThrottlerStorage> {
    const counts = new Map<string, number>();
    const increment = jest.fn((key: string, ttl: number, limit: number) => {
      const totalHits = (counts.get(key) ?? 0) + 1;
      counts.set(key, totalHits);
      const isBlocked = totalHits > limit;
      return {
        totalHits,
        timeToExpire: ttl,
        isBlocked,
        timeToBlockExpire: isBlocked ? ttl : 0,
      };
    });
    return { increment } as unknown as jest.Mocked<ThrottlerStorage>;
  }

  function refreshToken(sub: string, secret = refreshSecret): string {
    return jwt.sign({ sub, jti: `jti-${Math.random()}` }, { secret });
  }

  function createContext(req: Record<string, unknown>): ExecutionContext {
    const res = { header: jest.fn() };
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, cookies: {}, ...req }),
        getResponse: () => res,
      }),
      getClass: () => ({ name: 'AuthController' }),
      getHandler: () => ({ name: 'refresh' }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    storage = createFakeStorage();
    const options: ThrottlerModuleOptions = { throttlers: [] };
    guard = new RefreshThrottlerGuard(options, storage, new Reflector(), jwt, {
      get: (key: string) =>
        key === 'JWT_REFRESH_SECRET' ? refreshSecret : undefined,
    } as unknown as ConfigService);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('getTracker', () => {
    const tracker = (req: Record<string, unknown>) =>
      (
        guard as unknown as {
          getTracker(r: Record<string, unknown>): Promise<string>;
        }
      ).getTracker({ headers: {}, cookies: {}, ...req });

    it('keys a validly signed refresh cookie by its user, not the IP', async () => {
      await expect(
        tracker({
          ip: '203.0.113.1',
          cookies: { refresh_token: refreshToken('user-1') },
        }),
      ).resolves.toBe('refresh-user:user-1');
    });

    it("keys an Electron client's body token by its user", async () => {
      await expect(
        tracker({
          ip: '203.0.113.1',
          headers: { 'user-agent': 'Electron/25.0.0' },
          body: { refreshToken: refreshToken('user-2') },
        }),
      ).resolves.toBe('refresh-user:user-2');
    });

    it.each([
      ['no token', {}],
      [
        'a token signed with another secret (e.g. an access token)',
        { cookies: { refresh_token: refreshToken('user-1', 'other-secret') } },
      ],
      ['garbage', { cookies: { refresh_token: 'not-a-jwt' } }],
      [
        'a body token from a browser (only Electron sends one)',
        { body: { refreshToken: refreshToken('user-1') } },
      ],
    ])('keys a request with %s by its IP', async (_, req) => {
      await expect(tracker({ ip: '203.0.113.1', ...req })).resolves.toBe(
        'refresh-ip:203.0.113.1',
      );
    });
  });

  describe('limits', () => {
    it('lets one NAT address refresh for many users', async () => {
      // 30 users behind one address, each loading a page: well past the old
      // 10 per minute per IP
      for (let i = 0; i < 30; i++) {
        await expect(
          guard.canActivate(
            createContext({
              ip: '203.0.113.1',
              cookies: { refresh_token: refreshToken(`user-${i}`) },
            }),
          ),
        ).resolves.toBe(true);
      }
    });

    it('lets one user refresh ten restored tabs at once', async () => {
      for (let i = 0; i < 10; i++) {
        await expect(
          guard.canActivate(
            createContext({
              ip: '203.0.113.1',
              cookies: { refresh_token: refreshToken('user-1') },
            }),
          ),
        ).resolves.toBe(true);
      }
    });

    it('stops one user past the per-second limit', async () => {
      const context = () =>
        createContext({
          ip: '203.0.113.1',
          cookies: { refresh_token: refreshToken('user-1') },
        });
      for (let i = 0; i < 10; i++) {
        await guard.canActivate(context());
      }

      await expect(guard.canActivate(context())).rejects.toThrow(
        ThrottlerException,
      );
    });

    it('is skipped in tests', async () => {
      process.env.NODE_ENV = 'test';

      await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
      expect(storage.increment).not.toHaveBeenCalled();
    });
  });
});
