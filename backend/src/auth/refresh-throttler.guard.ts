import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * Rate limit of POST /auth/refresh, per user rather than per IP.
 *
 * Every page load refreshes (access tokens live only in the page's memory),
 * so a browser restoring ten tabs refreshes ten times at once, and an
 * office behind one NAT address refreshes for everyone in it. A tight
 * per-IP limit turns that into 429s and sessions that fail to load. The
 * limit here is keyed by the user of the presented refresh token instead,
 * once its signature checks out (an HMAC, no database): `refresh-user:<id>`.
 * A request without a validly signed token is keyed by its IP
 * (`refresh-ip:<ip>`); it is refused before any bcrypt or database work.
 *
 * The app-wide per-IP tiers of the global ThrottlerGuard (app.module.ts)
 * still apply to the route as to every other one; they're generous enough
 * for a NAT. The names here (`refreshShort` / `refreshLong`) are private to
 * this guard, so neither guard's tiers or `@Throttle()` metadata affect the
 * other's (see WebhookThrottlerGuard for the same pattern).
 *
 * Skipped under NODE_ENV=test, like the global guard.
 */
@Injectable()
export class RefreshThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super(options, storageService, reflector);
    this.configureRefreshThrottlers();
  }

  /** See WebhookThrottlerGuard#onModuleInit. */
  onModuleInit(): Promise<void> {
    this.configureRefreshThrottlers();
    return Promise.resolve();
  }

  protected shouldSkip(): Promise<boolean> {
    return Promise.resolve(process.env.NODE_ENV === 'test');
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const userId = await this.presentedTokenUser(req);
    if (userId) return `refresh-user:${userId}`;
    return `refresh-ip:${(req.ip as string | undefined) ?? 'unknown'}`;
  }

  /**
   * The user of the refresh token the request presents, where the
   * controller reads it (the cookie, or the body for Electron), if its
   * signature and expiry check out.
   */
  private async presentedTokenUser(
    req: Record<string, unknown>,
  ): Promise<string | undefined> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const headers = req.headers as Record<string, string> | undefined;
    const body = req.body as { refreshToken?: unknown } | undefined;
    let token = cookies?.refresh_token;
    if (
      !token &&
      headers?.['user-agent']?.includes('Electron') &&
      typeof body?.refreshToken === 'string'
    ) {
      token = body.refreshToken;
    }
    if (!token) return undefined;
    try {
      const { sub } = await this.jwtService.verifyAsync<{ sub?: string }>(
        token,
        { secret: this.configService.get<string>('JWT_REFRESH_SECRET') },
      );
      return typeof sub === 'string' ? sub : undefined;
    } catch {
      return undefined;
    }
  }

  private configureRefreshThrottlers(): void {
    const throttlers: ThrottlerOptions[] = [
      // Tabs refresh one after another (a cross-tab lock); several devices
      // of the user may do so at the same moment
      { name: 'refreshShort', ttl: 1_000, limit: 10 },
      { name: 'refreshLong', ttl: 60_000, limit: 60 },
    ];
    const getTracker: ThrottlerOptions['getTracker'] = (
      req: Record<string, unknown>,
    ) => this.getTracker(req);
    const generateKey: ThrottlerOptions['generateKey'] = (
      context,
      suffix,
      name,
    ) => this.generateKey(context, suffix, name);
    this.throttlers = throttlers;
    this.commonOptions = {
      getTracker,
      generateKey,
    };
  }
}
