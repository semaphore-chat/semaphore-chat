import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsGateway } from './rooms.gateway';
import { RoomSubscriptionHandler } from './room-subscription.handler';
import { SessionRevocationHandler } from './session-revocation.handler';
import { SocketSessionService } from './socket-session.service';
import { AuthModule } from '@/auth/auth.module';
import { UserModule } from '@/user/user.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { DatabaseModule } from '@/database/database.module';
import { RolesModule } from '@/roles/roles.module';
import { VoicePresenceModule } from '@/voice-presence/voice-presence.module';
import { LivekitModule } from '@/livekit/livekit.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
  providers: [
    RoomsGateway,
    RoomsService,
    RoomSubscriptionHandler,
    SessionRevocationHandler,
    SocketSessionService,
  ],
  imports: [
    AuthModule,
    UserModule,
    WebsocketModule,
    DatabaseModule,
    RolesModule,
    // Plain imports: the LivekitModule -> MessagesModule and
    // VoicePresenceModule -> LivekitModule edges were replaced with domain
    // events, so there is no longer a cycle back to MessagesModule.
    VoicePresenceModule,
    LivekitModule,
    RedisModule,
  ],
})
export class RoomsModule {}
