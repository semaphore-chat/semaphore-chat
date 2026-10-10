/**
 * Hard ceiling for calls into the LiveKit server API. LiveKit's SDK has no
 * request timeout of its own: a hung or unreachable LiveKit server would
 * otherwise stall whatever awaits it (notably the webhook handler, which
 * must acknowledge LiveKit promptly or LiveKit retries the event).
 */
export const LIVEKIT_REQUEST_TIMEOUT_MS = 5000;

/** Rejection thrown by withTimeout when the LiveKit call doesn't settle. */
export class LivekitTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`LiveKit request timed out after ${timeoutMs}ms: ${label}`);
    this.name = 'LivekitTimeoutError';
  }
}

/**
 * Bound one LiveKit server-SDK call with a timeout. The underlying promise
 * keeps running (the SDK has no cancellation), but the caller stops waiting
 * after `timeoutMs` and gets a clear, loggable error instead of hanging.
 *
 * The timer is cleared as soon as either side settles, so a completed
 * request leaves nothing pending on the event loop.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number = LIVEKIT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new LivekitTimeoutError(label, timeoutMs)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
