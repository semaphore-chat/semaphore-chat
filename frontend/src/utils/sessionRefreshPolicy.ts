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

/**
 * No retry is sent later than this after the first attempt of a sequence.
 *
 * Why: if the first attempt's response got lost (the server rotated the
 * refresh token, but the new cookie never arrived), every retry presents
 * the rotated token again. The server hands such a retry the same new token
 * only within its grace window, 30 s after the rotation (and only to this
 * client); after that, the old token counts as stolen and the server ends
 * the session. The rotation happened after the first attempt was sent, so
 * a retry sent within 12 s of it leaves the server 18 s or more to get to
 * it. Retries after a timeout (REFRESH_REQUEST_TIMEOUT_MS) or slow answers
 * would otherwise land past the window (e.g. at 16, 33 and 52 s) and end
 * the session themselves.
 */
export const SESSION_REFRESH_RETRY_BUDGET_MS = 12_000;

/** Wait after failed attempt number `attempt` (1-based): 1s, 2s, 4s... capped. */
export function sessionRefreshBackoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), MAX_SESSION_REFRESH_BACKOFF_MS);
}

/**
 * The wait before retrying after failed attempt number `attempt` (1-based)
 * of a sequence that started at `startedAt` (epoch ms), or null to give up:
 * after MAX_SESSION_REFRESH_ATTEMPTS attempts, or when the retry would be
 * sent more than SESSION_REFRESH_RETRY_BUDGET_MS after the first attempt.
 */
export function nextSessionRefreshDelayMs(
  attempt: number,
  startedAt: number,
  now = Date.now()
): number | null {
  if (attempt >= MAX_SESSION_REFRESH_ATTEMPTS) return null;
  const delay = sessionRefreshBackoffMs(attempt);
  if (now + delay - startedAt > SESSION_REFRESH_RETRY_BUDGET_MS) return null;
  return delay;
}

/**
 * Refresh ladders (each up to MAX_SESSION_REFRESH_ATTEMPTS attempts, then a
 * pause) a page load (AuthGate) runs while the server can't answer, before
 * it stops and offers to try again or sign in again: about 40 s. Retrying
 * rides out a restart, but a server that keeps failing (a persistent 5xx)
 * must not trap the user on "Connecting..." with no way out.
 */
export const PAGE_LOAD_REFRESH_ROUNDS = 3;
