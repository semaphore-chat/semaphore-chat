import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed LiveKit participant attributes the backend puts in the tokens it
 * issues, so the `participant_joined` webhook and session revocation can tell
 * which token (and which login) a participant joined with. See
 * LivekitAccessService.
 *
 * Why attributes, and why they are signed: LiveKit tokens can't be revoked
 * and the webhook and the room service only see the participant, not its
 * token, so these facts have to ride along on the participant. Attributes are
 * set from the token at join (and carried into the tokens LiveKit refreshes
 * for connected clients), but our tokens grant `canUpdateOwnMetadata` (the
 * client publishes its deafen state in its metadata), which also lets the
 * client rewrite its own attributes. So each value is `<value>.<hmac>`, keyed
 * with the LiveKit API secret and bound to the attribute and the identity: a
 * client can drop or change a value, but can't forge one, nor copy another
 * user's.
 */

/** When the backend issued the token (epoch ms). */
export const LIVEKIT_ISSUED_AT_ATTRIBUTE = 'semaphore.issuedAt';

/** The auth session (refresh token family, JWT `sid`) the token was issued to. */
export const LIVEKIT_SESSION_ATTRIBUTE = 'semaphore.sessionId';

const ISSUED_AT_CONTEXT = 'semaphore-livekit-issued-at:v1';
const SESSION_CONTEXT = 'semaphore-livekit-session:v1';

function mac(
  context: string,
  secret: string,
  identity: string,
  value: string,
): string {
  return createHmac('sha256', secret)
    .update(`${context}\n${identity}\n${value}`)
    .digest('base64url');
}

function signValue(
  context: string,
  secret: string,
  identity: string,
  value: string,
): string {
  return `${value}.${mac(context, secret, identity, value)}`;
}

/**
 * The value in a signed attribute, or null when it is missing, malformed,
 * doesn't match `valuePattern`, or isn't signed for this identity.
 */
function verifyValue(
  context: string,
  secret: string,
  identity: string,
  signed: string | undefined,
  valuePattern: RegExp,
): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const actual = signed.slice(dot + 1);
  if (!valuePattern.test(value) || !/^[A-Za-z0-9_-]+$/.test(actual)) {
    return null;
  }

  const expected = Buffer.from(mac(context, secret, identity, value));
  const actualBuf = Buffer.from(actual);
  if (
    expected.length !== actualBuf.length ||
    !timingSafeEqual(expected, actualBuf)
  ) {
    return null;
  }
  return value;
}

/** The signed issue-time attribute value for a token issued now-ish. */
export function signIssuedAt(
  secret: string,
  identity: string,
  issuedAtMs: number,
): string {
  return signValue(ISSUED_AT_CONTEXT, secret, identity, String(issuedAtMs));
}

/**
 * The issue time (epoch ms) in a signed attribute value, or null when the
 * value is missing, malformed or not signed for this identity.
 */
export function verifyIssuedAt(
  secret: string,
  identity: string,
  signed: string | undefined,
): number | null {
  const value = verifyValue(
    ISSUED_AT_CONTEXT,
    secret,
    identity,
    signed,
    /^\d{1,16}$/,
  );
  if (value === null) return null;
  const issuedAtMs = Number(value);
  return Number.isSafeInteger(issuedAtMs) ? issuedAtMs : null;
}

/** The signed session attribute value. */
export function signSessionId(
  secret: string,
  identity: string,
  sessionId: string,
): string {
  return signValue(SESSION_CONTEXT, secret, identity, sessionId);
}

/**
 * The session id in a signed attribute value, or null when the value is
 * missing, malformed or not signed for this identity.
 */
export function verifySessionId(
  secret: string,
  identity: string,
  signed: string | undefined,
): string | null {
  return verifyValue(
    SESSION_CONTEXT,
    secret,
    identity,
    signed,
    /^[A-Za-z0-9-]{1,64}$/,
  );
}
