import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  Req,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ChannelMembershipService } from './channel-membership.service';
import { CreateChannelMembershipDto } from './dto/create-channel-membership.dto';
import { ChannelMembershipResponseDto } from './dto/channel-membership-response.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';

import { AuthenticatedRequest } from '@/types';

@Controller('channel-membership')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ChannelMembershipController {
  constructor(
    private readonly channelMembershipService: ChannelMembershipService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequiredActions(RbacActions.CREATE_MEMBER)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.BODY,
  })
  create(
    @Body() createChannelMembershipDto: CreateChannelMembershipDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelMembershipResponseDto> {
    return this.channelMembershipService.create(
      createChannelMembershipDto,
      req.user.id,
    );
  }

  @Get('/channel/:channelId')
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  findAllForChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelMembershipResponseDto[]> {
    return this.channelMembershipService.findAllForChannel(channelId);
  }

  @Get('/user/:userId')
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  findAllForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelMembershipResponseDto[]> {
    // Users can only view their own channel memberships unless they have additional permissions
    if (userId !== req.user.id) {
      // Could add additional RBAC check here for viewing other users' channel memberships
      // For now, only allow users to view their own channel memberships
      throw new ForbiddenException(
        'Cannot view other users channel memberships',
      );
    }
    return this.channelMembershipService.findAllForUser(userId);
  }

  @Get('/my')
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  findMyChannelMemberships(
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelMembershipResponseDto[]> {
    return this.channelMembershipService.findAllForUser(req.user.id);
  }

  @Get('/channel/:channelId/user/:userId')
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  findOne(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<ChannelMembershipResponseDto> {
    return this.channelMembershipService.findOne(userId, channelId);
  }

  @Delete('/channel/:channelId/user/:userId')
  @HttpCode(204)
  @RequiredActions(RbacActions.DELETE_MEMBER)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.channelMembershipService.removeByActor(
      req.user,
      userId,
      channelId,
    );
  }

  @Delete('/leave/:channelId')
  @HttpCode(204)
  @RequiredActions(RbacActions.DELETE_MEMBER)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  leaveChannel(
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.channelMembershipService.remove(req.user.id, channelId);
  }
}
