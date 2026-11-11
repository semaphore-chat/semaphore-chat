import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { assertNotBlockedInDm } from '@/common/utils/user-block.utils';
import { Message, MessageReaction } from '@prisma/client';

type MessageWithReactions = Message & { reactions: MessageReaction[] };

/**
 * Sentinel prefix for custom (community) emoji reactions. The full value stored
 * in `MessageReaction.emoji` is `custom:{customEmojiId}`. Unicode reactions are
 * stored verbatim.
 */
const CUSTOM_REACTION_PREFIX = 'custom:';

/**
 * Service for managing message reactions
 *
 * Uses upsert/delete on the MessageReaction junction table.
 * The unique constraint (messageId, emoji, userId) ensures idempotency.
 */
@Injectable()
export class ReactionsService {
  private readonly logger = new Logger(ReactionsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Add a reaction to a message.
   *
   * Uses upsert with the compound unique key to be idempotent —
   * if the user already reacted with this emoji, it's a no-op.
   *
   * @param messageId - ID of the message to react to
   * @param emoji - Emoji character/string
   * @param userId - ID of the user adding the reaction
   * @returns Updated message with reactions
   */
  async addReaction(
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<MessageWithReactions> {
    try {
      const message = await this.findMessageOrThrow(messageId);

      // Same rule as sending and editing: a block stops new activity in a
      // 1:1 DM (a group DM and channels are unaffected). Removing one's own
      // reaction stays allowed.
      if (message.directMessageGroupId) {
        await assertNotBlockedInDm(
          this.databaseService,
          userId,
          message.directMessageGroupId,
        );
      }

      if (emoji.startsWith(CUSTOM_REACTION_PREFIX)) {
        await this.validateCustomReaction(message, emoji, userId);
      }

      await this.databaseService.messageReaction.upsert({
        where: {
          messageId_emoji_userId: { messageId, emoji, userId },
        },
        create: { messageId, emoji, userId },
        update: {},
      });

      return await this.findMessageWithReactionsOrThrow(messageId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      this.logger.error(`Error adding reaction to message ${messageId}`, error);
      throw error;
    }
  }

  /**
   * Remove a reaction from a message.
   *
   * Deletes the reaction row if it exists; no-op if it doesn't.
   *
   * @param messageId - ID of the message
   * @param emoji - Emoji character/string to remove
   * @param userId - ID of the user removing their reaction
   * @returns Updated message with reactions
   */
  async removeReaction(
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<MessageWithReactions> {
    try {
      await this.findMessageOrThrow(messageId);

      await this.databaseService.messageReaction.deleteMany({
        where: { messageId, emoji, userId },
      });

      return await this.findMessageWithReactionsOrThrow(messageId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Error removing reaction from message ${messageId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Validate a `custom:{emojiId}` reaction sentinel:
   * - the emoji must exist,
   * - the message must belong to a channel in a community (not a DM),
   * - the emoji must belong to that same community,
   * - the reactor must be a member of that community.
   */
  private async validateCustomReaction(
    message: Message,
    emoji: string,
    userId: string,
  ): Promise<void> {
    const emojiId = emoji.slice(CUSTOM_REACTION_PREFIX.length);
    if (!emojiId) {
      throw new BadRequestException('Invalid custom emoji reaction');
    }

    const customEmoji = await this.databaseService.customEmoji.findUnique({
      where: { id: emojiId },
    });
    if (!customEmoji) {
      throw new BadRequestException('Custom emoji not found');
    }

    if (!message.channelId) {
      throw new BadRequestException(
        'Custom emoji reactions are only available in communities',
      );
    }

    const channel = await this.databaseService.channel.findUnique({
      where: { id: message.channelId },
      select: { communityId: true },
    });
    if (!channel || channel.communityId !== customEmoji.communityId) {
      throw new BadRequestException(
        'Custom emoji does not belong to this community',
      );
    }

    const membership = await this.databaseService.membership.findUnique({
      where: {
        userId_communityId: {
          userId,
          communityId: customEmoji.communityId,
        },
      },
    });
    if (!membership) {
      throw new BadRequestException('You are not a member of this community');
    }
  }

  /**
   * Find a message by ID or throw NotFoundException
   */
  private async findMessageOrThrow(messageId: string): Promise<Message> {
    const message = await this.databaseService.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    return message;
  }

  /**
   * Find a message with reactions or throw NotFoundException
   */
  private async findMessageWithReactionsOrThrow(
    messageId: string,
  ): Promise<MessageWithReactions> {
    const message = await this.databaseService.message.findUnique({
      where: { id: messageId },
      include: { reactions: true },
    });

    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    return message;
  }
}
