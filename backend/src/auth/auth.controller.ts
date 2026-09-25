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
import { RefreshTokenGraceService } from './refresh-token-grace.service';
import { RefreshThrottlerGuard } from './refresh-throttler.guard';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { DatabaseService } from '@/database/database.service';
import { AuthenticatedRequest } from '@/types';
import { setAccessTokenCookie, clearAccessTokenCookie } from './cookie-helper';
import {
  lockRefreshToken,
  lockUserForSessionRevocation,
  lockUserForTokenRotation,
} from './session-lock.util';
import { databaseNow } from './db-clock.util';

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

/** How a refresh ended, decided in its transaction. */
type RefreshOutcome =
  | { kind: 'issued'; refreshToken: string; accessToken: string }
  /**
   * A consumed token presented outside the grace window, or within it by
   * another client than the one that rotated it.
   */
  | {
      kind: 'reused';
      tokenId: string;
      familyId: string | null;
      why: 'after the grace window' | 'by another client';
    }
  /** A token of a revoked session, or issued before a password reset. */
  | { kind: 'revoked'; tokenId: string; familyId: string | null };

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
    private readonly refreshTokenGraceService: RefreshTokenGraceService,
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
    // Refused if a password reset committed since the password was checked
    const { refreshToken, accessToken } =
      await this.authService.issueLoginTokens(req.user, deviceInfo);

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
  // Limited per user, not per IP (restored tabs, NATs): see the guard
  @UseGuards(RefreshThrottlerGuard)
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

    // Check the token against its stored hash (bcrypt) before the
    // transaction: a token row's hash never changes, and concurrent
    // refreshes waiting on its lock (below) would each hold a database
    // connection through it
    const validated = await this.authService.validateRefreshToken(
      jti,
      refreshToken,
    );
    if (!validated) {
      this.logger.error('Could not find token by id');
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Do this in a tx so we don't have dangling refresh tokens or something weird
    const outcome = await this.databaseService.$transaction(
      async (tx): Promise<RefreshOutcome> => {
        // First: a revocation of the user's sessions either completes before
        // this rotation or waits for it and then deletes its new token too
        const locked = await lockUserForTokenRotation(tx, user.id);
        if (!locked || locked.banned) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        // Then the token: refreshes with the same token (tabs sharing a
        // cookie) go one at a time, so the ones after the first see it
        // consumed and get the same successor (grace window below)
        await lockRefreshToken(tx, jti);

        // Its state now: consumed by a refresh, or deleted by a revocation,
        // since it was validated
        const tokenRecord = await this.authService.reloadRefreshToken(jti, tx);
        if (!tokenRecord) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        if (tokenRecord.consumed) {
          // Reuse detection: a token already rotated outside the grace
          // window means someone is replaying a stolen token. Both times
          // are the database's, so instances with clocks that disagree
          // agree on the window.
          const now = await databaseNow(tx);
          if (
            !this.refreshTokenGraceService.isWithinGraceWindow(
              tokenRecord.consumedAt,
              now,
            )
          ) {
            return {
              kind: 'reused',
              tokenId: tokenRecord.id,
              familyId: tokenRecord.familyId,
              why: 'after the grace window',
            };
          }

          // Within it: another tab (or a retry of a lost response) of the
          // same client. It gets the token the rotation returned, so the
          // session stays one chain of tokens. Another client is replaying
          // a stolen token: reuse, as outside the window.
          const successor = await this.authService.findGraceSuccessor(
            tokenRecord,
            refreshToken,
            deviceInfo,
            now,
            tx,
          );
          if (successor.kind === 'other-client') {
            return {
              kind: 'reused',
              tokenId: tokenRecord.id,
              familyId: tokenRecord.familyId,
              why: 'by another client',
            };
          }
          if (successor.kind === 'none') {
            this.logger.warn(
              `Refresh token rotated moments ago has no live successor. Family: ${tokenRecord.familyId}, User: ${user.id}`,
            );
            throw new UnauthorizedException('Invalid refresh token');
          }
          const successorRevoked = await this.tokenBlacklistService.isRevoked({
            sub: user.id,
            sid: successor.sessionId ?? undefined,
            iat: successor.iat,
          });
          if (successorRevoked) {
            return {
              kind: 'revoked',
              tokenId: tokenRecord.id,
              familyId: successor.sessionId,
            };
          }
          return {
            kind: 'issued',
            refreshToken: successor.refreshToken,
            // Signed before the commit, like a rotation's (below)
            accessToken: this.authService.login(
              user,
              successor.sessionId ?? undefined,
            ),
          };
        }

        // A revoked session (logout, revoke session) or a token issued
        // before a password reset can't renew itself, even if its row
        // survived
        const revoked = await this.tokenBlacklistService.isRevoked({
          sub: user.id,
          sid: tokenRecord.familyId ?? undefined,
          iat: refreshIssuedAt,
        });
        if (revoked) {
          return {
            kind: 'revoked',
            tokenId: tokenRecord.id,
            familyId: tokenRecord.familyId,
          };
        }

        // Consume (not delete) old token so reuse can be detected later
        const consumed = await this.authService.consumeRefreshToken(
          tokenRecord.id,
          tx,
        );
        // Generate new token in the same family. Its bcrypt hash runs under
        // the locks, but only the refresh that rotates pays for it: the ones
        // waiting behind it take the grace path, which hashes nothing.
        const next = await this.authService.generateRefreshToken(
          user.id,
          deviceInfo,
          tx,
          consumed.familyId ?? undefined,
        );
        // Before the commit: a refresh with the same token waiting for this
        // one's lock finds it
        await this.refreshTokenGraceService.remember(
          jti,
          refreshToken,
          next.refreshToken,
        );
        return {
          kind: 'issued',
          refreshToken: next.refreshToken,
          // Signed before the commit: a password reset waiting for this
          // rotation sets its cutoff after the commit, so the cutoff covers
          // this access token too
          accessToken: this.authService.login(user, next.sessionId),
        };
      },
    );

    // Deletes run after the transaction, which holds locks on the user and
    // the token they delete
    if (outcome.kind === 'reused') {
      this.logger.warn(
        `Refresh token reuse detected (${outcome.why})! Family: ${outcome.familyId}, User: ${user.id}`,
      );
      if (outcome.familyId) {
        // A stolen token: end the session everywhere, including the access
        // tokens and sockets of whoever holds its current token
        await this.authService.revokeReusedSession(user.id, outcome.familyId);
      } else {
        await this.databaseService.refreshToken.deleteMany({
          where: { id: outcome.tokenId },
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (outcome.kind === 'revoked') {
      this.logger.warn(
        `Refresh with a revoked session. Family: ${outcome.familyId}, User: ${user.id}`,
      );
      if (outcome.familyId) {
        await this.authService.invalidateTokenFamily(outcome.familyId);
      } else {
        await this.databaseService.refreshToken.deleteMany({
          where: { id: outcome.tokenId },
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
    const { refreshToken: token, accessToken: newAccessToken } = outcome;

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
   * Revoke a session by its id from GET /auth/sessions (or a refresh token id)
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
