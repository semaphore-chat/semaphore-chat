import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayDisconnect,
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
 * NOTE: Voice presence is now primarily managed by LiveKit webhooks.
 * - participant_joined webhook → updates Redis when user connects to LiveKit
 * - participant_left webhook → updates Redis when user disconnects from LiveKit
 *
 * This gateway provides:
 * - Cleanup on WebSocket disconnect (backup for LiveKit webhook)
 * - Presence TTL refresh
 */
@UseFilters(WsLoggingExceptionFilter)
@WebSocketGateway()
@UsePipes(wsValidationPipe)
@UseGuards(WsJwtAuthGuard, RbacGuard)
export class VoicePresenceGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(VoicePresenceGateway.name);

  constructor(private readonly voicePresenceService: VoicePresenceService) {}

  async handleDisconnect(client: Socket) {
    const user = (client.handshake as { user?: UserEntity }).user;
    if (!user) return;

    this.logger.log(
      `Client disconnected: ${client.id}, cleaning up voice presence`,
    );

    // Clean up user's voice presence in all channels they were in
    // This is a backup for LiveKit webhooks - if the webhook fails,
    // we still clean up when the user's WebSocket disconnects
    const voiceChannels = await this.voicePresenceService.getUserVoiceChannels(
      user.id,
    );
    for (const channelId of voiceChannels) {
      await this.voicePresenceService.leaveVoiceChannel(channelId, user.id);
    }
  }

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
