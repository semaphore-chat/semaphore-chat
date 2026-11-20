import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { RbacActions } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { AuthenticatedRequest } from '@/types';
import { PresenceService } from './presence.service';
import {
  UserPresenceResponseDto,
  BulkPresenceResponseDto,
  CommunityPresenceResponseDto,
} from './dto/presence-response.dto';

@Controller('presence')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  // Presence is only visible between connected users (shared community,
  // accepted friend, DM group); everyone else reads as offline. No exemption
  // for instance owners/admins.
  @Get('user/:userId')
  @ApiOkResponse({ type: UserPresenceResponseDto })
  async getUserPresence(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<UserPresenceResponseDto> {
    const visible = await this.presenceService.visibleUserIds(req.user.id, [
      userId,
    ]);
    const isOnline = visible.has(userId)
      ? await this.presenceService.isOnline(userId)
      : false;
    return {
      userId,
      isOnline,
    };
  }

  @Get('users/bulk')
  @ApiOkResponse({ type: BulkPresenceResponseDto })
  async getBulkPresence(
    @Req() req: AuthenticatedRequest,
  ): Promise<BulkPresenceResponseDto> {
    const onlineUsers = await this.presenceService.getOnlineUsers();
    const visible = await this.presenceService.visibleUserIds(
      req.user.id,
      onlineUsers,
    );
    const presence: Record<string, boolean> = {};

    // Mark all visible online users as true
    for (const userId of onlineUsers) {
      if (visible.has(userId)) presence[userId] = true;
    }

    return { presence };
  }

  @Get('users/:userIds')
  @ApiOkResponse({ type: BulkPresenceResponseDto })
  async getMultipleUserPresence(
    @Req() req: AuthenticatedRequest,
    @Param('userIds') userIds: string,
  ): Promise<BulkPresenceResponseDto> {
    const userIdArray = userIds
      .split(',')
      .filter((id) => isUUID(id))
      .slice(0, 200);
    const visible = await this.presenceService.visibleUserIds(
      req.user.id,
      userIdArray,
    );
    const visibleIds = userIdArray.filter((id) => visible.has(id));
    const online = await this.presenceService.areOnline(visibleIds);
    const presence: Record<string, boolean> = {};
    for (const id of userIdArray) presence[id] = online[id] ?? false;
    return { presence };
  }

  // The same permission the member list needs (READ_MEMBER), so a non-member
  // gets the guard's 403 for a community they can't list — never a count.
  @Get('community/:communityId')
  @ApiOkResponse({ type: CommunityPresenceResponseDto })
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  getCommunityPresence(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityPresenceResponseDto> {
    return this.presenceService.getCommunityPresence(communityId);
  }
}
