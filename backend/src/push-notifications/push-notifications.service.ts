import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Agent } from 'node:https';
import { isIP } from 'node:net';
import { parse as legacyUrlParse } from 'node:url';
import * as webpush from 'web-push';
import { DatabaseService } from '@/database/database.service';
import { SubscribePushDto } from './dto/subscribe.dto';
import { PushSubscription } from '@prisma/client';
import {
  classifyAddress,
  guardedLookup,
  isPublicUrl,
  resolvesToPublicOrPrivateNetwork,
} from '@/common/utils/public-address.util';
import {
  PUSH_PRIVATE_HOSTS,
  PushPrivateHosts,
  isPushHostName,
} from './push-private-hosts';

/**
 * Domain-separation string used when deriving the push action-token signing
 * key from JWT_SECRET. Never sign action tokens with the raw JWT_SECRET —
 * a token signed with the raw secret could potentially be replayed against
 * the passport JWT strategy.
 */
const ACTION_TOKEN_KEY_INFO = 'semaphore-push-action-v1';

const ACTION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Browsers' push endpoints are far shorter; the column has no other limit. */
const MAX_ENDPOINT_LENGTH = 2048;

/** A push service that doesn't answer mustn't hold a send open. */
const PUSH_REQUEST_TIMEOUT_MS = 10_000;

/**
 * A user's browsers are a handful. Each subscription costs an outbound HTTPS
 * POST on every send, so the list is capped at registration.
 */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

/** Concurrent sends per user; the rest wait for the next chunk. */
const SEND_CHUNK_SIZE = 5;

/**
 * The raw authority of an absolute URL: everything between `//` and the path,
 * query or fragment. Percent-encoding there is refused because the endpoint
 * is later re-parsed by the sender, and an encoded host can read differently
 * in the two parsers.
 */
function rawAuthority(endpoint: string): string {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(endpoint);
  if (!scheme) return '';
  const rest = endpoint.slice(scheme[0].length);
  const end = rest.search(/[/?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * What a push endpoint must look like (RFC 8030: an HTTPS URL of a push
 * service): https, a host name rather than an IP address, no credentials.
 * Returns the lower-case host name and the port (443 when none is given), or
 * null. Whether that port is allowed, and whether the name is public, are
 * separate checks.
 *
 * The endpoint is read here with WHATWG `URL`, but the sender re-reads the raw
 * string with Node's legacy `url.parse`; both must agree on the authority, so
 * a disagreement is refused rather than sent to another host.
 */
function parsePushEndpoint(
  endpoint: string,
): { host: string; port: number } | null {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (/%[0-9a-f]{2}/i.test(rawAuthority(endpoint))) return null;
  const host = url.hostname.toLowerCase();
  // URL keeps the brackets of an IPv6 literal
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return null;
  if (!isPushHostName(host)) return null;
  // URL drops a default port, so '' is 443
  const port = url.port === '' ? 443 : Number(url.port);
  const legacy = legacyUrlParse(endpoint);
  if (
    !legacy.hostname ||
    legacy.hostname.toLowerCase() !== host ||
    (legacy.port === null ? 443 : Number(legacy.port)) !== port
  ) {
    return null;
  }
  return { host, port };
}

/** Push urgency (RFC 8030 section 5.3). */
export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

interface ActionTokenPayload {
  u: string;
  n: string;
  exp: number;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);
  private isConfigured = false;
  private vapidPublicKey: string | null = null;
  /**
   * Re-checks at connection time what a push endpoint's name resolves to:
   * public addresses only, or also private networks for a host the operator
   * listed in PUSH_PRIVATE_HOSTS. An IP literal is not resolved, so the
   * socket's `createConnection` applies the same rule to it.
   */
  private readonly pushAgent: Agent;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    @Inject(PUSH_PRIVATE_HOSTS)
    private readonly privateHosts: PushPrivateHosts,
  ) {
    this.pushAgent = new Agent({
      lookup: guardedLookup((hostname) =>
        this.privateHosts.allowsHost(hostname),
      ),
    });
    const createConnection = this.pushAgent.createConnection.bind(
      this.pushAgent,
    ) as typeof this.pushAgent.createConnection;
    const guardedCreateConnection: typeof createConnection = (
      options,
      callback,
    ) => {
      const host = options.host;
      if (typeof host === 'string') {
        const literal = host.replace(/^\[|\]$/g, '');
        if (isIP(literal) !== 0 && !this.addressAllowed(literal)) {
          throw new Error(
            `Refusing to connect to a non-public address for ${host}`,
          );
        }
      }
      return createConnection(options, callback);
    };
    this.pushAgent.createConnection = guardedCreateConnection;
  }

  /**
   * Whether a connection may be made to an address: the same rule the
   * connection-time lookup applies. Public addresses are always reachable,
   * private-network ones only for a host the operator listed, and forbidden
   * ones never.
   */
  private addressAllowed(address: string): boolean {
    const kind = classifyAddress(address);
    return (
      kind === 'public' ||
      (kind === 'private-network' && this.privateHosts.allowsHost(address))
    );
  }

  async onModuleInit() {
    const envPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const envPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const envSubject = this.configService.get<string>('VAPID_SUBJECT');

    // Tier 1: Use env vars if both keys are present
    if (envPublicKey && envPrivateKey) {
      const subject = envSubject || 'mailto:admin@localhost';
      this.applyVapidDetails(subject, envPublicKey, envPrivateKey, 'env vars');
      return;
    }

    // Tier 2: Check database for stored keys
    try {
      const settings = await this.databaseService.instanceSettings.findFirst();
      if (settings?.vapidPublicKey && settings?.vapidPrivateKey) {
        const subject =
          envSubject || settings.vapidSubject || 'mailto:admin@localhost';
        this.applyVapidDetails(
          subject,
          settings.vapidPublicKey,
          settings.vapidPrivateKey,
          'database',
        );
        return;
      }

      // Tier 3: Auto-generate and persist (multi-instance safe)
      const generated = webpush.generateVAPIDKeys();
      const subject = envSubject || 'mailto:admin@localhost';

      // Persist using conditional write to handle concurrent pod startup.
      // If another instance already wrote keys, updateMany matches 0 rows.
      // Match both null and empty string to handle rows seeded without VAPID data.
      if (settings) {
        const result = await this.databaseService.instanceSettings.updateMany({
          where: {
            id: settings.id,
            OR: [{ vapidPublicKey: null }, { vapidPublicKey: '' }],
          },
          data: {
            vapidPublicKey: generated.publicKey,
            vapidPrivateKey: generated.privateKey,
            vapidSubject: subject,
          },
        });

        if (result.count === 0) {
          // Another instance won the race — reload and use its keys
          const reloaded =
            await this.databaseService.instanceSettings.findFirst();
          if (reloaded?.vapidPublicKey && reloaded?.vapidPrivateKey) {
            const effectiveSubject =
              envSubject || reloaded.vapidSubject || 'mailto:admin@localhost';
            this.applyVapidDetails(
              effectiveSubject,
              reloaded.vapidPublicKey,
              reloaded.vapidPrivateKey,
              'database (concurrent)',
            );
            return;
          }
        }
      } else {
        await this.databaseService.instanceSettings.create({
          data: {
            vapidPublicKey: generated.publicKey,
            vapidPrivateKey: generated.privateKey,
            vapidSubject: subject,
          },
        });
      }

      this.applyVapidDetails(
        subject,
        generated.publicKey,
        generated.privateKey,
        'auto-generated',
      );
    } catch (error) {
      this.logger.error(
        'Failed to initialize VAPID keys from database:',
        error,
      );
    }
  }

  private applyVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string,
    source: string,
  ) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidPublicKey = publicKey;
      this.isConfigured = true;
      this.logger.log(
        `Push notifications configured successfully (source: ${source})`,
      );
    } catch (error) {
      this.logger.error('Failed to configure VAPID details:', error);
    }
  }

  /**
   * Check if push notifications are enabled
   */
  isEnabled(): boolean {
    return this.isConfigured;
  }

  /**
   * Get the VAPID public key for client subscription
   */
  getVapidPublicKey(): string | null {
    return this.vapidPublicKey;
  }

  /**
   * Subscribe a user to push notifications
   */
  async subscribe(
    userId: string,
    dto: SubscribePushDto,
  ): Promise<PushSubscription> {
    await this.assertValidEndpoint(dto.endpoint);

    // Re-subscribing the same endpoint is always allowed: only the user's
    // other subscriptions count against the cap.
    const others = await this.databaseService.pushSubscription.count({
      where: { userId, NOT: { endpoint: dto.endpoint } },
    });
    if (others >= MAX_SUBSCRIPTIONS_PER_USER) {
      throw new BadRequestException(
        `You already have ${MAX_SUBSCRIPTIONS_PER_USER} push subscriptions`,
      );
    }

    // Cast keys to JSON-compatible format for Prisma
    const keysJson = {
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
    };

    // Upsert - update if endpoint exists, create if not
    return this.databaseService.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: {
        userId,
        keys: keysJson,
        userAgent: dto.userAgent,
        updatedAt: new Date(),
      },
      create: {
        userId,
        endpoint: dto.endpoint,
        keys: keysJson,
        userAgent: dto.userAgent,
      },
    });
  }

  /**
   * The server POSTs to whatever endpoint is stored here, so an endpoint must
   * be a real push service URL and never an address inside the network.
   */
  private async assertValidEndpoint(endpoint: string): Promise<void> {
    const parsed = this.allowedEndpoint(endpoint);
    const reachable =
      parsed !== null &&
      (this.privateHosts.allowsHost(parsed.host)
        ? await resolvesToPublicOrPrivateNetwork(parsed.host)
        : await isPublicUrl(parsed.host));
    if (!reachable) {
      throw new BadRequestException('That is not a valid push endpoint');
    }
  }

  /**
   * The endpoint's host and port when its shape is allowed: a well-formed
   * push URL (see parsePushEndpoint) on 443, or on a port PUSH_PRIVATE_HOSTS
   * names for that host.
   */
  private allowedEndpoint(
    endpoint: string,
  ): { host: string; port: number } | null {
    const parsed = parsePushEndpoint(endpoint);
    if (!parsed || !this.privateHosts.allowsPort(parsed.host, parsed.port)) {
      return null;
    }
    return parsed;
  }

  /**
   * Unsubscribe a user from push notifications
   */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.databaseService.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  /**
   * Get all push subscriptions for a user
   */
  async getUserSubscriptions(userId: string): Promise<PushSubscription[]> {
    return this.databaseService.pushSubscription.findMany({
      where: { userId },
    });
  }

  /**
   * The user's subscriptions as they may see them. The full endpoint URL is a
   * delivery capability, so only its host goes out.
   */
  async listUserSubscriptions(userId: string): Promise<
    {
      id: string;
      endpointHost: string | null;
      userAgent: string | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  > {
    const subscriptions = await this.getUserSubscriptions(userId);
    return subscriptions.map((subscription) => ({
      id: subscription.id,
      endpointHost: parsePushEndpoint(subscription.endpoint)?.host ?? null,
      userAgent: subscription.userAgent,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    }));
  }

  /** Revoke one of the user's own subscriptions. */
  async revokeSubscription(userId: string, id: string): Promise<void> {
    const { count } = await this.databaseService.pushSubscription.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException('Push subscription not found');
    }
  }

  /**
   * Send a push notification to all of a user's subscriptions
   */
  async sendToUser(
    userId: string,
    payload: PushNotificationPayload,
    options: { urgency?: PushUrgency } = {},
  ): Promise<{ sent: number; failed: number }> {
    if (!this.isConfigured) {
      this.logger.debug('Push notifications not configured, skipping');
      return { sent: 0, failed: 0 };
    }

    const subscriptions = await this.getUserSubscriptions(userId);
    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    // At most SEND_CHUNK_SIZE outbound POSTs are in flight at a time, so a
    // user's subscription list can't turn one send into an unbounded burst.
    for (
      let start = 0;
      start < subscriptions.length;
      start += SEND_CHUNK_SIZE
    ) {
      const chunk = subscriptions.slice(start, start + SEND_CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((sub) =>
          this.sendToSubscription(sub, payload, options.urgency ?? 'normal'),
        ),
      );

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          sent++;
        } else {
          failed++;
          // Handle expired/invalid subscriptions
          const error = result.reason as { statusCode?: number };
          if (error.statusCode === 410 || error.statusCode === 404) {
            // Subscription expired or not found - remove it
            await this.removeInvalidSubscription(chunk[i].id);
          } else {
            this.logger.error(
              `Failed to send push to subscription ${chunk[i].id}:`,
              result.reason,
            );
          }
        }
      }
    }

    return { sent, failed };
  }

  /**
   * Send to a specific subscription
   */
  private async sendToSubscription(
    subscription: PushSubscription,
    payload: PushNotificationPayload,
    urgency: PushUrgency,
  ): Promise<void> {
    // Rows from before endpoints were validated, or on a port no longer
    // listed in PUSH_PRIVATE_HOSTS: drop them like a dead subscription
    // (sendToUser removes on 410) instead of connecting. Where the host
    // resolves is checked at connection time by pushAgent's lookup, and a
    // refusal there is a plain failure (DNS can change back).
    if (!this.allowedEndpoint(subscription.endpoint)) {
      throw Object.assign(new Error('Invalid push endpoint'), {
        statusCode: 410,
      });
    }

    const keys = subscription.keys as { p256dh: string; auth: string };

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      },
      JSON.stringify(payload),
      {
        TTL: 60 * 60 * 24, // 24 hours
        urgency,
        // RFC 8291, which every current push service and UnifiedPush's
        // connector decrypt. Explicit rather than the library's default.
        contentEncoding: 'aes128gcm',
        agent: this.pushAgent,
        timeout: PUSH_REQUEST_TIMEOUT_MS,
      },
    );
  }

  /**
   * Remove an invalid/expired subscription
   */
  private async removeInvalidSubscription(
    subscriptionId: string,
  ): Promise<void> {
    try {
      await this.databaseService.pushSubscription.delete({
        where: { id: subscriptionId },
      });
      this.logger.debug(`Removed invalid subscription: ${subscriptionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to remove invalid subscription ${subscriptionId}:`,
        error,
      );
    }
  }

  /**
   * Derive the HMAC signing key for push action tokens from JWT_SECRET.
   * Computed lazily (not cached at construction time) so it always reflects
   * the current config, even if JWT_SECRET is loaded after this service is
   * constructed.
   */
  private getActionTokenKey(): Buffer | null {
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      return null;
    }
    return createHmac('sha256', jwtSecret)
      .update(ACTION_TOKEN_KEY_INFO)
      .digest();
  }

  /**
   * Create a signed, scoped action token that authorizes marking a single
   * notification as read from an unauthenticated push-notification action
   * button. Not single-use — see design doc for rationale.
   */
  createActionToken(userId: string, notificationId: string): string | null {
    const key = this.getActionTokenKey();
    if (!key) {
      return null;
    }

    const payload: ActionTokenPayload = {
      u: userId,
      n: notificationId,
      exp: Math.floor(Date.now() / 1000) + ACTION_TOKEN_TTL_SECONDS,
    };

    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const signature = createHmac('sha256', key)
      .update(payloadB64)
      .digest('base64url');

    return `${payloadB64}.${signature}`;
  }

  /**
   * Verify a push action token. Never throws — returns null for any
   * malformed, tampered, or expired token.
   */
  verifyActionToken(
    token: string,
  ): { userId: string; notificationId: string } | null {
    const key = this.getActionTokenKey();
    if (!key) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const [payloadB64, signature] = parts;

    const expectedSignature = createHmac('sha256', key)
      .update(payloadB64)
      .digest('base64url');

    const signatureBuf = Buffer.from(signature, 'base64url');
    const expectedBuf = Buffer.from(expectedSignature, 'base64url');
    if (signatureBuf.length !== expectedBuf.length) {
      return null;
    }
    if (!timingSafeEqual(signatureBuf, expectedBuf)) {
      return null;
    }

    let payload: ActionTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as ActionTokenPayload;
    } catch {
      return null;
    }

    if (
      !payload ||
      typeof payload.u !== 'string' ||
      typeof payload.n !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return { userId: payload.u, notificationId: payload.n };
  }

  /**
   * Clean up expired subscriptions. Runs daily; duplicate runs across
   * replicas are harmless (idempotent deleteMany).
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupExpiredSubscriptions(): Promise<number> {
    // Remove subscriptions older than 30 days that haven't been updated
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await this.databaseService.pushSubscription.deleteMany({
      where: {
        updatedAt: {
          lt: thirtyDaysAgo,
        },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired push subscriptions`);
    }

    return result.count;
  }
}
