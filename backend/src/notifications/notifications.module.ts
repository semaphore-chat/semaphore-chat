import { RolesModule } from '@/roles/roles.module';
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushActionsController } from './push-actions.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsFanoutProcessor } from './notifications-fanout.processor';
import { DatabaseModule } from '@/database/database.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { AuthModule } from '@/auth/auth.module';
import { UserModule } from '@/user/user.module';
import { PushNotificationsModule } from '@/push-notifications/push-notifications.module';
import { PresenceModule } from '@/presence/presence.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
  controllers: [NotificationsController, PushActionsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    // BullMQ consumer for the `message-fanout` queue (JobsModule, @Global(),
    // provides the underlying Queue/Worker registration — see jobs.module.ts).
    NotificationsFanoutProcessor,
  ],
  imports: [
    DatabaseModule,
    WebsocketModule,
    AuthModule,
    UserModule,
    PushNotificationsModule,
    PresenceModule,
    RedisModule,
    RolesModule,
  ],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
