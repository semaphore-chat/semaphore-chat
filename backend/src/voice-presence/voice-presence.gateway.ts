import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { VoicePresenceService } from './voice-presence.service';
import { Socket } from 'socket.io';
import { UserEntity } from '@/user/dto/user-response.dto';
import { Logger, UseGuards, UsePipes, UseFilters } from '@nestjs/common';
import { RbacGuard } from '@/auth/rbac.guard';
import { ClientEvents } from '@kraken/shared';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { wsValidationPipe } from '@/common/pipes/ws-validation.pipe';
import { WsLoggingExceptionFilter } from '@/websocket/ws-exception.filter';
import { WsJwtAuthGuard } from '@/auth/ws-jwt-auth.guard';
import { IsString, IsNotEmpty } from 'class-validator';

class VoiceChannelEventDto {
  @IsString()
  @IsNotEmpty()
  channelId: string;
}

/**
 * Voice Presence WebSocket Gateway
 *
 * NOTE: Voice presence is managed by LiveKit webhooks.
 * - participant_joined webhook → updates Redis when user connects to LiveKit
 * - participant_left webhook → updates Redis when user disconnects from LiveKit
 *
 * This gateway provides:
 * - Presence TTL refresh (heartbeat from connected clients)
 */
@UseFilters(WsLoggingExceptionFilter)
@WebSocketGateway()
@UsePipes(wsValidationPipe)
@UseGuards(WsJwtAuthGuard, RbacGuard)
export class VoicePresenceGateway {
  private readonly logger = new Logger(VoicePresenceGateway.name);

  constructor(private readonly voicePresenceService: VoicePresenceService) {}

  @SubscribeMessage(ClientEvents.VOICE_PRESENCE_REFRESH)
  @RequiredActions(RbacActions.JOIN_CHANNEL)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PAYLOAD,
  })
  async handleRefreshPresence(
    @ConnectedSocket() client: Socket & { handshake: { user: UserEntity } },
    @MessageBody() data: VoiceChannelEventDto,
  ) {
    const user = client.handshake.user;
    await this.voicePresenceService.refreshPresence(data.channelId, user.id);

    return {
      success: true,
      channelId: data.channelId,
    };
  }
}
