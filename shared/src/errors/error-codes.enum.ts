/**
 * Stable codes for errors, on REST responses and socket `exception` events.
 *
 * This list is append-only: a released code is never renamed, reused or given
 * a new meaning, because clients on old versions keep reading it. A client must
 * also expect codes it doesn't know. It handles those by `retryable` and the
 * HTTP status, and shows `message`.
 */
export enum ErrorCode {
  // One for each HTTP status we answer with, from the status alone. Most errors
  // have only these until their site needs a more specific code below.
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNPROCESSABLE = 'UNPROCESSABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  /** A status with no code of its own. */
  UNKNOWN = 'UNKNOWN',

  // Sending a message
  MESSAGE_TARGET_INVALID = 'MESSAGE_TARGET_INVALID',
  QUOTE_NOT_FOUND = 'QUOTE_NOT_FOUND',
  QUOTE_OTHER_CONTEXT = 'QUOTE_OTHER_CONTEXT',
  SLOWMODE = 'SLOWMODE',
  TIMED_OUT = 'TIMED_OUT',
  /** This clientNonce was already used, for a message somewhere else. */
  NONCE_CONFLICT = 'NONCE_CONFLICT',
  /** A retry of a send whose message has since been deleted. */
  MESSAGE_DELETED = 'MESSAGE_DELETED',
  /** The 1:1 DM's other member blocked this user, or was blocked by them. */
  DM_BLOCKED = 'DM_BLOCKED',

  // Sessions
  /**
   * The request didn't say which of the caller's sessions is current (no
   * refresh cookie, and an access token without a live session). The caller
   * is signed in, so this is a 400, not a 401.
   */
  CURRENT_SESSION_UNKNOWN = 'CURRENT_SESSION_UNKNOWN',

  // Files
  ATTACH_NOT_ALLOWED = 'ATTACH_NOT_ALLOWED',
  FILE_NOT_OWNED = 'FILE_NOT_OWNED',
  UPLOAD_TARGET_NOT_ALLOWED = 'UPLOAD_TARGET_NOT_ALLOWED',
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
}

/**
 * The fields a REST error body or a socket `exception` payload adds for
 * clients. Other fields (`statusCode`, `message`, `error`, `status`, `cause`)
 * are what they always were. A socket validation failure is the exception: it
 * stays a plain array of class-validator errors, which old clients read.
 */
export interface ApiErrorFields {
  errorCode: ErrorCode;
  /** Whether a client may retry the same request automatically. */
  retryable: boolean;
  /**
   * How long until the same request can succeed, when the server knows. Also
   * set on some errors that are not retryable (TIMED_OUT), for display.
   */
  retryAfterMs?: number;
}
