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

  private resolveRoom(
    roomType: DebugEmitDto['roomType'],
    roomId: string,
  ): string {
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
  emit(@Req() req: AuthenticatedRequest, @Body() dto: DebugEmitDto) {
    this.assertOwner(req);

    const room = this.resolveRoom(dto.roomType, dto.roomId);
    // Admin debug endpoint deliberately emits an arbitrary event/payload
    // with no fixed contract (that's the point of a raw emit debug tool) —
    // sendToRoom's generic signature can't express "any event, any
    // payload" safely. Cast inline (not via a detached variable, which
    // would lose the `this` binding sendToRoom needs) through a loosened
    // local signature for this one call, rather than reintroducing `any`
    // on the DTO or widening sendToRoom's real signature for every other
    // caller.
    //
    // typescript-eslint >= 8.70 reports this assertion as unnecessary, but
    // its autofix breaks type-check (TS2345: `string` is not assignable to
    // `keyof ServerEventPayloads`), so the rule is off for this statement.
    /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
    const sent = (
      this.websocketService.sendToRoom as (
        room: string,
        event: string,
        payload: unknown,
      ) => boolean
    )(room, dto.event, dto.payload);
    /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */

    return {
      success: sent,
      room,
      event: dto.event,
    };
  }
}
