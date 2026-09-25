export class LoginResponseDto {
  accessToken: string;
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
  revokedCount: number;
}

export class ForgotPasswordResponseDto {
  message: string;
}

export class ResetPasswordResponseDto {
  message: string;
}
