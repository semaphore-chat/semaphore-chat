import { HttpStatus } from '@nestjs/common';
import { ApiErrorFields, ErrorCode } from '@semaphore-chat/shared';

const CODE_FOR_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.UNPROCESSABLE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.UNAVAILABLE,
};

/**
 * Errors a client may retry on its own. Not TIMED_OUT: a moderation timeout can
 * last for weeks, and sends shouldn't be retried through it.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  ErrorCode.RATE_LIMITED,
  ErrorCode.INTERNAL,
  ErrorCode.UNAVAILABLE,
  ErrorCode.SLOWMODE,
]);

/** The code for an error that has no specific one. */
export function errorCodeForStatus(status: number): ErrorCode {
  return CODE_FOR_STATUS[status] ?? ErrorCode.UNKNOWN;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Adds the client-facing fields to an error payload without touching what's
 * there. A specific code set where the error was thrown wins over `fallback`.
 */
export function withErrorFields<T extends Record<string, unknown>>(
  payload: T,
  fallback: ErrorCode,
): T & ApiErrorFields {
  const errorCode = (payload.errorCode as ErrorCode | undefined) ?? fallback;
  return {
    ...payload,
    errorCode,
    retryable: RETRYABLE_CODES.has(errorCode),
  };
}
