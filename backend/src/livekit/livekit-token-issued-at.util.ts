import { createHmac, timingSafeEqual } from 'crypto';

/**
 * LiveKit participant attribute that records when the backend issued the
 * participant's LiveKit token, so the `participant_joined` webhook can tell a
 * token minted before the user's credentials were revoked (password change,
 * ban, deletion) from a fresh one. See LivekitAccessService.
 *
 * Why an attribute, and why it is signed: LiveKit tokens can't be revoked and
 * the webhook only sees the participant, not the token, so the issue time has
 * to ride along on the participant. Attributes are set from the token at join
 * (and carried into the tokens LiveKit refreshes for connected clients), but
 * our tokens grant `canUpdateOwnMetadata` (the client publishes its deafen
 * state in its metadata), which also lets the client rewrite its own
 * attributes. So the value is `<issuedAtMs>.<hmac>`, keyed with the LiveKit
 * API secret and bound to the identity: a client can drop or change it, but
 * can't forge a later issue time, and either way the check fails closed.
 */
export const LIVEKIT_ISSUED_AT_ATTRIBUTE = 'semaphore.issuedAt';

const HMAC_CONTEXT = 'semaphore-livekit-issued-at:v1';

function sign(secret: string, identity: string, issuedAtMs: number): string {
  return createHmac('sha256', secret)
    .update(`${HMAC_CONTEXT}\n${identity}\n${issuedAtMs}`)
    .digest('base64url');
}

/** The signed issue-time attribute value for a token issued now-ish. */
export function signIssuedAt(
  secret: string,
  identity: string,
  issuedAtMs: number,
): string {
  return `${issuedAtMs}.${sign(secret, identity, issuedAtMs)}`;
}

/**
 * The issue time (epoch ms) in a signed attribute value, or null when the
 * value is missing, malformed or not signed for this identity.
 */
export function verifyIssuedAt(
  secret: string,
  identity: string,
  value: string | undefined,
): number | null {
  if (!value) return null;
  const match = /^(\d{1,16})\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return null;

  const issuedAtMs = Number(match[1]);
  if (!Number.isSafeInteger(issuedAtMs)) return null;

  const expected = Buffer.from(sign(secret, identity, issuedAtMs));
  const actual = Buffer.from(match[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  return issuedAtMs;
}
