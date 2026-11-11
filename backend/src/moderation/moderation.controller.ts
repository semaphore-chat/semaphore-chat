import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
  HttpCode,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { ModerationService } from './moderation.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions, ModerationAction } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';

import { AuthenticatedRequest } from '@/types';
import { clampLimit } from '@/common/utils/clamp-limit.util';
import {
  ModerationBanUserDto,
  UnbanUserDto,
  KickUserDto,
  TimeoutUserDto,
  RemoveTimeoutDto,
  PinMessageDto,
  UnpinMessageDto,
  DeleteMessageAsModDto,
} from './dto';
import {
  CommunityBanDto,
  CommunityTimeoutDto,
  TimeoutStatusResponseDto,
  ModerationLogsResponseDto,
  SuccessMessageDto,
  PinnedMessageDto,
} from './dto/moderation-response.dto';

@Controller('moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  // =========================================
  // BAN ENDPOINTS
  // =========================================

  @Post('ban/:communityId/:userId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.BAN_USER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @HttpCode(200)
  @ApiOkResponse({ type: SuccessMessageDto })
  async banUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ModerationBanUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    await this.moderationService.banUser(
      communityId,
      userId,
      req.user.id,
      dto.reason,
      expiresAt,
    );
    return { success: true, message: 'User banned successfully' };
  }

  @Delete('ban/:communityId/:userId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UNBAN_USER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  async unbanUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UnbanUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    await this.moderationService.unbanUser(
      communityId,
      userId,
      req.user.id,
      dto.reason,
      req.user.role,
    );
    return { success: true, message: 'User unbanned successfully' };
  }

  @Get('bans/:communityId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.VIEW_BAN_LIST)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [CommunityBanDto] })
  async getBanList(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityBanDto[]> {
    return this.moderationService.getBanList(communityId);
  }

  // =========================================
  // KICK ENDPOINT
  // =========================================

  @Post('kick/:communityId/:userId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.KICK_USER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @HttpCode(200)
  @ApiOkResponse({ type: SuccessMessageDto })
  async kickUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: KickUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    await this.moderationService.kickUser(
      communityId,
      userId,
      req.user.id,
      dto.reason,
    );
    return { success: true, message: 'User kicked successfully' };
  }

  // =========================================
  // TIMEOUT ENDPOINTS
  // =========================================

  @Post('timeout/:communityId/:userId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.TIMEOUT_USER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @HttpCode(200)
  @ApiOkResponse({ type: SuccessMessageDto })
  async timeoutUser(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: TimeoutUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    await this.moderationService.timeoutUser(
      communityId,
      userId,
      req.user.id,
      dto.durationSeconds,
      dto.reason,
    );
    return { success: true, message: 'User timed out successfully' };
  }

  @Delete('timeout/:communityId/:userId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.TIMEOUT_USER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  async removeTimeout(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: RemoveTimeoutDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    await this.moderationService.removeTimeout(
      communityId,
      userId,
      req.user.id,
      dto.reason,
      req.user.role,
    );
    return { success: true, message: 'Timeout removed successfully' };
  }

  @Get('timeouts/:communityId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.VIEW_BAN_LIST) // Same permission as viewing bans
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [CommunityTimeoutDto] })
  async getTimeoutList(
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<CommunityTimeoutDto[]> {
    return this.moderationService.getTimeoutList(communityId);
  }

  @Get('timeout-status/:communityId/:userId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: TimeoutStatusResponseDto })
  async getTimeoutStatus(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TimeoutStatusResponseDto> {
    return this.moderationService.isUserTimedOut(communityId, userId);
  }

  // =========================================
  // MESSAGE PINNING ENDPOINTS
  // =========================================

  @Post('pin/:messageId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.PIN_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.PARAM,
  })
  @HttpCode(200)
  @ApiOkResponse({ type: SuccessMessageDto })
  async pinMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: PinMessageDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    await this.moderationService.pinMessage(messageId, req.user.id, dto.reason);
    return { success: true, message: 'Message pinned successfully' };
  }

  @Delete('pin/:messageId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.UNPIN_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  async unpinMessage(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UnpinMessageDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    await this.moderationService.unpinMessage(
      messageId,
      req.user.id,
      dto.reason,
    );
    return { success: true, message: 'Message unpinned successfully' };
  }

  @Get('pins/:channelId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.READ_MESSAGE)
  @RbacResource({
    type: RbacResourceType.CHANNEL,
    idKey: 'channelId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: [PinnedMessageDto] })
  async getPinnedMessages(
    @Param('channelId', ParseUUIDPipe) channelId: string,
  ): Promise<PinnedMessageDto[]> {
    return this.moderationService.getPinnedMessages(channelId);
  }

  // =========================================
  // MESSAGE DELETION ENDPOINT
  // =========================================

  @Delete('message/:messageId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.DELETE_ANY_MESSAGE)
  @RbacResource({
    type: RbacResourceType.MESSAGE,
    idKey: 'messageId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: SuccessMessageDto })
  async deleteMessageAsMod(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: DeleteMessageAsModDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<SuccessMessageDto> {
    await this.moderationService.deleteMessageAsMod(
      messageId,
      req.user.id,
      dto.reason,
    );
    return { success: true, message: 'Message deleted successfully' };
  }

  // =========================================
  // MODERATION LOGS ENDPOINT
  // =========================================

  @Get('logs/:communityId')
  @UseGuards(RbacGuard)
  @RequiredActions(RbacActions.VIEW_MODERATION_LOGS)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: ModerationLogsResponseDto })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  @ApiQuery({ name: 'offset', required: false, type: 'integer' })
  async getModerationLogs(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('action') action?: ModerationAction,
  ): Promise<ModerationLogsResponseDto> {
    return this.moderationService.getModerationLogs(communityId, {
      limit: clampLimit(limit, 100),
      offset: Math.max(offset, 0),
      action,
    });
  }
}
