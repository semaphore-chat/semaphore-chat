import { RequiredActions } from '@/auth/rbac-action.decorator';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { RbacGuard } from '@/auth/rbac.guard';
import { Logger, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { wsValidationPipe } from '@/common/pipes/ws-validation.pipe';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import { RbacActions } from '@prisma/client';
import { MessagesService } from './messages.service';
import { ReactionsService } from './reactions.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { AddReactionDto } from './dto/add-reaction.dto';
import { RemoveReactionDto } from './dto/remove-reaction.dto';
import { TypingEventDto } from './dto/typing-event.dto';
import { Server, Socket } from 'socket.io';
import { ClientEvents, ServerEvents } from '@kraken/shared';
import { WebsocketService } from '@/websocket/websocket.service';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import { NotificationsService } from '@/notifications/notifications.service';
import { ModerationService } from '@/moderation/moderation.service';
import { ReadReceiptsService } from '@/read-receipts/read-receipts.service';
import { getSocketUserId } from '@/common/utils/socket.utils';
import { groupReactions } from '@/common/utils/reactions.utils';

@UseFilters(WsLoggingExceptionFilter)
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173'],
    credentials: true,
  },
  transports: ['websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
})
@UsePipes(wsValidationPipe)
@UseGuards(WsThrottleGuard, WsJwtAuthGuard, RbacGuard)
export class MessagesGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  constructor(
    private readonly messagesService: MessagesService,
    private readonly reactionsService: ReactionsService,
    private readonly websocketService: WebsocketService,
    private readonly notificationsService: NotificationsService,
    private readonly moderationService: ModerationService,
    private readonly readReceiptsService: ReadReceiptsService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterInit(_server: Server) {
    this.logger.log('MessagesGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected to MessagesGateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected from MessagesGateway: ${client.id}`);
  }

  @SubscribeMessage(ClientEvents.SEND_MESSAGE)
  @RequiredActions(RbacActions.CREATE_MESSAGE)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PAYLOAD,
  })
  async handleMessage(
    @MessageBody() payload: CreateMessageDto,
    @ConnectedSocket() client: Socket,
  ): Promise<string> {
    const userId = getSocketUserId(client);

    if (!payload.channelId) {
      throw new WsException('channelId is required for channel messages');
    }

    // Check if user is timed out in this community
    const communityId = await this.moderationService.getCommunityIdFromChannel(
      payload.channelId,
    );
    const timeoutStatus = await this.moderationService.isUserTimedOut(
      communityId,
      userId,
    );
    if (timeoutStatus.isTimedOut) {
      const remainingMs = timeoutStatus.expiresAt
        ? timeoutStatus.expiresAt.getTime() - Date.now()
        : 0;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      throw new WsException(
        `You are timed out in this community. Time remaining: ${remainingSeconds} seconds`,
      );
    }

    // Check slowmode
    try {
      await this.messagesService.checkSlowmode(payload.channelId, userId);
    } catch (error) {
      throw new WsException(
        error instanceof Error ? error.message : 'Slowmode check failed',
      );
    }

    const message = await this.messagesService.create({
      ...payload,
      authorId: userId,
      sentAt: new Date(),
    });

    // Auto-mark the sender's own message as read
    this.readReceiptsService
      .markAsRead(userId, {
        lastReadMessageId: message.id,
        channelId: payload.channelId,
      })
      .then((receipt) => {
        this.server
          .to(`user:${userId}`)
          .emit(ServerEvents.READ_RECEIPT_UPDATED, {
            channelId: receipt.channelId,
            directMessageGroupId: receipt.directMessageGroupId,
            lastReadMessageId: receipt.lastReadMessageId,
            lastReadAt: receipt.lastReadAt,
          });
      })
      .catch((error) =>
        this.logger.error('Failed to auto-mark message as read', error),
      );

    // Process message for notifications (mentions, etc.)
    // This runs asynchronously and doesn't block message sending
    this.notificationsService
      .processMessageForNotifications(message)
      .catch((error) =>
        this.logger.error('Failed to process notifications for message', error),
      );

    // Enrich message with file metadata before emitting
    const enrichedMessage =
      this.messagesService.enrichMessageWithFileMetadata(message);

    this.websocketService.sendToRoom(
      payload.channelId,
      ServerEvents.NEW_MESSAGE,
      {
        message: enrichedMessage,
      },
    );

    return message.id;
  }

  @SubscribeMessage(ClientEvents.SEND_DM)
  @RequiredActions(RbacActions.CREATE_MESSAGE)
  @RbacResource({
    type: RbacResourceType.DM_GROUP,
    idKey: 'directMessageGroupId',
    source: ResourceIdSource.PAYLOAD,
  })
  async handleDirectMessageWithRBAC(
    @MessageBody() payload: CreateMessageDto,
    @ConnectedSocket() client: Socket,
  ): Promise<string> {
    const userId = getSocketUserId(client);

    if (!payload.directMessageGroupId) {
      throw new WsException(
        'directMessageGroupId is required for direct messages',
      );
    }

    const message = await this.messagesService.create({
      ...payload,
      authorId: userId,
      sentAt: new Date(),
    });

    // Auto-mark the sender's own message as read
    this.readReceiptsService
      .markAsRead(userId, {
        lastReadMessageId: message.id,
        directMessageGroupId: payload.directMessageGroupId,
      })
      .then((receipt) => {
        this.server
          .to(`user:${userId}`)
          .emit(ServerEvents.READ_RECEIPT_UPDATED, {
            channelId: receipt.channelId,
            directMessageGroupId: receipt.directMessageGroupId,
            lastReadMessageId: receipt.lastReadMessageId,
            lastReadAt: receipt.lastReadAt,
          });
      })
      .catch((error) =>
        this.logger.error('Failed to auto-mark DM as read', error),
      );

    // Process message for notifications (mentions, DMs, etc.)
    // This runs asynchronously and doesn't block message sending
    this.notificationsService
      .processMessageForNotifications(message)
      .catch((error) =>
        this.logger.error('Failed to process notifications for DM', error),
      );

    // Enrich message with file metadata before emitting
    const enrichedMessage =
      this.messagesService.enrichMessageWithFileMetadata(message);

    this.websocketService.sendToRoom(
      payload.directMessageGroupId,
      ServerEvents.NEW_DM,
      {
        message: enrichedMessage,
      },
    );

    return message.id;
  }

  @SubscribeMessage(ClientEvents.ADD_REACTION)
  @RequiredActions(RbacActions.CREATE_REACTION)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.PAYLOAD,
  })
  async handleAddReaction(
    @MessageBody() payload: AddReactionDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = getSocketUserId(client);
    const result = await this.reactionsService.addReaction(
      payload.messageId,
      payload.emoji,
      userId,
    );

    // Broadcast to all users in the channel
    const roomId = result.channelId || result.directMessageGroupId;
    if (roomId) {
      const grouped = groupReactions(result.reactions);
      const reaction = grouped.find((r) => r.emoji === payload.emoji);
      this.websocketService.sendToRoom(roomId, ServerEvents.REACTION_ADDED, {
        messageId: result.id,
        reaction: reaction,
        channelId: result.channelId ?? null,
        directMessageGroupId: result.directMessageGroupId ?? null,
      });
    }
  }

  @SubscribeMessage(ClientEvents.REMOVE_REACTION)
  @RequiredActions(RbacActions.DELETE_REACTION)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.PAYLOAD,
  })
  async handleRemoveReaction(
    @MessageBody() payload: RemoveReactionDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const userId = getSocketUserId(client);
    const result = await this.reactionsService.removeReaction(
      payload.messageId,
      payload.emoji,
      userId,
    );

    // Broadcast to all users in the channel
    const roomId = result.channelId || result.directMessageGroupId;
    if (roomId) {
      this.websocketService.sendToRoom(roomId, ServerEvents.REACTION_REMOVED, {
        messageId: result.id,
        emoji: payload.emoji,
        reactions: groupReactions(result.reactions),
        channelId: result.channelId ?? null,
        directMessageGroupId: result.directMessageGroupId ?? null,
      });
    }
  }

  @SubscribeMessage(ClientEvents.TYPING_START)
  handleTypingStart(
    @MessageBody() payload: TypingEventDto,
    @ConnectedSocket() client: Socket,
  ): void {
    const userId = getSocketUserId(client);
    const roomId = payload.channelId || payload.directMessageGroupId;
    if (!roomId) return;

    // Only allow typing in rooms the socket has joined (prevents channel probing)
    if (!client.rooms.has(roomId)) return;

    // Broadcast to room, excluding sender
    client.to(roomId).emit(ServerEvents.USER_TYPING, {
      userId,
      channelId: payload.channelId,
      directMessageGroupId: payload.directMessageGroupId,
      isTyping: true,
    });
  }

  @SubscribeMessage(ClientEvents.TYPING_STOP)
  handleTypingStop(
    @MessageBody() payload: TypingEventDto,
    @ConnectedSocket() client: Socket,
  ): void {
    const userId = getSocketUserId(client);
    const roomId = payload.channelId || payload.directMessageGroupId;
    if (!roomId) return;

    // Only allow typing in rooms the socket has joined (prevents channel probing)
    if (!client.rooms.has(roomId)) return;

    client.to(roomId).emit(ServerEvents.USER_TYPING, {
      userId,
      channelId: payload.channelId,
      directMessageGroupId: payload.directMessageGroupId,
      isTyping: false,
    });
  }
}
