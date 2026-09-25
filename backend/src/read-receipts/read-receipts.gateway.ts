import { UserEntity } from '@/user/dto/user-response.dto';
import { Logger, UseFilters, UseGuards } from '@nestjs/common';
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
import { ReadReceiptsService } from './read-receipts.service';
import { MarkAsReadDto } from './dto/mark-as-read.dto';
import { Server, Socket } from 'socket.io';
import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import { NotificationsService } from '@/notifications/notifications.service';
import { RoomName } from '@/common/utils/room-name.util';
import { WebsocketService } from '@/websocket/websocket.service';

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
export class ReadReceiptsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ReadReceiptsGateway.name);

  constructor(
    private readonly readReceiptsService: ReadReceiptsService,
    private readonly notificationsService: NotificationsService,
    private readonly websocketService: WebsocketService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterInit(_server: Server) {
    this.logger.log('ReadReceiptsGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected to ReadReceiptsGateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(
      `Client disconnected from ReadReceiptsGateway: ${client.id}`,
    );
  }

  /**
   * Handle mark as read event from client
   * Updates the read receipt and notifies the user's other sessions
   * Also broadcasts to the channel/DM room for real-time "seen by" updates
   */
  @SubscribeMessage(ClientEvents.MARK_AS_READ)
  async handleMarkAsRead(
    @MessageBody() payload: MarkAsReadDto,
    @ConnectedSocket() client: Socket & { handshake: { user: UserEntity } },
  ): Promise<void> {
    try {
      const userId = client.handshake.user.id;
      const user = client.handshake.user;

      // Mark messages as read
      const readReceipt = await this.readReceiptsService.markAsRead(
        userId,
        payload,
      );

      // Also mark related mention notifications as read so mentionCount
      // stays consistent with read-receipt state after refetch/reconnect
      await this.notificationsService.markContextNotificationsAsRead(
        userId,
        readReceipt.channelId,
        readReceipt.directMessageGroupId,
      );

      const receiptPayload = {
        channelId: readReceipt.channelId,
        directMessageGroupId: readReceipt.directMessageGroupId,
        lastReadMessageId: readReceipt.lastReadMessageId,
        // Cast, not converted: the wire type's declared shape is the
        // post-serialization ISO string, but this hands the raw Date
        // straight through — WebsocketService.sendToRoom() normalizes
        // every payload to JSON wire form (Date -> ISO string) right
        // before `.emit()`, so the runtime already matches this cast. See
        // toWirePayload in @/websocket/websocket-wire.util. Fixes #440.
        lastReadAt: readReceipt.lastReadAt as unknown as string,
      };

      // Emit to all of the user's connected sessions (including this one)
      // This ensures that if the user has the app open on multiple devices,
      // all sessions stay in sync
      const userRoom = RoomName.user(userId);
      this.websocketService.sendToRoom(
        userRoom,
        ServerEvents.READ_RECEIPT_UPDATED,
        receiptPayload,
      );

      // Also emit to the channel/DM room so other users can see real-time "seen by" updates
      // Only do this for DMs where "seen by" is shown (privacy-conscious approach)
      if (readReceipt.directMessageGroupId) {
        const dmRoom = RoomName.dmGroup(readReceipt.directMessageGroupId);
        this.websocketService.sendToRoom(
          dmRoom,
          ServerEvents.READ_RECEIPT_UPDATED,
          {
            ...receiptPayload,
            // Include user info so other clients can update "seen by" without refetching
            userId,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
          },
        );
      }

      this.logger.debug(
        `User ${userId} marked ${readReceipt.channelId || readReceipt.directMessageGroupId} as read`,
      );
    } catch (error) {
      this.logger.error('Error marking messages as read', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to mark messages as read';
      throw new WsException(errorMessage);
    }
  }
}
