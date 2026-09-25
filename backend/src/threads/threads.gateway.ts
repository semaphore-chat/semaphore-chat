import { RequiredActions } from '@/auth/rbac-action.decorator';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { RbacGuard } from '@/auth/rbac.guard';
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
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import { RbacActions } from '@prisma/client';
import { ThreadsService } from './threads.service';
import { SendThreadReplyDto } from './dto/send-thread-reply.dto';
import { Server, Socket } from 'socket.io';
import { ClientEvents, ServerEvents } from '@semaphore-chat/shared';
import { WebsocketService } from '@/websocket/websocket.service';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import { NotificationsService } from '@/notifications/notifications.service';
import { getSocketUserId } from '@/common/utils/socket.utils';
import { DatabaseService } from '@/database/database.service';
import { RoomName } from '@/common/utils/room-name.util';
import { LinkPreviewsService } from '@/link-previews/link-previews.service';
import { toWireMessage } from '@/common/utils/message-wire.utils';

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
export class ThreadsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ThreadsGateway.name);

  constructor(
    private readonly threadsService: ThreadsService,
    private readonly websocketService: WebsocketService,
    private readonly notificationsService: NotificationsService,
    private readonly databaseService: DatabaseService,
    private readonly linkPreviewsService: LinkPreviewsService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  afterInit(_server: Server) {
    this.logger.log('ThreadsGateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected to ThreadsGateway: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected from ThreadsGateway: ${client.id}`);
  }

  @SubscribeMessage(ClientEvents.SEND_THREAD_REPLY)
  @RequiredActions(RbacActions.CREATE_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'parentMessageId',
    source: ResourceIdSource.PAYLOAD,
  })
  async handleThreadReply(
    @MessageBody() payload: SendThreadReplyDto,
    @ConnectedSocket() client: Socket,
  ): Promise<string> {
    const userId = getSocketUserId(client);

    if (!payload.parentMessageId) {
      throw new WsException('parentMessageId is required for thread replies');
    }

    // Create the thread reply
    const reply = await this.threadsService.createThreadReply(
      {
        parentMessageId: payload.parentMessageId,
        spans: payload.spans,
        attachments: payload.attachments,
        pendingAttachments: payload.pendingAttachments,
      },
      userId,
    );

    // Get the parent message to determine the room
    const parentMessage = await this.databaseService.message.findUnique({
      where: { id: payload.parentMessageId },
      select: {
        channelId: true,
        directMessageGroupId: true,
        replyCount: true,
        lastReplyAt: true,
      },
    });

    if (!parentMessage) {
      throw new WsException('Parent message not found');
    }

    const roomId = parentMessage.directMessageGroupId
      ? RoomName.dmGroup(parentMessage.directMessageGroupId)
      : parentMessage.channelId;

    if (roomId) {
      // Emit the new thread reply to the room
      this.websocketService.sendToRoom(roomId, ServerEvents.NEW_THREAD_REPLY, {
        reply: toWireMessage(reply),
        parentMessageId: payload.parentMessageId,
      });

      // Also emit the updated reply count for the parent message badge
      this.websocketService.sendToRoom(
        roomId,
        ServerEvents.THREAD_REPLY_COUNT_UPDATED,
        {
          parentMessageId: payload.parentMessageId,
          replyCount: parentMessage.replyCount,
          // Cast, not converted: this hands the raw Date straight through
          // to WebsocketService.sendToRoom() unchanged — no per-call-site
          // conversion needed. The payload's declared wire type is the
          // post-serialization `string | null` shape; WebsocketService now
          // normalizes every payload to that JSON wire form (Date -> ISO
          // string) right before `.emit()`, so this cast is purely a
          // static-type relabeling and the runtime already matches it.
          // See toWirePayload in @/websocket/websocket-wire.util. Fixes #440.
          lastReplyAt: parentMessage.lastReplyAt as unknown as string | null,
          channelId: parentMessage.channelId ?? null,
          directMessageGroupId: parentMessage.directMessageGroupId ?? null,
        },
      );
    }

    // Process notifications for thread subscribers (async, non-blocking)
    this.notificationsService
      .processThreadReplyNotifications(reply, payload.parentMessageId, userId)
      .catch((error) =>
        this.logger.error(
          'Failed to process notifications for thread reply',
          error,
        ),
      );

    // Process link previews for thread reply (async, non-blocking)
    if (roomId) {
      this.linkPreviewsService
        .processMessageLinkPreviews(
          reply.id,
          reply.spans,
          roomId,
          ServerEvents.UPDATE_MESSAGE,
        )
        .catch((error) =>
          this.logger.error(
            'Failed to process link previews for thread reply',
            error,
          ),
        );
    }

    return reply.id;
  }
}
