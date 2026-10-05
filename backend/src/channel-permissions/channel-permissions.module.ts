import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { RolesModule } from '@/roles/roles.module';
import { WebsocketModule } from '@/websocket/websocket.module';
import { ChannelPermissionsController } from './channel-permissions.controller';
import { ChannelPermissionsService } from './channel-permissions.service';

@Module({
  imports: [DatabaseModule, RolesModule, WebsocketModule],
  controllers: [ChannelPermissionsController],
  providers: [ChannelPermissionsService],
})
export class ChannelPermissionsModule {}
