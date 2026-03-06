import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { InstanceService } from './instance.service';
import { RbacActions } from '@prisma/client';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RbacGuard } from '@/auth/rbac.guard';
import { RequiredActions } from '@/auth/rbac-action.decorator';
import { RbacResource, RbacResourceType } from '@/auth/rbac-resource.decorator';
import { Public } from '@/auth/public.decorator';
import { UpdateInstanceSettingsDto } from './dto/update-instance-settings.dto';
import { InstanceSettingsResponseDto } from './dto/instance-settings-response.dto';
import {
  PublicSettingsResponseDto,
  InstanceStatsResponseDto,
} from './dto/instance-response.dto';

@Controller('instance')
@UseInterceptors(ClassSerializerInterceptor)
export class InstanceController {
  constructor(private readonly instanceService: InstanceService) {}

  /**
   * Get instance settings (public - needed for registration mode)
   */
  @Get('settings/public')
  @Public()
  @ApiOkResponse({ type: PublicSettingsResponseDto })
  async getPublicSettings(): Promise<PublicSettingsResponseDto> {
    const settings = await this.instanceService.getSettings();
    return {
      name: settings.name,
      registrationMode: settings.registrationMode,
      maxFileSizeBytes: Number(settings.maxFileSizeBytes),
    };
  }

  /**
   * Get full instance settings (admin only)
   */
  @Get('settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequiredActions(RbacActions.READ_INSTANCE_SETTINGS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: InstanceSettingsResponseDto })
  async getSettings(): Promise<InstanceSettingsResponseDto> {
    const settings = await this.instanceService.getSettings();
    return new InstanceSettingsResponseDto(settings);
  }

  /**
   * Update instance settings (admin only)
   */
  @Patch('settings')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequiredActions(RbacActions.UPDATE_INSTANCE_SETTINGS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: InstanceSettingsResponseDto })
  async updateSettings(
    @Body() dto: UpdateInstanceSettingsDto,
  ): Promise<InstanceSettingsResponseDto> {
    const settings = await this.instanceService.updateSettings(dto);
    return new InstanceSettingsResponseDto(settings);
  }

  /**
   * Get instance statistics (admin only)
   */
  @Get('stats')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequiredActions(RbacActions.READ_INSTANCE_STATS)
  @RbacResource({ type: RbacResourceType.INSTANCE })
  @ApiOkResponse({ type: InstanceStatsResponseDto })
  async getStats(): Promise<InstanceStatsResponseDto> {
    return this.instanceService.getStats();
  }
}
