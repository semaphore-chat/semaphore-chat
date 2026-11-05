import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ErrorCode, ServerEvents } from '@semaphore-chat/shared';
import { RoomName } from '@/common/utils/room-name.util';
import { ModerationService } from '@/moderation/moderation.service';
import { ReadReceiptsService } from '@/read-receipts/read-receipts.service';
import { WebsocketService } from '@/websocket/websocket.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { MessageDispatchService } from './message-dispatch.service';
import { MessagesService } from './messages.service';

/**
 * A user sending a message, on any transport: the checks, the write, the
 * sender's read receipt and the broadcast. Callers handle authorization of the
 * target (RbacGuard) and how to report a failure.
 *
 * Messages not sent by a user (webhooks, clips) use MessagesService.create and
 * MessageDispatchService directly.
 */
@Injectable()
export class MessageSendService {
  private readonly logger = new Logger(MessageSendService.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly messageDispatchService: MessageDispatchService,
    private readonly moderationService: ModerationService,
    private readonly readReceiptsService: ReadReceiptsService,
    private readonly websocketService: WebsocketService,
  ) {}

  async sendToChannel(authorId: string, dto: CreateMessageDto) {
    const { channelId } = dto;
    if (!channelId) {
      throw new BadRequestException(
        'channelId is required for channel messages',
        {
          description: 'Bad Request',
          errorCode: ErrorCode.MESSAGE_TARGET_INVALID,
        },
      );
    }

    await this.assertNotTimedOut(channelId, authorId);
    await this.messagesService.checkSlowmode(channelId, authorId);

    const message = await this.messagesService.create({
      ...dto,
      authorId,
      sentAt: new Date(),
    });

    this.markReadForSender(authorId, message.id, { channelId });

    await this.messageDispatchService.dispatch(message, {
      room: channelId,
      event: ServerEvents.NEW_MESSAGE,
      notifications: true,
      linkPreviews: true,
    });

    return message;
  }

  async sendToDirectMessageGroup(authorId: string, dto: CreateMessageDto) {
    const { directMessageGroupId } = dto;
    if (!directMessageGroupId) {
      throw new BadRequestException(
        'directMessageGroupId is required for direct messages',
        {
          description: 'Bad Request',
          errorCode: ErrorCode.MESSAGE_TARGET_INVALID,
        },
      );
    }

    const message = await this.messagesService.create({
      ...dto,
      authorId,
      sentAt: new Date(),
    });

    this.markReadForSender(authorId, message.id, { directMessageGroupId });

    await this.messageDispatchService.dispatch(message, {
      room: RoomName.dmGroup(directMessageGroupId),
      event: ServerEvents.NEW_DM,
      notifications: true,
      linkPreviews: true,
    });

    return message;
  }

  /**
   * RBAC already masks posting for a timed-out user, except an instance owner,
   * who skips RBAC. This also gives the sender the time remaining.
   */
  private async assertNotTimedOut(channelId: string, userId: string) {
    const communityId =
      await this.moderationService.getCommunityIdFromChannel(channelId);
    const { isTimedOut, expiresAt } =
      await this.moderationService.isUserTimedOut(communityId, userId);
    if (isTimedOut) {
      const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : 0;
      throw new ForbiddenException({
        statusCode: 403,
        message: `You are timed out in this community. Time remaining: ${Math.ceil(remainingMs / 1000)} seconds`,
        error: 'Forbidden',
        errorCode: ErrorCode.TIMED_OUT,
        retryAfterMs: Math.max(remainingMs, 0),
      });
    }
  }

  /** Not awaited: a failed receipt must not fail or delay the send. */
  private markReadForSender(
    userId: string,
    lastReadMessageId: string,
    target: { channelId: string } | { directMessageGroupId: string },
  ) {
    this.readReceiptsService
      .markAsRead(userId, { lastReadMessageId, ...target })
      .then((receipt) => {
        this.websocketService.sendToRoom(
          RoomName.user(userId),
          ServerEvents.READ_RECEIPT_UPDATED,
          {
            channelId: receipt.channelId,
            directMessageGroupId: receipt.directMessageGroupId,
            lastReadMessageId: receipt.lastReadMessageId,
            lastReadAt: receipt.lastReadAt.toISOString(),
          },
        );
      })
      .catch((error) =>
        this.logger.error('Failed to auto-mark message as read', error),
      );
  }
}
