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

  function refreshToken(
    sub: string,
    secret = refreshSecret,
    jti = `jti-${Math.random()}`,
  ): string {
    return jwt.sign({ sub, jti }, { secret });
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

    it('keys a validly signed refresh cookie by its token id, not the IP or user', async () => {
      await expect(
        tracker({
          ip: '203.0.113.1',
          cookies: {
            refresh_token: refreshToken('user-1', refreshSecret, 'jti-a'),
          },
        }),
      ).resolves.toBe('refresh-jti:jti-a');
    });

    it("keys an Electron client's body token by its token id", async () => {
      await expect(
        tracker({
          ip: '203.0.113.1',
          headers: { 'user-agent': 'Electron/25.0.0' },
          body: {
            refreshToken: refreshToken('user-2', refreshSecret, 'jti-b'),
          },
        }),
      ).resolves.toBe('refresh-jti:jti-b');
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
      [
        'an expired token',
        {
          cookies: {
            refresh_token: jwt.sign(
              { sub: 'user-1', jti: 'jti-x', exp: 1 },
              { secret: refreshSecret },
            ),
          },
        },
      ],
      [
        'a signed token without a token id',
        {
          cookies: {
            refresh_token: jwt.sign(
              { sub: 'user-1' },
              { secret: refreshSecret },
            ),
          },
        },
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

    it('lets ten restored tabs sharing one cookie refresh at once', async () => {
      const cookie = refreshToken('user-1');
      for (let i = 0; i < 10; i++) {
        await expect(
          guard.canActivate(
            createContext({
              ip: '203.0.113.1',
              cookies: { refresh_token: cookie },
            }),
          ),
        ).resolves.toBe(true);
      }
    });

    it('stops one token past the per-second limit', async () => {
      const cookie = refreshToken('user-1');
      const context = () =>
        createContext({
          ip: '203.0.113.1',
          cookies: { refresh_token: cookie },
        });
      for (let i = 0; i < 10; i++) {
        await guard.canActivate(context());
      }

      await expect(guard.canActivate(context())).rejects.toThrow(
        ThrottlerException,
      );
    });

    it("doesn't let a stolen token lock its user's live session out", async () => {
      // A thief replays the victim's logged-out (or rotated, revoked) token,
      // which is still validly signed, from another IP until throttled...
      const stolen = createContext({
        ip: '198.51.100.7',
        cookies: {
          refresh_token: refreshToken('victim', refreshSecret, 'old'),
        },
      });
      for (let i = 0; i < 60; i++) {
        await guard.canActivate(stolen).catch(() => undefined);
      }
      await expect(guard.canActivate(stolen)).rejects.toThrow(
        ThrottlerException,
      );

      // ...which throttles only that token: the victim's live session
      // (another token of the same user) still refreshes
      await expect(
        guard.canActivate(
          createContext({
            ip: '203.0.113.1',
            cookies: {
              refresh_token: refreshToken('victim', refreshSecret, 'live'),
            },
          }),
        ),
      ).resolves.toBe(true);
    });

    it('keeps throttling a client without a valid token by its IP', async () => {
      const garbage = () =>
        createContext({
          ip: '198.51.100.7',
          cookies: { refresh_token: 'garbage.x.y' },
        });
      for (let i = 0; i < 10; i++) {
        await guard.canActivate(garbage());
      }
      await expect(guard.canActivate(garbage())).rejects.toThrow(
        ThrottlerException,
      );

      // Other addresses are unaffected
      await expect(
        guard.canActivate(
          createContext({
            ip: '203.0.113.1',
            cookies: { refresh_token: 'garbage.x.y' },
          }),
        ),
      ).resolves.toBe(true);
    });

    it('is skipped in tests', async () => {
      process.env.NODE_ENV = 'test';

      await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
      expect(storage.increment).not.toHaveBeenCalled();
    });
  });
});
