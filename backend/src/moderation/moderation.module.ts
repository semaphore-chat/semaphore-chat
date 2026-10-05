import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { TimeoutExpiryProcessor } from './timeout-expiry.processor';
import { ModerationService } from './moderation.service';
import { DatabaseModule } from '@/database/database.module';
import { RolesModule } from '@/roles/roles.module';
import { MembershipModule } from '@/membership/membership.module';
import { WebsocketModule } from '@/websocket/websocket.module';

@Module({
  imports: [DatabaseModule, RolesModule, MembershipModule, WebsocketModule],
  controllers: [ModerationController],
  providers: [
    ModerationService,
    // BullMQ consumer for `timeout-expiry` (queue registered in JobsModule)
    TimeoutExpiryProcessor,
  ],
  exports: [ModerationService],
})
export class ModerationModule {}
