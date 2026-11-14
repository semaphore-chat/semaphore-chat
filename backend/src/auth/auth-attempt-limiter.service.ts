import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { DEFAULT_IPV6_SUBNET_PREFIX, normalizeIp } from '@nestjs/throttler';
import { REDIS_CLIENT } from '@/redis/redis.constants';

/**
 * Failed sign-ins for one username from one client before that client's
 * password sign-ins to it are refused. Other clients are not affected, so
 * nobody can lock someone else out of their account.
 */
export const LOGIN_FAILURE_LIMIT = 10;
/** How long those failures count (and the lock lasts), in seconds. */
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;
/** Password-reset emails to one address from one client per window. */
export const PASSWORD_RESET_EMAIL_LIMIT = 3;
/** Password-reset emails to one address from all clients per window. */
export const PASSWORD_RESET_EMAIL_CEILING = 10;
export const PASSWORD_RESET_EMAIL_WINDOW_SECONDS = 60 * 60;

/**
 * The client part of a limiter key: the address (req.ip, which honours
 * TRUST_PROXY), IPv6 masked to its /64 like the HTTP throttler and the
 * socket handshake limiter (a host rotates addresses inside its /64).
 */
export function clientRateKey(ip: string | null | undefined): string {
  if (!ip) return 'unknown';
  return normalizeIp(ip, DEFAULT_IPV6_SUBNET_PREFIX);
}

/** Key of the failed sign-ins for one username from one client. */
export function loginFailureKey(
  username: string,
  ip: string | null | undefined,
): string {
  return `login-fail:${username.toLocaleLowerCase()}:${clientRateKey(ip)}`;
}

/** Group (see recordAttempt) of every loginFailureKey of one username. */
export function loginFailureGroup(username: string): string {
  return `login-fail-keys:${username.toLocaleLowerCase()}`;
}

/**
 * Attempt counters in Redis (shared by every replica), next to the
 * per-address HTTP throttler. Fails open when Redis is down, like
 * FailOpenThrottlerStorage, and is off under NODE_ENV=test, like the
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

  /**
   * Count an attempt; the window starts at the first. Returns the count.
   * @param group - A set that remembers `key`, so clearGroup can clear every
   *   key of it (e.g. one account's counters from all clients). It lives as
   *   long as its newest key.
   */
  async recordAttempt(
    key: string,
    windowSeconds: number,
    group?: string,
  ): Promise<number> {
    if (!this.enabled) return 0;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, windowSeconds);
        if (group) {
          await this.redis.sadd(group, key);
          await this.redis.expire(group, windowSeconds);
        }
      }
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

  /** Clear every key recorded in `group`, and the group. */
  async clearGroup(group: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const keys = await this.redis.smembers(group);
      await this.redis.del(...keys, group);
    } catch (error) {
      this.logger.warn(`Attempt count reset failed: ${String(error)}`);
    }
  }
}
