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
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { MembershipService } from './membership.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import {
  MembershipResponseDto,
  PaginatedMembershipsResponseDto,
} from './dto/membership-response.dto';
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
import { clampLimit } from '@/common/utils/clamp-limit.util';

@Controller('membership')
@UseGuards(JwtAuthGuard, RbacGuard)
export class MembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  @Post()
  @HttpCode(201)
  @RequiredActions(RbacActions.CREATE_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.BODY,
  })
  create(
    @Body() createMembershipDto: CreateMembershipDto,
  ): Promise<MembershipResponseDto> {
    return this.membershipService.create(createMembershipDto);
  }

  @Get('/community/:communityId')
  @ApiOkResponse({ type: PaginatedMembershipsResponseDto })
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  findAllForCommunity(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('continuationToken') continuationToken?: string,
  ): Promise<PaginatedMembershipsResponseDto> {
    limit = clampLimit(limit, 500);
    return this.membershipService.findAllForCommunity(
      communityId,
      limit,
      continuationToken,
    );
  }

  @Get('/community/:communityId/search')
  @ApiQuery({ name: 'limit', required: false, type: 'integer' })
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  searchCommunityMembers(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Query('query') query: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<MembershipResponseDto[]> {
    return this.membershipService.searchMembers(
      communityId,
      query || '',
      limit,
    );
  }

  @Get('/user/:userId')
  findAllForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MembershipResponseDto[]> {
    if (userId !== req.user.id) {
      throw new ForbiddenException('Cannot view other users memberships');
    }
    return this.membershipService.findAllForUser(userId);
  }

  @Get('/my')
  findMyMemberships(
    @Req() req: AuthenticatedRequest,
  ): Promise<MembershipResponseDto[]> {
    return this.membershipService.findAllForUser(req.user.id);
  }

  @Get('/community/:communityId/user/:userId')
  @RequiredActions(RbacActions.READ_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  findOne(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('communityId', ParseUUIDPipe) communityId: string,
  ): Promise<MembershipResponseDto> {
    return this.membershipService.findOne(userId, communityId);
  }

  @Delete('/community/:communityId/user/:userId')
  @HttpCode(204)
  @RequiredActions(RbacActions.DELETE_MEMBER)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'communityId',
    source: ResourceIdSource.PARAM,
  })
  remove(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.membershipService.removeByActor(req.user, userId, communityId);
  }

  @Delete('/leave/:communityId')
  @HttpCode(204)
  leaveCommunity(
    @Param('communityId', ParseUUIDPipe) communityId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.membershipService.remove(req.user.id, communityId);
  }
}
