import { Module } from '@nestjs/common';
import { WebsocketModule } from '@/websocket/websocket.module';
import { DebugController } from './debug.controller';

@Module({
  imports: [WebsocketModule],
  controllers: [DebugController],
})
export class DebugModule {}
