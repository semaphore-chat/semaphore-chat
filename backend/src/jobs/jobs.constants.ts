/**
 * BullMQ queue names shared between producers (enqueue call sites) and
 * processors (@Processor(...) consumers). Keeping these as named constants
 * avoids typo drift between the two sides of a queue.
 */
export const MESSAGE_FANOUT_QUEUE = 'message-fanout';
export const LINK_PREVIEWS_QUEUE = 'link-previews';
export const TIMEOUT_EXPIRY_QUEUE = 'timeout-expiry';

/**
 * Deterministic id of the delayed job that ends a community timeout, one per
 * user, community and expiry: re-applying the same timeout doesn't add a
 * second job, and the old one can be found and removed when the timeout is
 * replaced or lifted. `-` separators only: BullMQ rejects `:` in custom ids.
 */
export function timeoutExpiryJobId(
  communityId: string,
  userId: string,
  expiresAt: Date,
): string {
  return `timeout-expiry-${communityId}-${userId}-${expiresAt.getTime()}`;
}

/** Fallback used when JOB_WORKER_CONCURRENCY is absent or invalid. */
export const DEFAULT_JOB_WORKER_CONCURRENCY = 4;

/**
 * Resolves JOB_WORKER_CONCURRENCY for a @Processor's `concurrency` option.
 * Read directly from process.env (not ConfigService) because @Processor's
 * decorator options are evaluated at class-decoration time, before Nest's
 * DI container — and thus ConfigService — exists.
 *
 * An explicitly-set but invalid value (0, negative, non-numeric) is treated
 * as a misconfiguration rather than silently honored as "0 workers": we
 * fall back to the default and warn loudly via console (no Logger/DI
 * available at this point) so the mistake isn't silently swallowed.
 */
export function resolveJobWorkerConcurrency(
  defaultConcurrency: number = DEFAULT_JOB_WORKER_CONCURRENCY,
): number {
  const raw = process.env.JOB_WORKER_CONCURRENCY;
  if (!raw) return defaultConcurrency;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `Invalid JOB_WORKER_CONCURRENCY="${raw}" (must be a positive number) — falling back to default concurrency ${defaultConcurrency}`,
    );
    return defaultConcurrency;
  }
  return parsed;
}
