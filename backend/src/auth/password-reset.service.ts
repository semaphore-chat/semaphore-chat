import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { DatabaseService } from '@/database/database.service';
import { UserService } from '@/user/user.service';
import { MailerService } from '@/mailer/mailer.service';
import { SessionRevocationService } from './session-revocation.service';
import {
  AuthAttemptLimiter,
  PASSWORD_RESET_EMAIL_CEILING,
  PASSWORD_RESET_EMAIL_LIMIT,
  PASSWORD_RESET_EMAIL_WINDOW_SECONDS,
  clientRateKey,
  loginFailureGroup,
} from './auth-attempt-limiter.service';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Self-service password reset via a tokenized email link.
 *
 * Security properties (see task brief for the full requirements):
 * - `requestReset` never reveals whether the email matches an account or
 *   whether the feature is enabled — it always resolves successfully, and
 *   the controller returns an identical response either way.
 * - Only the SHA-256 hash of the reset token is ever stored or logged.
 * - `resetPassword` throws a single generic error for "not found", "expired",
 *   and "already used" so the failure mode never leaks which case applied.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly userService: UserService,
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    private readonly sessionRevocationService: SessionRevocationService,
    private readonly attemptLimiter: AuthAttemptLimiter,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * @param ip - The client's address (req.ip), for the per-client limit.
   */
  async requestReset(email: string, ip?: string): Promise<void> {
    // Feature is fully opt-in: no-op (but still "succeeds") unless SMTP is
    // configured.
    if (!this.mailerService.isEnabled) {
      return;
    }

    // At most PASSWORD_RESET_EMAIL_LIMIT emails per address per client, and
    // PASSWORD_RESET_EMAIL_CEILING per address from all clients, per window
    // (no mail-bombing, and no invalidating someone's link over and over;
    // one client can't spend the address's whole budget). Counted before
    // the lookup, for known and unknown addresses alike; requests over a
    // limit get the same response and send nothing.
    const address = email.trim().toLowerCase();
    const fromClient = await this.attemptLimiter.recordAttempt(
      `pwreset-email:${address}:${clientRateKey(ip)}`,
      PASSWORD_RESET_EMAIL_WINDOW_SECONDS,
    );
    if (fromClient > PASSWORD_RESET_EMAIL_LIMIT) {
      return;
    }
    const total = await this.attemptLimiter.recordAttempt(
      `pwreset-email:${address}`,
      PASSWORD_RESET_EMAIL_WINDOW_SECONDS,
    );
    if (total > PASSWORD_RESET_EMAIL_CEILING) {
      return;
    }

    const user = await this.databaseService.user.findUnique({
      where: { email },
    });
    if (!user) {
      return;
    }

    // Invalidate any prior unused tokens for this user before issuing a new
    // one, so only the most recently requested link is valid.
    await this.databaseService.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    await this.databaseService.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const publicAppUrl = this.configService.get<string>('PUBLIC_APP_URL');
    const resetUrl = `${publicAppUrl}/reset-password?token=${rawToken}`;

    // Fire-and-forget: never let mail-send latency or errors affect the HTTP
    // response — awaiting the SMTP round-trip here would make the
    // known-email path measurably slower than the unknown-email path,
    // reopening the enumeration channel this method otherwise closes.
    // user.email is non-null here: we just looked the user up by email.
    this.mailerService
      .sendPasswordResetEmail(user.email!, resetUrl)
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to send password reset email for user ${user.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(token);

    const resetToken = await this.databaseService.passwordResetToken.findUnique(
      { where: { tokenHash } },
    );

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // bcrypt before the transaction: neither the claimed token's row nor a
    // database connection is held through it
    const hashedPassword = await this.userService.hashPassword(newPassword);

    const user = await this.databaseService.$transaction(async (tx) => {
      // Atomically claim the token by conditioning the update on it still
      // being unused AND unexpired now (the check above was before bcrypt).
      // If two requests race to redeem the same token, or the token
      // expires between the check and the claim, only one `updateMany` can
      // match — the loser gets count 0 and fails with the same generic
      // error, never touching the password.
      const now = new Date();
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      if (count !== 1) {
        throw new BadRequestException('Invalid or expired reset token');
      }

      return this.userService.resetPasswordAndRevokeSessions(
        resetToken.userId,
        hashedPassword,
        tx,
      );
    });

    // Committed: end the sessions the old password opened
    await this.sessionRevocationService.revokeAllUserSessions(
      resetToken.userId,
      'PASSWORD_CHANGED',
    );
    // The owner proved control of the account: lift sign-in locks on it
    // from every client
    await this.attemptLimiter.clearGroup(loginFailureGroup(user.username));
  }
}
