import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import * as bcrypt from 'bcrypt';
import { UserEntity } from '@/user/dto/user-response.dto';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@/database/database.service';
import { ConfigService } from '@nestjs/config';
import { Prisma, RefreshToken } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { SessionRevocationService } from './session-revocation.service';
import {
  lockRefreshToken,
  lockUserForLogin,
  lockUserForSessionRevocation,
} from './session-lock.util';
import { RefreshTokenGraceService } from './refresh-token-grace.service';

/**
 * How many rotations findGraceSuccessor follows. Each is a refresh within the
 * grace window; more than this in 30 s is not a browser.
 */
const MAX_GRACE_HOPS = 5;

export interface DeviceInfo {
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionInfo {
  id: string;
  deviceName: string;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

@Injectable()
export class AuthService {
  private readonly jwtRefreshSecret: string | undefined;
  private readonly logger = new Logger(AuthService.name);
  // Dummy hash for timing-attack prevention - bcrypt.compare() must always run
  private readonly DUMMY_HASH = bcrypt.hashSync(
    'dummy-timing-attack-prevention',
    10,
  );
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly databaseService: DatabaseService,
    configService: ConfigService,
    private readonly sessionRevocationService: SessionRevocationService,
    private readonly refreshTokenGraceService: RefreshTokenGraceService,
  ) {
    this.jwtRefreshSecret = configService.get<string>('JWT_REFRESH_SECRET');
    if (!this.jwtRefreshSecret) {
      throw new Error('JWT_REFRESH_SECRET not set');
    }
  }

  async validateUser(
    username: string,
    pass: string,
  ): Promise<UserEntity | null> {
    const user = await this.userService.findByUsername(
      username.toLocaleLowerCase(),
    );
    if (user) {
      if (await bcrypt.compare(pass, user.hashedPassword)) {
        return new UserEntity(user);
      }
    } else {
      // Always run bcrypt.compare to prevent timing-based user enumeration
      await bcrypt.compare(pass, this.DUMMY_HASH);
    }

    return null;
  }

  /**
   * Sign an access token.
   * @param sessionId - The refresh token family the token is issued from
   *   (`sid` claim), so revoking the session revokes its access tokens.
   */
  login(user: UserEntity, sessionId?: string) {
    const jti = randomUUID();
    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
      jti,
      ...(sessionId ? { sid: sessionId } : {}),
    };
    return this.jwtService.sign(payload);
  }

  /**
   * Issue the tokens of a new session for a user whose password was just
   * checked (LocalStrategy).
   *
   * Serialized with password resets through the user row lock (see
   * session-lock.util): a reset that commits first changed the password, so
   * the login is refused (the password it checked is no longer the
   * account's); one that comes second deletes the refresh token issued here
   * and sets its cutoff after this access token was signed.
   * @param user - The user as loaded when the password was checked, with
   *   the password hash it was checked against
   */
  async issueLoginTokens(
    user: UserEntity,
    deviceInfo: DeviceInfo,
  ): Promise<{ refreshToken: string; accessToken: string }> {
    return this.databaseService.$transaction(async (tx) => {
      const current = await lockUserForLogin(tx, user.id);
      if (!current || current.hashedPassword !== user.hashedPassword) {
        this.logger.warn(
          `Login refused: the password of user ${user.id} changed while signing in`,
        );
        throw new UnauthorizedException();
      }
      const { refreshToken, sessionId } = await this.generateRefreshToken(
        user.id,
        deviceInfo,
        tx,
      );
      // Signed before the commit (see above)
      return { refreshToken, accessToken: this.login(user, sessionId) };
    });
  }

  /**
   * The session's current refresh token, for a refresh token presented again
   * within the grace window after it was rotated (see
   * RefreshTokenGraceService): what the rotation that consumed it returned,
   * or what that token was rotated to in turn.
   *
   * Hands out an existing token, never a new one, so the session doesn't
   * fork. Call in the refresh's transaction, with the presented token locked
   * (lockRefreshToken).
   * @returns The token and its session, or null if there is nothing to hand
   *   out (not remembered, revoked, expired, rotated outside the window)
   */
  async findGraceSuccessor(
    presented: RefreshToken,
    presentedToken: string,
    tx: Prisma.TransactionClient,
  ): Promise<{
    refreshToken: string;
    sessionId: string | null;
    iat?: number;
  } | null> {
    let current = { record: presented, token: presentedToken };
    for (let hop = 0; hop < MAX_GRACE_HOPS; hop++) {
      const successor = await this.refreshTokenGraceService.recall(
        current.record.id,
        current.token,
      );
      if (!successor) return null;

      let claims: { sub: string; jti: string; iat?: number };
      try {
        claims = await this.jwtService.verifyAsync(successor, {
          secret: this.jwtRefreshSecret,
        });
      } catch {
        return null;
      }
      // A rotation of the successor in progress finishes first
      await lockRefreshToken(tx, claims.jti);
      const record = await tx.refreshToken.findUnique({
        where: { id: claims.jti },
      });
      if (
        !record ||
        record.userId !== presented.userId ||
        (presented.familyId !== null &&
          record.familyId !== presented.familyId) ||
        record.expiresAt <= new Date()
      ) {
        return null;
      }
      if (!record.consumed) {
        return {
          refreshToken: successor,
          sessionId: record.familyId,
          iat: claims.iat,
        };
      }
      if (
        !this.refreshTokenGraceService.isWithinGraceWindow(record.consumedAt)
      ) {
        return null;
      }
      current = { record, token: successor };
    }
    return null;
  }

  /**
   * End a session whose refresh token was reused outside the grace window
   * (a stolen token): delete its refresh tokens, revoke its access tokens
   * and disconnect its sockets.
   */
  async revokeReusedSession(userId: string, familyId: string): Promise<void> {
    await this.databaseService.$transaction(async (tx) => {
      // Serialized with refreshes (see session-lock.util): a rotation of the
      // session in progress completes first and its new token goes too
      await lockUserForSessionRevocation(tx, userId);
      await tx.refreshToken.deleteMany({ where: { familyId, userId } });
    });
    await this.sessionRevocationService.revokeSessions(
      userId,
      [familyId],
      'SESSION_REVOKED',
    );
  }

  /**
   * Verify a refresh token's signature and expiry and load its user.
   * @returns The user, the token id (jti) and when the token was issued
   *   (iat, seconds since epoch)
   */
  async verifyRefreshToken(
    refreshToken: string,
  ): Promise<[UserEntity, string, number?]> {
    const payload = await this.jwtService.verifyAsync<{
      sub: string;
      jti: string;
      iat?: number;
    }>(refreshToken, {
      secret: this.jwtRefreshSecret,
      ignoreExpiration: false,
    });

    if (!payload) {
      throw new UnauthorizedException('Could not verify refresh token');
    }

    const user = await this.userService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Could not find user');
    }

    return [new UserEntity(user), payload.jti, payload.iat];
  }

  async generateRefreshToken(
    userId: string,
    deviceInfo?: DeviceInfo,
    tx?: Prisma.TransactionClient,
    familyId?: string,
  ): Promise<{ refreshToken: string; sessionId: string }> {
    const jti = randomUUID();
    const sessionId = familyId ?? randomUUID();
    const refreshToken = this.jwtService.sign(
      { sub: userId, jti },
      {
        secret: this.jwtRefreshSecret,
        expiresIn: '30d',
      },
    );

    const hashed = await bcrypt.hash(refreshToken, 10);
    const client = tx ?? this.databaseService;
    const deviceName = deviceInfo?.userAgent
      ? this.parseDeviceName(deviceInfo.userAgent)
      : 'Unknown Device';

    // Fresh login (no familyId) — deduplicate sessions for same device
    if (!familyId) {
      await client.refreshToken.deleteMany({
        where: { userId, deviceName, consumed: false },
      });
    }

    await client.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: hashed,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        deviceName,
        userAgent: deviceInfo?.userAgent,
        ipAddress: deviceInfo?.ipAddress,
        lastUsedAt: new Date(),
        familyId: sessionId,
      },
    });

    // The family id is the session id access tokens carry (`sid`)
    return { refreshToken, sessionId };
  }

  /**
   * Parse user agent string into a friendly device name
   */
  private parseDeviceName(userAgent: string): string {
    const ua = userAgent.toLowerCase();

    // Check for Electron app first
    if (ua.includes('electron')) {
      if (ua.includes('windows')) return 'Semaphore Chat Desktop (Windows)';
      if (ua.includes('mac')) return 'Semaphore Chat Desktop (macOS)';
      if (ua.includes('linux')) return 'Semaphore Chat Desktop (Linux)';
      return 'Semaphore Chat Desktop';
    }

    // Check for mobile devices
    if (ua.includes('iphone')) return 'Safari on iPhone';
    if (ua.includes('ipad')) return 'Safari on iPad';
    if (ua.includes('android')) {
      if (ua.includes('chrome')) return 'Chrome on Android';
      if (ua.includes('firefox')) return 'Firefox on Android';
      return 'Browser on Android';
    }

    // Desktop browsers
    let browser = 'Browser';
    if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('chrome')) browser = 'Chrome';
    else if (ua.includes('firefox')) browser = 'Firefox';
    else if (ua.includes('safari')) browser = 'Safari';
    else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

    let os = '';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('mac os')) os = 'macOS';
    else if (ua.includes('linux')) os = 'Linux';
    else if (ua.includes('cros')) os = 'Chrome OS';

    return os ? `${browser} on ${os}` : browser;
  }

  /**
   * Mark a refresh token as consumed (used for rotation).
   * Returns the consumed token record (caller needs familyId).
   */
  async consumeRefreshToken(
    jti: string,
    refreshToken: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.databaseService;
    const token = await this.findMatchingToken(jti, refreshToken, tx);

    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await client.refreshToken.update({
      where: { id: token.id },
      data: { consumed: true, consumedAt: new Date() },
    });

    return token;
  }

  /**
   * Delete a refresh token outright (used for logout).
   * Also deletes all consumed tokens in the same family.
   * @returns The deleted session's id (family id), if it has one
   */
  async deleteRefreshToken(
    jti: string,
    refreshToken: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const client = tx ?? this.databaseService;
    const token = await this.findMatchingToken(jti, refreshToken, tx);

    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Delete this token and all tokens in the same family
    if (token.familyId) {
      await client.refreshToken.deleteMany({
        where: {
          familyId: token.familyId,
        },
      });
    } else {
      await client.refreshToken.delete({ where: { id: token.id } });
    }
    return token.familyId;
  }

  /**
   * Validate a refresh token and return the full token record.
   * Includes consumed/familyId fields for reuse detection.
   */
  async validateRefreshToken(
    jti: string,
    refreshToken: string,
    tx?: Prisma.TransactionClient,
  ) {
    const token = await this.findMatchingToken(jti, refreshToken, tx);
    if (token && token.expiresAt > new Date()) {
      return token;
    }

    return null;
  }

  /**
   * Invalidate an entire token family (all tokens from the same login session).
   * Called when refresh token reuse is detected.
   */
  async invalidateTokenFamily(
    familyId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const client = tx ?? this.databaseService;
    const result = await client.refreshToken.deleteMany({
      where: { familyId },
    });
    return result.count;
  }

  private async findMatchingToken(
    jti: string,
    refreshToken: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.databaseService;
    const token = await client.refreshToken.findUnique({
      where: { id: jti },
    });

    // Always run bcrypt.compare() to prevent timing attacks
    // If token doesn't exist, compare against dummy hash to maintain consistent timing
    const isMatch = await bcrypt.compare(
      refreshToken,
      token?.tokenHash ?? this.DUMMY_HASH,
    );

    if (isMatch && token) {
      return token;
    }

    return null;
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async cleanExpiredTokens() {
    const [expired, consumed] = await Promise.all([
      this.databaseService.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      this.databaseService.refreshToken.deleteMany({
        where: {
          consumed: true,
          consumedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    this.logger.log(
      `Cleaned up ${expired.count} expired and ${consumed.count} consumed refresh tokens.`,
    );
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(
    userId: string,
    currentTokenId?: string,
  ): Promise<SessionInfo[]> {
    const tokens = await this.databaseService.refreshToken.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
        consumed: false,
      },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceName: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });

    return tokens.map((token) => ({
      id: token.id,
      deviceName: token.deviceName || 'Unknown Device',
      ipAddress: token.ipAddress,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      expiresAt: token.expiresAt,
      isCurrent: token.id === currentTokenId,
    }));
  }

  /**
   * Revoke a specific session: delete its refresh tokens, revoke the access
   * tokens issued from it and disconnect its sockets.
   * @param sessionId - The session's current refresh token id (what
   *   getUserSessions lists as the session id)
   */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const familyId = await this.databaseService.$transaction(async (tx) => {
      // Serialized with refreshes (see session-lock.util)
      await lockUserForSessionRevocation(tx, userId);
      const token = await tx.refreshToken.findFirst({
        // userId: a user can only revoke their own sessions
        where: { id: sessionId, userId },
        select: { id: true, familyId: true },
      });
      if (!token) return undefined;

      await tx.refreshToken.deleteMany({
        where: token.familyId
          ? { familyId: token.familyId, userId }
          : { id: token.id, userId },
      });
      return token.familyId;
    });
    if (familyId === undefined) return false;

    if (familyId) {
      await this.sessionRevocationService.revokeSessions(
        userId,
        [familyId],
        'SESSION_REVOKED',
      );
    }

    return true;
  }

  /**
   * Revoke all sessions except the current one: delete their refresh tokens,
   * revoke the access tokens issued from them and disconnect their sockets.
   */
  async revokeAllOtherSessions(
    userId: string,
    currentTokenId: string,
  ): Promise<number> {
    const { count, otherFamilyIds } = await this.databaseService.$transaction(
      async (tx) => {
        // Serialized with refreshes (see session-lock.util)
        await lockUserForSessionRevocation(tx, userId);
        const current = await tx.refreshToken.findFirst({
          where: { id: currentTokenId, userId },
          select: { familyId: true },
        });
        const currentFamilyId = current?.familyId ?? null;

        const others = await tx.refreshToken.findMany({
          where: { userId, id: { not: currentTokenId } },
          select: { familyId: true },
        });
        const familyIds = [
          ...new Set(
            others
              .map((t) => t.familyId)
              .filter((f): f is string => !!f && f !== currentFamilyId),
          ),
        ];

        const result = await tx.refreshToken.deleteMany({
          where: {
            userId,
            id: { not: currentTokenId },
            OR: [{ familyId: { in: familyIds } }, { familyId: null }],
          },
        });
        return { count: result.count, otherFamilyIds: familyIds };
      },
    );

    await this.sessionRevocationService.revokeSessions(
      userId,
      otherFamilyIds,
      'SESSION_REVOKED',
    );

    return count;
  }
}
