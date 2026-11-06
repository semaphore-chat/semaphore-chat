import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  HttpCode,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';

import { CommunityService } from './community.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunityDto } from './dto/update-community.dto';
import { CommunityResponseDto } from './dto/community-response.dto';
import {
  CommunityStatsDetailDto,
  CommunityStatsListResponseDto,
} from './dto/community-stats-response.dto';
import { RbacGuard } from '@/auth/rbac.guard';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacActions } from '@prisma/client';
import {
  RbacResource,
  RbacResourceType,
  ResourceIdSource,
} from '@/auth/rbac-resource.decorator';
import { AuthenticatedRequest } from '@/types';
import { clampLimit } from '@/common/utils/clamp-limit.util';

@ApiTags('Community')
@ApiBearerAuth()
@Controller('community')
@UseGuards(JwtAuthGuard, RbacGuard)
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Post()
  @HttpCode(201)
  @RequiredActions(RbacActions.CREATE_COMMUNITY)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiCreatedResponse({ type: CommunityResponseDto })
  create(
    @Body() createCommunityDto: CreateCommunityDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CommunityResponseDto> {
    return this.communityService.create(createCommunityDto, req.user.id);
  }

  @Get()
  @RequiredActions(RbacActions.READ_ALL_COMMUNITIES)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: [CommunityResponseDto] })
  findAll(): Promise<CommunityResponseDto[]> {
    return this.communityService.findAll();
  }

  @Get('/mine')
  @ApiOkResponse({ type: [CommunityResponseDto] })
  // No RBAC check needed - users can always see their own communities
  findAllMine(
    @Req() req: AuthenticatedRequest,
  ): Promise<CommunityResponseDto[]> {
    return this.communityService.findAll(req.user.id);
  }

  @Patch(':id')
  @RequiredActions(RbacActions.UPDATE_COMMUNITY)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: CommunityResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCommunityDto: UpdateCommunityDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<CommunityResponseDto> {
    return this.communityService.update(id, updateCommunityDto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiredActions(RbacActions.DELETE_COMMUNITY)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.communityService.remove(id);
  }

  // ============================================
  // Admin Community Management Endpoints
  // ============================================

  /**
   * Get all communities with stats for admin dashboard
   */
  @Get('admin/list')
  @RequiredActions(RbacActions.READ_ALL_COMMUNITIES)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: CommunityStatsListResponseDto })
  findAllWithStats(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('continuationToken') continuationToken?: string,
    @Query('search') search?: string,
  ): Promise<CommunityStatsListResponseDto> {
    return this.communityService.findAllWithStats(
      clampLimit(limit, 100),
      continuationToken,
      search,
    );
  }

  /**
   * Get a single community with detailed stats for admin
   */
  @Get('admin/:id')
  @RequiredActions(RbacActions.READ_ALL_COMMUNITIES)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: CommunityStatsDetailDto })
  findOneWithStats(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommunityStatsDetailDto> {
    return this.communityService.findOneWithStats(id);
  }

  @Get(':id')
  @RequiredActions(RbacActions.READ_COMMUNITY)
  @RbacResource({
    type: RbacResourceType.COMMUNITY,
    idKey: 'id',
    source: ResourceIdSource.PARAM,
  })
  @ApiOkResponse({ type: CommunityResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommunityResponseDto> {
    return this.communityService.findOne(id);
  }

  /**
   * Force delete a community (admin action - bypasses ownership check)
   */
  @Delete('admin/:id')
  @HttpCode(204)
  @RequiredActions(RbacActions.DELETE_COMMUNITY)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  forceRemove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.communityService.forceRemove(id);
  }
}
