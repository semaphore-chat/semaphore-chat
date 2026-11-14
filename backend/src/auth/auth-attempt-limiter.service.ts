import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@/redis/redis.constants';

/** Failed sign-ins for one username before password sign-in is refused. */
export const LOGIN_FAILURE_LIMIT = 10;
/** How long those failures count (and the lock lasts), in seconds. */
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
/** Password-reset emails to one address per window; more are dropped. */
export const PASSWORD_RESET_EMAIL_LIMIT = 3;
export const PASSWORD_RESET_EMAIL_WINDOW_SECONDS = 60 * 60;

/**
 * Per-account counters in Redis (shared by every replica), next to the
 * per-address HTTP throttler: an attacker rotating addresses (an IPv6 range,
 * a botnet) still spends one account's budget. Fails open when Redis is down,
 * like FailOpenThrottlerStorage, and is off under NODE_ENV=test, like the
 * throttlers.
 */
@Injectable()
export class AuthAttemptLimiter {
  private readonly logger = new Logger(AuthAttemptLimiter.name);
  private readonly enabled: boolean;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<string>('NODE_ENV') !== 'test';
  }

  /** Whether `key` has reached `limit` attempts in its current window. */
  async isLimited(key: string, limit: number): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      return Number((await this.redis.get(key)) ?? 0) >= limit;
    } catch (error) {
      this.logger.warn(`Attempt limit check failed open: ${String(error)}`);
      return false;
    }
  }

  /** Count an attempt; the window starts at the first. Returns the count. */
  async recordAttempt(key: string, windowSeconds: number): Promise<number> {
    if (!this.enabled) return 0;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
      return count;
    } catch (error) {
      this.logger.warn(`Attempt count failed open: ${String(error)}`);
      return 0;
    }
  }

  async clear(key: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`Attempt count reset failed: ${String(error)}`);
    }
  }
}
