import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  BadRequestException,
  HttpStatus,
  HttpCode,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBody,
  ApiCookieAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { LocalAuthGuard } from './local-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService, DeviceInfo } from './auth.service';
import {
  AccessTokenClaims,
  TokenBlacklistService,
} from './token-blacklist.service';
import { SessionRevocationService } from './session-revocation.service';
import { PasswordResetService } from './password-reset.service';
import { RefreshTokenGraceService } from './refresh-token-grace.service';
import { RefreshThrottlerGuard } from './refresh-throttler.guard';
import { DEVICE_ID_HEADER, parseDeviceId } from './device-id.util';
import {
  CLIENT_TYPE_HEADER,
  ClientType,
  DEVICE_NAME_HEADER,
  SignInClient,
  hasNativeClientIdentity,
  isNativeClientType,
  parseClientType,
  parseDeviceName,
  presentedRefreshToken,
  refreshingClientType,
  resolveSignInClient,
} from './client-type.util';
import { ApiClientHeaders } from './client-headers.decorator';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { ErrorCode } from '@semaphore-chat/shared';
import { DatabaseService } from '@/database/database.service';
import { AuthenticatedRequest } from '@/types';
import {
  setAccessTokenCookie,
  clearAccessTokenCookie,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_NAME,
} from './cookie-helper';
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
  AuthorizeDesktopLoginResponseDto,
} from './dto/auth-response.dto';
import {
  LoginRequestDto,
  RefreshRequestDto,
  LogoutRequestDto,
  AuthorizeDesktopLoginRequestDto,
  DesktopLoginTokenRequestDto,
} from './dto/auth-request.dto';
import { DeviceLoginGrantService } from './device-login-grant.service';
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
  private readonly REFRESH_TOKEN_COOKIE_NAME = REFRESH_TOKEN_COOKIE_NAME;
  constructor(
    private readonly authService: AuthService,
    private readonly databaseService: DatabaseService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly jwtService: JwtService,
    private readonly passwordResetService: PasswordResetService,
    private readonly sessionRevocationService: SessionRevocationService,
    private readonly refreshTokenGraceService: RefreshTokenGraceService,
    private readonly deviceLoginGrantService: DeviceLoginGrantService,
  ) {}

  /**
   * Extract device info from request headers
   */
  private getDeviceInfo(req: Request, clientType?: ClientType): DeviceInfo {
    const userAgent = req.headers['user-agent'] || '';
    // req.ip respects the TRUST_PROXY setting configured in main.ts
    const ipAddress = req.ip || req.socket?.remoteAddress || '';
    const deviceId = parseDeviceId(req.headers[DEVICE_ID_HEADER]);
    return {
      userAgent,
      ipAddress,
      deviceId,
      clientType,
      // A browser's or the Electron app's name comes from its user agent
      deviceName: isNativeClientType(clientType)
        ? parseDeviceName(req.headers[DEVICE_NAME_HEADER])
        : undefined,
    };
  }

  /**
   * How to answer a sign-in. Run before anything is spent (a grant's code):
   * a native client that can't identify itself gets to try again.
   */
  private signInClient(req: Request): SignInClient {
    const client = resolveSignInClient(req.headers);
    if (
      isNativeClientType(client.clientType) &&
      !hasNativeClientIdentity(req.headers)
    ) {
      throw new BadRequestException(
        'Native clients must send X-Device-Id and a User-Agent',
      );
    }
    return client;
  }

  @Public()
  @Throttle({ short: { limit: 4, ttl: 1000 }, long: { limit: 10, ttl: 60000 } })
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiClientHeaders()
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const client = this.signInClient(req);
    const deviceInfo = this.getDeviceInfo(req, client.clientType);
    // Refused if a password reset committed since the password was checked
    const { refreshToken, accessToken } =
      await this.authService.issueLoginTokens(req.user, deviceInfo);

    return this.respondWithNewSession(res, client, {
      refreshToken,
      accessToken,
    });
  }

  /**
   * Answer a sign-in with its new session's tokens: cookies for web clients
   * (access token for browser media, refresh for sessions), the refresh token
   * in the body for clients that store it themselves. A native client has no
   * use for cookies, and gets none.
   */
  private respondWithNewSession(
    res: Response,
    client: SignInClient,
    tokens: { refreshToken: string; accessToken: string },
  ): LoginResponseDto {
    if (!isNativeClientType(client.clientType)) {
      setAccessTokenCookie(res, tokens.accessToken);
      this.setRefreshCookie(res, tokens.refreshToken);
    }

    if (client.tokenDelivery === 'body') {
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    }
    return { accessToken: tokens.accessToken };
  }

  /**
   * Sign in with browser (desktop app), step 1: the user, signed in in the
   * browser, confirmed signing in the desktop app as themselves. Mints a
   * single-use code bound to the app's PKCE challenge; the browser hands it
   * to the app (a loopback redirect), which redeems it at
   * POST /auth/desktop/token.
   *
   * Only with the access token in the Authorization header, which a page
   * has to read from the app's memory: never with the cookie alone, so
   * another site can't approve a grant through a cross-site request.
   */
  @Throttle({ short: { limit: 2, ttl: 1000 }, long: { limit: 10, ttl: 60000 } })
  @Post('desktop/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AuthorizeDesktopLoginResponseDto })
  async authorizeDesktopLogin(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AuthorizeDesktopLoginRequestDto,
  ): Promise<AuthorizeDesktopLoginResponseDto> {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;
    if (!bearer) {
      throw new UnauthorizedException(
        'Approving a desktop sign-in needs the Authorization header',
      );
    }
    // Verified by JwtAuthGuard already (the same token: the header comes
    // first in extractAccessToken), so decoding is enough
    const claims = this.jwtService.decode<AccessTokenClaims | null>(bearer);
    if (
      !claims ||
      claims.sub !== req.user.id ||
      typeof claims.sid !== 'string'
    ) {
      // Tokens from before sessions were tracked can't vouch for a session
      throw new UnauthorizedException('Sign in again to approve this');
    }
    // A session alone isn't enough to sign in a new device: script running in
    // the page, or a browser left open, has a session and not the password.
    // Forbidden, not Unauthorized: the session is fine, and clients answer a
    // 401 by refreshing it.
    if (!(await this.authService.checkPassword(req.user.id, dto.password))) {
      throw new ForbiddenException('Wrong password');
    }
    const grant = await this.deviceLoginGrantService.createApproved(
      dto.codeChallenge,
      { ...claims, sid: claims.sid },
    );
    return { code: grant.id, expiresInSeconds: grant.expiresInSeconds };
  }

  /**
   * Sign in with browser (desktop app), step 2: the app redeems the code
   * with its PKCE verifier for a session of its own (this request's device).
   * Every failure (unknown, expired or used code, wrong verifier, the
   * approving session ended) answers the same 401; the code is spent either
   * way.
   */
  @Public()
  @Throttle({ short: { limit: 4, ttl: 1000 }, long: { limit: 10, ttl: 60000 } })
  @Post('desktop/token')
  @HttpCode(HttpStatus.OK)
  @ApiClientHeaders()
  @ApiOkResponse({ type: LoginResponseDto })
  async redeemDesktopLogin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: DesktopLoginTokenRequestDto,
  ): Promise<LoginResponseDto> {
    const client = this.signInClient(req);
    const result = await this.deviceLoginGrantService.redeem(
      dto.code,
      dto.codeVerifier,
      this.getDeviceInfo(req, client.clientType),
    );
    if (!result.ok) {
      throw new UnauthorizedException('Invalid or expired sign-in code');
    }
    return this.respondWithNewSession(res, client, result);
  }

  @Public()
  // Limited per presented token, not per IP (restored tabs, NATs) or per
  // user (a stolen old token would lock the user out): see the guard
  @UseGuards(RefreshThrottlerGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiClientHeaders()
  // Optional: the token can come in the body instead
  @ApiSecurity({})
  @ApiCookieAuth('refresh_token')
  @ApiBody({ type: RefreshRequestDto, required: false })
  @ApiOkResponse({ type: LoginResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    // How the token arrived decides how the next one leaves, and nothing else
    // does: a page can't read the httpOnly cookie, so it can't present a token
    // in the body, and a cookie never gets a token back that a page could read
    const { via, token: refreshToken } = presentedRefreshToken(req);

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const [user, jti, refreshIssuedAt, refreshIssuedAtMs] =
      await this.authService.verifyRefreshToken(refreshToken);
    // A banned user keeps their refresh tokens (unbanning restores the
    // session) but can't renew access while banned.
    if (user.banned) {
      throw new UnauthorizedException('Account has been banned');
    }
    const deviceInfo = this.getDeviceInfo(
      req,
      refreshingClientType(via, req.headers),
    );

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
            iatMs: successor.iatMs,
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
          iatMs: refreshIssuedAtMs,
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
          // A session keeps the install it was signed in on and its type; one
          // from before clients sent them adopts the presenting client's. A
          // native client's name stays unless it sends a new one.
          {
            ...deviceInfo,
            deviceId: consumed.deviceId ?? deviceInfo.deviceId,
            clientType:
              parseClientType(consumed.clientType) ?? deviceInfo.clientType,
            deviceName:
              deviceInfo.deviceName ??
              (isNativeClientType(parseClientType(consumed.clientType))
                ? (consumed.deviceName ?? undefined)
                : undefined),
          },
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

    if (via === 'body') {
      // A native client has no use for cookies. Electron builds in the field
      // always got them, so they keep getting them.
      if (
        !isNativeClientType(parseClientType(req.headers[CLIENT_TYPE_HEADER]))
      ) {
        setAccessTokenCookie(res, newAccessToken);
        this.setRefreshCookie(res, token);
      }
      return { accessToken: newAccessToken, refreshToken: token };
    }

    setAccessTokenCookie(res, newAccessToken);
    this.setRefreshCookie(res, token);
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
  // Optional: the token can come in the body instead
  @ApiSecurity({})
  @ApiCookieAuth('refresh_token')
  @ApiBody({ type: LogoutRequestDto, required: false })
  @ApiCreatedResponse({ type: LogoutResponseDto })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    // Get refresh token from cookie or body (Electron sends tokens in body, not cookies)
    let refreshToken = req.cookies[this.REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;
    const body = req.body as LogoutRequestDto | undefined;
    if (!refreshToken && body?.refreshToken) {
      refreshToken = body.refreshToken;
    }

    // The session this logout ends: its refresh tokens are deleted below,
    // then its access tokens are revoked and its sockets disconnected.
    let session: { userId: string; sessionId: string | null } | undefined;

    if (refreshToken) {
      try {
        const [user, jti] =
          await this.authService.verifyRefreshToken(refreshToken);
        // Check the token against its stored hash (bcrypt) before the
        // transaction: a token row's hash never changes, and refreshes and
        // revocations waiting on the user's lock (below) would wait through
        // it too
        if (!(await this.authService.checkRefreshToken(jti, refreshToken))) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        session = await this.databaseService.$transaction(async (tx) => {
          // Serialized with refreshes: one racing this logout either
          // completes first (its new token is deleted below) or finds its
          // token gone
          await lockUserForSessionRevocation(tx, user.id);
          // Reads the token again under the lock: a refresh may have
          // rotated it (its successor goes with the family), or a
          // revocation deleted it, since it was checked
          const sessionId = await this.authService.deleteRefreshToken(jti, tx);
          return { userId: user.id, sessionId };
        });
      } catch {
        // Token may be expired or invalid — still clear the cookie
        this.logger.debug(
          'Failed to verify refresh token during logout, clearing cookie anyway',
        );
      }

      clearRefreshTokenCookie(res);
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
    setRefreshTokenCookie(res, refreshToken);
  }

  /**
   * Get current token ID from request (for marking current session): the
   * refresh cookie's or, for a client that stores its own refresh token and
   * doesn't send it here, its session's, from the access token's `sid`.
   */
  private async getCurrentTokenId(
    req: AuthenticatedRequest,
  ): Promise<string | undefined> {
    const refreshToken = req.cookies[this.REFRESH_TOKEN_COOKIE_NAME] as
      string | undefined;

    if (refreshToken) {
      try {
        const [, jti] = await this.authService.verifyRefreshToken(refreshToken);
        return jti;
      } catch {
        // An old cookie alongside a good bearer token: fall through to it
      }
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return undefined;
    // Verified by JwtAuthGuard already (the header comes first in
    // extractAccessToken), so decoding is enough
    const claims = this.jwtService.decode<AccessTokenClaims | null>(
      header.slice('Bearer '.length),
    );
    if (
      !claims ||
      claims.sub !== req.user.id ||
      typeof claims.sid !== 'string'
    ) {
      return undefined;
    }
    return this.authService.findLiveTokenIdOfSession(req.user.id, claims.sid);
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
      // Not 401: the caller is signed in, it just didn't say which session is
      // current. Clients must not treat this as a lost session (#655).
      throw new BadRequestException('Could not determine current session', {
        description: 'Bad Request',
        errorCode: ErrorCode.CURRENT_SESSION_UNKNOWN,
      });
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
