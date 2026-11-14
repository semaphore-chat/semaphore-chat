import { randomBytes } from 'crypto';

/**
 * A random invite code: `length` URL-safe base64 characters (72 bits at the
 * default 12). Callers that create invites must still check for collisions.
 */
export function generateInviteCode(length = 12): string {
  return randomBytes(length).toString('base64url').slice(0, length);
}
