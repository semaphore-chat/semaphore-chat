import {
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { DatabaseService } from '@/database/database.service';
import {
  Message,
  MessageSpan,
  SpanType,
  NotificationType,
  Notification,
  UserNotificationSettings,
  ChannelNotificationOverride,
} from '@prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { UpdateChannelOverrideDto } from './dto/update-channel-override.dto';
import { NotificationQueryDto } from './dto/notification-query.dto';
import { NotificationsGateway } from './notifications.gateway';
import { PushNotificationsService } from '@/push-notifications/push-notifications.service';
import { PresenceService } from '@/presence/presence.service';
import { flattenSpansToDisplayText } from '@/common/utils/text.utils';
import { isDndActive } from './dnd.util';

/** Full includes for a freshly-created Notification, matching createNotification()'s shape. */
const NOTIFICATION_INCLUDE = {
  author: {
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
    },
  },
  message: {
    select: {
      id: true,
      spans: true,
      channelId: true,
      directMessageGroupId: true,
    },
  },
  channel: {
    select: {
      id: true,
      name: true,
      communityId: true,
    },
  },
} as const;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => NotificationsGateway))
    private readonly notificationsGateway: NotificationsGateway,
    private readonly pushNotificationsService: PushNotificationsService,
    private readonly presenceService: PresenceService,
    private readonly configService: ConfigService,
    private readonly channelAccessService: ChannelAccessService,
  ) {}

  /**
   * Process a message to detect mentions and create notifications
   * This is the main entry point called after a message is created
   */
  async processMessageForNotifications(
    message: Message & {
      spans: Pick<MessageSpan, 'type' | 'userId' | 'specialKind' | 'aliasId'>[];
    },
  ): Promise<void> {
    // Don't create notifications for deleted messages
    if (message.deletedAt) {
      return;
    }

    // NOTE: this method used to swallow all errors here (notification
    // failures "shouldn't break message sending"). That reasoning applied
    // when this was invoked fire-and-forget from the request path. It is
    // now called from NotificationsFanoutProcessor (a BullMQ job) — the
    // request path already returned once the job was enqueued, so letting
    // errors propagate here is what lets BullMQ retry the job instead of
    // silently losing the fan-out.
    const mentionedUserIds = new Set<string>();

    // Only users who can see the channel may be notified about it
    // (ChannelAccessService): no names or content of hidden channels leak
    // through mentions. Computed lazily, at most once: plain messages in
    // large public channels never need it (see the threshold guard).
    const viewers = this.lazyViewers(message.channelId);

    // Extract mentioned users from spans
    for (const span of message.spans) {
      if (span.type === SpanType.USER_MENTION && span.userId) {
        mentionedUserIds.add(span.userId);
      }

      // Handle @here and @channel special mentions
      if (span.type === SpanType.SPECIAL_MENTION) {
        const users = await this.getSpecialMentionUsers(
          message.channelId ? await viewers() : null,
          span.specialKind,
        );
        users.forEach((userId) => mentionedUserIds.add(userId));
      }

      // Handle alias group mentions
      if (span.type === SpanType.ALIAS_MENTION && span.aliasId) {
        const aliasMembers = await this.getAliasMentionUsers(span.aliasId);
        aliasMembers.forEach((userId) => mentionedUserIds.add(userId));
      }
    }

    // Remove the author from mentioned users (don't notify yourself)
    if (message.authorId) {
      mentionedUserIds.delete(message.authorId);
    }

    if (message.channelId && mentionedUserIds.size > 0) {
      // Cheap for public channels: only the mentioned ids are looked up
      const allowed = new Set(
        await this.channelAccessService.filterViewers(message.channelId, [
          ...mentionedUserIds,
        ]),
      );
      for (const userId of mentionedUserIds) {
        if (!allowed.has(userId)) mentionedUserIds.delete(userId);
      }
    }

    // Create notifications for mentioned users
    const mentionPromises = Array.from(mentionedUserIds).map((userId) =>
      this.createNotificationIfAllowed(
        userId,
        message.channelId
          ? NotificationType.USER_MENTION
          : NotificationType.DIRECT_MESSAGE,
        message,
      ),
    );

    await Promise.all(mentionPromises);

    // Handle DM notifications for all DM members (excluding already-notified via mentions)
    if (message.directMessageGroupId) {
      await this.createDMNotifications(message, mentionedUserIds);
    }

    // Handle CHANNEL_MESSAGE notifications for users with "all" notification level
    if (message.channelId) {
      await this.createChannelMessageNotifications(
        message,
        mentionedUserIds,
        viewers,
      );
    }
  }

  /** Memoized ChannelAccessService.viewerUserIds for one message. */
  private lazyViewers(channelId: string | null): () => Promise<string[]> {
    let pending: Promise<string[]> | null = null;
    return () => {
      if (!channelId) return Promise.resolve([]);
      pending ??= this.channelAccessService.viewerUserIds(channelId);
      return pending;
    };
  }

  /**
   * Get users for alias group mentions
   */
  private async getAliasMentionUsers(aliasGroupId: string): Promise<string[]> {
    const members = await this.databaseService.aliasGroupMember.findMany({
      where: { aliasGroupId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /**
   * Get users for special mentions (@here, @channel): the channel's viewers
   * (ChannelAccessService), and for @here only those seen recently.
   */
  private async getSpecialMentionUsers(
    channelViewers: string[] | null,
    specialKind: string | null,
  ): Promise<string[]> {
    if (!channelViewers || channelViewers.length === 0) return [];

    if (specialKind === 'channel') {
      return channelViewers;
    }

    if (specialKind === 'here') {
      // @here - only online members (users with recent lastSeen)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const online = await this.databaseService.user.findMany({
        where: {
          id: { in: channelViewers },
          lastSeen: { gt: fiveMinutesAgo },
        },
        select: { id: true },
      });
      return online.map((u) => u.id);
    }

    return [];
  }

  /**
   * Create DM notifications for all members except author and already-notified users
   */
  private async createDMNotifications(
    message: Message,
    alreadyNotifiedUserIds = new Set<string>(),
  ): Promise<void> {
    if (!message.directMessageGroupId) return;

    const members =
      await this.databaseService.directMessageGroupMember.findMany({
        where: { groupId: message.directMessageGroupId },
        select: { userId: true },
      });

    const notificationPromises = members
      .filter(
        (m) =>
          m.userId !== message.authorId &&
          !alreadyNotifiedUserIds.has(m.userId),
      )
      .map((m) =>
        this.createNotificationIfAllowed(
          m.userId,
          NotificationType.DIRECT_MESSAGE,
          message,
        ),
      );

    await Promise.all(notificationPromises);
  }

  /**
   * Max community size for CHANNEL_MESSAGE notifications.
   * Skipped for larger communities to avoid performance issues on self-hosted instances.
   * Configurable via CHANNEL_MESSAGE_MEMBER_THRESHOLD (default 5000).
   */
  private getChannelMessageMemberThreshold(): number {
    const raw = this.configService.get<string>(
      'CHANNEL_MESSAGE_MEMBER_THRESHOLD',
    );
    if (!raw) return 5000;

    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Explicit but invalid (e.g. "0", negative, non-numeric) — treat as a
      // misconfiguration and fall back loudly rather than silently.
      this.logger.warn(
        `Invalid CHANNEL_MESSAGE_MEMBER_THRESHOLD="${raw}" (must be a positive number) — falling back to default threshold 5000`,
      );
      return 5000;
    }
    return parsed;
  }

  /**
   * The schema default for UserNotificationSettings.defaultChannelLevel —
   * used below as the in-memory default for members who have no settings
   * row, instead of reading (and create-on-read auto-creating) one per
   * member the way getUserSettings()/shouldNotify() do.
   */
  private static readonly DEFAULT_CHANNEL_LEVEL = 'mentions';

  /**
   * Create CHANNEL_MESSAGE notifications for users with "all" notification
   * level, batched to avoid the O(recipients) query fan-out of calling
   * shouldNotify()/createNotification() per member:
   *
   *   1. ONE userNotificationSettings.findMany() for all eligible members
   *      (in-memory default applied for members with no settings row — no
   *      create-on-read here, unlike getUserSettings()).
   *   2. ONE channelNotificationOverride.findMany() for the same members.
   *   3. Compute the allowed set in memory. For this call site
   *      (channelId set, directMessageGroupId null, type ===
   *      CHANNEL_MESSAGE always) shouldNotify()'s rules collapse to: allow
   *      iff the resolved level (override ?? defaultChannelLevel) === 'all'
   *      — the DM gate and THREAD_REPLY bypass branches never apply here,
   *      and 'none'/'mentions' both resolve to false for this type, so
   *      checking for 'all' exactly reproduces shouldNotify()'s result.
   *   4. ONE notification.createMany() for the allowed set.
   *   5. ONE notification.findMany() over the just-created rows (matching
   *      createNotification()'s include shape) to emit the WS event and
   *      send push notifications per recipient — unchanged from before.
   *
   * Retry idempotency: this method is invoked from a BullMQ job
   * (NotificationsFanoutProcessor) whose errors propagate so the queue
   * retries the whole job on failure. A prior attempt may have already run
   * createMany for some of these recipients before failing later (e.g. a
   * push/WS-side error, or a later throw in the same job for the
   * mention/DM notifications). Re-running from the top must not re-create
   * rows for recipients who already have one — see the
   * notification.findMany() existing-check below, which excludes them from
   * BOTH createMany AND the post-create WS/push emission by keeping them
   * out of `eligibleUserIds` entirely.
   */
  private async createChannelMessageNotifications(
    message: Message,
    alreadyNotifiedUserIds: Set<string>,
    viewers: () => Promise<string[]>,
  ): Promise<void> {
    if (!message.channelId) return;
    // Notification.authorId is required — matches createNotificationIfAllowed's
    // `!message.authorId` guard (e.g. webhook-posted messages have no author).
    if (!message.authorId) return;

    const channelId = message.channelId;
    const authorId = message.authorId;

    // Performance guard (cheap path first, as before): a channel the whole
    // community sees is skipped on the member count alone, without
    // computing viewers; restricted channels are judged by their viewers.
    const threshold = this.getChannelMessageMemberThreshold();
    if (await this.channelAccessService.isVisibleToWholeCommunity(channelId)) {
      const channel = await this.databaseService.channel.findUnique({
        where: { id: channelId },
        select: { communityId: true },
      });
      const memberCount = channel
        ? await this.databaseService.membership.count({
            where: { communityId: channel.communityId },
          })
        : 0;
      if (memberCount > threshold) {
        this.logger.warn(
          `Skipping CHANNEL_MESSAGE notifications for channel ${channelId}: community has ${memberCount} members (threshold: ${threshold})`,
        );
        return;
      }
    }

    // Eligible users: the channel's viewers (ChannelAccessService)
    const userIds = await viewers();
    if (userIds.length > threshold) {
      this.logger.warn(
        `Skipping CHANNEL_MESSAGE notifications for channel ${channelId}: ${userIds.length} viewers (threshold: ${threshold})`,
      );
      return;
    }

    // Filter out author and already-notified users
    let eligibleUserIds = userIds.filter(
      (userId) =>
        userId !== message.authorId && !alreadyNotifiedUserIds.has(userId),
    );

    if (eligibleUserIds.length === 0) return;

    // Retry idempotency: exclude anyone who already has a CHANNEL_MESSAGE
    // notification for this message from a prior (partial) attempt at this
    // same BullMQ job. This runs against the CURRENT recipient list on every
    // attempt, not just the in-run mention/DM dedupe above.
    const alreadyCreated = await this.databaseService.notification.findMany({
      where: {
        messageId: message.id,
        type: NotificationType.CHANNEL_MESSAGE,
        userId: { in: eligibleUserIds },
      },
      select: { userId: true },
    });
    if (alreadyCreated.length > 0) {
      const alreadyCreatedUserIds = new Set(
        alreadyCreated.map((n) => n.userId),
      );
      eligibleUserIds = eligibleUserIds.filter(
        (userId) => !alreadyCreatedUserIds.has(userId),
      );
    }

    if (eligibleUserIds.length === 0) return;

    // ONE query for settings across all eligible recipients (no create-on-read).
    const settingsRows =
      await this.databaseService.userNotificationSettings.findMany({
        where: { userId: { in: eligibleUserIds } },
        select: { userId: true, defaultChannelLevel: true },
      });
    const defaultLevelByUser = new Map(
      settingsRows.map((s) => [s.userId, s.defaultChannelLevel]),
    );

    // ONE query for channel-specific overrides across all eligible recipients.
    const overrideRows =
      await this.databaseService.channelNotificationOverride.findMany({
        where: { channelId, userId: { in: eligibleUserIds } },
        select: { userId: true, level: true },
      });
    const overrideLevelByUser = new Map(
      overrideRows.map((o) => [o.userId, o.level]),
    );

    const allowedUserIds = eligibleUserIds.filter((userId) => {
      const defaultLevel =
        defaultLevelByUser.get(userId) ??
        NotificationsService.DEFAULT_CHANNEL_LEVEL;
      const level = overrideLevelByUser.get(userId) ?? defaultLevel;
      return level === 'all';
    });

    if (allowedUserIds.length === 0) return;

    await this.databaseService.notification.createMany({
      data: allowedUserIds.map((userId) => ({
        userId,
        type: NotificationType.CHANNEL_MESSAGE,
        messageId: message.id,
        channelId,
        directMessageGroupId: message.directMessageGroupId ?? undefined,
        authorId,
      })),
    });

    // ONE follow-up query to get full records for WS emit + push, mirroring
    // createNotification()'s include shape.
    const createdNotifications =
      await this.databaseService.notification.findMany({
        where: {
          messageId: message.id,
          type: NotificationType.CHANNEL_MESSAGE,
          userId: { in: allowedUserIds },
        },
        include: NOTIFICATION_INCLUDE,
      });

    for (const notification of createdNotifications) {
      this.notificationsGateway.emitNotificationToUser(
        notification.userId,
        notification,
      );

      this.sendPushNotification(notification.userId, notification).catch(
        (error) => {
          this.logger.error(
            `Failed to send push notification to user ${notification.userId}:`,
            error,
          );
        },
      );
    }
  }

  /**
   * Create a notification if user's settings allow it.
   *
   * Retry idempotency: called for USER_MENTION/DIRECT_MESSAGE recipients
   * from processMessageForNotifications, which is invoked from a BullMQ job
   * whose errors propagate for retry. A prior attempt at this job may have
   * already created this exact (userId, messageId, type) notification
   * before a later recipient in the same Promise.all() batch threw. There's
   * no unique DB constraint on (userId, messageId, type) to enforce this at
   * the database level (see schema.prisma Notification model), so this is a
   * check-then-insert rather than createMany+skipDuplicates. That's safe
   * without a transaction/lock: BullMQ's jobId dedupe (see
   * MessageDispatchService) guarantees only one worker processes a given
   * message's fan-out job at a time, so no concurrent duplicate job can
   * race this check.
   */
  private async createNotificationIfAllowed(
    userId: string,
    type: NotificationType,
    message: Message,
  ): Promise<Notification | null> {
    // Check if user should be notified based on settings
    const shouldNotify = await this.shouldNotify(
      userId,
      message.channelId,
      message.directMessageGroupId,
      type,
    );

    if (!shouldNotify || !message.authorId) {
      return null;
    }

    const existing = await this.databaseService.notification.findFirst({
      where: { userId, messageId: message.id, type },
      select: { id: true },
    });
    if (existing) {
      return null;
    }

    return this.createNotification({
      userId,
      type,
      messageId: message.id,
      channelId: message.channelId ?? undefined,
      directMessageGroupId: message.directMessageGroupId ?? undefined,
      authorId: message.authorId,
    });
  }

  /**
   * Check if user should receive notification based on settings
   */
  async shouldNotify(
    userId: string,
    channelId: string | null,
    directMessageGroupId: string | null,
    type: NotificationType,
  ): Promise<boolean> {
    // Get user notification settings (creates default if missing)
    const settings = await this.getUserSettings(userId);

    // DND deliberately does NOT gate notification creation — it suppresses
    // delivery side effects only: push in sendPushNotification() (server)
    // and sounds/desktop notifications in useNotificationSideEffects (client).

    // Check DM notifications — applies to both DIRECT_MESSAGE and THREAD_REPLY in DM context
    if (directMessageGroupId && !settings.dmNotifications) {
      return false;
    }

    // Thread reply notifications bypass channel mute — thread subscription
    // is an explicit opt-in. DM notification check above still applies.
    if (type === NotificationType.THREAD_REPLY) {
      return true;
    }

    // Check channel-specific settings
    if (channelId) {
      const channelOverride = await this.getChannelOverride(userId, channelId);
      const level = channelOverride?.level ?? settings.defaultChannelLevel;

      if (level === 'none') {
        return false;
      }

      if (level === 'mentions' && type === NotificationType.CHANNEL_MESSAGE) {
        return false;
      }
    }

    return true;
  }

  /**
   * Create a notification record and emit WebSocket event
   */
  async createNotification(dto: CreateNotificationDto): Promise<Notification> {
    const notification = await this.databaseService.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        messageId: dto.messageId,
        channelId: dto.channelId,
        directMessageGroupId: dto.directMessageGroupId,
        authorId: dto.authorId,
        parentMessageId: dto.parentMessageId,
      },
      include: NOTIFICATION_INCLUDE,
    });

    // Emit WebSocket event to notify the user in real-time
    this.notificationsGateway.emitNotificationToUser(dto.userId, notification);

    // Send push notification (fire-and-forget to avoid blocking)
    this.sendPushNotification(dto.userId, notification).catch((error) => {
      this.logger.error(
        `Failed to send push notification to user ${dto.userId}:`,
        error,
      );
    });

    return notification;
  }

  /**
   * Send push notification to subscribed users.
   * Always sends when push is configured — the push subscription toggle
   * serves as the opt-in/out mechanism.
   */
  private async sendPushNotification(
    userId: string,
    notification: Notification & {
      author: { username: string; displayName: string | null } | null;
      channel: { name: string; communityId: string } | null;
      message: { spans: { text?: string | null }[] } | null;
    },
  ): Promise<void> {
    try {
      // Check if push notifications are enabled
      if (!this.pushNotificationsService.isEnabled()) {
        return;
      }

      // Suppress push if user is actively using the app.
      // They already receive real-time WebSocket notifications + in-app desktop notifications.
      const isActive = await this.presenceService.isActive(userId);
      if (isActive) {
        this.logger.debug(
          `Suppressing push notification for active user ${userId}`,
        );
        return;
      }

      // Respect Do-Not-Disturb (manual toggle or scheduled window)
      const settings = await this.getUserSettings(userId);
      if (isDndActive(settings)) {
        this.logger.debug(
          `Suppressing push notification for user ${userId} (DND active)`,
        );
        return;
      }

      // Format notification for push
      const title = this.formatPushTitle(notification);
      const body = this.formatPushBody(notification);

      // Scoped action token authorizing the "Mark as read" push action
      // button (unauthenticated — the SW has no JWT). Omitted when
      // JWT_SECRET isn't configured.
      const markReadToken = this.pushNotificationsService.createActionToken(
        userId,
        notification.id,
      );

      await this.pushNotificationsService.sendToUser(userId, {
        title,
        body,
        tag: notification.id, // Prevents duplicate notifications
        data: {
          notificationId: notification.id,
          channelId: notification.channelId,
          communityId: notification.channel?.communityId,
          directMessageGroupId: notification.directMessageGroupId,
          type: notification.type,
          ...(markReadToken ? { markReadToken } : {}),
        },
      });

      this.logger.debug(`Push notification sent to user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send push notification to user ${userId}:`,
        error,
      );
      // Don't throw - push failures shouldn't break notification creation
    }
  }

  /**
   * Format push notification title
   */
  private formatPushTitle(
    notification: Notification & {
      author: { username: string; displayName: string | null } | null;
      channel: { name: string } | null;
    },
  ): string {
    const authorName =
      notification.author?.displayName ||
      notification.author?.username ||
      'Someone';

    if (notification.type === NotificationType.DIRECT_MESSAGE) {
      return `Message from ${authorName}`;
    }

    if (notification.channel) {
      return `#${notification.channel.name}`;
    }

    return 'New notification';
  }

  /**
   * Format push notification body
   */
  private formatPushBody(
    notification: Notification & {
      author: { username: string; displayName: string | null } | null;
      message: { spans: { text?: string | null }[] } | null;
    },
  ): string {
    const authorName =
      notification.author?.displayName ||
      notification.author?.username ||
      'Someone';

    const MAX_BODY_LENGTH = 100;
    const rawText = notification.message?.spans
      ? flattenSpansToDisplayText(notification.message.spans)
      : undefined;
    const messageText =
      rawText && rawText.length > MAX_BODY_LENGTH
        ? rawText.slice(0, MAX_BODY_LENGTH) + '...'
        : rawText;

    switch (notification.type) {
      case NotificationType.USER_MENTION:
        return messageText
          ? `${authorName}: ${messageText}`
          : `${authorName} mentioned you`;
      case NotificationType.DIRECT_MESSAGE:
        return messageText || 'New message';
      case NotificationType.CHANNEL_MESSAGE:
        return messageText
          ? `${authorName}: ${messageText}`
          : `${authorName} sent a message`;
      case NotificationType.THREAD_REPLY:
        return messageText
          ? `${authorName}: ${messageText}`
          : `${authorName} replied to a thread`;
      default:
        return 'You have a new notification';
    }
  }

  /**
   * Get notifications for a user with pagination
   */
  async getUserNotifications(userId: string, query: NotificationQueryDto) {
    const { unreadOnly, limit = 50, offset = 0 } = query;
    // NotificationQueryDto already enforces @Max(100) at the validation
    // layer, but cap again here defensively in case this method is ever
    // called directly (bypassing the pipe).
    const cappedLimit = Math.min(limit, 100);

    return this.databaseService.notification.findMany({
      where: {
        userId,
        ...(unreadOnly && { read: false }),
      },
      orderBy: { createdAt: 'desc' },
      take: cappedLimit,
      skip: offset,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
        message: {
          select: {
            id: true,
            spans: true,
            channelId: true,
            directMessageGroupId: true,
          },
        },
        channel: {
          select: {
            communityId: true,
          },
        },
      },
    });
  }

  /**
   * Get unread notification count for user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.databaseService.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  /**
   * Mark a notification as read and emit WebSocket event
   */
  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<Notification> {
    // Verify notification belongs to user
    const notification = await this.databaseService.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    const updatedNotification = await this.databaseService.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });

    // Emit WebSocket event to update other connected clients
    this.notificationsGateway.emitNotificationRead(userId, notificationId);

    return updatedNotification;
  }

  /**
   * Mark all mention-type notifications as read for a specific channel or DM group.
   * Called when a user marks messages as read in a channel/DM, so that
   * mentionCount stays consistent with read-receipt state.
   */
  async markContextNotificationsAsRead(
    userId: string,
    channelId?: string | null,
    directMessageGroupId?: string | null,
  ): Promise<number> {
    if (!channelId && !directMessageGroupId) return 0;

    const mentionTypes: NotificationType[] = directMessageGroupId
      ? [
          NotificationType.USER_MENTION,
          NotificationType.SPECIAL_MENTION,
          NotificationType.DIRECT_MESSAGE,
        ]
      : [
          NotificationType.USER_MENTION,
          NotificationType.SPECIAL_MENTION,
          NotificationType.CHANNEL_MESSAGE,
        ];

    const result = await this.databaseService.notification.updateMany({
      where: {
        userId,
        read: false,
        ...(channelId ? { channelId } : { directMessageGroupId }),
        type: { in: mentionTypes },
      },
      data: { read: true },
    });

    return result.count;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const result = await this.databaseService.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return { count: result.count };
  }

  /**
   * Dismiss a notification
   */
  async dismissNotification(
    notificationId: string,
    userId: string,
  ): Promise<Notification> {
    const notification = await this.databaseService.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.databaseService.notification.update({
      where: { id: notificationId },
      data: { dismissed: true },
    });
  }

  /**
   * Delete a notification
   */
  async deleteNotification(
    notificationId: string,
    userId: string,
  ): Promise<void> {
    const notification = await this.databaseService.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.databaseService.notification.delete({
      where: { id: notificationId },
    });
  }

  /**
   * Get user notification settings (creates default if missing)
   */
  async getUserSettings(userId: string): Promise<UserNotificationSettings> {
    return this.databaseService.userNotificationSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * Update user notification settings
   */
  async updateUserSettings(
    userId: string,
    dto: UpdateNotificationSettingsDto,
  ): Promise<UserNotificationSettings> {
    // Ensure settings exist
    await this.getUserSettings(userId);

    return this.databaseService.userNotificationSettings.update({
      where: { userId },
      data: dto,
    });
  }

  /**
   * Get channel notification override for user
   */
  async getChannelOverride(
    userId: string,
    channelId: string,
  ): Promise<ChannelNotificationOverride | null> {
    return this.databaseService.channelNotificationOverride.findUnique({
      where: {
        userId_channelId: { userId, channelId },
      },
    });
  }

  /**
   * Set channel notification override
   */
  async setChannelOverride(
    userId: string,
    channelId: string,
    dto: UpdateChannelOverrideDto,
  ): Promise<ChannelNotificationOverride> {
    return this.databaseService.channelNotificationOverride.upsert({
      where: {
        userId_channelId: { userId, channelId },
      },
      update: {
        level: dto.level,
      },
      create: {
        userId,
        channelId,
        level: dto.level,
      },
    });
  }

  /**
   * Delete channel notification override
   */
  async deleteChannelOverride(
    userId: string,
    channelId: string,
  ): Promise<void> {
    await this.databaseService.channelNotificationOverride.deleteMany({
      where: { userId, channelId },
    });
  }

  /**
   * Process thread reply notifications.
   * Notifies all thread subscribers (excluding the reply author).
   */
  async processThreadReplyNotifications(
    reply: Message,
    parentMessageId: string,
    authorId: string,
  ): Promise<void> {
    try {
      // Get all thread subscribers except the reply author
      const subscribers = await this.databaseService.threadSubscriber.findMany({
        where: {
          parentMessageId,
          userId: { not: authorId },
        },
        select: { userId: true },
      });

      if (subscribers.length === 0) {
        return;
      }

      // Channel threads: only subscribers who can still see the channel
      // (ChannelAccessService); a subscription can outlive access.
      let recipients = subscribers;
      if (reply.channelId) {
        const allowed = new Set(
          await this.channelAccessService.filterViewers(
            reply.channelId,
            subscribers.map((s) => s.userId),
          ),
        );
        recipients = subscribers.filter((s) => allowed.has(s.userId));
      }

      // Create notifications for all subscribers
      const notificationPromises = recipients.map((subscriber) =>
        this.createNotificationIfAllowedForThread(
          subscriber.userId,
          reply,
          parentMessageId,
        ),
      );

      await Promise.all(notificationPromises);

      this.logger.debug(
        `Created thread reply notifications for ${subscribers.length} subscribers`,
      );
    } catch (error) {
      this.logger.error(
        `Error processing thread reply notifications for ${parentMessageId}`,
        error,
      );
      // Don't throw - notification failures shouldn't break message sending
    }
  }

  /**
   * Create a thread reply notification if user's settings allow it
   */
  private async createNotificationIfAllowedForThread(
    userId: string,
    reply: Message,
    parentMessageId: string,
  ): Promise<Notification | null> {
    // Check if user should be notified based on settings
    const shouldNotify = await this.shouldNotify(
      userId,
      reply.channelId,
      reply.directMessageGroupId,
      NotificationType.THREAD_REPLY,
    );

    if (!shouldNotify || !reply.authorId) {
      return null;
    }

    return this.createNotification({
      userId,
      type: NotificationType.THREAD_REPLY,
      messageId: reply.id,
      channelId: reply.channelId ?? undefined,
      directMessageGroupId: reply.directMessageGroupId ?? undefined,
      authorId: reply.authorId,
      parentMessageId,
    });
  }

  // ============================================================================
  // DEBUG METHODS (Admin only)
  // ============================================================================

  /**
   * Create a test notification for debugging purposes.
   * Bypasses normal message processing - creates a notification directly.
   */
  async createTestNotification(
    userId: string,
    type: NotificationType,
  ): Promise<Notification> {
    this.logger.debug(
      `Creating test notification for user ${userId}, type: ${type}`,
    );

    return this.createNotification({
      userId,
      type,
      authorId: userId, // Self-notification for testing
    });
  }

  /**
   * Clear all notification data for a user (debug/testing only).
   * Removes all notifications, settings, and channel overrides.
   */
  async clearUserNotificationData(userId: string): Promise<{
    notificationsDeleted: number;
    settingsDeleted: number;
    overridesDeleted: number;
  }> {
    this.logger.debug(`Clearing all notification data for user ${userId}`);

    const [notificationsResult, settingsResult, overridesResult] =
      await Promise.all([
        this.databaseService.notification.deleteMany({
          where: { userId },
        }),
        this.databaseService.userNotificationSettings.deleteMany({
          where: { userId },
        }),
        this.databaseService.channelNotificationOverride.deleteMany({
          where: { userId },
        }),
      ]);

    return {
      notificationsDeleted: notificationsResult.count,
      settingsDeleted: settingsResult.count,
      overridesDeleted: overridesResult.count,
    };
  }
}
