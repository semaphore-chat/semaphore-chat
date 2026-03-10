/**
 * Redis Client Mock
 *
 * Provides a mock ioredis client for testing Redis-dependent code.
 *
 * Usage:
 * ```typescript
 * import { createMockRedis, REDIS_CLIENT } from '@/test-utils';
 *
 * const mockRedis = createMockRedis();
 * mockRedis.get.mockResolvedValue(JSON.stringify({ userId: '123' }));
 *
 * const module = await Test.createTestingModule({
 *   providers: [
 *     VoicePresenceService,
 *     { provide: REDIS_CLIENT, useValue: mockRedis },
 *   ],
 * }).compile();
 * ```
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import { REDIS_CLIENT } from '@/redis/redis.constants';

export type MockRedisClient = {
  ping: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  exists: jest.Mock;
  expire: jest.Mock;
  ttl: jest.Mock;
  keys: jest.Mock;
  hget: jest.Mock;
  hset: jest.Mock;
  hdel: jest.Mock;
  hgetall: jest.Mock;
  hkeys: jest.Mock;
  sadd: jest.Mock;
  srem: jest.Mock;
  scard: jest.Mock;
  smembers: jest.Mock;
  sismember: jest.Mock;
  mget: jest.Mock;
  scan: jest.Mock;
  publish: jest.Mock;
  subscribe: jest.Mock;
  unsubscribe: jest.Mock;
  on: jest.Mock;
  removeListener: jest.Mock;
  pipeline: jest.Mock;
  quit: jest.Mock;
};

export function createMockRedis(): MockRedisClient {
  // In-memory store for simulating Redis behavior
  const store = new Map<string, string>();
  const hashStore = new Map<string, Map<string, string>>();
  const setStore = new Map<string, Set<string>>();

  const createPipeline = () => {
    const pipeline = {
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    return pipeline;
  };

  return {
    ping: jest.fn(() => Promise.resolve('PONG')),
    get: jest.fn((key: string) => Promise.resolve(store.get(key) || null)),
    set: jest.fn((key: string, value: string, ...args: any[]) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      keys.forEach((k) => store.delete(k));
      return Promise.resolve(keys.length);
    }),
    exists: jest.fn((key: string) => Promise.resolve(store.has(key) ? 1 : 0)),
    expire: jest.fn(() => Promise.resolve(1)),
    ttl: jest.fn(() => Promise.resolve(-1)),
    keys: jest.fn((pattern: string) =>
      Promise.resolve(Array.from(store.keys())),
    ),

    // Hash operations
    hget: jest.fn((key: string, field: string) => {
      const hash = hashStore.get(key);
      return Promise.resolve(hash?.get(field) || null);
    }),
    hset: jest.fn((key: string, field: string, value: string) => {
      if (!hashStore.has(key)) {
        hashStore.set(key, new Map());
      }
      hashStore.get(key)!.set(field, value);
      return Promise.resolve(1);
    }),
    hdel: jest.fn((key: string, field: string) => {
      const hash = hashStore.get(key);
      if (hash) {
        hash.delete(field);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }),
    hgetall: jest.fn((key: string) => {
      const hash = hashStore.get(key);
      if (!hash) return Promise.resolve({});
      const result: Record<string, string> = {};
      hash.forEach((value, field) => {
        result[field] = value;
      });
      return Promise.resolve(result);
    }),
    hkeys: jest.fn((key: string) => {
      const hash = hashStore.get(key);
      return Promise.resolve(hash ? Array.from(hash.keys()) : []);
    }),

    // Set operations
    sadd: jest.fn((key: string, ...members: string[]) => {
      if (!setStore.has(key)) {
        setStore.set(key, new Set());
      }
      const set = setStore.get(key)!;
      members.forEach((member) => set.add(member));
      return Promise.resolve(members.length);
    }),
    srem: jest.fn((key: string, ...members: string[]) => {
      const set = setStore.get(key);
      if (!set) return Promise.resolve(0);
      members.forEach((member) => set.delete(member));
      return Promise.resolve(members.length);
    }),
    scard: jest.fn((key: string) => {
      const set = setStore.get(key);
      return Promise.resolve(set ? set.size : 0);
    }),
    smembers: jest.fn((key: string) => {
      const set = setStore.get(key);
      return Promise.resolve(set ? Array.from(set) : []);
    }),
    sismember: jest.fn((key: string, member: string) => {
      const set = setStore.get(key);
      return Promise.resolve(set?.has(member) ? 1 : 0);
    }),

    // Multi-key operations
    mget: jest.fn((...keys: (string | string[])[]) => {
      const flatKeys = keys.flat();
      return Promise.resolve(flatKeys.map((k) => store.get(k) || null));
    }),

    // Scanning
    scan: jest.fn(() => Promise.resolve(['0', []])),

    // Pub/sub
    publish: jest.fn(() => Promise.resolve(0)),
    subscribe: jest.fn(() => Promise.resolve()),
    unsubscribe: jest.fn(() => Promise.resolve()),
    on: jest.fn(() => {}),
    removeListener: jest.fn(() => {}),

    // Pipeline
    pipeline: jest.fn(() => createPipeline()),

    // Lifecycle
    quit: jest.fn(() => Promise.resolve()),
  } as unknown as MockRedisClient;
}

/**
 * Helper to reset all mocks in a Redis mock instance
 */
export function resetRedisMock(mockRedis: MockRedisClient): void {
  Object.values(mockRedis).forEach((method) => {
    if (jest.isMockFunction(method)) {
      method.mockClear();
    }
  });
}

/**
 * Create a mock provider for REDIS_CLIENT
 */
export const createRedisProvider = (mockRedis?: MockRedisClient) => ({
  provide: REDIS_CLIENT,
  useValue: mockRedis || createMockRedis(),
});
