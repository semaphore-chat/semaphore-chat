import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { ReactionsService } from './reactions.service';
import { ClipMessageListener } from './clip-message.listener';
import { MessagesController } from './messages.controller';
import { MessagesGateway } from './messages.gateway';
import { MessageDispatchService } from './message-dispatch.service';
import { MessageSendService } from './message-send.service';
import { DatabaseModule } from '@/database/database.module';
import { UserModule } from '@/user/user.module';
import { RolesModule } from '@/roles/roles.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { RoomsModule } from '@/rooms/rooms.module';
import { AuthModule } from '@/auth/auth.module';
import { FileModule } from '@/file/file.module';
import { MessageOwnershipGuard } from '@/auth/message-ownership.guard';
import { ModerationModule } from '@/moderation/moderation.module';
import { ReadReceiptsModule } from '@/read-receipts/read-receipts.module';
import { RedisModule } from '@/redis/redis.module';

@Module({
  controllers: [MessagesController],
  providers: [
    MessagesService,
    ReactionsService,
    MessagesGateway,
    MessageOwnershipGuard,
    ClipMessageListener,
    MessageDispatchService,
    MessageSendService,
  ],
  imports: [
    DatabaseModule,
    UserModule,
    RolesModule,
    WebsocketModule,
    RoomsModule,
    AuthModule,
    FileModule,
    // NotificationsModule/LinkPreviewsModule are no longer imported here —
    // MessageDispatchService and MessagesController talk to the
    // message-fanout/link-previews BullMQ queues directly (via JobsModule,
    // which is @Global()) instead of calling those services in-process.
    ModerationModule,
    ReadReceiptsModule,
    RedisModule,
  ],
  exports: [MessagesService, ReactionsService, MessageDispatchService],
})
export class MessagesModule {}
