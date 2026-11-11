import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { StorageQuotaService } from './storage-quota.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacResource, RbacResourceType } from '@/auth/rbac-resource.decorator';
import { RbacActions } from '@prisma/client';
import { AuthenticatedRequest } from '@/types';
import { SuccessResponseDto } from '@/common/dto/common-response.dto';
import {
  UpdateUserQuotaDto,
  UpdateStorageSettingsDto,
  UserStorageStatsDto,
  UserStorageListResponseDto,
  InstanceStorageStatsDto,
} from './dto/storage-stats.dto';

@Controller('storage')
@UseGuards(JwtAuthGuard, RbacGuard)
export class StorageQuotaController {
  constructor(private readonly storageQuotaService: StorageQuotaService) {}

  /**
   * Get current user's storage stats (for user settings)
   */
  @Get('my-usage')
  @ApiOkResponse({ type: UserStorageStatsDto })
  async getMyStorageStats(
    @Req() req: AuthenticatedRequest,
  ): Promise<UserStorageStatsDto> {
    return this.storageQuotaService.getUserStorageStats(req.user.id);
  }

  /**
   * Get instance-wide storage statistics (admin only)
   */
  @Get('instance')
  @RequiredActions(RbacActions.READ_INSTANCE_STATS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: InstanceStorageStatsDto })
  async getInstanceStorageStats(): Promise<InstanceStorageStatsDto> {
    return this.storageQuotaService.getInstanceStorageStats();
  }

  /**
   * Get users list with storage usage (admin only, for storage management page)
   */
  @Get('users')
  @RequiredActions(RbacActions.MANAGE_USER_STORAGE)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: UserStorageListResponseDto })
  @ApiQuery({ name: 'skip', required: false, type: 'integer' })
  @ApiQuery({ name: 'take', required: false, type: 'integer' })
  @ApiQuery({ name: 'minPercentUsed', required: false, type: 'integer' })
  async getUsersStorageList(
    @Query('skip', new DefaultValuePipe(0), ParseIntPipe) skip: number,
    @Query('take', new DefaultValuePipe(20), ParseIntPipe) take: number,
    @Query('minPercentUsed', new DefaultValuePipe(0), ParseIntPipe)
    minPercentUsed: number,
  ): Promise<{ users: UserStorageStatsDto[]; total: number }> {
    return this.storageQuotaService.getUsersStorageList({
      skip,
      take,
      minPercentUsed: minPercentUsed || undefined,
    });
  }

  /**
   * Get specific user's storage stats (admin only)
   */
  @Get('users/:userId')
  @RequiredActions(RbacActions.MANAGE_USER_STORAGE)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: UserStorageStatsDto })
  async getUserStorageStats(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserStorageStatsDto> {
    return this.storageQuotaService.getUserStorageStats(userId);
  }

  /**
   * Update user's storage quota (admin only)
   */
  @Patch('users/:userId/quota')
  @RequiredActions(RbacActions.MANAGE_USER_STORAGE)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: UserStorageStatsDto })
  async updateUserQuota(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserQuotaDto,
  ): Promise<UserStorageStatsDto> {
    return this.storageQuotaService.updateUserQuota(userId, dto.quotaBytes);
  }

  /**
   * Recalculate user's storage usage (admin only)
   */
  @Post('users/:userId/recalculate')
  @RequiredActions(RbacActions.MANAGE_USER_STORAGE)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: UserStorageStatsDto })
  async recalculateUserStorage(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserStorageStatsDto> {
    return this.storageQuotaService.recalculateUserStorage(userId);
  }

  /**
   * Update instance storage settings (admin only)
   */
  @Patch('settings')
  @RequiredActions(RbacActions.UPDATE_INSTANCE_SETTINGS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: SuccessResponseDto })
  async updateStorageSettings(
    @Body() dto: UpdateStorageSettingsDto,
  ): Promise<{ success: boolean }> {
    await this.storageQuotaService.updateStorageSettings(
      dto.defaultStorageQuotaBytes,
      dto.maxFileSizeBytes,
    );
    return { success: true };
  }
}
