import { Injectable, Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';

const ONLINE_USERS_SET = 'presence:online-users';
const USER_PRESENCE_KEY_PREFIX = 'presence:user:';
const USER_CONNECTIONS_KEY_PREFIX = 'presence:connections:';
const USER_IDLE_KEY_PREFIX = 'presence:idle:';
const DEFAULT_TTL_SECONDS = 60; // 1 minute, can be adjusted

@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Register a new connection for a user.
   * Returns true if this is the user's first connection (went from offline to online).
   */
  async addConnection(
    userId: string,
    connectionId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<boolean> {
    const connectionsKey = USER_CONNECTIONS_KEY_PREFIX + userId;

    // Add connection to user's connections set
    await this.redis.sadd(connectionsKey, connectionId);

    // Set TTL on the connections set
    await this.redis.expire(connectionsKey, ttlSeconds);

    // Get connection count
    const connectionCount = await this.redis.scard(connectionsKey);

    // If this is the first connection, mark user as online
    if (connectionCount === 1) {
      await this.redis.sadd(ONLINE_USERS_SET, userId);
      await this.redis.set(
        USER_PRESENCE_KEY_PREFIX + userId,
        '1',
        'EX',
        ttlSeconds,
      );
      return true; // User went from offline to online
    }

    // Refresh user presence TTL
    await this.redis.set(
      USER_PRESENCE_KEY_PREFIX + userId,
      '1',
      'EX',
      ttlSeconds,
    );
    return false; // User was already online
  }

  /**
   * Remove a connection for a user.
   * Returns true if this was the user's last connection (went from online to offline).
   */
  async removeConnection(
    userId: string,
    connectionId: string,
  ): Promise<boolean> {
    const connectionsKey = USER_CONNECTIONS_KEY_PREFIX + userId;
    const idleKey = USER_IDLE_KEY_PREFIX + userId;

    // Remove connection from user's connections set and idle hash
    await this.redis.srem(connectionsKey, connectionId);
    await this.redis.hdel(idleKey, connectionId);

    // Get remaining connection count
    const connectionCount = await this.redis.scard(connectionsKey);

    // If no connections remain, mark user as offline
    if (connectionCount === 0) {
      await this.redis.srem(ONLINE_USERS_SET, userId);
      await this.redis.del(USER_PRESENCE_KEY_PREFIX + userId);
      await this.redis.del(connectionsKey);
      await this.redis.del(idleKey);
      return true; // User went from online to offline
    }

    return false; // User still has other connections
  }

  /**
   * Refresh all connections for a user (extend TTL).
   */
  async refreshPresence(
    userId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const connectionsKey = USER_CONNECTIONS_KEY_PREFIX + userId;

    // Refresh TTL on connections set
    await this.redis.expire(connectionsKey, ttlSeconds);

    // Refresh user presence TTL
    await this.redis.set(
      USER_PRESENCE_KEY_PREFIX + userId,
      '1',
      'EX',
      ttlSeconds,
    );
  }

  /**
   * Mark a user as online and refresh their TTL.
   * @deprecated Use addConnection instead for proper multi-connection tracking
   */
  async setOnline(
    userId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    // Add to online set
    await this.redis.sadd(ONLINE_USERS_SET, userId);
    // Set/refresh TTL for user
    await this.redis.set(
      USER_PRESENCE_KEY_PREFIX + userId,
      '1',
      'EX',
      ttlSeconds,
    );
  }

  /**
   * Mark a user as offline immediately.
   * @deprecated Use removeConnection instead for proper multi-connection tracking
   */
  async setOffline(userId: string): Promise<void> {
    await this.redis.srem(ONLINE_USERS_SET, userId);
    await this.redis.del(USER_PRESENCE_KEY_PREFIX + userId);
    await this.redis.del(USER_CONNECTIONS_KEY_PREFIX + userId);
    await this.redis.del(USER_IDLE_KEY_PREFIX + userId);
  }

  /**
   * Set the idle state for a specific connection.
   * TTL matches the connections key so orphaned idle hashes expire automatically.
   */
  async setConnectionIdle(
    userId: string,
    connectionId: string,
    idle: boolean,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const idleKey = USER_IDLE_KEY_PREFIX + userId;
    if (idle) {
      await this.redis.hset(idleKey, connectionId, '1');
    } else {
      await this.redis.hdel(idleKey, connectionId);
    }
    // Refresh TTL to prevent orphaned idle hashes if cleanup cron doesn't fire
    await this.redis.expire(idleKey, ttlSeconds);
  }

  /**
   * Check if a user is actively using the app (online + at least one non-idle connection).
   * Used to decide whether to suppress push notifications.
   *
   * Note: There is a small TOCTOU window between smembers and hmget where a connection
   * could be added/removed. This is acceptable for push suppression — worst case is an
   * occasional extra or missed push, compensated by the in-app WebSocket notification.
   */
  async isActive(userId: string): Promise<boolean> {
    // Must be online first
    const online = await this.isOnline(userId);
    if (!online) return false;

    // Get all connections for the user
    const connectionsKey = USER_CONNECTIONS_KEY_PREFIX + userId;
    const connections = await this.redis.smembers(connectionsKey);
    if (connections.length === 0) return false;

    // Check idle hash — if ANY connection is NOT in the idle hash, user is active
    const idleKey = USER_IDLE_KEY_PREFIX + userId;
    const idleValues = await this.redis.hmget(idleKey, ...connections);

    // idleValues[i] is '1' if connection i is idle, null if not idle
    return idleValues.some((v) => v === null);
  }

  /**
   * Check if a user is online (TTL not expired).
   */
  async isOnline(userId: string): Promise<boolean> {
    const exists = await this.redis.get(USER_PRESENCE_KEY_PREFIX + userId);
    return !!exists;
  }

  /**
   * Get all currently online user IDs.
   */
  async getOnlineUsers(): Promise<string[]> {
    return this.redis.smembers(ONLINE_USERS_SET);
  }

  /**
   * Remove users from the online set whose TTL has expired.
   * Runs every minute.
   * Note: With connection tracking, this is less critical as cleanup happens
   * automatically when connections are removed.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupExpired(): Promise<void> {
    const userIds = await this.getOnlineUsers();

    for (const userId of userIds) {
      // Check if user's presence key still exists
      const presenceExists = await this.redis.get(
        USER_PRESENCE_KEY_PREFIX + userId,
      );

      if (!presenceExists) {
        // Presence expired but user is still in set - clean up
        await this.redis.srem(ONLINE_USERS_SET, userId);
        await this.redis.del(USER_CONNECTIONS_KEY_PREFIX + userId);
        await this.redis.del(USER_IDLE_KEY_PREFIX + userId);
      }
    }
  }
}
