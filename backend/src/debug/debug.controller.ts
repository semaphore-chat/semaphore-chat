import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  HttpCode,
  ForbiddenException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InstanceRole } from '@prisma/client';
import { AuthenticatedRequest } from '@/types';
import { WebsocketService } from '@/websocket/websocket.service';
import { RoomName } from '@/common/utils/room-name.util';
import { DebugEmitDto } from './dto/debug-emit.dto';

@ApiExcludeController()
@Controller('debug')
export class DebugController {
  constructor(private readonly websocketService: WebsocketService) {}

  private assertOwner(req: AuthenticatedRequest): void {
    if (req.user.role !== InstanceRole.OWNER) {
      throw new ForbiddenException('Debug endpoints are admin-only');
    }
  }

  private resolveRoom(roomType: DebugEmitDto['roomType'], roomId: string): string {
    switch (roomType) {
      case 'channel':
        return RoomName.channel(roomId);
      case 'dmGroup':
        return RoomName.dmGroup(roomId);
      case 'user':
        return RoomName.user(roomId);
      case 'community':
        return RoomName.community(roomId);
      case 'raw':
        return roomId;
    }
  }

  @Get('status')
  getStatus(@Req() req: AuthenticatedRequest) {
    this.assertOwner(req);
    return { enabled: true };
  }

  @Post('emit')
  @HttpCode(200)
  emit(
    @Req() req: AuthenticatedRequest,
    @Body() dto: DebugEmitDto,
  ) {
    this.assertOwner(req);

    const room = this.resolveRoom(dto.roomType, dto.roomId);
    const sent = this.websocketService.sendToRoom(room, dto.event, dto.payload);

    return {
      success: sent,
      room,
      event: dto.event,
    };
  }
}
