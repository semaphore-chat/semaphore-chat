import { Module } from '@nestjs/common';
import { WebsocketService } from './websocket.service';
import { RolesModule } from '@/roles/roles.module';

@Module({
  // RolesModule: #channel mention redaction for socket payloads
  imports: [RolesModule],
  providers: [WebsocketService],
  exports: [WebsocketService],
})
export class WebsocketModule {}
