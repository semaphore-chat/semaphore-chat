import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * The global (APP_GUARD) ThrottlerGuard, limited to HTTP requests.
 *
 * Since Nest 12, global guards also run for WebSocket gateway handlers. The
 * stock ThrottlerGuard reads the HTTP request there: on a socket it gets the
 * Socket as `req`, whose `ip` is undefined, so every message from every
 * client would share one "undefined" bucket of the IP-based HTTP tiers.
 * Gateways are rate-limited per user by WsThrottleGuard instead, so this
 * guard skips every non-HTTP context, as ThrottlerGuard did on Nest 11.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    return super.shouldSkip(context);
  }
}
