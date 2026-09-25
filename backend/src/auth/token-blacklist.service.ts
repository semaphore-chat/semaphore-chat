import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '@/redis/redis.constants';

/** Access token lifetime. Revocation markers live exactly this long. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const BLACKLIST_PREFIX = 'token:blacklist:';
const REVOKED_SESSION_PREFIX = 'token:revoked-session:';
const REVOKED_USER_PREFIX = 'token:revoked-user:';

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
      `${REVOKED_SESSION_PREFIX}${sessionId}`,
      '1',
      'EX',
      ACCESS_TOKEN_TTL_SECONDS,
    );
  }

  /**
   * Revoke every access token issued to a user up to now. Tokens issued in
   * the same second are revoked too (JWT `iat` has second precision), so a
   * sign-in racing the revocation may have to be repeated.
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.redis.set(
      `${REVOKED_USER_PREFIX}${userId}`,
      String(Math.floor(Date.now() / 1000)),
      'EX',
      ACCESS_TOKEN_TTL_SECONDS,
    );
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
    const [blacklisted, sessionRevoked, userCutoff] = await this.redis.mget(
      `${BLACKLIST_PREFIX}${claims.jti ?? ''}`,
      `${REVOKED_SESSION_PREFIX}${claims.sid ?? ''}`,
      `${REVOKED_USER_PREFIX}${claims.sub}`,
    );

    if (claims.jti && blacklisted !== null) return 'token';
    if (claims.sid && sessionRevoked !== null) return 'session';
    if (userCutoff !== null) {
      // A token without iat can't prove it was issued after the cutoff.
      if (typeof claims.iat !== 'number') return 'user';
      if (claims.iat <= Number(userCutoff)) return 'user';
    }
    return null;
  }
}
