import { Module } from '@nestjs/common';
import { VoicePresenceService } from './voice-presence.service';
import {
  VoicePresenceController,
  UserVoicePresenceController,
  DmVoicePresenceController,
} from './voice-presence.controller';
import { RedisModule } from '@/redis/redis.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { AuthModule } from '@/auth/auth.module';
import { UserModule } from '@/user/user.module';
import { RolesModule } from '@/roles/roles.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [
    RedisModule,
    WebsocketModule,
    AuthModule,
    UserModule,
    RolesModule,
    DatabaseModule,
  ],
  controllers: [
    VoicePresenceController,
    UserVoicePresenceController,
    DmVoicePresenceController,
  ],
  providers: [VoicePresenceService],
  exports: [VoicePresenceService],
})
export class VoicePresenceModule {}
