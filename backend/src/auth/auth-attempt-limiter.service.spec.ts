import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { AuthAttemptLimiter } from './auth-attempt-limiter.service';

/** In-memory stand-in for the few Redis commands the limiter uses. */
export function createFakeRedis() {
  const values = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    values,
    ttls,
    get: jest.fn((key: string) =>
      Promise.resolve(values.has(key) ? String(values.get(key)) : null),
    ),
    incr: jest.fn((key: string) => {
      const next = (values.get(key) ?? 0) + 1;
      values.set(key, next);
      return Promise.resolve(next);
    }),
    expire: jest.fn((key: string, seconds: number) => {
      ttls.set(key, seconds);
      return Promise.resolve(1);
    }),
    del: jest.fn((key: string) => {
      values.delete(key);
      ttls.delete(key);
      return Promise.resolve(1);
    }),
  };
}

const config = (nodeEnv: string) =>
  ({ get: jest.fn(() => nodeEnv) }) as unknown as ConfigService;

describe('AuthAttemptLimiter', () => {
  let redis: ReturnType<typeof createFakeRedis>;
  let limiter: AuthAttemptLimiter;

  beforeEach(() => {
    redis = createFakeRedis();
    limiter = new AuthAttemptLimiter(
      redis as unknown as Redis,
      config('production'),
    );
  });

  it('counts attempts and sets the window on the first one only', async () => {
    expect(await limiter.recordAttempt('k', 900)).toBe(1);
    expect(await limiter.recordAttempt('k', 900)).toBe(2);
    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis.ttls.get('k')).toBe(900);
  });

  it('is limited once the count reaches the limit', async () => {
    for (let i = 0; i < 2; i++) await limiter.recordAttempt('k', 900);
    expect(await limiter.isLimited('k', 3)).toBe(false);
    await limiter.recordAttempt('k', 900);
    expect(await limiter.isLimited('k', 3)).toBe(true);
  });

  it('clears a key', async () => {
    await limiter.recordAttempt('k', 900);
    await limiter.clear('k');
    expect(await limiter.isLimited('k', 1)).toBe(false);
  });

  it('fails open when Redis is down', async () => {
    redis.get.mockRejectedValue(new Error('down'));
    redis.incr.mockRejectedValue(new Error('down'));
    redis.del.mockRejectedValue(new Error('down'));
    expect(await limiter.isLimited('k', 1)).toBe(false);
    expect(await limiter.recordAttempt('k', 900)).toBe(0);
    await expect(limiter.clear('k')).resolves.toBeUndefined();
  });

  it('does nothing under NODE_ENV=test (like the throttlers)', async () => {
    const off = new AuthAttemptLimiter(
      redis as unknown as Redis,
      config('test'),
    );
    expect(await off.recordAttempt('k', 900)).toBe(0);
    expect(await off.isLimited('k', 0)).toBe(false);
    expect(redis.incr).not.toHaveBeenCalled();
  });
});
