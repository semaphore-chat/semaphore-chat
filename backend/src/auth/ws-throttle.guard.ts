import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ErrorCode } from '@semaphore-chat/shared';
import { Socket } from 'socket.io';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/redis/redis.constants';

/**
 * Atomically increments the per-socket counter and, only on the first
 * increment of a window (i.e. when the key was just created), sets a
 * millisecond TTL equal to the window length. Returns the post-increment
 * count. Running this as a single EVAL keeps the "increment + maybe set
 * TTL" sequence atomic without a round trip for a separate NX check.
 */
const INCR_WITH_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`;

/**
 * Max time to wait for the Redis eval before failing open. Mirrors
 * FailOpenThrottlerStorage's DEFAULT_TIMEOUT_MS (same value) — a
 * slow-but-connected Redis never rejects, so without a race the awaited
 * eval would hang the WS event indefinitely. (FailOpenThrottlerStorage
 * doesn't expose an env-var override for this in production — it's only
 * ever constructed with a fixed default in app.module.ts — so there's no
 * env override to mirror here either.)
 */
const EVAL_TIMEOUT_MS = 1500;

/**
 * Fail-open warning throttle window. Mirrors FailOpenThrottlerStorage's
 * WARN_INTERVAL_MS so a sustained Redis outage doesn't flood the logs —
 * WS event volume across 7 gateways makes unthrottled logging worse here
 * than in the HTTP throttler case.
 */
const WARN_INTERVAL_MS = 30_000;

/**
 * WebSocket rate limiting guard, Redis-backed.
 *
 * Tracks message counts per socket connection using a fixed window stored
 * in Redis (via the shared REDIS_CLIENT), so limits are shared across
 * replicas and survive process restarts. The HTTP ThrottlerGuard doesn't
 * apply to WebSocket gateways, so this provides equivalent protection for
 * WS events.
 *
 * Default: 50 events per 10 seconds per connection.
 *
 * Fails OPEN: if Redis is unreachable, errors, or is too slow to respond
 * within EVAL_TIMEOUT_MS, the request is allowed and a warning is logged
 * (throttled to once per WARN_INTERVAL_MS) — rate limiting must never
 * become an availability or latency dependency for the whole app (mirrors
 * FailOpenThrottlerStorage's philosophy for the HTTP throttler, including
 * its timeout race and throttled warning).
 */
@Injectable()
export class WsThrottleGuard implements CanActivate {
  private readonly logger = new Logger(WsThrottleGuard.name);
  private readonly maxEventsPerWindow = 50;
  private readonly windowMs = 10000;
  private lastWarnAt = Number.NEGATIVE_INFINITY;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    const client = context.switchToWs().getClient<Socket>();
    const key = `ws:throttle:${client.id}`;

    let count: number;
    try {
      count = await this.evalWithTimeout(key);
    } catch (error) {
      this.warnFailOpen(error instanceof Error ? error.message : String(error));
      return true;
    }

    if (count > this.maxEventsPerWindow) {
      this.logger.warn(
        `WebSocket rate limit exceeded for socket ${client.id} (${count}/${this.maxEventsPerWindow} in ${this.windowMs}ms)`,
      );
      throw new WsException({
        status: 'error',
        message: 'Rate limit exceeded. Please slow down.',
        errorCode: ErrorCode.RATE_LIMITED,
      });
    }

    return true;
  }

  /**
   * Races the Redis eval against EVAL_TIMEOUT_MS (mirrors
   * FailOpenThrottlerStorage's Promise.race) so a slow-but-connected Redis
   * can't hang the WS event indefinitely. Rejects on timeout, letting
   * canActivate's catch fail open.
   */
  private async evalWithTimeout(key: string): Promise<number> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () =>
          reject(
            new Error(`WS throttle store timed out after ${EVAL_TIMEOUT_MS}ms`),
          ),
        EVAL_TIMEOUT_MS,
      );
      // Don't let the pending timeout keep the Node event loop alive after
      // the eval resolves successfully and clearTimeout() is called.
      timeoutHandle.unref?.();
    });

    const evalPromise = this.redis.eval(
      INCR_WITH_WINDOW_SCRIPT,
      1,
      key,
      this.windowMs,
    );
    // If the timeout wins the race below, this evalPromise reference is the
    // only thing still attached to the underlying Redis call. Without a
    // handler here, a late rejection (e.g. the connection drops after we've
    // already failed open) would surface as an unhandled promise rejection.
    // Attaching .catch() on this separate reference doesn't affect the value
    // Promise.race resolves/rejects with below — that still comes from
    // evalPromise's original resolution/rejection.
    evalPromise.catch(() => undefined);

    try {
      return (await Promise.race([evalPromise, timeoutPromise])) as number;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /** Logs a fail-open warning, at most once per WARN_INTERVAL_MS. */
  private warnFailOpen(reason: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) {
      return;
    }
    this.lastWarnAt = now;
    this.logger.warn(
      `WS throttle store unavailable, failing open (request allowed): ${reason}`,
    );
  }
}
