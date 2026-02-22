import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * WebSocket rate limiting guard.
 *
 * Tracks message counts per socket connection using a fixed window.
 * The HTTP ThrottlerGuard doesn't apply to WebSocket gateways,
 * so this provides equivalent protection for WS events.
 *
 * Default: 50 events per 10 seconds per connection.
 */
@Injectable()
export class WsThrottleGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(WsThrottleGuard.name);
  private readonly limits = new Map<string, RateLimitEntry>();
  private readonly maxEventsPerWindow = 50;
  private readonly windowMs = 10000;
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Periodically clean up stale entries (every 60s)
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    this.cleanupInterval.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupInterval);
  }

  canActivate(context: ExecutionContext): boolean {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    const client = context.switchToWs().getClient<Socket>();
    const key = client.id;
    const now = Date.now();

    let entry = this.limits.get(key);

    if (!entry || now - entry.windowStart > this.windowMs) {
      // Start a new window
      entry = { count: 1, windowStart: now };
      this.limits.set(key, entry);
      return true;
    }

    entry.count++;

    if (entry.count > this.maxEventsPerWindow) {
      this.logger.warn(
        `WebSocket rate limit exceeded for socket ${key} (${entry.count}/${this.maxEventsPerWindow} in ${this.windowMs}ms)`,
      );
      throw new WsException('Rate limit exceeded. Please slow down.');
    }

    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now - entry.windowStart > this.windowMs * 2) {
        this.limits.delete(key);
      }
    }
  }
}
