import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { createFakeRedis } from '@/test-utils';
import {
  AuthAttemptLimiter,
  clientRateKey,
  loginFailureGroup,
  loginFailureKey,
} from './auth-attempt-limiter.service';

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

  it('clears every key of a group', async () => {
    await limiter.recordAttempt('a', 900, 'g');
    await limiter.recordAttempt('a', 900, 'g');
    await limiter.recordAttempt('b', 900, 'g');
    await limiter.recordAttempt('other', 900);
    expect(redis.ttls.get('g')).toBe(900);
    await limiter.clearGroup('g');
    expect(await limiter.isLimited('a', 1)).toBe(false);
    expect(await limiter.isLimited('b', 1)).toBe(false);
    expect(await limiter.isLimited('other', 1)).toBe(true);
    expect(redis.sets.has('g')).toBe(false);
  });

  describe('keys', () => {
    it('masks IPv6 clients to their /64 and keeps IPv4 addresses apart', () => {
      expect(clientRateKey('2001:db8:1:2::1')).toBe(
        clientRateKey('2001:db8:1:2:aaaa::9'),
      );
      expect(clientRateKey('2001:db8:1:2::1')).not.toBe(
        clientRateKey('2001:db8:1:3::1'),
      );
      expect(clientRateKey('203.0.113.7')).not.toBe(
        clientRateKey('203.0.113.8'),
      );
      expect(clientRateKey(undefined)).toBe('unknown');
    });

    it('keys sign-in failures on the lowercased username and the client', () => {
      expect(loginFailureKey('Owner', '203.0.113.7')).toBe(
        'login-fail:owner:203.0.113.7',
      );
      expect(loginFailureGroup('Owner')).toBe('login-fail-keys:owner');
    });
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
