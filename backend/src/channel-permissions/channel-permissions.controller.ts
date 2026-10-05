import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
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
import { ChannelPermissionsService } from './channel-permissions.service';
import {
  ChannelOverwritesDto,
  ManagedChannelDto,
  ReplaceChannelOverwritesDto,
} from './dto/channel-overwrite.dto';
import {
  ChannelCapabilitiesDto,
  CommunityChannelCapabilitiesDto,
} from './dto/channel-capabilities.dto';

/**
 * Per-channel permission overwrites and the current user's effective
 * channel capabilities. Design:
 * docs/superpowers/plans/2026-10-04-channel-permissions-design.md
 */
@Controller('channels')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ChannelPermissionsController {
  constructor(
    private readonly channelPermissionsService: ChannelPermissionsService,
  ) {}

  /** What the current user can do in every channel they can see. */
  @Get('/community/:communityId/permissions/me')
  @RequiredActions(RbacActions.READ_COMMUNITY)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: CommunityChannelCapabilitiesDto })
  getMyCommunityChannelPermissions(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CommunityChannelCapabilitiesDto> {
    return this.channelPermissionsService.myCommunityCapabilities(
      req.user.id,
      communityId,
    );
  }

  /** Every channel with its overwrites, for managers (even hidden ones). */
  @Get('/community/:communityId/permissions')
  @RequiredActions(RbacActions.MANAGE_CHANNEL_PERMISSIONS)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [ManagedChannelDto] })
  listChannelPermissions(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<ManagedChannelDto[]> {
    return this.channelPermissionsService.listForManagement(communityId);
  }

  /** What the current user can do in this channel. */
  @Get(':id/permissions/me')
  @RequiredActions(RbacActions.READ_CHANNEL)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ChannelCapabilitiesDto })
  getMyChannelPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelCapabilitiesDto> {
    return this.channelPermissionsService.myChannelCapabilities(
      req.user.id,
      id,
    );
  }

  @Get(':id/overwrites')
  @RequiredActions(RbacActions.MANAGE_CHANNEL_PERMISSIONS)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ChannelOverwritesDto })
  getOverwrites(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChannelOverwritesDto> {
    return this.channelPermissionsService.getOverwrites(id);
  }

  @Put(':id/overwrites')
  @RequiredActions(RbacActions.MANAGE_CHANNEL_PERMISSIONS)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ChannelOverwritesDto })
  replaceOverwrites(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceChannelOverwritesDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelOverwritesDto> {
    return this.channelPermissionsService.replaceOverwrites(id, dto, req.user);
  }
}
