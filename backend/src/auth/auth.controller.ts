import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse, ApiBody } from '@nestjs/swagger';
import { LocalAuthGuard } from './local-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService, DeviceInfo } from './auth.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { SessionRevocationService } from './session-revocation.service';
import { PasswordResetService } from './password-reset.service';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { DatabaseService } from '@/database/database.service';
import { AuthenticatedRequest } from '@/types';
import { setAccessTokenCookie, clearAccessTokenCookie } from './cookie-helper';
import {
  lockUserForSessionRevocation,
  lockUserForTokenRotation,
} from './session-lock.util';

import { JwtService } from '@nestjs/jwt';
import {
  LoginResponseDto,
  LogoutResponseDto,
  SessionInfoDto,
  RevokeSessionResponseDto,
  RevokeAllSessionsResponseDto,
  ForgotPasswordResponseDto,
  ResetPasswordResponseDto,
} from './dto/auth-response.dto';
import {
  LoginRequestDto,
  RefreshRequestDto,
  LogoutRequestDto,
} from './dto/auth-request.dto';
import {
  ForgotPasswordRequestDto,
  ResetPasswordRequestDto,
} from './dto/password-reset-request.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
  constructor(
    private readonly authService: AuthService,
    private readonly databaseService: DatabaseService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly jwtService: JwtService,
    private readonly passwordResetService: PasswordResetService,
    private readonly sessionRevocationService: SessionRevocationService,
  ) {}

  /**
   * Extract device info from request headers
   */
  private getDeviceInfo(req: Request): DeviceInfo {
    const userAgent = req.headers['user-agent'] || '';
    // req.ip respects the TRUST_PROXY setting configured in main.ts
    const ipAddress = req.ip || req.socket?.remoteAddress || '';
    return { userAgent, ipAddress };
  }

  @Public()
  @Throttle({ short: { limit: 4, ttl: 1000 }, long: { limit: 10, ttl: 60000 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const deviceInfo = this.getDeviceInfo(req);
    const { refreshToken, sessionId } =
      await this.authService.generateRefreshToken(req.user.id, deviceInfo);
    const accessToken = this.authService.login(req.user, sessionId);

    // Always set cookies for web clients (access token for browser media, refresh for sessions)
    setAccessTokenCookie(res, accessToken);
    this.setRefreshCookie(res, refreshToken);

    // Check if this is an Electron client
    const userAgent = req.headers['user-agent'] || '';
    const isElectron = userAgent.includes('Electron');

    // Return refresh token in body for Electron clients
    if (isElectron) {
      return { accessToken, refreshToken };
    }

    return { accessToken };
  }

  @Public()
  @Throttle({ short: { limit: 4, ttl: 1000 }, long: { limit: 10, ttl: 60000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: RefreshRequestDto })
  @ApiOkResponse({ type: LoginResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    // Check if this is an Electron client
    const userAgent = req.headers['user-agent'] || '';
    const isElectron = userAgent.includes('Electron');

    // Get refresh token from cookie or body (for Electron)
    let refreshToken = req.cookies[this.REFRESH_TOKEN_COOKIE_NAME] as
      | string
      | undefined;

    // For Electron, also check the request body
    const body = req.body as { refreshToken?: string } | undefined;
    if (!refreshToken && isElectron && body?.refreshToken) {
      refreshToken = body.refreshToken;
    }

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const [user, jti, refreshIssuedAt] =
      await this.authService.verifyRefreshToken(refreshToken);
    // A banned user keeps their refresh tokens (unbanning restores the
    // session) but can't renew access while banned.
    if (user.banned) {
      throw new UnauthorizedException('Account has been banned');
    }
    const deviceInfo = this.getDeviceInfo(req);

    // Do this in a tx so we don't have dangling refresh tokens or something weird
    const rotated = await this.databaseService.$transaction(async (tx) => {
      // First: a revocation of the user's sessions either completes before
      // this rotation or waits for it and then deletes its new token too
      const locked = await lockUserForTokenRotation(tx, user.id);
      if (!locked || locked.banned) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const tokenRecord = await this.authService.validateRefreshToken(
        jti,
        refreshToken,
        tx,
      );

      if (!tokenRecord) {
        this.logger.error('Could not find token by id');
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Reuse detection: if the token has already been consumed, someone
      // is replaying a stolen token. Invalidate the entire token family.
      if (tokenRecord.consumed) {
        this.logger.warn(
          `Refresh token reuse detected! Family: ${tokenRecord.familyId}, User: ${user.id}`,
        );
        if (tokenRecord.familyId) {
          // Deliberately NOT on the tx: the UnauthorizedException below rolls
          // the transaction back, which would silently undo the family
          // invalidation (the deletes must survive the rejected request).
          await this.authService.invalidateTokenFamily(tokenRecord.familyId);
        }
        throw new UnauthorizedException('Invalid refresh token');
      }

      // A revoked session (logout, revoke session) or a token issued before
      // a password reset can't renew itself, even if its row survived
      const revoked = await this.tokenBlacklistService.isRevoked({
        sub: user.id,
        sid: tokenRecord.familyId ?? undefined,
        iat: refreshIssuedAt,
      });
      if (revoked) {
        this.logger.warn(
          `Refresh with a revoked session. Family: ${tokenRecord.familyId}, User: ${user.id}`,
        );
        // Not on the tx, like the reuse case above
        if (tokenRecord.familyId) {
          await this.authService.invalidateTokenFamily(tokenRecord.familyId);
        } else {
          await this.databaseService.refreshToken.deleteMany({
            where: { id: tokenRecord.id },
          });
        }
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Consume (not delete) old token so reuse can be detected later
      const consumed = await this.authService.consumeRefreshToken(
        jti,
        refreshToken,
        tx,
      );
      // Generate new token in the same family
      const next = await this.authService.generateRefreshToken(
        user.id,
        deviceInfo,
        tx,
        consumed.familyId ?? undefined,
      );
      // Signed before the commit: a password reset waiting for this
      // rotation sets its cutoff after the commit, so the cutoff covers
      // this access token too
      return {
        ...next,
        accessToken: this.authService.login(user, next.sessionId),
      };
    });
    const { refreshToken: token, accessToken: newAccessToken } = rotated;

    // Always set cookies for web clients
    setAccessTokenCookie(res, newAccessToken);
    this.setRefreshCookie(res, token);

    // Return new refresh token in body for Electron clients
    if (isElectron) {
      return { accessToken: newAccessToken, refreshToken: token };
    }

    return { accessToken: newAccessToken };
  }

  /**
   * Request a password-reset email. Always returns the same 200 response
   * regardless of whether the email matches an account or the feature is
   * enabled — enumeration-safe by design (see PasswordResetService).
   */
  @Public()
  @Throttle({ short: { limit: 2, ttl: 1000 }, long: { limit: 5, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ForgotPasswordRequestDto })
  @ApiOkResponse({ type: ForgotPasswordResponseDto })
  async forgotPassword(
    @Body() dto: ForgotPasswordRequestDto,
  ): Promise<ForgotPasswordResponseDto> {
    await this.passwordResetService.requestReset(dto.email);
    return {
      message:
        'If an account with that email exists, a reset link has been sent.',
    };
  }

  /**
   * Redeem a password-reset token to set a new password. Errors are
   * intentionally generic — never reveals whether the token was wrong,
   * expired, or already used.
   */
  @Public()
  @Throttle({ short: { limit: 2, ttl: 1000 }, long: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ResetPasswordRequestDto })
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  async resetPassword(
    @Body() dto: ResetPasswordRequestDto,
  ): Promise<ResetPasswordResponseDto> {
    await this.passwordResetService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password has been reset.' };
  }

  @Throttle({ short: { limit: 2, ttl: 1000 }, long: { limit: 5, ttl: 60000 } })
  @Post('logout')
  @ApiBody({ type: LogoutRequestDto, required: false })
  @ApiCreatedResponse({ type: LogoutResponseDto })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    // Get refresh token from cookie or body (Electron sends tokens in body, not cookies)
    let refreshToken = req.cookies[this.REFRESH_TOKEN_COOKIE_NAME] as
      | string
      | undefined;
    const body = req.body as LogoutRequestDto | undefined;
    if (!refreshToken && body?.refreshToken) {
      refreshToken = body.refreshToken;
    }

    // The session this logout ends: its refresh tokens are deleted below,
    // then its access tokens are revoked and its sockets disconnected.
    let session: { userId: string; sessionId: string | null } | undefined;

    if (refreshToken) {
      try {
        session = await this.databaseService.$transaction(async (tx) => {
          const [user, jti] =
            await this.authService.verifyRefreshToken(refreshToken);
          // Serialized with refreshes: one racing this logout either
          // completes first (its new token is deleted below) or finds its
          // token gone
          await lockUserForSessionRevocation(tx, user.id);
          const sessionId = await this.authService.deleteRefreshToken(
            jti,
            refreshToken,
            tx,
          );
          return { userId: user.id, sessionId };
        });
      } catch {
        // Token may be expired or invalid — still clear the cookie
        this.logger.debug(
          'Failed to verify refresh token during logout, clearing cookie anyway',
        );
      }

      res.clearCookie(this.REFRESH_TOKEN_COOKIE_NAME);
    }

    // Blacklist the access token so it can't be reused until expiry
    const accessToken = await this.blacklistAccessToken(req);

    // Revoke the rest of the session (other tabs share it) and disconnect
    // its sockets, plus any socket using this access token.
    const userId = session?.userId ?? accessToken?.sub;
    if (userId) {
      try {
        await this.sessionRevocationService.revokeSessions(
          userId,
          session?.sessionId ? [session.sessionId] : [],
          'LOGGED_OUT',
          accessToken?.jti ? [accessToken.jti] : [],
        );
      } catch {
        this.logger.warn('Failed to revoke the session during logout');
      }
    }

    // Always clear access token cookie on logout
    clearAccessTokenCookie(res);

    return { message: 'Logged out successfully' };
  }

  /**
   * Extract and blacklist the current access token from the request.
   * Verifies the token signature before blacklisting to prevent attackers
   * from injecting arbitrary JTIs/TTLs into Redis.
   * @returns The verified token's claims, if there was a valid token
   */
  private async blacklistAccessToken(
    req: Request,
  ): Promise<{ sub: string; jti?: string } | undefined> {
    try {
      // Try to get access token from cookie or Authorization header
      const accessToken =
        (req.cookies as Record<string, string>)?.access_token ||
        req.headers.authorization?.replace('Bearer ', '');

      if (!accessToken) return undefined;

      // Verify the token — only blacklist tokens we actually issued
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        jti?: string;
        exp?: number;
      }>(accessToken);

      if (payload.jti && payload.exp) {
        await this.tokenBlacklistService.blacklist(payload.jti, payload.exp);
      }
      return payload;
    } catch {
      // Best-effort: don't fail logout if token is expired/invalid
      this.logger.debug('Failed to blacklist access token during logout');
      return undefined;
    }
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(this.REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/',
    });
  }

  /**
   * Get current token ID from request (for marking current session)
   */
  private async getCurrentTokenId(req: Request): Promise<string | undefined> {
    const refreshToken = req.cookies[this.REFRESH_TOKEN_COOKIE_NAME] as
      | string
      | undefined;

    if (!refreshToken) {
      return undefined;
    }

    try {
      const [, jti] = await this.authService.verifyRefreshToken(refreshToken);
      return jti;
    } catch {
      return undefined;
    }
  }

  /**
   * Get all active sessions for the current user
   */
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  @ApiOkResponse({ type: [SessionInfoDto] })
  async getSessions(
    @Req() req: AuthenticatedRequest,
  ): Promise<SessionInfoDto[]> {
    const currentTokenId = await this.getCurrentTokenId(req);
    return this.authService.getUserSessions(req.user.id, currentTokenId);
  }

  /**
   * Revoke a specific session
   */
  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:sessionId')
  @ApiOkResponse({ type: RevokeSessionResponseDto })
  async revokeSession(
    @Req() req: AuthenticatedRequest,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<RevokeSessionResponseDto> {
    const revoked = await this.authService.revokeSession(
      req.user.id,
      sessionId,
    );

    if (!revoked) {
      throw new NotFoundException('Session not found');
    }

    return { message: 'Session revoked successfully' };
  }

  /**
   * Revoke all sessions except the current one
   */
  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  @ApiOkResponse({ type: RevokeAllSessionsResponseDto })
  async revokeAllOtherSessions(
    @Req() req: AuthenticatedRequest,
  ): Promise<RevokeAllSessionsResponseDto> {
    const currentTokenId = await this.getCurrentTokenId(req);

    if (!currentTokenId) {
      throw new UnauthorizedException('Could not determine current session');
    }

    const count = await this.authService.revokeAllOtherSessions(
      req.user.id,
      currentTokenId,
    );

    return {
      message: `Revoked ${count} session${count !== 1 ? 's' : ''}`,
      revokedCount: count,
    };
  }
}
