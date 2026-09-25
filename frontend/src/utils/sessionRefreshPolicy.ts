/**
 * How hard to try refreshing the session when the server can't answer
 * (network error, 5xx, 429). Shared by the socket's session recovery
 * (SocketProvider) and the REST 401 interceptor (refreshSessionWithRetry in
 * tokenService). Kept in its own module so tests that mock tokenService
 * still get the real numbers.
 */

/** Refresh attempts before giving up for now: 1s, 2s, 4s apart. */
export const MAX_SESSION_REFRESH_ATTEMPTS = 4;

/** Upper bound for the wait between two refresh attempts. */
export const MAX_SESSION_REFRESH_BACKOFF_MS = 10_000;

/** Wait after failed attempt number `attempt` (1-based): 1s, 2s, 4s... capped. */
export function sessionRefreshBackoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), MAX_SESSION_REFRESH_BACKOFF_MS);
}
