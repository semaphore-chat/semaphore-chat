import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DatabaseService } from '@/database/database.service';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { revokedSessionKey } from '@/auth/token-blacklist.service';
import {
  LIVEKIT_ISSUED_AT_ATTRIBUTE,
  LIVEKIT_SESSION_ATTRIBUTE,
  verifyIssuedAt,
  verifySessionId,
} from './livekit-token-attributes.util';

/** Why a participant may not stay in a LiveKit room. */
export type LivekitJoinDenial =
  'USER_DELETED' | 'USER_BANNED' | 'TOKEN_REVOKED' | 'SESSION_REVOKED';

const TOKEN_CUTOFF_PREFIX = 'livekit:token_cutoff:';

/**
 * How long a user's LiveKit token cutoff is kept. A token we issue lives at
 * most 1h (CreateTokenDto caps `ttl` at 3600s), but LiveKit keeps handing a
 * connected client refreshed tokens (with the original attributes), so a
 * client that stayed connected through a failed removal could hold a valid
 * pre-cutoff token for longer. One key per revocation is cheap: keep it a day.
 */
const TOKEN_CUTOFF_TTL_SECONDS = 24 * 60 * 60;

/**
 * Who may be in a LiveKit room, checked when LiveKit reports a join
 * (`participant_joined` webhook). LiveKit tokens can't be revoked, so this is
 * the safety net behind SessionRevocationHandler removing a revoked user from
 * their rooms: a client that still holds an old token gets removed again as
 * soon as it rejoins.
 */
@Injectable()
export class LivekitAccessService {
  private readonly logger = new Logger(LivekitAccessService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Reject the user's LiveKit tokens issued up to now (password changed,
   * banned, deleted): a later join with one of them is removed by the webhook.
   */
  async revokeTokensIssuedBefore(
    userId: string,
    cutoffMs: number = Date.now(),
  ): Promise<void> {
    await this.redis.set(
      `${TOKEN_CUTOFF_PREFIX}${userId}`,
      String(cutoffMs),
      'EX',
      TOKEN_CUTOFF_TTL_SECONDS,
    );
  }

  /**
   * The auth session a participant's token was issued to, from its signed
   * session attribute; null when the attribute is missing (tokens issued
   * before sessions were recorded, or outside a session) or isn't validly
   * signed for this identity.
   */
  sessionOf(
    identity: string,
    attributes: Record<string, string> | undefined,
  ): string | null {
    const secret = this.configService.get<string>('LIVEKIT_API_SECRET');
    if (!secret) return null;
    return verifySessionId(
      secret,
      identity,
      attributes?.[LIVEKIT_SESSION_ATTRIBUTE],
    );
  }

  /**
   * Whether a participant that just joined must be removed: the user is
   * deleted or banned, their token was issued before a revocation cutoff (or
   * carries no valid issue time while a cutoff is in force), or the session
   * the token was issued to has been revoked (logout, "revoke session"). One
   * primary key lookup and one Redis round trip, in parallel.
   *
   * A token without a valid session attribute isn't denied for that alone:
   * tokens issued before sessions were recorded have none.
   *
   * Fails open (null) when the lookups fail: this runs on every join, and a
   * database or Redis blip must not kick everyone out of voice. Revocation
   * itself removes users directly (SessionRevocationHandler).
   */
  async checkJoin(
    identity: string,
    attributes: Record<string, string> | undefined,
  ): Promise<LivekitJoinDenial | null> {
    const sessionId = this.sessionOf(identity, attributes);
    const cutoffKey = `${TOKEN_CUTOFF_PREFIX}${identity}`;

    let user: { banned: boolean } | null;
    let cutoff: string | null;
    let sessionRevoked: string | null;
    try {
      [user, [cutoff, sessionRevoked]] = await Promise.all([
        this.databaseService.user.findUnique({
          where: { id: identity },
          select: { banned: true },
        }),
        sessionId
          ? this.redis.mget(cutoffKey, revokedSessionKey(sessionId))
          : this.redis.get(cutoffKey).then((value) => [value, null]),
      ]);
    } catch (error) {
      this.logger.error(
        `Could not check LiveKit access of ${identity}; allowing the join: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    // Deletion is a hard delete and records a cutoff, so a missing user with
    // a cutoff is a deleted account. Without one the identity was never a
    // user (e.g. scripts/livekit-test-participant.sh's `test-bot`, minted with
    // the API secret): we only issue tokens to existing users, and any token
    // of an account deleted before the cutoff expired is long dead.
    if (!user) return cutoff !== null ? 'USER_DELETED' : null;
    if (user.banned) return 'USER_BANNED';

    if (cutoff !== null) {
      const secret = this.configService.get<string>('LIVEKIT_API_SECRET');
      const issuedAtMs = secret
        ? verifyIssuedAt(
            secret,
            identity,
            attributes?.[LIVEKIT_ISSUED_AT_ATTRIBUTE],
          )
        : null;
      // No provable issue time while a cutoff is in force: treat as stale
      if (issuedAtMs === null || issuedAtMs <= Number(cutoff)) {
        return 'TOKEN_REVOKED';
      }
    }

    // The revoked-session marker lives as long as an access token (1h), as
    // long as the LiveKit tokens issued to that session before it was
    // revoked (CreateTokenDto caps their ttl at 3600s)
    if (sessionRevoked !== null) return 'SESSION_REVOKED';

    return null;
  }
}
