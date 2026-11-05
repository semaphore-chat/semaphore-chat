import { findSentMessage, isNonceCollision } from '@/messages/message-nonce';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { PermissionsService } from '@/roles/permissions.service';
import { flattenSpansToText } from '@/common/utils/text.utils';
import { sanitizeEmojiSpans } from '@/common/utils/emoji-span.utils';
import { assertFilesAttachable } from '@/common/utils/attachable-files.utils';
import { assertNotBlockedInDm } from '@/common/utils/user-block.utils';
import { sanitizeChannelMentionSpans } from '@/common/utils/channel-mention-span.utils';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { CreateThreadReplyDto } from './dto/create-thread-reply.dto';
import { MESSAGE_INCLUDE, toMessageDto } from '@/messages/message.mapper';
import { Message, $Enums } from '@prisma/client';

/**
 * Service for managing message threads.
 * Handles thread replies, subscriptions, and thread metadata.
 */
@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly permissionsService: PermissionsService,
    private readonly channelAccessService: ChannelAccessService,
  ) {}

  /**
   * Sanitize spans to only include valid Prisma Span fields.
   * This strips any extra fields that may be sent by the client.
   */
  private sanitizeSpans(
    spans: {
      type: $Enums.SpanType;
      text?: string | null;
      userId?: string | null;
      specialKind?: string | null;
      communityId?: string | null;
      channelId?: string | null;
      aliasId?: string | null;
      emojiId?: string | null;
      bold?: boolean | null;
      italic?: boolean | null;
      strikethrough?: boolean | null;
      code?: boolean | null;
    }[],
  ) {
    return spans.map((span) => ({
      type: span.type,
      text: span.text ?? null,
      userId: span.userId ?? null,
      specialKind: span.specialKind ?? null,
      communityId: span.communityId ?? null,
      channelId: span.channelId ?? null,
      aliasId: span.aliasId ?? null,
      emojiId: span.emojiId ?? null,
      bold: span.bold ?? null,
      italic: span.italic ?? null,
      strikethrough: span.strikethrough ?? null,
      code: span.code ?? null,
    }));
  }

  /**
   * Get the parent message for a thread.
   * Throws NotFoundException if not found.
   */
  async getParentMessage(parentMessageId: string): Promise<Message> {
    const parent = await this.databaseService.message.findUnique({
      where: { id: parentMessageId },
    });

    // A moderator-removed message takes no new replies or subscribers
    if (!parent || parent.deletedAt) {
      throw new NotFoundException('Parent message not found');
    }

    // Prevent nested threads - can't reply to a thread reply
    if (parent.parentMessageId) {
      throw new BadRequestException('Cannot create nested threads');
    }

    return parent;
  }

  /**
   * A reply from a client. A retry with the same clientNonce gets the reply it
   * already created, with `created: false` so nothing is announced twice.
   */
  async sendThreadReply(dto: CreateThreadReplyDto, authorId: string) {
    const target = { ...(await this.replyTarget(dto.parentMessageId)) };
    const sent = await findSentMessage(
      this.databaseService,
      authorId,
      dto.clientNonce,
      target,
    );
    if (sent) return { reply: toMessageDto(sent), created: false };

    try {
      return {
        reply: await this.createThreadReply(dto, authorId),
        created: true,
      };
    } catch (error) {
      const raced = isNonceCollision(error)
        ? await findSentMessage(
            this.databaseService,
            authorId,
            dto.clientNonce,
            target,
          )
        : null;
      if (!raced) throw error;
      return { reply: toMessageDto(raced), created: false };
    }
  }

  private replyTarget(parentMessageId: string) {
    return this.getParentMessage(parentMessageId).then((parent) => ({
      channelId: parent.channelId,
      directMessageGroupId: parent.directMessageGroupId,
      parentMessageId,
    }));
  }

  /**
   * Create a thread reply message.
   * Also increments the parent's replyCount and auto-subscribes the user.
   */
  async createThreadReply(dto: CreateThreadReplyDto, authorId: string) {
    const {
      parentMessageId,
      spans,
      attachments,
      pendingAttachments,
      clientNonce,
    } = dto;

    // Validate parent message exists and isn't a thread reply itself
    const parent = await this.getParentMessage(parentMessageId);

    // Same as a new DM message: a 1:1 DM with a block between the two is closed
    if (parent.directMessageGroupId) {
      await assertNotBlockedInDm(
        this.databaseService,
        authorId,
        parent.directMessageGroupId,
      );
    }

    // Attaching files in a channel thread needs ATTACH_FILES
    if (
      parent.channelId &&
      ((attachments?.length ?? 0) > 0 || (pendingAttachments ?? 0) > 0)
    ) {
      await this.permissionsService.assertCanAttachFiles(
        authorId,
        parent.channelId,
      );
    }
    await assertFilesAttachable(
      this.databaseService,
      authorId,
      attachments ?? [],
    );

    // Sanitize spans to only include valid Prisma fields
    const fieldSanitizedSpans = this.sanitizeSpans(spans);

    // Convert EMOJI spans with unknown/foreign emojiIds to plaintext so a
    // hand-crafted payload can't trip the FK (P2003 -> 500) or reference
    // another community's emoji. DM threads (no channelId) downgrade all
    // EMOJI spans since there is no community to validate against.
    const emojiSafeSpans = await sanitizeEmojiSpans(
      this.databaseService,
      fieldSanitizedSpans,
      parent.channelId,
    );
    // #channel mentions: same community, visible to the author, no name stored
    const sanitizedSpans = await sanitizeChannelMentionSpans(
      this.databaseService,
      emojiSafeSpans,
      parent.channelId,
      authorId,
      (userId, channelId) =>
        this.channelAccessService.canViewChannel(userId, channelId),
    );
    const searchText = flattenSpansToText(sanitizedSpans);

    // Use transaction to ensure atomicity
    const result = await this.databaseService.$transaction(async (tx) => {
      // Create the reply message
      const reply = await tx.message.create({
        data: {
          authorId,
          channelId: parent.channelId,
          directMessageGroupId: parent.directMessageGroupId,
          parentMessageId,
          spans: {
            create: sanitizedSpans.map((s, i) => ({ position: i, ...s })),
          },
          searchText,
          ...(attachments && attachments.length > 0
            ? {
                attachments: {
                  create: attachments.map((fileId, i) => ({
                    fileId,
                    position: i,
                  })),
                },
              }
            : {}),
          pendingAttachments: pendingAttachments || 0,
          clientNonce,
        },
        include: MESSAGE_INCLUDE,
      });

      // Update parent message's reply count and lastReplyAt
      await tx.message.update({
        where: { id: parentMessageId },
        data: {
          replyCount: { increment: 1 },
          lastReplyAt: new Date(),
        },
      });

      // Auto-subscribe the replier to the thread (upsert to avoid duplicates)
      await tx.threadSubscriber.upsert({
        where: {
          userId_parentMessageId: {
            userId: authorId,
            parentMessageId,
          },
        },
        create: {
          userId: authorId,
          parentMessageId,
        },
        update: {}, // No update needed if already subscribed
      });

      return reply;
    });

    this.logger.debug(
      `Created thread reply ${result.id} for parent ${parentMessageId}`,
    );

    return toMessageDto(result);
  }

  /**
   * Get paginated thread replies for a parent message.
   */
  async getThreadReplies(
    parentMessageId: string,
    limit = 50,
    continuationToken?: string,
    viewerId?: string,
  ) {
    // Verify parent exists
    const parent = await this.databaseService.message.findUnique({
      where: { id: parentMessageId },
      select: { id: true, deletedAt: true, channelId: true },
    });

    if (!parent) {
      throw new NotFoundException('Parent message not found');
    }

    // The thread of a moderator-removed message goes with it, for those who
    // may not see what was removed
    if (
      parent.deletedAt &&
      !(
        parent.channelId &&
        viewerId &&
        (await this.permissionsService.canSeeRemovedMessages(
          viewerId,
          parent.channelId,
        ))
      )
    ) {
      return { replies: [], continuationToken: undefined };
    }

    const replies = await this.databaseService.message.findMany({
      where: { parentMessageId },
      orderBy: { sentAt: 'asc' }, // Oldest first for thread context
      take: limit,
      include: MESSAGE_INCLUDE,
      ...(continuationToken
        ? { cursor: { id: continuationToken }, skip: 1 }
        : {}),
    });

    const nextToken =
      replies.length === limit ? replies[replies.length - 1].id : undefined;

    return { replies, continuationToken: nextToken };
  }

  /**
   * Get thread replies with file metadata enrichment.
   * Relations (spans, reactions, attachments with file) are loaded via Prisma include.
   */
  async getThreadRepliesWithMetadata(
    parentMessageId: string,
    limit = 50,
    continuationToken?: string,
    viewerId?: string,
  ) {
    const { replies, continuationToken: nextToken } =
      await this.getThreadReplies(
        parentMessageId,
        limit,
        continuationToken,
        viewerId,
      );

    // Transform replies: group reactions and convert attachments to file metadata
    const repliesWithMetadata = replies.map(toMessageDto);

    return { replies: repliesWithMetadata, continuationToken: nextToken };
  }

  /**
   * Subscribe a user to a thread.
   */
  async subscribeToThread(
    parentMessageId: string,
    userId: string,
  ): Promise<void> {
    // Verify parent exists and isn't a thread reply
    await this.getParentMessage(parentMessageId);

    await this.databaseService.threadSubscriber.upsert({
      where: {
        userId_parentMessageId: {
          userId,
          parentMessageId,
        },
      },
      create: {
        userId,
        parentMessageId,
      },
      update: {},
    });

    this.logger.debug(`User ${userId} subscribed to thread ${parentMessageId}`);
  }

  /**
   * Unsubscribe a user from a thread.
   */
  async unsubscribeFromThread(
    parentMessageId: string,
    userId: string,
  ): Promise<void> {
    await this.databaseService.threadSubscriber.deleteMany({
      where: {
        userId,
        parentMessageId,
      },
    });

    this.logger.debug(
      `User ${userId} unsubscribed from thread ${parentMessageId}`,
    );
  }

  /**
   * Get all subscribers for a thread (for notifications).
   * Excludes the specified user (typically the message author).
   */
  async getThreadSubscribers(
    parentMessageId: string,
    excludeUserId?: string,
  ): Promise<string[]> {
    const subscribers = await this.databaseService.threadSubscriber.findMany({
      where: {
        parentMessageId,
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
      select: { userId: true },
    });

    return subscribers.map((s) => s.userId);
  }

  /**
   * Check if a user is subscribed to a thread.
   */
  async isSubscribed(
    parentMessageId: string,
    userId: string,
  ): Promise<boolean> {
    const subscription = await this.databaseService.threadSubscriber.findUnique(
      {
        where: {
          userId_parentMessageId: {
            userId,
            parentMessageId,
          },
        },
      },
    );

    return !!subscription;
  }

  /**
   * Get thread metadata for a parent message.
   * Returns reply count, last reply time, and subscription status.
   */
  async getThreadMetadata(parentMessageId: string, userId?: string) {
    const parent = await this.databaseService.message.findUnique({
      where: { id: parentMessageId },
      select: {
        id: true,
        replyCount: true,
        lastReplyAt: true,
      },
    });

    if (!parent) {
      throw new NotFoundException('Message not found');
    }

    let isSubscribed = false;
    if (userId) {
      isSubscribed = await this.isSubscribed(parentMessageId, userId);
    }

    return {
      parentMessageId: parent.id,
      replyCount: parent.replyCount,
      lastReplyAt: parent.lastReplyAt,
      isSubscribed,
    };
  }

  /**
   * Decrement reply count when a thread reply is deleted.
   */
  async decrementReplyCount(parentMessageId: string): Promise<void> {
    await this.databaseService.message.update({
      where: { id: parentMessageId },
      data: {
        replyCount: { decrement: 1 },
      },
    });
  }
}
