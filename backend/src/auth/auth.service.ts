import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import * as bcrypt from 'bcrypt';
import { UserEntity } from '@/user/dto/user-response.dto';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@/database/database.service';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { SessionRevocationService } from './session-revocation.service';

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

  async verifyRefreshToken(
    refreshToken: string,
  ): Promise<[UserEntity, string]> {
    const payload = await this.jwtService.verifyAsync<{
      sub: string;
      jti: string;
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

    return [new UserEntity(user), payload.jti];
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
    const token = await this.databaseService.refreshToken.findFirst({
      // userId: a user can only revoke their own sessions
      where: { id: sessionId, userId },
      select: { id: true, familyId: true },
    });
    if (!token) return false;

    await this.databaseService.refreshToken.deleteMany({
      where: token.familyId
        ? { familyId: token.familyId, userId }
        : { id: token.id, userId },
    });

    if (token.familyId) {
      await this.sessionRevocationService.revokeSessions(
        userId,
        [token.familyId],
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
    const current = await this.databaseService.refreshToken.findFirst({
      where: { id: currentTokenId, userId },
      select: { familyId: true },
    });
    const currentFamilyId = current?.familyId ?? null;

    const others = await this.databaseService.refreshToken.findMany({
      where: { userId, id: { not: currentTokenId } },
      select: { familyId: true },
    });
    const otherFamilyIds = [
      ...new Set(
        others
          .map((t) => t.familyId)
          .filter((f): f is string => !!f && f !== currentFamilyId),
      ),
    ];

    // By family, not by the rows read above: a refresh racing this rotates
    // into a new row of the same family, which must go too.
    const result = await this.databaseService.refreshToken.deleteMany({
      where: {
        userId,
        id: { not: currentTokenId },
        OR: [{ familyId: { in: otherFamilyIds } }, { familyId: null }],
      },
    });

    await this.sessionRevocationService.revokeSessions(
      userId,
      otherFamilyIds,
      'SESSION_REVOKED',
    );

    return result.count;
  }
}
