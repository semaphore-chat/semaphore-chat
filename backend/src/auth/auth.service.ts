import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import * as bcrypt from 'bcrypt';
import { UserEntity } from '@/user/dto/user-response.dto';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '@/database/database.service';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ObjectId } from 'mongodb';

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
  private readonly DUMMY_HASH =
    '$2b$10$dummyhashfortimingattackprevention000000000000000';
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly databaseService: DatabaseService,
    configService: ConfigService,
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

  login(user: UserEntity) {
    const jti = new ObjectId().toHexString();
    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
      jti,
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
  ) {
    // generate a MongoDB ObjectId for the jti
    const jti = new ObjectId().toHexString();
    const refreshToken = this.jwtService.sign(
      { sub: userId, jti },
      {
        secret: this.jwtRefreshSecret,
        expiresIn: '30d',
      },
    );

    const hashed = await bcrypt.hash(refreshToken, 10);
    const client = tx ?? this.databaseService;
    await client.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: hashed,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        deviceName: deviceInfo?.userAgent
          ? this.parseDeviceName(deviceInfo.userAgent)
          : 'Unknown Device',
        userAgent: deviceInfo?.userAgent,
        ipAddress: deviceInfo?.ipAddress,
        lastUsedAt: new Date(),
        familyId: familyId ?? new ObjectId().toHexString(),
      },
    });

    return refreshToken;
  }

  /**
   * Parse user agent string into a friendly device name
   */
  private parseDeviceName(userAgent: string): string {
    const ua = userAgent.toLowerCase();

    // Check for Electron app first
    if (ua.includes('electron')) {
      if (ua.includes('windows')) return 'Kraken Desktop (Windows)';
      if (ua.includes('mac')) return 'Kraken Desktop (macOS)';
      if (ua.includes('linux')) return 'Kraken Desktop (Linux)';
      return 'Kraken Desktop';
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
   */
  async deleteRefreshToken(
    jti: string,
    refreshToken: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.databaseService;
    const token = await this.findMatchingToken(jti, refreshToken, tx);

    if (!token) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Delete this token and all consumed tokens in the same family
    if (token.familyId) {
      await client.refreshToken.deleteMany({
        where: {
          OR: [{ id: token.id }, { familyId: token.familyId, consumed: true }],
        },
      });
    } else {
      await client.refreshToken.delete({ where: { id: token.id } });
    }
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
   * Revoke a specific session (delete refresh token)
   */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.databaseService.refreshToken.deleteMany({
      where: {
        id: sessionId,
        userId, // Ensure user can only revoke their own sessions
      },
    });

    return result.count > 0;
  }

  /**
   * Revoke all sessions except the current one
   */
  async revokeAllOtherSessions(
    userId: string,
    currentTokenId: string,
  ): Promise<number> {
    const result = await this.databaseService.refreshToken.deleteMany({
      where: {
        userId,
        id: { not: currentTokenId },
      },
    });

    return result.count;
  }
}
