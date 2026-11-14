import type { PresenceOnlineDto } from '@/websocket/dto/socket-events.dto';
import { RbacGuard } from '@/auth/rbac.guard';
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
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PresenceService } from './presence.service';
import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import { WebsocketService } from '@/websocket/websocket.service';
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
@UseGuards(WsThrottleGuard, WsJwtAuthGuard, RbacGuard)
export class PresenceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PresenceGateway.name);

  constructor(
    private readonly presenceService: PresenceService,
    private readonly websocketService: WebsocketService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterInit(_server: Server) {
    this.logger.log('PresenceGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected to PresenceGateway: ${client.id}`);
  }
  @SubscribeMessage(ClientEvents.PRESENCE_ONLINE)
  async handleMessage(
    @ConnectedSocket() client: Socket & { handshake: { user: UserEntity } },
    @MessageBody() data?: PresenceOnlineDto,
  ): Promise<string> {
    const userId = client.handshake.user.id;
    const connectionId = client.id;
    const idle = data?.idle === true;

    // Add this connection and check if user went from offline to online
    const wentOnline = await this.presenceService.addConnection(
      userId,
      connectionId,
      60, // 1 minute TTL
    );

    // Update idle state for this connection
    await this.presenceService.setConnectionIdle(userId, connectionId, idle);

    // Only broadcast if this is the user's first connection
    if (wentOnline) {
      await this.broadcastPresence(
        ServerEvents.USER_ONLINE,
        client.handshake.user,
      );
    }

    return 'ACK';
  }

  /**
   * Presence goes only to people connected to the user (shared communities,
   * DM groups, accepted friends), never to every socket on the instance.
   */
  private async broadcastPresence(
    event: typeof ServerEvents.USER_ONLINE | typeof ServerEvents.USER_OFFLINE,
    user: UserEntity,
  ): Promise<void> {
    const rooms = await this.presenceService.presenceAudienceRooms(user.id);
    if (rooms.length === 0) return;
    this.websocketService.sendToRooms(rooms, event, {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    });
  }

  /**
   * Handle user disconnection - only mark offline if this was their last connection
   */
  async handleDisconnect(
    client: Socket & { handshake: { user: UserEntity } },
  ): Promise<void> {
    this.logger.debug(`Client disconnected from PresenceGateway: ${client.id}`);
    if (client.handshake?.user?.id) {
      const userId = client.handshake.user.id;
      const connectionId = client.id;

      // Remove this connection and check if user went from online to offline
      const wentOffline = await this.presenceService.removeConnection(
        userId,
        connectionId,
      );

      // Only broadcast if this was the user's last connection
      if (wentOffline) {
        await this.broadcastPresence(
          ServerEvents.USER_OFFLINE,
          client.handshake.user,
        );
      }
    }
  }
}
