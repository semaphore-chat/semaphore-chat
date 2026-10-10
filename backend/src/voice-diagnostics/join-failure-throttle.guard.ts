import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  InjectThrottlerStorage,
  ThrottlerException,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { AuthenticatedRequest } from '@/types';

/** Reports per user per window (the client itself sends at most one a minute). */
export const JOIN_FAILURE_REPORT_LIMIT = 3;
export const JOIN_FAILURE_REPORT_WINDOW_MS = 60_000;

/**
 * Per-user rate limit for join-failure reports, on the app's throttler
 * storage (Redis, fail-open). The global throttler is per IP; this one keeps a
 * single misbehaving client from flooding the logs.
 */
@Injectable()
export class JoinFailureThrottleGuard implements CanActivate {
  private readonly logger = new Logger(JoinFailureThrottleGuard.name);

  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = req.user?.id;
    if (!userId) return true; // the auth guard has already rejected these

    const { totalHits } = await this.storage.increment(
      `voice-join-failure:${userId}`,
      JOIN_FAILURE_REPORT_WINDOW_MS,
      JOIN_FAILURE_REPORT_LIMIT,
      0,
      'voice-join-failure',
    );
    if (totalHits > JOIN_FAILURE_REPORT_LIMIT) {
      this.logger.debug(`Join-failure reports rate-limited for user ${userId}`);
      throw new ThrottlerException();
    }
    return true;
  }
}
