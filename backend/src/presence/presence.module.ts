import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';
import { DatabaseModule } from '@/database/database.module';
import { RedisModule } from '@/redis/redis.module';
import { PresenceGateway } from './presence.gateway';
import { AuthModule } from '@/auth/auth.module';
import { RolesModule } from '@/roles/roles.module';
import { UserModule } from '@/user/user.module';
import { WebsocketModule } from '@/websocket/websocket.module';

@Module({
  controllers: [PresenceController],
  providers: [PresenceService, PresenceGateway],
  imports: [
    DatabaseModule,
    RedisModule,
    AuthModule,
    RolesModule,
    UserModule,
    WebsocketModule,
  ],
  exports: [PresenceService],
})
export class PresenceModule {}
