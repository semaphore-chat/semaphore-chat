/**
 * In-memory stand-in for the few Redis commands AuthAttemptLimiter uses
 * (counters with a TTL, and sets for key groups).
 */
export function createFakeRedis() {
  const values = new Map<string, number>();
  const ttls = new Map<string, number>();
  const sets = new Map<string, Set<string>>();
  return {
    values,
    ttls,
    sets,
    sadd: jest.fn((key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
      return Promise.resolve(1);
    }),
    smembers: jest.fn((key: string) =>
      Promise.resolve([...(sets.get(key) ?? [])]),
    ),
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
    del: jest.fn((...keys: string[]) => {
      for (const key of keys) {
        values.delete(key);
        ttls.delete(key);
        sets.delete(key);
      }
      return Promise.resolve(keys.length);
    }),
  };
}
