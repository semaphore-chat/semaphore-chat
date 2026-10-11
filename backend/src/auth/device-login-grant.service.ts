import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { REDIS_CLIENT } from '@/redis/redis.constants';
import { DatabaseService } from '@/database/database.service';
import { UserEntity } from '@/user/dto/user-response.dto';
import { AuthService, DeviceInfo } from './auth.service';
import {
  AccessTokenClaims,
  TokenBlacklistService,
} from './token-blacklist.service';

/**
 * How long an approved grant can be redeemed. The desktop app redeems it
 * the moment the browser hands it the code (a loopback redirect), so a
 * minute is plenty; anything longer only widens the window for a code that
 * leaked through browser history.
 */
export const APPROVED_GRANT_TTL_SECONDS = 60;

const GRANT_PREFIX = 'auth:device-login-grant:';

/** Grant ids: 32 random bytes, base64url (43 characters). */
const GRANT_ID_BYTES = 32;

/**
 * PKCE (RFC 7636): a verifier is 43-128 unreserved characters; an S256
 * challenge is the base64url SHA-256 of it, always 43 characters.
 */
export const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
export const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const GRANT_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Where a grant is in its life:
 * - pending: a device asked to be signed in and waits for someone to
 *   approve it (QR login, not built yet);
 * - claimed: a signed-in device picked it up (scanned the QR code) and
 *   shows the user what they are approving (QR login, not built yet);
 * - approved: a signed-in user approved it; the requesting device can
 *   redeem it once, with the PKCE verifier, for a session of its own.
 *
 * Sign in with browser (desktop) creates its grant approved: the browser
 * the user is signed in on approves it in the same step.
 */
export type DeviceLoginGrantStatus = 'pending' | 'claimed' | 'approved';

/** The device that asked for (and will redeem) a grant, as it introduced itself. */
export interface DeviceLoginRequesterInfo {
  userAgent?: string;
  ipAddress?: string;
  deviceId?: string;
}

/** The access token a grant was approved with: its session and issue time. */
export interface DeviceLoginApprover {
  jti?: string;
  iat?: number;
  iatMs?: number;
}

export interface DeviceLoginGrant {
  id: string;
  status: DeviceLoginGrantStatus;
  /** S256 PKCE challenge: only the holder of its verifier can redeem. */
  codeChallenge: string;
  /** Unknown for the desktop flow until redeem (the browser approves). */
  requesterInfo: DeviceLoginRequesterInfo | null;
  /** The user the grant signs in, once approved. */
  userId: string | null;
  /** The session (refresh token family) of the approver's access token. */
  approverFamilyId: string | null;
  approver: DeviceLoginApprover | null;
  /** When it was approved, ms since epoch. */
  approvedAt: number | null;
}

/**
 * Takes an approved grant out of Redis in one step: a grant can be redeemed
 * once, and a grant that isn't approved yet stays (its device may ask again
 * once it is). Anything else (missing, expired, unreadable) is nil.
 */
const REDEEM_APPROVED_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then return false end
local ok, grant = pcall(cjson.decode, value)
if not ok or type(grant) ~= 'table' or grant.status ~= 'approved' then
  return false
end
redis.call('DEL', KEYS[1])
return value
`;

/** Why a redeem failed. The API answers all of them the same way. */
export type RedeemFailure =
  'unknown-grant' | 'wrong-verifier' | 'approver-revoked' | 'user-unavailable';

export type RedeemResult =
  | { ok: true; refreshToken: string; accessToken: string; userId: string }
  | { ok: false; reason: RedeemFailure };

/**
 * Grants that let a device sign in through another, already signed-in one:
 * "Sign in with browser" in the desktop app now, QR login later. Stored in
 * Redis (like RefreshTokenGraceService), keyed by a hash of the grant id so
 * what Redis holds can't be redeemed by itself; the id alone is useless
 * without the PKCE verifier, which never leaves the requesting device.
 */
@Injectable()
export class DeviceLoginGrantService {
  private readonly logger = new Logger(DeviceLoginGrantService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly databaseService: DatabaseService,
    private readonly authService: AuthService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {}

  /**
   * Create a grant approved by the signed-in user right away (the desktop
   * app's browser sign-in: the user confirmed it in the browser).
   * @param approver - The verified claims of the access token the approval
   *   came with; it must belong to a session (`sid`)
   * @returns The grant id, which the requesting device redeems
   */
  async createApproved(
    codeChallenge: string,
    approver: AccessTokenClaims & { sid: string },
  ): Promise<{ id: string; expiresInSeconds: number }> {
    // The DTO checks it too; this service may get other callers (QR login)
    if (!CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
      throw new BadRequestException('Invalid code challenge');
    }
    const id = randomBytes(GRANT_ID_BYTES).toString('base64url');
    const grant: DeviceLoginGrant = {
      id,
      status: 'approved',
      codeChallenge,
      requesterInfo: null,
      userId: approver.sub,
      approverFamilyId: approver.sid,
      approver: { jti: approver.jti, iat: approver.iat, iatMs: approver.iatMs },
      approvedAt: Date.now(),
    };
    await this.redis.set(
      this.keyFor(id),
      JSON.stringify(grant),
      'EX',
      APPROVED_GRANT_TTL_SECONDS,
    );
    return { id, expiresInSeconds: APPROVED_GRANT_TTL_SECONDS };
  }

  /**
   * Redeem an approved grant for a new session on the redeeming device.
   * Single use: the grant is gone after the first attempt, right or wrong.
   * Refused when the verifier doesn't match the challenge, or when the
   * approval no longer stands: the approving session ended (logout,
   * revocation), the user's password was reset or the account was banned
   * or deleted since.
   * @param deviceInfo - The REDEEMING device's (user agent, IP, device id):
   *   the new session is that device's, listed and revoked like any other
   */
  async redeem(
    id: string,
    codeVerifier: string,
    deviceInfo: DeviceInfo,
  ): Promise<RedeemResult> {
    const raw = (await this.redis.eval(
      REDEEM_APPROVED_SCRIPT,
      1,
      this.keyFor(id),
    )) as string | null;
    const grant = raw ? this.parse(raw) : null;
    if (!grant || !grant.userId || !grant.approverFamilyId) {
      return { ok: false, reason: 'unknown-grant' };
    }

    if (!this.verifierMatches(codeVerifier, grant.codeChallenge)) {
      this.logger.warn(
        `Device login grant redeemed with the wrong verifier (user ${grant.userId})`,
      );
      return { ok: false, reason: 'wrong-verifier' };
    }

    // The user as of now, with the password hash issueLoginTokens compares
    // under its lock: a password reset committing after this read refuses
    // the sign-in there; one before it set the cutoff checked below
    const user = await this.databaseService.user.findUnique({
      where: { id: grant.userId },
    });
    if (!user || user.banned) {
      return { ok: false, reason: 'user-unavailable' };
    }

    if (!(await this.approvalStands(grant))) {
      this.logger.warn(
        `Device login grant refused: the approving session of user ${grant.userId} ended or was revoked`,
      );
      return { ok: false, reason: 'approver-revoked' };
    }

    const tokens = await this.authService.issueLoginTokens(
      new UserEntity(user),
      deviceInfo,
    );
    return { ok: true, ...tokens, userId: user.id };
  }

  /**
   * Whether the session that approved a grant is still live: its refresh
   * tokens exist, and neither it, the access token it approved with nor
   * the user (password reset cutoff) has been revoked since.
   */
  private async approvalStands(grant: DeviceLoginGrant): Promise<boolean> {
    if (!grant.userId || !grant.approverFamilyId) return false;
    const live = await this.databaseService.refreshToken.findFirst({
      where: {
        userId: grant.userId,
        familyId: grant.approverFamilyId,
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!live) return false;
    const revoked = await this.tokenBlacklistService.isRevoked({
      sub: grant.userId,
      sid: grant.approverFamilyId,
      jti: grant.approver?.jti,
      iat: grant.approver?.iat,
      iatMs: grant.approver?.iatMs,
    });
    return !revoked;
  }

  private verifierMatches(verifier: string, challenge: string): boolean {
    if (!CODE_VERIFIER_PATTERN.test(verifier)) return false;
    const computed = Buffer.from(
      createHash('sha256').update(verifier).digest('base64url'),
    );
    const expected = Buffer.from(challenge);
    return (
      computed.length === expected.length && timingSafeEqual(computed, expected)
    );
  }

  private parse(raw: string): DeviceLoginGrant | null {
    try {
      const grant = JSON.parse(raw) as DeviceLoginGrant;
      return grant && typeof grant === 'object' ? grant : null;
    } catch {
      return null;
    }
  }

  private keyFor(id: string): string {
    return `${GRANT_PREFIX}${createHash('sha256').update(id).digest('hex')}`;
  }
}
