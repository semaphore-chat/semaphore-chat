import { toSpanDto } from '@/messages/message.mapper';
import { Logger, UseGuards, UseFilters } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  ServerEvents,
  type NotificationsReadPayload,
} from '@semaphore-chat/shared';
import { Notification } from '@prisma/client';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import { RoomName } from '@/common/utils/room-name.util';
import { SpanDto } from '@/messages/dto/message-response.dto';
import { WebsocketService } from '@/websocket/websocket.service';

/**
 * Gateway for sending real-time notification events to clients
 * Note: This gateway is primarily used for emitting events, not receiving them
 * Notification creation happens in the MessagesGateway when messages are processed
 */
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
@UseGuards(WsThrottleGuard, WsJwtAuthGuard)
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly websocketService: WebsocketService) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterInit(_server: Server) {
    this.logger.log('NotificationsGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected to NotificationsGateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(
      `Client disconnected from NotificationsGateway: ${client.id}`,
    );
  }

  /**
   * Emit a new notification to a specific user
   * This is called by the NotificationsService after creating a notification
   */
  emitNotificationToUser(
    userId: string,
    notification: Notification & {
      author?: {
        id: string;
        username: string;
        displayName: string | null;
        avatarUrl: string | null;
      } | null;
      message?: {
        id: string;
        // Message.spans is a MessageSpan[] relation (Prisma), not the shared
        // `Span[]` DTO shape — Prisma's nullable columns come back as
        // `T | null`, not `T | undefined` (`Span`'s convention), so the
        // shared type doesn't structurally match without a lossy cast.
        // SpanDto already models the Prisma-nullable shape (see
        // DmGroupLastMessageDto for the same pattern).
        spans: SpanDto[];
        channelId: string | null;
        directMessageGroupId: string | null;
      } | null;
      channel?: {
        id: string;
        name: string;
        communityId: string;
      } | null;
    },
  ): void {
    const userRoom = RoomName.user(userId);

    this.websocketService.sendToRoom(userRoom, ServerEvents.NEW_NOTIFICATION, {
      notificationId: notification.id,
      type: notification.type,
      messageId: notification.messageId,
      channelId: notification.channelId,
      communityId: notification.channel?.communityId ?? null,
      channelName: notification.channel?.name ?? null,
      directMessageGroupId: notification.directMessageGroupId,
      authorId: notification.authorId,
      author: notification.author ?? null,
      message: notification.message
        ? {
            id: notification.message.id,
            spans: notification.message.spans.map(toSpanDto),
            channelId: notification.message.channelId,
            directMessageGroupId: notification.message.directMessageGroupId,
          }
        : null,
      createdAt: notification.createdAt.toISOString(),
      read: notification.read,
    });

    this.logger.debug(`Notification ${notification.id} sent to user ${userId}`);
  }

  /**
   * Emit that notifications were marked read in bulk, to the user's own
   * sessions: their other devices' badges must not wait for a reload. The
   * payload is the scope only (no ids), so a client refetches the count.
   */
  emitNotificationsRead(userId: string, scope: NotificationsReadPayload): void {
    this.websocketService.sendToRoom(
      RoomName.user(userId),
      ServerEvents.NOTIFICATIONS_READ,
      scope,
    );

    this.logger.debug(
      `Notifications read in scope ${scope.scope} for user ${userId}`,
    );
  }

  /** Emit that one notification was dismissed, so other devices drop its row. */
  emitNotificationDismissed(userId: string, notificationId: string): void {
    this.websocketService.sendToRoom(
      RoomName.user(userId),
      ServerEvents.NOTIFICATION_DISMISSED,
      { notificationId },
    );

    this.logger.debug(
      `Notification ${notificationId} dismissed for user ${userId}`,
    );
  }

  /**
   * Emit notification read status update to user
   */
  emitNotificationRead(userId: string, notificationId: string): void {
    const userRoom = RoomName.user(userId);

    this.websocketService.sendToRoom(userRoom, ServerEvents.NOTIFICATION_READ, {
      notificationId,
    });

    this.logger.debug(
      `Notification ${notificationId} marked as read for user ${userId}`,
    );
  }
}
