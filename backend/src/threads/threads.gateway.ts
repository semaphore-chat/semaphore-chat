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
import { ClientEvents, SendAck } from '@semaphore-chat/shared';
import { sendSuccessAck } from '@/websocket/send-ack';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { WsThrottleGuard } from '@/auth/ws-throttle.guard';
import { getSocketUserId } from '@/common/utils/socket.utils';

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

  constructor(private readonly threadsService: ThreadsService) {}

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
  ): Promise<string | SendAck> {
    const userId = getSocketUserId(client);

    if (!payload.parentMessageId) {
      throw new WsException('parentMessageId is required for thread replies');
    }

    // Create the thread reply
    const { reply } = await this.threadsService.sendThreadReply(
      {
        parentMessageId: payload.parentMessageId,
        spans: payload.spans,
        attachments: payload.attachments,
        pendingAttachments: payload.pendingAttachments,
        clientNonce: payload.clientNonce,
      },
      userId,
    );

    return sendSuccessAck(client, reply.id);
  }
}
