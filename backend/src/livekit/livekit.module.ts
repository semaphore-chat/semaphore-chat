import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '@/database/database.module';
import { StorageModule } from '@/storage/storage.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { MessagesModule } from '@/messages/messages.module';
import { VoicePresenceModule } from '@/voice-presence/voice-presence.module';
import { LivekitService } from './livekit.service';
import { LivekitReplayService } from './livekit-replay.service';
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
    StorageModule,
    WebsocketModule,
    MessagesModule,
    UserModule,
    RolesModule,
    // Use forwardRef to handle circular dependency (VoicePresenceModule imports LivekitModule)
    forwardRef(() => VoicePresenceModule),
  ],
  controllers: [LivekitController, LivekitWebhookController],
  providers: [
    LivekitService,
    LivekitReplayService,
    ClipLibraryService,
    FfmpegService,
    FfmpegProvider,
    RoomServiceProvider,
    EgressClientProvider,
    ThumbnailService,
  ],
  exports: [
    LivekitService,
    LivekitReplayService,
    ClipLibraryService,
    FfmpegProvider,
  ],
})
export class LivekitModule {}
