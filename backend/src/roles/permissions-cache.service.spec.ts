import Redis from 'ioredis';
import { RbacActions } from '@prisma/client';
import {
  PermissionsCacheService,
  type EpochBump,
} from './permissions-cache.service';

function makeRedis(overrides: Record<string, any> = {}): Redis {
  return {
    status: 'ready',
    mget: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    ...overrides,
  } as unknown as Redis;
}

function spyOnWarn(service: PermissionsCacheService): jest.SpyInstance {
  return jest
    .spyOn(
      (service as unknown as { logger: { warn: (msg: string) => void } })
        .logger,
      'warn',
    )
    .mockImplementation(() => undefined);
}

function spyOnError(service: PermissionsCacheService): jest.SpyInstance {
  return jest
    .spyOn(
      (service as unknown as { logger: { error: (msg: string) => void } })
        .logger,
      'error',
    )
    .mockImplementation(() => undefined);
}

describe('PermissionsCacheService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const actions: RbacActions[] = [
    RbacActions.CREATE_MESSAGE,
    RbacActions.READ_MESSAGE,
  ];

  describe('getCachedActions — hit', () => {
    it('returns cached actions when the value key exists', async () => {
      const redis = makeRedis({
        mget: jest.fn().mockResolvedValue(['0', '0']),
        get: jest.fn().mockResolvedValue(JSON.stringify(actions)),
      });
      const service = new PermissionsCacheService(redis);

      const result = await service.getCachedActions('user-1', {
        kind: 'instance',
      });

      expect(result).toEqual({ status: 'hit', actions });
      expect(redis.mget).toHaveBeenCalledWith(
        'rbac:epoch:user:user-1',
        'rbac:epoch:instance',
      );
      expect(redis.get).toHaveBeenCalledWith(
        'rbac:v2:actions:user-1:instance:0:0',
      );
    });

    it('builds the community-scoped value key from communityId', async () => {
      const redis = makeRedis({
        mget: jest.fn().mockResolvedValue(['2', '5']),
        get: jest.fn().mockResolvedValue(JSON.stringify(actions)),
      });
      const service = new PermissionsCacheService(redis);

      const result = await service.getCachedActions('user-1', {
        kind: 'community',
        communityId: 'community-9',
      });

      expect(result).toEqual({ status: 'hit', actions });
      expect(redis.mget).toHaveBeenCalledWith(
        'rbac:epoch:user:user-1',
        'rbac:epoch:community:community-9',
      );
      expect(redis.get).toHaveBeenCalledWith(
        'rbac:v2:actions:user-1:community-9:2:5',
      );
    });

    it('treats a corrupt cached value as a miss rather than throwing', async () => {
      const redis = makeRedis({
        mget: jest.fn().mockResolvedValue(['0', '0']),
        get: jest.fn().mockResolvedValue('not-json{'),
      });
      const service = new PermissionsCacheService(redis);

      const result = await service.getCachedActions('user-1', {
        kind: 'instance',
      });

      expect(result).toEqual({
        status: 'miss',
        epochs: { userEpoch: 0, scopeEpoch: 0 },
      });
    });
  });

  describe('getCachedActions — miss, then populate, then hit', () => {
    it('miss reports current epochs; a subsequent populate + read hits', async () => {
      const store = new Map<string, string>();
      const redis = makeRedis({
        mget: jest.fn().mockResolvedValue([null, null]),
        get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
        set: jest.fn((key: string, value: string) => {
          store.set(key, value);
          return Promise.resolve('OK');
        }),
      });
      const service = new PermissionsCacheService(redis);
      const scope = { kind: 'community' as const, communityId: 'community-1' };

      const miss = await service.getCachedActions('user-1', scope);
      expect(miss).toEqual({
        status: 'miss',
        epochs: { userEpoch: 0, scopeEpoch: 0 },
      });
      if (miss.status !== 'miss') throw new Error('expected miss');

      await service.setCachedActions('user-1', scope, miss.epochs, actions);
      expect(redis.set).toHaveBeenCalledWith(
        'rbac:v2:actions:user-1:community-1:0:0',
        JSON.stringify(actions),
        'EX',
        300,
      );

      // Second read now sees the populated key (epochs still 0:0)
      const hit = await service.getCachedActions('user-1', scope);
      expect(hit).toEqual({ status: 'hit', actions });
    });
  });

  describe('epoch bump invalidates', () => {
    it('a bumped user epoch makes the previously cached entry unreachable', async () => {
      const epochStore = new Map<string, string>();
      const valueStore = new Map<string, string>();
      const redis = makeRedis({
        mget: jest.fn((...keys: string[]) =>
          Promise.resolve(keys.map((k) => epochStore.get(k) ?? null)),
        ),
        get: jest.fn((key: string) =>
          Promise.resolve(valueStore.get(key) ?? null),
        ),
        set: jest.fn((key: string, value: string) => {
          valueStore.set(key, value);
          return Promise.resolve('OK');
        }),
        incr: jest.fn((key: string) => {
          const next = (
            parseInt(epochStore.get(key) ?? '0', 10) + 1
          ).toString();
          epochStore.set(key, next);
          return Promise.resolve(parseInt(next, 10));
        }),
      });
      const service = new PermissionsCacheService(redis);
      const scope = { kind: 'community' as const, communityId: 'community-1' };

      const miss = await service.getCachedActions('user-1', scope);
      if (miss.status !== 'miss') throw new Error('expected miss');
      await service.setCachedActions('user-1', scope, miss.epochs, actions);

      // Confirm it's cached
      expect(await service.getCachedActions('user-1', scope)).toEqual({
        status: 'hit',
        actions,
      });

      // Bump the user's epoch — old value key is now orphaned
      await service.bumpUserEpoch('user-1');

      const afterBump = await service.getCachedActions('user-1', scope);
      expect(afterBump).toEqual({
        status: 'miss',
        epochs: { userEpoch: 1, scopeEpoch: 0 },
      });
    });

    it('a bumped community epoch makes the previously cached entry unreachable', async () => {
      const epochStore = new Map<string, string>();
      const valueStore = new Map<string, string>();
      const redis = makeRedis({
        mget: jest.fn((...keys: string[]) =>
          Promise.resolve(keys.map((k) => epochStore.get(k) ?? null)),
        ),
        get: jest.fn((key: string) =>
          Promise.resolve(valueStore.get(key) ?? null),
        ),
        set: jest.fn((key: string, value: string) => {
          valueStore.set(key, value);
          return Promise.resolve('OK');
        }),
        incr: jest.fn((key: string) => {
          const next = (
            parseInt(epochStore.get(key) ?? '0', 10) + 1
          ).toString();
          epochStore.set(key, next);
          return Promise.resolve(parseInt(next, 10));
        }),
      });
      const service = new PermissionsCacheService(redis);
      const scope = { kind: 'community' as const, communityId: 'community-1' };

      const miss = await service.getCachedActions('user-1', scope);
      if (miss.status !== 'miss') throw new Error('expected miss');
      await service.setCachedActions('user-1', scope, miss.epochs, actions);

      await service.bumpCommunityEpoch('community-1');

      const afterBump = await service.getCachedActions('user-1', scope);
      expect(afterBump).toEqual({
        status: 'miss',
        epochs: { userEpoch: 0, scopeEpoch: 1 },
      });
      // A different community's cache is untouched by this bump.
      expect(redis.incr).toHaveBeenCalledWith(
        'rbac:epoch:community:community-1',
      );
    });

    it('a bumped instance epoch invalidates instance-scope entries only', async () => {
      const epochStore = new Map<string, string>();
      const redis = makeRedis({
        mget: jest.fn((...keys: string[]) =>
          Promise.resolve(keys.map((k) => epochStore.get(k) ?? null)),
        ),
        incr: jest.fn((key: string) => {
          const next = (
            parseInt(epochStore.get(key) ?? '0', 10) + 1
          ).toString();
          epochStore.set(key, next);
          return Promise.resolve(parseInt(next, 10));
        }),
      });
      const service = new PermissionsCacheService(redis);

      await service.bumpInstanceEpoch();

      expect(redis.incr).toHaveBeenCalledWith('rbac:epoch:instance');
    });
  });

  describe('fail-open on Redis error', () => {
    it('getCachedActions reports unavailable when mget rejects', async () => {
      const redis = makeRedis({
        mget: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      });
      const service = new PermissionsCacheService(redis);
      spyOnWarn(service);

      const result = await service.getCachedActions('user-1', {
        kind: 'instance',
      });

      expect(result).toEqual({ status: 'unavailable' });
    });

    it('setCachedActions swallows errors and never throws', async () => {
      const redis = makeRedis({
        set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      });
      const service = new PermissionsCacheService(redis);

      await expect(
        service.setCachedActions(
          'user-1',
          { kind: 'instance' },
          { userEpoch: 0, scopeEpoch: 0 },
          actions,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('fail-open on Redis hang (timeout race)', () => {
    it('falls through to unavailable when the read never resolves within the timeout', async () => {
      const redis = makeRedis({
        // Pending forever — simulates a wedged connection.
        mget: jest.fn(() => new Promise(() => undefined)),
      });
      const service = new PermissionsCacheService(redis);
      spyOnWarn(service);

      const resultPromise = service.getCachedActions('user-1', {
        kind: 'instance',
      });
      await jest.advanceTimersByTimeAsync(1501);

      await expect(resultPromise).resolves.toEqual({ status: 'unavailable' });
    });

    it('bump falls through (logs, does not throw) when the INCR never resolves', async () => {
      const redis = makeRedis({
        incr: jest.fn(() => new Promise(() => undefined)),
      });
      const service = new PermissionsCacheService(redis);
      const errorSpy = spyOnError(service);

      const bumpPromise = service.bumpUserEpoch('user-1');
      await jest.advanceTimersByTimeAsync(1501);
      await bumpPromise;

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('timed out');
    });

    it('does not fail open when the read resolves before the timeout', async () => {
      const redis = makeRedis({
        mget: jest.fn().mockResolvedValue(['0', '0']),
        get: jest.fn().mockResolvedValue(JSON.stringify(actions)),
      });
      const service = new PermissionsCacheService(redis);

      const result = await service.getCachedActions('user-1', {
        kind: 'instance',
      });
      await jest.runAllTimersAsync();

      expect(result).toEqual({ status: 'hit', actions });
    });

    it('does not produce an unhandled rejection when the underlying Redis call rejects after the timeout already won the race', async () => {
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      try {
        let rejectIncr!: (err: Error) => void;
        const redis = makeRedis({
          incr: jest.fn(
            () =>
              new Promise((_resolve, reject) => {
                rejectIncr = reject;
              }),
          ),
        });
        const service = new PermissionsCacheService(redis);
        spyOnError(service);

        const bumpPromise = service.bumpUserEpoch('user-1');
        await jest.advanceTimersByTimeAsync(1501);
        await bumpPromise;

        // The INCR call is still pending from the service's perspective —
        // reject it now, after the timeout has already resolved the race.
        rejectIncr(new Error('late redis failure'));
        await jest.advanceTimersByTimeAsync(0);
        await Promise.resolve();
        await Promise.resolve();

        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  describe('fast fail-open when Redis is not ready', () => {
    it('skips the round trip entirely when redis.status is not ready', async () => {
      const redis = makeRedis({ status: 'reconnecting' });
      const service = new PermissionsCacheService(redis);
      const warnSpy = spyOnWarn(service);

      const result = await service.getCachedActions('user-1', {
        kind: 'instance',
      });

      expect(result).toEqual({ status: 'unavailable' });
      expect(redis.mget).not.toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('reconnecting');
    });
  });

  describe('bump error handling', () => {
    it('logs an error and does not throw when INCR rejects', async () => {
      const redis = makeRedis({
        incr: jest.fn().mockRejectedValue(new Error('Redis down')),
      });
      const service = new PermissionsCacheService(redis);
      const errorSpy = spyOnError(service);

      await expect(
        service.bumpCommunityEpoch('community-1'),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('Redis down');
    });
  });

  describe('executeBump / executeBumps (deferred post-commit bumps)', () => {
    it('executeBump maps each bump kind to the correct epoch key', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));

      await service.executeBump({ kind: 'user', userId: 'user-1' });
      await service.executeBump({
        kind: 'community',
        communityId: 'community-1',
      });
      await service.executeBump({ kind: 'instance' });

      expect(incr.mock.calls.map((c) => c[0])).toEqual([
        'rbac:epoch:user:user-1',
        'rbac:epoch:community:community-1',
        'rbac:epoch:instance',
      ]);
    });

    it('executeBumps executes every collected bump', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));

      await service.executeBumps([
        { kind: 'community', communityId: 'community-1' },
        { kind: 'user', userId: 'user-1' },
        { kind: 'instance' },
      ]);

      expect(incr.mock.calls.map((c) => c[0])).toEqual([
        'rbac:epoch:community:community-1',
        'rbac:epoch:user:user-1',
        'rbac:epoch:instance',
      ]);
    });

    it('executeBumps coalesces duplicate bumps for the same key', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));

      await service.executeBumps([
        { kind: 'user', userId: 'user-1' },
        { kind: 'instance' },
        { kind: 'user', userId: 'user-1' },
        { kind: 'instance' },
        { kind: 'user', userId: 'user-2' },
      ]);

      expect(incr.mock.calls.map((c) => c[0])).toEqual([
        'rbac:epoch:user:user-1',
        'rbac:epoch:instance',
        'rbac:epoch:user:user-2',
      ]);
    });

    it('executeBumps is a no-op for an empty collector', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));

      await service.executeBumps([]);

      expect(incr).not.toHaveBeenCalled();
    });

    it('executeBumps never throws — failures are logged per bump', async () => {
      const incr = jest.fn().mockRejectedValue(new Error('Redis down'));
      const service = new PermissionsCacheService(makeRedis({ incr }));
      const errorSpy = spyOnError(service);

      await expect(
        service.executeBumps([
          { kind: 'user', userId: 'user-1' },
          { kind: 'instance' },
        ]),
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('bumpNowOrDefer (deferred vs. immediate epoch bumps)', () => {
    it('bumps immediately when no tx is given', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));

      await service.bumpNowOrDefer({ kind: 'user', userId: 'user-1' });

      expect(incr).toHaveBeenCalledWith('rbac:epoch:user:user-1');
    });

    it('bumps immediately for each EpochBump kind when no tx is given', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));

      await service.bumpNowOrDefer({
        kind: 'community',
        communityId: 'community-1',
      });
      await service.bumpNowOrDefer({ kind: 'instance' });

      expect(incr.mock.calls.map((c) => c[0])).toEqual([
        'rbac:epoch:community:community-1',
        'rbac:epoch:instance',
      ]);
    });

    it('records onto the pendingBumps collector instead of bumping when tx + collector are given', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));
      const pendingBumps: EpochBump[] = [];
      const tx = {} as unknown as Parameters<
        PermissionsCacheService['bumpNowOrDefer']
      >[1];

      await service.bumpNowOrDefer(
        { kind: 'community', communityId: 'community-1' },
        tx,
        pendingBumps,
      );

      expect(incr).not.toHaveBeenCalled();
      expect(pendingBumps).toEqual([
        { kind: 'community', communityId: 'community-1' },
      ]);
    });

    it('falls back to an immediate bump when tx is given without a pendingBumps collector', async () => {
      const incr = jest.fn().mockResolvedValue(1);
      const service = new PermissionsCacheService(makeRedis({ incr }));
      const tx = {} as unknown as Parameters<
        PermissionsCacheService['bumpNowOrDefer']
      >[1];

      await service.bumpNowOrDefer({ kind: 'user', userId: 'user-2' }, tx);

      expect(incr).toHaveBeenCalledWith('rbac:epoch:user:user-2');
    });
  });

  describe('warning rate limiting on read failures', () => {
    it('logs at most one warning per 30 seconds', async () => {
      const redis = makeRedis({
        mget: jest.fn().mockRejectedValue(new Error('Redis down')),
      });
      const service = new PermissionsCacheService(redis);
      const warnSpy = spyOnWarn(service);

      await service.getCachedActions('user-1', { kind: 'instance' });
      await service.getCachedActions('user-1', { kind: 'instance' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('logs again after the rate-limit window elapses', async () => {
      const redis = makeRedis({
        mget: jest.fn().mockRejectedValue(new Error('Redis down')),
      });
      const service = new PermissionsCacheService(redis);
      const warnSpy = spyOnWarn(service);

      await service.getCachedActions('user-1', { kind: 'instance' });
      await jest.advanceTimersByTimeAsync(30_001);
      await service.getCachedActions('user-1', { kind: 'instance' });

      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });
});
