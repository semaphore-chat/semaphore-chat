import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { REDIS_CLIENT } from '@/redis/redis.constants';

/**
 * How long after a refresh token was rotated it may still be presented and
 * get the token it was rotated to, instead of counting as reuse.
 *
 * The same token legitimately arrives more than once when requests overlap:
 * - tabs of one browser share the refresh cookie, so tabs that refresh
 *   together (a restored session, several tabs waking up) send the same
 *   token; rotations of one token run one at a time (a row lock), a couple
 *   of bcrypt operations each, so ten tabs queue for a few seconds;
 * - a response that never arrives (network drop, proxy timeout): the client
 *   gives up after 15 s and retries 1 s later, still holding the old token.
 *
 * 30 s covers both with some margin, and is the default IdPs use for this
 * (e.g. Okta's refresh token grace period). Shorter windows would sign out
 * users on slow networks; longer ones delay detecting a stolen token that
 * is replayed right after the legitimate client rotated it (a replay within
 * the window gets the session's current token instead, and the reuse is
 * caught at the next rotation conflict).
 */
export const REFRESH_TOKEN_REUSE_GRACE_MS = 30_000;

const SUCCESSOR_PREFIX = 'auth:refresh-successor:';
/** Redis keeps the successor a little longer than the window. */
const SUCCESSOR_TTL_SECONDS =
  Math.ceil(REFRESH_TOKEN_REUSE_GRACE_MS / 1000) + 5;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Remembers which refresh token a token was rotated to, for the grace
 * window (see REFRESH_TOKEN_REUSE_GRACE_MS), so re-presenting the old token
 * returns the same successor: rotation is idempotent and a session never
 * forks into two live tokens.
 *
 * The successor is stored encrypted with a key derived from the token it
 * replaces (AES-256-GCM). Only a request that presents that token can read
 * it, so what Redis holds is useless without the old refresh token.
 */
@Injectable()
export class RefreshTokenGraceService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Whether a token rotated at `consumedAt` is still within the grace window.
   * @param now - The database's current time (see databaseNow), the clock
   *   `consumedAt` was stamped with
   */
  isWithinGraceWindow(consumedAt: Date | null, now: Date): boolean {
    if (!consumedAt) return false;
    // No lower bound: a rotation that seems to lie in the future (a clock
    // that disagrees) is no sign of a stolen token
    return now.getTime() - consumedAt.getTime() <= REFRESH_TOKEN_REUSE_GRACE_MS;
  }

  /**
   * Remember that `refreshToken` (id `jti`) was rotated to `successor`.
   * Call before the rotation commits, so a request waiting for the rotation
   * finds it.
   */
  async remember(
    jti: string,
    refreshToken: string,
    successor: string,
  ): Promise<void> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.keyFor(refreshToken), iv);
    const encrypted = Buffer.concat([
      cipher.update(successor, 'utf8'),
      cipher.final(),
    ]);
    const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64',
    );
    await this.redis.set(
      `${SUCCESSOR_PREFIX}${jti}`,
      value,
      'EX',
      SUCCESSOR_TTL_SECONDS,
    );
  }

  /**
   * The token `refreshToken` (id `jti`) was rotated to, if it was rotated
   * within the grace window and presented as the same token.
   */
  async recall(jti: string, refreshToken: string): Promise<string | null> {
    const value = await this.redis.get(`${SUCCESSOR_PREFIX}${jti}`);
    if (!value) return null;
    try {
      const raw = Buffer.from(value, 'base64');
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const encrypted = raw.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.keyFor(refreshToken),
        iv,
        // Reject a truncated tag instead of checking fewer bytes
        { authTagLength: TAG_BYTES },
      );
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Not the token it was stored for, or not something we stored
      return null;
    }
  }

  private keyFor(refreshToken: string): Buffer {
    return createHash('sha256')
      .update('semaphore:refresh-successor\0')
      .update(refreshToken)
      .digest();
  }
}
