import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { DatabaseService } from '@/database/database.service';
import { FileService } from '@/file/file.service';
import { flattenSpansToText } from '@/common/utils/text.utils';
import { FileType, Prisma } from '@prisma/client';
import { groupReactions } from '@/common/utils/reactions.utils';

/** Prisma select shape for file metadata sent to clients */
const FILE_METADATA_SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  fileType: true,
  size: true,
  thumbnailPath: true,
} as const;

/** Standard includes for loading a message with its relations */
const MESSAGE_INCLUDE = {
  spans: { orderBy: { position: 'asc' as const } },
  reactions: true,
  attachments: {
    include: { file: { select: FILE_METADATA_SELECT } },
    orderBy: { position: 'asc' as const },
  },
} as const;

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fileService: FileService,
  ) {}

  async create(createMessageDto: CreateMessageDto) {
    const searchText = flattenSpansToText(createMessageDto.spans);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, spans, attachments, ...data } = createMessageDto;
    const message = await this.databaseService.message.create({
      data: {
        ...data,
        searchText,
        parentMessageId: data.parentMessageId ?? null,
        spans: {
          create: spans.map((span, i) => ({ position: i, ...span })),
        },
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
      },
      include: MESSAGE_INCLUDE,
    });

    return this.formatMessage(message);
  }

  /**
   * Check if user is in slowmode for a channel.
   * Throws ForbiddenException if user must wait.
   * Returns immediately if no slowmode or cooldown has passed.
   */
  async checkSlowmode(channelId: string, userId: string): Promise<void> {
    // Get channel with slowmode setting
    const channel = await this.databaseService.channel.findUnique({
      where: { id: channelId },
      select: { slowmodeSeconds: true },
    });

    if (!channel || !channel.slowmodeSeconds || channel.slowmodeSeconds <= 0) {
      return; // No slowmode enabled
    }

    // Find user's last message in this channel
    const lastMessage = await this.databaseService.message.findFirst({
      where: {
        channelId,
        authorId: userId,
      },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    });

    if (!lastMessage) {
      return; // No previous messages, user can send
    }

    const timeSinceLastMessage =
      (Date.now() - lastMessage.sentAt.getTime()) / 1000;
    const remainingSeconds = Math.ceil(
      channel.slowmodeSeconds - timeSinceLastMessage,
    );

    if (remainingSeconds > 0) {
      throw new ForbiddenException(
        `Slowmode is enabled. Please wait ${remainingSeconds} seconds before sending another message.`,
      );
    }
  }

  async findOne(id: string) {
    const message = await this.databaseService.message.findUnique({
      where: { id },
      include: MESSAGE_INCLUDE,
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return this.formatMessage(message);
  }

  async update(
    id: string,
    updateMessageDto: UpdateMessageDto,
    originalAttachments?: string[],
  ) {
    return this.databaseService.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const dataToUpdate: Record<string, unknown> = {};

        if (updateMessageDto.spans) {
          dataToUpdate.searchText = flattenSpansToText(updateMessageDto.spans);
          dataToUpdate.editedAt = new Date();

          // Delete old spans, create new ones
          await tx.messageSpan.deleteMany({ where: { messageId: id } });
          await tx.messageSpan.createMany({
            data: updateMessageDto.spans.map((span, i) => ({
              messageId: id,
              position: i,
              ...span,
            })),
          });
        }

        // Handle attachment updates via junction table
        if (updateMessageDto.attachments) {
          const newAttachmentIds = updateMessageDto.attachments;

          // Delete removed attachments from junction table
          await tx.messageAttachment.deleteMany({
            where: {
              messageId: id,
              fileId: { notIn: newAttachmentIds },
            },
          });

          // Add new attachments
          const existing = await tx.messageAttachment.findMany({
            where: { messageId: id },
            select: { fileId: true },
          });
          const existingIds = new Set(existing.map((a) => a.fileId));
          const toAdd = newAttachmentIds.filter((fid) => !existingIds.has(fid));

          if (toAdd.length > 0) {
            await tx.messageAttachment.createMany({
              data: toAdd.map((fileId, i) => ({
                messageId: id,
                fileId,
                position: existingIds.size + i,
              })),
            });
          }

          // Mark removed files for deletion
          if (originalAttachments && Array.isArray(originalAttachments)) {
            const removedAttachments = originalAttachments.filter(
              (oldId) => !newAttachmentIds.includes(oldId),
            );
            for (const fileId of removedAttachments) {
              await this.fileService.markForDeletion(fileId, tx);
            }
            if (removedAttachments.length > 0) {
              this.logger.debug(
                `Marked ${removedAttachments.length} removed attachments for deletion`,
              );
            }
          }
        }

        // Remove spans and attachments from the update data passed to message.update
        // (they're handled above via junction tables)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { spans: _s, attachments: _a, ...restDto } = updateMessageDto;

        const updatedMessage = await tx.message.update({
          where: { id },
          data: { ...restDto, ...dataToUpdate },
          include: MESSAGE_INCLUDE,
        });

        return this.formatMessage(updatedMessage);
      },
    );
  }

  async remove(id: string) {
    return this.databaseService.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // 1. Cascade-delete thread replies and their attachments
        const threadReplies = await tx.message.findMany({
          where: { parentMessageId: id },
          include: { attachments: { include: { file: true } } },
        });

        for (const reply of threadReplies) {
          for (const attachment of reply.attachments) {
            await this.fileService.markForDeletion(attachment.file.id, tx);
          }
        }

        // Delete all thread replies (thread subscribers cascade-delete with the parent)
        await tx.message.deleteMany({ where: { parentMessageId: id } });

        // 2. Delete the parent message
        const deletedMessage = await tx.message.delete({
          where: { id },
          include: MESSAGE_INCLUDE,
        });

        // Mark parent's attachments for deletion
        if (
          deletedMessage.attachments &&
          deletedMessage.attachments.length > 0
        ) {
          for (const attachment of deletedMessage.attachments) {
            await this.fileService.markForDeletion(attachment.file.id, tx);
          }
          this.logger.debug(
            `Marked ${deletedMessage.attachments.length} attachments for deletion`,
          );
        }

        return this.formatMessage(deletedMessage);
      },
    );
  }

  async findAllForChannel(
    channelId: string,
    limit = 50,
    continuationToken?: string,
    direction: 'older' | 'newer' = 'older',
  ) {
    if (!channelId) {
      throw new NotFoundException('No channelId provided');
    }
    return this.findAllByField(
      'channelId',
      channelId,
      limit,
      continuationToken,
      direction,
    );
  }

  async findAllForDirectMessageGroup(
    directMessageGroupId: string,
    limit = 50,
    continuationToken?: string,
    direction: 'older' | 'newer' = 'older',
  ) {
    if (!directMessageGroupId) {
      throw new NotFoundException('No directMessageGroupId provided');
    }
    return this.findAllByField(
      'directMessageGroupId',
      directMessageGroupId,
      limit,
      continuationToken,
      direction,
    );
  }

  async findAroundForChannel(channelId: string, messageId: string, limit = 50) {
    if (!channelId) {
      throw new NotFoundException('No channelId provided');
    }
    return this.findAroundMessage('channelId', channelId, messageId, limit);
  }

  async findAroundForDirectMessageGroup(
    directMessageGroupId: string,
    messageId: string,
    limit = 50,
  ) {
    if (!directMessageGroupId) {
      throw new NotFoundException('No directMessageGroupId provided');
    }
    return this.findAroundMessage(
      'directMessageGroupId',
      directMessageGroupId,
      messageId,
      limit,
    );
  }

  async addAttachment(messageId: string, fileId?: string) {
    return this.databaseService.$transaction(async (tx) => {
      if (fileId) {
        // Get current max position for ordering
        const maxPos = await tx.messageAttachment.aggregate({
          where: { messageId },
          _max: { position: true },
        });
        const nextPosition = (maxPos._max.position ?? -1) + 1;

        await tx.messageAttachment.create({
          data: { messageId, fileId, position: nextPosition },
        });
      }

      const msg = await tx.message.findUnique({
        where: { id: messageId },
        select: { pendingAttachments: true },
      });

      return tx.message.update({
        where: { id: messageId },
        data: {
          ...(msg && (msg.pendingAttachments ?? 0) > 0
            ? { pendingAttachments: { decrement: 1 } }
            : {}),
        },
        include: MESSAGE_INCLUDE,
      });
    });
  }

  enrichMessageWithFileMetadata<T extends { attachments?: unknown[] }>(
    message: T,
  ) {
    if (!message.attachments || message.attachments.length === 0) {
      return { ...message, attachments: [] };
    }

    const first = message.attachments[0];
    if (typeof first !== 'object' || first === null) {
      return { ...message, attachments: [] };
    }

    // Already enriched by formatMessage (has id, filename, hasThumbnail) — pass through
    if ('hasThumbnail' in (first as Record<string, unknown>)) {
      return message;
    }

    // Raw Prisma attachment with nested file — transform
    if ('file' in (first as Record<string, unknown>)) {
      return {
        ...message,
        attachments: (
          message.attachments as Array<{
            file: {
              id: string;
              filename: string;
              mimeType: string;
              fileType: FileType;
              size: number;
              thumbnailPath: string | null;
            };
          }>
        ).map((a) => MessagesService.toFileMetadata(a.file)),
      };
    }

    return { ...message, attachments: [] };
  }

  private async findAllByField(
    field: 'channelId' | 'directMessageGroupId',
    value: string,
    limit = 50,
    continuationToken?: string,
    direction: 'older' | 'newer' = 'older',
  ) {
    const where = {
      [field]: value,
      parentMessageId: null,
    };

    const isNewer = direction === 'newer';
    const sortOrder = isNewer ? ('asc' as const) : ('desc' as const);
    const query = {
      where,
      orderBy: { sentAt: sortOrder },
      take: limit,
      include: MESSAGE_INCLUDE,
      ...(continuationToken
        ? { cursor: { id: continuationToken }, skip: 1 }
        : {}),
    };
    const messages = await this.databaseService.message.findMany(query);

    // Compute continuation token before reversing.
    // For both directions, the token is the last element in Prisma's sort order
    // (oldest for 'older', newest for 'newer') so the next page continues from there.
    const nextToken =
      messages.length === limit ? messages[messages.length - 1].id : undefined;

    // For newer direction, reverse so results are still newest-first
    if (isNewer) {
      messages.reverse();
    }

    const messagesWithMetadata = messages.map((message) =>
      this.formatMessage(message),
    );

    return { messages: messagesWithMetadata, continuationToken: nextToken };
  }

  private async findAroundMessage(
    field: 'channelId' | 'directMessageGroupId',
    fieldValue: string,
    messageId: string,
    limit = 50,
  ) {
    const halfLimit = Math.floor((limit - 1) / 2);

    // Fetch the anchor message
    const anchor = await this.databaseService.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });

    if (!anchor || anchor[field] !== fieldValue || anchor.parentMessageId !== null) {
      throw new NotFoundException('Message not found');
    }

    const baseWhere = { [field]: fieldValue, parentMessageId: null };

    // Fetch older messages (sentAt <= anchor, excluding anchor itself, descending)
    // Uses lte + id exclusion to avoid missing messages with identical timestamps.
    const older = await this.databaseService.message.findMany({
      where: { ...baseWhere, sentAt: { lte: anchor.sentAt }, id: { not: messageId } },
      orderBy: { sentAt: 'desc' as const },
      take: halfLimit,
      include: MESSAGE_INCLUDE,
    });

    // Fetch newer messages (sentAt >= anchor, excluding anchor itself, ascending, then reverse)
    const newer = await this.databaseService.message.findMany({
      where: { ...baseWhere, sentAt: { gte: anchor.sentAt }, id: { not: messageId } },
      orderBy: { sentAt: 'asc' as const },
      take: halfLimit,
      include: MESSAGE_INCLUDE,
    });

    const olderContinuationToken =
      older.length === halfLimit ? older[older.length - 1].id : undefined;
    // newer is asc (oldest→newest), so last element is the newest (farthest from anchor)
    const newerContinuationToken =
      newer.length === halfLimit ? newer[newer.length - 1].id : undefined;

    // Combine in newest-first order: [...newerReversed, anchor, ...older]
    const combined = [...[...newer].reverse(), anchor, ...older];
    const messages = combined.map((m) => this.formatMessage(m));

    return { messages, olderContinuationToken, newerContinuationToken };
  }

  /**
   * Search messages in a specific channel using PostgreSQL full-text search
   * via the GIN-indexed searchVector tsvector column.
   */
  async searchChannelMessages(channelId: string, query: string, limit = 50) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    this.logger.log(
      `Searching messages in channel ${channelId} for query: "${query}"`,
    );

    const rawMessages = await this.databaseService.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Message"
      WHERE "channelId" = ${channelId}
        AND "deletedAt" IS NULL
        AND "searchVector" @@ plainto_tsquery('english', ${query})
      ORDER BY "sentAt" DESC
      LIMIT ${limit}
    `;

    if (rawMessages.length === 0) {
      return [];
    }

    const messageIds = rawMessages.map((m) => m.id);
    const messages = await this.databaseService.message.findMany({
      where: { id: { in: messageIds } },
      include: MESSAGE_INCLUDE,
    });

    // Preserve the ORDER BY sentAt DESC from the raw query
    const messageMap = new Map(messages.map((m) => [m.id, m]));
    const ordered = messageIds
      .map((id) => messageMap.get(id))
      .filter(Boolean) as typeof messages;

    this.logger.log(
      `Found ${ordered.length} messages matching query "${query}"`,
    );

    return ordered.map((m) => this.formatMessage(m));
  }

  /**
   * Search messages in a specific direct message group using PostgreSQL full-text search
   * via the GIN-indexed searchVector tsvector column.
   */
  async searchDirectMessages(
    directMessageGroupId: string,
    query: string,
    limit = 50,
  ) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const rawMessages = await this.databaseService.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Message"
      WHERE "directMessageGroupId" = ${directMessageGroupId}
        AND "deletedAt" IS NULL
        AND "searchVector" @@ plainto_tsquery('english', ${query})
      ORDER BY "sentAt" DESC
      LIMIT ${limit}
    `;

    if (rawMessages.length === 0) {
      return [];
    }

    const messageIds = rawMessages.map((m) => m.id);
    const messages = await this.databaseService.message.findMany({
      where: { id: { in: messageIds } },
      include: MESSAGE_INCLUDE,
    });

    // Preserve the ORDER BY sentAt DESC from the raw query
    const messageMap = new Map(messages.map((m) => [m.id, m]));
    const ordered = messageIds
      .map((id) => messageMap.get(id))
      .filter(Boolean) as typeof messages;

    return ordered.map((m) => this.formatMessage(m));
  }

  /**
   * Search messages across all accessible channels in a community using PostgreSQL full-text search
   * via the GIN-indexed searchVector tsvector column.
   */
  async searchCommunityMessages(
    communityId: string,
    userId: string,
    query: string,
    limit = 50,
  ) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    // Get all channels the user has access to in this community
    const accessibleChannels = await this.databaseService.channel.findMany({
      where: {
        communityId,
        OR: [
          { isPrivate: false },
          {
            isPrivate: true,
            ChannelMembership: { some: { userId } },
          },
        ],
      },
      select: { id: true, name: true },
    });

    const channelIds = accessibleChannels.map((c) => c.id);
    const channelMap = new Map(accessibleChannels.map((c) => [c.id, c.name]));

    if (channelIds.length === 0) {
      return [];
    }

    const rawMessages = await this.databaseService.$queryRaw<
      { id: string; channelId: string }[]
    >`
      SELECT "id", "channelId" FROM "Message"
      WHERE "channelId" = ANY(${channelIds})
        AND "deletedAt" IS NULL
        AND "searchVector" @@ plainto_tsquery('english', ${query})
      ORDER BY "sentAt" DESC
      LIMIT ${limit}
    `;

    if (rawMessages.length === 0) {
      return [];
    }

    const messageIds = rawMessages.map((m) => m.id);
    const messages = await this.databaseService.message.findMany({
      where: { id: { in: messageIds } },
      include: MESSAGE_INCLUDE,
    });

    // Preserve the ORDER BY sentAt DESC from the raw query
    const messageMap = new Map(messages.map((m) => [m.id, m]));
    const ordered = messageIds
      .map((id) => messageMap.get(id))
      .filter(Boolean) as typeof messages;

    return ordered.map((msg) => ({
      ...this.formatMessage(msg),
      channelName: channelMap.get(msg.channelId ?? '') ?? 'Unknown',
    }));
  }

  /**
   * Format a message with included relations into the shape expected by clients.
   * Converts MessageReaction[] to { emoji, userIds[] }[] and
   * MessageAttachment[] to file metadata objects.
   */
  private formatMessage<
    T extends {
      spans?: {
        position: number;
        type: string;
        text: string | null;
        userId: string | null;
        specialKind: string | null;
        communityId: string | null;
        aliasId: string | null;
      }[];
      reactions?: { emoji: string; userId: string }[];
      attachments?: {
        file: {
          id: string;
          filename: string;
          mimeType: string;
          fileType: FileType;
          size: number;
          thumbnailPath: string | null;
        };
      }[];
    },
  >(message: T) {
    return {
      ...message,
      spans: message.spans ?? [],
      reactions: message.reactions ? groupReactions(message.reactions) : [],
      attachments: message.attachments
        ? message.attachments.map((a) => MessagesService.toFileMetadata(a.file))
        : [],
    };
  }

  /**
   * Transform a Prisma file select result into the FileMetadata shape
   * sent to clients. Converts `thumbnailPath` (internal) to `hasThumbnail` (boolean).
   */
  private static toFileMetadata(file: {
    id: string;
    filename: string;
    mimeType: string;
    fileType: FileType;
    size: number;
    thumbnailPath: string | null;
  }) {
    return {
      id: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      fileType: file.fileType,
      size: file.size,
      hasThumbnail: !!file.thumbnailPath,
    };
  }
}
