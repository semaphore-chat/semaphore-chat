import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/redis/redis.constants';

/** Access token lifetime. Revocation markers live exactly this long. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const BLACKLIST_PREFIX = 'token:blacklist:';
const REVOKED_SESSION_PREFIX = 'token:revoked-session:';
/**
 * A user's cutoff in whole seconds: what instances before #562 write and
 * read. Still written (for instances of the previous release during a rolling
 * deploy) and read (for cutoffs set before the deploy); drop both one release
 * after #562.
 */
const REVOKED_USER_PREFIX = 'token:revoked-user:';
/**
 * A user's cutoff in milliseconds (#562). A key of its own rather than the
 * old one with a value of another magnitude: an older instance reading a
 * millisecond value as seconds would revoke every token of the user.
 */
const REVOKED_USER_MS_PREFIX = 'token:revoked-user-ms:';

/**
 * The Redis key that marks a session revoked (`revokeSession`), present for
 * ACCESS_TOKEN_TTL_SECONDS after the revocation. Exported so other checks of
 * a session (the LiveKit join check) can read it in the same round trip as
 * their own keys.
 */
export function revokedSessionKey(sessionId: string): string {
  return `${REVOKED_SESSION_PREFIX}${sessionId}`;
}

/** The access token claims revocation is decided on. */
export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Token id (one per access token). */
  jti?: string;
  /**
   * Session id: the refresh token family the access token was issued from.
   * Absent on tokens issued before sessions were tracked.
   */
  sid?: string;
  /** Issued at (seconds since epoch). */
  iat?: number;
  /**
   * Issued at (milliseconds since epoch), so a token issued later in the
   * same second as a user's cutoff isn't revoked by it (#562). Absent on
   * tokens issued before it was added.
   */
  iatMs?: number;
  /** Expiry (seconds since epoch). */
  exp?: number;
}

/** What revoked a token (see TokenBlacklistService.revocationOf). */
export type TokenRevocation = 'token' | 'session' | 'user' | null;

/**
 * Redis-backed access token revocation. Access tokens are stateless JWTs, so
 * revoking one before it expires means remembering it here until it would
 * have expired anyway:
 *
 * - one token (logout): its jti
 * - one session (logout, "revoke session"): its sid, i.e. every access token
 *   issued from that refresh token family
 * - every token of a user (password reset): a cutoff; tokens issued at or
 *   before it are revoked
 */
@Injectable()
export class TokenBlacklistService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Add a token JTI to the blacklist with a TTL matching the token's remaining lifetime.
   * @param jti - The JWT ID to blacklist
   * @param expiresAt - Token expiration timestamp (seconds since epoch)
   */
  async blacklist(jti: string, expiresAt: number): Promise<void> {
    const ttlSeconds = expiresAt - Math.floor(Date.now() / 1000);
    if (ttlSeconds <= 0) {
      // Token already expired, no need to blacklist
      return;
    }
    await this.redis.set(`${BLACKLIST_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
  }

  /**
   * Check if a token JTI is blacklisted.
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    const result = await this.redis.exists(`${BLACKLIST_PREFIX}${jti}`);
    return result === 1;
  }

  /**
   * Revoke every access token issued from a session (refresh token family).
   * Only call this once the session's refresh tokens are gone, or the session
   * would keep minting access tokens that are rejected.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.redis.set(
      revokedSessionKey(sessionId),
      '1',
      'EX',
      ACCESS_TOKEN_TTL_SECONDS,
    );
  }

  /**
   * Revoke every access token issued to a user up to now (to the
   * millisecond: a token issued after this returns isn't revoked, even in the
   * same second, if it carries `iatMs`).
   *
   * The cutoff and `iatMs` come from different instances' clocks. Tokens
   * this must revoke were signed before the revoking change committed (see
   * session-lock.util), so a skew smaller than that gap doesn't matter.
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    const cutoffMs = Date.now();
    await Promise.all([
      this.redis.set(
        `${REVOKED_USER_MS_PREFIX}${userId}`,
        String(cutoffMs),
        'EX',
        ACCESS_TOKEN_TTL_SECONDS,
      ),
      this.redis.set(
        `${REVOKED_USER_PREFIX}${userId}`,
        String(Math.floor(cutoffMs / 1000)),
        'EX',
        ACCESS_TOKEN_TTL_SECONDS,
      ),
    ]);
  }

  /**
   * Whether an access token was revoked by any of the above: its jti, its
   * session, or a cutoff for its user. One Redis round trip.
   */
  async isRevoked(claims: AccessTokenClaims): Promise<boolean> {
    return (await this.revocationOf(claims)) !== null;
  }

  /**
   * What revoked an access token, if anything: its jti (`token`), its
   * session (`session`) or a cutoff for its user (`user`). One Redis round
   * trip.
   */
  async revocationOf(claims: AccessTokenClaims): Promise<TokenRevocation> {
    const [blacklisted, sessionRevoked, userCutoffMs, userCutoffSeconds] =
      await this.redis.mget(
        `${BLACKLIST_PREFIX}${claims.jti ?? ''}`,
        `${REVOKED_SESSION_PREFIX}${claims.sid ?? ''}`,
        `${REVOKED_USER_MS_PREFIX}${claims.sub}`,
        `${REVOKED_USER_PREFIX}${claims.sub}`,
      );

    if (claims.jti && blacklisted !== null) return 'token';
    if (claims.sid && sessionRevoked !== null) return 'session';
    if (userCutoffMs !== null) {
      if (isIssuedAtOrBefore(claims, Number(userCutoffMs))) return 'user';
    } else if (userCutoffSeconds !== null) {
      // Set before #562: the cutoff is the end of that second, as it was
      const cutoffMs = Number(userCutoffSeconds) * 1000 + 999;
      if (isIssuedAtOrBefore(claims, cutoffMs)) return 'user';
    }
    return null;
  }
}

/**
 * Whether a token was issued at or before `cutoffMs`: to the millisecond
 * with `iatMs`; otherwise (tokens from before #562) by whole seconds, so a
 * token from the cutoff's second counts as revoked, as it always did. A token
 * without either can't prove it was issued after the cutoff.
 */
function isIssuedAtOrBefore(
  claims: Pick<AccessTokenClaims, 'iat' | 'iatMs'>,
  cutoffMs: number,
): boolean {
  if (typeof claims.iatMs === 'number' && Number.isFinite(claims.iatMs)) {
    return claims.iatMs <= cutoffMs;
  }
  if (typeof claims.iat !== 'number') return true;
  return claims.iat <= Math.floor(cutoffMs / 1000);
}
