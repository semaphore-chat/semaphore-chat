/**
 * HTTP status helpers for errors thrown by the generated API client.
 *
 * The client throws the parsed error body, e.g. NestJS's
 * `{ statusCode: 404, message: 'Not Found', error: 'Not Found' }`.
 */

/** The HTTP status carried by an API error, if any. */
export function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { statusCode, status } = error as { statusCode?: unknown; status?: unknown };
  if (typeof statusCode === 'number') return statusCode;
  if (typeof status === 'number') return status;
  return undefined;
}

/** True for errors that retrying can't fix: the resource is gone (404) or off-limits (403). */
export function isPermanentAccessError(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 403 || status === 404;
}
