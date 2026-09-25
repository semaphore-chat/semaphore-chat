import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RbacActions, Prisma } from '@prisma/client';
import { REDIS_CLIENT } from '@/redis/redis.constants';

/** Cached-value TTL. Old-epoch value keys are never explicitly deleted —
 * they simply become unreachable once the epoch bumps, and expire on their
 * own after this many seconds. */
const VALUE_TTL_SECONDS = 300;

/** Max time to wait for Redis before treating the cache as unavailable and
 * falling through to the DB. Mirrors FailOpenThrottlerStorage/WsThrottleGuard
 * — a slow cache must never make permission checks slower than a plain DB
 * query. */
const REDIS_TIMEOUT_MS = 1500;

/** Minimum interval between "cache unavailable" warning logs, so a sustained
 * Redis outage doesn't flood the logs on every request. */
const WARN_INTERVAL_MS = 30_000;

export type PermissionScope =
  { kind: 'instance' } | { kind: 'community'; communityId: string };

/**
 * A deferred epoch bump, described as data so it can be collected inside a
 * caller-owned transaction and executed only after that transaction commits.
 * See `bumpNowOrDefer` for the collection side (used by CommunityRolesService
 * and InstanceRolesService) and `executeBumps` for the flush.
 */
export type EpochBump =
  | { kind: 'user'; userId: string }
  | { kind: 'community'; communityId: string }
  | { kind: 'instance' };

export interface PermissionEpochs {
  userEpoch: number;
  scopeEpoch: number;
}

export type PermissionCacheReadResult =
  | { status: 'hit'; actions: RbacActions[] }
  | { status: 'miss'; epochs: PermissionEpochs }
  | { status: 'unavailable' };

/**
 * Redis-backed cache for RBAC permission lookups — specifically the
 * flattened `actions` arrays produced by the two `userRoles.findMany(...)`
 * queries in PermissionsService (instance-level and community-level). Those
 * queries run on every guarded request; this cache lets most of them skip
 * the DB round trip entirely.
 *
 * ## Epoch-based invalidation (no SCAN/pattern deletes)
 *
 * Three epoch counters, each a plain Redis key bumped with INCR. A missing
 * epoch key reads as epoch 0:
 *
 *   rbac:epoch:user:{userId}           bumped on any role ASSIGNMENT change
 *                                       for that user (community or instance)
 *   rbac:epoch:community:{communityId} bumped on any role DEFINITION change
 *                                       (create/update/delete) in that community
 *   rbac:epoch:instance                bumped on any instance-level role
 *                                       DEFINITION change
 *
 * The cached lookup result lives at a key that embeds both the user's and
 * the scope's current epoch:
 *
 *   rbac:actions:{userId}:instance:{userEpoch}:{instanceEpoch}
 *   rbac:actions:{userId}:{communityId}:{userEpoch}:{communityEpoch}
 *
 * Value: `JSON.stringify(RbacActions[])`, TTL 300s (SET EX) — the only data
 * PermissionsService actually needs from the two `findMany` results is the
 * flattened `role.actions` union, so that's all that's cached.
 *
 * Bumping an epoch never touches the value keys directly — it just changes
 * which value key subsequent reads address. The old value key is now
 * unreachable (nothing will ever ask for it again) and simply expires via
 * its TTL. This is what avoids SCAN/KEYS-based fan-out deletes: invalidation
 * is O(1) regardless of how many stale cache entries exist.
 *
 * ## Fail-open
 *
 * Reads: any Redis error, or a call that doesn't resolve within
 * REDIS_TIMEOUT_MS, is treated as `{ status: 'unavailable' }` — the caller
 * falls through to the DB. Failures are logged at `warn`, throttled to once
 * per WARN_INTERVAL_MS.
 *
 * Bumps: always awaited (never fire-and-forget), so on the happy path the
 * invalidation is guaranteed visible to subsequent reads before the mutation
 * returns. That guarantee does NOT hold under Redis failure: `bump()` below
 * runs the INCR through `withTimeout`, and on error or timeout it logs at
 * `error` (every time — bumps are rare, so no throttling) and swallows the
 * failure rather than rethrowing — fail-open, same posture as reads — so a
 * wedged Redis cannot turn role management into a 500. In that case the bump
 * may not have applied, and staleness is bounded only by VALUE_TTL_SECONDS
 * (300s): affected cache entries self-expire by then even if the bump never
 * lands.
 *
 * ## Bump ordering vs. transactions
 *
 * A bump must happen strictly AFTER the corresponding DB write commits.
 * Bumping while the transaction is still open creates a race: a concurrent
 * reader can miss under the NEW epoch, query the DB (which still shows
 * pre-commit data), and cache that stale result under the post-commit
 * epoch — a stale grant that persists until the next bump or TTL expiry.
 * Mutations that own their write (no caller transaction) simply bump right
 * after the awaited write. Mutations that run inside a caller-owned
 * transaction instead record an `EpochBump` onto the caller's collector,
 * and the caller flushes it via `executeBumps` after `$transaction`
 * resolves. If the transaction rolls back, the collected bumps are simply
 * never executed — correct, since nothing changed in the DB.
 */
@Injectable()
export class PermissionsCacheService {
  private readonly logger = new Logger(PermissionsCacheService.name);
  private lastUnavailableWarnAt = Number.NEGATIVE_INFINITY;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Attempts to read the cached actions for a user/scope. Never throws.
   */
  async getCachedActions(
    userId: string,
    scope: PermissionScope,
  ): Promise<PermissionCacheReadResult> {
    if (!this.isRedisReady()) {
      this.warnUnavailable(`Redis connection status is '${this.redis.status}'`);
      return { status: 'unavailable' };
    }

    try {
      return await this.withTimeout(this.readActions(userId, scope));
    } catch (error) {
      this.warnUnavailable(errorMessage(error));
      return { status: 'unavailable' };
    }
  }

  /**
   * Populates the cache for a user/scope, using the epochs captured at the
   * time of the preceding `getCachedActions` MISS (not epochs re-read now).
   * This ordering matters: if a role mutation (and its epoch bump) happens
   * concurrently with the DB query that produced `actions`, writing under
   * the *old* (pre-bump) epoch makes this entry immediately unreachable —
   * safe. Writing under a freshly re-read epoch could instead cache
   * possibly-stale `actions` under the epoch that's currently considered
   * valid, which would be a real staleness bug. Never throws.
   */
  async setCachedActions(
    userId: string,
    scope: PermissionScope,
    epochs: PermissionEpochs,
    actions: RbacActions[],
  ): Promise<void> {
    if (!this.isRedisReady()) return;

    try {
      await this.withTimeout(this.writeActions(userId, scope, epochs, actions));
    } catch (error) {
      // Population failures are non-critical — the next request just misses
      // and re-populates. Not throttled: debug-level, not a warning.
      this.logger.debug(
        `Failed to populate RBAC permission cache: ${errorMessage(error)}`,
      );
    }
  }

  /** Bump on any role ASSIGNMENT change (create/delete of a UserRoles row)
   * for this user — invalidates all of that user's cached entries (both
   * instance and every community scope). */
  async bumpUserEpoch(userId: string): Promise<void> {
    await this.bump(this.userEpochKey(userId));
  }

  /** Bump on any role DEFINITION change (create/update/delete of a Role row)
   * scoped to this community. */
  async bumpCommunityEpoch(communityId: string): Promise<void> {
    await this.bump(this.communityEpochKey(communityId));
  }

  /** Bump on any instance-level role DEFINITION change. */
  async bumpInstanceEpoch(): Promise<void> {
    await this.bump(this.instanceEpochKey());
  }

  /** Execute a single bump described as data (see EpochBump). Never throws —
   * same fail-open posture as the direct bump methods. */
  async executeBump(bump: EpochBump): Promise<void> {
    switch (bump.kind) {
      case 'user':
        return this.bumpUserEpoch(bump.userId);
      case 'community':
        return this.bumpCommunityEpoch(bump.communityId);
      case 'instance':
        return this.bumpInstanceEpoch();
    }
  }

  /**
   * Flush epoch bumps that were deferred during a caller-owned transaction.
   * Call this immediately after `$transaction` resolves (i.e. after commit),
   * awaited. Duplicate bumps for the same epoch key are coalesced into one
   * INCR. Never throws — each underlying bump already logs-and-swallows its
   * own failures.
   */
  async executeBumps(bumps: EpochBump[]): Promise<void> {
    const seen = new Set<string>();
    for (const bump of bumps) {
      const key =
        bump.kind === 'user'
          ? this.userEpochKey(bump.userId)
          : bump.kind === 'community'
            ? this.communityEpochKey(bump.communityId)
            : this.instanceEpochKey();
      if (seen.has(key)) continue;
      seen.add(key);
      await this.executeBump(bump);
    }
  }

  /**
   * Epoch-bump helper for role mutations that can run inside a caller-owned
   * transaction. Two modes:
   *
   * - Without `tx`: the mutation's write is already committed, so bump
   *   immediately (awaited) — the invalidation is visible before the
   *   mutation returns.
   * - With `tx` + `pendingBumps`: the write is NOT committed yet. Bumping
   *   now would open a race where a concurrent reader misses under the new
   *   epoch, reads pre-commit data from the DB, and caches it under the
   *   post-commit epoch — a stale grant. So instead the bump is recorded on
   *   the caller's collector; the transaction owner flushes it via
   *   `executeBumps` right after `$transaction` resolves. On rollback the
   *   collected bumps are never executed, which is correct (nothing changed
   *   in the DB).
   * - With `tx` but no collector (defensive fallback — every tx caller in
   *   the codebase passes one): bump immediately anyway. That re-opens the
   *   narrow pre-commit race above, but silently dropping the bump would be
   *   strictly worse (guaranteed stale grant for up to the value TTL).
   */
  async bumpNowOrDefer(
    bump: EpochBump,
    tx?: Prisma.TransactionClient,
    pendingBumps?: EpochBump[],
  ): Promise<void> {
    if (tx && pendingBumps) {
      pendingBumps.push(bump);
      return;
    }
    return this.executeBump(bump);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async bump(key: string): Promise<void> {
    try {
      await this.withTimeout(this.redis.incr(key));
    } catch (error) {
      this.logger.error(
        `Failed to bump RBAC epoch key '${key}' — cached permissions under ` +
          `the previous epoch may be served as stale grants for up to ` +
          `${VALUE_TTL_SECONDS}s: ${errorMessage(error)}`,
      );
    }
  }

  private async readActions(
    userId: string,
    scope: PermissionScope,
  ): Promise<PermissionCacheReadResult> {
    const epochs = await this.readEpochs(userId, scope);
    const key = this.valueKey(userId, scope, epochs);
    const raw = await this.redis.get(key);

    if (!raw) {
      return { status: 'miss', epochs };
    }

    try {
      return { status: 'hit', actions: JSON.parse(raw) as RbacActions[] };
    } catch {
      // Corrupt entry — treat as a miss rather than throwing.
      return { status: 'miss', epochs };
    }
  }

  private async writeActions(
    userId: string,
    scope: PermissionScope,
    epochs: PermissionEpochs,
    actions: RbacActions[],
  ): Promise<void> {
    const key = this.valueKey(userId, scope, epochs);
    await this.redis.set(key, JSON.stringify(actions), 'EX', VALUE_TTL_SECONDS);
  }

  /** Single MGET round trip for both epochs. */
  private async readEpochs(
    userId: string,
    scope: PermissionScope,
  ): Promise<PermissionEpochs> {
    const [userEpochRaw, scopeEpochRaw] = await this.redis.mget(
      this.userEpochKey(userId),
      this.scopeEpochKey(scope),
    );

    return {
      userEpoch: toEpoch(userEpochRaw),
      scopeEpoch: toEpoch(scopeEpochRaw),
    };
  }

  private valueKey(
    userId: string,
    scope: PermissionScope,
    epochs: PermissionEpochs,
  ): string {
    const scopePart =
      scope.kind === 'instance' ? 'instance' : scope.communityId;
    return `rbac:actions:${userId}:${scopePart}:${epochs.userEpoch}:${epochs.scopeEpoch}`;
  }

  private userEpochKey(userId: string): string {
    return `rbac:epoch:user:${userId}`;
  }

  private communityEpochKey(communityId: string): string {
    return `rbac:epoch:community:${communityId}`;
  }

  private instanceEpochKey(): string {
    return 'rbac:epoch:instance';
  }

  private scopeEpochKey(scope: PermissionScope): string {
    return scope.kind === 'instance'
      ? this.instanceEpochKey()
      : this.communityEpochKey(scope.communityId);
  }

  /** Fast path during outages: skip waiting out the full timeout on every
   * call when we already know the connection isn't ready. */
  private isRedisReady(): boolean {
    return this.redis.status === 'ready';
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(
            new Error(
              `RBAC permission cache timed out after ${REDIS_TIMEOUT_MS}ms`,
            ),
          ),
        REDIS_TIMEOUT_MS,
      );
      timeoutHandle.unref?.();
    });

    // Defensive: if the timeout wins the race below, `promise` (bump's
    // redis.incr, readActions', or writeActions' underlying Redis calls) may
    // still be pending. Attaching .catch() on this reference doesn't affect
    // the value Promise.race resolves/rejects with below — that still comes
    // from `promise`'s own resolution/rejection — it just guarantees a later
    // rejection can never surface as an unhandled rejection, without relying
    // on Promise.race's internal subscription behavior to provide that.
    promise.catch(() => undefined);

    return Promise.race([promise, timeoutPromise]).finally(() =>
      clearTimeout(timeoutHandle),
    );
  }

  private warnUnavailable(reason: string): void {
    const now = Date.now();
    if (now - this.lastUnavailableWarnAt < WARN_INTERVAL_MS) {
      return;
    }
    this.lastUnavailableWarnAt = now;
    this.logger.warn(
      `RBAC permission cache unavailable, falling through to DB: ${reason}`,
    );
  }
}

function toEpoch(raw: string | null): number {
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
