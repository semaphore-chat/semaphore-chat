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
import { ClientEvents } from '@semaphore-chat/shared';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';

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

  constructor(private readonly readReceiptsService: ReadReceiptsService) {}

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
      const user = client.handshake.user;
      const readReceipt = await this.readReceiptsService.markReadAndAnnounce(
        user,
        payload,
      );

      this.logger.debug(
        `User ${user.id} marked ${readReceipt.channelId || readReceipt.directMessageGroupId} as read`,
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
