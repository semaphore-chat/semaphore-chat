import { Module } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { MembershipController } from './membership.controller';
import { AcceptInviteController } from './accept-invite.controller';
import { DatabaseModule } from '@/database/database.module';
import { CommunityModule } from '@/community/community.module';
import { RolesModule } from '@/roles/roles.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { InviteModule } from '@/invite/invite.module';

@Module({
  imports: [
    DatabaseModule,
    CommunityModule,
    RolesModule,
    WebsocketModule,
    InviteModule,
  ],
  controllers: [MembershipController, AcceptInviteController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
