import {
  BadRequestException,
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
import * as webpush from 'web-push';
import { DatabaseService } from '@/database/database.service';
import { SubscribePushDto } from './dto/subscribe.dto';
import { PushSubscription } from '@prisma/client';
import {
  isPublicUrl,
  publicOnlyLookup,
} from '@/common/utils/public-address.util';

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
 * What a push endpoint must look like (RFC 8030: an HTTPS URL of a push
 * service): https on the default port, a host name rather than an IP address,
 * no credentials. Returns the host name, or null. Whether that name is public
 * is a separate, DNS-dependent check.
 */
function pushEndpointHost(endpoint: string): string | null {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port !== '' && url.port !== '443') return null;
  // URL keeps the brackets of an IPv6 literal
  if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) return null;
  return url.hostname;
}

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
  /** Re-checks at connection time what a push endpoint's name resolves to. */
  private readonly pushAgent = new Agent({ lookup: publicOnlyLookup });

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {}

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
    const host = pushEndpointHost(endpoint);
    if (!host || !(await isPublicUrl(host))) {
      throw new BadRequestException('That is not a valid push endpoint');
    }
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
      endpointHost: pushEndpointHost(subscription.endpoint),
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
  ): Promise<{ sent: number; failed: number }> {
    if (!this.isConfigured) {
      this.logger.debug('Push notifications not configured, skipping');
      return { sent: 0, failed: 0 };
    }

    const subscriptions = await this.getUserSubscriptions(userId);
    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const results = await Promise.allSettled(
      subscriptions.map((sub) => this.sendToSubscription(sub, payload)),
    );

    let sent = 0;
    let failed = 0;

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
          await this.removeInvalidSubscription(subscriptions[i].id);
        } else {
          this.logger.error(
            `Failed to send push to subscription ${subscriptions[i].id}:`,
            result.reason,
          );
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
  ): Promise<void> {
    // Rows from before endpoints were validated: drop them like a dead
    // subscription (sendToUser removes on 410) instead of connecting
    if (!pushEndpointHost(subscription.endpoint)) {
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
        urgency: 'normal',
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
