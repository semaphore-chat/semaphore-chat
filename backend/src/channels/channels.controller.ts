import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { MoveChannelDto } from './dto/move-channel.dto';
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
import { ChannelDto } from './dto/channel-response.dto';

@Controller('channels')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  @HttpCode(201)
  @RequiredActions(RbacActions.CREATE_CHANNEL)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.BODY,
  })
  @ApiCreatedResponse({ type: ChannelDto })
  create(
    @Body() createChannelDto: CreateChannelDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelDto> {
    return this.channelsService.create(createChannelDto, req.user);
  }

  @Get('/community/:communityId')
  @RequiredActions(RbacActions.READ_CHANNEL)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [ChannelDto] })
  findAllForCommunity(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelDto[]> {
    return this.channelsService.findAll(communityId, req.user.id);
  }

  @Get('/community/:communityId/mentionable')
  @RequiredActions(RbacActions.READ_CHANNEL)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [ChannelDto] })
  getMentionableChannels(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelDto[]> {
    return this.channelsService.findMentionableChannels(
      communityId,
      req.user.id,
    );
  }

  @Get(':id')
  @RequiredActions(RbacActions.READ_CHANNEL)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ChannelDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ChannelDto> {
    return this.channelsService.findOne(id);
  }

  @Patch(':id')
  @RequiredActions(RbacActions.UPDATE_CHANNEL)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ChannelDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateChannelDto: UpdateChannelDto,
  ): Promise<ChannelDto> {
    return this.channelsService.update(id, updateChannelDto);
  }

  @HttpCode(204)
  @Delete(':id')
  @RequiredActions(RbacActions.DELETE_CHANNEL)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.channelsService.remove(id);
  }

  @Post(':id/move-up')
  @HttpCode(200)
  @RequiredActions(RbacActions.UPDATE_CHANNEL)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.BODY,
  })
  @ApiOkResponse({ type: [ChannelDto] })
  moveUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() moveChannelDto: MoveChannelDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelDto[]> {
    return this.channelsService.moveChannelUp(
      id,
      moveChannelDto.communityId,
      req.user.id,
    );
  }

  @Post(':id/move-down')
  @HttpCode(200)
  @RequiredActions(RbacActions.UPDATE_CHANNEL)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.BODY,
  })
  @ApiOkResponse({ type: [ChannelDto] })
  moveDown(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() moveChannelDto: MoveChannelDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelDto[]> {
    return this.channelsService.moveChannelDown(
      id,
      moveChannelDto.communityId,
      req.user.id,
    );
  }
}
