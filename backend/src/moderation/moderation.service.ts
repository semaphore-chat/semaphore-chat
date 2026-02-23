import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DatabaseService } from '@/database/database.service';
import { RolesService } from '@/roles/roles.service';
import { MembershipService } from '@/membership/membership.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { ServerEvents } from '@kraken/shared';
import { RoomEvents } from '@/rooms/room-subscription.events';
import { RoomName } from '@/common/utils/room-name.util';
import { PUBLIC_USER_SELECT } from '@/common/constants/user-select.constant';
import {
  ModerationAction,
  Prisma,
  CommunityBan,
  CommunityTimeout,
} from '@prisma/client';

// Role hierarchy (name-based): Owner > Admin > Moderator > Member
const ROLE_HIERARCHY: Record<string, number> = {
  Owner: 100,
  'Community Admin': 80,
  Admin: 80,
  Moderator: 50,
  Member: 10,
};

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly rolesService: RolesService,
    private readonly membershipService: MembershipService,
    private readonly websocketService: WebsocketService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Get the highest role priority for a user in a community
   */
  private async getUserRolePriority(
    userId: string,
    communityId: string,
  ): Promise<number> {
    const userRoles = await this.rolesService.getUserRolesForCommunity(
      userId,
      communityId,
    );

    if (userRoles.roles.length === 0) {
      return 0; // No roles = lowest priority
    }

    return Math.max(
      ...userRoles.roles.map(
        (role) => ROLE_HIERARCHY[role.name] ?? ROLE_HIERARCHY.Member,
      ),
    );
  }

  /**
   * Check if moderator can moderate target user based on role hierarchy
   */
  private async canModerate(
    moderatorId: string,
    targetUserId: string,
    communityId: string,
  ): Promise<boolean> {
    const moderatorPriority = await this.getUserRolePriority(
      moderatorId,
      communityId,
    );
    const targetPriority = await this.getUserRolePriority(
      targetUserId,
      communityId,
    );

    // Moderator must have strictly higher priority
    return moderatorPriority > targetPriority;
  }

  /**
   * Create a moderation log entry
   */
  private async createModerationLog(params: {
    communityId: string;
    moderatorId: string;
    action: ModerationAction;
    targetUserId?: string;
    targetMessageId?: string;
    reason?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.databaseService.moderationLog.create({
      data: {
        communityId: params.communityId,
        moderatorId: params.moderatorId,
        action: params.action,
        targetUserId: params.targetUserId,
        targetMessageId: params.targetMessageId,
        reason: params.reason,
        metadata: params.metadata,
      },
    });
  }

  // =========================================
  // BAN METHODS
  // =========================================

  async banUser(
    communityId: string,
    userId: string,
    moderatorId: string,
    reason?: string,
    expiresAt?: Date,
  ): Promise<void> {
    // Check role hierarchy
    if (!(await this.canModerate(moderatorId, userId, communityId))) {
      throw new ForbiddenException(
        'Cannot ban a user with equal or higher role',
      );
    }

    // Check if user is member
    const isMember = await this.membershipService.isMember(userId, communityId);
    if (!isMember) {
      throw new NotFoundException('User is not a member of this community');
    }

    // Check if already banned
    const existingBan = await this.databaseService.communityBan.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (existingBan?.active) {
      throw new ConflictException('User is already banned');
    }

    await this.databaseService.$transaction(async (tx) => {
      // Create or update ban record
      await tx.communityBan.upsert({
        where: { communityId_userId: { communityId, userId } },
        create: {
          communityId,
          userId,
          moderatorId,
          reason,
          expiresAt,
          active: true,
        },
        update: {
          moderatorId,
          reason,
          expiresAt,
          active: true,
          createdAt: new Date(),
        },
      });

      // Remove user from community (kick)
      await this.removeMemberInternal(tx, userId, communityId);

      // Log the action within the transaction
      await tx.moderationLog.create({
        data: {
          communityId,
          moderatorId,
          action: ModerationAction.BAN_USER,
          targetUserId: userId,
          reason,
          metadata: { expiresAt: expiresAt?.toISOString() },
        },
      });
    });

    // Emit to user's personal room BEFORE removing from community rooms
    // so the banned user receives the event
    const banPayload = {
      communityId,
      userId,
      moderatorId,
      reason,
      expiresAt: expiresAt?.toISOString(),
    };
    this.websocketService.sendToRoom(
      RoomName.user(userId),
      ServerEvents.USER_BANNED,
      banPayload,
    );

    // Remove user's sockets from community rooms
    this.eventEmitter.emit(RoomEvents.MODERATION_USER_BANNED, {
      userId,
      communityId,
    });

    this.logger.log(
      `User ${userId} banned from community ${communityId} by ${moderatorId}`,
    );

    // Emit WebSocket event to community (for other members)
    this.websocketService.sendToRoom(
      RoomName.community(communityId),
      ServerEvents.USER_BANNED,
      banPayload,
    );
  }

  async unbanUser(
    communityId: string,
    userId: string,
    moderatorId: string,
    reason?: string,
  ): Promise<void> {
    const ban = await this.databaseService.communityBan.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (!ban || !ban.active) {
      throw new NotFoundException('User is not banned');
    }

    await this.databaseService.communityBan.update({
      where: { communityId_userId: { communityId, userId } },
      data: { active: false },
    });

    // Log the action
    await this.createModerationLog({
      communityId,
      moderatorId,
      action: ModerationAction.UNBAN_USER,
      targetUserId: userId,
      reason,
    });

    this.logger.log(
      `User ${userId} unbanned from community ${communityId} by ${moderatorId}`,
    );
  }

  async isUserBanned(communityId: string, userId: string): Promise<boolean> {
    const ban = await this.databaseService.communityBan.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (!ban || !ban.active) {
      return false;
    }

    // Check if ban has expired
    if (ban.expiresAt && ban.expiresAt < new Date()) {
      // Auto-expire the ban
      await this.databaseService.communityBan.update({
        where: { id: ban.id },
        data: { active: false },
      });
      return false;
    }

    return true;
  }

  async getBanList(communityId: string) {
    const bans = await this.databaseService.communityBan.findMany({
      where: { communityId, active: true },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out expired bans and auto-expire them
    const activeBans: CommunityBan[] = [];
    for (const ban of bans) {
      if (ban.expiresAt && ban.expiresAt < new Date()) {
        await this.databaseService.communityBan.update({
          where: { id: ban.id },
          data: { active: false },
        });
      } else {
        activeBans.push(ban);
      }
    }

    // Enrich with user data
    const userIds = [
      ...new Set(activeBans.flatMap((b) => [b.userId, b.moderatorId])),
    ];
    const users = await this.databaseService.user.findMany({
      where: { id: { in: userIds } },
      select: PUBLIC_USER_SELECT,
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return activeBans.map((ban) => ({
      ...ban,
      user: userMap.get(ban.userId) ?? null,
      moderator: userMap.get(ban.moderatorId) ?? null,
    }));
  }

  // =========================================
  // KICK METHODS
  // =========================================

  async kickUser(
    communityId: string,
    userId: string,
    moderatorId: string,
    reason?: string,
  ): Promise<void> {
    // Check role hierarchy
    if (!(await this.canModerate(moderatorId, userId, communityId))) {
      throw new ForbiddenException(
        'Cannot kick a user with equal or higher role',
      );
    }

    // Check if user is member
    const isMember = await this.membershipService.isMember(userId, communityId);
    if (!isMember) {
      throw new NotFoundException('User is not a member of this community');
    }

    await this.databaseService.$transaction(async (tx) => {
      await this.removeMemberInternal(tx, userId, communityId);

      // Log the action within the transaction
      await tx.moderationLog.create({
        data: {
          communityId,
          moderatorId,
          action: ModerationAction.KICK_USER,
          targetUserId: userId,
          reason,
        },
      });
    });

    // Emit to user's personal room BEFORE removing from community rooms
    // so the kicked user receives the event
    const kickPayload = {
      communityId,
      userId,
      moderatorId,
      reason,
    };
    this.websocketService.sendToRoom(
      RoomName.user(userId),
      ServerEvents.USER_KICKED,
      kickPayload,
    );

    // Remove user's sockets from community rooms
    this.eventEmitter.emit(RoomEvents.MODERATION_USER_KICKED, {
      userId,
      communityId,
    });

    this.logger.log(
      `User ${userId} kicked from community ${communityId} by ${moderatorId}`,
    );

    // Emit WebSocket event to community (for other members)
    this.websocketService.sendToRoom(
      RoomName.community(communityId),
      ServerEvents.USER_KICKED,
      kickPayload,
    );
  }

  /**
   * Internal method to remove a member (used by both kick and ban)
   */
  private async removeMemberInternal(
    tx: Parameters<Parameters<typeof this.databaseService.$transaction>[0]>[0],
    userId: string,
    communityId: string,
  ): Promise<void> {
    // Remove user from all channels in the community
    await tx.channelMembership.deleteMany({
      where: {
        userId,
        channel: { communityId },
      },
    });

    // Remove user roles in the community
    await tx.userRoles.deleteMany({
      where: { userId, communityId },
    });

    // Remove the membership
    await tx.membership.delete({
      where: { userId_communityId: { userId, communityId } },
    });
  }

  // =========================================
  // TIMEOUT METHODS
  // =========================================

  async timeoutUser(
    communityId: string,
    userId: string,
    moderatorId: string,
    durationSeconds: number,
    reason?: string,
  ): Promise<void> {
    // Check role hierarchy
    if (!(await this.canModerate(moderatorId, userId, communityId))) {
      throw new ForbiddenException(
        'Cannot timeout a user with equal or higher role',
      );
    }

    // Check if user is member
    const isMember = await this.membershipService.isMember(userId, communityId);
    if (!isMember) {
      throw new NotFoundException('User is not a member of this community');
    }

    const expiresAt = new Date(Date.now() + durationSeconds * 1000);

    // Create or update timeout
    await this.databaseService.communityTimeout.upsert({
      where: { communityId_userId: { communityId, userId } },
      create: {
        communityId,
        userId,
        moderatorId,
        reason,
        expiresAt,
      },
      update: {
        moderatorId,
        reason,
        expiresAt,
        createdAt: new Date(),
      },
    });

    // Log the action
    await this.createModerationLog({
      communityId,
      moderatorId,
      action: ModerationAction.TIMEOUT_USER,
      targetUserId: userId,
      reason,
      metadata: { durationSeconds, expiresAt: expiresAt.toISOString() },
    });

    this.logger.log(
      `User ${userId} timed out for ${durationSeconds}s in community ${communityId} by ${moderatorId}`,
    );

    // Emit WebSocket event to community
    this.websocketService.sendToRoom(
      RoomName.community(communityId),
      ServerEvents.USER_TIMED_OUT,
      {
        communityId,
        userId,
        moderatorId,
        reason,
        durationSeconds,
        expiresAt: expiresAt.toISOString(),
      },
    );
  }

  async removeTimeout(
    communityId: string,
    userId: string,
    moderatorId: string,
    reason?: string,
  ): Promise<void> {
    const timeout = await this.databaseService.communityTimeout.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (!timeout) {
      throw new NotFoundException('User is not timed out');
    }

    await this.databaseService.communityTimeout.delete({
      where: { communityId_userId: { communityId, userId } },
    });

    // Log the action
    await this.createModerationLog({
      communityId,
      moderatorId,
      action: ModerationAction.REMOVE_TIMEOUT,
      targetUserId: userId,
      reason,
    });

    this.logger.log(
      `Timeout removed for user ${userId} in community ${communityId} by ${moderatorId}`,
    );

    // Emit WebSocket event to community
    this.websocketService.sendToRoom(
      RoomName.community(communityId),
      ServerEvents.TIMEOUT_REMOVED,
      {
        communityId,
        userId,
        moderatorId,
        reason,
      },
    );
  }

  async isUserTimedOut(
    communityId: string,
    userId: string,
  ): Promise<{ isTimedOut: boolean; expiresAt?: Date }> {
    const timeout = await this.databaseService.communityTimeout.findUnique({
      where: { communityId_userId: { communityId, userId } },
    });

    if (!timeout) {
      return { isTimedOut: false };
    }

    // Check if timeout has expired
    if (timeout.expiresAt < new Date()) {
      // Auto-clean expired timeout
      await this.databaseService.communityTimeout.delete({
        where: { id: timeout.id },
      });
      return { isTimedOut: false };
    }

    return { isTimedOut: true, expiresAt: timeout.expiresAt };
  }

  async getTimeoutList(communityId: string) {
    const timeouts = await this.databaseService.communityTimeout.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
    });

    // Filter out and auto-clean expired timeouts
    const activeTimeouts: CommunityTimeout[] = [];
    for (const timeout of timeouts) {
      if (timeout.expiresAt < new Date()) {
        await this.databaseService.communityTimeout.delete({
          where: { id: timeout.id },
        });
      } else {
        activeTimeouts.push(timeout);
      }
    }

    // Enrich with user data
    const userIds = [
      ...new Set(activeTimeouts.flatMap((t) => [t.userId, t.moderatorId])),
    ];
    const users = await this.databaseService.user.findMany({
      where: { id: { in: userIds } },
      select: PUBLIC_USER_SELECT,
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return activeTimeouts.map((timeout) => ({
      ...timeout,
      user: userMap.get(timeout.userId) ?? null,
      moderator: userMap.get(timeout.moderatorId) ?? null,
    }));
  }

  // =========================================
  // MESSAGE PINNING METHODS
  // =========================================

  async pinMessage(
    messageId: string,
    moderatorId: string,
    reason?: string,
  ): Promise<void> {
    const message = await this.databaseService.message.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.channel) {
      throw new ForbiddenException('Cannot pin direct messages');
    }

    if (message.pinned) {
      throw new ConflictException('Message is already pinned');
    }

    await this.databaseService.message.update({
      where: { id: messageId },
      data: {
        pinned: true,
        pinnedAt: new Date(),
        pinnedBy: moderatorId,
      },
    });

    // Log the action
    await this.createModerationLog({
      communityId: message.channel.communityId,
      moderatorId,
      action: ModerationAction.PIN_MESSAGE,
      targetMessageId: messageId,
      reason,
    });

    this.logger.log(`Message ${messageId} pinned by ${moderatorId}`);

    // Emit WebSocket event to channel
    this.websocketService.sendToRoom(
      message.channelId!,
      ServerEvents.MESSAGE_PINNED,
      {
        messageId,
        channelId: message.channelId,
        pinnedBy: moderatorId,
        pinnedAt: new Date().toISOString(),
      },
    );
  }

  async unpinMessage(
    messageId: string,
    moderatorId: string,
    reason?: string,
  ): Promise<void> {
    const message = await this.databaseService.message.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.channel) {
      throw new ForbiddenException('Cannot unpin direct messages');
    }

    if (!message.pinned) {
      throw new ConflictException('Message is not pinned');
    }

    await this.databaseService.message.update({
      where: { id: messageId },
      data: {
        pinned: false,
        pinnedAt: null,
        pinnedBy: null,
      },
    });

    // Log the action
    await this.createModerationLog({
      communityId: message.channel.communityId,
      moderatorId,
      action: ModerationAction.UNPIN_MESSAGE,
      targetMessageId: messageId,
      reason,
    });

    this.logger.log(`Message ${messageId} unpinned by ${moderatorId}`);

    // Emit WebSocket event to channel
    this.websocketService.sendToRoom(
      message.channelId!,
      ServerEvents.MESSAGE_UNPINNED,
      {
        messageId,
        channelId: message.channelId,
        unpinnedBy: moderatorId,
      },
    );
  }

  async getPinnedMessages(channelId: string) {
    // Note: We don't filter on deletedAt here because in MongoDB,
    // optional fields that don't exist won't match { field: null }.
    // Instead, deleted messages should have pinned set to false when deleted.
    const messages = await this.databaseService.message.findMany({
      where: {
        channelId,
        pinned: true,
      },
      orderBy: { pinnedAt: 'desc' },
    });

    // Filter out deleted messages in memory (handles both null and undefined)
    const activeMessages = messages.filter((m) => !m.deletedAt);

    // Enrich messages with file metadata (same as MessagesService)
    if (activeMessages.length === 0) {
      return [];
    }

    // Collect all unique author IDs and file IDs
    const authorIds = new Set<string>();
    const allFileIds = new Set<string>();
    activeMessages.forEach((message) => {
      authorIds.add(message.authorId);
      message.attachments.forEach((fileId) => allFileIds.add(fileId));
    });

    // Fetch authors
    const authors = await this.databaseService.user.findMany({
      where: { id: { in: Array.from(authorIds) } },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
    });

    // Fetch files
    const files =
      allFileIds.size > 0
        ? await this.databaseService.file.findMany({
            where: { id: { in: Array.from(allFileIds) } },
            select: {
              id: true,
              filename: true,
              mimeType: true,
              fileType: true,
              size: true,
              thumbnailPath: true,
            },
          })
        : [];

    // Create maps for quick lookup
    const authorMap = new Map(authors.map((author) => [author.id, author]));
    const fileMap = new Map(files.map((file) => [file.id, file]));

    // Transform messages to include author and file metadata
    return activeMessages.map((message) => ({
      ...message,
      author: authorMap.get(message.authorId) || null,
      attachments: message.attachments
        .map((fileId) => fileMap.get(fileId))
        .filter((file): file is NonNullable<typeof file> => file !== undefined)
        .map((file) => ({
          id: file.id,
          filename: file.filename,
          mimeType: file.mimeType,
          fileType: file.fileType,
          size: file.size,
          hasThumbnail: !!file.thumbnailPath,
        })),
    }));
  }

  // =========================================
  // MESSAGE DELETION METHODS
  // =========================================

  async deleteMessageAsMod(
    messageId: string,
    moderatorId: string,
    reason?: string,
  ): Promise<void> {
    const message = await this.databaseService.message.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (!message.channel) {
      throw new ForbiddenException(
        'Cannot delete direct messages as moderator',
      );
    }

    if (message.deletedAt) {
      throw new ConflictException('Message is already deleted');
    }

    // Soft delete the message
    await this.databaseService.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        deletedBy: moderatorId,
        deletedByReason: reason,
      },
    });

    // Log the action
    await this.createModerationLog({
      communityId: message.channel.communityId,
      moderatorId,
      action: ModerationAction.DELETE_MESSAGE,
      targetMessageId: messageId,
      reason,
      metadata: { authorId: message.authorId },
    });

    this.logger.log(`Message ${messageId} deleted by moderator ${moderatorId}`);
  }

  // =========================================
  // MODERATION LOGS
  // =========================================

  async getModerationLogs(
    communityId: string,
    options?: {
      limit?: number;
      offset?: number;
      action?: ModerationAction;
    },
  ) {
    const { limit = 50, offset = 0, action } = options ?? {};

    const where: { communityId: string; action?: ModerationAction } = {
      communityId,
    };
    if (action) {
      where.action = action;
    }

    const [logs, total] = await Promise.all([
      this.databaseService.moderationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.databaseService.moderationLog.count({ where }),
    ]);

    // Enrich with user data
    const userIds = [
      ...new Set(
        logs.flatMap((l) =>
          [l.moderatorId, l.targetUserId].filter(Boolean),
        ) as string[],
      ),
    ];
    const users = await this.databaseService.user.findMany({
      where: { id: { in: userIds } },
      select: PUBLIC_USER_SELECT,
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const enrichedLogs = logs.map((log) => ({
      ...log,
      moderator: userMap.get(log.moderatorId) ?? null,
      targetUser: log.targetUserId
        ? (userMap.get(log.targetUserId) ?? null)
        : null,
    }));

    return { logs: enrichedLogs, total };
  }

  // =========================================
  // HELPER METHODS
  // =========================================

  /**
   * Get community ID from channel ID (for controllers)
   */
  async getCommunityIdFromChannel(channelId: string): Promise<string> {
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: { communityId: true },
    });

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel.communityId;
  }

  /**
   * Get community ID from message ID (for controllers)
   */
  async getCommunityIdFromMessage(messageId: string): Promise<string> {
    const message = await this.databaseService.message.findUnique({
      where: { id: messageId },
      include: { channel: true },
    });

    if (!message || !message.channel) {
      throw new NotFoundException('Message not found or is a direct message');
    }

    return message.channel.communityId;
  }
}
