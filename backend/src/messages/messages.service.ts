import { assertNotBlockedInDm } from '@/common/utils/user-block.utils';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { ChannelAccessService } from '@/roles/channel-access.service';
import { PermissionsService } from '@/roles/permissions.service';
import { DatabaseService } from '@/database/database.service';
import { FileService } from '@/file/file.service';
import { flattenSpansToText } from '@/common/utils/text.utils';
import { sanitizeEmojiSpans } from '@/common/utils/emoji-span.utils';
import { sanitizeChannelMentionSpans } from '@/common/utils/channel-mention-span.utils';
import { assertFilesAttachable } from '@/common/utils/attachable-files.utils';
import { Prisma, SpanType } from '@prisma/client';
import { MESSAGE_INCLUDE_WITH_REPLY, toMessageDto } from './message.mapper';
import { ErrorCode } from '@semaphore-chat/shared';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fileService: FileService,
    private readonly channelAccessService: ChannelAccessService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * Accepts an optional `webhookId` in addition to the public `CreateMessageDto`
   * shape (and widens `authorId` to allow `null`, for webhook-attributed
   * messages). Neither is part of the public `CreateMessageDto` (bound to the
   * POST /messages and WS SEND_MESSAGE payloads) — both are only ever set
   * internally by the webhooks execution flow, never by client input.
   */
  async create(
    createMessageDto: Omit<CreateMessageDto, 'authorId'> & {
      authorId: string | null;
      webhookId?: string | null;
    },
  ) {
    // A message lives in exactly one place. Callers authorize one target, so
    // a second one in the payload would be written without any check.
    if (
      !createMessageDto.channelId === !createMessageDto.directMessageGroupId
    ) {
      throw new BadRequestException(
        'Must provide exactly one of channelId or directMessageGroupId',
        {
          description: 'Bad Request',
          errorCode: ErrorCode.MESSAGE_TARGET_INVALID,
        },
      );
    }

    // Block between the two people in a 1:1 DM: no new messages, either way
    if (createMessageDto.directMessageGroupId && createMessageDto.authorId) {
      await assertNotBlockedInDm(
        this.databaseService,
        createMessageDto.authorId,
        createMessageDto.directMessageGroupId,
      );
    }

    // Validate replyToId references a message in the same channel/DM group
    if (createMessageDto.replyToId) {
      const replyTarget = await this.databaseService.message.findUnique({
        where: { id: createMessageDto.replyToId },
        select: { channelId: true, directMessageGroupId: true },
      });
      if (!replyTarget) {
        throw new NotFoundException('Quoted message not found', {
          description: 'Not Found',
          errorCode: ErrorCode.QUOTE_NOT_FOUND,
        });
      }
      const sameContext =
        (createMessageDto.channelId &&
          replyTarget.channelId === createMessageDto.channelId) ||
        (createMessageDto.directMessageGroupId &&
          replyTarget.directMessageGroupId ===
            createMessageDto.directMessageGroupId);
      if (!sameContext) {
        throw new ForbiddenException(
          'Cannot quote a message from a different channel',
          {
            description: 'Forbidden',
            errorCode: ErrorCode.QUOTE_OTHER_CONTEXT,
          },
        );
      }
    }

    // Attaching files (now or via pendingAttachments) needs ATTACH_FILES in
    // the channel. Webhook messages are exempt (they post in read-only
    // channels by design and carry no user).
    if (
      createMessageDto.channelId &&
      createMessageDto.authorId &&
      !createMessageDto.webhookId &&
      ((createMessageDto.attachments?.length ?? 0) > 0 ||
        (createMessageDto.pendingAttachments ?? 0) > 0)
    ) {
      await this.permissionsService.assertCanAttachFiles(
        createMessageDto.authorId,
        createMessageDto.channelId,
      );
    }
    if (createMessageDto.authorId && !createMessageDto.webhookId) {
      await this.assertFilesAttachable(
        createMessageDto.authorId,
        createMessageDto.attachments ?? [],
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, spans: rawSpans, attachments, ...data } = createMessageDto;

    // Convert EMOJI spans with unknown/foreign emojiIds to plaintext so a
    // hand-crafted payload can't trip the FK (P2003 -> 500) or reference
    // another community's emoji.
    const emojiSafe = await sanitizeEmojiSpans(
      this.databaseService,
      rawSpans,
      createMessageDto.channelId,
    );
    // #channel mentions: same community, visible to the author, no name stored
    const spans = await sanitizeChannelMentionSpans(
      this.databaseService,
      emojiSafe,
      createMessageDto.channelId,
      createMessageDto.authorId,
      (userId, channelId) =>
        this.channelAccessService.canViewChannel(userId, channelId),
    );

    const searchText = flattenSpansToText(spans);
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
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    return toMessageDto(message);
  }

  assertFilesAttachable(userId: string, fileIds: readonly unknown[]) {
    return assertFilesAttachable(this.databaseService, userId, fileIds);
  }

  /**
   * Files leave with a message only when its author uploaded them. Older rows
   * can carry someone else's file, which stays for its own message.
   */
  private async markAuthorFilesForDeletion(
    tx: Prisma.TransactionClient,
    authorId: string | null,
    fileIds: string[],
  ) {
    if (fileIds.length === 0) return;
    const files = await tx.file.findMany({
      where: { id: { in: fileIds }, uploadedById: authorId },
      select: { id: true },
    });
    for (const { id } of files) {
      await this.fileService.markForDeletion(id, tx);
    }
  }

  /**
   * Keeps a deleted message's nonce, so a client still retrying that send
   * (it never got the ack) can't bring the message back.
   */
  private async rememberDeletedNonces(
    tx: Prisma.TransactionClient,
    messages: { authorId: string | null; clientNonce: string | null }[],
  ) {
    const data = messages.flatMap(({ authorId, clientNonce }) =>
      authorId && clientNonce ? [{ authorId, clientNonce }] : [],
    );
    if (data.length > 0) {
      await tx.messageNonceTombstone.createMany({ data, skipDuplicates: true });
    }
  }

  /**
   * Builds the `create()` input for a webhook-attributed plaintext message.
   * Centralizes ownership of the CreateMessageDto shape so the webhooks
   * execution flow doesn't need to hand-construct every field itself.
   */
  buildWebhookMessageInput(
    webhook: { id: string; channelId: string },
    content: string,
  ): Omit<CreateMessageDto, 'authorId'> & {
    authorId: null;
    webhookId: string;
  } {
    return {
      id: '', // generated by Prisma
      channelId: webhook.channelId,
      directMessageGroupId: null,
      authorId: null,
      sentAt: new Date(),
      editedAt: null,
      deletedAt: null,
      spans: [
        {
          type: SpanType.PLAINTEXT,
          text: content,
          userId: null,
          specialKind: null,
          communityId: null,
          aliasId: null,
          emojiId: null,
        },
      ],
      attachments: [],
      pendingAttachments: 0,
      searchText: null,
      pinned: false,
      pinnedAt: null,
      pinnedBy: null,
      deletedBy: null,
      deletedByReason: null,
      parentMessageId: null,
      replyCount: 0,
      lastReplyAt: null,
      webhookId: webhook.id,
    };
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
      throw new ForbiddenException({
        statusCode: 403,
        message: `Slowmode is enabled. Please wait ${remainingSeconds} seconds before sending another message.`,
        error: 'Forbidden',
        errorCode: ErrorCode.SLOWMODE,
        retryAfterMs: remainingSeconds * 1000,
      });
    }
  }

  async findOne(id: string) {
    const message = await this.databaseService.message.findUnique({
      where: { id },
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return toMessageDto(message);
  }

  async update(
    id: string,
    updateMessageDto: UpdateMessageDto,
    originalAttachments?: string[],
  ) {
    // Validate EMOJI spans against the message's community (see create()).
    // Only fetch the message when the edit actually contains EMOJI spans.
    let sanitizedSpans = updateMessageDto.spans;
    if (
      sanitizedSpans?.some(
        (s) =>
          s.type === 'EMOJI' || s.type === 'CHANNEL_MENTION' || !!s.channelId,
      )
    ) {
      const existing = await this.databaseService.message.findUnique({
        where: { id },
        select: { channelId: true, authorId: true },
      });
      sanitizedSpans = await sanitizeEmojiSpans(
        this.databaseService,
        sanitizedSpans,
        existing?.channelId ?? null,
      );
      // Edits are by the author (MessageOwnershipGuard): same rule as create
      sanitizedSpans = await sanitizeChannelMentionSpans(
        this.databaseService,
        sanitizedSpans,
        existing?.channelId ?? null,
        existing?.authorId ?? null,
        (userId, channelId) =>
          this.channelAccessService.canViewChannel(userId, channelId),
      );
    }

    return this.databaseService.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const dataToUpdate: Record<string, unknown> = {};

        if (sanitizedSpans) {
          dataToUpdate.searchText = flattenSpansToText(sanitizedSpans);
          dataToUpdate.editedAt = new Date();

          // Delete old spans, create new ones
          await tx.messageSpan.deleteMany({ where: { messageId: id } });
          await tx.messageSpan.createMany({
            data: sanitizedSpans.map((span, i) => ({
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
            if (removedAttachments.length > 0) {
              const { authorId } = await tx.message.findUniqueOrThrow({
                where: { id },
                select: { authorId: true },
              });
              await this.markAuthorFilesForDeletion(
                tx,
                authorId,
                removedAttachments,
              );
              this.logger.debug(
                `Marked ${removedAttachments.length} removed attachments for deletion`,
              );
            }
          }
        }

        // Only spans and attachments are editable, both handled above. The DTO
        // also allows the create-time fields (target, quote, pending count),
        // and old clients may repeat them, so they're ignored rather than
        // rejected: nothing has authorized them for this message.
        const updatedMessage = await tx.message.update({
          where: { id },
          data: dataToUpdate,
          include: MESSAGE_INCLUDE_WITH_REPLY,
        });

        return toMessageDto(updatedMessage);
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
          await this.markAuthorFilesForDeletion(
            tx,
            reply.authorId,
            reply.attachments.map((attachment) => attachment.file.id),
          );
        }

        await this.rememberDeletedNonces(tx, threadReplies);

        // Delete all thread replies (thread subscribers cascade-delete with the parent)
        await tx.message.deleteMany({ where: { parentMessageId: id } });

        // 2. Delete the parent message
        const deletedMessage = await tx.message.delete({
          where: { id },
          include: MESSAGE_INCLUDE_WITH_REPLY,
        });

        await this.rememberDeletedNonces(tx, [deletedMessage]);

        // Mark parent's attachments for deletion
        if (
          deletedMessage.attachments &&
          deletedMessage.attachments.length > 0
        ) {
          await this.markAuthorFilesForDeletion(
            tx,
            deletedMessage.authorId,
            deletedMessage.attachments.map((attachment) => attachment.file.id),
          );
        }

        return toMessageDto(deletedMessage);
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

  /**
   * Attaches an uploaded file to a message and releases one of its
   * `pendingAttachments` slots. Without a `fileId` it only releases a slot:
   * the client gave up on that file (its upload failed and the user removed
   * it, or cancelled it mid-upload).
   *
   * Idempotent per file: attaching a file that is already on the message (a
   * client retrying an attach whose response it never got, though the server
   * had committed it, or two such requests racing) changes nothing and
   * returns the message, instead of failing on the (messageId, fileId)
   * unique key or releasing a second slot for the same file. The insert
   * skips duplicates (ON CONFLICT DO NOTHING), so this holds under
   * concurrency without aborting the transaction.
   */
  async addAttachment(messageId: string, fileId?: string) {
    return this.databaseService.$transaction(async (tx) => {
      if (fileId) {
        // Get current max position for ordering
        const maxPos = await tx.messageAttachment.aggregate({
          where: { messageId },
          _max: { position: true },
        });
        const nextPosition = (maxPos._max.position ?? -1) + 1;

        const { count } = await tx.messageAttachment.createMany({
          data: [{ messageId, fileId, position: nextPosition }],
          skipDuplicates: true,
        });
        if (count === 0) {
          // Already attached: nothing to add, no slot to release.
          return toMessageDto(
            await tx.message.findUniqueOrThrow({
              where: { id: messageId },
              include: MESSAGE_INCLUDE_WITH_REPLY,
            }),
          );
        }
      }

      const msg = await tx.message.findUnique({
        where: { id: messageId },
        select: { pendingAttachments: true },
      });

      return toMessageDto(
        await tx.message.update({
          where: { id: messageId },
          data: {
            ...(msg && (msg.pendingAttachments ?? 0) > 0
              ? { pendingAttachments: { decrement: 1 } }
              : {}),
          },
          include: MESSAGE_INCLUDE_WITH_REPLY,
        }),
      );
    });
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
      include: MESSAGE_INCLUDE_WITH_REPLY,
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
      toMessageDto(message),
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
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    if (
      !anchor ||
      anchor[field] !== fieldValue ||
      anchor.parentMessageId !== null
    ) {
      throw new NotFoundException('Message not found');
    }

    const baseWhere = { [field]: fieldValue, parentMessageId: null };

    // Fetch older messages (sentAt <= anchor, excluding anchor itself, descending)
    // Uses lte + id exclusion to avoid missing messages with identical timestamps.
    const older = await this.databaseService.message.findMany({
      where: {
        ...baseWhere,
        sentAt: { lte: anchor.sentAt },
        id: { not: messageId },
      },
      orderBy: { sentAt: 'desc' as const },
      take: halfLimit,
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    // Fetch newer messages (sentAt >= anchor, excluding anchor itself, ascending, then reverse)
    const newer = await this.databaseService.message.findMany({
      where: {
        ...baseWhere,
        sentAt: { gte: anchor.sentAt },
        id: { not: messageId },
      },
      orderBy: { sentAt: 'asc' as const },
      take: halfLimit,
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    const olderContinuationToken =
      older.length === halfLimit ? older[older.length - 1].id : undefined;
    // newer is asc (oldest→newest), so last element is the newest (farthest from anchor)
    const newerContinuationToken =
      newer.length === halfLimit ? newer[newer.length - 1].id : undefined;

    // Combine in newest-first order: [...newerReversed, anchor, ...older]
    const combined = [...[...newer].reverse(), anchor, ...older];
    const messages = combined.map((m) => toMessageDto(m));

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
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    // Preserve the ORDER BY sentAt DESC from the raw query
    const messageMap = new Map(messages.map((m) => [m.id, m]));
    const ordered = messageIds
      .map((id) => messageMap.get(id))
      .filter(Boolean) as typeof messages;

    this.logger.log(
      `Found ${ordered.length} messages matching query "${query}"`,
    );

    return ordered.map((m) => toMessageDto(m));
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
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    // Preserve the ORDER BY sentAt DESC from the raw query
    const messageMap = new Map(messages.map((m) => [m.id, m]));
    const ordered = messageIds
      .map((id) => messageMap.get(id))
      .filter(Boolean) as typeof messages;

    return ordered.map((m) => toMessageDto(m));
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

    // Only the channels the user can see (ChannelAccessService)
    const visibleIds = await this.channelAccessService.visibleChannelIds(
      userId,
      communityId,
    );
    const accessibleChannels = await this.databaseService.channel.findMany({
      where: { communityId, id: { in: visibleIds } },
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
      include: MESSAGE_INCLUDE_WITH_REPLY,
    });

    // Preserve the ORDER BY sentAt DESC from the raw query
    const messageMap = new Map(messages.map((m) => [m.id, m]));
    const ordered = messageIds
      .map((id) => messageMap.get(id))
      .filter(Boolean) as typeof messages;

    return ordered.map((msg) => ({
      ...toMessageDto(msg),
      channelName: channelMap.get(msg.channelId ?? '') ?? 'Unknown',
    }));
  }
}
