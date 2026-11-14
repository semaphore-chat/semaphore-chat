import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LivekitService } from './livekit.service';
import {
  ROOM_SERVICE_CLIENT,
  RoomServiceProvider,
} from './providers/room-service.provider';

/**
 * LiveKit's room admin API (LivekitService and its RoomServiceClient), on
 * its own so VoicePresenceModule can ask LiveKit who is in a room without
 * importing LivekitModule, which imports VoicePresenceModule.
 */
@Module({
  imports: [ConfigModule],
  providers: [LivekitService, RoomServiceProvider],
  exports: [LivekitService, ROOM_SERVICE_CLIENT],
})
export class LivekitCoreModule {}
