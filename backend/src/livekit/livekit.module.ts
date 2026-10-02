import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '@/database/database.module';
import { StorageModule } from '@/storage/storage.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { VoicePresenceModule } from '@/voice-presence/voice-presence.module';
import { LivekitService } from './livekit.service';
import { LivekitAccessService } from './livekit-access.service';
import { RedisModule } from '@/redis/redis.module';
import { LivekitReplayService } from './livekit-replay.service';
import { ReplaySegmentsService } from './replay-segments.service';
import { ClipLibraryService } from './clip-library.service';
import { FfmpegService } from './ffmpeg.service';
import { FfmpegProvider } from './providers/ffmpeg.provider';
import { RoomServiceProvider } from './providers/room-service.provider';
import { EgressClientProvider } from './providers/egress-client.provider';
import { LivekitController } from './livekit.controller';
import { LivekitWebhookController } from './livekit-webhook.controller';
import { UserModule } from '@/user/user.module';
import { RolesModule } from '@/roles/roles.module';
import { ThumbnailService } from '@/file/thumbnail.service';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    AuthModule,
    DatabaseModule,
    RedisModule,
    StorageModule,
    WebsocketModule,
    UserModule,
    RolesModule,
    // Clip messages are created via CLIP_MESSAGE_CREATE domain events handled
    // by the messages module, so no MessagesModule import is needed here.
    // VoicePresence no longer imports this module (it emits VOICE_USER_LEFT
    // events instead), so this is a plain downward dependency.
    VoicePresenceModule,
  ],
  controllers: [LivekitController, LivekitWebhookController],
  providers: [
    LivekitService,
    LivekitAccessService,
    LivekitReplayService,
    ReplaySegmentsService,
    ClipLibraryService,
    FfmpegService,
    FfmpegProvider,
    RoomServiceProvider,
    EgressClientProvider,
    ThumbnailService,
  ],
  exports: [
    LivekitService,
    LivekitAccessService,
    LivekitReplayService,
    ClipLibraryService,
    FfmpegProvider,
  ],
})
export class LivekitModule {}
