import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginResponseDto {
  accessToken: string;
  @ApiPropertyOptional({
    description:
      'Only for a client that gets body delivery (see the X-Client-Type header) or presented its refresh token in the body. Web clients get an httpOnly refresh_token cookie instead. A native client that gets no refreshToken is talking to a server too old for it.',
  })
  refreshToken?: string;
}

export class LogoutResponseDto {
  message: string;
}

/**
 * An active session (a sign-in on a device). Its activity fields show a
 * refresh token rotation only once the rotation's grace window is over.
 */
export class SessionInfoDto {
  /**
   * The session id: stable for the whole session (refresh token rotations
   * don't change it). Pass it to DELETE /auth/sessions/{sessionId}.
   */
  id: string;
  deviceName: string;
  ipAddress: string | null;
  /** When the session started (its oldest refresh token still stored) */
  createdAt: Date;
  /** Last activity, delayed by about a minute */
  lastUsedAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

export class RevokeSessionResponseDto {
  message: string;
}

export class RevokeAllSessionsResponseDto {
  message: string;
  @ApiProperty({ type: 'integer' })
  revokedCount: number;
}

export class ForgotPasswordResponseDto {
  message: string;
}

export class ResetPasswordResponseDto {
  message: string;
}

export class AuthorizeDesktopLoginResponseDto {
  /** Single-use code for the desktop app to redeem at POST /auth/desktop/token */
  code: string;
  /** How long the code can be redeemed */
  @ApiProperty({ type: 'integer' })
  expiresInSeconds: number;
}
